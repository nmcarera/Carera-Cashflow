/**
 * Rule CRUD, "how many transactions would this affect" preview, and
 * "apply this rule to existing transactions" (build brief §8: a rule the
 * household writes should be able to reach backward as well as forward).
 *
 * Historical application only ever touches transactions where this rule is
 * the unambiguous winner against every other currently active rule (i.e.
 * `findApplicableRule` returns it with no conflict) — a transaction that
 * would become a genuine conflict between two active rules is left alone
 * and counted separately, never silently resolved one way. Confident
 * transfers (direction `transfer`) are never touched by rules, matching
 * import-time behavior in importPipeline.ts.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { rules as rulesTable, transactions } from "../db/schema";
import { writeAuditEntry } from "../audit/log";
import { CareraError } from "../logging/errors";
import { computeReviewStatus } from "./reviewStatus";
import { findApplicableRule, ruleMatches, type RuleRecord } from "./rules";
import { listRuleMatchCandidates, ruleAppliedCounts } from "../db/queries";

export interface RuleInput {
  name: string;
  precedence?: number;
  matchMerchantContains?: string | null;
  matchDescriptionContains?: string | null;
  matchInstitution?: string | null;
  matchAccountId?: string | null;
  matchAmountMin?: number | null;
  matchAmountMax?: number | null;
  matchDirection?: string | null;
  setCategoryId?: string | null;
  setPriorityId?: string | null;
  setOwnershipType?: string | null;
  setOwnerMemberId?: string | null;
}

function assertValidRule(input: RuleInput): void {
  const hasMatch = Boolean(
    input.matchMerchantContains ||
      input.matchDescriptionContains ||
      input.matchInstitution ||
      input.matchAccountId ||
      input.matchAmountMin !== null && input.matchAmountMin !== undefined ||
      input.matchAmountMax !== null && input.matchAmountMax !== undefined ||
      input.matchDirection
  );
  const hasEffect = Boolean(input.setCategoryId || input.setPriorityId || input.setOwnershipType);
  if (!hasMatch || !hasEffect) {
    throw new CareraError({ code: "RULE_002_INVALID", category: "rule_conflict" });
  }
  if (!input.name.trim()) {
    throw new CareraError({ code: "SETTINGS_002_NAME_REQUIRED", category: "rule_conflict" });
  }
}

export function createRule(input: RuleInput): RuleRecord {
  assertValidRule(input);
  const id = randomUUID();
  db.insert(rulesTable)
    .values({
      id,
      name: input.name.trim(),
      active: true,
      precedence: input.precedence ?? 100,
      matchMerchantContains: input.matchMerchantContains || null,
      matchDescriptionContains: input.matchDescriptionContains || null,
      matchInstitution: input.matchInstitution || null,
      matchAccountId: input.matchAccountId || null,
      matchAmountMin: input.matchAmountMin ?? null,
      matchAmountMax: input.matchAmountMax ?? null,
      matchDirection: input.matchDirection || null,
      setCategoryId: input.setCategoryId || null,
      setPriorityId: input.setPriorityId || null,
      setOwnershipType: input.setOwnershipType || null,
      setOwnerMemberId: input.setOwnershipType === "person" ? input.setOwnerMemberId || null : null,
    })
    .run();
  writeAuditEntry({ entityType: "rule", entityId: id, field: "created", oldValue: null, newValue: input.name.trim(), changeSource: "manual" });
  return db.select().from(rulesTable).where(eq(rulesTable.id, id)).all()[0];
}

export function updateRule(id: string, input: RuleInput): RuleRecord {
  const current = db.select().from(rulesTable).where(eq(rulesTable.id, id)).all()[0];
  if (!current) throw new CareraError({ code: "DB_002_CONSTRAINT_VIOLATION", category: "rule_conflict", detail: "Rule not found." });
  assertValidRule(input);

  db.update(rulesTable)
    .set({
      name: input.name.trim(),
      precedence: input.precedence ?? current.precedence,
      matchMerchantContains: input.matchMerchantContains || null,
      matchDescriptionContains: input.matchDescriptionContains || null,
      matchInstitution: input.matchInstitution || null,
      matchAccountId: input.matchAccountId || null,
      matchAmountMin: input.matchAmountMin ?? null,
      matchAmountMax: input.matchAmountMax ?? null,
      matchDirection: input.matchDirection || null,
      setCategoryId: input.setCategoryId || null,
      setPriorityId: input.setPriorityId || null,
      setOwnershipType: input.setOwnershipType || null,
      setOwnerMemberId: input.setOwnershipType === "person" ? input.setOwnerMemberId || null : null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(rulesTable.id, id))
    .run();
  writeAuditEntry({ entityType: "rule", entityId: id, field: "edited", oldValue: current.name, newValue: input.name.trim(), changeSource: "manual" });
  return db.select().from(rulesTable).where(eq(rulesTable.id, id)).all()[0];
}

export function setRuleActive(id: string, active: boolean): RuleRecord {
  const current = db.select().from(rulesTable).where(eq(rulesTable.id, id)).all()[0];
  if (!current) throw new CareraError({ code: "DB_002_CONSTRAINT_VIOLATION", category: "rule_conflict", detail: "Rule not found." });
  db.update(rulesTable).set({ active, updatedAt: new Date().toISOString() }).where(eq(rulesTable.id, id)).run();
  writeAuditEntry({
    entityType: "rule",
    entityId: id,
    field: "active",
    oldValue: String(current.active),
    newValue: String(active),
    changeSource: "manual",
  });
  return db.select().from(rulesTable).where(eq(rulesTable.id, id)).all()[0];
}

/** Hard delete is only allowed for a rule no transaction currently credits
 *  (`appliedRuleId`) — otherwise `transactions.applied_rule_id`'s foreign
 *  key would break the very audit trail this app promises. Disabling
 *  (`setRuleActive(id, false)`) is the reversible alternative offered by the
 *  UI in that case. */
