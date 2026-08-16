/**
 * Transfer detection (src/lib/transfers/detector.ts): the core amount/date
 * gate is covered indirectly by tests/import-pipeline.integration.test.ts.
 * This file covers the Phase 4 addition — picking the most plausible
 * candidate by counterparty/household-name signal when more than one
 * transaction matches the gate.
 */
import { describe, it, expect, beforeAll } from "vitest";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any, schema: any, findPossibleTransferMatch: any;

const ACCOUNT_A = "acct-a";
const ACCOUNT_B = "acct-b";
const ACCOUNT_C = "acct-c";

beforeAll(async () => {
  const dbPath = path.join(os.tmpdir(), `carera-test-${randomUUID()}.db`);
  process.env.CARERA_DB_PATH = dbPath;

  const clientMod = await import("../src/lib/db/client");
  db = clientMod.db;
  schema = await import("../src/lib/db/schema");
  const migrator = await import("drizzle-orm/better-sqlite3/migrator");
  migrator.migrate(db, { migrationsFolder: path.join(__dirname, "../drizzle") });

  db.insert(schema.accounts)
    .values([
      { id: ACCOUNT_A, institution: "abn_amro_checking", accountType: "checking", displayName: "A", currency: "EUR", ownershipType: "shared" },
      { id: ACCOUNT_B, institution: "abn_amro_savings", accountType: "savings", displayName: "B", currency: "EUR", ownershipType: "shared" },
      { id: ACCOUNT_C, institution: "abn_amro_checking", accountType: "checking", displayName: "C", currency: "EUR", ownershipType: "shared" },
    ])
    .run();
  db.insert(schema.householdMembers).values([{ id: "member-nic", name: "Nic", initials: "N", color: "#000" }]).run();

  const detector = await import("../src/lib/transfers/detector");
  findPossibleTransferMatch = detector.findPossibleTransferMatch;
});

function insertTransaction(overrides: Record<string, unknown>) {
  const id = (overrides.id as string) ?? randomUUID();
  db.insert(schema.transactions)
    .values({
      id,
      accountId: ACCOUNT_B,
      sourceFileName: "test.csv",
      sourceRowNumber: 1,
      originalRowJson: "{}",
      transactionDate: "2026-01-10",
      merchant: null,
      originalDescription: "Test row",
      cleanedDescription: "Test row",
      originalAmount: 100,
      originalCurrency: "EUR",
      eurAmount: 100,
      direction: "credit",
      conversionStatus: "exact",
      duplicateFingerprint: randomUUID(),
      ...overrides,
    })
    .run();
  return id;
}

describe("findPossibleTransferMatch", () => {
  it("returns the single matching candidate when there's only one", () => {
    const id = insertTransaction({ accountId: ACCOUNT_B, transactionDate: "2026-02-01", originalAmount: 50, eurAmount: 50 });
    const result = findPossibleTransferMatch({ accountId: ACCOUNT_A, transactionDate: "2026-02-01", eurAmount: -50 });
    expect(result?.transactionId).toBe(id);
  });

  it("prefers the candidate whose merchant matches a household member's name over an unrelated same-amount match", () => {
    const unrelated = insertTransaction({
      accountId: ACCOUNT_B,
      transactionDate: "2026-03-01",
      originalAmount: 75,
      eurAmount: 75,
      merchant: "Some Random Shop",
      cleanedDescription: "Some Random Shop refund",
    });
    const householdMatch = insertTransaction({
      accountId: ACCOUNT_C,
      transactionDate: "2026-03-01",
      originalAmount: 75,
      eurAmount: 75,
      merchant: "Nic",
      cleanedDescription: "SEPA overboeking",
    });

    const result = findPossibleTransferMatch({ accountId: ACCOUNT_A, transactionDate: "2026-03-01", eurAmount: -75 });
    expect(result?.transactionId).toBe(householdMatch);
    expect(result?.transactionId).not.toBe(unrelated);
    expect(result?.explanation).toContain("Nic");
  });

  it("prefers a candidate with no merchant (typical of a plain self-transfer) over one with an unrelated merchant", () => {
    const unrelated = insertTransaction({
      accountId: ACCOUNT_B,
      transactionDate: "2026-04-01",
      originalAmount: 60,
      eurAmount: 60,
      merchant: "Totally Unrelated Merchant BV",
      cleanedDescription: "Totally Unrelated Merchant BV payment",
    });
    const noMerchant = insertTransaction({
      accountId: ACCOUNT_C,
      transactionDate: "2026-04-01",
      originalAmount: 60,
      eurAmount: 60,
      merchant: null,
      cleanedDescription: "SEPA Overboeking",
    });

    const result = findPossibleTransferMatch({ accountId: ACCOUNT_A, transactionDate: "2026-04-01", eurAmount: -60 });
    expect(result?.transactionId).toBe(noMerchant);
    expect(result?.transactionId).not.toBe(unrelated);
  });

  it("never returns a transaction already confirmed as a transfer", () => {
    insertTransaction({ accountId: ACCOUNT_B, transactionDate: "2026-05-01", originalAmount: 40, eurAmount: 40, transferStatus: "confirmed" });
    const result = findPossibleTransferMatch({ accountId: ACCOUNT_A, transactionDate: "2026-05-01", eurAmount: -40 });
    expect(result).toBeNull();
  });
});
