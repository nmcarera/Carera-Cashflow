/**
 * Flexible, but never-silently-wrong, parsing of monetary values and dates
 * from spreadsheet cells. Every institution formats these differently
 * (decimal comma vs decimal point, DD/MM vs MM/DD, YYYYMMDD integers…) and
 * getting this wrong silently produces incorrect totals — the build brief's
 * #1 priority. When a value doesn't unambiguously match a known pattern,
 * these functions return `null` rather than guessing; callers turn that
 * into a quarantined row with a specific, actionable message (see build
 * brief §13's worked example: "the amount '1.200,5O' is not a valid
 * number").
 */
import type { SheetCell } from "./fileInspector";

/** Parses a monetary amount that may already be numeric (typical when read
 *  from .xls/.xlsx, where the bank encoded it as a real number) or a string
 *  in either European (1.234,56) or US (1,234.56) decimal formatting. */
export function parseFlexibleAmount(cell: SheetCell): number | null {
  if (typeof cell === "number") {
    return Number.isFinite(cell) ? cell : null;
  }
  if (cell === null || cell === undefined) return null;
  const raw = String(cell).trim().replace(/\s/g, "");
  if (raw === "") return null;

  // European: thousands with '.', decimal with ',' — e.g. -1.200,50
  if (/^-?\d{1,3}(\.\d{3})*,\d{1,2}$/.test(raw)) {
    return Number(raw.replace(/\./g, "").replace(",", "."));
  }
  // US: thousands with ',', decimal with '.' — e.g. -1,200.50
  if (/^-?\d{1,3}(,\d{3})*\.\d{1,2}$/.test(raw)) {
    return Number(raw.replace(/,/g, ""));
  }
  // Plain decimal comma, no thousands separator — e.g. -22,99
  if (/^-?\d+,\d{1,2}$/.test(raw)) {
    return Number(raw.replace(",", "."));
  }
  // Plain decimal point, no thousands separator — e.g. -22.99
  if (/^-?\d+\.\d{1,2}$/.test(raw)) {
    return Number(raw);
  }
  // Plain integer
  if (/^-?\d+$/.test(raw)) {
    return Number(raw);
  }
  // Anything else (e.g. "1.200,5O" with a letter in place of a digit) is
  // deliberately NOT guessed at.
  return null;
}

/** Parses an 8-digit YYYYMMDD value (ABN AMRO's date encoding), whether it
 *  arrives as a number (620102... in .xls) or a string. */
export function parseYyyymmdd(cell: SheetCell): string | null {
  const raw = typeof cell === "number" ? String(Math.trunc(cell)) : String(cell ?? "").trim();
  if (!/^\d{8}$/.test(raw)) return null;
  const year = raw.slice(0, 4);
  const month = raw.slice(4, 6);
  const day = raw.slice(6, 8);
  const iso = `${year}-${month}-${day}`;
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) return null;
  return iso;
}

/** Parses MM/DD/YYYY (US-style, used by both EU Amex and Chase exports). */
export function parseMmDdYyyy(cell: SheetCell): string | null {
  const raw = String(cell ?? "").trim();
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  const iso = `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) return null;
  return iso;
}

export function cellToString(cell: SheetCell): string {
  if (cell === null || cell === undefined) return "";
  return String(cell);
}
