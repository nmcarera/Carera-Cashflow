/**
 * Database access layer — read queries used by UI pages.
 *
 * This is the boundary Next.js server components should go through instead
 * of importing `db`/`schema` directly, so that joins and shaping live in one
 * place (see schema.ts's note on why display fields are joined, not
 * duplicated).
 */
import { eq, desc, inArray, ne } from "drizzle-orm";
import { db } from "./client";
import {
  transactions,
  accounts,
  categories,
  priorities,
  householdMembers,
  importBatches,
  importRowIssues,
  rules,
} from "./schema";
import type { RuleMatchInput } from "../categorization/rules";

export interface HydratedTransaction {
  id: string;
  transactionDate: string;
  postingDate: string | null;
  merchant: string | null;
  cleanedDescription: string;
  originalDescription: string;
  originalAmount: number;
  originalCurrency: string;
  eurAmount: number | null;
  conversionStatus: string;
  direction: string;
  accountId: string;
  accountName: string;
  institution: string;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  priorityId: string | null;
  priorityName: string | null;
  ownershipType: string;
  ownerName: string | null;
  reviewStatus: string;
  reviewReasons: string[];
  transferStatus: string;
  notes: string | null;
}

/** Fetches transactions with all display joins resolved, most recent first.
 *  Intended for the transaction table; heavier analytics use dedicated
 *  queries in src/lib/analytics so this stays fast and simple. */
export function listHydratedTransactions(limit = 500): HydratedTransaction[] {
  const rows = db
    .select({
      id: transactions.id,
      transactionDate: transactions.transactionDate,
      postingDate: transactions.postingDate,
      merchant: transactions.merchant,
      cleanedDescription: transactions.cleanedDescription,
      originalDescription: transactions.originalDescription,
      originalAmount: transactions.originalAmount,
      originalCurrency: transactions.originalCurrency,
      eurAmount: transactions.eurAmount,
      conversionStatus: transactions.conversionStatus,
      direction: transactions.direction,
      accountId: transactions.accountId,
      accountName: accounts.displayName,
      institution: accounts.institution,
      categoryId: transactions.categoryId,
      categoryName: categories.name,
      categoryColor: categories.color,
      priorityId: transactions.priorityId,
      priorityName: priorities.name,
      ownershipType: transactions.ownershipType,
      ownerName: householdMembers.name,
      reviewStatus: transactions.reviewStatus,
      reviewReasonsJson: transactions.reviewReasonsJson,
      transferStatus: transactions.transferStatus,
      notes: transactions.notes,
    })
    .from(transactions)
    .leftJoin(accounts, eq(transactions.accountId, accounts.id))
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .leftJoin(priorities, eq(transactions.priorityId, priorities.id))
    .leftJoin(householdMembers, eq(transactions.ownerMemberId, householdMembers.id))
    .orderBy(desc(transactions.transactionDate))
    .limit(limit)
    .all();

  return rows.map((r) => ({
    ...r,
    accountName: r.accountName ?? "Unknown account",
    institution: r.institution ?? "unknown",
    reviewReasons: JSON.parse(r.reviewReasonsJson) as string[],
  }));
}

export function listAccounts() {
  return db.select().from(accounts).all();
}

export function listCategories() {
  return db.select().from(categories).orderBy(categories.name).all();
}

export function listActiveCategories() {
  return db.select().from(categories).where(eq(categories.archived, false)).orderBy(categories.name).all();
}

export function listPriorities() {
  return db.select().from(priorities).orderBy(priorities.sortOrder).all();
}

export function listActivePriorities() {
  return db
    .select()
    .from(priorities)
    .where(eq(priorities.archived, false))
    .orderBy(priorities.sortOrder)
    .all();
}

export function listHouseholdMembers() {
  return db.select().from(householdMembers).orderBy(householdMembers.name).all();
}

export function listActiveHouseholdMembers() {
  return db
    .select()
    .from(householdMembers)
    .where(eq(householdMembers.archived, false))
    .orderBy(householdMembers.name)
    .all();
}

