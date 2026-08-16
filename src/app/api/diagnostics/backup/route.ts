/**
 * Downloads a point-in-time snapshot of the live SQLite database.
 *
 * Uses better-sqlite3's native `.backup()` (not a plain file copy) because
 * the app runs with `journal_mode = WAL` (src/lib/db/client.ts) — a raw
 * `cp` of the main .db file while the app is running can miss committed
 * data still sitting in the -wal file. `.backup()` produces a single
 * consistent file safely, without stopping the server or touching the live
 * connection other pages are using concurrently.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sqlite } from "@/lib/db/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const tmpPath = path.join(os.tmpdir(), `carera-backup-${stamp}.db`);

  try {
    await sqlite.backup(tmpPath);
    const bytes = fs.readFileSync(tmpPath);
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.sqlite3",
        "Content-Disposition": `attachment; filename="carera-cashflow-backup-${stamp}.db"`,
        "Content-Length": String(bytes.byteLength),
      },
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Backup failed." },
      { status: 500 }
    );
  } finally {
    fs.rm(tmpPath, { force: true }, () => {});
  }
}
