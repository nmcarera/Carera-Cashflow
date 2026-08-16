/**
 * Generates the synthetic test fixtures under tests/fixtures/*. Run with
 * `npx tsx tests/fixtures/generate.ts` after changing what a fixture needs
 * to cover. Every value here is invented — no real household data. Column
 * headers, date formats, decimal formatting, and quoting/multi-sheet
 * structure were shaped to match real (redacted) sample exports we
 * inspected while building the adapters (see README "How CSV/Excel
 * adapters work"), without reproducing any of their actual content.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";

const ROOT = path.join(__dirname);

function ensureDir(p: string) {
  mkdirSync(p, { recursive: true });
}

// ---------------------------------------------------------------------------
// ABN AMRO — CSV fixtures (exercises decimal-comma / YYYYMMDD string parsing,
// quoted fields with embedded commas, UTF-8 Dutch merchant names, malformed
// rows that must be quarantined rather than guessed at).
// ---------------------------------------------------------------------------

const abnDir = path.join(ROOT, "abn-amro-checking");
ensureDir(abnDir);

const abnHeader = "accountNumber,mutationcode,transactiondate,valuedate,startsaldo,endsaldo,amount,description";
const abnRows = [
  // Normal checking rows, decimal comma, no thousands separator.
  `111222333,EUR,20260103,20260103,"1.000,00","954,50","-45,50","Albert Heijn boodschappen, Café Central AMSTERDAM"`,
  `111222333,EUR,20260105,20260105,"954,50","904,50","-50,00","SEPA Overboeking IBAN: NL12ABNA0123456789 Naam: J. de Wit"`,
  // Salary: decimal comma with thousands separator.
  `111222333,EUR,20260125,20260125,"904,50","3.404,50","2.500,00","SEPA Overboeking Naam: Werkgever B.V. Salaris januari"`,
  // Malformed amount (brief's own worked example, letter in place of a digit).
  `111222333,EUR,20260128,20260128,"3.404,50","3.404,50","1.200,5O","SEPA Overboeking Naam: Onbekend"`,
  // Malformed date.
  `111222333,EUR,2026-01-30,20260130,"3.404,50","3.380,00","-24,50","Jumbo boodschappen"`,
  // A different account in the SAME file — multi-account export.
  `999888777,EUR,20260103,20260103,"5.000,00","5.000,00","3,47","ACCOUNT BALANCED  CREDIT INTEREST  3,47C from 30.09.2025 to 31.12.2025  Direct Savings"`,
  `999888777,EUR,20260110,20260110,"5.003,47","4.503,47","-500,00","SEPA Overboeking IBAN: NL77ABNA0111222333 Naam: Personal account"`,
  // A row whose counterparty is literally named "Direct Savings" but which
  // belongs to the CHECKING account above — regression fixture for the
  // false-positive savings-classification bug found against real data.
  `111222333,EUR,20260112,20260112,"3.380,00","2.880,00","-500,00","SEPA Overboeking IBAN: NL07ABNA0999888777 Naam: Direct Savings"`,
];
writeFileSync(path.join(abnDir, "sample.csv"), [abnHeader, ...abnRows].join("\n") + "\n", "utf-8");

// A second, overlapping export (same account, overlapping date range) to
// exercise duplicate detection across two imports.
const abnOverlapRows = [
  `111222333,EUR,20260125,20260125,"904,50","3.404,50","2.500,00","SEPA Overboeking Naam: Werkgever B.V. Salaris januari"`, // duplicate of row 3 above
  `111222333,EUR,20260202,20260202,"3.380,00","3.280,00","-100,00","Albert Heijn boodschappen"`, // new
];
writeFileSync(
  path.join(abnDir, "sample-overlap.csv"),
  [abnHeader, ...abnOverlapRows].join("\n") + "\n",
  "utf-8"
);

// ---------------------------------------------------------------------------
// EU American Express — real .xlsx multi-sheet structure (Details van de
// verrichting + Transactieoverzicht), header row starting at index 6,
// two cardholders, a payment-receipt settlement row, a foreign-spend row.
// ---------------------------------------------------------------------------

const amexDir = path.join(ROOT, "amex-eu");
ensureDir(amexDir);

const detailHeader = [
  "Datum",
  "Omschrijving",
  "Kaartlid",
  "Rekening #",
  "Bedrag",
  "Aanvullende informatie",
  "Vermeld op uw rekeningoverzicht als",
  "Adres",
  "Plaats",
  "Postcode",
  "Land",
  "Referentie",
];

const detailRows: (string | number)[][] = [
  ["Transactieoverzicht", "Sample Card / 21 Jan, 2026 tot 20 Feb, 2026", "", "", "", "", "", "", "", "", "", ""],
  ["Voor", "", "", "", "", "", "", "", "", "", "", ""],
  ["TEST CARDHOLDER ONE", "", "", "", "", "", "", "", "", "", "", ""],
  ["Kaartnummer", "", "", "", "", "", "", "", "", "", "", ""],
  ["XXXX-XXXXXX-99001", "", "", "", "", "", "", "", "", "", "", ""],
  ["", "", "", "", "", "", "", "", "", "", "", ""],
  detailHeader,
  ["02/15/2026", "COFFEE SHOP DE PLANTAGE", "TEST CARDHOLDER ONE", "-99001", 4.6, "", "COFFEE SHOP DE PLANTAGE", "Plantage 1", "Amsterdam", "1018AB", "NETHERLANDS", "REF001"],
  ["02/10/2026", "ONLINE STORE US", "TEST CARDHOLDER TWO", "-99002", 45.2, "Foreign Spend Amount: 49.99 Amerikaanse dollar Commission Amount: 0.95 Currency Exchange Rate: 1.108", "ONLINE STORE US", "1 Market St", "San Francisco", "94105", "UNITED STATES", "REF002"],
  ["01/26/2026", "HARTELIJK BEDANKT VOOR UW BETALING", "TEST CARDHOLDER ONE", "-99001", -1200.5, "", "HARTELIJK BEDANKT VOOR UW BETALING", "", "", "", "", "REF003"],
  ["02/01/2026", "REFUND ONLINE STORE NL", "TEST CARDHOLDER TWO", "-99002", -19.99, "", "REFUND ONLINE STORE NL", "", "", "", "", "REF004"],
  ["not-a-date", "MALFORMED ROW", "TEST CARDHOLDER ONE", "-99001", 10, "", "MALFORMED ROW", "", "", "", "", "REF005"],
];

const overviewRows = [
  ["Transactieoverzicht", "Sample Card / 21 Jan, 2026 tot 20 Feb, 2026", "", ""],
  ["Voor", "", "", ""],
  ["TEST CARDHOLDER ONE", "", "", ""],
  ["Overzicht", "", "", ""],
  ["", "Totaal", "", ""],
  ["Vorig saldo", 500, "", ""],
];

const amexWb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(amexWb, XLSX.utils.aoa_to_sheet(detailRows), "Details van de verrichting");
XLSX.utils.book_append_sheet(amexWb, XLSX.utils.aoa_to_sheet(overviewRows), "Transactieoverzicht");
XLSX.writeFile(amexWb, path.join(amexDir, "sample.xlsx"));

// ---------------------------------------------------------------------------
// Chase (US) — unverified format, synthetic only. See adapters/chaseUs.ts.
// ---------------------------------------------------------------------------

const chaseDir = path.join(ROOT, "chase");
ensureDir(chaseDir);
const chaseHeader = "Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #";
const chaseRows = [
  `DEBIT,01/15/2026,"COFFEE SHOP, MAIN ST",-4.50,DEBIT_CARD,1995.50,`,
  `DEBIT,01/16/2026,GROCERY STORE,-62.10,DEBIT_CARD,1933.40,`,
  `CREDIT,01/20/2026,PAYROLL DEPOSIT,2000.00,ACH_CREDIT,3933.40,`,
  `DEBIT,not-a-date,BAD ROW,-10.00,DEBIT_CARD,3923.40,`,
];
writeFileSync(path.join(chaseDir, "sample.csv"), [chaseHeader, ...chaseRows].join("\n") + "\n", "utf-8");

 
console.log("Fixtures written to tests/fixtures/{abn-amro-checking,amex-eu,chase}/");