export function deleteRule(id: string): { deleted: boolean; reason?: string } {
  const current = db.select().from(rulesTable).where(eq(rulesTable.id, id)).all()[0];
  if (!current) return { deleted: false, reason: "Rule not found." };
  const usage = ruleAppliedCounts().get(id) ?? 0;
  if (usage > 0) {
    return {
      deleted: false,
      reason: `${usage} transaction${usage === 1 ? "" : "s"} still record this rule as the reason they were categorized. Disable it instead — that stops it from matching anything new but keeps the history intact.`,
    };
  }
  db.delete(rulesTable).where(eq(rulesTable.id, id)).run();
  writeAuditEntry({ entityType: "rule", entityId: id, field: "deleted", oldValue: current.name, newValue: null, changeSource: "manual" });
  return { deleted: true };
}

export interface RulePreview {
  matchCount: number;
  sampleDescriptions: string[];
}

/** Preview how many existing transactions a draft rule (saved or not) would
 *  match, independent of precedence conflicts with other rules — used by the
 *  rule-editor form so the household can see the effect before saving. */
export function previewRuleMatches(input: RuleInput, sampleSize = 5): RulePreview {
  const draft: RuleRecord = {
    id: "__preview__",
    name: input.name,
    active: true,
    precedence: input.precedence ?? 100,
    matchMerchantContains: input.matchMerchantContains ?? null,
    matchDescriptionContains: input.matchDescriptionContains ?? null,
    matchInstitution: input.matchInstitution ?? null,
    matchAccountId: input.matchAccountId ?? null,
    matchAmountMin: input.matchAmountMin ?? null,
    matchAmountMax: input.matchAmountMax ?? null,
    matchDirection: input.matchDirection ?? null,
    setCategoryId: input.setCategoryId ?? null,
    setPriorityId: input.setPriorityId ?? null,
    setOwnershipType: input.setOwnershipType ?? null,
    setOwnerMemberId: input.setOwnerMemberId ?? null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const candidates = listRuleMatchCandidates();
  const matches = candidates.filter((c) => ruleMatches(draft, c));
  return {
    matchCount: matches.length,
    sampleDescriptions: matches.slice(0, sampleSize).map((m) => m.cleanedDescription),
  };
}

export interface ApplyHistoricallyResult {
  updated: number;
  skippedAsConflict: number;
}

/** Applies a saved, active rule to every existing transaction it
 *  unambiguously wins against the current rule set. Each change is logged
 *  to the audit trail with `changeSource: "rule"` so it reads the same way
 *  a fresh import's rule application does. */
export function applyRuleHistorically(ruleId: string): ApplyHistoricallyResult {
  const rule = db.select().from(rulesTable).where(eq(rulesTable.id, ruleId)).all()[0];
  if (!rule) throw new CareraError({ code: "DB_002_CONSTRAINT_VIOLATION", category: "rule_conflict", detail: "Rule not found." });
  if (!rule.active) throw new CareraError({ code: "RULE_002_INVALID", category: "rule_conflict", detail: "Enable this rule before applying it historically." });

  const activeRules = db.select().from(rulesTable).where(eq(rulesTable.active, true)).all();
  const candidates = listRuleMatchCandidates();

  let updated = 0;
  let skippedAsConflict = 0;

  db.transaction((tx) => {
    for (const candidate of candidates) {
      const result = findApplicableRule(activeRules, candidate);
      if (result.conflict && result.conflictingRules.some((r) => r.id === ruleId)) {
        skippedAsConflict++;
        continue;
      }
      if (result.rule?.id !== ruleId) continue;

      const before = tx.select().from(transactions).where(eq(transactions.id, candidate.id)).all()[0];
      if (!before) continue;

      const ownershipType = rule.setOwnershipType ?? before.ownershipType;
      const ownerMemberId = rule.setOwnershipType === "person" ? rule.setOwnerMemberId : rule.setOwnershipType ? null : before.ownerMemberId;
      const categoryId = rule.setCategoryId ?? before.categoryId;
      const priorityId = rule.setPriorityId ?? before.priorityId;

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
          appliedRuleId: ruleId,
          confidenceReason: `Categorized automatically by rule "${rule.name}" (applied historically).`,
          reviewStatus,
          reviewReasonsJson: JSON.stringify(reviewReasons),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(transactions.id, candidate.id))
        .run();

      if (categoryId !== before.categoryId) {
        writeAuditEntry(
          { entityType: "transaction", entityId: candidate.id, field: "categoryId", oldValue: before.categoryId, newValue: categoryId, changeSource: "rule", ruleId },
          tx
        );
      }
      if (priorityId !== before.priorityId) {
        writeAuditEntry(
          { entityType: "transaction", entityId: candidate.id, field: "priorityId", oldValue: before.priorityId, newValue: priorityId, changeSource: "rule", ruleId },
          tx
        );
      }
      if (ownershipType !== before.ownershipType || ownerMemberId !== before.ownerMemberId) {
        writeAuditEntry(
          { entityType: "transaction", entityId: candidate.id, field: "ownership", oldValue: `${before.ownershipType}:${before.ownerMemberId}`, newValue: `${ownershipType}:${ownerMemberId}`, changeSource: "rule", ruleId },
          tx
        );
      }
      updated++;
    }
  });

  return { updated, skippedAsConflict };
}
