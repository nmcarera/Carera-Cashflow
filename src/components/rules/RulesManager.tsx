"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  createRuleAction,
  updateRuleAction,
  setRuleActiveAction,
  deleteRuleAction,
  previewRuleMatchesAction,
  applyRuleHistoricallyAction,
} from "@/app/rules/actions";
import type { RuleInput } from "@/lib/categorization/apply";

export interface RuleRow {
  id: string;
  name: string;
  active: boolean;
  precedence: number;
  matchMerchantContains: string | null;
  matchDescriptionContains: string | null;
  matchInstitution: string | null;
  matchAccountId: string | null;
  matchAmountMin: number | null;
  matchAmountMax: number | null;
  matchDirection: string | null;
  setCategoryId: string | null;
  setPriorityId: string | null;
  setOwnershipType: string | null;
  setOwnerMemberId: string | null;
  appliedCount: number;
}

interface Option {
  id: string;
  name: string;
}

const EMPTY_FORM: RuleInput = {
  name: "",
  precedence: 100,
  matchMerchantContains: "",
  matchDescriptionContains: "",
  matchInstitution: "",
  matchAccountId: "",
  matchAmountMin: null,
  matchAmountMax: null,
  matchDirection: "",
  setCategoryId: "",
  setPriorityId: "",
  setOwnershipType: "",
  setOwnerMemberId: "",
};

function describeMatch(r: RuleRow, opts: { accounts: Option[]; institutions: Option[] }): string {
  const parts: string[] = [];
  if (r.matchMerchantContains) parts.push(`merchant contains "${r.matchMerchantContains}"`);
  if (r.matchDescriptionContains) parts.push(`description contains "${r.matchDescriptionContains}"`);
  if (r.matchInstitution) parts.push(`from ${opts.institutions.find((i) => i.id === r.matchInstitution)?.name ?? r.matchInstitution}`);
  if (r.matchAccountId) parts.push(`account ${opts.accounts.find((a) => a.id === r.matchAccountId)?.name ?? r.matchAccountId}`);
  if (r.matchAmountMin !== null) parts.push(`amount ≥ ${r.matchAmountMin}`);
  if (r.matchAmountMax !== null) parts.push(`amount ≤ ${r.matchAmountMax}`);
  if (r.matchDirection) parts.push(`direction = ${r.matchDirection}`);
  return parts.length ? parts.join(" and ") : "(no conditions)";
}

function describeEffect(r: RuleRow, opts: { categories: Option[]; priorities: Option[]; members: Option[] }): string {
  const parts: string[] = [];
  if (r.setCategoryId) parts.push(`category → ${opts.categories.find((c) => c.id === r.setCategoryId)?.name ?? "?"}`);
  if (r.setPriorityId) parts.push(`priority → ${opts.priorities.find((p) => p.id === r.setPriorityId)?.name ?? "?"}`);
  if (r.setOwnershipType === "shared") parts.push("owner → Shared");
  else if (r.setOwnershipType === "unassigned") parts.push("owner → Unassigned");
  else if (r.setOwnershipType === "person") parts.push(`owner → ${opts.members.find((m) => m.id === r.setOwnerMemberId)?.name ?? "?"}`);
  return parts.join(", ");
}

