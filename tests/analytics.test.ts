import { describe, it, expect } from "vitest";
import {
  computeMonthlyTrend,
  computeHouseholdSummary,
  computeCategoryBreakdown,
  filterByMember,
  listAvailableMonths,
} from "@/lib/analytics/summary";
import type { AnalyticsRow } from "@/lib/analytics/queries";

function row(overrides: Partial<AnalyticsRow> = {}): AnalyticsRow {
  return {
    transactionDate: "2026-06-15",
    direction: "debit",
    eurAmount: -10,
    categoryId: null,
    categoryName: null,
    categoryColor: null,
    priorityName: null,
    ownershipType: "shared",
    ownerMemberId: null,
    ...overrides,
  };
}

describe("computeMonthlyTrend", () => {
  it("returns an empty array when there is no counted data at all", () => {
    expect(computeMonthlyTrend([])).toEqual([]);
    expect(computeMonthlyTrend([row({ eurAmount: null })])).toEqual([]);
  });

  it("sums income and expense per month and computes net", () => {
    const rows = [
      row({ transactionDate: "2026-06-01", direction: "credit", eurAmount: 2000 }),
      row({ transactionDate: "2026-06-05", direction: "debit", eurAmount: -500 }),
      row({ transactionDate: "2026-06-10", direction: "debit", eurAmount: -300 }),
    ];
    const trend = computeMonthlyTrend(rows, 1);
    expect(trend).toEqual([{ month: "2026-06", incomeEur: 2000, expenseEur: 800, netEur: 1200 }]);
  });

  it("expresses expense as a positive magnitude even though eurAmount is negative", () => {
    const rows = [row({ transactionDate: "2026-06-01", direction: "debit", eurAmount: -42.5 })];
    const trend = computeMonthlyTrend(rows, 1);
    expect(trend[0].expenseEur).toBe(42.5);
  });

  it("includes zero-activity months in the range rather than skipping them", () => {
    const rows = [row({ transactionDate: "2026-06-01", direction: "credit", eurAmount: 100 })];
    const trend = computeMonthlyTrend(rows, 3);
    expect(trend.map((t) => t.month)).toEqual(["2026-04", "2026-05", "2026-06"]);
    expect(trend[0]).toEqual({ month: "2026-04", incomeEur: 0, expenseEur: 0, netEur: 0 });
  });

  it("anchors the range on the latest month with counted data, not wall-clock today", () => {
    // Today (per env) is 2026-08-16, but the latest transaction is in June —
    // the trend must not silently include July/August as zero months just
    // because that's "now."
    const rows = [row({ transactionDate: "2026-06-20", direction: "credit", eurAmount: 50 })];
    const trend = computeMonthlyTrend(rows, 2);
    expect(trend.map((t) => t.month)).toEqual(["2026-05", "2026-06"]);
  });

  it("excludes transfers, excluded-priority rows, and pending-conversion rows from totals", () => {
    const rows = [
      row({ transactionDate: "2026-06-01", direction: "credit", eurAmount: 1000 }),
      row({ transactionDate: "2026-06-02", direction: "transfer", eurAmount: 300 }),
      row({ transactionDate: "2026-06-03", direction: "debit", eurAmount: -50, priorityName: "Excluded / transfer" }),
      row({ transactionDate: "2026-06-04", direction: "debit", eurAmount: null }),
    ];
    const trend = computeMonthlyTrend(rows, 1);
    expect(trend).toEqual([{ month: "2026-06", incomeEur: 1000, expenseEur: 0, netEur: 1000 }]);
  });

  it("handles a December-to-January month boundary correctly", () => {
    const rows = [row({ transactionDate: "2026-01-05", direction: "credit", eurAmount: 10 })];
    const trend = computeMonthlyTrend(rows, 2);
    expect(trend.map((t) => t.month)).toEqual(["2025-12", "2026-01"]);
  });
});

