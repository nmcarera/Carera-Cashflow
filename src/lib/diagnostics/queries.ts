/**
 * Read-only diagnostics data: row counts, database file size, migration
 * status, and the structured error/info log. This is the one place the
 * /diagnostics page reads from, mirroring the analytics/settings query
 * modules — UI code goes through here, not raw schema access.
 */
import fs from "node:fs";
import path from "node:path";
import { sql, desc, and, eq } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { db, sqlite } from "../db/client";
import {
  transactions,
  accounts,
  importBatches,
  rules,
  categories,
  priorities,
  householdMembers,
  savingsGoals,
  exchangeRates,
  auditLog,
  errorLog,
} from "../db/schema";

// The better-sqlite3 driver is synchronous everywhere else in this codebase
// (.all()/.get()/.run(), never await) — drizzle's `$count()` helper returns
// a thenable builder instead of a plain number, which doesn't fit that
// pattern, so a small raw count-query helper is used instead, same shape as
// `countByReviewStatus` in db/queries.ts.
function countOf(table: SQLiteTable): number {
  const row = db.select({ count: sql<number>`count(*)` }).from(table).get();
  return row?.count ?? 0;
}

export interface DbStats {
  dbPath: string;
  dbFileSizeBytes: number | null;
  transactions: number;
  accounts: number;
  importBatches: number;
  rules: number;
  categories: number;
  priorities: number;
  householdMembers: number;
  savingsGoals: number;
  exchangeRates: number;
  auditLogEntries: number;
  errorLogEntries: number;
}

export function getDbStats(): DbStats {
  const dbPath = sqlite.name;
  let dbFileSizeBytes: number | null = null;
  try {
    dbFileSizeBytes = fs.statSync(dbPath).size;
  } catch {
    dbFileSizeBytes = null;
  }

  return {
    dbPath,
    dbFileSizeBytes,
    transactions: countOf(transactions),
    accounts: countOf(accounts),
    importBatches: countOf(importBatches),
    rules: countOf(rules),
    categories: countOf(categories),
    priorities: countOf(priorities),
    householdMembers: countOf(householdMembers),
    savingsGoals: countOf(savingsGoals),
    exchangeRates: countOf(exchangeRates),
    auditLogEntries: countOf(auditLog),
    errorLogEntries: countOf(errorLog),
  };
}

export interface MigrationStatus {
  appliedCount: number;
  definedCount: number;
  upToDate: boolean;
  lastAppliedAt: string | null;
}

/** Compares the `__drizzle_migrations` bookkeeping table (what's actually
 *  been applied to this database file) against drizzle/meta/_journal.json
 *  (what migrations this checkout of the code defines) — a mismatch means
 *  `npm run db:migrate` needs to run before the app can be trusted to match
 *  the current schema. Read-only and best-effort: a missing/malformed
 *  journal file degrades to "unknown" rather than throwing, since this is a
 *  diagnostics page, not a load-bearing path. */
export function getMigrationStatus(): MigrationStatus {
  let appliedCount = 0;
  let lastAppliedAt: string | null = null;
  try {
    const rows = sqlite
      .prepare("SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC")
      .all() as { created_at: number }[];
    appliedCount = rows.length;
    lastAppliedAt = rows[0] ? new Date(rows[0].created_at).toISOString() : null;
  } catch {
    appliedCount = 0;
  }

  let definedCount = 0;
  try {
    const journalPath = path.join(process.cwd(), "drizzle", "meta", "_journal.json");
    const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8")) as { entries: unknown[] };
    definedCount = journal.entries.length;
  } catch {
    definedCount = appliedCount; // Unknown — don't claim a false mismatch.
  }

  return { appliedCount, definedCount, upToDate: appliedCount >= definedCount, lastAppliedAt };
}

export interface ErrorLogEntry {
  id: string;
  timestamp: string;
  severity: string;
  errorCode: string;
  category: string;
  operation: string;
  message: string;
  contextJson: string;
  rootCause: string | null;
}

export function listRecentLogEntries(opts?: { limit?: number; severity?: string | null }): ErrorLogEntry[] {
  const limit = opts?.limit ?? 100;
  const conditions = [];
  if (opts?.severity) conditions.push(eq(errorLog.severity, opts.severity));

  return db
    .select({
      id: errorLog.id,
      timestamp: errorLog.timestamp,
      severity: errorLog.severity,
      errorCode: errorLog.errorCode,
      category: errorLog.category,
      operation: errorLog.operation,
      message: errorLog.message,
      contextJson: errorLog.contextJson,
      rootCause: errorLog.rootCause,
    })
    .from(errorLog)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(errorLog.timestamp))
    .limit(limit)
    .all();
}

export function logSeverityCounts(): Record<string, number> {
  const rows = db
    .select({ severity: errorLog.severity, count: sql<number>`count(*)` })
    .from(errorLog)
    .groupBy(errorLog.severity)
    .all();
  const out: Record<string, number> = { info: 0, warning: 0, error: 0 };
  for (const r of rows) out[r.severity] = r.count;
  return out;
}

export interface StagedBackup {
  stagedPath: string;
  fileName: string;
  sizeBytes: number;
}

/** Backup files uploaded via /diagnostics and validated, waiting for
 *  `npm run db:restore` to be run with the app stopped — see
 *  src/app/diagnostics/actions.ts and scripts/restore.ts. */
export function listStagedBackups(): StagedBackup[] {
  const dir = path.join(process.cwd(), "data", "pending-restore");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    // Defense in depth against SQLite -wal/-shm sidecar files that opening
    // a staged file for validation can create (see restoreValidation.ts,
    // which cleans these up itself, but a listing should never trust that
    // as its only guard against showing a WAL file as if it were its own
    // staged backup).
    .filter((fileName) => !fileName.endsWith("-wal") && !fileName.endsWith("-shm"))
    .map((fileName) => {
      const stagedPath = path.join(dir, fileName);
      const stat = fs.statSync(stagedPath);
      return { stagedPath, fileName, sizeBytes: stat.size };
    });
}
