"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import { formatEur } from "@/lib/format";
import type { PeriodTotals } from "@/lib/analytics/summary";

function monthLabel(month: string): string {
  if (!month) return "";
  const [y, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { month: "short" }).format(new Date(Date.UTC(y, m - 1, 1)));
}

export function TrendChart({ data }: { data: PeriodTotals[] }) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-muted">
        No transactions yet — import a statement to see your trend.
      </div>
    );
  }

  const chartData = data.map((d) => ({ ...d, monthLabel: monthLabel(d.month) }));

  return (
    <div className="w-full h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="monthLabel" tick={{ fill: "var(--muted)", fontSize: 12 }} axisLine={{ stroke: "var(--border)" }} tickLine={false} />
          <YAxis tick={{ fill: "var(--muted)", fontSize: 12 }} axisLine={false} tickLine={false} width={40} />
          <Tooltip
            formatter={(value, name) => [
              formatEur(typeof value === "number" ? value : Number(value)),
              name === "incomeEur" ? "Money in" : "Money out",
            ]}
            labelFormatter={(label) => label}
            contentStyle={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              color: "var(--foreground)",
              fontSize: 13,
            }}
          />
          <Legend
            formatter={(value) => (value === "incomeEur" ? "Money in" : "Money out")}
            wrapperStyle={{ fontSize: 12, color: "var(--muted)" }}
          />
          <Bar dataKey="incomeEur" name="incomeEur" fill="var(--income)" radius={[4, 4, 0, 0]} />
          <Bar dataKey="expenseEur" name="expenseEur" fill="var(--expense)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
