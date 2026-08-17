/**
 * ABN AMRO adapter.
 *
 * Built and verified against real (redacted) ABN AMRO exports. One
 * important discovery from those real files, documented here because it
 * shapes this adapter's design: a single ABN AMRO "download transactions"
 * export can contain rows for *several accounts at once* — in the samples
 * we received, one household member's export mixed their personal
 * checking account, the joint checking account, and a shared savings
 * account together, using the same 8-column format for all of them. There
 * is no separate "checking" vs "savings" file format to detect — the
 * column layout is identical either way.
 *
 * Consequently this is deliberately **one** adapter/parser for both of the
 * build brief's "ABN AMRO checking" and "ABN AMRO savings" targets, rather
 * than two adapters each expecting a single-account, single-type file. It
 * still produces a per-row institution hint (`abn_amro_checking` or
 * `abn_amro_savings`) using a content heuristic (savings accounts' rows are
 * dominated by "CREDIT INTEREST" / "Direct Savings" / "Basic interest"
 * language rather than SEPA payment language) — the import pipeline uses
 * the majority hint across each account's rows when it needs to create a
 * new account, and the household can always correct the type afterward in
 * Settings. This is the "simplest reversible implementation" called for in
 * build brief §20 when a requirement (two adapters) turns out not to match
 * what the bank actually exports.
 */
import type { InspectedFile } from "../fileInspector";
import type { AdapterDetection, InstitutionAdapter, ParsedRowResult } from "./types";
import { parseFlexibleAmount, parseYyyymmdd, cellToString } from "../numberParsing";
import { cleanDescription, extractMerchant } from "../textCleanup";

const EXPECTED_HEADERS = [
  "accountNumber",
  "mutationcode",
  "transactiondate",
  "valuedate",
  "startsaldo",
  "endsaldo",
  "amount",
  "description",
];

// Matched against the START of a description only, not "contains" anywhere
// in it. These are ABN AMRO's own fixed phrasing for an interest posting on
// a savings account — verified against real sample files. An earlier
// "contains" version of this check produced false positives: an ordinary
// checking-account transfer whose counterparty happens to be named "Direct
// Savings" or "Capital Savings Account" (i.e. a transfer *to* someone
// else's savings account) would otherwise get misread as evidence that
// *this* account is a savings account, because that counterparty name is
// embedded later in the description (after "Naam: "). Interest-posting
// rows, by contrast, always start with one of these phrases.
const SAVINGS_DESCRIPTION_PREFIXES = ["account balanced", "basic interest"];

function looksLikeSavingsRow(description: string): boolean {
  const normalized = description.trim().toLowerCase();
  return SAVINGS_DESCRIPTION_PREFIXES.some((p) => normalized.startsWith(p));
}

function findHeaderRow(sheet: InspectedFile["sheets"][number]): number {
  for (let i = 0; i < Math.min(sheet.rows.length, 5); i++) {
    const row = sheet.rows[i].map((c) => cellToString(c).trim());
    const matches = EXPECTED_HEADERS.every((h) => row.includes(h));
    if (matches) return i;
  }
  return -1;
}

function detect(file: InspectedFile): AdapterDetection {
  for (const sheet of file.sheets) {
    const headerRow = findHeaderRow(sheet);
    if (headerRow >= 0) {
      return { confidence: 1, reason: `Found ABN AMRO column headers in sheet "${sheet.name}".` };
    }
  }
  return { confidence: 0, reason: "No ABN AMRO column headers found." };
}

function parse(file: InspectedFile): { sheetUsed: string; rows: ParsedRowResult[] } {
  for (const sheet of file.sheets) {
    const headerRowIdx = findHeaderRow(sheet);
    if (headerRowIdx < 0) continue;

    const header = sheet.rows[headerRowIdx].map((c) => cellToString(c).trim());
    const col = (name: string) => header.indexOf(name);
    const idx = {
      accountNumber: col("accountNumber"),
      mutationcode: col("mutationcode"),
      transactiondate: col("transactiondate"),
      valuedate: col("valuedate"),
      amount: col("amount"),
      description: col("description"),
    };

    const results: ParsedRowResult[] = [];
    for (let r = headerRowIdx + 1; r < sheet.rows.length; r++) {
      const row = sheet.rows[r];
      const sourceRowNumber = r + 1; // 1-based, matches what a user sees opening the file in Excel
      if (!row || row.every((c) => c === null || c === "")) continue; // skip blank rows silently, not an error

      const rawRow: Record<string, unknown> = Object.fromEntries(header.map((h, i) => [h, row[i] ?? null]));
      const accountNumberRaw = row[idx.accountNumber];
      const accountExternalId = cellToString(accountNumberRaw).replace(/\.0$/, "").trim();
      const currency = cellToString(row[idx.mutationcode]).trim().toUpperCase() || "EUR";
      const transactionDate = parseYyyymmdd(row[idx.transactiondate]);
      const postingDate = parseYyyymmdd(row[idx.valuedate]);
      const amount = parseFlexibleAmount(row[idx.amount]);
      const description = cellToString(row[idx.description]);

      if (!accountExternalId) {
        results.push({
          sourceRowNumber,
          rawRow,
          issue: { type: "missing_field", message: "Row has no account number." },
        });
        continue;
      }
      if (!transactionDate) {
        results.push({
          sourceRowNumber,
          rawRow,
          issue: {
            type: "malformed",
            message: `Transaction date "${cellToString(row[idx.transactiondate])}" could not be parsed as YYYYMMDD.`,
          },
        });
        continue;
      }
      if (amount === null) {
        results.push({
          sourceRowNumber,
          rawRow,
          issue: {
            type: "malformed",
            message: `Amount "${cellToString(row[idx.amount])}" is not a valid number.`,
          },
        });
        continue;
      }
      if (!/^[A-Z]{3}$/.test(currency)) {
        results.push({
          sourceRowNumber,
          rawRow,
          issue: { type: "uncertain_currency", message: `Currency code "${currency}" is not recognized.` },
        });
        continue;
      }

      const looksLikeSavings = looksLikeSavingsRow(description);

      results.push({
        sourceRowNumber,
        rawRow,
        accountTypeHint: looksLikeSavings ? "savings" : "checking",
        accountInstitutionHint: looksLikeSavings ? "abn_amro_savings" : "abn_amro_checking",
        accountDisplayNameHint: `ABN AMRO ${looksLikeSavings ? "Savings" : "Checking"} …${accountExternalId.slice(-4)}`,
        accountCurrencyHint: currency,
        normalized: {
          accountExternalId,
          sourceRowNumber,
          originalRow: rawRow,
          transactionDate,
          postingDate: postingDate ?? undefined,
          merchant: extractMerchant(description) ?? undefined,
          originalDescription: description,
          cleanedDescription: cleanDescription(description) || description,
          // ABN AMRO's own "amount" column already follows this app's sign
          // convention (negative = money left the account) — no flip
          // needed here. Contrast with amexEu.ts, whose source format is
          // inverted. See docs/schema.md "Sign convention".
          originalAmount: amount,
          originalCurrency: currency,
          direction: amount >= 0 ? "credit" : "debit",
        },
      });
    }

    return { sheetUsed: sheet.name, rows: results };
  }
  throw new Error("abnAmro adapter: parse() called without a matching sheet — call detect() first.");
}

export const abnAmroAdapter: InstitutionAdapter = {
  id: "abn_amro",
  label: "ABN AMRO (checking & savings)",
  detect,
  parse,
};
