/**
 * Duplicate matching against the database — the counterpart to
 * fingerprint.ts's pure hashing function. Kept separate so fingerprint.ts
 * (used by both the pipeline and tests) has no database dependency.
 */
import { eq, and } from "drizzle-orm";
import { db } from "../db/client";
import { transactions } from "../db/schema";
import { formatDate, formatEur } from "../format";

export interface DuplicateMatch {
  existingTransactionId: string;
  explanation: string;
}

/** Looks for an existing, already-committed transaction with the same
 *  fingerprint on the same account. Explainable per build brief §5: "When a
 *  row is skipped as a duplicate, show which existing transaction it
 *  matched and why." */
export function findExistingDuplicate(accountId: string, fingerprint: string): DuplicateMatch | null {
  const match = db
    .select()
    .from(transactions)
    .where(and(eq(transactions.accountId, accountId), eq(transactions.duplicateFingerprint, fingerprint)))
    .limit(1)
    .all()[0];

  if (!match) return null;

  return {
    existingTransactionId: match.id,
    explanation: `Matches a transaction already imported on ${formatDate(
      match.transactionDate
    )} for ${formatEur(match.eurAmount)} ("${match.cleanedDescription}", from ${match.sourceFileName}).`,
  };
}
