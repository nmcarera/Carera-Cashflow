/**
 * Savings goal progress.
 *
 * Documented assumption: this app doesn't yet track a running account
 * balance from statement running-balance columns (ABN AMRO's own
 * `startsaldo`/`endsaldo`, preserved in every transaction's raw row but not
 * yet surfaced — see README "Known limitations"). Until that exists, a
 * goal's current balance is computed the simplest reversible way: the
 * goal's own `startingBalanceEur` (as of `startingBalanceAsOf`, exactly
 * what those two columns exist for — see schema.ts's comment on
 * `savingsGoals`) plus the sum of every resolved-EUR transaction on the
 * linked account from that date forward. A transaction still pending
 * currency conversion isn't counted (its `eurAmount` is null), so the goal
 * bar is a slight underestimate rather than a guess until that resolves.
 */
import { and, eq, gte } from "drizzle-orm";
import { db } from "../db/client";
import { savingsGoals, transactions } from "../db/schema";

export interface SavingsGoalProgress {
  id: string;
  name: string;
  targetBalanceEur: number;
  targetDate: string | null;
  currentBalanceEur: number;
  /** 0..1, clamped — a goal can be exceeded without the bar overflowing. */
  progressFraction: number;
}

export function listSavingsGoalProgress(): SavingsGoalProgress[] {
  const goals = db.select().from(savingsGoals).where(eq(savingsGoals.archived, false)).all();

  return goals.map((g) => {
    const conditions = [eq(transactions.accountId, g.linkedAccountId)];
    if (g.startingBalanceAsOf) conditions.push(gte(transactions.transactionDate, g.startingBalanceAsOf));

    const rows = db
      .select({ eurAmount: transactions.eurAmount })
      .from(transactions)
      .where(and(...conditions))
      .all();

    const movement = rows.reduce((sum, r) => sum + (r.eurAmount ?? 0), 0);
    const currentBalanceEur = Math.round(((g.startingBalanceEur ?? 0) + movement) * 100) / 100;
    const progressFraction = g.targetBalanceEur > 0 ? Math.min(1, Math.max(0, currentBalanceEur / g.targetBalanceEur)) : 0;

    return {
      id: g.id,
      name: g.name,
      targetBalanceEur: g.targetBalanceEur,
      targetDate: g.targetDate,
      currentBalanceEur,
      progressFraction,
    };
  });
}