/** How many transactions currently reference each category — used by the
 *  settings screen to warn before archiving ("used by 42 transactions")
 *  rather than silently orphaning them. */
export function categoryUsageCounts(): Map<string, number> {
  const rows = db.select({ categoryId: transactions.categoryId }).from(transactions).all();
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!r.categoryId) continue;
    counts.set(r.categoryId, (counts.get(r.categoryId) ?? 0) + 1);
  }
  return counts;
}

export function priorityUsageCounts(): Map<string, number> {
  const rows = db.select({ priorityId: transactions.priorityId }).from(transactions).all();
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!r.priorityId) continue;
    counts.set(r.priorityId, (counts.get(r.priorityId) ?? 0) + 1);
  }
  return counts;
}

export function householdMemberUsageCounts(): Map<string, number> {
  const rows = db.select({ ownerMemberId: transactions.ownerMemberId }).from(transactions).all();
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!r.ownerMemberId) continue;
    counts.set(r.ownerMemberId, (counts.get(r.ownerMemberId) ?? 0) + 1);
  }
  return counts;
}

export function listRules() {
  return db.select().from(rules).orderBy(rules.precedence, rules.createdAt).all();
}

export function getRule(id: string) {
  return db.select().from(rules).where(eq(rules.id, id)).all()[0] ?? null;
}

/** How many transactions currently carry a given `appliedRuleId` — shown
 *  next to each rule in the management screen. */
export function ruleAppliedCounts(): Map<string, number> {
  const rows = db.select({ appliedRuleId: transactions.appliedRuleId }).from(transactions).all();
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!r.appliedRuleId) continue;
    counts.set(r.appliedRuleId, (counts.get(r.appliedRuleId) ?? 0) + 1);
  }
  return counts;
}

/** Every non-confident-transfer transaction, shaped as `RuleMatchInput` plus
 *  its id, for the rule-management "affects N transactions" preview and for
 *  "apply rule historically." Confident transfers (direction `transfer`,
 *  identified from explicit statement text) are excluded — rules never
 *  override those, matching the import-time behavior in importPipeline.ts. */
export function listRuleMatchCandidates(): Array<RuleMatchInput & { id: string }> {
  const rows = db
    .select({
      id: transactions.id,
      merchant: transactions.merchant,
      cleanedDescription: transactions.cleanedDescription,
      originalDescription: transactions.originalDescription,
      institution: accounts.institution,
      accountId: transactions.accountId,
      originalAmount: transactions.originalAmount,
      direction: transactions.direction,
    })
    .from(transactions)
    .leftJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(ne(transactions.direction, "transfer"))
    .all();
  return rows.map((r) => ({ ...r, institution: r.institution ?? "unknown" }));
}

export function listReviewQueue(limit = 500): HydratedTransaction[] {
  return listHydratedTransactions(limit).filter((t) => t.reviewStatus === "needs_review");
}

export function countByReviewStatus() {
  const rows = db
    .select({ reviewStatus: transactions.reviewStatus })
    .from(transactions)
    .all();
  return rows.filter((r) => r.reviewStatus === "needs_review").length;
}

export function transactionsForIds(ids: string[]) {
  if (ids.length === 0) return [];
  return db.select().from(transactions).where(inArray(transactions.id, ids)).all();
}

/** IDs of every transaction in the same import batch as `transactionId`
 *  that shares its merchant (falling back to its cleaned description when
 *  there's no merchant) — the "apply to matching transactions in this
 *  import" option in the correction workflow. Always includes the
 *  reference transaction itself. Matching is case-insensitive; done in JS
 *  rather than SQL `lower()` since a single import batch is at most a few
 *  hundred rows. */
