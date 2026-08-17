/**
 * Manual transaction edits: category/priority/owner changes (single or
 * bulk), and transfer-suggestion confirm/reject. Every change is written to
 * `audit_log` with `changeSource: "manual"` and the transaction's
 * `reviewStatus`/`reviewReasons` are recomputed through the same
 * `computeReviewStatus` helper the import pipeline and rule engine use, so
 * "why is this still in the review queue" never has a path-dependent answer.
 */
import { eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { transactions, categories, priorities } from "../db/schema";
import { writeAuditEntry } from "../audit/log";
import { computeReviewStatus } from "../categorization/reviewStatus";
import { CareraError } from "../logging/errors";
import type { OwnershipType } from "../domain/enums";

export interface TransactionFieldEdit {
  categoryId?: string | null;
  priorityId?: string | null;
  ownershipType?: OwnershipType;
  ownerMemberId?: string | null;
  notes?: string | null;
}

/** Applies the same field edit to one or more transactions. Returns how many
 *  rows were actually changed (a transaction already at the target value
 *  still counts as "touched" for the caller's UI feedback, but no-op audit
 *  entries are skipped). */
export function editTransactions(ids: string[], edit: TransactionFieldEdit): { updated: number } {
  if (ids.length === 0) return { updated: 0 };
  let updated = 0;

  db.transaction((tx) => {
    const rows = tx.select().from(transactions).where(inArray(transactions.id, ids)).all();
    for (const before of rows) {
      const categoryId = edit.categoryId !== undefined ? edit.categoryId : before.categoryId;
      const priorityId = edit.priorityId !== undefined ? edit.priorityId : before.priorityId;
      const ownershipType = edit.ownershipType !== undefined ? edit.ownershipType : before.ownershipType;
      const ownerMemberId =
        edit.ownerMemberId !== undefined ? edit.ownerMemberId : edit.ownershipType && edit.ownershipType !== "person" ? null : before.ownerMemberId;
      const notes = edit.notes !== undefined ? edit.notes : before.notes;

      const { reviewStatus, reviewReasons } = computeReviewStatus({
        hasCategory: categoryId !== null,
        hasOwner: ownershipType !== "unassigned",
        transferStatus: before.transferStatus,
        conversionStatus: before.conversionStatus,
      });

      tx.update(transactions)
        .set({
          categoryId,
          priorityId,
          ownershipType,
          ownerMemberId,
          notes,
          // A manual edit is the household overriding whatever produced the
          // prior value (a rule, or nothing) — clear the rule attribution so
          // the UI doesn't credit a rule for a value the household just
          // changed by hand.
          appliedRuleId: edit.categoryId !== undefined || edit.priorityId !== undefined || edit.ownershipType !== undefined ? null : before.appliedRuleId,
          confidenceReason:
            edit.categoryId !== undefined || edit.priorityId !== undefined || edit.ownershipType !== undefined
              ? "Set manually."
              : before.confidenceReason,
          reviewStatus,
          reviewReasonsJson: JSON.stringify(reviewReasons),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(transactions.id, before.id))
        .run();

      if (edit.categoryId !== undefined && categoryId !== before.categoryId) {
        writeAuditEntry({ entityType: "transaction", entityId: before.id, field: "categoryId", oldValue: before.categoryId, newValue: categoryId, changeSource: "manual" }, tx);
      }
      if (edit.priorityId !== undefined && priorityId !== before.priorityId) {
        writeAuditEntry({ entityType: "transaction", entityId: before.id, field: "priorityId", oldValue: before.priorityId, newValue: priorityId, changeSource: "manual" }, tx);
      }
      if (edit.ownershipType !== undefined && (ownershipType !== before.ownershipType || ownerMemberId !== before.ownerMemberId)) {
        writeAuditEntry({ entityType: "transaction", entityId: before.id, field: "ownership", oldValue: `${before.ownershipType}:${before.ownerMemberId}`, newValue: `${ownershipType}:${ownerMemberId}`, changeSource: "manual" }, tx);
      }
      if (edit.notes !== undefined && notes !== before.notes) {
        writeAuditEntry({ entityType: "transaction", entityId: before.id, field: "notes", oldValue: before.notes, newValue: notes, changeSource: "manual" }, tx);
      }
      updated++;
    }
  });

  return { updated };
}

/** Confirms or rejects a `possible_transfer` suggestion. Confirming links
 *  both sides, categorizes them as an internal transfer (mirroring the
 *  confident-transfer path in importPipeline.ts), and clears them from
 *  review. Rejecting just removes the `possible_transfer` review reason and
 *  leaves everything else (category, owner) exactly as it was — the
 *  transaction still needs whatever else it needed. */
export function resolveTransferSuggestion(transactionId: string, confirmed: boolean): void {
  const before = db.select().from(transactions).where(eq(transactions.id, transactionId)).all()[0];
  if (!before) throw new CareraError({ code: "DB_002_CONSTRAINT_VIOLATION", category: "database", detail: "Transaction not found." });
  if (before.transferStatus !== "suggested") return;

  const internalTransferCategoryId = confirmed
    ? db.select().from(categories).where(eq(categories.name, "Internal transfer")).all()[0]?.id ?? null
    : null;
  const excludedPriorityId = confirmed
    ? db.select().from(priorities).where(eq(priorities.name, "Excluded / transfer")).all()[0]?.id ?? null
    : null;

  db.transaction((tx) => {
    const ids = confirmed && before.possibleTransferId ? [before.id, before.possibleTransferId] : [before.id];
    for (const id of ids) {
      const row = tx.select().from(transactions).where(eq(transactions.id, id)).all()[0];
      if (!row) continue;

      const categoryId = confirmed ? internalTransferCategoryId : row.categoryId;
      const priorityId = confirmed ? excludedPriorityId : row.priorityId;
      const ownershipType = confirmed ? "shared" : row.ownershipType;
      const ownerMemberId = confirmed ? null : row.ownerMemberId;

      const { reviewStatus, reviewReasons } = computeReviewStatus({
        hasCategory: categoryId !== null,
        hasOwner: ownershipType !== "unassigned",
        transferStatus: confirmed ? "confirmed" : "rejected",
        conversionStatus: row.conversionStatus,
      });

      tx.update(transactions)
        .set({
          categoryId,
          priorityId,
          ownershipType,
          ownerMemberId,
          transferStatus: confirmed ? "confirmed" : "rejected",
          reviewStatus,
          reviewReasonsJson: JSON.stringify(reviewReasons),
          confidenceReason: confirmed ? "Confirmed as an internal transfer." : "Marked as not a transfer.",
          updatedAt: new Date().toISOString(),
        })
        .where(eq(transactions.id, id))
        .run();

      writeAuditEntry(
        {
          entityType: "transaction",
          entityId: id,
          field: "transferStatus",
          oldValue: row.transferStatus,
          newValue: confirmed ? "confirmed" : "rejected",
          changeSource: "manual",
        },
        tx
      );
    }
  });
}
