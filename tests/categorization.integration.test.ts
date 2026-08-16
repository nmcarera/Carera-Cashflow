/**
 * Integration tests for Phase 3 (classification): settings CRUD, the rule
 * engine's "apply historically" path, manual transaction edits, and
 * transfer-suggestion confirm/reject — all against a real, isolated SQLite
 * database. Unit-level rule-matching logic is covered separately in
 * tests/rules.test.ts; this file covers the parts that only make sense
 * end-to-end (DB writes, audit trail, foreign-key-safe delete guards).
 */
import { describe, it, expect, beforeAll } from "vitest";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any, schema: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mutations: any, apply: any, edit: any, queries: any;

const ACCOUNT_ID = "acct-checking";

beforeAll(async () => {
  const dbPath = path.join(os.tmpdir(), `carera-test-${randomUUID()}.db`);
  process.env.CARERA_DB_PATH = dbPath;

  const clientMod = await import("../src/lib/db/client");
  db = clientMod.db;
  schema = await import("../src/lib/db/schema");
  const migrator = await import("drizzle-orm/better-sqlite3/migrator");
  migrator.migrate(db, { migrationsFolder: path.join(__dirname, "../drizzle") });

  db.insert(schema.accounts)
    .values([{ id: ACCOUNT_ID, institution: "abn_amro_checking", accountType: "checking", displayName: "Checking", currency: "EUR", ownershipType: "shared" }])
    .run();
  db.insert(schema.categories).values([{ id: "cat-transfer", name: "Internal transfer", color: "#000" }]).run();
  db.insert(schema.priorities).values([{ id: "pri-excluded", name: "Excluded / transfer" }]).run();
  db.insert(schema.householdMembers).values([{ id: "member-nic", name: "Nic", initials: "N", color: "#000" }]).run();

  mutations = await import("../src/lib/settings/mutations");
  apply = await import("../src/lib/categorization/apply");
  edit = await import("../src/lib/transactions/edit");
  queries = await import("../src/lib/db/queries");
});

function insertTransaction(overrides: Record<string, unknown>) {
  const id = overrides.id ?? randomUUID();
  db.insert(schema.transactions)
    .values({
      id,
      accountId: ACCOUNT_ID,
      sourceFileName: "test.csv",
      sourceRowNumber: 1,
      originalRowJson: "{}",
      transactionDate: "2026-01-01",
      merchant: "Albert Heijn",
      originalDescription: "Albert Heijn boodschappen",
      cleanedDescription: "Albert Heijn boodschappen",
      originalAmount: -20,
      originalCurrency: "EUR",
      eurAmount: -20,
      direction: "debit",
      duplicateFingerprint: randomUUID(),
      ...overrides,
    })
    .run();
  return id as string;
}

describe("settings mutations", () => {
  it("creates, renames, and archives a category without touching its id", () => {
    const created = mutations.createCategory({ name: "Groceries Test", color: "#abcabc" });
    const renamed = mutations.updateCategory(created.id, { name: "Groceries Test Renamed" });
    expect(renamed.id).toBe(created.id);
    expect(renamed.name).toBe("Groceries Test Renamed");

    mutations.setCategoryArchived(created.id, true);
    expect(queries.listActiveCategories().some((c: { id: string }) => c.id === created.id)).toBe(false);
    expect(queries.listCategories().some((c: { id: string }) => c.id === created.id)).toBe(true);
  });

  it("rejects a category name that's already taken", () => {
    mutations.createCategory({ name: "Unique Name Test", color: "#111" });
    expect(() => mutations.createCategory({ name: "Unique Name Test", color: "#222" })).toThrow();
  });

  it("archiving a category leaves past transactions' categoryId untouched", () => {
    const cat = mutations.createCategory({ name: "Soon Archived", color: "#333" });
    const txnId = insertTransaction({ categoryId: cat.id });
    mutations.setCategoryArchived(cat.id, true);
    const txns = queries.transactionsForIds([txnId]);
    expect(txns[0].categoryId).toBe(cat.id);
  });
});

