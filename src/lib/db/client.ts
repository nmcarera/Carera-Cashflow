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
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return sqlite;
}

// Reuse the connection across Next.js hot-reloads in dev to avoid exhausting
// file handles; tests each get their own process so this is a no-op there.
export const sqlite = globalThis.__careraSqlite ?? createConnection();
if (process.env.NODE_ENV !== "production") {
  globalThis.__careraSqlite = sqlite;
}

export const db = drizzle(sqlite, { schema });
export type DB = typeof db;
