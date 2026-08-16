/**
 * Shared "is this actually a Carera Cash Flow SQLite backup" check, used by
 * both the in-app upload validation (src/app/diagnostics/actions.ts) and
 * the CLI restore script (scripts/restore.ts) — one place decides what
 * counts as a valid backup so the two can't quietly drift apart.
 */
import fs from "node:fs";
import Database from "better-sqlite3";

export const EXPECTED_TABLES = [
  "accounts",
  "transactions",
  "categories",
  "priorities",
  "household_members",
  "import_batches",
  "rules",
];

export type BackupValidation = { ok: true; tableCount: number } | { ok: false; reason: string };

export function validateSqliteBackupFile(filePath: string): BackupValidation {
  let db: Database.Database;
  try {
    db = new Database(filePath, { readonly: true, fileMustExist: true });
  } catch (err) {
    return { ok: false, reason: `Not a readable SQLite file: ${err instanceof Error ? err.message : String(err)}` };
  }

  try {
    // better-sqlite3's constructor opens lazily — a file that isn't really
    // a SQLite database (garbage bytes, a truncated download, some other
    // file entirely) only fails once a real query runs, and that failure
    // is a raw, uncaught-by-default SqliteError. Without this catch, a bad
    // upload would crash the CLI script instead of being reported as an
    // ordinary "this isn't a valid backup" result.
    const integrity = db.pragma("integrity_check") as { integrity_check: string }[];
    if (integrity.length !== 1 || integrity[0].integrity_check !== "ok") {
      return { ok: false, reason: `SQLite integrity check failed: ${JSON.stringify(integrity)}` };
    }

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
    const tableNames = new Set(tables.map((r) => r.name));
    const missing = EXPECTED_TABLES.filter((t) => !tableNames.has(t));
    if (missing.length > 0) {
      return {
        ok: false,
        reason: `Missing expected table(s): ${missing.join(", ")} — this doesn't look like a Carera Cash Flow database.`,
      };
    }
    return { ok: true, tableCount: tableNames.size };
  } catch (err) {
    return { ok: false, reason: `Not a valid SQLite database: ${err instanceof Error ? err.message : String(err)}` };
  } finally {
    db.close();
    // A backup produced by better-sqlite3's `.backup()` carries the source
    // database's `journal_mode = WAL` setting in its header — merely
    // *opening* it here (even read-only) makes SQLite create -wal/-shm
    // sidecar files next to it. Those aren't part of the backup itself and
    // would otherwise sit in data/pending-restore/ looking like extra,
    // separate staged files (see listStagedBackups) — clean them up.
    for (const suffix of ["-wal", "-shm"]) {
      fs.rmSync(filePath + suffix, { force: true });
    }
  }
}
