/**
 * Restores the database from a previously exported backup file (see
 * "Backup and restore" in the README and the /diagnostics page's
 * "Download a backup" link, which produces exactly the file this expects).
 *
 * Run with the app STOPPED: `npm run db:restore -- /path/to/backup.db`
 *
 * Why this is a CLI script and not an in-app button: the running app holds
 * one long-lived SQLite connection for the whole Next.js process
 * (src/lib/db/client.ts) — swapping the underlying file out from under that
 * open connection while it may be mid-write is exactly the kind of thing
 * that corrupts a database. The /diagnostics page's upload flow validates
 * an uploaded file and stages it under data/, then tells the household to
 * stop the app and run this script to complete the swap — the same
 * stop-the-process discipline the README already asks for with a manual
 * file copy.
 *
 * What this does, in order:
 *   1. Validates the given file opens as SQLite, passes `PRAGMA
 *      integrity_check`, and has the tables this app expects — refusing to
 *      proceed on anything that isn't recognizably a Carera Cash Flow
 *      backup (or is corrupted).
 *   2. Copies the CURRENT database aside to data/backups/ with a timestamp,
 *      so restoring is itself undoable.
 *   3. Copies the validated file into place as the live database, removing
 *      stale -wal/-shm sidecar files from both the old and new database so
 *      a leftover WAL file can't shadow the restored data on next start.
 *   4. Reminds you to run `npm run db:migrate` before starting the app, in
 *      case the backup predates a schema change in this checkout.
 */
import fs from "node:fs";
import path from "node:path";
import { validateSqliteBackupFile } from "../src/lib/diagnostics/restoreValidation";

function resolveLiveDbPath(): string {
  if (process.env.CARERA_DB_PATH) return process.env.CARERA_DB_PATH;
  return path.join(process.cwd(), "data", "carera-cashflow.db");
}

function removeSidecars(dbPath: string) {
  for (const suffix of ["-wal", "-shm"]) {
    const p = dbPath + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

function main() {
  const backupPath = process.argv[2];
  if (!backupPath) {
    console.error("Usage: npm run db:restore -- /path/to/backup.db");
    process.exit(1);
  }

  const resolvedBackupPath = path.resolve(backupPath);
  if (!fs.existsSync(resolvedBackupPath)) {
    console.error(`Refusing to restore: File not found: ${resolvedBackupPath}`);
    process.exit(1);
  }
  const validation = validateSqliteBackupFile(resolvedBackupPath);
  if (!validation.ok) {
    console.error(`Refusing to restore: ${validation.reason}`);
    process.exit(1);
  }

  const liveDbPath = resolveLiveDbPath();
  const dataDir = path.dirname(liveDbPath);
  const backupsDir = path.join(dataDir, "backups");
  fs.mkdirSync(backupsDir, { recursive: true });

  if (fs.existsSync(liveDbPath)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safetyCopyPath = path.join(backupsDir, `pre-restore-${stamp}.db`);
    fs.copyFileSync(liveDbPath, safetyCopyPath);
    console.log(`Current database copied to ${safetyCopyPath} before restoring.`);
  }

  removeSidecars(liveDbPath);
  fs.copyFileSync(resolvedBackupPath, liveDbPath);
  removeSidecars(liveDbPath); // In case the source backup itself had stale sidecars alongside it.

  console.log(`Restored ${liveDbPath} from ${resolvedBackupPath}.`);
  console.log("Next: run `npm run db:migrate` before starting the app, then start it normally.");
}

main();
