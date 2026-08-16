/**
 * Deterministic, transparent categorization rule matching.
 *
 * Per build brief §8: "prioritize deterministic and transparent rules over
 * opaque AI classification." Every automatically classified transaction
 * must record which rule produced the result (`appliedRuleId`) — this
 * module is the only place that decides which rule, if any, applies to a
 * transaction, so that guarantee holds everywhere it's used (the import
 * pipeline for new transactions, and the rule-management "preview/apply
 * historically" flow for existing ones).
 */
import type { InferSelectModel } from "drizzle-orm";
import type { rules } from "../db/schema";

export type RuleRecord = InferSelectModel<typeof rules>;

export interface RuleMatchInput {
  merchant: string | null;
  cleanedDescription: string;
  originalDescription: string;
  institution: string;
  accountId: string;
  /** Canonical signed amount — see docs/schema.md "Sign convention". */
  originalAmount: number;
  direction: string;
}

function containsCaseInsensitive(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/** True if every condition the rule actually sets is satisfied. A rule with
 *  no conditions at all never matches anything — it would otherwise match
 *  every transaction, which is never what "no conditions set yet" should
 *  mean in a rule-editing UI. */
export function ruleMatches(rule: RuleRecord, txn: RuleMatchInput): boolean {
  const conditions: boolean[] = [];

  if (rule.matchMerchantContains) {
    conditions.push(containsCaseInsensitive(txn.merchant ?? txn.cleanedDescription, rule.matchMerchantContains));
  }
  if (rule.matchDescriptionContains) {
    conditions.push(containsCaseInsensitive(txn.originalDescription, rule.matchDescriptionContains));
  }
  if (rule.matchInstitution) {
    conditions.push(rule.matchInstitution === txn.institution);
  }
  if (rule.matchAccountId) {
    conditions.push(rule.matchAccountId === txn.accountId);
  }
  if (rule.matchAmountMin !== null && rule.matchAmountMin !== undefined) {
    conditions.push(txn.originalAmount >= rule.matchAmountMin);
  }
  if (rule.matchAmountMax !== null && rule.matchAmountMax !== undefined) {
    conditions.push(txn.originalAmount <= rule.matchAmountMax);
  }
  if (rule.matchDirection) {
    conditions.push(rule.matchDirection === txn.direction);
  }

  if (conditions.length === 0) return false;
  return conditions.every(Boolean);
}

function outcomeKey(rule: RuleRecord): string {
  return JSON.stringify([rule.setCategoryId, rule.setPriorityId, rule.setOwnershipType, rule.setOwnerMemberId]);
}

export interface RuleApplicationResult {
  rule: RuleRecord | null;
  conflict: boolean;
  conflictingRules: RuleRecord[];
}

/** Finds the single rule that should apply to a transaction, from a list of
 *  active rules (inactive rules should be filtered out before calling this).
 *  Returns `conflict: true` — and no winning rule — when two matching rules
 *  share the same precedence but disagree on the outcome; the caller should
 *  leave the transaction as `needs_review` with reason `conflicting_rules`
 *  rather than picking one arbitrarily. */
export function findApplicableRule(activeRules: RuleRecord[], txn: RuleMatchInput): RuleApplicationResult {
  const matches = activeRules.filter((r) => ruleMatches(r, txn));
  if (matches.length === 0) return { rule: null, conflict: false, conflictingRules: [] };

  matches.sort((a, b) => a.precedence - b.precedence || a.createdAt.localeCompare(b.createdAt));
  const top = matches[0];
  const topOutcome = outcomeKey(top);
  const disagreeingSamePrecedence = matches.filter(
    (r) => r.id !== top.id && r.precedence === top.precedence && outcomeKey(r) !== topOutcome
  );

  if (disagreeingSamePrecedence.length > 0) {
    return { rule: null, conflict: true, conflictingRules: [top, ...disagreeingSamePrecedence] };
  }
  return { rule: top, conflict: false, conflictingRules: [] };
}

/** How many of a set of transactions a rule would match — used by the rule
 *  management screen to show "affects N transactions" and by the
 *  apply-historically preview. */
export function countMatches(rule: RuleRecord, transactions: RuleMatchInput[]): number {
  return transactions.filter((t) => ruleMatches(rule, t)).length;
}
