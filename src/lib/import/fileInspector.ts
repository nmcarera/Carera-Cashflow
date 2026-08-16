/**
 * Generic file inspection — the first step of every import, before any
 * institution-specific logic runs (build brief §4: "Parse the file without
 * immediately saving transactions").
 *
 * Supports CSV, and both legacy `.xls` (BIFF) and modern `.xlsx` (OOXML)
 * spreadsheets, because that is what our target institutions actually
 * export (ABN AMRO's own "download as CSV" produces `.xls`; EU Amex
 * produces `.xlsx`) — see build brief §20: adapt to the bank's actual
 * export, don't ask the household to reformat it.
 *
 * This module only reads the file into a normalized grid-of-sheets shape
 * plus basic safety checks. It has no opinion about which institution
 * produced the file — that's the adapter registry's job
 * (src/lib/import/adapters/registry.ts).
 */
import * as XLSX from "xlsx";
import Papa from "papaparse";
import { CareraError } from "../logging/errors";

export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB
export const MAX_ROWS_PER_SHEET = 50_000;

export type SheetCell = string | number | boolean | null;

export interface InspectedSheet {
  name: string;
  /** Raw grid, rows[0] is not necessarily a header — adapters decide where their header row lives. */
  rows: SheetCell[][];
}

export interface InspectedFile {
  fileName: string;
  fileHash: string;
  kind: "csv" | "excel";
  sheets: InspectedSheet[];
}

function isCsvExtension(fileName: string): boolean {
  return /\.(csv|txt)$/i.test(fileName);
}

function isExcelExtension(fileName: string): boolean {
  return /\.(xlsx|xls|xlsm)$/i.test(fileName);
}

async function sha256(buffer: Buffer): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(buffer).digest("hex");
}

function parseCsvBuffer(buffer: Buffer): SheetCell[][] {
  // Try UTF-8 first; ABN/Amex-style exports are UTF-8, but fall back to
  // latin1 if decoding produces replacement characters (common with older
  // Windows-exported CSVs containing e.g. "ë" or "ü" in Dutch merchant names).
  let text = buffer.toString("utf-8");
  if (text.includes("�")) {
    text = buffer.toString("latin1");
  }
  const result = Papa.parse<string[]>(text, {
    skipEmptyLines: false,
    dynamicTyping: false,
  });
  if (result.errors.some((e) => e.type === "Delimiter")) {
    throw new CareraError({
      code: "CSV_001_UNREADABLE",
      category: "csv_parsing",
      detail: result.errors[0]?.message,
    });
  }
  return result.data as SheetCell[][];
}

function parseExcelBuffer(fileName: string, buffer: Buffer): InspectedSheet[] {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer", raw: true, cellDates: false });
  } catch (err) {
    throw new CareraError({
      code: "CSV_001_UNREADABLE",
      category: "csv_parsing",
      context: { fileName },
      cause: err,
      detail: "The spreadsheet could not be opened. It may be corrupted or password-protected.",
    });
  }
  return workbook.SheetNames.map((name) => {
    const ws = workbook.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<SheetCell[]>(ws, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: true,
    });
    return { name, rows };
  });
}

export async function inspectFile(fileName: string, buffer: Buffer): Promise<InspectedFile> {
  if (buffer.length === 0) {
    throw new CareraError({
      code: "FILE_004_EMPTY",
      category: "file_access",
      context: { fileName },
    });
  }
  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    throw new CareraError({
      code: "FILE_002_TOO_LARGE",
      category: "file_access",
      context: { fileName },
      detail: `File is ${(buffer.length / 1024 / 1024).toFixed(1)} MB; the limit is ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB.`,
    });
  }

  const fileHash = await sha256(buffer);

  let kind: "csv" | "excel";
  let sheets: InspectedSheet[];
  if (isExcelExtension(fileName)) {
    kind = "excel";
    sheets = parseExcelBuffer(fileName, buffer);
  } else if (isCsvExtension(fileName)) {
    kind = "csv";
    sheets = [{ name: "csv", rows: parseCsvBuffer(buffer) }];
  } else {
    // Unknown extension: sniff by content. Excel files have a recognizable
    // binary signature; anything else we attempt as CSV/text.
    const isZip = buffer.subarray(0, 2).toString("hex") === "504b"; // xlsx = zip
    const isCfb = buffer.subarray(0, 4).toString("hex") === "d0cf11e0"; // legacy xls
    if (isZip || isCfb) {
      kind = "excel";
      sheets = parseExcelBuffer(fileName, buffer);
    } else {
      kind = "csv";
      sheets = [{ name: "csv", rows: parseCsvBuffer(buffer) }];
    }
  }

  for (const sheet of sheets) {
    if (sheet.rows.length > MAX_ROWS_PER_SHEET) {
      throw new CareraError({
        code: "FILE_003_TOO_MANY_ROWS",
        category: "file_access",
        context: { fileName },
        detail: `Sheet "${sheet.name}" has ${sheet.rows.length} rows; the limit is ${MAX_ROWS_PER_SHEET}.`,
      });
    }
  }

  const nonEmptySheets = sheets.filter((s) => s.rows.some((r) => r.some((c) => c !== null && c !== "")));
  if (nonEmptySheets.length === 0) {
    throw new CareraError({ code: "FILE_004_EMPTY", category: "file_access", context: { fileName } });
  }

  return { fileName, fileHash, kind, sheets };
}
