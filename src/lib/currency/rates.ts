/**
 * The local exchange-rate cache: synchronous reads (safe to call from
 * inside the import pipeline's synchronous `db.transaction`), and an async
 * fetch-and-cache wrapper with retry for anything not already cached.
 *
 * Deliberately simple caching strategy, documented since it was a real
 * choice: a cache miss for (currency, date) always means a fresh network
 * call for exactly that date, even if a nearby date for the same currency
 * is already cached. A "reuse the nearest cached date within N days"
 * optimization would save API calls but adds a second place a "how exact is
 * this rate" judgment gets made; keeping that judgment solely in
 * `FrankfurterProvider`'s own nearest-available-date fallback (reflected via
 * `isExactDate`) is the simpler, more reversible option — see build brief's
 * "choose the simplest reversible implementation when ambiguous."
 */
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import type { DB } from "../db/client";
import { exchangeRates } from "../db/schema";
import type { ExchangeRateProvider } from "./provider";

type TxHandle = Parameters<Parameters<DB["transaction"]>[0]>[0];

export interface CachedRate {
  rate: number;
  source: string;
  isExactDate: boolean;
}

/** Synchronous — safe to call from inside importPipeline.ts's transaction.
 *  Only ever an exact-key lookup (see file header for why). */
export function getCachedRate(
  handle: DB | TxHandle,
  baseCurrency: string,
  quoteCurrency: string,
  date: string
): CachedRate | null {
  if (baseCurrency === quoteCurrency) return { rate: 1, source: "identity", isExactDate: true };
  const row = handle
    .select()
    .from(exchangeRates)
    .where(
      and(
        eq(exchangeRates.baseCurrency, baseCurrency),
        eq(exchangeRates.quoteCurrency, quoteCurrency),
        eq(exchangeRates.date, date)
      )
    )
    .all()[0];
  if (!row) return null;
  return { rate: row.rate, source: row.source, isExactDate: row.isExactDate };
}

function upsertCachedRate(
  handle: DB | TxHandle,
  baseCurrency: string,
  quoteCurrency: string,
  requestedDate: string,
  rate: number,
  source: string,
  isExactDate: boolean
): void {
  const existing = handle
    .select({ id: exchangeRates.id })
    .from(exchangeRates)
    .where(
      and(
        eq(exchangeRates.baseCurrency, baseCurrency),
        eq(exchangeRates.quoteCurrency, quoteCurrency),
        eq(exchangeRates.date, requestedDate)
      )
    )
    .all()[0];

  if (existing) {
    handle
      .update(exchangeRates)
      .set({ rate, source, isExactDate, fetchedAt: new Date().toISOString() })
      .where(eq(exchangeRates.id, existing.id))
      .run();
  } else {
    handle
      .insert(exchangeRates)
      .values({
        id: randomUUID(),
        baseCurrency,
        quoteCurrency,
        date: requestedDate,
        rate,
        source,
        isExactDate,
      })
      .run();
  }
}

const RETRY_DELAYS_MS = [300, 900];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Fetches a rate not already in the cache, retrying transient failures a
 *  couple of times with a short backoff before giving up. A `null` return
 *  means "still don't know, try again later" — never thrown, since a stale
 *  or unreachable rate provider must never take down an import or a page
 *  (build brief §13). Caches on success. */
export async function fetchAndCacheRate(
  provider: ExchangeRateProvider,
  handle: DB | TxHandle,
  baseCurrency: string,
  quoteCurrency: string,
  date: string
): Promise<CachedRate | null> {
  const cached = getCachedRate(handle, baseCurrency, quoteCurrency, date);
  if (cached) return cached;

  let lastResult: Awaited<ReturnType<ExchangeRateProvider["fetchRate"]>> = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    lastResult = await provider.fetchRate({ baseCurrency, quoteCurrency, date });
    if (lastResult) break;
    if (attempt < RETRY_DELAYS_MS.length) await sleep(RETRY_DELAYS_MS[attempt]);
  }
  if (!lastResult) return null;

  const isExactDate = lastResult.date === date;
  upsertCachedRate(handle, baseCurrency, quoteCurrency, date, lastResult.rate, lastResult.source, isExactDate);
  return { rate: lastResult.rate, source: lastResult.source, isExactDate };
}
