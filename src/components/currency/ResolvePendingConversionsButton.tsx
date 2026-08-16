"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { resolvePendingConversionsAction } from "@/app/currency/actions";

export function ResolvePendingConversionsButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMessage(null);
    const res = await resolvePendingConversionsAction();
    setBusy(false);
    if (res.ok && res.data) {
      const d = res.data;
      const parts = [`${d.transactionsResolved} transaction${d.transactionsResolved === 1 ? "" : "s"} converted`];
      if (d.transactionsStillPending > 0) {
        parts.push(`${d.transactionsStillPending} still pending (rate unavailable — safe to try again later)`);
      }
      if (d.newTransferSuggestions > 0) {
        parts.push(`${d.newTransferSuggestions} new possible transfer${d.newTransferSuggestions === 1 ? "" : "s"} found`);
      }
      setMessage(parts.join(" · "));
      router.refresh();
    } else {
      setMessage(res.errorMessage ?? "Could not resolve pending conversions.");
    }
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <button
        onClick={run}
        disabled={busy}
        className="rounded-lg bg-foreground text-background px-3 py-2 text-sm font-medium disabled:opacity-50"
      >
        {busy ? "Checking exchange rates…" : "Resolve pending currency conversions"}
      </button>
      {message && <p className="text-sm text-muted">{message}</p>}
    </div>
  );
}
