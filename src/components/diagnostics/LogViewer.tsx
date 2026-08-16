"use client";

import { useMemo, useState } from "react";
import type { ErrorLogEntry } from "@/lib/diagnostics/queries";

const SEVERITY_STYLES: Record<string, string> = {
  error: "text-[var(--danger-quiet)]",
  warning: "text-expense",
  info: "text-muted",
};

function formatTimestamp(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function LogViewer({ entries, counts }: { entries: ErrorLogEntry[]; counts: Record<string, number> }) {
  const [severity, setSeverity] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = useMemo(
    () => (severity === "all" ? entries : entries.filter((e) => e.severity === severity)),
    [entries, severity]
  );

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3" role="group" aria-label="Filter by severity">
        {(["all", "error", "warning", "info"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSeverity(s)}
            aria-pressed={severity === s}
            className={`rounded-full px-3 py-1 text-xs font-medium border ${
              severity === s
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted hover:text-foreground"
            }`}
          >
            {s === "all" ? `All (${entries.length})` : `${s} (${counts[s] ?? 0})`}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted">Nothing logged yet at this severity — a quiet log is a good sign.</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface overflow-hidden">
          {filtered.map((e) => {
            const expanded = expandedId === e.id;
            return (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : e.id)}
                  aria-expanded={expanded}
                  className="w-full text-left px-3 py-2.5 text-sm flex items-center gap-3 hover:bg-background"
                >
                  <span className={`text-xs font-medium uppercase w-16 shrink-0 ${SEVERITY_STYLES[e.severity] ?? ""}`}>
                    {e.severity}
                  </span>
                  <span className="text-xs text-muted-2 w-32 shrink-0 tabular-nums">{formatTimestamp(e.timestamp)}</span>
                  <span className="font-mono text-xs w-40 shrink-0 truncate">{e.errorCode}</span>
                  <span className="flex-1 truncate text-muted">{e.message}</span>
                </button>
                {expanded && (
                  <div className="px-3 pb-3 text-xs space-y-1.5 bg-background">
                    <p>
                      <span className="text-muted-2">Operation: </span>
                      <span className="font-mono">{e.operation}</span>
                    </p>
                    <p>
                      <span className="text-muted-2">Category: </span>
                      {e.category}
                    </p>
                    {e.rootCause && (
                      <p>
                        <span className="text-muted-2">Root cause: </span>
                        {e.rootCause}
                      </p>
                    )}
                    {e.contextJson !== "{}" && (
                      <p className="break-all">
                        <span className="text-muted-2">Context: </span>
                        <span className="font-mono">{e.contextJson}</span>
                      </p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
