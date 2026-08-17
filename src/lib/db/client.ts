/**
 * Database access layer — connection.
 *
 * Single SQLite file, local-first, no network. The path is resolved once
 * and reused for the lifetime of the process (Next.js dev/prod server or a
 * test run). See README "Database location" for the exact path and how to
 * override it for tests via CARERA_DB_PATH.
 */
import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

function resolveDbPath(): string {
  const dbPath = process.env.CARERA_DB_PATH || path.join(process.cwd(), "data", "carera-cashflow.db");
  // Ensure the parent directory exists regardless of where dbPath came
  // from — matters for a hosted deployment where CARERA_DB_PATH points at
  // a freshly-mounted, empty volume (e.g. Railway's persistent volume at
  // /data) rather than the local default this used to only handle.
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dbPath;
}

declare global {

  var __careraSqlite: Database.Database | undefined;
}

function createConnection(): Database.Database {
  const dbPath = resolveDbPath();
  const sqlite = new Database(dbPath);
  // NOT WAL. WAL mode's -wal/-shm sidecar files rely on mmap-based shared
  // memory, which many hosted "volume" filesystems (network- or
  // virtualization-backed, as opposed to a plain local disk) don't support
  // correctly — the practical symptom isn't a SQLite error, it's the whole
  // Node process dying silently the instant this pragma runs (a native
  // crash below what JS try/catch can intercept). This app is one Node
  // process with no concurrent external writers, so WAL's main benefit
  // (readers not blocking on a writer) doesn't buy us anything here — the
  // portability is worth far more than the write-concurrency we'd gain.
  // See README "Deploying" for the story of how this was diagnosed.
  sqlite.pragma("journal_mode = DELETE");
  sqlite.pragma("foreign_keys = ON");
  return sqlite;
}

// `next build` briefly imports every route/page module (in parallel, across
// several worker processes) just to inspect their exported config — it
// never calls into them. But this module opens a real database connection
// as a side effect of being imported (see the exports below), and on at
// least one hosting build environment (Railway), merely constructing a
// `Database` instance during this phase — even an in-memory one — crashes
// the build worker outright (a native-level crash, not a catchable JS
// error). `better-sqlite3` only loads its native addon lazily, inside the
// `Database` constructor (see node_modules/better-sqlite3/lib/binding.js) —
// so the fix isn't "open a safer database," it's "never call `new
// Database(...)` at all" during this phase. `sqlite` becomes an inert stub
// object, and `db` uses drizzle-orm's own documented mock-client mode
// (`drizzle.mock`, see node_modules/drizzle-orm/better-sqlite3/driver.js),
// which never touches a real client either. Nothing during page-data
// collection calls methods on either export, so the stub is never observed.
const isProductionBuildPhase = process.env.NEXT_PHASE === "phase-production-build";

// Reuse the connection across Next.js hot-reloads in dev to avoid exhausting
// file handles; tests each get their own process so this is a no-op there.
export const sqlite: Database.Database = isProductionBuildPhase
  ? ({} as Database.Database)
  : (globalThis.__careraSqlite ?? createConnection());
if (!isProductionBuildPhase && process.env.NODE_ENV !== "production") {
  globalThis.__careraSqlite = sqlite;
}

export const db = isProductionBuildPhase ? drizzle.mock({ schema }) : drizzle(sqlite, { schema });
export type DB = typeof db;
