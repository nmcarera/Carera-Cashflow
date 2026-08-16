/**
 * Chase (US) adapter — UNVERIFIED against a real export.
 *
 * No representative Chase statement was provided when this was built (see
 * README "How CSV/Excel adapters work"). This adapter targets Chase's
 * long-documented, publicly-described checking CSV export format:
 * `Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #`,
 * amounts signed (negative = debit), currency implicitly USD. It has real
 * unit test coverage against a synthetic fixture built to that shape
 * (tests/fixtures/chase/), but **has never been run against an actual
 * Chase download**. The import UI must surface this adapter as
 * unverified so a real export that doesn't quite match doesn't silently
 * misparse — see `UNVERIFIED = true` below, read by the adapter registry
 * and surfaced in the import preview.
 *
 * When a real sample arrives: re-run tests/fixtures/chase's test against
 * it, fix any column/format mismatches, and flip UNVERIFIED to false.
 */
import type { InspectedFile } from "../fileInspector";
import type { AdapterDetection, InstitutionAdapter, ParsedRowResult } from "./types";
import { parseFlexibleAmount, parseMmDdYyyy, cellToString } from "../numberParsing";
import { cleanDescription } from "../textCleanup";

export const UNVERIFIED = true;

const REQUIRED_HEADERS = ["Posting Date", "Description", "Amount"];

function findHeaderRow(sheet: InspectedFile["sheets"][number]): number {
  for (let i = 0; i < Math.min(sheet.rows.length, 5); i++) {
    const row = sheet.rows[i].map((c) => cellToString(c).trim());
    if (REQUIRED_HEADERS.every((h) => row.includes(h))) return i;
  }
  return -1;
}

function detect(file: InspectedFile): AdapterDetection {
  for (const sheet of file.sheets) {
    if (findHeaderRow(sheet) >= 0) {
      return {
        confidence: 0.9, // never 1.0 — this format is unverified against a real export
        reason: `Found Chase-shaped column headers in sheet "${sheet.name}" (unverified adapter).`,
      };
    }
  }
  return { confidence: 0, reason: "No Chase-shaped column headers found." };
}

function parse(file: InspectedFile): { sheetUsed: string; rows: ParsedRowResult[] } {
  for (const sheet of file.sheets) {
    const headerRowIdx = findHeaderRow(sheet);
    if (headerRowIdx < 0) continue;

    const header = sheet.rows[headerRowIdx].map((c) => cellToString(c).trim());
    const col = (name: string) => header.indexOf(name);
    const idx = {
      postingDate: col("Posting Date"),
      description: col("Description"),
      amount: col("Amount"),
      type: col("Type"),
    };

    const results: ParsedRowResult[] = [];
    for (let r = headerRowIdx + 1; r < sheet.rows.length; r++) {
      const row = sheet.rows[r];
      const sourceRowNumber = r + 1;
      if (!row || row.every((c) => c === null || c === "")) continue;

      const rawRow: Record<string, unknown> = Object.fromEntries(header.map((h, i) => [h, row[i] ?? null]));
      const postingDate = parseMmDdYyyy(row[idx.postingDate]);
      const amount = parseFlexibleAmount(row[idx.amount]);
      const description = cellToString(row[idx.description]);

      if (!postingDate) {
        results.push({
          sourceRowNumber,
          rawRow,
          issue: {
            type: "malformed",
            message: `Posting date "${cellToString(row[idx.postingDate])}" could not be parsed as MM/DD/YYYY.`,
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

      results.push({
        sourceRowNumber,
        rawRow,
        accountTypeHint: "checking",
        accountInstitutionHint: "chase_us",
        accountDisplayNameHint: "Chase Checking (US)",
        accountCurrencyHint: "USD",
        normalized: {
          // Chase's own CSV export has no account-identifier column, so
          // every Chase file is currently attributed to one default
          // account. If the household has more than one Chase account,
          // this will incorrectly merge them until either a real sample
          // reveals an identifying field we're missing, or the import UI's
          // "select an account" step (build brief §4 step 1) is used to
          // route a given file to the right account explicitly.
          accountExternalId: "chase-us-default",
          sourceRowNumber,
          originalRow: rawRow,
          transactionDate: postingDate,
          originalDescription: description,
          cleanedDescription: cleanDescription(description) || description,
          // Chase's "Amount" column already follows this app's sign
          // convention (negative = money left the account).
          originalAmount: amount,
          originalCurrency: "USD",
          direction: amount >= 0 ? "credit" : "debit",
        },
      });
    }

    return { sheetUsed: sheet.name, rows: results };
  }
  throw new Error("chaseUs adapter: parse() called without a matching sheet — call detect() first.");
}

export const chaseUsAdapter: InstitutionAdapter = {
  id: "chase_us",
  label: "Chase (US) — unverified, no real sample provided",
  detect,
  parse,
};
