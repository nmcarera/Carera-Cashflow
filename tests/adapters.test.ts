import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { inspectFile } from "@/lib/import/fileInspector";
import { abnAmroAdapter } from "@/lib/import/adapters/abnAmro";
import { amexEuAdapter } from "@/lib/import/adapters/amexEu";
import { chaseUsAdapter, UNVERIFIED } from "@/lib/import/adapters/chaseUs";

const FIXTURES = path.join(__dirname, "fixtures");

async function load(relPath: string) {
  const fileName = path.basename(relPath);
  const buffer = readFileSync(path.join(FIXTURES, relPath));
  return inspectFile(fileName, buffer);
}

describe("abnAmroAdapter", () => {
  it("detects the ABN AMRO column format", async () => {
    const file = await load("abn-amro-checking/sample.csv");
    expect(abnAmroAdapter.detect(file).confidence).toBe(1);
  });

  it("parses decimal-comma amounts (with and without thousands separators)", async () => {
    const file = await load("abn-amro-checking/sample.csv");
    const { rows } = abnAmroAdapter.parse(file);
    const salary = rows.find((r) => r.normalized?.originalAmount === 2500);
    expect(salary).toBeDefined();
    const groceries = rows.find((r) => r.normalized?.originalAmount === -45.5);
    expect(groceries).toBeDefined();
  });

  it("parses YYYYMMDD dates into ISO format", async () => {
    const file = await load("abn-amro-checking/sample.csv");
    const { rows } = abnAmroAdapter.parse(file);
    const row = rows.find((r) => r.normalized?.originalAmount === -45.5);
    expect(row?.normalized?.transactionDate).toBe("2026-01-03");
  });

  it("quarantines a malformed amount instead of guessing (brief's own worked example)", async () => {
    const file = await load("abn-amro-checking/sample.csv");
    const { rows } = abnAmroAdapter.parse(file);
    const bad = rows.find((r) => r.issue?.message.includes("1.200,5O"));
    expect(bad).toBeDefined();
    expect(bad?.issue?.type).toBe("malformed");
    expect(bad?.normalized).toBeUndefined();
  });

  it("quarantines a malformed date instead of guessing", async () => {
    const file = await load("abn-amro-checking/sample.csv");
    const { rows } = abnAmroAdapter.parse(file);
    const bad = rows.find((r) => r.issue?.message.includes("2026-01-30"));
    expect(bad).toBeDefined();
    expect(bad?.issue?.type).toBe("malformed");
  });

  it("groups rows from a single file into multiple accounts", async () => {
    const file = await load("abn-amro-checking/sample.csv");
    const { rows } = abnAmroAdapter.parse(file);
    const accountIds = new Set(rows.filter((r) => r.normalized).map((r) => r.normalized!.accountExternalId));
    expect(accountIds).toEqual(new Set(["111222333", "999888777"]));
  });

  it("classifies an interest-posting row as savings", async () => {
    const file = await load("abn-amro-checking/sample.csv");
    const { rows } = abnAmroAdapter.parse(file);
    const interestRow = rows.find((r) => r.normalized?.originalDescription.includes("CREDIT INTEREST"));
    expect(interestRow?.accountTypeHint).toBe("savings");
  });

  it("does NOT classify a checking account as savings just because a counterparty is named 'Direct Savings' (regression)", async () => {
    const file = await load("abn-amro-checking/sample.csv");
    const { rows } = abnAmroAdapter.parse(file);
    const checkingRows = rows.filter((r) => r.normalized?.accountExternalId === "111222333");
    expect(checkingRows.length).toBeGreaterThan(0);
    expect(checkingRows.every((r) => r.accountTypeHint === "checking")).toBe(true);
  });
});

