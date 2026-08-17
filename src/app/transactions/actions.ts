"use server";

/**
 * Server actions for editing transactions — from the transaction table and
 * the review queue alike. Implements the three-way correction workflow from
 * the build brief (§8): when the household changes a category/priority/
 * owner, they can apply it to just the transaction(s) they selected, to
 * every transaction with the same merchant in the same import, or turn it
 * into a standing rule (which also applies immediately to matching past
 * transactions, per "create a rule for past and future").
 */
import { revalidatePath } from "next/cache";
import * as edit from "@/lib/transactions/edit";
import type { TransactionFieldEdit } from "@/lib/transactions/edit";
import { listImportBatchSiblingsByMerchant } from "@/lib/db/queries";
import { createRule, applyRuleHistorically, type RuleInput } from "@/lib/categorization/apply";
import { CareraError } from "@/lib/logging/errors";
import { logError } from "@/lib/logging/logger";

export interface ActionResult<T> {
  ok: boolean;
  data?: T;
  errorMessage?: string;
}

function wrap<T>(fn: () => T, operation: string): ActionResult<T> {
  try {
    const data = fn();
    revalidatePath("/transactions");
    revalidatePath("/review");
    revalidatePath("/rules");
    revalidatePath("/");
    return { ok: true, data };
  } catch (err) {
    const careraErr =
      err instanceof CareraError
        ? err
        : new CareraError({ code: "APP_001_UNEXPECTED", category: "database", cause: err });
    logError(careraErr, { operation });
    return { ok: false, errorMessage: careraErr.toUserMessage() };
  }
}

/** "Change only this transaction" (or a manually multi-selected set from
 *  the transaction table's bulk toolbar). */
export async function editTransactionsAction(ids: string[], fieldEdit: TransactionFieldEdit) {
  return wrap(() => edit.editTransactions(ids, fieldEdit), "transactions.edit");
}

/** "Apply to matching transactions in this import" — same import batch,
 *  same merchant (or description when there's no merchant). */
export async function editMatchingInBatchAction(referenceTransactionId: string, fieldEdit: TransactionFieldEdit) {
  return wrap(() => {
    const ids = listImportBatchSiblingsByMerchant(referenceTransactionId);
    return edit.editTransactions(ids, fieldEdit);
  }, "transactions.editBatchMatching");
}

/** "Create a rule for past and future" — saves a standing rule, then
 *  immediately applies it to every existing transaction it unambiguously
 *  wins, so "past and future" is a real guarantee rather than just
 *  forward-looking. */
export async function createRuleFromCorrectionAction(input: RuleInput) {
  return wrap(() => {
    const rule = createRule(input);
    const applied = applyRuleHistorically(rule.id);
    return { rule, applied };
  }, "transactions.createRuleFromCorrection");
}

export async function resolveTransferSuggestionAction(transactionId: string, confirmed: boolean) {
  return wrap(() => edit.resolveTransferSuggestion(transactionId, confirmed), "transactions.resolveTransfer");
}
