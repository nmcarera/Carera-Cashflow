/**
 * validateSqliteBackupFile is the one gate between "a file someone
 * uploaded on the /diagnostics page" and either a) staging it for restore
 * or b) telling the CLI restore script (scripts/restore.ts) it's safe to
 * overwrite the live database. Both of the failure modes here were real
 * bugs caught by hand while building this feature: an obviously-invalid
 * file crashed the CLI script instead of being reported (better-sqlite3
 * opens lazily, so the failure only surfaces on the first real query), and
 * opening a valid backup for validation silently left stray -wal/-shm
 * sidecar files behind that made one staged backup look like three.
 */
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { validateSqliteBackupFile, EXPECTED_TABLES } from "../src/lib/diagnostics/restoreValidation";

const tmpFiles: string[] = [];

function tmpDbPath(): string {
  const p = path.join(os.tmpdir(), `carera-restore-test-${randomUUID()}.db`);
  tmpFiles.push(p);
  return p;
}

function createValidBackup(): string {
  const p = tmpDbPath();
  const db = new Database(p);
  for (const table of EXPECTED_TABLES) {
    db.exec(`CREATE TABLE ${table} (id TEXT PRIMARY KEY)`);
  }
  db.close();
  return p;
}

afterEach(() => {
  for (const f of tmpFiles.splice(0)) {
    for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(f + suffix, { force: true });
  }
});

describe("validateSqliteBackupFile", () => {
  it("accepts a database with every expected table", () => {
    const result = validateSqliteBackupFile(createValidBackup());
    expect(result).toEqual({ ok: true, tableCount: EXPECTED_TABLES.length });
  });

  it("rejects a file that isn't a SQLite database at all, without throwing", () => {
    const p = tmpDbPath();
    fs.writeFileSync(p, "definitely not a sqlite file");
    const result = validateSqliteBackupFile(p);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/not a valid sqlite database/i);
  });

  it("rejects a nonexistent path without throwing", () => {
    const result = validateSqliteBackupFile(path.join(os.tmpdir(), `does-not-exist-${randomUUID()}.db`));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/not a readable sqlite file/i);
  });

  it("rejects a valid SQLite file that's missing the app's tables", () => {
    const p = tmpDbPath();
    const db = new Database(p);
    db.exec("CREATE TABLE unrelated_thing (id INTEGER)");
    db.close();
    const result = validateSqliteBackupFile(p);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("Missing expected table(s)");
      for (const table of EXPECTED_TABLES) expect(result.reason).toContain(table);
    }
  });

  it("does not leave -wal/-shm sidecar files behind after validating a WAL-mode backup", () => {
    const p = createValidBackup();
    const db = new Database(p);
    db.pragma("journal_mode = WAL");
    db.close();

    const result = validateSqliteBackupFile(p);
    expect(result.ok).toBe(true);
    expect(fs.existsSync(p + "-wal")).toBe(false);
    expect(fs.existsSync(p + "-shm")).toBe(false);
  });
});
