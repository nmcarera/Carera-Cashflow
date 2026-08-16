import { describe, it, expect } from "vitest";
import { NormalizedRowSchema, IsoDate } from "@/lib/domain/transaction";

describe("IsoDate", () => {
  it("accepts a valid calendar date", () => {
    expect(IsoDate.safeParse("2026-02-20").success).toBe(true);
  });
  it("rejects an impossible calendar date", () => {
    expect(IsoDate.safeParse("2026-02-30").success).toBe(false);
  });
  it("rejects a non-ISO format", () => {
    expect(IsoDate.safeParse("20/02/2026").success).toBe(false);
  });
});

describe("NormalizedRowSchema", () => {
  const validRow = {
    accountExternalId: "144326191",
    sourceRowNumber: 1,
    originalRow: { amount: "-22.99" },
    transactionDate: "2026-01-06",
    originalDescription: "SEPA Incasso algemeen doorlopend Moneybird B.V.",
    cleanedDescription: "Moneybird B.V.",
    originalAmount: -22.99,
    originalCurrency: "EUR",
    direction: "debit" as const,
  };

  it("accepts a well-formed row", () => {
    expect(NormalizedRowSchema.safeParse(validRow).success).toBe(true);
  });

  it("rejects a zero amount (ambiguous / likely a parsing error)", () => {
    const result = NormalizedRowSchema.safeParse({ ...validRow, originalAmount: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects a currency code that isn't 3 uppercase letters", () => {
    const result = NormalizedRowSchema.safeParse({ ...validRow, originalCurrency: "eur" });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed date rather than silently coercing it", () => {
    const result = NormalizedRowSchema.safeParse({ ...validRow, transactionDate: "06-01-2026" });
    expect(result.success).toBe(false);
  });
});
