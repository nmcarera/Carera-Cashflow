"use client";

import { useState } from "react";
import {
  previewFilesAction,
  reselectAdapterAction,
  confirmImportAction,
  type PreviewOutcome,
  type AdapterOption,
} from "@/app/import/actions";
import type { AccountResolutionChoice, CommitResult } from "@/lib/import/importPipeline";
import { formatDate, formatMoney } from "@/lib/format";

interface AccountOption {
  id: string;
  displayName: string;
  institution: string;
}

const STATUS_LABELS: Record<string, string> = {
  valid: "Ready to import",
  duplicate: "Duplicate — will be skipped",
  malformed: "Malformed — needs attention",
  missing_field: "Missing field — needs attention",
  uncertain_currency: "Currency needs conversion later",
  possible_transfer: "Possible internal transfer",
};

function SummaryLine({ preview }: { preview: PreviewOutcome["preview"] }) {
  if (!preview) return null;
  const s = preview.summary;
  return (
    <p className="text-sm text-muted">
      {s.rowsInspected} rows inspected · {s.valid} ready to import · {s.duplicates} duplicates ·{" "}
      {s.malformed + s.missingField} need attention
      {s.possibleTransfers > 0 ? ` · ${s.possibleTransfers} possible transfers` : ""}
      {s.uncertainCurrency > 0 ? ` · ${s.uncertainCurrency} pending currency conversion` : ""}
    </p>
  );
}

function AccountResolutionRow({
  group,
  accounts,
  choice,
  onChange,
}: {
  group: NonNullable<PreviewOutcome["preview"]>["accountGroups"][number];
  accounts: AccountOption[];
  choice: AccountResolutionChoice;
  onChange: (choice: AccountResolutionChoice) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-border last:border-0 text-sm">
      <div>
        <p className="font-medium">
          Account …{group.accountExternalId.slice(-4)}{" "}
          <span className="text-muted-2 font-normal">({group.rowCount} rows)</span>
        </p>
        {group.existingAccountId && (
          <p className="text-muted-2 text-xs">Recognized as an existing account.</p>
        )}
      </div>
      <select
        className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm max-w-xs"
        value={choice.action === "link" ? `link:${choice.accountId}` : "create"}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "create") {
            onChange({ action: "create" });
          } else {
            onChange({ action: "link", accountId: v.replace("link:", "") });
          }
        }}
      >
        <option value="create">
          Create new: {group.hint.displayName} ({group.hint.accountType})
        </option>
        {accounts.map((a) => (
          <option key={a.id} value={`link:${a.id}`}>
            Link to: {a.displayName}
          </option>
        ))}
      </select>
    </div>
  );
}

