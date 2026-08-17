"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import {
  computeHouseholdSummary,
  computeMonthlyTrend,
  computeCategoryBreakdown,
  filterByMember,
  listAvailableMonths,
} from "@/lib/analytics/summary";
import type { AnalyticsRow } from "@/lib/analytics/queries";
import type { SavingsGoalProgress } from "@/lib/analytics/savingsGoals";
import { StatCard } from "./StatCard";
import { TrendChart } from "./TrendChart";
import { CategoryDonut } from "./CategoryDonut";
import { SavingsGoalCard } from "./SavingsGoalCard";

interface HouseholdMemberOption {
  id: string;
  name: string;
}

const TREND_WINDOW_OPTIONS = [
  { value: 3, label: "Last 3 months" },
  { value: 6, label: "Last 6 months" },
  { value: 12, label: "Last 12 months" },
];

function monthName(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(new Date(Date.UTC(y, m - 1, 1)));
}

export function DashboardClient({
  rows,
  goals,
  members,
  needsReview,
}: {
  rows: AnalyticsRow[];
  goals: SavingsGoalProgress[];
  members: HouseholdMemberOption[];
  needsReview: number;
}) {
  const memberSelectId = useId();
  const monthSelectId = useId();
  const windowSelectId = useId();

  // `null` means "no explicit choice yet" — falls back to "everyone" /
  // "the latest month with data," recomputed live rather than frozen at
  // whatever month happened to be latest when the page first loaded.
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [trendMonthsBack, setTrendMonthsBack] = useState(6);

  const filteredRows = useMemo(() => filterByMember(rows, selectedMemberId), [rows, selectedMemberId]);
  const availableMonths = useMemo(() => listAvailableMonths(filteredRows), [filteredRows]);
  const effectiveMonth =
    selectedMonth && availableMonths.includes(selectedMonth)
      ? selectedMonth
      : (availableMonths[availableMonths.length - 1] ?? "");

  const summary = useMemo(() => computeHouseholdSummary(filteredRows, effectiveMonth || undefined), [filteredRows, effectiveMonth]);
  const trend = useMemo(
    () => computeMonthlyTrend(filteredRows, trendMonthsBack, effectiveMonth || undefined),
    [filteredRows, trendMonthsBack, effectiveMonth]
  );
  const categoryBreakdown = useMemo(
    () => (effectiveMonth ? computeCategoryBreakdown(filteredRows, effectiveMonth) : []),
    [filteredRows, effectiveMonth]
  );

  const leftOver = summary.currentMonth.netEur;
  const selectedMemberName = selectedMemberId ? members.find((m) => m.id === selectedMemberId)?.name : null;

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight mb-1">Your household, at a glance</h1>
        <p className="text-muted max-w-2xl">
          {effectiveMonth
            ? `Here's how ${monthName(effectiveMonth)} looks${selectedMemberName ? ` for ${selectedMemberName} (plus shared spending)` : ""}.`
            : "Import a bank statement to see your household picture here."}
        </p>
      </section>

      {rows.length > 0 && (
        <section
          aria-label="Dashboard filters"
          className="flex flex-wrap items-end gap-4 rounded-xl border border-border bg-surface p-4"
        >
          <div className="flex flex-col gap-1">
            <label htmlFor={memberSelectId} className="text-xs uppercase tracking-wide text-muted">
              Whose spending
            </label>
            <select
              id={memberSelectId}
              value={selectedMemberId ?? ""}
              onChange={(e) => {
                setSelectedMemberId(e.target.value || null);
                // A member's own data may not cover the same months as the
                // household total — start from that member's latest month
                // again rather than silently keeping a now-mismatched pick.
                setSelectedMonth(null);
              }}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm min-w-[10rem]"
            >
              <option value="">Everyone</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor={monthSelectId} className="text-xs uppercase tracking-wide text-muted">
              Month
            </label>
            <select
              id={monthSelectId}
              value={effectiveMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              disabled={availableMonths.length === 0}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm min-w-[10rem]"
            >
              {availableMonths.length === 0 && <option value="">No data yet</option>}
              {[...availableMonths].reverse().map((m) => (
                <option key={m} value={m}>
                  {monthName(m)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor={windowSelectId} className="text-xs uppercase tracking-wide text-muted">
              Trend chart range
            </label>
            <select
              id={windowSelectId}
              value={trendMonthsBack}
              onChange={(e) => setTrendMonthsBack(Number(e.target.value))}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm min-w-[10rem]"
            >
              {TREND_WINDOW_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {(selectedMemberId || selectedMonth) && (
            <button
              type="button"
              onClick={() => {
                setSelectedMemberId(null);
                setSelectedMonth(null);
              }}
              className="text-sm text-muted underline underline-offset-2 hover:text-foreground mb-2"
            >
              Reset filters
            </button>
          )}
        </section>
      )}

      {summary.pendingConversionCount > 0 && (
        <p className="text-sm text-muted-2 -mt-4">
          Heads up: {summary.pendingConversionCount} transaction
          {summary.pendingConversionCount === 1 ? "" : "s"} still waiting on a currency conversion, so
          totals below may creep up slightly once resolved. See the review page to resolve them.
        </p>
      )}

      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4" aria-label="This month's totals">
        <StatCard label="Money in" amountEur={summary.currentMonth.incomeEur} tone="income" />
        <StatCard label="Money out" amountEur={summary.currentMonth.expenseEur} tone="expense" />
        <StatCard
          label="Left over"
          amountEur={leftOver}
          tone={leftOver >= 0 ? "savings" : "expense"}
          helpText={leftOver >= 0 ? "Money in minus money out" : "You spent more than came in"}
        />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl border border-border bg-surface p-5">
          <h2 className="text-sm uppercase tracking-wide text-muted mb-4">
            Income vs. spending, {TREND_WINDOW_OPTIONS.find((o) => o.value === trendMonthsBack)?.label.toLowerCase()}
          </h2>
          <TrendChart data={trend} />
        </div>
        <div className="rounded-xl border border-border bg-surface p-5">
          <h2 className="text-sm uppercase tracking-wide text-muted mb-4">
            Where the money went{effectiveMonth ? ` — ${monthName(effectiveMonth)}` : ""}
          </h2>
          <CategoryDonut items={categoryBreakdown} />
        </div>
      </section>

      {goals.length > 0 && (
        <section aria-labelledby="goals-heading">
          <h2 id="goals-heading" className="text-sm uppercase tracking-wide text-muted mb-3">
            Savings goals
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {goals.map((g) => (
              <SavingsGoalCard key={g.id} goal={g} />
            ))}
          </div>
        </section>
      )}

      <section className="rounded-xl border border-border bg-surface p-5 flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="font-medium">
            {needsReview === 0
              ? "Nothing needs review right now."
              : `${needsReview} transaction${needsReview === 1 ? "" : "s"} need${needsReview === 1 ? "s" : ""} review.`}
          </p>
          <p className="text-sm text-muted">Missing category, owner, or an uncertain match.</p>
        </div>
        <Link
          href="/transactions"
          className="rounded-lg bg-foreground text-background px-4 py-2 text-sm font-medium"
        >
          Open transaction table
        </Link>
      </section>
    </div>
  );
}
