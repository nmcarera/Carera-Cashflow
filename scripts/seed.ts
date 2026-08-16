/**
 * Synthetic sample data seed.
 *
 * Populates a fresh database with a plausible household, accounts,
 * categories, priorities, a savings goal, and ~3 months of synthetic
 * transactions so the app is usable and demonstrable before any real
 * statement has been imported. None of this is real financial data.
 *
 * Run via `npm run db:seed`. Refuses to run against a database that already
 * has transactions, to avoid accidentally duplicating sample data on top of
 * real imported data — pass --force to wipe and reseed anyway (dev only).
 */
import { randomUUID } from "node:crypto";
import { db, sqlite } from "../src/lib/db/client";
import {
  householdMembers,
  accounts,
  categories,
  priorities,
  savingsGoals,
  transactions,
  appSettings,
} from "../src/lib/db/schema";
import { DEFAULT_CATEGORIES, DEFAULT_PRIORITIES } from "../src/lib/domain/enums";
import { computeDuplicateFingerprint } from "../src/lib/duplicates/fingerprint";

const CATEGORY_COLORS: Record<string, string> = {
  Housing: "#6E7B8B",
  Utilities: "#5B8A9A",
  Groceries: "#5C9E6F",
  "Dining and takeaway": "#C98A4B",
  Transportation: "#7A85C9",
  Healthcare: "#B25D7A",
  Insurance: "#8A7CA8",
  Subscriptions: "#4E9E9A",
  Shopping: "#C97B9E",
  Entertainment: "#B58A3E",
  Travel: "#4E86B0",
  Gifts: "#B0698E",
  Taxes: "#7A7A7A",
  Salary: "#3E9E6E",
  "Other income": "#6EA88A",
  "Savings contribution": "#3E8E9E",
  "Internal transfer": "#9A9A9A",
  Uncategorized: "#B5B5B5",
};

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

