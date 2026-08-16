import { getDbStats, getMigrationStatus, listRecentLogEntries, logSeverityCounts, listStagedBackups } from "@/lib/diagnostics/queries";
import { formatDate } from "@/lib/format";
import { RestorePanel } from "@/components/diagnostics/RestorePanel";
import { LogViewer } from "@/components/diagnostics/LogViewer";
import packageJson from "../../../package.json";

export const metadata = { title: "Diagnostics — Carera's Cash Flow" };
export const dynamic = "force-dynamic";

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "unknown";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function DiagnosticsPage() {
  const stats = getDbStats();
  const migration = getMigrationStatus();
  const entries = listRecentLogEntries({ limit: 100 });
  const counts = logSeverityCounts();
  const staged = listStagedBackups();

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight mb-1">Diagnostics</h1>
        <p className="text-muted max-w-2xl">
          What&apos;s actually in the database, whether it&apos;s healthy, and what&apos;s been logged —
          for when something looks wrong and you want to see under the hood rather than guess.
        </p>
      </section>

      <section className="rounded-xl border border-border bg-surface p-5">
        <h2 className="text-sm uppercase tracking-wide text-muted mb-4">Database</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 text-sm">
          <Stat label="Transactions" value={stats.transactions} />
          <Stat label="Accounts" value={stats.accounts} />
          <Stat label="Import batches" value={stats.importBatches} />
          <Stat label="Rules" value={stats.rules} />
          <Stat label="Categories" value={stats.categories} />
          <Stat label="Priorities" value={stats.priorities} />
          <Stat label="Household members" value={stats.householdMembers} />
          <Stat label="Savings goals" value={stats.savingsGoals} />
          <Stat label="Cached exchange rates" value={stats.exchangeRates} />
          <Stat label="Audit log entries" value={stats.auditLogEntries} />
          <Stat label="Diagnostics log entries" value={stats.errorLogEntries} />
          <Stat label="Database file size" value={formatBytes(stats.dbFileSizeBytes)} />
        </div>
        <p className="text-xs text-muted-2 font-mono break-all mt-4">{stats.dbPath}</p>
      </section>

      <section className="rounded-xl border border-border bg-surface p-5">
        <h2 className="text-sm uppercase tracking-wide text-muted mb-4">Migrations</h2>
        <p className="text-sm">
          {migration.upToDate ? (
            <span className="text-income">
              Up to date — {migration.appliedCount} of {migration.definedCount} migrations applied.
            </span>
          ) : (
            <span className="text-[var(--danger-quiet)]">
              Out of date — {migration.appliedCount} of {migration.definedCount} migrations applied. Run{" "}
              <code className="font-mono">npm run db:migrate</code>.
            </span>
          )}
        </p>
        {migration.lastAppliedAt && (
          <p className="text-sm text-muted mt-1">Last migration applied {formatDate(migration.lastAppliedAt.slice(0, 10))}.</p>
        )}
        <p className="text-sm text-muted mt-2">App version: {packageJson.version}</p>
      </section>

      <section className="rounded-xl border border-border bg-surface p-5">
        <h2 className="text-sm uppercase tracking-wide text-muted mb-4">Backup and restore</h2>
        <RestorePanel staged={staged} />
      </section>

      <section className="rounded-xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="text-sm uppercase tracking-wide text-muted">Error and activity log</h2>
          <a href="/api/diagnostics/export-log" className="text-sm text-muted underline underline-offset-2 hover:text-foreground">
            Download sanitized export
          </a>
        </div>
        <p className="text-sm text-muted mb-4">
          The last {entries.length} entries. Nothing here includes transaction amounts, merchants, or
          descriptions — see README &quot;Data privacy and security limitations&quot; for what is and isn&apos;t
          logged.
        </p>
        <LogViewer entries={entries} counts={counts} />
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <p className="text-xs text-muted uppercase tracking-wide">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}