describe("amexEuAdapter", () => {
  it("detects the Amex transaction-detail sheet among multiple sheets", async () => {
    const file = await load("amex-eu/sample.xlsx");
    expect(amexEuAdapter.detect(file).confidence).toBe(1);
  });

  it("uses the header block's card number as the account id for every row, not the per-row 'Rekening #'", async () => {
    const file = await load("amex-eu/sample.xlsx");
    const { rows } = amexEuAdapter.parse(file);
    const ids = new Set(rows.filter((r) => r.normalized).map((r) => r.normalized!.accountExternalId));
    expect(ids).toEqual(new Set(["XXXX-XXXXXX-99001"]));
  });

  it("suggests an owner from the per-row cardholder name", async () => {
    const file = await load("amex-eu/sample.xlsx");
    const { rows } = amexEuAdapter.parse(file);
    const coffee = rows.find((r) => r.normalized?.originalDescription.includes("COFFEE SHOP"));
    expect(coffee?.suggestedOwnerName).toBe("TEST CARDHOLDER ONE");
  });

  it("flips a purchase's sign so positive Bedrag becomes a negative (expense) canonical amount", async () => {
    const file = await load("amex-eu/sample.xlsx");
    const { rows } = amexEuAdapter.parse(file);
    const coffee = rows.find((r) => r.normalized?.originalDescription.includes("COFFEE SHOP"));
    expect(coffee?.normalized?.originalAmount).toBe(-4.6);
    expect(coffee?.normalized?.direction).toBe("debit");
  });

  it("identifies a payment-receipt row as a transfer, not income", async () => {
    const file = await load("amex-eu/sample.xlsx");
    const { rows } = amexEuAdapter.parse(file);
    const payment = rows.find((r) => r.normalized?.originalDescription.includes("HARTELIJK BEDANKT"));
    expect(payment?.normalized?.direction).toBe("transfer");
    expect(payment?.normalized?.originalAmount).toBe(1200.5); // sign flipped from -1200.50
  });

  it("treats a genuine refund (negative Bedrag, not a payment receipt) as a credit", async () => {
    const file = await load("amex-eu/sample.xlsx");
    const { rows } = amexEuAdapter.parse(file);
    const refund = rows.find((r) => r.normalized?.originalDescription.includes("REFUND"));
    expect(refund?.normalized?.direction).toBe("credit");
    expect(refund?.normalized?.originalAmount).toBe(19.99);
  });

  it("quarantines a row with an unparseable date", async () => {
    const file = await load("amex-eu/sample.xlsx");
    const { rows } = amexEuAdapter.parse(file);
    const bad = rows.find((r) => r.issue?.message.includes("not-a-date"));
    expect(bad).toBeDefined();
  });
});

describe("chaseUsAdapter", () => {
  it("is marked unverified (no real sample was available)", () => {
    expect(UNVERIFIED).toBe(true);
  });

  it("detects its expected headers with confidence below 1 (never claims certainty for an unverified format)", async () => {
    const file = await load("chase/sample.csv");
    const detection = chaseUsAdapter.detect(file);
    expect(detection.confidence).toBeGreaterThan(0);
    expect(detection.confidence).toBeLessThan(1);
  });

  it("parses signed USD amounts and MM/DD/YYYY dates", async () => {
    const file = await load("chase/sample.csv");
    const { rows } = chaseUsAdapter.parse(file);
    const payroll = rows.find((r) => r.normalized?.originalDescription === "PAYROLL DEPOSIT");
    expect(payroll?.normalized?.originalAmount).toBe(2000);
    expect(payroll?.normalized?.transactionDate).toBe("2026-01-20");
    expect(payroll?.normalized?.direction).toBe("credit");
  });

  it("quarantines a malformed row rather than dropping it silently", async () => {
    const file = await load("chase/sample.csv");
    const { rows } = chaseUsAdapter.parse(file);
    expect(rows.length).toBe(4); // all 4 data rows accounted for, including the bad one
    const bad = rows.find((r) => r.issue);
    expect(bad?.issue?.type).toBe("malformed");
  });
});
