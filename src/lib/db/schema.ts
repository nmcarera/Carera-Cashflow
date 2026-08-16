/**
 * Database access layer — schema definitions (Drizzle ORM, SQLite).
 *
 * This is the single source of truth for physical storage. Every table maps
 * to a domain concept described in docs/schema.md. Application code should
 * not write raw SQL against these tables outside of src/lib/db and the
 * modules in src/lib/* that own a given concept (import, categorization,
 * currency, analytics) — see README "Architecture" section.
 *
 * Design note (documented assumption): the build brief's canonical
 * transaction model lists "Account display name" as a transaction-level
 * field. We store it normalized on the `accounts` table and expose it via
 * a join (see src/lib/domain/transaction.ts `HydratedTransaction`) rather
 * than duplicating it on every row — this avoids the display name going
 * stale on every past transaction when an account is renamed. The same is
 * true for source institution, which is derived from the account's
 * institution rather than re-stored per row (a transaction's institution
 * never differs from its account's institution).
 */

import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

const timestamps = {
  createdAt: text("created_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
};

// ---------------------------------------------------------------------------
// Household
// ---------------------------------------------------------------------------

export const householdMembers = sqliteTable("household_members", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  initials: text("initials").notNull(),
  color: text("color").notNull(),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  ...timestamps,
});

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(), // JSON-encoded
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
});

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  institution: text("institution").notNull(), // Institution enum
  accountType: text("account_type").notNull(), // AccountType enum
  displayName: text("display_name").notNull(),
  currency: text("currency").notNull(), // ISO 4217, account's native currency
  /** Masked/last-4 style identifier for display only; never the full account/card number. */
  externalIdentifierMasked: text("external_identifier_masked"),
  /** Best-effort raw external account number seen in imports, used only internally for
   *  grouping rows within a multi-account statement file. Not rendered in the UI. */
  externalAccountNumber: text("external_account_number"),
  ownershipType: text("ownership_type").notNull().default("shared"), // OwnershipType
  ownerMemberId: text("owner_member_id").references(() => householdMembers.id),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  ...timestamps,
}, (t) => ({
  externalAcctIdx: index("accounts_external_account_number_idx").on(
    t.externalAccountNumber
  ),
}));

// ---------------------------------------------------------------------------
// Categories, priorities
// ---------------------------------------------------------------------------

export const categories = sqliteTable("categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  color: text("color").notNull(),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  isSystem: integer("is_system", { mode: "boolean" }).notNull().default(false),
  ...timestamps,
}, (t) => ({
  nameIdx: uniqueIndex("categories_name_idx").on(t.name),
}));

export const priorities = sqliteTable("priorities", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  isSystem: integer("is_system", { mode: "boolean" }).notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps,
}, (t) => ({
  nameIdx: uniqueIndex("priorities_name_idx").on(t.name),
}));

// ---------------------------------------------------------------------------
// Import batches + raw row issue log
// ---------------------------------------------------------------------------

