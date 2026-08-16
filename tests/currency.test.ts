/**
 * Currency conversion (Phase 4): caching, retry, the synchronous
 * import-time resolver, and the async "resolve pending conversions"
 * orchestration — all exercised against a fake `ExchangeRateProvider`
 * rather than the real network (see src/lib/currency/provider.ts's header
 * comment on why the real Frankfurter provider can't be exercised from
 * this sandboxed environment). The fake lets these tests assert retry and
 * failure behavior deterministically, which a real HTTP call never could.
 */
import { describe, it, expect, beforeAll } from "vitest";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { ExchangeRateProvider, ExchangeRateResult } from "../src/lib/currency/provider";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any, schema: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let rates: any, convert: any, queries: any;

const ACCOUNT_EUR = "acct-eur";
const ACCOUNT_USD = "acct-usd";

beforeAll(async () => {
  const dbPath = path.join(os.tmpdir(), `carera-test-${randomUUID()}.db`);
  process.env.CARERA_DB_PATH = dbPath;

  const clientMod = await import("../src/lib/db/client");
  db = clientMod.db;
  schema = await import("../src/lib/db/schema");
  const migrator = await import("drizzle-orm/better-sqlite3/migrator");
  migrator.migrate(db, { migrationsFolder: path.join(__dirname, "../drizzle") });

  db.insert(schema.accounts)
    .values([
      { id: ACCOUNT_EUR, institution: "abn_amro_checking", accountType: "checking", displayName: "EUR Checking", currency: "EUR", ownershipType: "shared" },
      { id: ACCOUNT_USD, institution: "chase_us", accountType: "checking", displayName: "USD Checking", currency: "USD", ownershipType: "shared" },
    ])
    .run();

  rates = await import("../src/lib/currency/rates");
  convert = await import("../src/lib/currency/convert");
  queries = await import("../src/lib/db/queries");
});

/** A scripted fake provider: each call consumes the next entry in `script`.
 *  `null` simulates a failed fetch (network error, no data). */
function fakeProvider(script: Array<ExchangeRateResult | null>): ExchangeRateProvider {
  let i = 0;
  return {
    async fetchRate() {
      const result = script[Math.min(i, script.length - 1)];
      i++;
      return result;
    },
  };
}

function insertTransaction(overrides: Record<string, unknown>) {
  const id = (overrides.id as string) ?? randomUUID();
  db.insert(schema.transactions)
    .values({
      id,
      accountId: ACCOUNT_USD,
      sourceFileName: "test.csv",
      sourceRowNumber: 1,
      originalRowJson: "{}",
      transactionDate: "2026-01-10",
      merchant: null,
      originalDescription: "Test row",
      cleanedDescription: "Test row",
      originalAmount: -100,
      originalCurrency: "USD",
      eurAmount: null,
      direction: "debit",
      conversionStatus: "pending",
      duplicateFingerprint: randomUUID(),
      ...overrides,
    })
    .run();
  return id;
}

describe("getCachedRate / fetchAndCacheRate", () => {
  it("returns rate 1 for identical currencies without touching the cache", () => {
    expect(rates.getCachedRate(db, "EUR", "EUR", "2026-01-01")).toEqual({ rate: 1, source: "identity", isExactDate: true });
  });

  it("is a cache miss until something populates it", () => {
    expect(rates.getCachedRate(db, "USD", "EUR", "2026-02-01")).toBeNull();
  });

  it("fetches, caches, and marks isExactDate correctly for an exact-date result", async () => {
    const provider = fakeProvider([{ rate: 0.92, date: "2026-02-01", source: "test-provider" }]);
    const result = await rates.fetchAndCacheRate(provider, db, "USD", "EUR", "2026-02-01");
    expect(result).toEqual({ rate: 0.92, source: "test-provider", isExactDate: true });
    expect(rates.getCachedRate(db, "USD", "EUR", "2026-02-01")).toEqual({ rate: 0.92, source: "test-provider", isExactDate: true });
  });

  it("marks isExactDate false when the provider falls back to a nearby date", async () => {
    // Requested a Saturday; provider returns Friday's rate instead.
    const provider = fakeProvider([{ rate: 0.93, date: "2026-02-06", source: "test-provider" }]);
    const result = await rates.fetchAndCacheRate(provider, db, "USD", "EUR", "2026-02-07");
    expect(result?.isExactDate).toBe(false);
    expect(rates.getCachedRate(db, "USD", "EUR", "2026-02-07")?.isExactDate).toBe(false);
  });

  it("retries a failing provider before giving up, and returns null (uncached) if every attempt fails", async () => {
    const alwaysFails = fakeProvider([null, null, null]);
    const result = await rates.fetchAndCacheRate(alwaysFails, db, "GBP", "EUR", "2026-03-01");
    expect(result).toBeNull();
    expect(rates.getCachedRate(db, "GBP", "EUR", "2026-03-01")).toBeNull();
  });

  it("succeeds after transient failures within the retry budget", async () => {
    const failsTwiceThenSucceeds = fakeProvider([null, null, { rate: 0.85, date: "2026-03-05", source: "test-provider" }]);
    const result = await rates.fetchAndCacheRate(failsTwiceThenSucceeds, db, "GBP", "EUR", "2026-03-05");
    expect(result).toEqual({ rate: 0.85, source: "test-provider", isExactDate: true });
  });

  it("never calls the provider again once a rate is cached", async () => {
    let calls = 0;
    const countingProvider: ExchangeRateProvider = {
      async fetchRate() {
        calls++;
        return { rate: 1.1, date: "2026-04-01", source: "test-provider" };
      },
    };
    await rates.fetchAndCacheRate(countingProvider, db, "CHF", "EUR", "2026-04-01");
    await rates.fetchAndCacheRate(countingProvider, db, "CHF", "EUR", "2026-04-01");
    expect(calls).toBe(1);
  });
});

