/**
 * Downloads a point-in-time snapshot of the live SQLite database.
 *
 * Uses better-sqlite3's native `.backup()` (not a plain file copy) because
 * a raw `cp` of the .db file while the app is running isn't guaranteed to
 * be transactionally consistent — a write could land mid-copy. `.backup()`
 * produces a single consistent snapshot safely, without stopping the
 * server or touching the live connection other pages are using
 * concurrently. (Earlier versions of this app ran in WAL mode, where this
 * mattered even more — see src/lib/db/client.ts for why that changed.)
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
