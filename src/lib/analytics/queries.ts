/**
 * The one place dashboard analytics reads from the database — everything
 * downstream (src/lib/analytics/summary.ts) is pure functions over plain
 * arrays, so the actual math is unit-testable without a database at all.
 */
import { db } from "../db/client";
import { transactions, categories, priorities } from "../db/schema";
import { eq } from "drizzle-orm";

export interface AnalyticsRow {
  transactionDate: string;
  direction: string;
  eurAmount: number | null;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  priorityName: string | null;
  ownershipType: string;
  ownerMemberId: string | null;
}

/** Every transaction, shaped for household totals/trends/category
 *  breakdowns. Deliberately unfiltered here (even pending-conversion and
 *  transfer rows are included) — `summary.ts` decides what counts toward
 *  totals, and having the full picture lets it also report *how much* is
 *  being excluded (e.g. "3 transactions still pending conversion") rather
 *  than silently dropping rows before the calm-dashboard math ever sees
 *  them. */
export function listAnalyticsRows(): AnalyticsRow[] {
  return db
    .select({
      transactionDate: transactions.transactionDate,
      direction: transactions.direction,
      eurAmount: transactions.eurAmount,
      categoryId: transactions.categoryId,
      categoryName: categories.name,
      categoryColor: categories.color,
      priorityName: priorities.name,
      ownershipType: transactions.ownershipType,
      ownerMemberId: transactions.ownerMemberId,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .leftJoin(priorities, eq(transactions.priorityId, priorities.id))
    .all();
}
