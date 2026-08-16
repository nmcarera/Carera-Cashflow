import { formatEur, formatDate, formatPercent } from "@/lib/format";
import type { SavingsGoalProgress } from "@/lib/analytics/savingsGoals";

export function SavingsGoalCard({ goal }: { goal: SavingsGoalProgress }) {
  const pct = Math.round(goal.progressFraction * 100);
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <p className="font-medium">{goal.name}</p>
        <p className="text-sm text-muted">
          {formatEur(goal.currentBalanceEur)} of {formatEur(goal.targetBalanceEur)}
        </p>
      </div>
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${goal.name} progress`}
        className="h-4 w-full rounded-full bg-background overflow-hidden border border-border"
      >
        <div
          className="h-full rounded-full transition-[width]"
          style={{ width: `${Math.max(pct, pct > 0 ? 3 : 0)}%`, background: "var(--savings)" }}
        />
      </div>
      <div className="flex items-center justify-between mt-2 text-sm text-muted">
        <span>{formatPercent(goal.progressFraction)} there</span>
        {goal.targetDate && <span>Target: {formatDate(goal.targetDate)}</span>}
      </div>
    </div>
  );
}
