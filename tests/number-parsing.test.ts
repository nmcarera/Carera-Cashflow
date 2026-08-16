import { describe, it, expect } from "vitest";
import { parseFlexibleAmount, parseYyyymmdd, parseMmDdYyyy } from "@/lib/import/numberParsing";

describe("parseFlexibleAmount", () => {
  it("passes through an already-numeric cell (typical of .xls/.xlsx)", () => {
    expect(parseFlexibleAmount(-22.99)).toBe(-22.99);
  });

  it("parses European decimal-comma amounts", () => {
    expect(parseFlexibleAmount("-22,99")).toBe(-22.99);
  });

  it("parses European amounts with a thousands separator", () => {
    expect(parseFlexibleAmount("-1.200,50")).toBe(-1200.5);
  });

  it("parses US decimal-point amounts", () => {
    expect(parseFlexibleAmount("-22.99")).toBe(-22.99);
  });

  it("parses US amounts with a thousands separator", () => {
    expect(parseFlexibleAmount("-1,200.50")).toBe(-1200.5);
  });

  it("parses a plain integer", () => {
    expect(parseFlexibleAmount("100")).toBe(100);
  });

  it("returns null for a letter-for-digit typo rather than guessing (brief's own example)", () => {
    expect(parseFlexibleAmount("1.200,5O")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(parseFlexibleAmount("")).toBeNull();
    expect(parseFlexibleAmount(null)).toBeNull();
  });

  it("returns null for non-finite numbers", () => {
    expect(parseFlexibleAmount(Number.NaN)).toBeNull();
    expect(parseFlexibleAmount(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("parseYyyymmdd", () => {
  it("parses a numeric YYYYMMDD cell", () => {
    expect(parseYyyymmdd(20260102)).toBe("2026-01-02");
  });

  it("parses a string YYYYMMDD cell", () => {
    expect(parseYyyymmdd("20260102")).toBe("2026-01-02");
  });

  it("returns null for an impossible calendar date", () => {
    expect(parseYyyymmdd("20260230")).toBeNull();
  });

  it("returns null for a value that isn't 8 digits", () => {
    expect(parseYyyymmdd("2026-01-02")).toBeNull();
  });
});

describe("parseMmDdYyyy", () => {
  it("parses a standard MM/DD/YYYY date", () => {
    expect(parseMmDdYyyy("02/20/2026")).toBe("2026-02-20");
  });

  it("parses single-digit month/day", () => {
    expect(parseMmDdYyyy("2/5/2026")).toBe("2026-02-05");
  });

  it("returns null for an impossible date", () => {
    expect(parseMmDdYyyy("13/40/2026")).toBeNull();
  });

  it("returns null for a non-matching format", () => {
    expect(parseMmDdYyyy("2026-02-20")).toBeNull();
  });
});
