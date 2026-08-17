/**
 * Exchange-rate provider interface, and the concrete implementation used in
 * production.
 *
 * Kept as a small interface (not a concrete `fetch` call sprinkled through
 * the codebase) for two reasons: it's how `tests/currency.test.ts` exercises
 * retry/caching/fallback logic deterministically with a fake provider
 * instead of real network calls, and it's the seam a future provider swap
 * (a different rate source, or an offline table) would go through without
 * touching `src/lib/currency/rates.ts` or the import pipeline.
 *
 * **Documented limitation**: this sandboxed development environment has no
 * general internet access (only the npm registry is reachable — see
 * README "Data privacy and security limitations" / the Chase adapter note
 * for the same constraint elsewhere in this project), so `FrankfurterProvider`
 * below could not be exercised against the real API from here. It's built
 * against Frankfurter's publicly documented response shape (a free,
 * no-API-key, ECB-reference-rate service — https://www.frankfurter.app —
 * chosen because it's exactly EUR-denominated, which is all this app ever
 * converts to). It should work unmodified on a household's own machine,
 * which has normal internet access, but is unverified end-to-end the same
 * way the Chase adapter is. If anything about the response shape has
 * drifted, `resolvePendingConversions` fails closed: a transaction just
 * stays `pending` rather than getting a wrong or guessed rate — see
 * "How currency conversion works" in the README.
 */

export interface ExchangeRateLookup {
  /** The transaction's own currency, e.g. "USD". */
  baseCurrency: string;
  /** Always "EUR" in this app today, but not hardcoded into the interface. */
  quoteCurrency: string;
  /** The requested date, YYYY-MM-DD. */
  date: string;
}

export interface ExchangeRateResult {
  rate: number;
  /** The date this rate actually applies to — may differ from the
   *  requested date when the provider falls back to the nearest prior
   *  business day (weekends/holidays have no published reference rate). */
  date: string;
  source: string;
}

export interface ExchangeRateProvider {
  /** Resolves `baseCurrency` -> `quoteCurrency` for (at or nearest before)
   *  `date`. Returns `null` on any failure (network error, unrecognized
   *  currency, malformed response) — this is a normal, expected outcome the
   *  caller retries or leaves `pending`, never an exception the caller has
   *  to guard against. */
  fetchRate(lookup: ExchangeRateLookup): Promise<ExchangeRateResult | null>;
}

const FRANKFURTER_BASE_URL = "https://api.frankfurter.app";
const SOURCE_NAME = "frankfurter.app";

/** Frankfurter's documented response shape:
 *  `{ "amount": 1, "base": "USD", "date": "2024-01-12", "rates": { "EUR": 0.912 } }`
 *  — `date` is the actual rate date used (Frankfurter itself falls back to
 *  the nearest prior day with no separate signal for "was this exact",
 *  which is why `rates.ts` compares the returned date to the requested one
 *  itself rather than trusting a flag from the API). */
interface FrankfurterResponse {
  amount: number;
  base: string;
  date: string;
  rates: Record<string, number>;
}

function isFrankfurterResponse(value: unknown): value is FrankfurterResponse {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.date === "string" &&
    typeof v.base === "string" &&
    typeof v.rates === "object" &&
    v.rates !== null
  );
}

export class FrankfurterProvider implements ExchangeRateProvider {
  async fetchRate(lookup: ExchangeRateLookup): Promise<ExchangeRateResult | null> {
    if (lookup.baseCurrency === lookup.quoteCurrency) {
      return { rate: 1, date: lookup.date, source: SOURCE_NAME };
    }
    const url = `${FRANKFURTER_BASE_URL}/${lookup.date}?from=${lookup.baseCurrency}&to=${lookup.quoteCurrency}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return null;
      const body: unknown = await res.json();
      if (!isFrankfurterResponse(body)) return null;
      const rate = body.rates[lookup.quoteCurrency];
      if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) return null;
      return { rate, date: body.date, source: SOURCE_NAME };
    } catch {
      // Network error, timeout, DNS failure, malformed JSON — all treated
      // the same: no rate today, safe to retry later. Never thrown further;
      // a currency-conversion hiccup must never abort an import or crash a
      // page render (build brief §13, "graceful degradation").
      return null;
    }
  }
}
