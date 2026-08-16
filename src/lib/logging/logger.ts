/**
 * Structured local logging.
 *
 * Writes to the `error_log` table (queried by the diagnostics page) and, in
 * development, echoes to the console. Never logs full row contents or raw
 * bank descriptions by default — only sanitized context identifiers (batch
 * id, row number, institution, account id, error code). See
 * `sanitizeContext` and README "Privacy and security".
 */
import { randomUUID } from "node:crypto";
import { db } from "../db/client";
import { errorLog } from "../db/schema";
import { CareraError, type ErrorContext } from "./errors";

type Severity = "info" | "warning" | "error";

const SENSITIVE_KEYS = new Set(["description", "merchant", "rawRow", "originalRow", "notes"]);

function sanitizeContext(context: ErrorContext): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(context)) {
    if (SENSITIVE_KEYS.has(k)) continue;
    out[k] = v;
  }
  return out;
}

export function logError(
  err: CareraError | Error,
  opts?: { severity?: Severity; operation?: string }
) {
  const severity: Severity = opts?.severity ?? "error";
  const isCarera = err instanceof CareraError;
  const record = {
    id: randomUUID(),
    severity,
    errorCode: isCarera ? err.code : "APP_001_UNEXPECTED",
    category: isCarera ? err.category : "rendering",
    operation: opts?.operation ?? "unknown",
    contextJson: JSON.stringify(isCarera ? sanitizeContext(err.context) : {}),
    message: err.message,
    stack: err.stack ?? null,
    rootCause: isCarera && err.cause instanceof Error ? err.cause.message : null,
  };

  try {
    db.insert(errorLog).values(record).run();
  } catch {
    // Logging must never itself crash the app; fall back to console only.
  }

  if (process.env.NODE_ENV !== "production") {
     
    console.error(`[${severity.toUpperCase()}] ${record.errorCode}`, err.message, record.contextJson);
  }
}

export function logInfo(operation: string, message: string, context: ErrorContext = {}) {
  const record = {
    id: randomUUID(),
    severity: "info" as const,
    errorCode: "INFO",
    category: "rendering" as const,
    operation,
    contextJson: JSON.stringify(sanitizeContext(context)),
    message,
    stack: null,
    rootCause: null,
  };
  try {
    db.insert(errorLog).values(record).run();
  } catch {
    // best-effort
  }
}
