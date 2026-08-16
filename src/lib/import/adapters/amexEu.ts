/**
 * EU American Express adapter.
 *
 * Built and verified against six real (redacted) monthly statement exports.
 * Notable, non-obvious things learned from those real files and encoded
 * here:
 *
 * - The export is a multi-sheet `.xlsx` workbook. The transaction detail
 *   lives on the "Details van de verrichting" sheet (Dutch: "transaction
 *   details"); a second "Transactieoverzicht" (overview) sheet has only
 *   summary totals and is ignored.
 * - The header block above the data (rows 0–5) states a single card number
 *   ("Kaartnummer") shared by every row in the file, even though the
 *   per-row "Rekening #" column can differ — this is a card with
 *   supplementary cardholders (e.g. both members of a household) billed to
 *   one account. We use the header block's card number as the account
 *   external id, so all months land on one account rather than one per
 *   physical card.
 * - The per-row "Kaartlid" (cardholder) column is a real signal for
 *   ownership: it names the household member who made that specific
 *   purchase. We surface it as a suggestion the import pipeline can match
 *   against configured household member names — never as a hard-coded
 *   assumption about who's on the card.
 * - Amounts ("Bedrag") are already in EUR, the card's billing currency —
 *   *not* the original purchase currency. Foreign purchases carry a
 *   free-text "Foreign Spend Amount: X <currency>" note in "Aanvullende
 *   informatie" instead of a separate column. We treat the EUR "Bedrag" as
 *   this transaction's `originalAmount`/`originalCurrency` (it's what
 *   actually posted to the account), and preserve the foreign-currency
 *   detail in the raw row and a note rather than overriding the account's
 *   native currency — see docs/schema.md.
 * - Positive amounts are purchases (debits); negative amounts are payments,
 *   credits, and refunds. Rows whose description matches a payment-receipt
 *   pattern ("HARTELIJK BEDANKT VOOR UW BETALING" / "THANK YOU FOR YOUR
 *   PAYMENT") are the household's own payment settling the card balance —
 *   these are marked `direction: 'transfer'` so they are never double
 *   counted as household income (build brief §5).
 * - One statement observed an extra "Categorie" column not present in the
 *   others — columns are matched by name, not position, so this doesn't
 *   break parsing.
 */
import type { InspectedFile } from "../fileInspector";
import type { AdapterDetection, InstitutionAdapter, ParsedRowResult } from "./types";
import { parseFlexibleAmount, parseMmDdYyyy, cellToString } from "../numberParsing";
import { cleanDescription } from "../textCleanup";

const REQUIRED_HEADERS = ["Datum", "Omschrijving", "Bedrag"];
const PAYMENT_RECEIPT_PATTERNS = [
  /hartelijk bedankt voor uw betaling/i,
  /thank you for your payment/i,
];

function findHeaderRow(sheet: InspectedFile["sheets"][number]): number {
  for (let i = 0; i < Math.min(sheet.rows.length, 15); i++) {
    const row = sheet.rows[i].map((c) => cellToString(c).trim());
    if (REQUIRED_HEADERS.every((h) => row.includes(h))) return i;
  }
  return -1;
}

function findCardNumber(sheet: InspectedFile["sheets"][number], headerRowIdx: number): string | null {
  for (let i = 0; i < headerRowIdx; i++) {
    const cell = cellToString(sheet.rows[i]?.[0]).trim();
    if (/^X{4}-X{6}-\d{5}$/.test(cell)) return cell;
  }
  return null;
}

function detect(file: InspectedFile): AdapterDetection {
  for (const sheet of file.sheets) {
    const headerRowIdx = findHeaderRow(sheet);
    if (headerRowIdx >= 0) {
      return { confidence: 1, reason: `Found Amex transaction detail headers in sheet "${sheet.name}".` };
    }
  }
  return { confidence: 0, reason: "No Amex transaction detail headers found in any sheet." };
}

