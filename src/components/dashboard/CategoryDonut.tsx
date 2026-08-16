"use client";

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { formatEur } from "@/lib/format";
import type { CategoryBreakdownItem } from "@/lib/analytics/summary";

export function CategoryDonut({ items }: { items: CategoryBreakdownItem[] }) {
  if (items.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-muted">
        No spending recorded this month yet.
      </div>
    );
  }

  const total = items.reduce((s, i) => s + i.totalEur, 0);

  return (
    <div className="flex flex-col sm:flex-row items-center gap-6">
      <div className="w-56 h-56 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={items}
              dataKey="totalEur"
              nameKey="categoryName"
              innerRadius="62%"
              outerRadius="100%"
              paddingAngle={2}
              stroke="none"
            >
              {items.map((item) => (
                <Cell key={item.categoryId ?? "other"} fill={item.color} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value, name) => [formatEur(typeof value === "number" ? value : Number(value)), name]}
              contentStyle={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                color: "var(--foreground)",
                fontSize: 13,
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="flex-1 w-full space-y-2 text-sm">
        {items.map((item) => (
          <li key={item.categoryId ?? "other"} className="flex items-center gap-2">
            <span aria-hidden className="inline-block w-3 h-3 rounded-full shrink-0" style={{ background: item.color }} />
            <span className="flex-1 truncate">{item.categoryName}</span>
            <span className="text-muted tabular-nums">{formatEur(item.totalEur)}</span>
            <span className="text-muted-2 text-xs w-10 text-right">
              {total > 0 ? Math.round((item.totalEur / total) * 100) : 0}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
