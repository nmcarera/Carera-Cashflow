"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { uploadRestoreCandidateAction, clearRestoreStagingAction } from "@/app/diagnostics/actions";
import type { StagedBackup } from "@/lib/diagnostics/queries";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function RestorePanel({ staged }: { staged: StagedBackup[] }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  async function handleUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = fileInputRef.current;
    if (!input?.files?.[0]) return;
    setBusy(true);
    setMessage(null);
    const formData = new FormData();
    formData.set("backupFile", input.files[0]);
    const res = await uploadRestoreCandidateAction(formData);
    setBusy(false);
    if (res.ok) {
      setMessage({ kind: "success", text: "File validated and staged. See the command below to finish restoring." });
      input.value = "";
      router.refresh();
    } else {
      setMessage({ kind: "error", text: res.errorMessage ?? "Something went wrong." });
    }
  }

  async function handleClear() {
    setBusy(true);
    await clearRestoreStagingAction();
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="font-medium mb-1">Download a backup</h3>
          <p className="text-sm text-muted max-w-xl">
            A single file with everything in the app right now. Keep it somewhere safe (a cloud
            drive, a USB drive) — this is what you&apos;d use to restore if anything ever goes wrong.
          </p>
        </div>
        <a
          href="/api/diagnostics/backup"
          className="rounded-lg bg-foreground text-background px-4 py-2 text-sm font-medium whitespace-nowrap"
        >
          Download backup
        </a>
      </div>

      <div className="border-t border-border pt-4">
        <h3 className="font-medium mb-1">Restore from a backup</h3>
        <p className="text-sm text-muted max-w-xl mb-3">
          Upload a previously downloaded backup file to check it&apos;s valid. Restoring itself has to
          happen with the app stopped, so this step only validates and stages the file — it does not
          change any data yet.
        </p>
        <form onSubmit={handleUpload} className="flex flex-wrap items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".db"
            aria-label="Backup file to validate"
            className="text-sm max-w-xs"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-background disabled:opacity-50"
          >
            {busy ? "Checking…" : "Validate and stage"}
          </button>
        </form>
        {message && (
          <p className={`text-sm mt-2 ${message.kind === "error" ? "text-[var(--danger-quiet)]" : "text-income"}`} role="status">
            {message.text}
          </p>
        )}
      </div>

      {staged.length > 0 && (
        <div className="border-t border-border pt-4">
          <h3 className="font-medium mb-2">Staged and ready to restore</h3>
          <ul className="space-y-2 mb-3">
            {staged.map((f) => (
              <li key={f.stagedPath} className="rounded-lg border border-border bg-background p-3 text-sm">
                <p className="font-mono text-xs break-all mb-1">{f.stagedPath}</p>
                <p className="text-muted">{f.fileName} · {formatBytes(f.sizeBytes)}</p>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted mb-2">
            With the app stopped, run this in a terminal from the project folder to finish restoring:
          </p>
          <pre className="rounded-lg border border-border bg-background p-3 text-xs overflow-x-auto mb-3">
            <code>{`npm run db:restore -- "${staged[0].stagedPath}"`}</code>
          </pre>
          <button
            type="button"
            onClick={handleClear}
            disabled={busy}
            className="text-sm text-muted underline underline-offset-2 hover:text-foreground disabled:opacity-50"
          >
            Discard staged file(s)
          </button>
        </div>
      )}
    </div>
  );
}