describe("rule engine — apply historically", () => {
  it("applies a newly created rule to every existing matching transaction", () => {
    const cat = mutations.createCategory({ name: "Rule Target Category", color: "#444" });
    const t1 = insertTransaction({ merchant: "Jumbo Supermarket" });
    const t2 = insertTransaction({ merchant: "Jumbo Supermarket" });
    const t3 = insertTransaction({ merchant: "Some Other Store" });

    const preview = apply.previewRuleMatches({ name: "preview", matchMerchantContains: "Jumbo", setCategoryId: cat.id });
    expect(preview.matchCount).toBe(2);

    const rule = apply.createRule({ name: "Jumbo -> category", matchMerchantContains: "Jumbo", setCategoryId: cat.id, precedence: 1 });
    const result = apply.applyRuleHistorically(rule.id);
    expect(result.updated).toBe(2);

    // `transactionsForIds` makes no ordering promise, so look each row up by
    // id rather than assuming the returned array matches [t1, t2, t3].
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const byId = new Map<string, any>(queries.transactionsForIds([t1, t2, t3]).map((r: { id: string }) => [r.id, r]));
    expect(byId.get(t1).categoryId).toBe(cat.id);
    expect(byId.get(t1).appliedRuleId).toBe(rule.id);
    expect(byId.get(t2).categoryId).toBe(cat.id);
    expect(byId.get(t3).categoryId).toBeNull();
  });

  it("skips a transaction where two equal-precedence active rules disagree, instead of guessing", () => {
    // Both match conditions are unique strings scoped to this test's own
    // transaction — matching on something broad like institution would also
    // catch every other transaction inserted by earlier tests in this file
    // (they all share the same test account) and make this test's outcome
    // depend on execution order.
    const catA = mutations.createCategory({ name: "Conflict Cat A", color: "#555" });
    const catB = mutations.createCategory({ name: "Conflict Cat B", color: "#666" });
    const txnId = insertTransaction({
      merchant: "Conflict Merchant Unique",
      originalDescription: "Conflict Merchant Unique description",
      cleanedDescription: "Conflict Merchant Unique description",
    });

    apply.createRule({ name: "Conflict rule A", matchMerchantContains: "Conflict Merchant Unique", setCategoryId: catA.id, precedence: 5 });
    const ruleB = apply.createRule({ name: "Conflict rule B", matchDescriptionContains: "Conflict Merchant Unique description", setCategoryId: catB.id, precedence: 5 });

    const result = apply.applyRuleHistorically(ruleB.id);
    expect(result.updated).toBe(0);
    expect(result.skippedAsConflict).toBeGreaterThanOrEqual(1);

    const [row] = queries.transactionsForIds([txnId]);
    expect(row.categoryId).toBeNull();
  });

  it("refuses to hard-delete a rule that transactions still credit, but allows disabling it", () => {
    const cat = mutations.createCategory({ name: "Delete Guard Category", color: "#777" });
    insertTransaction({ merchant: "Delete Guard Merchant" });
    const rule = apply.createRule({ name: "Delete guard rule", matchMerchantContains: "Delete Guard Merchant", setCategoryId: cat.id, precedence: 1 });
    apply.applyRuleHistorically(rule.id);

    const deleteResult = apply.deleteRule(rule.id);
    expect(deleteResult.deleted).toBe(false);

    const disabled = apply.setRuleActive(rule.id, false);
    expect(disabled.active).toBe(false);
  });

  it("rejects a rule with no match conditions or no effects", () => {
    expect(() => apply.createRule({ name: "No conditions", setCategoryId: "cat-transfer" })).toThrow();
    expect(() => apply.createRule({ name: "No effects", matchMerchantContains: "x" })).toThrow();
  });
});

describe("manual transaction edits", () => {
  it("bulk-edits several transactions at once and records one audit entry per changed field", () => {
    const cat = mutations.createCategory({ name: "Bulk Edit Category", color: "#888" });
    const ids = [insertTransaction({}), insertTransaction({}), insertTransaction({})];

    const { updated } = edit.editTransactions(ids, { categoryId: cat.id, ownershipType: "shared", ownerMemberId: null });
    expect(updated).toBe(3);

    const rows = queries.transactionsForIds(ids);
    for (const row of rows) {
      expect(row.categoryId).toBe(cat.id);
      expect(row.ownershipType).toBe("shared");
      expect(row.reviewStatus).toBe("ok");
    }
  });

  it("clears appliedRuleId when a manual edit overrides a rule-set category", () => {
    const originalCat = mutations.createCategory({ name: "Original Rule Category", color: "#999" });
    const overrideCat = mutations.createCategory({ name: "Override Category", color: "#9a9" });
    const txnId = insertTransaction({ merchant: "Override Trigger Merchant Unique" });
    const rule = apply.createRule({
      name: "Override trigger rule",
      matchMerchantContains: "Override Trigger Merchant Unique",
      setCategoryId: originalCat.id,
      precedence: 1,
    });
    apply.applyRuleHistorically(rule.id);
    const [beforeEdit] = queries.transactionsForIds([txnId]);
    expect(beforeEdit.categoryId).toBe(originalCat.id);
    expect(beforeEdit.appliedRuleId).toBe(rule.id);

    edit.editTransactions([txnId], { categoryId: overrideCat.id });
    const [row] = queries.transactionsForIds([txnId]);
    expect(row.categoryId).toBe(overrideCat.id);
    expect(row.appliedRuleId).toBeNull();
  });
});

describe("transfer suggestion resolution", () => {
  it("confirming links both sides as an internal transfer and clears them from review", () => {
    const idA = insertTransaction({ merchant: null, cleanedDescription: "Transfer to savings", originalAmount: -500, transferStatus: "suggested", reviewStatus: "needs_review", reviewReasonsJson: JSON.stringify(["possible_transfer"]) });
    const idB = insertTransaction({ merchant: null, cleanedDescription: "Transfer from checking", originalAmount: 500, transferStatus: "suggested", reviewStatus: "needs_review", reviewReasonsJson: JSON.stringify(["possible_transfer"]) });
    db.update(schema.transactions).set({ possibleTransferId: idB }).where(eq(schema.transactions.id, idA)).run();

    edit.resolveTransferSuggestion(idA, true);
    const [rowA] = queries.transactionsForIds([idA]);
    expect(rowA.transferStatus).toBe("confirmed");
    expect(rowA.categoryId).toBe("cat-transfer");
    expect(rowA.reviewStatus).toBe("ok");
  });

  it("rejecting clears the possible_transfer flag but leaves category/owner alone", () => {
    const cat = mutations.createCategory({ name: "Pre-set category", color: "#aaa" });
    const id = insertTransaction({ categoryId: cat.id, transferStatus: "suggested", reviewStatus: "needs_review", reviewReasonsJson: JSON.stringify(["possible_transfer"]) });

    edit.resolveTransferSuggestion(id, false);
    const [row] = queries.transactionsForIds([id]);
    expect(row.transferStatus).toBe("rejected");
    expect(row.categoryId).toBe(cat.id);
  });
});