function parse(file: InspectedFile): { sheetUsed: string; rows: ParsedRowResult[] } {
  for (const sheet of file.sheets) {
    const headerRowIdx = findHeaderRow(sheet);
    if (headerRowIdx < 0) continue;

    const header = sheet.rows[headerRowIdx].map((c) => cellToString(c).trim());
    const col = (name: string) => header.indexOf(name);
    const idx = {
      datum: col("Datum"),
      omschrijving: col("Omschrijving"),
      kaartlid: col("Kaartlid"),
      bedrag: col("Bedrag"),
      aanvullend: col("Aanvullende informatie"),
    };

    const cardNumber = findCardNumber(sheet, headerRowIdx);
    const accountExternalId = cardNumber ?? `amex-eu-${file.fileHash.slice(0, 8)}`;

    const results: ParsedRowResult[] = [];
    for (let r = headerRowIdx + 1; r < sheet.rows.length; r++) {
      const row = sheet.rows[r];
      const sourceRowNumber = r + 1;
      if (!row || row.every((c) => c === null || c === "")) continue;
      // The sheet has trailing summary rows after the last transaction with
      // no date — stop rather than misreading them as malformed transactions.
      if (!cellToString(row[idx.datum]).trim()) break;

      const rawRow: Record<string, unknown> = Object.fromEntries(header.map((h, i) => [h, row[i] ?? null]));
      const transactionDate = parseMmDdYyyy(row[idx.datum]);
      const amount = parseFlexibleAmount(row[idx.bedrag]);
      const description = cellToString(row[idx.omschrijving]);
      const cardholder = idx.kaartlid >= 0 ? cellToString(row[idx.kaartlid]).trim() : "";
      const extra = idx.aanvullend >= 0 ? cellToString(row[idx.aanvullend]) : "";

      if (!transactionDate) {
        results.push({
          sourceRowNumber,
          rawRow,
          issue: {
            type: "malformed",
            message: `Date "${cellToString(row[idx.datum])}" could not be parsed as MM/DD/YYYY.`,
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
            message: `Amount "${cellToString(row[idx.bedrag])}" is not a valid number.`,
          },
        });
        continue;
      }

      const isPaymentReceipt = PAYMENT_RECEIPT_PATTERNS.some((p) => p.test(description));
      const foreignSpendMatch = extra.match(/Foreign Spend Amount:\s*([\d.,]+)\s+([A-Za-z ]+?)\s+Commission/);

      const noteParts: string[] = [];
      if (foreignSpendMatch) {
        noteParts.push(
          `Originally charged as ${foreignSpendMatch[1]} ${foreignSpendMatch[2].trim()} before Amex's own conversion to EUR.`
        );
      }

      // Canonical sign convention used throughout this app (see
      // docs/schema.md "Sign convention"): negative = money left this
      // account, positive = money entered it. Amex's own "Bedrag" is the
      // opposite of that (positive = a charge/purchase), so we flip it
      // here. The untouched printed value is still preserved in `rawRow`.
      const canonicalAmount = -amount;
      const direction = isPaymentReceipt ? "transfer" : canonicalAmount >= 0 ? "credit" : "debit";

      results.push({
        sourceRowNumber,
        rawRow,
        accountTypeHint: "credit_card",
        accountInstitutionHint: "amex_eu",
        accountDisplayNameHint: cardNumber ? `Amex EU …${cardNumber.slice(-5)}` : "Amex EU card",
        accountCurrencyHint: "EUR",
        suggestedOwnerName: cardholder || undefined,
        normalized: {
          accountExternalId,
          sourceRowNumber,
          originalRow: rawRow,
          transactionDate,
          merchant: description.trim() ? description.trim().split(/\s{2,}/)[0].trim() : undefined,
          originalDescription: description,
          cleanedDescription: cleanDescription(description) || description,
          originalAmount: canonicalAmount,
          originalCurrency: "EUR",
          // Payment-receipt rows are reclassified as transfers so they
          // never inflate household income (build brief §5) — the import
          // pipeline also surfaces them for confirmation like any other
          // suggested transfer.
          direction,
          providedEurAmount: canonicalAmount,
        },
      });

      if (noteParts.length > 0) {
        results[results.length - 1].normalized!.originalRow = {
          ...rawRow,
          _careraNote: noteParts.join(" "),
        };
      }
    }

    return { sheetUsed: sheet.name, rows: results };
  }
  throw new Error("amexEu adapter: parse() called without a matching sheet — call detect() first.");
}

export const amexEuAdapter: InstitutionAdapter = {
  id: "amex_eu",
  label: "American Express (EU)",
  detect,
  parse,
};
