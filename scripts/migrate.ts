/**
 * Applies pending SQL migrations from ./drizzle to the local SQLite database.
 * Run via `npm run db:migrate`. Safe to run repeatedly (idempotent).
 *
 * The try/catch and process-level handlers below exist because this script
 * previously died with zero output on a hosted deploy (see README
 * "Deploying") — a JS exception here would normally print a stack trace on
 * its own, but that silence turned out to mean the process was being killed
 * below the level JS can even catch. These handlers can't do anything about
 * that class of failure, but they guarantee that if the *next* problem is
 * an ordinary catchable error, it prints instead of vanishing again.
 */
process.on("uncaughtException", (err) => {
  console.error("db:migrate — uncaught exception:", err);
  process.exit(1);
});
process.on("unhandledRejection", (err) => {
  console.error("db:migrate — unhandled rejection:", err);
  process.exit(1);
});

// Wrapped in an async function, not top-level `await`: tsx transpiles this
// file to CommonJS, which doesn't support top-level await at all.
//
// Dynamic imports, not static ones, inside that function: a static `import`
// is evaluated before any of this file's own code runs, no matter where
// it's textually placed (that's why the first log line below wouldn't
// actually print first with a static import) — dynamic `import()` runs
// exactly where it's written, so the log lines below are true breadcrumbs
// of how far startup actually got before anything went wrong.
async function main() {
  console.log("db:migrate — starting, CARERA_DB_PATH =", process.env.CARERA_DB_PATH || "(unset)");

  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const { db, sqlite } = await import("../src/lib/db/client");

  console.log("db:migrate — database connection opened");

  migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Migrations applied to", sqlite.name);
}

main().catch((err) => {
  console.error("db:migrate — failed:", err);
  process.exit(1);
});
