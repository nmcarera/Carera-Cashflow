import {
  listRules,
  ruleAppliedCounts,
  listActiveCategories,
  listActivePriorities,
  listActiveHouseholdMembers,
  listAccounts,
} from "@/lib/db/queries";
import { RulesManager } from "@/components/rules/RulesManager";
import { INSTITUTIONS } from "@/lib/domain/enums";

export const metadata = { title: "Rules — Carera's Cash Flow" };
export const dynamic = "force-dynamic";

const INSTITUTION_LABELS: Record<string, string> = {
  abn_amro_checking: "ABN AMRO (checking)",
  abn_amro_savings: "ABN AMRO (savings)",
  amex_eu: "Amex EU",
  chase_us: "Chase US",
  manual: "Manual",
  unknown: "Unknown",
};

export default async function RulesPage() {
  const rules = listRules();
  const applied = ruleAppliedCounts();
  const categories = listActiveCategories();
  const priorities = listActivePriorities();
  const members = listActiveHouseholdMembers();
  const accounts = listAccounts();

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight mb-1">Rules</h1>
      <p className="text-muted mb-6 max-w-2xl">
        Deterministic, transparent categorization rules — every rule you write here is plain and
        inspectable, never a guess. Rules are evaluated by precedence (lower number first); if two
        active rules with the same precedence would categorize a transaction differently, it&apos;s
        flagged for review instead of silently picked.
      </p>
      <RulesManager
        rules={rules.map((r) => ({ ...r, appliedCount: applied.get(r.id) ?? 0 }))}
        categories={categories}
        priorities={priorities}
        members={members}
        accounts={accounts.map((a) => ({ id: a.id, name: a.displayName }))}
        institutions={INSTITUTIONS.map((i) => ({ id: i, name: INSTITUTION_LABELS[i] ?? i }))}
      />
    </div>
  );
}