function PreviewCard({
  outcome,
  accounts,
  adapterOptions,
  onReplace,
  onRemove,
}: {
  outcome: PreviewOutcome;
  accounts: AccountOption[];
  adapterOptions: AdapterOption[];
  onReplace: (next: PreviewOutcome) => void;
  onRemove: () => void;
}) {
  const [resolutions, setResolutions] = useState<Record<string, AccountResolutionChoice>>(() => {
    const initial: Record<string, AccountResolutionChoice> = {};
    outcome.preview?.accountGroups.forEach((g) => {
      initial[g.accountExternalId] = g.existingAccountId
        ? { action: "link", accountId: g.existingAccountId }
        : { action: "create" };
    });
    return initial;
  });
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<CommitResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  if (!outcome.ok || !outcome.preview) {
    return (
      <div className="rounded-xl border border-border bg-surface p-4">
        <p className="font-medium">{outcome.fileName}</p>
        <p className="text-sm text-[var(--danger-quiet)] mt-1">{outcome.errorMessage}</p>
        <button onClick={onRemove} className="text-sm text-muted underline mt-2">
          Remove
        </button>
      </div>
    );
  }

  const preview = outcome.preview;

  if (preview.unrecognized) {
    return (
      <div className="rounded-xl border border-border bg-surface p-4">
        <p className="font-medium">{preview.fileName}</p>
        <p className="text-sm text-muted mt-1">
          This file&apos;s structure doesn&apos;t match any known institution format. Nothing was
          imported or guessed. You can pick the institution manually if you know which bank this is
          from:
        </p>
        <select
          className="mt-2 rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
          defaultValue=""
          onChange={async (e) => {
            if (!e.target.value) return;
            const next = await reselectAdapterAction(preview.previewId, e.target.value);
            onReplace(next);
          }}
        >
          <option value="" disabled>
            Select institution…
          </option>
          {adapterOptions.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (result) {
    return (
      <div className="rounded-xl border border-border bg-surface p-4">
        <p className="font-medium mb-1">{preview.fileName} — imported</p>
        <p className="text-sm text-muted">
          {result.rowsInspected} rows inspected. {result.rowsImported} new transactions imported.{" "}
          {result.rowsDuplicate} duplicates skipped.{" "}
          {result.rowsTransferSuggested > 0 && `${result.rowsTransferSuggested} possible transfers found. `}
          {result.rowsWarning > 0 && `${result.rowsWarning} rows require attention. `}
          {result.rowsError > 0 && `${result.rowsError} rows could not be imported.`}
        </p>
        {result.exchangeRateStatus === "pending" && (
          <p className="text-sm text-muted mt-1">
            Some transactions are in a foreign currency and are waiting on currency conversion
            (arriving in a later phase) — they were still imported and are visible in the review
            queue.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="font-medium">{preview.fileName}</p>
          <p className="text-sm text-muted-2">
            Detected as: {preview.adapterLabel}
            {preview.adapterUnverified && (
              <span className="ml-2 rounded-full bg-background border border-border px-2 py-0.5 text-xs">
                Unverified format — no real sample confirmed yet
              </span>
            )}
          </p>
        </div>
        <button onClick={onRemove} className="text-sm text-muted underline">
          Remove
        </button>
      </div>

      <div className="mt-3">
        <SummaryLine preview={preview} />
      </div>

      {preview.accountGroups.length > 0 && (
        <div className="mt-3">
          <p className="text-xs uppercase tracking-wide text-muted mb-1">Accounts found in this file</p>
          {preview.accountGroups.map((g) => (
            <AccountResolutionRow
              key={g.accountExternalId}
              group={g}
              accounts={accounts}
              choice={resolutions[g.accountExternalId] ?? { action: "create" }}
              onChange={(choice) =>
                setResolutions((prev) => ({ ...prev, [g.accountExternalId]: choice }))
              }
            />
          ))}
        </div>
      )}

      <button
        onClick={() => setExpanded((v) => !v)}
        className="text-sm text-muted underline mt-3"
      >
        {expanded ? "Hide row details" : "Show row details"}
      </button>

      {expanded && (
        <div className="mt-2 max-h-80 overflow-y-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-surface">
              <tr className="text-left border-b border-border">
                <th className="px-2 py-1.5">Row</th>
                <th className="px-2 py-1.5">Status</th>
                <th className="px-2 py-1.5">Date</th>
                <th className="px-2 py-1.5">Description</th>
                <th className="px-2 py-1.5 text-right">Amount</th>
                <th className="px-2 py-1.5">Note</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.slice(0, 300).map((r) => (
                <tr key={r.sourceRowNumber} className="border-b border-border last:border-0">
                  <td className="px-2 py-1 text-muted">{r.sourceRowNumber}</td>
                  <td className="px-2 py-1">{STATUS_LABELS[r.status] ?? r.status}</td>
                  <td className="px-2 py-1 whitespace-nowrap text-muted">
                    {r.normalized ? formatDate(r.normalized.transactionDate) : "—"}
                  </td>
                  <td className="px-2 py-1 max-w-xs truncate">
                    {r.normalized?.cleanedDescription ?? "—"}
                  </td>
                  <td className="px-2 py-1 text-right whitespace-nowrap">
                    {r.normalized
                      ? formatMoney(r.normalized.originalAmount, r.normalized.originalCurrency)
                      : "—"}
                  </td>
                  <td className="px-2 py-1 max-w-xs truncate text-muted-2">{r.message ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {preview.rows.length > 300 && (
            <p className="text-xs text-muted-2 p-2">
              Showing the first 300 of {preview.rows.length} rows.
            </p>
          )}
        </div>
      )}

      {error && <p className="text-sm text-[var(--danger-quiet)] mt-2">{error}</p>}

      <div className="mt-4 flex justify-end">
        <button
          disabled={committing}
          onClick={async () => {
            setCommitting(true);
            setError(null);
            const outcome = await confirmImportAction({
              previewId: preview.previewId,
              accountResolutions: resolutions,
            });
            setCommitting(false);
            if (outcome.ok && outcome.result) {
              setResult(outcome.result);
            } else {
              setError(outcome.errorMessage ?? "Import failed.");
            }
          }}
          className="rounded-lg bg-foreground text-background px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {committing ? "Importing…" : `Confirm import (${preview.summary.valid} transactions)`}
        </button>
      </div>
    </div>
  );
}

export function ImportWorkflow({
  accounts,
  adapterOptions,
}: {
  accounts: AccountOption[];
  adapterOptions: AdapterOption[];
}) {
  const [outcomes, setOutcomes] = useState<PreviewOutcome[]>([]);
  const [loading, setLoading] = useState(false);

  return (
    <div className="space-y-6">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const formData = new FormData(form);
          setLoading(true);
          const next = await previewFilesAction(formData);
          setOutcomes((prev) => [...prev, ...next]);
          setLoading(false);
          form.reset();
        }}
        className="rounded-xl border border-border bg-surface p-4 flex items-center gap-3"
      >
        <input
          type="file"
          name="files"
          multiple
          accept=".csv,.xls,.xlsx,.txt"
          className="text-sm flex-1"
          required
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-foreground text-background px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {loading ? "Reading…" : "Preview"}
        </button>
      </form>

      {outcomes.length === 0 && (
        <p className="text-sm text-muted-2">
          Nothing is saved until you review the preview and confirm — uploading here never writes
          to the database by itself.
        </p>
      )}

      <div className="space-y-4">
        {outcomes.map((o, i) => (
          <PreviewCard
            key={o.preview?.previewId ?? `${o.fileName}-${i}`}
            outcome={o}
            accounts={accounts}
            adapterOptions={adapterOptions}
            onReplace={(next) =>
              setOutcomes((prev) => prev.map((p, idx) => (idx === i ? next : p)))
            }
            onRemove={() => setOutcomes((prev) => prev.filter((_, idx) => idx !== i))}
          />
        ))}
      </div>
    </div>
  );
}
