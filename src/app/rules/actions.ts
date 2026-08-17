"use server";

/**
 * Server actions for the rule-management screen. See
 * src/lib/categorization/apply.ts and src/lib/categorization/rules.ts for
 * the actual matching/application logic — this file is only the trust
 * boundary and cache revalidation, matching src/app/import/actions.ts.
 */
import { revalidatePath } from "next/cache";
import * as apply from "@/lib/categorization/apply";
import type { RuleInput, RulePreview, ApplyHistoricallyResult } from "@/lib/categorization/apply";
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
    revalidatePath("/rules");
    revalidatePath("/transactions");
    revalidatePath("/review");
    return { ok: true, data };
  } catch (err) {
    const careraErr =
      err instanceof CareraError
        ? err
        : new CareraError({ code: "APP_001_UNEXPECTED", category: "rule_conflict", cause: err });
    logError(careraErr, { operation });
    return { ok: false, errorMessage: careraErr.toUserMessage() };
  }
}

export async function createRuleAction(input: RuleInput) {
  return wrap(() => apply.createRule(input), "rules.create");
}
export async function updateRuleAction(id: string, input: RuleInput) {
  return wrap(() => apply.updateRule(id, input), "rules.update");
}
export async function setRuleActiveAction(id: string, active: boolean) {
  return wrap(() => apply.setRuleActive(id, active), "rules.setActive");
}
export async function deleteRuleAction(id: string) {
  return wrap(() => apply.deleteRule(id), "rules.delete");
}
export async function previewRuleMatchesAction(input: RuleInput): Promise<ActionResult<RulePreview>> {
  return wrap(() => apply.previewRuleMatches(input), "rules.preview");
}
export async function applyRuleHistoricallyAction(ruleId: string): Promise<ActionResult<ApplyHistoricallyResult>> {
  return wrap(() => apply.applyRuleHistorically(ruleId), "rules.applyHistorically");
}
