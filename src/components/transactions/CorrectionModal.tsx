"use client";

/**
 * The three-way correction prompt from the build brief (§8): when the
 * household changes a transaction's category/priority/owner, ask how far
 * that change should reach — just this one row, every matching row in the
 * same import, or a standing rule that also reaches backward. Nothing here
 * decides anything on its own; it only calls the server action for the
 * choice the household makes.
 */
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  editTransactionsAction,
  editMatchingInBatchAction,
  createRuleFromCorrectionAction,
} from "@/app/transactions/actions";
import type { TransactionFieldEdit } from "@/lib/transactions/edit";

export interface PendingChange {
  transactionId: string;
  /** Human label of the field being changed, e.g. "category". */
  fieldLabel: string;
  /** Human label of the new value, e.g. "Groceries". */
  valueLabel: string;
  edit: TransactionFieldEdit;
  /** What to show as "for X" and to prefill the rule-match text with. */
  matchLabel: string;
}

export function CorrectionModal({ pending, onClose }: { pending: PendingChange; onClose: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [ruleMode, setRuleMode] = useState(false);
  const [ruleName, setRuleName] = useState(`${pending.matchLabel} → ${pending.valueLabel}`);
  const [matchText, setMatchText] = useState(pending.matchLabel);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const firstButtonRef = useRef<HTMLButtonElement>(null);

  // Keyboard/focus basics for a dialog that's otherwise just floating divs:
  // Escape closes it, and focus starts on the first choice rather than
  // being left wherever the triggering click happened to land.
  useEffect(() => {
    firstButtonRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function applyScope(scope: "only" | "batch") {
    setBusy(true);
    setError(null);
    const res =
      scope === "only"
        ? await editTransactionsAction([pending.transactionId], pending.edit)
        : await editMatchingInBatchAction(pending.transactionId, pending.edit);
    setBusy(false);
    if (res.ok) {
      router.refresh();
      onClose();
    } else {
      setError(res.errorMessage ?? "Something went wrong.");
    }
  }

  async function createRule() {
    if (!matchText.trim() || !ruleName.trim()) return;
    setBusy(true);
    setError(null);
    const res = await createRuleFromCorrectionAction({
      name: ruleName.trim(),
      matchMerchantContains: matchText.trim(),
      setCategoryId: pending.edit.categoryId,
      setPriorityId: pending.edit.priorityId,
      setOwnershipType: pending.edit.ownershipType,
      setOwnerMemberId: pending.edit.ownerMemberId,
    });
    setBusy(false);
    if (res.ok) {
      router.refresh();
      onClose();
    } else {
      setError(res.errorMessage ?? "Something went wrong.");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="w-full max-w-md rounded-xl border border-border bg-surface p-5 shadow-lg">
        <h2 id={titleId} className="font-semibold mb-1">
          Set {pending.fieldLabel} to {pending.valueLabel}
        </h2>
        <p className="text-sm text-muted mb-4">
          For &quot;{pending.matchLabel}&quot; — how far should this apply?
        </p>

        {!ruleMode ? (
          <div className="space-y-2">
            <button
              ref={firstButtonRef}
              onClick={() => applyScope("only")}
              disabled={busy}
              className="w-full text-left rounded-lg border border-border px-3 py-2 text-sm hover:bg-background disabled:opacity-50"
            >
              Just this transaction
            </button>
            <button
              onClick={() => applyScope("batch")}
              disabled={busy}
              className="w-full text-left rounded-lg border border-border px-3 py-2 text-sm hover:bg-background disabled:opacity-50"
            >
              This and every matching transaction in the same import
            </button>
            <button
              onClick={() => setRuleMode(true)}
              disabled={busy}
              className="w-full text-left rounded-lg border border-border px-3 py-2 text-sm hover:bg-background disabled:opacity-50"
            >
              Create a rule — apply to past and future transactions like this
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <label className="block text-sm">
              Rule name
              <input
                value={ruleName}
                onChange={(e) => setRuleName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm">
              Match transactions whose merchant contains
              <input
                value={matchText}
                onChange={(e) => setMatchText(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
              />
            </label>
            <p className="text-xs text-muted-2">
              This rule will be applied immediately to every existing transaction it matches, and to
              every future import from now on. You can review, disable, or delete it later from Rules.
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={createRule}
                disabled={busy || !matchText.trim() || !ruleName.trim()}
                className="rounded-lg bg-foreground text-background px-3 py-2 text-sm font-medium disabled:opacity-50"
              >
                {busy ? "Applying…" : "Create rule and apply"}
              </button>
              <button onClick={() => setRuleMode(false)} className="text-sm text-muted underline">
                Back
              </button>
            </div>
          </div>
        )}

        {error && <p className="mt-3 text-sm text-[var(--danger-quiet)]">{error}</p>}

        <button onClick={onClose} className="mt-4 text-xs text-muted underline">
          Cancel
        </button>
      </div>
    </div>
  );
}
