import { describe, it, expect } from "vitest";
import { ruleMatches, findApplicableRule, countMatches, type RuleRecord } from "@/lib/categorization/rules";

function makeRule(overrides: Partial<RuleRecord> = {}): RuleRecord {
  return {
    id: "rule-1",
    name: "Test rule",
    active: true,
    precedence: 100,
    matchMerchantContains: null,
    matchDescriptionContains: null,
    matchInstitution: null,
    matchAccountId: null,
    matchAmountMin: null,
    matchAmountMax: null,
    matchDirection: null,
    setCategoryId: null,
    setPriorityId: null,
    setOwnershipType: null,
    setOwnerMemberId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const baseTxn = {
  merchant: "Albert Heijn",
  cleanedDescription: "Albert Heijn boodschappen",
  originalDescription: "Albert Heijn boodschappen AMSTERDAM",
  institution: "abn_amro_checking",
  accountId: "acct-1",
  originalAmount: -45.5,
  direction: "debit",
};

describe("ruleMatches", () => {
  it("never matches a rule with no conditions set", () => {
    expect(ruleMatches(makeRule(), baseTxn)).toBe(false);
  });

  it("matches on merchant substring, case-insensitively", () => {
    const rule = makeRule({ matchMerchantContains: "albert heijn" });
    expect(ruleMatches(rule, baseTxn)).toBe(true);
    expect(ruleMatches(rule, { ...baseTxn, merchant: "Jumbo" })).toBe(false);
  });

  it("falls back to cleanedDescription when merchant is null", () => {
    const rule = makeRule({ matchMerchantContains: "albert heijn" });
    expect(ruleMatches(rule, { ...baseTxn, merchant: null })).toBe(true);
  });

  it("matches on description substring", () => {
    const rule = makeRule({ matchDescriptionContains: "AMSTERDAM" });
    expect(ruleMatches(rule, baseTxn)).toBe(true);
  });

  it("matches on institution", () => {
    expect(ruleMatches(makeRule({ matchInstitution: "abn_amro_checking" }), baseTxn)).toBe(true);
    expect(ruleMatches(makeRule({ matchInstitution: "amex_eu" }), baseTxn)).toBe(false);
  });

  it("matches on account id", () => {
    expect(ruleMatches(makeRule({ matchAccountId: "acct-1" }), baseTxn)).toBe(true);
    expect(ruleMatches(makeRule({ matchAccountId: "acct-2" }), baseTxn)).toBe(false);
  });

  it("matches on an amount range", () => {
    const rule = makeRule({ matchAmountMin: -50, matchAmountMax: -40 });
    expect(ruleMatches(rule, baseTxn)).toBe(true);
    expect(ruleMatches(rule, { ...baseTxn, originalAmount: -100 })).toBe(false);
  });

  it("matches on direction", () => {
    expect(ruleMatches(makeRule({ matchDirection: "debit" }), baseTxn)).toBe(true);
    expect(ruleMatches(makeRule({ matchDirection: "credit" }), baseTxn)).toBe(false);
  });

  it("requires ALL set conditions to match (AND, not OR)", () => {
    const rule = makeRule({ matchMerchantContains: "Albert Heijn", matchDirection: "credit" });
    expect(ruleMatches(rule, baseTxn)).toBe(false);
  });
});

describe("findApplicableRule", () => {
  it("returns no rule when nothing matches", () => {
    const result = findApplicableRule([makeRule({ matchMerchantContains: "Jumbo" })], baseTxn);
    expect(result.rule).toBeNull();
    expect(result.conflict).toBe(false);
  });

  it("picks the lower-precedence-number rule when two matching rules agree on nothing being ambiguous", () => {
    const specific = makeRule({
      id: "specific",
      precedence: 1,
      matchMerchantContains: "Albert Heijn",
      setCategoryId: "cat-groceries",
    });
    const general = makeRule({
      id: "general",
      precedence: 100,
      matchInstitution: "abn_amro_checking",
      setCategoryId: "cat-other",
    });
    const result = findApplicableRule([general, specific], baseTxn);
    expect(result.rule?.id).toBe("specific");
    expect(result.conflict).toBe(false);
  });

  it("does NOT flag a conflict when same-precedence rules agree on the outcome", () => {
    const a = makeRule({ id: "a", precedence: 5, matchMerchantContains: "Albert Heijn", setCategoryId: "cat-groceries" });
    const b = makeRule({ id: "b", precedence: 5, matchInstitution: "abn_amro_checking", setCategoryId: "cat-groceries" });
    const result = findApplicableRule([a, b], baseTxn);
    expect(result.conflict).toBe(false);
    expect(result.rule?.setCategoryId).toBe("cat-groceries");
  });

  it("flags a genuine conflict when same-precedence rules disagree on the outcome", () => {
    const a = makeRule({ id: "a", precedence: 5, matchMerchantContains: "Albert Heijn", setCategoryId: "cat-groceries" });
    const b = makeRule({ id: "b", precedence: 5, matchInstitution: "abn_amro_checking", setCategoryId: "cat-other" });
    const result = findApplicableRule([a, b], baseTxn);
    expect(result.conflict).toBe(true);
    expect(result.rule).toBeNull();
    expect(result.conflictingRules.map((r) => r.id).sort()).toEqual(["a", "b"]);
  });

  it("a higher-precedence rule (lower number) resolves what would otherwise be a conflicting outcome", () => {
    const winner = makeRule({ id: "winner", precedence: 1, matchMerchantContains: "Albert Heijn", setCategoryId: "cat-groceries" });
    const loser = makeRule({ id: "loser", precedence: 5, matchInstitution: "abn_amro_checking", setCategoryId: "cat-other" });
    const result = findApplicableRule([winner, loser], baseTxn);
    expect(result.conflict).toBe(false);
    expect(result.rule?.id).toBe("winner");
  });

  it("ignores inactive rules (caller is responsible for pre-filtering, but verify the matcher itself doesn't care about `active`)", () => {
    // findApplicableRule trusts its input list; this documents that the
    // caller (importPipeline.ts) must filter by `active` before calling it.
    const rule = makeRule({ active: false, matchMerchantContains: "Albert Heijn", setCategoryId: "cat-groceries" });
    const result = findApplicableRule([rule], baseTxn);
    expect(result.rule?.id).toBe("rule-1"); // still matches — filtering is the caller's job
  });
});

describe("countMatches", () => {
  it("counts how many transactions a rule would affect", () => {
    const rule = makeRule({ matchMerchantContains: "Albert Heijn" });
    const txns = [baseTxn, { ...baseTxn, merchant: "Jumbo" }, { ...baseTxn, merchant: "Albert Heijn XL" }];
    expect(countMatches(rule, txns)).toBe(2);
  });
});
