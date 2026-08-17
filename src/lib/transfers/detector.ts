/**
 * Internal transfer detection.
 *
 * The core gate is unchanged from Phase 2 and deliberately narrow: a
 * same-household different account, an opposite-signed EUR amount within a
 * small tolerance, within a short date window. False negatives here are
 * safe (the household still sees and can manually confirm the transaction
 * from the review queue); false positives would not be, so the tolerance
 * stays tight rather than being loosened to catch more cases automatically.
 *
 * Phase 4 addition: when more than one existing transaction matches that
 * gate (rare, but possible — two same-amount transfers within the window),
 * pick the most plausible one using a household-name/counterparty signal
 * instead of just the first row a query happens to return, and say so in
 * the explanation shown to whoever reviews the suggestion. This never
 * changes *whether* something gets suggested, only *which* candidate wins
 * when there's more than one — the household always sees the match and
 * confirms or rejects it either way.
 */
import { and, gte, lte, ne } from "drizzle-orm";
import { db } from "../db/client";
import { transactions, householdMembers } from "../db/schema";
import { formatDate, formatEur } from "../format";

const DATE_WINDOW_DAYS = 3;
const AMOUNT_TOLERANCE_EUR = 0.01;

export interface TransferCandidate {
  transactionId: string;
  explanation: string;
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const SELF_TRANSFER_KEYWORDS = ["eigen rekening", "own account", "internal transfer", "overboeking"];

/** Higher is a more plausible self-transfer. A merchant name that matches a
 *  household member is the strongest signal available without a real
 *  counterparty-IBAN join (which the canonical model doesn't carry — see
 *  docs/schema.md); no merchant at all (common for a plain SEPA transfer
 *  between the household's own accounts) beats an unrelated third-party
 *  merchant name that just happens to match on amount and date. */
function counterpartyScore(t: { merchant: string | null; cleanedDescription: string }, memberNames: string[]): number {
  let score = 0;
  const merchantLower = t.merchant?.toLowerCase() ?? null;
  if (merchantLower && memberNames.some((name) => merchantLower.includes(name))) score += 3;
  else if (!merchantLower) score += 2;
  const descLower = t.cleanedDescription.toLowerCase();
  if (SELF_TRANSFER_KEYWORDS.some((kw) => descLower.includes(kw))) score += 1;
  return score;
}

/** Looks for an existing transaction on a *different* account with a
 *  roughly opposite EUR amount within a few days — the signature of a
 *  transfer between two of the household's own accounts. Only considers
 *  transactions that already have a resolved EUR amount (build brief §6:
 *  never guess across a pending currency conversion). */
export function findPossibleTransferMatch(candidate: {
  accountId: string;
  transactionDate: string;
  eurAmount: number;
}): TransferCandidate | null {
  const from = addDays(candidate.transactionDate, -DATE_WINDOW_DAYS);
  const to = addDays(candidate.transactionDate, DATE_WINDOW_DAYS);

  const nearby = db
    .select()
    .from(transactions)
    .where(
      and(
        ne(transactions.accountId, candidate.accountId),
        gte(transactions.transactionDate, from),
        lte(transactions.transactionDate, to)
      )
    )
    .all();

  const matches = nearby.filter(
    (t) =>
      t.eurAmount !== null &&
      t.transferStatus !== "confirmed" &&
      Math.abs(t.eurAmount + candidate.eurAmount) <= AMOUNT_TOLERANCE_EUR
  );

  if (matches.length === 0) return null;

  let match = matches[0];
  if (matches.length > 1) {
    const memberNames = db
      .select({ name: householdMembers.name })
      .from(householdMembers)
      .all()
      .map((m) => m.name.toLowerCase());
    match = [...matches].sort((a, b) => counterpartyScore(b, memberNames) - counterpartyScore(a, memberNames))[0];
  }

  const counterpartyNote = match.merchant ? ` from/to "${match.merchant}"` : "";
  return {
    transactionId: match.id,
    explanation: `Possible match: ${formatEur(match.eurAmount)} on ${formatDate(
      match.transactionDate
    )} in a different account${counterpartyNote} ("${match.cleanedDescription}") — opposite amount, within ${DATE_WINDOW_DAYS} days.`,
  };
}
