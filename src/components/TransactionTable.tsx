"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { HydratedTransaction } from "@/lib/db/queries";
import { formatDate, formatEur, formatMoney } from "@/lib/format";
import { CorrectionModal, type PendingChange } from "@/components/transactions/CorrectionModal";
import { editTransactionsAction, resolveTransferSuggestionAction } from "@/app/transactions/actions";
import type { TransactionFieldEdit } from "@/lib/transactions/edit";

const REVIEW_REASON_LABELS: Record<string, string> = {
  no_category: "no category",
  no_owner: "no owner",
  uncertain_priority: "uncertain priority",
  possible_duplicate: "possible duplicate",
  possible_transfer: "possible transfer",
  missing_conversion: "currency conversion pending",
  conflicting_rules: "conflicting rules",
  parsing_warning: "parsing warning",
  unusually_large: "unusually large",
};

export interface SelectOption {
  id: string;
  name: string;
  color?: string;
}

/** A `<select>` that opens the correction modal instead of applying its
 *  change immediately — every category/priority/owner edit goes through the
 *  "how far should this apply" prompt (see CorrectionModal), except when the
 *  row is part of a bulk selection, where the toolbar applies directly since
 *  the household already chose the scope by selecting those rows. */
function FieldSelect({
  value,
  options,
  placeholder,
  onPick,
  ariaLabel,
}: {
  value: string;
  options: SelectOption[];
  placeholder: string;
  onPick: (id: string | null, label: string) => void;
  /** A native <select> with no wrapping <label> has no accessible name of
   *  its own — the visible placeholder/selected option text isn't read as
   *  one. Pass this wherever the select isn't already inside table-header
   *  context (see the <th scope="col"> cells this is used inside of). */
  ariaLabel?: string;
}) {
  return (
    <select
      value={value}
      aria-label={ariaLabel}
      onChange={(e) => {
        const id = e.target.value || null;
        const label = id ? options.find((o) => o.id === id)?.name ?? id : placeholder;
        onPick(id, label);
      }}
      className="w-full max-w-[10rem] rounded-md border border-transparent bg-transparent px-1 py-0.5 text-sm hover:border-border focus:border-border"
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}

export function TransactionTable({
  transactions,
  categories = [],
  priorities = [],
  householdMembers = [],
}: {
  transactions: HydratedTransaction[];
  categories?: SelectOption[];
  priorities?: SelectOption[];
  householdMembers?: SelectOption[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [transferBusy, setTransferBusy] = useState<string | null>(null);

  const ownerOptions: SelectOption[] = useMemo(
    () => [{ id: "shared", name: "Shared" }, ...householdMembers.map((m) => ({ id: `person:${m.id}`, name: m.name }))],
    [householdMembers]
  );

  const filtered = useMemo(() => {
    if (!query.trim()) return transactions;
    const q = query.toLowerCase();
    return transactions.filter(
      (t) =>
        t.cleanedDescription.toLowerCase().includes(q) ||
        (t.merchant ?? "").toLowerCase().includes(q) ||
        t.accountName.toLowerCase().includes(q) ||
        (t.categoryName ?? "").toLowerCase().includes(q)
    );
  }, [transactions, query]);

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === filtered.length ? new Set() : new Set(filtered.map((t) => t.id))));
  }

  function matchLabelFor(t: HydratedTransaction): string {
    return t.merchant ?? t.cleanedDescription;
  }

  function openCorrection(t: HydratedTransaction, fieldLabel: string, valueLabel: string, edit: TransactionFieldEdit) {
    setPending({ transactionId: t.id, fieldLabel, valueLabel, edit, matchLabel: matchLabelFor(t) });
  }

  async function applyBulk(edit: TransactionFieldEdit) {
    if (selected.size === 0) return;
    setBulkBusy(true);
    await editTransactionsAction(Array.from(selected), edit);
    setBulkBusy(false);
    setSelected(new Set());
    router.refresh();
  }

  async function handleTransfer(id: string, confirmed: boolean) {
    setTransferBusy(id);
    await resolveTransferSuggestionAction(id, confirmed);
    setTransferBusy(null);
    router.refresh();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3 gap-4">
        <label className="relative flex-1 max-w-sm">
          <span className="sr-only">Search transactions</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by description, merchant, account, category…"
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm placeholder:text-muted-2"
          />
        </label>
        <p className="text-sm text-muted whitespace-nowrap">
          {filtered.length} of {transactions.length} transactions
        </p>
      </div>

      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2 text-sm">
          <span className="font-medium">{selected.size} selected</span>
          <FieldSelect
            value=""
            options={categories}
            placeholder="Set category…"
            ariaLabel="Set category for selected transactions"
            onPick={(id) => applyBulk({ categoryId: id })}
          />
          <FieldSelect
            value=""
            options={priorities}
            placeholder="Set priority…"
            ariaLabel="Set priority for selected transactions"
            onPick={(id) => applyBulk({ priorityId: id })}
          />
          <FieldSelect
            value=""
            options={ownerOptions}
            placeholder="Set owner…"
            ariaLabel="Set owner for selected transactions"
            onPick={(id) =>
              applyBulk(
                id === "shared"
                  ? { ownershipType: "shared", ownerMemberId: null }
                  : id
                  ? { ownershipType: "person", ownerMemberId: id.replace("person:", "") }
                  : { ownershipType: "unassigned", ownerMemberId: null }
              )
            }
          />
          {bulkBusy && <span className="text-muted-2">Applying…</span>}
          <button onClick={() => setSelected(new Set())} className="ml-auto text-xs text-muted underline">
            Clear selection
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted border-b border-border">
              <th scope="col" className="px-3 py-2 font-medium w-8">
                <input
                  type="checkbox"
                  checked={selected.size > 0 && selected.size === filtered.length}
                  onChange={toggleAll}
                  aria-label="Select all visible transactions"
                />
              </th>
              <th scope="col" className="px-3 py-2 font-medium">Date</th>
              <th scope="col" className="px-3 py-2 font-medium">Description</th>
              <th scope="col" className="px-3 py-2 font-medium">Account</th>
              <th scope="col" className="px-3 py-2 font-medium">Owner</th>
              <th scope="col" className="px-3 py-2 font-medium">Category</th>
              <th scope="col" className="px-3 py-2 font-medium">Priority</th>
              <th scope="col" className="px-3 py-2 font-medium text-right">Original</th>
              <th scope="col" className="px-3 py-2 font-medium text-right">EUR</th>
              <th scope="col" className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => {
              const isIncome = t.direction === "credit";
              const isTransfer = t.direction === "transfer";
              const currentOwnerValue = t.ownershipType === "person" && t.ownerName ? `person:${findOwnerId(householdMembers, t.ownerName)}` : t.ownershipType === "shared" ? "shared" : "";
              return (
                <tr key={t.id} className="border-b border-border last:border-0 hover:bg-background/60">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(t.id)}
                      onChange={() => toggleOne(t.id)}
                      aria-label={`Select ${t.cleanedDescription}`}
                    />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted">
                    {formatDate(t.transactionDate)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{t.cleanedDescription}</div>
                    {t.merchant && t.merchant !== t.cleanedDescription && (
                      <div className="text-xs text-muted-2">{t.merchant}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted">{t.accountName}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <FieldSelect
                      value={currentOwnerValue}
                      options={ownerOptions}
                      placeholder="Unassigned"
                      onPick={(id, label) =>
                        openCorrection(
                          t,
                          "owner",
                          label,
                          id === "shared"
                            ? { ownershipType: "shared", ownerMemberId: null }
                            : id
                            ? { ownershipType: "person", ownerMemberId: id.replace("person:", "") }
                            : { ownershipType: "unassigned", ownerMemberId: null }
                        )
                      }
                    />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <FieldSelect
                      value={t.categoryId ?? ""}
                      options={categories}
                      placeholder="Uncategorized"
                      onPick={(id, label) => openCorrection(t, "category", label, { categoryId: id })}
                    />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <FieldSelect
                      value={t.priorityId ?? ""}
                      options={priorities}
                      placeholder="Unclassified"
                      onPick={(id, label) => openCorrection(t, "priority", label, { priorityId: id })}
                    />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-right text-muted">
                    {t.originalCurrency !== "EUR"
                      ? formatMoney(t.originalAmount, t.originalCurrency)
                      : "—"}
                  </td>
                  <td
                    className="px-3 py-2 whitespace-nowrap text-right font-medium"
                    style={{ color: isTransfer ? "var(--muted)" : isIncome ? "var(--income)" : "inherit" }}
                  >
                    {formatEur(t.eurAmount)}
                    {t.conversionStatus === "estimated" && (
                      <span className="ml-1 text-xs text-muted-2" title="Converted using an estimated historical rate">
                        est.
                      </span>
                    )}
                    {t.conversionStatus === "pending" && (
                      <span className="ml-1 text-xs text-muted-2" title="Currency conversion pending">
                        pending
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {t.transferStatus === "suggested" ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-[var(--danger-quiet)]">Possible transfer?</span>
                        <button
                          disabled={transferBusy === t.id}
                          onClick={() => handleTransfer(t.id, true)}
                          className="text-xs underline"
                        >
                          Confirm
                        </button>
                        <button
                          disabled={transferBusy === t.id}
                          onClick={() => handleTransfer(t.id, false)}
                          className="text-xs underline text-muted"
                        >
                          Not a transfer
                        </button>
                      </div>
                    ) : t.reviewStatus === "needs_review" ? (
                      <span
                        className="text-xs text-[var(--danger-quiet)]"
                        title={t.reviewReasons.map((r) => REVIEW_REASON_LABELS[r] ?? r).join(", ")}
                      >
                        Needs review
                      </span>
                    ) : isTransfer ? (
                      <span className="text-xs text-muted-2">Transfer</span>
                    ) : (
                      <span className="text-xs text-muted-2">OK</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-8 text-center text-muted">
                  No transactions match your search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pending && <CorrectionModal pending={pending} onClose={() => setPending(null)} />}
    </div>
  );
}

/** `HydratedTransaction` only carries the owner's display name, not id (see
 *  src/lib/db/queries.ts) — resolved back to an id here so the `<select>`
 *  can show the right option selected. A transaction whose owner was since
 *  archived won't resolve and the select falls back to blank, which is
 *  fine: reassigning it is exactly what the household would do next. */
function findOwnerId(members: SelectOption[], name: string): string | undefined {
  return members.find((m) => m.name === name)?.id;
}
