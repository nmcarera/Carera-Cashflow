import { formatEur } from "@/lib/format";

const TONE_STYLES: Record<"income" | "expense" | "savings", { border: string; text: string; dot: string }> = {
  income: { border: "border-l-4 border-l-income", text: "text-income", dot: "bg-income" },
  expense: { border: "border-l-4 border-l-expense", text: "text-expense", dot: "bg-expense" },
  savings: { border: "border-l-4 border-l-savings", text: "text-savings", dot: "bg-savings" },
};

export function StatCard({
  label,
  amountEur,
  tone,
  helpText,
}: {
  label: string;
  amountEur: number;
  tone: "income" | "expense" | "savings";
  helpText?: string;
}) {
  const styles = TONE_STYLES[tone];
  return (
    <div
      data-testid={`stat-card-${label.toLowerCase().replace(/\s+/g, "-")}`}
      className={`rounded-xl border border-border bg-surface p-5 ${styles.border}`}
    >
      <div className="flex items-center gap-2 mb-2">
        <span aria-hidden className={`inline-block w-2.5 h-2.5 rounded-full ${styles.dot}`} />
        <p className="text-sm uppercase tracking-wide text-muted">{label}</p>
      </div>
      <p className={`text-3xl font-semibold tabular-nums ${styles.text}`}>{formatEur(amountEur)}</p>
      {helpText && <p className="text-sm text-muted mt-1">{helpText}</p>}
    </div>
  );
}