describe("computeHouseholdSummary", () => {
  it("reports current and previous month plus a pending-conversion count", () => {
    const rows = [
      row({ transactionDate: "2026-05-01", direction: "credit", eurAmount: 500 }),
      row({ transactionDate: "2026-06-01", direction: "credit", eurAmount: 800 }),
      row({ transactionDate: "2026-06-02", direction: "debit", eurAmount: -200 }),
      row({ transactionDate: "2026-06-03", direction: "debit", eurAmount: null }),
      row({ transactionDate: "2026-06-04", direction: "credit", eurAmount: null }),
    ];
    const summary = computeHouseholdSummary(rows);
    expect(summary.currentMonth).toEqual({ month: "2026-06", incomeEur: 800, expenseEur: 200, netEur: 600 });
    expect(summary.previousMonth).toEqual({ month: "2026-05", incomeEur: 500, expenseEur: 0, netEur: 500 });
    // Both pending rows count, regardless of direction.
    expect(summary.pendingConversionCount).toBe(2);
  });

  it("returns a null previous month and zeroed current month when there is no data", () => {
    const summary = computeHouseholdSummary([]);
    expect(summary.previousMonth).toBeNull();
    expect(summary.currentMonth).toEqual({ month: "", incomeEur: 0, expenseEur: 0, netEur: 0 });
    expect(summary.pendingConversionCount).toBe(0);
  });
});

describe("computeCategoryBreakdown", () => {
  it("groups expenses by category and sorts descending", () => {
    const rows = [
      row({ transactionDate: "2026-06-01", categoryId: "groceries", categoryName: "Groceries", categoryColor: "#111", eurAmount: -50 }),
      row({ transactionDate: "2026-06-02", categoryId: "groceries", categoryName: "Groceries", categoryColor: "#111", eurAmount: -30 }),
      row({ transactionDate: "2026-06-03", categoryId: "rent", categoryName: "Rent", categoryColor: "#222", eurAmount: -900 }),
    ];
    const breakdown = computeCategoryBreakdown(rows, "2026-06");
    expect(breakdown).toEqual([
      { categoryId: "rent", categoryName: "Rent", color: "#222", totalEur: 900 },
      { categoryId: "groceries", categoryName: "Groceries", color: "#111", totalEur: 80 },
    ]);
  });

  it("ignores income, transfers, other months, and pending-conversion rows", () => {
    const rows = [
      row({ transactionDate: "2026-06-01", direction: "credit", eurAmount: 500, categoryId: "salary", categoryName: "Salary" }),
      row({ transactionDate: "2026-06-02", direction: "transfer", eurAmount: -100, categoryId: "x", categoryName: "X" }),
      row({ transactionDate: "2026-05-02", direction: "debit", eurAmount: -20, categoryId: "groceries", categoryName: "Groceries" }),
      row({ transactionDate: "2026-06-04", direction: "debit", eurAmount: null, categoryId: "groceries", categoryName: "Groceries" }),
    ];
    expect(computeCategoryBreakdown(rows, "2026-06")).toEqual([]);
  });

  it("falls back to Uncategorized for a null category", () => {
    const rows = [row({ transactionDate: "2026-06-01", categoryId: null, categoryName: null, eurAmount: -15 })];
    const breakdown = computeCategoryBreakdown(rows, "2026-06");
    expect(breakdown).toEqual([{ categoryId: null, categoryName: "Uncategorized", color: "#8a90a0", totalEur: 15 }]);
  });

  it("caps to the top N-1 categories plus a combined Other slice", () => {
    const rows = [
      row({ transactionDate: "2026-06-01", categoryId: "a", categoryName: "A", categoryColor: "#a", eurAmount: -100 }),
      row({ transactionDate: "2026-06-01", categoryId: "b", categoryName: "B", categoryColor: "#b", eurAmount: -90 }),
      row({ transactionDate: "2026-06-01", categoryId: "c", categoryName: "C", categoryColor: "#c", eurAmount: -80 }),
      row({ transactionDate: "2026-06-01", categoryId: "d", categoryName: "D", categoryColor: "#d", eurAmount: -10 }),
      row({ transactionDate: "2026-06-01", categoryId: "e", categoryName: "E", categoryColor: "#e", eurAmount: -5 }),
    ];
    const breakdown = computeCategoryBreakdown(rows, "2026-06", 3);
    expect(breakdown).toHaveLength(3);
    expect(breakdown[0]).toEqual({ categoryId: "a", categoryName: "A", color: "#a", totalEur: 100 });
    expect(breakdown[1]).toEqual({ categoryId: "b", categoryName: "B", color: "#b", totalEur: 90 });
    expect(breakdown[2]).toEqual({ categoryId: null, categoryName: "Other", color: "#8a90a0", totalEur: 95 });
  });
});