export const importBatches = sqliteTable("import_batches", {
  id: text("id").primaryKey(),
  institution: text("institution").notNull(),
  accountId: text("account_id").references(() => accounts.id),
  fileName: text("file_name").notNull(),
  fileHash: text("file_hash").notNull(),
  importedAt: text("imported_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  status: text("status").notNull().default("committed"), // ImportBatchStatus
  rowsInspected: integer("rows_inspected").notNull().default(0),
  rowsImported: integer("rows_imported").notNull().default(0),
  rowsDuplicate: integer("rows_duplicate").notNull().default(0),
  rowsTransferSuggested: integer("rows_transfer_suggested").notNull().default(0),
  rowsWarning: integer("rows_warning").notNull().default(0),
  rowsError: integer("rows_error").notNull().default(0),
  exchangeRateStatus: text("exchange_rate_status").notNull().default("n/a"), // n/a | ok | pending | failed
  undoneAt: text("undone_at"),
  undoneReason: text("undone_reason"),
  ...timestamps,
});

/** One row per inspected source row that was NOT committed as a transaction
 *  (duplicate, malformed, missing field, etc.), plus optional info-level
 *  entries (e.g. suggested transfer) surfaced for review. Committed rows
 *  live only in `transactions`, referenced back to their batch. */
export const importRowIssues = sqliteTable("import_row_issues", {
  id: text("id").primaryKey(),
  importBatchId: text("import_batch_id")
    .notNull()
    .references(() => importBatches.id),
  sourceRowNumber: integer("source_row_number").notNull(),
  issueType: text("issue_type").notNull(), // ImportRowIssueType
  message: text("message").notNull(),
  rawRowJson: text("raw_row_json").notNull(),
  relatedTransactionId: text("related_transaction_id"),
  ...timestamps,
}, (t) => ({
  batchIdx: index("import_row_issues_batch_idx").on(t.importBatchId),
}));

// ---------------------------------------------------------------------------
// Categorization rules
// ---------------------------------------------------------------------------

export const rules = sqliteTable("rules", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  /** Lower number = higher precedence, evaluated in ascending order. When two
   *  active rules share the same precedence and would produce the SAME
   *  outcome for a transaction, order between them doesn't matter. When they
   *  share the same precedence and would produce DIFFERENT outcomes, that is
   *  a genuine conflict — see src/lib/categorization/rules.ts
   *  `findApplicableRule` — and the transaction is flagged `conflicting_rules`
   *  for review rather than silently picking one. Precedence is the
   *  household's explicit way to resolve that ahead of time. */
  precedence: integer("precedence").notNull().default(100),

  // Match conditions — all provided conditions must match (AND). At least one must be set.
  matchMerchantContains: text("match_merchant_contains"),
  matchDescriptionContains: text("match_description_contains"),
  matchInstitution: text("match_institution"),
  matchAccountId: text("match_account_id").references(() => accounts.id),
  matchAmountMin: real("match_amount_min"),
  matchAmountMax: real("match_amount_max"),
  matchDirection: text("match_direction"),

  // Effects — any subset may be set.
  setCategoryId: text("set_category_id").references(() => categories.id),
  setPriorityId: text("set_priority_id").references(() => priorities.id),
  setOwnershipType: text("set_ownership_type"),
  setOwnerMemberId: text("set_owner_member_id").references(() => householdMembers.id),

  ...timestamps,
}, (t) => ({
  precedenceIdx: index("rules_precedence_idx").on(t.precedence),
}));

// ---------------------------------------------------------------------------
// Savings goals
// ---------------------------------------------------------------------------

export const savingsGoals = sqliteTable("savings_goals", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  linkedAccountId: text("linked_account_id")
    .notNull()
    .references(() => accounts.id),
  targetBalanceEur: real("target_balance_eur").notNull(),
  targetDate: text("target_date"),
  /** Used only when the linked account's statement history doesn't cover its full
   *  balance history (e.g. account existed before first import). */
  startingBalanceEur: real("starting_balance_eur"),
  startingBalanceAsOf: text("starting_balance_as_of"),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  ...timestamps,
}, (t) => ({
  // One active goal per linked account for the MVP (see build brief §9) — the schema
  // does not prevent multiple goals from existing, only from targeting the same
  // account while both are active, so a future version can lift this safely.
  linkedAccountIdx: uniqueIndex("savings_goals_linked_account_active_idx").on(
    t.linkedAccountId
  ),
}));

// ---------------------------------------------------------------------------
// Exchange rate cache
// ---------------------------------------------------------------------------

