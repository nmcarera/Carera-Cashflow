import { describe, it, expect } from "vitest";
import {
  computeDuplicateFingerprint,
  normalizeDescriptionForFingerprint,
} from "@/lib/duplicates/fingerprint";

describe("normalizeDescriptionForFingerprint", () => {
  it("lowercases and collapses whitespace", () => {
    expect(normalizeDescriptionForFingerprint("  Albert   Heijn   ")).toBe("albert heijn");
  });

  it("strips accents so Dutch merchant names normalize consistently", () => {
    expect(normalizeDescriptionForFingerprint("Café Münster")).toBe("cafe munster");
  });

  it("ignores punctuation differences", () => {
    const a = normalizeDescriptionForFingerprint("SEPA Incasso: Moneybird BV");
    const b = normalizeDescriptionForFingerprint("SEPA Incasso, Moneybird BV");
    expect(a).toBe(b);
  });
});

describe("computeDuplicateFingerprint", () => {
  const base = {
    accountId: "acct-1",
    transactionDate: "2026-01-05",
    amount: -22.99,
    currency: "EUR",
    description: "SEPA Incasso algemeen doorlopend Moneybird B.V.",
  };

  it("is stable for identical input", () => {
    expect(computeDuplicateFingerprint(base)).toBe(computeDuplicateFingerprint(base));
  });

  it("differs when the amount differs", () => {
    expect(computeDuplicateFingerprint(base)).not.toBe(
      computeDuplicateFingerprint({ ...base, amount: -23.99 })
    );
  });

  it("differs when the account differs", () => {
    expect(computeDuplicateFingerprint(base)).not.toBe(
      computeDuplicateFingerprint({ ...base, accountId: "acct-2" })
    );
  });

  it("is insensitive to minor description formatting differences", () => {
    const reformatted = {
      ...base,
      description: "SEPA Incasso algemeen doorlopend   Moneybird B.V.  ",
    };
    expect(computeDuplicateFingerprint(base)).toBe(computeDuplicateFingerprint(reformatted));
  });

  it("prefers the institution transaction id when available, ignoring description drift", () => {
    const withId = { ...base, institutionTransactionId: "TXN-123" };
    const withIdDifferentDesc = {
      ...base,
      institutionTransactionId: "TXN-123",
      description: "Completely different text",
    };
    expect(computeDuplicateFingerprint(withId)).toBe(
      computeDuplicateFingerprint(withIdDifferentDesc)
    );
  });
});