async function main() {
  const force = process.argv.includes("--force");

  const existing = db.select().from(transactions).all();
  if (existing.length > 0 && !force) {
    console.log(
      `Database already has ${existing.length} transactions. Refusing to reseed (pass --force to wipe sample/test data and reseed).`
    );
    return;
  }
  if (force) {
    sqlite.exec(`
      DELETE FROM transactions;
      DELETE FROM import_row_issues;
      DELETE FROM import_batches;
      DELETE FROM rules;
      DELETE FROM savings_goals;
      DELETE FROM audit_log;
      DELETE FROM accounts;
      DELETE FROM categories;
      DELETE FROM priorities;
      DELETE FROM household_members;
      DELETE FROM app_settings;
    `);
  }

  // --- Household -----------------------------------------------------
  const nic = { id: randomUUID(), name: "Nic", initials: "NC", color: "#4E86B0" };
  const mariana = { id: randomUUID(), name: "Mariana", initials: "MS", color: "#B25D7A" };
  db.insert(householdMembers).values([nic, mariana]).run();

  db.insert(appSettings)
    .values({ key: "household_name", value: JSON.stringify("Carera household") })
    .run();
  db.insert(appSettings)
    .values({ key: "reporting_currency", value: JSON.stringify("EUR") })
    .run();

  // --- Categories & priorities ----------------------------------------
  const categoryRows = DEFAULT_CATEGORIES.map((name) => ({
    id: randomUUID(),
    name,
    color: CATEGORY_COLORS[name] ?? "#8A8A8A",
    isSystem: true,
  }));
  db.insert(categories).values(categoryRows).run();
  const catByName = Object.fromEntries(categoryRows.map((c) => [c.name, c.id]));

  const priorityRows = DEFAULT_PRIORITIES.map((name, i) => ({
    id: randomUUID(),
    name,
    isSystem: true,
    sortOrder: i,
  }));
  db.insert(priorities).values(priorityRows).run();
  const prioByName = Object.fromEntries(priorityRows.map((p) => [p.name, p.id]));

  // --- Accounts ---------------------------------------------------------
  interface AccountSeed {
    id: string;
    institution: string;
    accountType: "checking" | "savings" | "credit_card" | "other";
    displayName: string;
    currency: string;
    externalIdentifierMasked: string;
    ownershipType: "person" | "shared" | "unassigned";
    ownerMemberId: string | null;
  }

  const abnCheckingNic: AccountSeed = {
    id: randomUUID(),
    institution: "abn_amro_checking",
    accountType: "checking",
    displayName: "ABN AMRO Checking — Nic",
    currency: "EUR",
    externalIdentifierMasked: "...4944",
    ownershipType: "person",
    ownerMemberId: nic.id,
  };
  const abnCheckingShared: AccountSeed = {
    id: randomUUID(),
    institution: "abn_amro_checking",
    accountType: "checking",
    displayName: "ABN AMRO Joint Checking",
    currency: "EUR",
    externalIdentifierMasked: "...0313",
    ownershipType: "shared",
    ownerMemberId: null,
  };
  const abnSavingsShared: AccountSeed = {
    id: randomUUID(),
    institution: "abn_amro_savings",
    accountType: "savings",
    displayName: "ABN AMRO Direct Savings",
    currency: "EUR",
    externalIdentifierMasked: "...1700",
    ownershipType: "shared",
    ownerMemberId: null,
  };
  const amexShared: AccountSeed = {
    id: randomUUID(),
    institution: "amex_eu",
    accountType: "credit_card",
    displayName: "Amex Platinum (EU)",
    currency: "EUR",
    externalIdentifierMasked: "...6005",
    ownershipType: "shared",
    ownerMemberId: null,
  };
  const chaseNic: AccountSeed = {
    id: randomUUID(),
    institution: "chase_us",
    accountType: "checking",
    displayName: "Chase Checking — Nic (US)",
    currency: "USD",
    externalIdentifierMasked: "...7842",
    ownershipType: "person",
    ownerMemberId: nic.id,
  };
  db.insert(accounts)
    .values([abnCheckingNic, abnCheckingShared, abnSavingsShared, amexShared, chaseNic])
    .run();

  // --- Savings goal -------------------------------------------------------
  db.insert(savingsGoals)
    .values({
      id: randomUUID(),
      name: "Emergency + travel fund",
      linkedAccountId: abnSavingsShared.id,
      targetBalanceEur: 25000,
      targetDate: isoDate(daysAgo(-365)),
      startingBalanceEur: 8000,
      startingBalanceAsOf: isoDate(daysAgo(400)),
    })
    .run();

  // --- Synthetic transactions ---------------------------------------------
  type SeedTxn = {
    account: AccountSeed;
    daysAgoStart: number;
    desc: string;
    merchant: string;
    amount: number; // signed, original currency
    currency: string;
    eurAmount?: number; // if omitted, equals amount when currency is EUR
    category: string;
    priority: string;
    ownership: "person" | "shared" | "unassigned";
    owner?: typeof nic;
    needsReview?: boolean;
    reviewReasons?: string[];
    direction: "debit" | "credit" | "transfer";
  };

  const rows: SeedTxn[] = [];
  const merchants: Array<[string, string, number, string, string]> = [
    // desc, merchant, typical amount (negative=expense), category, priority
    ["Albert Heijn groceries", "Albert Heijn", -68.4, "Groceries", "Essential"],
    ["Jumbo groceries", "Jumbo", -54.1, "Groceries", "Essential"],
    ["NS Railway subscription", "NS", -89.0, "Transportation", "Essential"],
    ["Vattenfall energy", "Vattenfall", -142.3, "Utilities", "Essential"],
    ["Ziggo internet", "Ziggo", -55.0, "Utilities", "Essential"],
    ["Rent payment", "Property Management BV", -1650.0, "Housing", "Essential"],
    ["Zilveren Kruis health insurance", "Zilveren Kruis", -168.5, "Insurance", "Essential"],
    ["Netflix", "Netflix", -13.99, "Subscriptions", "Flexible"],
    ["Spotify", "Spotify", -11.99, "Subscriptions", "Flexible"],
    ["Uber Eats", "Uber Eats", -27.4, "Dining and takeaway", "Discretionary"],
    ["Restaurant De Kas", "De Kas", -96.0, "Dining and takeaway", "Discretionary"],
    ["Coffee", "Screaming Beans", -4.6, "Dining and takeaway", "Discretionary"],
    ["Bol.com order", "Bol.com", -43.2, "Shopping", "Discretionary"],
    ["Zara", "Zara", -78.5, "Shopping", "Discretionary"],
    ["Pathe cinema", "Pathe", -24.0, "Entertainment", "Discretionary"],
    ["Yoga studio", "Studio Zen", -60.0, "Healthcare", "Flexible"],
    ["Apotheek pharmacy", "Apotheek Centrum", -18.3, "Healthcare", "Essential"],
    ["Gift for friend's birthday", "Bloemenwinkel", -35.0, "Gifts", "Discretionary"],
    ["KLM flight", "KLM", -310.0, "Travel", "Discretionary"],
    ["Salary payment", "N&M Co Creations B.V.", 4200.0, "Salary", "Essential"],
    ["Freelance income", "Good Eats Catering", 620.0, "Other income", "Essential"],
  ];

  let dayCursor = 88;
  for (let i = 0; i < 70; i++) {
    const m = merchants[i % merchants.length];
    dayCursor -= Math.max(1, Math.round(Math.random() * 3));
    if (dayCursor < 0) dayCursor = 0;
    const jitter = 1 + (Math.random() - 0.5) * 0.3;
    const amount = Math.round(m[2] * jitter * 100) / 100;
    const account =
      i % 5 === 0 ? chaseNic : i % 3 === 0 ? abnCheckingShared : abnCheckingNic;
    const owner =
      account === chaseNic || account === abnCheckingNic ? nic : undefined;
    const isIncome = amount > 0;
    rows.push({
      account,
      daysAgoStart: dayCursor,
      desc: m[0],
      merchant: m[1],
      amount: account.currency === "USD" ? Math.round(amount * 1.08 * 100) / 100 : amount,
      currency: account.currency,
      category: m[3],
      priority: m[4],
      ownership: owner ? "person" : "shared",
      owner,
      direction: isIncome ? "credit" : "debit",
    });
  }

  // A handful of intentionally uncategorized / review-queue items.
  for (let i = 0; i < 5; i++) {
    rows.push({
      account: abnCheckingShared,
      daysAgoStart: 5 + i * 3,
      desc: "SEPA Overboeking — unclear counterparty",
      merchant: "Unknown counterparty",
      amount: -[45, 120, 18, 260, 33][i],
      currency: "EUR",
      category: "Uncategorized",
      priority: "Unclassified",
      ownership: "unassigned",
      needsReview: true,
      reviewReasons: ["no_category", "no_owner"],
      direction: "debit",
    });
  }

  // A savings contribution transfer pair (checking -> savings), confirmed transfer.
  rows.push({
    account: abnCheckingShared,
    daysAgoStart: 20,
    desc: "Transfer to Direct Savings",
    merchant: "Own account",
    amount: -500,
    currency: "EUR",
    category: "Internal transfer",
    priority: "Excluded / transfer",
    ownership: "shared",
    direction: "transfer",
  });
  rows.push({
    account: abnSavingsShared,
    daysAgoStart: 20,
    desc: "Transfer from Joint Checking",
    merchant: "Own account",
    amount: 500,
    currency: "EUR",
    category: "Savings contribution",
    priority: "Savings",
    ownership: "shared",
    direction: "transfer",
  });

  const txnValues = rows.map((r) => {
    const date = isoDate(daysAgo(r.daysAgoStart));
    const eurAmount =
      r.eurAmount ?? (r.currency === "EUR" ? r.amount : Math.round((r.amount / 1.08) * 100) / 100);
    const original = {
      note: "synthetic sample data",
      description: r.desc,
    };
    const fingerprint = computeDuplicateFingerprint({
      accountId: r.account.id,
      transactionDate: date,
      amount: r.amount,
      currency: r.currency,
      description: r.desc,
    });
    return {
      id: randomUUID(),
      importBatchId: null,
      accountId: r.account.id,
      sourceFileName: "seed-sample-data",
      sourceRowNumber: 0,
      originalRowJson: JSON.stringify(original),
      transactionDate: date,
      postingDate: date,
      merchant: r.merchant,
      originalDescription: r.desc,
      cleanedDescription: r.desc,
      originalAmount: r.amount,
      originalCurrency: r.currency,
      eurAmount,
      exchangeRate: r.currency === "EUR" ? null : 1.08,
      exchangeRateDate: r.currency === "EUR" ? null : date,
      exchangeRateSource: r.currency === "EUR" ? null : "seed-sample-data",
      conversionStatus: "exact" as const,
      direction: r.direction,
      categoryId: catByName[r.category] ?? null,
      priorityId: prioByName[r.priority] ?? null,
      ownershipType: r.ownership,
      ownerMemberId: r.owner?.id ?? null,
      reviewStatus: r.needsReview ? ("needs_review" as const) : ("ok" as const),
      reviewReasonsJson: JSON.stringify(r.reviewReasons ?? []),
      confidenceReason: r.needsReview ? "No matching rule found for this description." : null,
      appliedRuleId: null,
      duplicateFingerprint: fingerprint,
      possibleTransferId: null,
      transferStatus: r.direction === "transfer" ? ("confirmed" as const) : ("none" as const),
      notes: null,
    };
  });

  db.insert(transactions).values(txnValues).run();

  console.log(
    `Seeded: 2 household members, 5 accounts, ${categoryRows.length} categories, ${priorityRows.length} priorities, 1 savings goal, ${txnValues.length} synthetic transactions.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