export const exchangeRates = sqliteTable("exchange_rates", {
  id: text("id").primaryKey(),
  baseCurrency: text("base_currency").notNull(),
  quoteCurrency: text("quote_currency").notNull().default("EUR"),
  date: text("date").notNull(), // YYYY-MM-DD, the rate's actual date
  rate: real("rate").notNull(),
  source: text("source").notNull(),
  /** True if `date` is the exact requested date; false if this is a nearest-available fallback. */
  isExactDate: integer("is_exact_date", { mode: "boolean" }).notNull(),
  fetchedAt: text("fetched_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
}, (t) => ({
  lookupIdx: uniqueIndex("exchange_rates_lookup_idx").on(
    t.baseCurrency,
    t.quoteCurrency,
    t.date
  ),
}));

// ---------------------------------------------------------------------------
// Transactions — the canonical table
// ---------------------------------------------------------------------------

export const transactions = sqliteTable("transactions", {
  id: text("id").primaryKey(),

  importBatchId: text("import_batch_id").references(() => importBatches.id),
  accountId: text("account_id")
    .notNull()
    .references(() => accounts.id),

  sourceFileName: text("source_file_name").notNull(),
  sourceRowNumber: integer("source_row_number").notNull(),
  originalRowJson: text("original_row_json").notNull(),

  transactionDate: text("transaction_date").notNull(), // YYYY-MM-DD
  postingDate: text("posting_date"), // YYYY-MM-DD

  merchant: text("merchant"),
  originalDescription: text("original_description").notNull(),
  cleanedDescription: text("cleaned_description").notNull(),

  originalAmount: real("original_amount").notNull(), // signed, in originalCurrency
  originalCurrency: text("original_currency").notNull(),

  eurAmount: real("eur_amount"), // null while conversionStatus = 'pending'
  exchangeRate: real("exchange_rate"),
  exchangeRateDate: text("exchange_rate_date"),
  exchangeRateSource: text("exchange_rate_source"),
  conversionStatus: text("conversion_status").notNull().default("exact"), // ConversionStatus

  direction: text("direction").notNull(), // TransactionDirection

  categoryId: text("category_id").references(() => categories.id),
  priorityId: text("priority_id").references(() => priorities.id),

  ownershipType: text("ownership_type").notNull().default("unassigned"), // OwnershipType
  ownerMemberId: text("owner_member_id").references(() => householdMembers.id),

  reviewStatus: text("review_status").notNull().default("ok"), // ReviewStatus
  /** JSON array of ReviewReason */
  reviewReasonsJson: text("review_reasons_json").notNull().default("[]"),
  confidenceReason: text("confidence_reason"),
  appliedRuleId: text("applied_rule_id").references(() => rules.id),

  duplicateFingerprint: text("duplicate_fingerprint").notNull(),

  possibleTransferId: text("possible_transfer_id"),
  transferStatus: text("transfer_status").notNull().default("none"), // TransferStatus

  notes: text("notes"),

  ...timestamps,
}, (t) => ({
  accountIdx: index("transactions_account_idx").on(t.accountId),
  dateIdx: index("transactions_date_idx").on(t.transactionDate),
  fingerprintIdx: index("transactions_fingerprint_idx").on(
    t.duplicateFingerprint
  ),
  batchIdx: index("transactions_batch_idx").on(t.importBatchId),
  reviewIdx: index("transactions_review_idx").on(t.reviewStatus),
  categoryIdx: index("transactions_category_idx").on(t.categoryId),
}));

// ---------------------------------------------------------------------------
// Audit log — every change to a classified/edited field
// ---------------------------------------------------------------------------

export const auditLog = sqliteTable("audit_log", {
  id: text("id").primaryKey(),
  entityType: text("entity_type").notNull(), // e.g. 'transaction', 'category', 'rule'
  entityId: text("entity_id").notNull(),
  field: text("field").notNull(),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  changeSource: text("change_source").notNull(), // ChangeSource
  ruleId: text("rule_id").references(() => rules.id),
  note: text("note"),
  timestamp: text("timestamp")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
}, (t) => ({
  entityIdx: index("audit_log_entity_idx").on(t.entityType, t.entityId),
}));

// ---------------------------------------------------------------------------
// Structured error/diagnostic log
// ---------------------------------------------------------------------------

export const errorLog = sqliteTable("error_log", {
  id: text("id").primaryKey(),
  timestamp: text("timestamp")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  severity: text("severity").notNull(), // info | warning | error
  errorCode: text("error_code").notNull(),
  category: text("category").notNull(), // ErrorCategory
  operation: text("operation").notNull(),
  contextJson: text("context_json").notNull().default("{}"),
  message: text("message").notNull(),
  stack: text("stack"),
  rootCause: text("root_cause"),
}, (t) => ({
  codeIdx: index("error_log_code_idx").on(t.errorCode),
  tsIdx: index("error_log_timestamp_idx").on(t.timestamp),
}));