function RuleForm({
  initial,
  onDone,
  categories,
  priorities,
  members,
  accounts,
  institutions,
}: {
  initial: (RuleInput & { id?: string }) | null;
  onDone: () => void;
  categories: Option[];
  priorities: Option[];
  members: Option[];
  accounts: Option[];
  institutions: Option[];
}) {
  const router = useRouter();
  const [form, setForm] = useState<RuleInput>(initial ?? EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ matchCount: number; sampleDescriptions: string[] } | null>(null);

  function set<K extends keyof RuleInput>(key: K, value: RuleInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setPreview(null);
  }

  async function doPreview() {
    setBusy(true);
    const res = await previewRuleMatchesAction(form);
    setBusy(false);
    if (res.ok && res.data) setPreview(res.data);
    else setError(res.errorMessage ?? "Could not preview.");
  }

  async function save() {
    setBusy(true);
    setError(null);
    const res = initial?.id ? await updateRuleAction(initial.id, form) : await createRuleAction(form);
    setBusy(false);
    if (res.ok) {
      router.refresh();
      onDone();
    } else {
      setError(res.errorMessage ?? "Could not save rule.");
    }
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm">
          Rule name
          <input
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
          />
        </label>
        <label className="text-sm">
          Precedence (lower = evaluated first)
          <input
            type="number"
            value={form.precedence ?? 100}
            onChange={(e) => set("precedence", Number(e.target.value))}
            className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
          />
        </label>
      </div>

      <p className="text-xs uppercase tracking-wide text-muted-2 pt-2">Match (all set conditions must apply)</p>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm">
          Merchant contains
          <input
            value={form.matchMerchantContains ?? ""}
            onChange={(e) => set("matchMerchantContains", e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
          />
        </label>
        <label className="text-sm">
          Description contains
          <input
            value={form.matchDescriptionContains ?? ""}
            onChange={(e) => set("matchDescriptionContains", e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
          />
        </label>
        <label className="text-sm">
          Institution
          <select
            value={form.matchInstitution ?? ""}
            onChange={(e) => set("matchInstitution", e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
          >
            <option value="">Any</option>
            {institutions.map((i) => (
              <option key={i.id} value={i.id}>{i.name}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Account
          <select
            value={form.matchAccountId ?? ""}
            onChange={(e) => set("matchAccountId", e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
          >
            <option value="">Any</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Amount ≥
          <input
            type="number"
            step="0.01"
            value={form.matchAmountMin ?? ""}
            onChange={(e) => set("matchAmountMin", e.target.value === "" ? null : Number(e.target.value))}
            className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
          />
        </label>
        <label className="text-sm">
          Amount ≤
          <input
            type="number"
            step="0.01"
            value={form.matchAmountMax ?? ""}
            onChange={(e) => set("matchAmountMax", e.target.value === "" ? null : Number(e.target.value))}
            className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
          />
        </label>
        <label className="text-sm">
          Direction
          <select
            value={form.matchDirection ?? ""}
            onChange={(e) => set("matchDirection", e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
          >
            <option value="">Any</option>
            <option value="debit">Debit</option>
            <option value="credit">Credit</option>
            <option value="transfer">Transfer</option>
          </select>
        </label>
      </div>

      <p className="text-xs uppercase tracking-wide text-muted-2 pt-2">Effect (any subset)</p>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm">
          Category
          <select
            value={form.setCategoryId ?? ""}
            onChange={(e) => set("setCategoryId", e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
          >
            <option value="">Don&apos;t set</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Priority
          <select
            value={form.setPriorityId ?? ""}
            onChange={(e) => set("setPriorityId", e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
          >
            <option value="">Don&apos;t set</option>
            {priorities.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Owner
          <select
            value={form.setOwnershipType ?? ""}
            onChange={(e) => {
              set("setOwnershipType", e.target.value);
              if (e.target.value !== "person") set("setOwnerMemberId", "");
            }}
            className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
          >
            <option value="">Don&apos;t set</option>
            <option value="shared">Shared</option>
            <option value="unassigned">Unassigned</option>
            <option value="person">A household member…</option>
          </select>
        </label>
        {form.setOwnershipType === "person" && (
          <label className="text-sm">
            Member
            <select
              value={form.setOwnerMemberId ?? ""}
              onChange={(e) => set("setOwnerMemberId", e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
            >
              <option value="">Choose…</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      {error && <p className="text-sm text-[var(--danger-quiet)]">{error}</p>}
      {preview && (
        <p className="text-sm text-muted">
          Would match {preview.matchCount} existing transaction{preview.matchCount === 1 ? "" : "s"}
          {preview.sampleDescriptions.length > 0 && ` — e.g. ${preview.sampleDescriptions.join(", ")}`}
        </p>
      )}

      <div className="flex items-center gap-3 pt-2">
        <button onClick={doPreview} disabled={busy} className="text-sm text-muted underline disabled:opacity-50">
          Preview matches
        </button>
        <button
          onClick={save}
          disabled={busy || !form.name.trim()}
          className="rounded-lg bg-foreground text-background px-3 py-2 text-sm font-medium disabled:opacity-50"
        >
          {initial?.id ? "Save changes" : "Create rule"}
        </button>
        <button onClick={onDone} className="text-sm text-muted underline">
          Cancel
        </button>
      </div>
    </div>
  );
}

export function RulesManager({
  rules,
  categories,
  priorities,
  members,
  accounts,
  institutions,
}: {
  rules: RuleRow[];
  categories: Option[];
  priorities: Option[];
  members: Option[];
  accounts: Option[];
  institutions: Option[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<(RuleInput & { id?: string }) | null | "new">(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function toggleActive(id: string, active: boolean) {
    setBusyId(id);
    await setRuleActiveAction(id, active);
    setBusyId(null);
    router.refresh();
  }

  async function remove(id: string) {
    setBusyId(id);
    const res = await deleteRuleAction(id);
    setBusyId(null);
    if (res.ok && res.data && !res.data.deleted) {
      setMessage(res.data.reason ?? "Could not delete this rule.");
    } else if (res.ok) {
      router.refresh();
    } else {
      setMessage(res.errorMessage ?? "Could not delete this rule.");
    }
  }

  async function applyHistorically(id: string) {
    setBusyId(id);
    const res = await applyRuleHistoricallyAction(id);
    setBusyId(null);
    if (res.ok && res.data) {
      setMessage(
        `Updated ${res.data.updated} transaction${res.data.updated === 1 ? "" : "s"}.` +
          (res.data.skippedAsConflict > 0
            ? ` ${res.data.skippedAsConflict} matched but conflict with another equal-precedence rule and were left alone.`
            : "")
      );
      router.refresh();
    } else {
      setMessage(res.errorMessage ?? "Could not apply this rule.");
    }
  }

  const opts = { categories, priorities, members, accounts, institutions };

  return (
    <div>
      {message && (
        <div className="mb-4 rounded-lg border border-border bg-surface px-3 py-2 text-sm flex items-center justify-between gap-3">
          <span>{message}</span>
          <button onClick={() => setMessage(null)} className="text-xs underline text-muted">Dismiss</button>
        </div>
      )}

      {editing ? (
        <div className="mb-6">
          <RuleForm
            initial={editing === "new" ? null : editing}
            onDone={() => setEditing(null)}
            categories={categories}
            priorities={priorities}
            members={members}
            accounts={accounts}
            institutions={institutions}
          />
        </div>
      ) : (
        <button
          onClick={() => setEditing("new")}
          className="mb-6 rounded-lg bg-foreground text-background px-3 py-2 text-sm font-medium"
        >
          New rule
        </button>
      )}

      <ul className="space-y-2">
        {rules.map((r) => (
          <li key={r.id} className="rounded-xl border border-border bg-surface p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className={`font-medium text-sm ${r.active ? "" : "text-muted-2 line-through"}`}>
                  {r.name} <span className="text-muted-2 font-normal">· precedence {r.precedence}</span>
                </p>
                <p className="text-xs text-muted mt-0.5">If {describeMatch(r, opts)}, set {describeEffect(r, opts) || "(nothing)"}.</p>
                <p className="text-xs text-muted-2 mt-0.5">
                  Currently applied to {r.appliedCount} transaction{r.appliedCount === 1 ? "" : "s"}.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  disabled={busyId === r.id}
                  onClick={() => applyHistorically(r.id)}
                  className="text-xs underline text-muted disabled:opacity-50"
                >
                  Apply historically
                </button>
                <button
                  disabled={busyId === r.id}
                  onClick={() => setEditing({ ...r })}
                  className="text-xs underline text-muted disabled:opacity-50"
                >
                  Edit
                </button>
                <button
                  disabled={busyId === r.id}
                  onClick={() => toggleActive(r.id, !r.active)}
                  className="text-xs underline text-muted disabled:opacity-50"
                >
                  {r.active ? "Disable" : "Enable"}
                </button>
                <button
                  disabled={busyId === r.id}
                  onClick={() => remove(r.id)}
                  className="text-xs underline text-[var(--danger-quiet)] disabled:opacity-50"
                >
                  Delete
                </button>
              </div>
            </div>
          </li>
        ))}
        {rules.length === 0 && <p className="text-sm text-muted">No rules yet.</p>}
      </ul>
    </div>
  );
}
