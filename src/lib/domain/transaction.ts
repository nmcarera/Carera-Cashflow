/**
 * Canonical transaction model — Zod schema + derived TypeScript types.
 *
 * Every institution adapter must produce values that satisfy
 * `NormalizedRowSchema` before anything is written to the database. This is
 * the strict-validation boundary called out in the build brief §1 and §3:
 * nothing skips this schema on the way into `transactions`.
 *
 * `CanonicalTransaction` is the full DB-shaped record (see
 * src/lib/db/schema.ts `transactions`). `HydratedTransaction` is what the UI
 * consumes: the DB record plus joined display fields (account name,
 * institution, category name/color, etc.) — see docs/schema.md for the
 * documented reasoning on why those are joined rather than duplicated.
 */
import { z } from "zod";
import {
  CONVERSION_STATUSES,
  TRANSACTION_DIRECTIONS,
  REVIEW_STATUSES,
  REVIEW_REASONS,
  TRANSFER_STATUSES,
  OWNERSHIP_TYPES,
  INSTITUTIONS,
} from "./enums";

/** ISO date YYYY-MM-DD, validated as a real calendar date (not just regex-shaped). */
export const IsoDate = z.string().refine(
  (v) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    const d = new Date(v + "T00:00:00Z");
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  },
  { message: "Expected a valid ISO date (YYYY-MM-DD)" }
);

/**
 * The shape an institution adapter must emit for a single successfully
 * parsed row, BEFORE database IDs, duplicate fingerprint, currency
 * conversion, or categorization are attached. This is intentionally a
 * subset of the full canonical transaction — the import pipeline fills in
 * the rest (see src/lib/import/importPipeline.ts).
 */
export const NormalizedRowSchema = z.object({
  accountExternalId: z.string().min(1), // raw account number/identifier from the file, used to resolve/create an Account
  sourceRowNumber: z.number().int().nonnegative(),
  originalRow: z.record(z.string(), z.unknown()), // preserved raw row, any shape
  transactionDate: IsoDate,
  postingDate: IsoDate.optional(),
  merchant: z.string().trim().min(1).optional(),
  originalDescription: z.string().min(1),
  cleanedDescription: z.string().min(1),
  originalAmount: z.number().finite().refine((n) => n !== 0, {
    message: "Amount must not be zero",
  }),
  originalCurrency: z
    .string()
    .length(3)
    .regex(/^[A-Z]{3}$/, "Expected an ISO 4217 currency code"),
  direction: z.enum(TRANSACTION_DIRECTIONS),
  /** Set only when the source file itself states an EUR amount/rate (e.g. a Dutch EUR
   *  account, or a statement that already shows the converted amount). */
  providedEurAmount: z.number().finite().optional(),
  providedExchangeRate: z.number().positive().optional(),
  /** Institution-provided unique transaction id, when available — strengthens the
   *  duplicate fingerprint beyond date+amount+description. */
  institutionTransactionId: z.string().optional(),
});
export type NormalizedRow = z.infer<typeof NormalizedRowSchema>;

/** Full canonical transaction record as stored in the database. */
export const CanonicalTransactionSchema = z.object({
  id: z.string().uuid(),
  importBatchId: z.string().uuid().nullable(),
  accountId: z.string().uuid(),

  sourceFileName: z.string(),
  sourceRowNumber: z.number().int().nonnegative(),
  originalRowJson: z.string(), // JSON-encoded original row

  transactionDate: IsoDate,
  postingDate: IsoDate.nullable(),

  merchant: z.string().nullable(),
  originalDescription: z.string(),
  cleanedDescription: z.string(),

  originalAmount: z.number().finite(),
  originalCurrency: z.string().length(3),

  eurAmount: z.number().finite().nullable(),
  exchangeRate: z.number().positive().nullable(),
  exchangeRateDate: IsoDate.nullable(),
  exchangeRateSource: z.string().nullable(),
  conversionStatus: z.enum(CONVERSION_STATUSES),

  direction: z.enum(TRANSACTION_DIRECTIONS),

  categoryId: z.string().uuid().nullable(),
  priorityId: z.string().uuid().nullable(),

  ownershipType: z.enum(OWNERSHIP_TYPES),
  ownerMemberId: z.string().uuid().nullable(),

  reviewStatus: z.enum(REVIEW_STATUSES),
  reviewReasons: z.array(z.enum(REVIEW_REASONS)),
  confidenceReason: z.string().nullable(),
  appliedRuleId: z.string().uuid().nullable(),

  duplicateFingerprint: z.string(),
  possibleTransferId: z.string().uuid().nullable(),
  transferStatus: z.enum(TRANSFER_STATUSES),

  notes: z.string().nullable(),

  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CanonicalTransaction = z.infer<typeof CanonicalTransactionSchema>;

export const InstitutionSchema = z.enum(INSTITUTIONS);
