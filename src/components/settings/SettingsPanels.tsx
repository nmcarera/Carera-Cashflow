"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  createCategoryAction,
  updateCategoryAction,
  setCategoryArchivedAction,
  createPriorityAction,
  updatePriorityAction,
  setPriorityArchivedAction,
  createHouseholdMemberAction,
  updateHouseholdMemberAction,
  setHouseholdMemberArchivedAction,
} from "@/app/settings/actions";

interface CategoryRow {
  id: string;
  name: string;
  color: string;
  archived: boolean;
  isSystem: boolean;
}
interface PriorityRow {
  id: string;
  name: string;
  archived: boolean;
  isSystem: boolean;
  sortOrder: number;
}
interface MemberRow {
  id: string;
  name: string;
  initials: string;
  color: string;
  archived: boolean;
}

const PALETTE = ["#7a8ba6", "#c98a5e", "#8fae7a", "#b17ab5", "#c9a15e", "#5e9fb0", "#b0715e", "#7ab08f"];
function nextColor(count: number): string {
  return PALETTE[count % PALETTE.length];
}

function usePendingError() {
  const [error, setError] = useState<string | null>(null);
  return { error, setError };
}

function CategoriesPanel({ categories, usage }: { categories: CategoryRow[]; usage: Record<string, number> }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const { error, setError } = usePendingError();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  async function add() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    const res = await createCategoryAction({ name: name.trim(), color: nextColor(categories.length) });
    setBusy(false);
    if (res.ok) {
      setName("");
      router.refresh();
    } else setError(res.errorMessage ?? "Could not create category.");
  }

  async function rename(id: string) {
    if (!editName.trim()) return;
    const res = await updateCategoryAction(id, { name: editName.trim() });
    if (res.ok) {
      setEditingId(null);
      router.refresh();
    } else setError(res.errorMessage ?? "Could not rename category.");
  }

  async function toggleArchived(id: string, archived: boolean) {
    const res = await setCategoryArchivedAction(id, archived);
    if (res.ok) router.refresh();
  }

  return (
    <section>
      <h2 className="text-lg font-semibold mb-1">Categories</h2>
      <p className="text-sm text-muted mb-3">
        What a transaction was for. Archiving a category hides it from pickers but leaves every past
        transaction&apos;s classification exactly as it was.
      </p>
      <div className="flex gap-2 mb-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="New category name…"
          aria-label="New category name"
          className="flex-1 max-w-xs rounded-lg border border-border bg-surface px-3 py-2 text-sm"
        />
        <button
          onClick={add}
          disabled={busy || !name.trim()}
          className="rounded-lg bg-foreground text-background px-3 py-2 text-sm font-medium disabled:opacity-50"
        >
          Add
        </button>
      </div>
      {error && <p className="text-sm text-[var(--danger-quiet)] mb-2">{error}</p>}
      <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
        {categories.map((c) => (
          <li key={c.id} className="flex items-center gap-3 px-3 py-2 text-sm">
            <span aria-hidden className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: c.color }} />
            {editingId === c.id ? (
              <input
                autoFocus
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && rename(c.id)}
                onBlur={() => rename(c.id)}
                className="flex-1 rounded-md border border-border bg-surface px-2 py-1 text-sm"
              />
            ) : (
              <button
                className={`flex-1 text-left ${c.archived ? "text-muted-2 line-through" : ""}`}
                onClick={() => {
                  setEditingId(c.id);
                  setEditName(c.name);
                }}
              >
                {c.name}
              </button>
            )}
            <span className="text-xs text-muted-2 whitespace-nowrap">
              {usage[c.id] ?? 0} transaction{(usage[c.id] ?? 0) === 1 ? "" : "s"}
            </span>
            <button onClick={() => toggleArchived(c.id, !c.archived)} className="text-xs text-muted underline whitespace-nowrap">
              {c.archived ? "Unarchive" : "Archive"}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PrioritiesPanel({ priorities, usage }: { priorities: PriorityRow[]; usage: Record<string, number> }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const { error, setError } = usePendingError();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  async function add() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    const res = await createPriorityAction({ name: name.trim() });
    setBusy(false);
    if (res.ok) {
      setName("");
      router.refresh();
    } else setError(res.errorMessage ?? "Could not create priority.");
  }

  async function rename(id: string) {
    if (!editName.trim()) return;
    const res = await updatePriorityAction(id, { name: editName.trim() });
    if (res.ok) {
      setEditingId(null);
      router.refresh();
    } else setError(res.errorMessage ?? "Could not rename priority.");
  }

  async function toggleArchived(id: string, archived: boolean) {
    const res = await setPriorityArchivedAction(id, archived);
    if (res.ok) router.refresh();
  }

  return (
    <section>
      <h2 className="text-lg font-semibold mb-1">Priorities</h2>
      <p className="text-sm text-muted mb-3">
        How essential a transaction was — used for the calm, non-judgmental trend view rather than a
        strict budget.
      </p>
      <div className="flex gap-2 mb-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="New priority name…"
          aria-label="New priority name"
          className="flex-1 max-w-xs rounded-lg border border-border bg-surface px-3 py-2 text-sm"
        />
        <button
          onClick={add}
          disabled={busy || !name.trim()}
          className="rounded-lg bg-foreground text-background px-3 py-2 text-sm font-medium disabled:opacity-50"
        >
          Add
        </button>
      </div>
      {error && <p className="text-sm text-[var(--danger-quiet)] mb-2">{error}</p>}
      <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
        {priorities.map((p) => (
          <li key={p.id} className="flex items-center gap-3 px-3 py-2 text-sm">
            {editingId === p.id ? (
              <input
                autoFocus
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && rename(p.id)}
                onBlur={() => rename(p.id)}
                className="flex-1 rounded-md border border-border bg-surface px-2 py-1 text-sm"
              />
            ) : (
              <button
                className={`flex-1 text-left ${p.archived ? "text-muted-2 line-through" : ""}`}
                onClick={() => {
                  setEditingId(p.id);
                  setEditName(p.name);
                }}
              >
                {p.name}
              </button>
            )}
            <span className="text-xs text-muted-2 whitespace-nowrap">
              {usage[p.id] ?? 0} transaction{(usage[p.id] ?? 0) === 1 ? "" : "s"}
            </span>
            <button onClick={() => toggleArchived(p.id, !p.archived)} className="text-xs text-muted underline whitespace-nowrap">
              {p.archived ? "Unarchive" : "Archive"}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function HouseholdPanel({ members, usage }: { members: MemberRow[]; usage: Record<string, number> }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [initials, setInitials] = useState("");
  const [busy, setBusy] = useState(false);
  const { error, setError } = usePendingError();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  async function add() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    const res = await createHouseholdMemberAction({
      name: name.trim(),
      initials: initials.trim() || name.trim().slice(0, 2),
      color: nextColor(members.length),
    });
    setBusy(false);
    if (res.ok) {
      setName("");
      setInitials("");
      router.refresh();
    } else setError(res.errorMessage ?? "Could not add household member.");
  }

  async function rename(id: string) {
    if (!editName.trim()) return;
    const res = await updateHouseholdMemberAction(id, { name: editName.trim() });
    if (res.ok) {
      setEditingId(null);
      router.refresh();
    } else setError(res.errorMessage ?? "Could not rename.");
  }

  async function toggleArchived(id: string, archived: boolean) {
    const res = await setHouseholdMemberArchivedAction(id, archived);
    if (res.ok) router.refresh();
  }

  return (
    <section>
      <h2 className="text-lg font-semibold mb-1">Household members</h2>
      <p className="text-sm text-muted mb-3">Who a transaction belongs to, for ownership splits.</p>
      <div className="flex gap-2 mb-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name…"
          aria-label="New household member name"
          className="flex-1 max-w-xs rounded-lg border border-border bg-surface px-3 py-2 text-sm"
        />
        <input
          value={initials}
          onChange={(e) => setInitials(e.target.value)}
          placeholder="Initials"
          aria-label="Initials"
          maxLength={3}
          className="w-24 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
        />
        <button
          onClick={add}
          disabled={busy || !name.trim()}
          className="rounded-lg bg-foreground text-background px-3 py-2 text-sm font-medium disabled:opacity-50"
        >
          Add
        </button>
      </div>
      {error && <p className="text-sm text-[var(--danger-quiet)] mb-2">{error}</p>}
      <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
        {members.map((m) => (
          <li key={m.id} className="flex items-center gap-3 px-3 py-2 text-sm">
            <span
              aria-hidden
              className="inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-semibold text-white shrink-0"
              style={{ background: m.color }}
            >
              {m.initials}
            </span>
            {editingId === m.id ? (
              <input
                autoFocus
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && rename(m.id)}
                onBlur={() => rename(m.id)}
                className="flex-1 rounded-md border border-border bg-surface px-2 py-1 text-sm"
              />
            ) : (
              <button
                className={`flex-1 text-left ${m.archived ? "text-muted-2 line-through" : ""}`}
                onClick={() => {
                  setEditingId(m.id);
                  setEditName(m.name);
                }}
              >
                {m.name}
              </button>
            )}
            <span className="text-xs text-muted-2 whitespace-nowrap">
              {usage[m.id] ?? 0} transaction{(usage[m.id] ?? 0) === 1 ? "" : "s"}
            </span>
            <button onClick={() => toggleArchived(m.id, !m.archived)} className="text-xs text-muted underline whitespace-nowrap">
              {m.archived ? "Unarchive" : "Archive"}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SettingsPanels({
  categories,
  priorities,
  members,
  categoryUsage,
  priorityUsage,
  memberUsage,
}: {
  categories: CategoryRow[];
  priorities: PriorityRow[];
  members: MemberRow[];
  categoryUsage: Record<string, number>;
  priorityUsage: Record<string, number>;
  memberUsage: Record<string, number>;
}) {
  return (
    <div className="space-y-10">
      <CategoriesPanel categories={categories} usage={categoryUsage} />
      <PrioritiesPanel priorities={priorities} usage={priorityUsage} />
      <HouseholdPanel members={members} usage={memberUsage} />
    </div>
  );
}
