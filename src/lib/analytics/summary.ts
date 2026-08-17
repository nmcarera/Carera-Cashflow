/**
 * Household totals, category breakdown, and monthly trend — pure functions
 * over the plain rows `queries.ts` fetches, so the actual math is
 * unit-testable (tests/analytics.test.ts) without touching a database.
 *
 * What counts toward income/expense totals (per README "How duplicate and
 * transfer detection work": confirmed transfers and settlements are
 * excluded from household income/expense totals): a row must have a
 * resolved EUR amount, must not be `direction: 'transfer'`, and must not
 * carry the "Excluded / transfer" priority. A transaction still pending
 * currency conversion is never guessed into a total — it's simply left out
 * and counted separately (`pendingConversionCount`) so the dashboard can
 * say so rather than silently under-reporting.
 */
import type { AnalyticsRow } from "./queries";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function isCountedForTotals(row: AnalyticsRow): boolean {
  return row.eurAmount !== null && row.direction !== "transfer" && row.priorityName !== "Excluded / transfer";
}

function monthOf(dateIso: string): string {
  return dateIso.slice(0, 7);
}

/** Dashboard "member" filter: a household member's own individual
 *  transactions plus every shared transaction (shared spending is relevant
 *  to both members, not just whoever the household happens to file it
 *  under) — `null`/`undefined` means "everyone," i.e. no filtering. */
export function filterByMember(rows: AnalyticsRow[], memberId: string | null | undefined): AnalyticsRow[] {
  if (!memberId) return rows;
  return rows.filter((r) => r.ownershipType === "shared" || r.ownerMemberId === memberId);
}

/** Every distinct calendar month that has at least one row counted toward
 *  totals, oldest first — the source of truth for a month picker so it
 *  never offers a month with nothing to show. */
export function listAvailableMonths(rows: AnalyticsRow[]): string[] {
  const months = new Set(rows.filter(isCountedForTotals).map((r) => monthOf(r.transactionDate)));
  return [...months].sort();
}

function lastNMonths(latestMonth: string, n: number): string[] {
  const [y, m] = latestMonth.split("-").map(Number);
  const months: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    months.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return months;
}

export interface PeriodTotals {
  month: string; // YYYY-MM
  incomeEur: number;
  expenseEur: number; // always >= 0
  netEur: number;
}

/** The last `monthsBack` calendar months ending at `anchorMonth`, or — when
 *  `anchorMonth` is omitted — at the most recent month that actually has
 *  counted data (not necessarily "this month" by the system clock — a
 *  local-first app's most recent import might be from a few weeks ago, and
 *  showing an all-zero "current month" would be misleading rather than
 *  calm). Months with no transactions still appear, at zero, so a trend
 *  chart doesn't silently skip a quiet month. `anchorMonth` exists so the
 *  dashboard's month picker can move the whole trend window, not just the
 *  single-month stat cards. */
export function computeMonthlyTrend(rows: AnalyticsRow[], monthsBack = 6, anchorMonth?: string): PeriodTotals[] {
  const counted = rows.filter(isCountedForTotals);
  if (counted.length === 0) return [];

  const latestMonth =
    anchorMonth ??
    counted.reduce((max, r) => {
      const m = monthOf(r.transactionDate);
      return m > max ? m : max;
    }, "0000-00");

  return lastNMonths(latestMonth, monthsBack).map((month) => {
    const inMonth = counted.filter((r) => monthOf(r.transactionDate) === month);
    const incomeEur = round2(inMonth.filter((r) => r.direction === "credit").reduce((s, r) => s + (r.eurAmount ?? 0), 0));
    const expenseEur = round2(
      Math.abs(inMonth.filter((r) => r.direction === "debit").reduce((s, r) => s + (r.eurAmount ?? 0), 0))
    );
    return { month, incomeEur, expenseEur, netEur: round2(incomeEur - expenseEur) };
  });
}

export interface HouseholdSummary {
  currentMonth: PeriodTotals;
  previousMonth: PeriodTotals | null;
  pendingConversionCount: number;
}

export function computeHouseholdSummary(rows: AnalyticsRow[], anchorMonth?: string): HouseholdSummary {
  const trend = computeMonthlyTrend(rows, 2, anchorMonth);
  const currentMonth = trend[trend.length - 1] ?? { month: "", incomeEur: 0, expenseEur: 0, netEur: 0 };
  const previousMonth = trend.length > 1 ? trend[trend.length - 2] : null;
  const pendingConversionCount = rows.filter((r) => r.eurAmount === null).length;
  return { currentMonth, previousMonth, pendingConversionCount };
}

export interface CategoryBreakdownItem {
  categoryId: string | null;
  categoryName: string;
  color: string;
  totalEur: number;
}

const OTHER_COLOR = "#8a90a0";

/** Expense-only breakdown for one month, capped to the top `topN - 1`
 *  categories plus a combined "Other" slice — a pie chart with fifteen
 *  slivers is not "idiot proof," it's noise. */
export function computeCategoryBreakdown(rows: AnalyticsRow[], month: string, topN = 6): CategoryBreakdownItem[] {
  const expenseRows = rows.filter(
    (r) => isCountedForTotals(r) && r.direction === "debit" && monthOf(r.transactionDate) === month
  );

  const byCategory = new Map<string, { name: string; color: string; total: number }>();
  for (const r of expenseRows) {
    const key = r.categoryId ?? "__uncategorized__";
    const entry = byCategory.get(key) ?? { name: r.categoryName ?? "Uncategorized", color: r.categoryColor ?? OTHER_COLOR, total: 0 };
    entry.total += Math.abs(r.eurAmount ?? 0);
    byCategory.set(key, entry);
  }

  const sorted = [...byCategory.entries()]
    .map(([key, v]) => ({
      categoryId: key === "__uncategorized__" ? null : key,
      categoryName: v.name,
      color: v.color,
      totalEur: round2(v.total),
    }))
    .sort((a, b) => b.totalEur - a.totalEur);

  if (sorted.length <= topN) return sorted;
  const top = sorted.slice(0, topN - 1);
  const otherTotal = round2(sorted.slice(topN - 1).reduce((s, r) => s + r.totalEur, 0));
  return [...top, { categoryId: null, categoryName: "Other", color: OTHER_COLOR, totalEur: otherTotal }];
}
