/**
 * Duplicate-detection fingerprinting.
 *
 * A stable hash of the fields that identify "the same transaction" across
 * overlapping statement exports: account, date, amount, currency, and a
 * normalized description. When the source provides a bank transaction id,
 * that is included too and dominates the match (banks reuse the same id for
 * the same transaction across overlapping export windows; description text
 * can vary slightly between an account's history view and its downloadable
 * statement).
 *
 * This module only computes the fingerprint. Matching existing transactions
 * against it (and explaining *why* something was flagged as a duplicate) is
 * done in src/lib/duplicates/detector.ts (Phase 2), which also has access to
 * the database.
 */
import { createHash } from "node:crypto";

export interface FingerprintInput {
  accountId: string;
  transactionDate: string; // YYYY-MM-DD
  amount: number;
  currency: string;
  description: string;
  institutionTransactionId?: string;
}

/** Lowercases, strips whitespace runs and non-alphanumeric noise so that
 *  minor formatting differences between two exports of the same transaction
 *  don't produce different fingerprints. */
export function normalizeDescriptionForFingerprint(desc: string): string {
  return desc
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 80); // long free-text tails (e.g. ABN AMRO's SEPA remittance info) are noisy and non-stable
}

export function computeDuplicateFingerprint(input: FingerprintInput): string {
  const basis = input.institutionTransactionId
    ? `id:${input.institutionTransactionId}|acct:${input.accountId}`
    : [
        `acct:${input.accountId}`,
        `date:${input.transactionDate}`,
        `amt:${input.amount.toFixed(2)}`,
        `cur:${input.currency.toUpperCase()}`,
        `desc:${normalizeDescriptionForFingerprint(input.description)}`,
      ].join("|");
  return createHash("sha256").update(basis).digest("hex").slice(0, 32);
}
