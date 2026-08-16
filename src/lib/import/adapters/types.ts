/**
 * Institution adapter interface.
 *
 * An adapter's only job is: look at an `InspectedFile` and, if it
 * recognizes the format, turn each row into either a `NormalizedRow` (see
 * src/lib/domain/transaction.ts) or an explained failure. Adapters never
 * touch the database, never know about duplicate detection, and never
 * import React/UI code — see README "Architecture overview". This keeps
 * "add a new institution" to "add one new file here, register it."
 */
import type { InspectedFile } from "../fileInspector";
import type { NormalizedRow } from "../../domain/transaction";
import type { AccountType, Institution } from "../../domain/enums";
import type { ImportRowIssueType } from "../../domain/enums";

export interface RowParseWarning {
  type: ImportRowIssueType;
  message: string;
}

export interface ParsedRowResult {
  sourceRowNumber: number;
  rawRow: Record<string, unknown>;
  /** Present when the row parsed successfully. */
  normalized?: NormalizedRow;
  /** Present when the row could not be turned into a valid transaction. */
  issue?: RowParseWarning;
  /** Best-guess account type/institution/display name for this row's account,
   *  used when the account hasn't been seen before and needs to be created.
   *  Institution may differ from the adapter's own id (e.g. the shared ABN
   *  AMRO parser emits either 'abn_amro_checking' or 'abn_amro_savings' per
   *  row group — see abnAmro.ts). */
  accountTypeHint?: AccountType;
  accountInstitutionHint?: Institution;
  accountDisplayNameHint?: string;
  accountCurrencyHint?: string;
  /** Free-text name of the person the source file attributes this row to
   *  (e.g. Amex's "Kaartlid" cardholder column). The import pipeline
   *  fuzzy-matches this against configured household member names to
   *  suggest ownership — the adapter itself has no knowledge of the
   *  household. */
  suggestedOwnerName?: string;
}

export interface AdapterDetection {
  /** 0 = definitely not this institution, 1 = definitely is. Anything below
   *  the registry's threshold is treated as "not recognized". */
  confidence: number;
  reason: string;
}

export interface InstitutionAdapter {
  /** Stable id, used for storage/telemetry — not necessarily equal to any
   *  one Institution enum value (see abnAmro.ts, which spans two). */
  id: string;
  label: string;
  detect(file: InspectedFile): AdapterDetection;
  /** Parses every data row it can find. Row-level failures are returned as
   *  `issue`s on individual ParsedRowResults, never thrown — a single bad
   *  row must not abort the whole file (build brief §4: "Do not partially
   *  fail without explanation"). Only a structural problem (no recognizable
   *  header at all) should throw. */
  parse(file: InspectedFile): { sheetUsed: string; rows: ParsedRowResult[] };
}
