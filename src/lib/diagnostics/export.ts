/**
 * Sanitized error-log export — the "share this with someone helping you
 * troubleshoot" artifact from the build brief. Deliberately narrower than
 * what the diagnostics page shows on-screen: it drops `stack` entirely
 * (a JS stack trace can include local file-system paths, which is more
 * than a household needs to hand to someone outside the house) and reuses
 * `contextJson` as already written by src/lib/logging/logger.ts, which
 * strips merchant/description/notes at write time (see its
 * `SENSITIVE_KEYS`) — so there's nothing financial left to strip again
 * here. This module only re-shapes already-sanitized rows into a portable
 * file; it does not decide what's sensitive.
 */
import { listRecentLogEntries } from "./queries";

export interface SanitizedLogRow {
  timestamp: string;
  severity: string;
  errorCode: string;
  category: string;
  operation: string;
  message: string;
  context: Record<string, unknown>;
  rootCause: string | null;
}

export function buildSanitizedExportRows(limit = 500): SanitizedLogRow[] {
  return listRecentLogEntries({ limit }).map((e) => {
    let context: Record<string, unknown> = {};
    try {
      context = JSON.parse(e.contextJson);
    } catch {
      context = {};
    }
    return {
      timestamp: e.timestamp,
      severity: e.severity,
      errorCode: e.errorCode,
      category: e.category,
      operation: e.operation,
      message: e.message,
      context,
      rootCause: e.rootCause,
    };
  });
}

export function buildSanitizedExportJson(limit = 500): string {
  const rows = buildSanitizedExportRows(limit);
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      note: "Sanitized diagnostics export — no transaction amounts, merchants, or descriptions are included.",
      entryCount: rows.length,
      entries: rows,
    },
    null,
    2
  );
}