describe("resolveConversionSync", () => {
  it("passes EUR straight through with no lookup", () => {
    const result = convert.resolveConversionSync(db, { currency: "EUR", amount: -50, date: "2026-05-01" });
    expect(result).toEqual({ eurAmount: -50, exchangeRate: null, exchangeRateDate: null, exchangeRateSource: null, conversionStatus: "exact" });
  });

  it("trusts a source-statement-provided EUR amount over any cached rate", () => {
    const result = convert.resolveConversionSync(db, {
      currency: "USD",
      amount: -100,
      date: "2026-05-02",
      providedEurAmount: -92.5,
      providedExchangeRate: 0.925,
    });
    expect(result.eurAmount).toBe(-92.5);
    expect(result.conversionStatus).toBe("exact");
    expect(result.exchangeRateSource).toBe("source-statement");
  });

  it("uses a cached rate when one exists for that exact date", async () => {
    const provider = fakeProvider([{ rate: 0.9, date: "2026-05-03", source: "test-provider" }]);
    await rates.fetchAndCacheRate(provider, db, "USD", "EUR", "2026-05-03");
    const result = convert.resolveConversionSync(db, { currency: "USD", amount: -100, date: "2026-05-03" });
    expect(result.eurAmount).toBe(-90);
    expect(result.conversionStatus).toBe("exact");
  });

  it("stays pending — never guesses — when nothing is cached and there's no provided amount", () => {
    const result = convert.resolveConversionSync(db, { currency: "USD", amount: -100, date: "2026-06-15" });
    expect(result).toEqual({ eurAmount: null, exchangeRate: null, exchangeRateDate: null, exchangeRateSource: null, conversionStatus: "pending" });
  });
});

describe("resolvePendingConversions", () => {
  it("resolves every pending transaction it can get a rate for, leaves the rest pending, and logs to the audit trail", async () => {
    const resolvable = insertTransaction({ transactionDate: "2026-07-01", originalAmount: -200 });
    const unresolvable = insertTransaction({ transactionDate: "2026-07-02", originalAmount: -50 });

    const provider: ExchangeRateProvider = {
      async fetchRate(lookup) {
        if (lookup.date === "2026-07-01") return { rate: 0.9, date: "2026-07-01", source: "test-provider" };
        return null; // simulates a rate genuinely unavailable for the other date
      },
    };

    const summary = await convert.resolvePendingConversions(provider);
    expect(summary.transactionsResolved).toBe(1);
    expect(summary.transactionsStillPending).toBe(1);
    expect(summary.ratesFetched).toBe(1);
    expect(summary.ratesFailed).toBe(1);

    const [resolvedRow] = queries.transactionsForIds([resolvable]);
    expect(resolvedRow.conversionStatus).toBe("exact");
    expect(resolvedRow.eurAmount).toBe(-180);
    expect(resolvedRow.reviewStatus).toBe("needs_review"); // still no_category/no_owner
    expect(resolvedRow.reviewReasonsJson).not.toContain("missing_conversion");

    const [stillPendingRow] = queries.transactionsForIds([unresolvable]);
    expect(stillPendingRow.conversionStatus).toBe("pending");

    const auditRows = db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entityId, resolvable))
      .all();
    expect(auditRows.some((r: { field: string; changeSource: string }) => r.field === "eurAmount" && r.changeSource === "system")).toBe(true);
  });

  it("re-runs transfer detection for a transaction that just got resolved", async () => {
    // An existing EUR transaction on a different account, opposite amount —
    // this is exactly what a resolved USD transaction should now match.
    const eurSideId = insertTransaction({
      accountId: ACCOUNT_EUR,
      transactionDate: "2026-08-01",
      originalAmount: 180,
      originalCurrency: "EUR",
      eurAmount: 180,
      conversionStatus: "exact",
      transferStatus: "none",
    });
    const usdSideId = insertTransaction({
      accountId: ACCOUNT_USD,
      transactionDate: "2026-08-01",
      originalAmount: -200,
      originalCurrency: "USD",
      conversionStatus: "pending",
      transferStatus: "none",
    });

    const provider = fakeProvider([{ rate: 0.9, date: "2026-08-01", source: "test-provider" }]);
    const summary = await convert.resolvePendingConversions(provider);
    expect(summary.newTransferSuggestions).toBeGreaterThanOrEqual(1);

    const [usdRow] = queries.transactionsForIds([usdSideId]);
    expect(usdRow.transferStatus).toBe("suggested");
    expect(usdRow.possibleTransferId).toBe(eurSideId);
  });
});
