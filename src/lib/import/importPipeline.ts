/**
 * The import pipeline: preview → validate → (user confirms) → commit.
 *
 * This module is the only place that turns adapter output into database
 * writes. It owns: account resolution (matching a file's account numbers to
 * existing `accounts` rows, or staging new ones), schema validation via
 * `NormalizedRowSchema`, duplicate detection, the Phase-2 transfer
 * heuristic, and import-batch bookkeeping (including undo). Institution
 * adapters never talk to the database directly (see adapters/types.ts) —
 * this is where that boundary is enforced.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import {
  accounts,
  importBatches,
  importRowIssues,
  transactions,
  householdMembers,
  categories,
  priorities,
} from "../db/schema";
import { inspectFile } from "./fileInspector";
import { detectAdapters, getAdapterById, UNVERIFIED_ADAPTER_IDS } from "./adapters/registry";
import type { ParsedRowResult } from "./adapters/types";
import { NormalizedRowSchema, type NormalizedRow } from "../domain/transaction";
import { computeDuplicateFingerprint } from "../duplicates/fingerprint";
import { findExistingDuplicate } from "../duplicates/detector";
import { findPossibleTransferMatch } from "../transfers/detector";
import { CareraError } from "../logging/errors";
import { logError, logInfo } from "../logging/logger";
import type { AccountType, Institution } from "../domain/enums";
import { findApplicableRule } from "../categorization/rules";
import { computeReviewStatus } from "../categorization/reviewStatus";
import { rules as rulesTable } from "../db/schema";
import { resolveConversionSync } from "../currency/convert";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PreviewRowStatus =
  | "valid"
  | "duplicate"
  | "malformed"
  | "missing_field"
  | "uncertain_currency"
  | "possible_transfer";

export interface PreviewRow {
  sourceRowNumber: number;
  status: PreviewRowStatus;
  accountExternalId: string | null;
  normalized: NormalizedRow | null;
  message: string | null;
  rawRowPreview: Record<string, unknown>;
  suggestedOwnerName: string | null;
}

export interface AccountGroupPreview {
  accountExternalId: string;
  rowCount: number;
  /** Set when this account number matches an already-known account. */
  existingAccountId: string | null;
  existingAccountName: string | null;
  hint: {
    institution: Institution;
    accountType: AccountType;
    displayName: string;
    currency: string;
  };
}

export interface ImportPreview {
  previewId: string;
  fileName: string;
  fileHash: string;
  adapterId: string;
  adapterLabel: string;
  adapterUnverified: boolean;
  sheetUsed: string;
  rows: PreviewRow[];
  accountGroups: AccountGroupPreview[];
  summary: {
    rowsInspected: number;
    valid: number;
    duplicates: number;
    malformed: number;
    missingField: number;
    uncertainCurrency: number;
    possibleTransfers: number;
  };
  /** Institutions that were detected/recognized in this file but the user
   *  did not select — offered as alternatives if the auto-pick looks wrong. */
  alternativeAdapters: { id: string; label: string; confidence: number }[];
  unrecognized: boolean;
}

export interface AccountResolutionChoice {
  action: "create" | "link";
  /** Required when action = 'link'. */
  accountId?: string;
  /** Optional overrides when action = 'create'; falls back to the adapter's hint. */
  displayName?: string;
  accountType?: AccountType;
  institution?: Institution;
  currency?: string;
}

