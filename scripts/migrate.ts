/**
 * Applies pending SQL migrations from ./drizzle to the local SQLite database.
 * Run via `npm run db:migrate`. Safe to run repeatedly (idempotent).
 */
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { db, sqlite } from "../src/lib/db/client";

migrate(db, { migrationsFolder: "./drizzle" });
 
console.log("Migrations applied to", sqlite.name);
