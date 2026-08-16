/**
 * Prepares a fresh, disposable database for the E2E run (see
 * playwright.config.ts's `webServer.command`, which runs this before
 * `next build && next start`). Runs migrations, then seeds only the
 * household scaffolding a fresh install actually ships with — household
 * members, default categories/priorities, app settings — deliberately
 * WITHOUT any accounts or transactions, so e2e/household-flow.spec.ts is
 * exercising a real first-import experience, not a pre-populated demo.
 *
 * Safe to re-run: always wipes e2e/.e2e-data/ first, so old test runs
 * never leak state into a new one.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const dataDir = path.join(process.cwd(), "e2e", ".e2e-data");
fs.rmSync(dataDir, { recursive: true, force: true });
fs.mkdirSync(dataDir, { recursive: true });

process.env.CARERA_DB_PATH = path.join(dataDir, "carera-cashflow.db");

async function main() {
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const { db } = await import("../src/lib/db/client");
  const { householdMembers, categories, priorities, appSettings } = await import("../src/lib/db/schema");
  const { DEFAULT_CATEGORIES, DEFAULT_PRIORITIES } = await import("../src/lib/domain/enums");

  migrate(db, { migrationsFolder: "./drizzle" });

  const nic = { id: randomUUID(), name: "Nic", initials: "NC", color: "#4E86B0" };
  const mariana = { id: randomUUID(), name: "Mariana", initials: "MS", color: "#B25D7A" };
  db.insert(householdMembers).values([nic, mariana]).run();

  db.insert(appSettings).values({ key: "household_name", value: JSON.stringify("Test household") }).run();
  db.insert(appSettings).values({ key: "reporting_currency", value: JSON.stringify("EUR") }).run();

  db.insert(categories)
    .values(DEFAULT_CATEGORIES.map((name) => ({ id: randomUUID(), name, color: "#8A8A8A", isSystem: true })))
    .run();
  db.insert(priorities)
    .values(DEFAULT_PRIORITIES.map((name, i) => ({ id: randomUUID(), name, isSystem: true, sortOrder: i })))
    .run();

  console.log(`E2E database ready at ${process.env.CARERA_DB_PATH}`);
}

main();
