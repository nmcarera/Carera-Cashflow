/**
 * Currency conversion — the synchronous path used at import time, and the
 * async "resolve whatever's still pending" path run afterward.
 *
 * Import commits run inside a single synchronous better-sqlite3 transaction
 * (see importPipeline.ts's comment on why), so a network fetch can never
 * happen mid-import. Instead: at import time, a non-EUR row is resolved
 * from whatever's *already cached* (a synchronous, network-free lookup —
 * common when several rows in the same file share a currency and nearby
 * dates already fetched for an earlier row or an earlier import), and
 * anything not already cached is stored as `conversionStatus: 'pending'`,
 * exactly as Phase 2 already did. `resolvePendingConversions` is the new
 * Phase 4 piece: an explicit, user-triggered async step that fetches
 * whatever's missing, caches it, and updates every transaction it can now
 * resolve — never automatic, never silent, and a transaction it still can't
 * resolve is left alone rather than guessed (build brief §6).
 */
import { eq, and, ne } from "drizzle-orm";
import { db, type DB } from "../db/client";
import { transactions } from "../db/schema";
import { getCachedRate, fetchAndCacheRate } from "./rates";
import { FrankfurterProvider, type ExchangeRateProvider } from "./provider";
import { computeReviewStatus } from "../categorization/reviewStatus";
import { findPossibleTransferMatch } from "../transfers/detector";
import { writeAuditEntry } from "../audit/log";
import { formatMoney } from "../format";

type TxHandle = Parameters<Parameters<DB["transaction"]>[0]>[0];

export interface ConversionResult {
  eurAmount: number | null;
  exchangeRate: number | null;
  exchangeRateDate: string | null;
  exchangeRateSource: string | null;
  conversionStatus: "exact" | "estimated" | "pending";
}

/** Synchronous — the only currency resolution import time is allowed to do.
 *  Precedence: EUR needs no conversion; a source-statement-provided EUR
 *  amount is trusted outright (build brief: the file's own numbers win over
 *  a fetched rate); otherwise fall back to whatever's already cached. */
export function resolveConversionSync(
  handle: DB | TxHandle,
  input: {
    currency: string;
    amount: number;
    date: string;
    providedEurAmount?: number;
    providedExchangeRate?: number;
  }
): ConversionResult {
  if (input.currency === "EUR") {
    return { eurAmount: input.amount, exchangeRate: null, exchangeRateDate: null, exchangeRateSource: null, conversionStatus: "exact" };
  }
  if (input.providedEurAmount !== undefined) {
    return {
      eurAmount: input.providedEurAmount,
      exchangeRate: input.providedExchangeRate ?? null,
      exchangeRateDate: input.date,
      exchangeRateSource: "source-statement",
      conversionStatus: "exact",
    };
  }
  const cached = getCachedRate(handle, input.currency, "EUR", input.date);
  if (cached) {
    return {
      eurAmount: round2(input.amount * cached.rate),
      exchangeRate: cached.rate,
      exchangeRateDate: input.date,
      exchangeRateSource: cached.source,
      conversionStatus: cached.isExactDate ? "exact" : "estimated",
    };
  }
  return { eurAmount: null, exchangeRate: null, exchangeRateDate: null, exchangeRateSource: null, conversionStatus: "pending" };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface ResolvePendingSummary {
  ratesFetched: number;
  ratesFailed: number;
  transactionsResolved: number;
  transactionsStillPending: number;
  newTransferSuggestions: number;
}

/** The manual "resolve pending currency conversions" action (Import history
 *  and Review pages). Fetches every distinct (currency, date) still needed,
 *  then applies whatever it could resolve in one synchronous DB pass —
 *  including re-running transfer detection for each newly-resolved
 *  transaction, since a transfer match against a still-pending amount is
 *  something the Phase 2 heuristic explicitly refuses to guess at
 *  (src/lib/transfers/detector.ts). Every change is written to `audit_log`
 *  with `changeSource: 'system'` so "why did this transaction's EUR amount
 *  appear" is always answerable later. */
export async function resolvePendingConversions(
  provider: ExchangeRateProvider = new FrankfurterProvider()
): Promise<ResolvePendingSummary> {
  const pending = db
    .select()
    .from(transactions)
    .where(and(eq(transactions.conversionStatus, "pending"), ne(transactions.originalCurrency, "EUR")))
    .all();

  const needed = new Map<string, { currency: string; date: string }>();
  for (const t of pending) {
    const key = `${t.originalCurrency}|${t.transactionDate}`;
    if (!needed.has(key)) needed.set(key, { currency: t.originalCurrency, date: t.transactionDate });
  }

  let ratesFetched = 0;
  let ratesFailed = 0;
  for (const { currency, date } of needed.values()) {
    const result = await fetchAndCacheRate(provider, db, currency, "EUR", date);
    if (result) ratesFetched++;
    else ratesFailed++;
  }

  let transactionsResolved = 0;
  let newTransferSuggestions = 0;

  db.transaction((tx) => {
    for (const before of pending) {
      const cached = getCachedRate(tx, before.originalCurrency, "EUR", before.transactionDate);
      if (!cached) continue;

      const eurAmount = round2(before.originalAmount * cached.rate);
      const conversionStatus = cached.isExactDate ? "exact" : "estimated";

      let transferStatus = before.transferStatus;
      let possibleTransferId = before.possibleTransferId;
      if (transferStatus === "none") {
        const candidate = findPossibleTransferMatch({
          accountId: before.accountId,
          transactionDate: before.transactionDate,
          eurAmount,
        });
        if (candidate) {
          transferStatus = "suggested";
          possibleTransferId = candidate.transactionId;
          newTransferSuggestions++;
        }
      }

      const { reviewStatus, reviewReasons } = computeReviewStatus({
        hasCategory: before.categoryId !== null,
        hasOwner: before.ownershipType !== "unassigned",
        transferStatus,
        conversionStatus,
      });

      tx.update(transactions)
        .set({
          eurAmount,
          exchangeRate: cached.rate,
          exchangeRateDate: before.transactionDate,
          exchangeRateSource: cached.source,
          conversionStatus,
          transferStatus,
          possibleTransferId,
          reviewStatus,
          reviewReasonsJson: JSON.stringify(reviewReasons),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(transactions.id, before.id))
        .run();

      writeAuditEntry(
        {
          entityType: "transaction",
          entityId: before.id,
          field: "eurAmount",
          oldValue: null,
          newValue: formatMoney(eurAmount, "EUR"),
          changeSource: "system",
          note: `Resolved via ${cached.source} at ${cached.isExactDate ? "the exact" : "a nearest-available"} rate for ${before.transactionDate}.`,
        },
        tx
      );
      transactionsResolved++;
    }
  });

  return {
    ratesFetched,
    ratesFailed,
    transactionsResolved,
    transactionsStillPending: pending.length - transactionsResolved,
    newTransferSuggestions,
  };
}
