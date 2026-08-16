/**
 * Integration tests for the import pipeline against a real (temporary,
 * isolated) SQLite database — covers the build brief §16 requirements that
 * only make sense end-to-end: duplicate imports, overlapping statement
 * periods, credit-card payment exclusion, and undoing an import batch.
 *
 * Each test file that touches the database gets its own throwaway SQLite
 * file (via CARERA_DB_PATH, set before the db client module is first
 * imported) so these tests never share state with each other or with a
 * developer's real local database.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

const FIXTURES = path.join(__dirname, "fixtures");

function readFixture(relPath: string): Buffer {
  return readFileSync(path.join(FIXTURES, relPath));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any, schema: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let previewImport: any, commitImport: any, undoImportBatch: any;

beforeAll(async () => {
  const dbPath = path.join(os.tmpdir(), `carera-test-${randomUUID()}.db`);
  process.env.CARERA_DB_PATH = dbPath;

  const clientMod = await import("../src/lib/db/client");
  db = clientMod.db;
  schema = await import("../src/lib/db/schema");
  const migrator = await import("drizzle-orm/better-sqlite3/migrator");
  migrator.migrate(db, { migrationsFolder: path.join(__dirname, "../drizzle") });

  db.insert(schema.householdMembers)
    .values([
      { id: "member-one", name: "Test Cardholder One", initials: "TO", color: "#000" },
      { id: "member-two", name: "Test Cardholder Two", initials: "TT", color: "#111" },
    ])
    .run();
  db.insert(schema.categories)
    .values([{ id: "cat-transfer", name: "Internal transfer", color: "#000" }])
    .run();
  db.insert(schema.priorities).values([{ id: "pri-excluded", name: "Excluded / transfer" }]).run();

  const pipeline = await import("../src/lib/import/importPipeline");
  previewImport = pipeline.previewImport;
  commitImport = pipeline.commitImport;
  undoImportBatch = pipeline.undoImportBatch;
});

async function commitFixture(relPath: string) {
  const buffer = readFixture(relPath);
  const preview = await previewImport(path.basename(relPath), buffer);
  const resolutions: Record<string, { action: "create" | "link"; accountId?: string }> = {};
  for (const g of preview.accountGroups) {
    resolutions[g.accountExternalId] = g.existingAccountId
      ? { action: "link", accountId: g.existingAccountId }
      : { action: "create" };
  }
  const result = commitImport(preview, resolutions);
  return { preview, result };
}

describe("import pipeline (ABN AMRO fixture)", () => {
  it("imports valid rows, creates two accounts (checking + savings), and quarantines malformed rows", async () => {
    const { preview, result } = await commitFixture("abn-amro-checking/sample.csv");

    expect(preview.summary.malformed).toBe(2);
    expect(result.rowsImported).toBe(6);
    expect(result.rowsError).toBe(2);

    const accounts = db.select().from(schema.accounts).all();
    expect(accounts.find((a: { institution: string }) => a.institution === "abn_amro_checking")).toBeTruthy();
    expect(accounts.find((a: { institution: string }) => a.institution === "abn_amro_savings")).toBeTruthy();
  });

  it("detects duplicates when an overlapping statement is imported afterward", async () => {
    const before = db.select().from(schema.transactions).all().length;

    const { result } = await commitFixture("abn-amro-checking/sample-overlap.csv");

    // sample-overlap.csv has 2 rows: one is an exact repeat of the salary
    // row already imported above, one is genuinely new.
    expect(result.rowsDuplicate).toBe(1);
    expect(result.rowsImported).toBe(1);

    const after = db.select().from(schema.transactions).all().length;
    expect(after).toBe(before + 1);
  });
});

describe("import pipeline (Amex EU fixture — credit-card settlement handling)", () => {
  it("does not count the card-payment settlement row as household spending", async () => {
    const { result } = await commitFixture("amex-eu/sample.xlsx");
    expect(result.rowsImported).toBeGreaterThan(0);

    const amexAccount = db
      .select()
      .from(schema.accounts)
      .all()
      .find((a: { institution: string }) => a.institution === "amex_eu");
    const txns = db
      .select()
      .from(schema.transactions)
      .all()
      .filter((t: { accountId: string }) => t.accountId === amexAccount.id);

    const settlement = txns.find((t: { originalDescription: string }) =>
      t.originalDescription.includes("HARTELIJK BEDANKT")
    );
    expect(settlement.direction).toBe("transfer");
    expect(settlement.categoryId).toBe("cat-transfer");

    // A naive "sum everything" would wrongly include the settlement as
    // income; the household total should only ever sum non-transfer rows.
    const nonTransferTotal = txns
      .filter((t: { direction: string }) => t.direction !== "transfer")
      .reduce((sum: number, t: { eurAmount: number }) => sum + t.eurAmount, 0);
    const allRowsTotal = txns.reduce((sum: number, t: { eurAmount: number }) => sum + t.eurAmount, 0);
    expect(nonTransferTotal).not.toBe(allRowsTotal);
  });

  it("suggests ownership from the per-row cardholder name", async () => {
    const amexAccount = db
      .select()
      .from(schema.accounts)
      .all()
      .find((a: { institution: string }) => a.institution === "amex_eu");
    const txns = db
      .select()
      .from(schema.transactions)
      .all()
      .filter((t: { accountId: string }) => t.accountId === amexAccount.id);
    const coffee = txns.find((t: { originalDescription: string }) => t.originalDescription.includes("COFFEE SHOP"));
    expect(coffee.ownerMemberId).toBe("member-one");
  });
});

describe("import pipeline (undo)", () => {
  it("undoing a batch removes exactly that batch's transactions and no others", async () => {
    const batchAId = (await commitFixture("chase/sample.csv")).result.batchId;

    const chaseAccount = db
      .select()
      .from(schema.accounts)
      .all()
      .find((a: { institution: string }) => a.institution === "chase_us");
    const beforeUndo = db
      .select()
      .from(schema.transactions)
      .all()
      .filter((t: { accountId: string }) => t.accountId === chaseAccount.id);
    expect(beforeUndo.length).toBeGreaterThan(0);

    const totalBeforeUndo = db.select().from(schema.transactions).all().length;

    const outcome = undoImportBatch(batchAId);
    expect(outcome.undone).toBe(true);

    const afterUndoChase = db
      .select()
      .from(schema.transactions)
      .all()
      .filter((t: { accountId: string }) => t.accountId === chaseAccount.id);
    expect(afterUndoChase.length).toBe(0);

    const totalAfterUndo = db.select().from(schema.transactions).all().length;
    expect(totalAfterUndo).toBe(totalBeforeUndo - beforeUndo.length);

    const batch = db
      .select()
      .from(schema.importBatches)
      .all()
      .find((b: { id: string }) => b.id === batchAId);
    expect(batch.status).toBe("undone");

    // Undoing again is a safe no-op, not a second deletion.
    const second = undoImportBatch(batchAId);
    expect(second.undone).toBe(false);
  });
});