describe("filterByMember", () => {
  it("returns rows unchanged when no member is selected", () => {
    const rows = [row({ ownershipType: "person", ownerMemberId: "nic" })];
    expect(filterByMember(rows, null)).toEqual(rows);
    expect(filterByMember(rows, undefined)).toEqual(rows);
  });

  it("keeps a member's own transactions and drops another member's", () => {
    const nicRow = row({ ownershipType: "person", ownerMemberId: "nic" });
    const marianaRow = row({ ownershipType: "person", ownerMemberId: "mariana" });
    const filtered = filterByMember([nicRow, marianaRow], "nic");
    expect(filtered).toEqual([nicRow]);
  });

  it("always keeps shared transactions regardless of which member is selected", () => {
    const sharedRow = row({ ownershipType: "shared", ownerMemberId: null });
    const marianaRow = row({ ownershipType: "person", ownerMemberId: "mariana" });
    const filtered = filterByMember([sharedRow, marianaRow], "nic");
    expect(filtered).toEqual([sharedRow]);
  });
});

describe("listAvailableMonths", () => {
  it("returns unique months in ascending order", () => {
    const rows = [
      row({ transactionDate: "2026-06-01" }),
      row({ transactionDate: "2026-06-15" }),
      row({ transactionDate: "2026-04-01" }),
      row({ transactionDate: "2026-05-01" }),
    ];
    expect(listAvailableMonths(rows)).toEqual(["2026-04", "2026-05", "2026-06"]);
  });

  it("excludes months whose only rows are pending conversion, transfers, or excluded", () => {
    const rows = [
      row({ transactionDate: "2026-06-01", eurAmount: null }),
      row({ transactionDate: "2026-07-01", direction: "transfer" }),
      row({ transactionDate: "2026-08-01", priorityName: "Excluded / transfer" }),
      row({ transactionDate: "2026-09-01" }),
    ];
    expect(listAvailableMonths(rows)).toEqual(["2026-09"]);
  });

  it("returns an empty array for no data", () => {
    expect(listAvailableMonths([])).toEqual([]);
  });
});

describe("anchorMonth overrides", () => {
  const rows = [
    row({ transactionDate: "2026-04-01", direction: "credit", eurAmount: 100 }),
    row({ transactionDate: "2026-05-01", direction: "credit", eurAmount: 200 }),
    row({ transactionDate: "2026-06-01", direction: "credit", eurAmount: 300 }),
  ];

  it("computeMonthlyTrend anchors on the given month instead of the latest with data", () => {
    const trend = computeMonthlyTrend(rows, 2, "2026-05");
    expect(trend.map((t) => t.month)).toEqual(["2026-04", "2026-05"]);
  });

  it("computeHouseholdSummary reports current/previous relative to the given anchor month", () => {
    const summary = computeHouseholdSummary(rows, "2026-05");
    expect(summary.currentMonth.month).toBe("2026-05");
    expect(summary.previousMonth?.month).toBe("2026-04");
  });
});