export interface CommitResult {
  batchId: string;
  rowsInspected: number;
  rowsImported: number;
  rowsDuplicate: number;
  rowsTransferSuggested: number;
  rowsWarning: number;
  rowsError: number;
  exchangeRateStatus: "n/a" | "ok" | "pending";
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

/** Picks one institution/type/currency/display-name hint to represent an
 *  entire account from all of its rows' individual hints.
 *
 * This is deliberately NOT a plain majority vote. Real ABN AMRO savings
 * accounts turned out (verified against real sample files) to have *more*
 * plain "SEPA Overboeking" transfer rows — indistinguishable from a
 * checking account by text alone — than rows carrying an explicit savings
 * signal ("CREDIT INTEREST", "Direct Savings"). A majority vote would
 * misclassify such an account as checking. Since a checking account should
 * essentially never contain that explicit language, but a savings account
 * routinely contains ordinary-looking transfers in and out, this treats a
 * single savings-flavored row as decisive: any signal wins over none. */
function majorityHint(rows: ParsedRowResult[]): AccountGroupPreview["hint"] {
  const savingsRow = rows.find((r) => r.accountTypeHint === "savings");
  const representative = savingsRow ?? rows[0];
  return {
    institution: (representative?.accountInstitutionHint ?? "unknown") as Institution,
    accountType: (representative?.accountTypeHint ?? "other") as AccountType,
    displayName: representative?.accountDisplayNameHint ?? "Unnamed account",
    currency: representative?.accountCurrencyHint ?? "EUR",
  };
}

function matchOwnerMemberId(suggestedOwnerName: string | undefined): string | null {
  if (!suggestedOwnerName) return null;
  const members = db.select().from(householdMembers).all();
  const needle = suggestedOwnerName.toLowerCase();
  const found = members.find(
    (m) => needle.includes(m.name.toLowerCase()) || m.name.toLowerCase().includes(needle)
  );
  return found?.id ?? null;
}

export async function previewImport(
  fileName: string,
  buffer: Buffer,
  forcedAdapterId?: string
): Promise<ImportPreview> {
  const file = await inspectFile(fileName, buffer);

  const detections = detectAdapters(file);
  const chosen = forcedAdapterId
    ? getAdapterById(forcedAdapterId)
    : detections[0]?.adapter;

  if (!chosen) {
    logInfo("import.preview", "No adapter recognized this file's format.", { fileName });
    return {
      previewId: randomUUID(),
      fileName,
      fileHash: file.fileHash,
      adapterId: "",
      adapterLabel: "",
      adapterUnverified: false,
      sheetUsed: "",
      rows: [],
      accountGroups: [],
      summary: {
        rowsInspected: 0,
        valid: 0,
        duplicates: 0,
        malformed: 0,
        missingField: 0,
        uncertainCurrency: 0,
        possibleTransfers: 0,
      },
      alternativeAdapters: [],
      unrecognized: true,
    };
  }

  const { sheetUsed, rows: parsedRows } = chosen.parse(file);

  // Group by account so we can resolve/stage accounts before building
  // per-row previews (a row's duplicate check depends on knowing the real
  // account id when one already exists).
  const groups = new Map<string, ParsedRowResult[]>();
  for (const r of parsedRows) {
    const key = r.normalized?.accountExternalId ?? `__unresolved_row_${r.sourceRowNumber}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  const existingAccounts = db.select().from(accounts).all();
  const accountGroups: AccountGroupPreview[] = [];
  const externalIdToExistingAccountId = new Map<string, string>();

  for (const [externalId, rows] of groups) {
    if (externalId.startsWith("__unresolved_row_")) continue;
    const existing = existingAccounts.find((a) => a.externalAccountNumber === externalId);
    if (existing) externalIdToExistingAccountId.set(externalId, existing.id);
    accountGroups.push({
      accountExternalId: externalId,
      rowCount: rows.length,
      existingAccountId: existing?.id ?? null,
      existingAccountName: existing?.displayName ?? null,
      hint: majorityHint(rows),
    });
  }

  const seenFingerprintsThisFile = new Set<string>();
  const previewRows: PreviewRow[] = [];
  const summary = {
    rowsInspected: 0,
    valid: 0,
    duplicates: 0,
    malformed: 0,
    missingField: 0,
    uncertainCurrency: 0,
    possibleTransfers: 0,
  };

  for (const r of parsedRows) {
    summary.rowsInspected++;

    if (r.issue) {
      const status: PreviewRowStatus = r.issue.type === "missing_field" ? "missing_field" : "malformed";
      summary[status === "missing_field" ? "missingField" : "malformed"]++;
      previewRows.push({
        sourceRowNumber: r.sourceRowNumber,
        status,
        accountExternalId: null,
        normalized: null,
        message: r.issue.message,
        rawRowPreview: r.rawRow,
        suggestedOwnerName: null,
      });
      continue;
    }

    const parsedZod = NormalizedRowSchema.safeParse(r.normalized);
    if (!parsedZod.success) {
      summary.malformed++;
      previewRows.push({
        sourceRowNumber: r.sourceRowNumber,
        status: "malformed",
        accountExternalId: r.normalized?.accountExternalId ?? null,
        normalized: null,
        message: parsedZod.error.issues.map((i) => i.message).join("; "),
        rawRowPreview: r.rawRow,
        suggestedOwnerName: null,
      });
      continue;
    }

    const normalized = parsedZod.data;
    const existingAccountId = externalIdToExistingAccountId.get(normalized.accountExternalId);

    let duplicateMessage: string | null = null;
    if (existingAccountId) {
      const fingerprint = computeDuplicateFingerprint({
        accountId: existingAccountId,
        transactionDate: normalized.transactionDate,
        amount: normalized.originalAmount,
        currency: normalized.originalCurrency,
        description: normalized.originalDescription,
        institutionTransactionId: normalized.institutionTransactionId,
      });
      const dup = findExistingDuplicate(existingAccountId, fingerprint);
      if (dup) duplicateMessage = dup.explanation;
    }
    // Duplicate within this same upload (e.g. the file was uploaded twice
    // in one session, or two overlapping statements uploaded together).
    const withinFileKey = `${normalized.accountExternalId}|${normalized.transactionDate}|${normalized.originalAmount}|${normalized.originalCurrency}`;
    if (!duplicateMessage && seenFingerprintsThisFile.has(withinFileKey)) {
      duplicateMessage = "Matches another row earlier in this same file.";
    }
    seenFingerprintsThisFile.add(withinFileKey);

    if (duplicateMessage) {
      summary.duplicates++;
      previewRows.push({
        sourceRowNumber: r.sourceRowNumber,
        status: "duplicate",
        accountExternalId: normalized.accountExternalId,
        normalized,
        message: duplicateMessage,
        rawRowPreview: r.rawRow,
        suggestedOwnerName: r.suggestedOwnerName ?? null,
      });
      continue;
    }

    const currencyUncertain =
      normalized.originalCurrency !== "EUR" && normalized.providedEurAmount === undefined;
    if (currencyUncertain) summary.uncertainCurrency++;

    let transferMessage: string | null = null;
    const eurAmount =
      normalized.originalCurrency === "EUR" ? normalized.originalAmount : normalized.providedEurAmount;
    if (eurAmount !== undefined && normalized.direction !== "transfer") {
      const candidate = findPossibleTransferMatch({
        accountId: existingAccountId ?? normalized.accountExternalId,
        transactionDate: normalized.transactionDate,
        eurAmount,
      });
      if (candidate) {
        transferMessage = candidate.explanation;
        summary.possibleTransfers++;
      }
    }

    summary.valid++;
    previewRows.push({
      sourceRowNumber: r.sourceRowNumber,
      status: currencyUncertain ? "uncertain_currency" : transferMessage ? "possible_transfer" : "valid",
      accountExternalId: normalized.accountExternalId,
      normalized,
      message: transferMessage,
      rawRowPreview: r.rawRow,
      suggestedOwnerName: r.suggestedOwnerName ?? null,
    });
  }

  const alternativeAdapters = detections
    .filter((d) => d.adapter.id !== chosen.id)
    .map((d) => ({ id: d.adapter.id, label: d.adapter.label, confidence: d.confidence }));

  return {
    previewId: randomUUID(),
    fileName,
    fileHash: file.fileHash,
    adapterId: chosen.id,
    adapterLabel: chosen.label,
    adapterUnverified: UNVERIFIED_ADAPTER_IDS.has(chosen.id),
    sheetUsed,
    rows: previewRows,
    accountGroups,
    summary,
    alternativeAdapters,
    unrecognized: false,
  };
}

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------

export function commitImport(
  preview: ImportPreview,
  accountResolutions: Record<string, AccountResolutionChoice>
): CommitResult {
  const batchId = randomUUID();

  // Resolve every account group to a real account id, creating new accounts
  // as needed. This is the only place import-time account creation happens.
  const existingAccountsList = db.select().from(accounts).all();
  const accountIdByExternalId = new Map<string, string>();
  const institutionByAccountId = new Map<string, string>();
  for (const group of preview.accountGroups) {
    const choice = accountResolutions[group.accountExternalId] ?? {
      action: group.existingAccountId ? "link" : "create",
      accountId: group.existingAccountId ?? undefined,
    };

    if (choice.action === "link") {
      if (!choice.accountId) {
        throw new CareraError({
          code: "DB_002_CONSTRAINT_VIOLATION",
          category: "database",
          context: { fileName: preview.fileName },
          detail: `No target account chosen for detected account "${group.accountExternalId}".`,
        });
      }
      accountIdByExternalId.set(group.accountExternalId, choice.accountId);
      const existing = existingAccountsList.find((a) => a.id === choice.accountId);
      institutionByAccountId.set(choice.accountId, existing?.institution ?? group.hint.institution);
    } else {
      const newId = randomUUID();
      const institution = choice.institution ?? group.hint.institution;
      db.insert(accounts)
        .values({
          id: newId,
          institution,
          accountType: choice.accountType ?? group.hint.accountType,
          displayName: choice.displayName ?? group.hint.displayName,
          currency: choice.currency ?? group.hint.currency,
          externalAccountNumber: group.accountExternalId,
          ownershipType: "shared",
        })
        .run();
      accountIdByExternalId.set(group.accountExternalId, newId);
      institutionByAccountId.set(newId, institution);
    }
  }

  // Active rules, loaded once and matched in-memory per row rather than
  // per-row-queried — an import can be hundreds of rows.
  const activeRules = db.select().from(rulesTable).where(eq(rulesTable.active, true)).all();

  let rowsImported = 0;
  let rowsDuplicate = 0;
  let rowsTransferSuggested = 0;
  let rowsWarning = 0;
  let rowsError = 0;
  let anyPendingConversion = false;
  let anyNonEurResolved = false;

  // Looked up once, not per row: the well-known category/priority a
  // high-confidence adapter-asserted transfer (e.g. an Amex "thank you for
  // your payment" settlement row) should land in immediately, rather than
  // sitting in the review queue for something we're already sure about.
  const internalTransferCategoryId =
    db.select().from(categories).where(eq(categories.name, "Internal transfer")).all()[0]?.id ?? null;
  const excludedPriorityId =
    db.select().from(priorities).where(eq(priorities.name, "Excluded / transfer")).all()[0]?.id ?? null;

  try {
    db.transaction((tx) => {
    // Inserted first (with placeholder counts, updated at the end of this
    // transaction) so that every transactions/import_row_issues row below —
    // which references it by importBatchId — satisfies the foreign key
    // constraint immediately. SQLite checks FKs as each statement runs,
    // not just at commit, so batch bookkeeping must exist before the rows
    // that point to it.
    tx.insert(importBatches)
      .values({
        id: batchId,
        institution: preview.adapterId,
        accountId: accountIdByExternalId.values().next().value ?? null,
        fileName: preview.fileName,
        fileHash: preview.fileHash,
        status: "committed",
        rowsInspected: preview.summary.rowsInspected,
        rowsImported: 0,
        rowsDuplicate: 0,
        rowsTransferSuggested: 0,
        rowsWarning: 0,
        rowsError: 0,
        exchangeRateStatus: "n/a",
      })
      .run();

    for (const row of preview.rows) {
      if (row.status === "malformed" || row.status === "missing_field") {
        rowsError++;
        tx.insert(importRowIssues)
          .values({
            id: randomUUID(),
            importBatchId: batchId,
            sourceRowNumber: row.sourceRowNumber,
            issueType: row.status === "missing_field" ? "missing_field" : "malformed",
            message: row.message ?? "Row could not be parsed.",
            rawRowJson: JSON.stringify(row.rawRowPreview),
          })
          .run();
        continue;
      }

      const normalized = row.normalized!;
      const accountId = accountIdByExternalId.get(normalized.accountExternalId)!;

      // Recompute duplicate status against the *final* resolved account —
      // authoritative check, independent of what preview guessed.
      const fingerprint = computeDuplicateFingerprint({
        accountId,
        transactionDate: normalized.transactionDate,
        amount: normalized.originalAmount,
        currency: normalized.originalCurrency,
        description: normalized.originalDescription,
        institutionTransactionId: normalized.institutionTransactionId,
      });
      const dup = findExistingDuplicate(accountId, fingerprint);
      if (dup) {
        rowsDuplicate++;
        tx.insert(importRowIssues)
          .values({
            id: randomUUID(),
            importBatchId: batchId,
            sourceRowNumber: row.sourceRowNumber,
            issueType: "duplicate",
            message: dup.explanation,
            rawRowJson: JSON.stringify(row.rawRowPreview),
            relatedTransactionId: dup.existingTransactionId,
          })
          .run();
        continue;
      }

      const conversion = resolveConversionSync(tx, {
        currency: normalized.originalCurrency,
        amount: normalized.originalAmount,
        date: normalized.transactionDate,
        providedEurAmount: normalized.providedEurAmount,
        providedExchangeRate: normalized.providedExchangeRate,
      });
      const { eurAmount, conversionStatus } = conversion;
      if (conversionStatus === "pending") anyPendingConversion = true;
      else if (normalized.originalCurrency !== "EUR") anyNonEurResolved = true;

      let transferStatus: "none" | "suggested" = "none";
      let possibleTransferId: string | null = null;
      const isConfidentTransfer = normalized.direction === "transfer";

      if (!isConfidentTransfer && eurAmount !== null) {
        const candidate = findPossibleTransferMatch({
          accountId,
          transactionDate: normalized.transactionDate,
          eurAmount,
        });
        if (candidate) {
          transferStatus = "suggested";
          possibleTransferId = candidate.transactionId;
          rowsTransferSuggested++;
        }
      }

      const suggestedOwnerId = matchOwnerMemberId(row.suggestedOwnerName ?? undefined);

      let categoryId: string | null = null;
      let priorityId: string | null = null;
      let ownershipType: "person" | "shared" | "unassigned" = suggestedOwnerId ? "person" : "unassigned";
      let ownerMemberId: string | null = suggestedOwnerId;
      let appliedRuleId: string | null = null;
      let confidenceReason: string | null = suggestedOwnerId
        ? "Owner suggested from the card statement's cardholder name."
        : null;
      let hasRuleConflict = false;

      if (isConfidentTransfer) {
        // A confident, adapter-asserted transfer (e.g. an Amex card-payment
        // settlement row, identified from explicit "thank you for your
        // payment" statement text — not a guess) is categorized immediately
        // rather than sitting in the review queue for something already
        // known, per build brief §5 ("credit-card payments should not be
        // double-counted... treat the payment as a transfer or excluded
        // settlement"). Rules never run against these — there's nothing
        // left for a rule to decide.
        categoryId = internalTransferCategoryId;
        priorityId = excludedPriorityId;
        ownershipType = "shared";
        ownerMemberId = null;
        confidenceReason = "Identified from the statement's own payment-confirmation text.";
      } else {
        const ruleResult = findApplicableRule(activeRules, {
          merchant: normalized.merchant ?? null,
          cleanedDescription: normalized.cleanedDescription,
          originalDescription: normalized.originalDescription,
          institution: institutionByAccountId.get(accountId) ?? "unknown",
          accountId,
          originalAmount: normalized.originalAmount,
          direction: normalized.direction,
        });

        if (ruleResult.conflict) {
          hasRuleConflict = true;
          confidenceReason = `${ruleResult.conflictingRules.length} rules with equal precedence disagree on how to classify this transaction.`;
        } else if (ruleResult.rule) {
          const rule = ruleResult.rule;
          categoryId = rule.setCategoryId;
          priorityId = rule.setPriorityId;
          if (rule.setOwnershipType) {
            ownershipType = rule.setOwnershipType as "person" | "shared" | "unassigned";
            ownerMemberId = rule.setOwnershipType === "person" ? rule.setOwnerMemberId : null;
          }
          appliedRuleId = rule.id;
          confidenceReason = `Categorized automatically by rule "${rule.name}".`;
        }
      }

      const { reviewStatus, reviewReasons } = computeReviewStatus({
        hasCategory: categoryId !== null,
        hasOwner: ownershipType !== "unassigned",
        transferStatus,
        conversionStatus,
        hasRuleConflict,
      });

      tx.insert(transactions)
        .values({
          id: randomUUID(),
          importBatchId: batchId,
          accountId,
          sourceFileName: preview.fileName,
          sourceRowNumber: normalized.sourceRowNumber,
          originalRowJson: JSON.stringify(normalized.originalRow),
          transactionDate: normalized.transactionDate,
          postingDate: normalized.postingDate ?? null,
          merchant: normalized.merchant ?? null,
          originalDescription: normalized.originalDescription,
          cleanedDescription: normalized.cleanedDescription,
          originalAmount: normalized.originalAmount,
          originalCurrency: normalized.originalCurrency,
          eurAmount,
          exchangeRate: conversion.exchangeRate,
          exchangeRateDate: conversion.exchangeRateDate,
          exchangeRateSource: conversion.exchangeRateSource,
          conversionStatus,
          direction: normalized.direction,
          categoryId,
          priorityId,
          ownershipType,
          ownerMemberId,
          reviewStatus,
          reviewReasonsJson: JSON.stringify(reviewReasons),
          confidenceReason,
          appliedRuleId,
          duplicateFingerprint: fingerprint,
          possibleTransferId,
          transferStatus,
          notes: null,
        })
        .run();
      rowsImported++;
      if (reviewReasons.length > 0) rowsWarning++;
    }

    tx.update(importBatches)
      .set({
        rowsImported,
        rowsDuplicate,
        rowsTransferSuggested,
        rowsWarning,
        rowsError,
        exchangeRateStatus: finalExchangeRateStatus(anyPendingConversion, anyNonEurResolved),
      })
      .where(eq(importBatches.id, batchId))
      .run();
    });
  } catch (err) {
    logError(
      new CareraError({
        code: "DB_003_TRANSACTION_ROLLED_BACK",
        category: "database",
        context: { fileName: preview.fileName },
        cause: err,
        whatWasSaved: "Nothing — the entire import was rolled back.",
      }),
      { operation: "import.commit" }
    );
    throw err;
  }

  return {
    batchId,
    rowsInspected: preview.summary.rowsInspected,
    rowsImported,
    rowsDuplicate,
    rowsTransferSuggested,
    rowsWarning,
    rowsError,
    exchangeRateStatus: finalExchangeRateStatus(anyPendingConversion, anyNonEurResolved),
  };
}

/** `pending` if anything still needs a rate, `ok` if every non-EUR row in
 *  this batch got a resolved (exact or estimated) EUR amount, `n/a` if the
 *  batch had no non-EUR currency to convert in the first place. */
function finalExchangeRateStatus(
  anyPendingConversion: boolean,
  anyNonEurResolved: boolean
): "n/a" | "ok" | "pending" {
  if (anyPendingConversion) return "pending";
  if (anyNonEurResolved) return "ok";
  return "n/a";
}

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

export function undoImportBatch(batchId: string): { undone: boolean; reason?: string } {
  const batch = db.select().from(importBatches).where(eq(importBatches.id, batchId)).all()[0];
  if (!batch) return { undone: false, reason: "Import batch not found." };
  if (batch.status === "undone") return { undone: false, reason: "This import was already undone." };

  db.transaction((tx) => {
    // Scoped strictly to this batch's own transactions — never touches
    // other batches' transactions or any categorization rule (build brief
    // §4: "must not accidentally delete transactions from other batches or
    // user-created categorization rules").
    tx.delete(transactions).where(eq(transactions.importBatchId, batchId)).run();
    tx.update(importBatches)
      .set({ status: "undone", undoneAt: new Date().toISOString() })
      .where(eq(importBatches.id, batchId))
      .run();
  });

  return { undone: true };
}
