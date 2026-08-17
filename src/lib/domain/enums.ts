/**
 * Shared enum-like constants for the canonical transaction model.
 *
 * These are plain string unions (not DB enums) so that new values
 * (e.g. a new institution, a new review status) can be added without a
 * schema migration. Validity is enforced at the Zod layer, not the DB layer.
 */

export const INSTITUTIONS = [
  "abn_amro_checking",
  "abn_amro_savings",
  "amex_eu",
  "chase_us",
  "manual",
  "unknown",
] as const;
export type Institution = (typeof INSTITUTIONS)[number];

export const ACCOUNT_TYPES = [
  "checking",
  "savings",
  "credit_card",
  "other",
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const TRANSACTION_DIRECTIONS = ["debit", "credit", "transfer"] as const;
export type TransactionDirection = (typeof TRANSACTION_DIRECTIONS)[number];

/** Whether a EUR amount is exact (provided/derived from a known rate) or estimated (fallback rate). */
export const CONVERSION_STATUSES = ["exact", "estimated", "pending"] as const;
export type ConversionStatus = (typeof CONVERSION_STATUSES)[number];

export const REVIEW_STATUSES = ["ok", "needs_review"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** Why a transaction needs review — used to render an explanation, never a bare flag. */
export const REVIEW_REASONS = [
  "no_category",
  "no_owner",
  "uncertain_priority",
  "possible_duplicate",
  "possible_transfer",
  "missing_conversion",
  "conflicting_rules",
  "parsing_warning",
  "unusually_large",
] as const;
export type ReviewReason = (typeof REVIEW_REASONS)[number];

export const TRANSFER_STATUSES = [
  "none",
  "suggested",
  "confirmed",
  "rejected",
] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

export const OWNERSHIP_TYPES = ["person", "shared", "unassigned"] as const;
export type OwnershipType = (typeof OWNERSHIP_TYPES)[number];

/** Default spending priorities. Editable/extendable by the household; these are the seeded starting set. */
export const DEFAULT_PRIORITIES = [
  "Essential",
  "Flexible",
  "Discretionary",
  "Savings",
  "Excluded / transfer",
  "Unclassified",
] as const;

/** Default categories, seeded on first run. Fully editable afterward. */
export const DEFAULT_CATEGORIES = [
  "Housing",
  "Utilities",
  "Groceries",
  "Dining and takeaway",
  "Transportation",
  "Healthcare",
  "Insurance",
  "Subscriptions",
  "Shopping",
  "Entertainment",
  "Travel",
  "Gifts",
  "Taxes",
  "Salary",
  "Other income",
  "Savings contribution",
  "Internal transfer",
  "Uncategorized",
] as const;

export const IMPORT_BATCH_STATUSES = ["committed", "undone"] as const;
export type ImportBatchStatus = (typeof IMPORT_BATCH_STATUSES)[number];

export const IMPORT_ROW_ISSUE_TYPES = [
  "duplicate",
  "malformed",
  "missing_field",
  "uncertain_currency",
  "possible_transfer",
  "quarantined_other",
] as const;
export type ImportRowIssueType = (typeof IMPORT_ROW_ISSUE_TYPES)[number];

export const CHANGE_SOURCES = [
  "imported",
  "rule",
  "manual",
  "system",
] as const;
export type ChangeSource = (typeof CHANGE_SOURCES)[number];

export const RULE_MATCH_FIELDS = [
  "merchant_contains",
  "description_contains",
  "institution",
  "account",
  "amount_range",
  "direction",
] as const;

export const ERROR_CATEGORIES = [
  "file_access",
  "csv_parsing",
  "schema_validation",
  "institution_format_mismatch",
  "invalid_date",
  "invalid_amount",
  "missing_currency",
  "duplicate_detection",
  "database",
  "exchange_rate_service",
  "rule_conflict",
  "rendering",
] as const;
export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];
