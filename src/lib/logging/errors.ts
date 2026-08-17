/**
 * Stable, searchable error codes and the structured application error type.
 *
 * Every error surfaced to a user or written to the diagnostics log carries
 * one of these codes. Codes are grep-able (`grep -r "IMPORT_004"`), stable
 * across releases, and grouped by the ErrorCategory taxonomy from the build
 * brief §13. Add new codes here — do not invent ad hoc strings elsewhere.
 */
import type { ErrorCategory } from "../domain/enums";

export const ERROR_CODES = {
  // File access
  FILE_001_NOT_FOUND: "The file could not be found or opened.",
  FILE_002_TOO_LARGE: "The file exceeds the maximum allowed size.",
  FILE_003_TOO_MANY_ROWS: "The file exceeds the maximum allowed row count.",
  FILE_004_EMPTY: "The file has no data rows.",

  // CSV / spreadsheet parsing
  CSV_001_UNREADABLE: "The file could not be parsed as CSV or Excel.",
  CSV_002_INCONSISTENT_COLUMNS: "Rows do not have a consistent number of columns.",

  // Schema validation
  SCHEMA_001_ROW_INVALID: "A row did not match the expected transaction shape.",

  // Institution format mismatch
  INSTITUTION_001_UNRECOGNIZED_FORMAT:
    "This file's structure does not match any known institution format.",
  INSTITUTION_002_COLUMN_NOT_FOUND:
    "A required column could not be identified in this file.",
  INSTITUTION_003_MULTIPLE_ACCOUNTS_UNRESOLVED:
    "The file contains rows for more than one account and account mapping is incomplete.",

  // Dates
  DATE_001_INVALID: "A transaction date could not be parsed.",
  DATE_002_AMBIGUOUS_FORMAT: "A date's format (DD/MM vs MM/DD) could not be determined confidently.",

  // Monetary values
  AMOUNT_001_INVALID_NUMBER: "An amount value is not a valid number.",
  AMOUNT_002_ZERO: "An amount is zero, which is not a valid transaction amount.",

  // Currency
  CURRENCY_001_MISSING: "No currency could be determined for this row.",
  CURRENCY_002_UNRECOGNIZED: "The currency code is not a recognized ISO 4217 code.",

  // Duplicate detection
  DUPLICATE_001_DETECTED: "This row matches an existing transaction and was skipped.",

  // Database
  DB_001_WRITE_FAILED: "A database write failed.",
  DB_002_CONSTRAINT_VIOLATION: "A database constraint was violated.",
  DB_003_TRANSACTION_ROLLED_BACK: "The database transaction was rolled back; no partial data was saved.",

  // Exchange rate service
  FX_001_PROVIDER_UNAVAILABLE: "The exchange-rate provider is unavailable.",
  FX_002_NO_RATE_FOUND: "No exchange rate could be found for the requested date.",
  FX_003_TIMEOUT: "The exchange-rate request timed out.",

  // Rules
  RULE_001_CONFLICT: "Multiple rules matched this transaction with equal precedence.",
  RULE_002_INVALID: "A rule needs at least one match condition and at least one effect.",
  RULE_003_IN_USE_CANNOT_DELETE:
    "This rule is still recorded on past transactions and can't be permanently deleted.",

  // Settings (categories, priorities, household members)
  SETTINGS_001_NAME_TAKEN: "That name is already in use.",
  SETTINGS_002_NAME_REQUIRED: "A name is required.",

  // Rendering / unexpected
  APP_001_UNEXPECTED: "An unexpected application error occurred.",
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export interface ErrorContext {
  importBatchId?: string;
  fileName?: string;
  institution?: string;
  accountId?: string;
  sourceRowNumber?: number;
  transactionId?: string;
  ruleId?: string;
  exchangeRateDate?: string;
  baseCurrency?: string;
  quoteCurrency?: string;
  [key: string]: string | number | undefined;
}

export class CareraError extends Error {
  readonly code: ErrorCode;
  readonly category: ErrorCategory;
  readonly context: ErrorContext;
  /** Whether the caller (or the user) can safely retry the operation. */
  readonly retryable: boolean;
  /** What, if anything, was already saved before this error occurred. */
  readonly whatWasSaved: string;

  constructor(opts: {
    code: ErrorCode;
    category: ErrorCategory;
    context?: ErrorContext;
    retryable?: boolean;
    whatWasSaved?: string;
    detail?: string;
    cause?: unknown;
  }) {
    const base = ERROR_CODES[opts.code];
    super(opts.detail ? `${base} ${opts.detail}` : base, { cause: opts.cause });
    this.name = "CareraError";
    this.code = opts.code;
    this.category = opts.category;
    this.context = opts.context ?? {};
    this.retryable = opts.retryable ?? false;
    this.whatWasSaved = opts.whatWasSaved ?? "Nothing from this operation was saved.";
  }

  /** User-facing message: what happened, what was/wasn't saved, what to do next. */
  toUserMessage(): string {
    const parts = [this.message, this.whatWasSaved];
    if (this.retryable) parts.push("You can safely retry this action.");
    return parts.join(" ");
  }
}