export function listImportBatchSiblingsByMerchant(transactionId: string): string[] {
  const ref = db.select().from(transactions).where(eq(transactions.id, transactionId)).all()[0];
  if (!ref) return [];
  if (!ref.importBatchId) return [ref.id];
  const batchRows = db
    .select({ id: transactions.id, merchant: transactions.merchant, cleanedDescription: transactions.cleanedDescription })
    .from(transactions)
    .where(eq(transactions.importBatchId, ref.importBatchId))
    .all();
  const key = (ref.merchant ?? ref.cleanedDescription).trim().toLowerCase();
  return batchRows
    .filter((r) => (r.merchant ?? r.cleanedDescription).trim().toLowerCase() === key)
    .map((r) => r.id);
}

export interface ImportBatchListItem {
  id: string;
  institution: string;
  accountName: string | null;
  fileName: string;
  importedAt: string;
  status: string;
  rowsInspected: number;
  rowsImported: number;
  rowsDuplicate: number;
  rowsTransferSuggested: number;
  rowsWarning: number;
  rowsError: number;
  exchangeRateStatus: string;
  undoneAt: string | null;
}

export function listImportBatches(): ImportBatchListItem[] {
  const rows = db
    .select({
      id: importBatches.id,
      institution: importBatches.institution,
      accountName: accounts.displayName,
      fileName: importBatches.fileName,
      importedAt: importBatches.importedAt,
      status: importBatches.status,
      rowsInspected: importBatches.rowsInspected,
      rowsImported: importBatches.rowsImported,
      rowsDuplicate: importBatches.rowsDuplicate,
      rowsTransferSuggested: importBatches.rowsTransferSuggested,
      rowsWarning: importBatches.rowsWarning,
      rowsError: importBatches.rowsError,
      exchangeRateStatus: importBatches.exchangeRateStatus,
      undoneAt: importBatches.undoneAt,
    })
    .from(importBatches)
    .leftJoin(accounts, eq(importBatches.accountId, accounts.id))
    .orderBy(desc(importBatches.importedAt))
    .all();
  return rows;
}

export function getImportBatch(batchId: string) {
  return db.select().from(importBatches).where(eq(importBatches.id, batchId)).all()[0] ?? null;
}

export function listImportRowIssues(batchId: string) {
  return db
    .select()
    .from(importRowIssues)
    .where(eq(importRowIssues.importBatchId, batchId))
    .all();
}

export function listImportedTransactionsForBatch(batchId: string): HydratedTransaction[] {
  const rows = db
    .select({
      id: transactions.id,
      transactionDate: transactions.transactionDate,
      postingDate: transactions.postingDate,
      merchant: transactions.merchant,
      cleanedDescription: transactions.cleanedDescription,
      originalDescription: transactions.originalDescription,
      originalAmount: transactions.originalAmount,
      originalCurrency: transactions.originalCurrency,
      eurAmount: transactions.eurAmount,
      conversionStatus: transactions.conversionStatus,
      direction: transactions.direction,
      accountId: transactions.accountId,
      accountName: accounts.displayName,
      institution: accounts.institution,
      categoryId: transactions.categoryId,
      categoryName: categories.name,
      categoryColor: categories.color,
      priorityId: transactions.priorityId,
      priorityName: priorities.name,
      ownershipType: transactions.ownershipType,
      ownerName: householdMembers.name,
      reviewStatus: transactions.reviewStatus,
      reviewReasonsJson: transactions.reviewReasonsJson,
      transferStatus: transactions.transferStatus,
      notes: transactions.notes,
    })
    .from(transactions)
    .leftJoin(accounts, eq(transactions.accountId, accounts.id))
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .leftJoin(priorities, eq(transactions.priorityId, priorities.id))
    .leftJoin(householdMembers, eq(transactions.ownerMemberId, householdMembers.id))
    .where(eq(transactions.importBatchId, batchId))
    .orderBy(desc(transactions.transactionDate))
    .all();

  return rows.map((r) => ({
    ...r,
    accountName: r.accountName ?? "Unknown account",
    institution: r.institution ?? "unknown",
    reviewReasons: JSON.parse(r.reviewReasonsJson) as string[],
  }));
}
