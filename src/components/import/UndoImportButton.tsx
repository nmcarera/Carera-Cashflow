"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { undoImportAction } from "@/app/import/actions";

export function UndoImportButton({ batchId, fileName }: { batchId: string; fileName: string }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  if (confirming) {
    return (
      <span className="text-xs">
        Undo the import of &quot;{fileName}&quot;? This removes exactly the transactions it added —
        other imports and your categorization rules are untouched.{" "}
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await undoImportAction(batchId);
            setBusy(false);
            router.refresh();
          }}
          className="underline font-medium mr-2"
        >
          {busy ? "Undoing…" : "Yes, undo"}
        </button>
        <button onClick={() => setConfirming(false)} className="underline text-muted">
          Cancel
        </button>
      </span>
    );
  }

  return (
    <button onClick={() => setConfirming(true)} className="text-xs text-muted underline">
      Undo
    </button>
  );
}
