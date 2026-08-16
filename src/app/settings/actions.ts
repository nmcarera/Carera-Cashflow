"use server";

/**
 * Server actions for the settings screen (categories, priorities, household
 * members). Thin wrappers around src/lib/settings/mutations.ts — the only
 * job here is the trust boundary (catch, log, shape a UI-friendly result)
 * and cache revalidation, matching the pattern in src/app/import/actions.ts.
 */
import { revalidatePath } from "next/cache";
import * as mutations from "@/lib/settings/mutations";
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
    revalidatePath("/settings");
    revalidatePath("/rules");
    revalidatePath("/transactions");
    revalidatePath("/review");
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

export async function createCategoryAction(input: { name: string; color: string }) {
  return wrap(() => mutations.createCategory(input), "settings.category.create");
}
export async function updateCategoryAction(id: string, input: { name?: string; color?: string }) {
  return wrap(() => mutations.updateCategory(id, input), "settings.category.update");
}
export async function setCategoryArchivedAction(id: string, archived: boolean) {
  return wrap(() => mutations.setCategoryArchived(id, archived), "settings.category.archive");
}

export async function createPriorityAction(input: { name: string; sortOrder?: number }) {
  return wrap(() => mutations.createPriority(input), "settings.priority.create");
}
export async function updatePriorityAction(id: string, input: { name?: string; sortOrder?: number }) {
  return wrap(() => mutations.updatePriority(id, input), "settings.priority.update");
}
export async function setPriorityArchivedAction(id: string, archived: boolean) {
  return wrap(() => mutations.setPriorityArchived(id, archived), "settings.priority.archive");
}

export async function createHouseholdMemberAction(input: { name: string; initials: string; color: string }) {
  return wrap(() => mutations.createHouseholdMember(input), "settings.member.create");
}
export async function updateHouseholdMemberAction(
  id: string,
  input: { name?: string; initials?: string; color?: string }
) {
  return wrap(() => mutations.updateHouseholdMember(id, input), "settings.member.update");
}
export async function setHouseholdMemberArchivedAction(id: string, archived: boolean) {
  return wrap(() => mutations.setHouseholdMemberArchived(id, archived), "settings.member.archive");
}
