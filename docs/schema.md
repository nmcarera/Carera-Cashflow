# Canonical transaction schema and financial calculations

This document is the human-readable companion to the authoritative
definitions in code:

- Physical storage: `src/lib/db/schema.ts` (Drizzle ORM, SQLite).
- Validation boundary for newly-imported rows: `src/lib/domain/transaction.ts`
  (`NormalizedRowSchema`, `CanonicalTransactionSchema`, both Zod).
- Shared enums: `src/lib/domain/enums.ts`.

If this document and the code ever disagree, the code is correct — please
file that as a documentation bug.

## Why some brief-listed "transaction fields" are joins, not columns

The build brief's canonical model lists **account display name** and
**source institution** as transaction-level fields. In the database they are
stored once, on the `accounts` table, and joined in for display
(`src/lib/db/queries.ts` → `HydratedTransaction`). Storing a bank's display
name redundantly on every one of that account's transactions means renaming
an account in Settings would either require rewriting thousands of rows or
silently produce stale names on old transactions. A transaction's
institution is likewise always identical to its account's institution — an
account never switches banks. Every other field in the brief's list (date,
amounts, currency, category, priority, ownership, review state, rule
provenance, notes, etc.) is a genuine per-transaction fact and is stored
directly on the `transactions` table.

## Table reference

### `transactions` (the canonical table)

| Field | Type | Notes |
| --- | --- | --- |
| `id` | UUID | Internal transaction ID. |
| `importBatchId` | UUID, nullable | Null for manually-entered or seed-data rows. |
| `accountId` | UUID | FK → `accounts`. Resolves account display name, type, institution. |
| `sourceFileName` | text | Original uploaded file name. |
| `sourceRowNumber` | int | 1-based row number in the source file (0 for non-imported rows). |
| `originalRowJson` | JSON text | The **unmodified** original row, exactly as read from the file. Never edited. |
| `transactionDate` | ISO date | The transaction date. |
| `postingDate` | ISO date, nullable | When the source file distinguishes it from the transaction date. |
| `merchant` | text, nullable | Best-effort extracted counterparty name. |
| `originalDescription` | text | The bank's raw description text, unmodified. |
| `cleanedDescription` | text | A human-readable version (whitespace/encoding cleanup; never invents information). |
| `originalAmount` | decimal | Signed, in `originalCurrency`. |
| `originalCurrency` | ISO 4217 | The account's native currency for this transaction. |
| `eurAmount` | decimal, nullable | Null only while `conversionStatus = 'pending'`. |
| `exchangeRate`, `exchangeRateDate`, `exchangeRateSource` | — | Populated whenever `originalCurrency != EUR`; see "Currency conversion" below. |
| `conversionStatus` | enum | `exact` \| `estimated` \| `pending`. |
| `direction` | enum | `debit` \| `credit` \| `transfer`. |
| `categoryId`, `priorityId` | UUID, nullable | User- or rule-assigned classification. |
| `ownershipType` | enum | `person` \| `shared` \| `unassigned`. |
| `ownerMemberId` | UUID, nullable | Set only when `ownershipType = 'person'`. |
| `reviewStatus` | enum | `ok` \| `needs_review`. |
| `reviewReasonsJson` | JSON array | Machine-readable reasons (see `ReviewReason` enum) — always rendered as an explanation, never a bare flag. |
| `confidenceReason` | text, nullable | Human-readable explanation for an automatic suggestion. |
| `appliedRuleId` | UUID, nullable | FK → `rules`, when a rule produced the current classification. |
| `duplicateFingerprint` | text | See `src/lib/duplicates/fingerprint.ts`. |
| `possibleTransferId`, `transferStatus` | — | Suggested/confirmed/rejected match to another transaction. Confirm/reject is a manual action (`src/lib/transactions/edit.ts`, Phase 3); the *matching* heuristic is the Phase 2 amount/date gate plus Phase 4's counterparty tie-break (see "Financial calculations" below). |
| `notes` | text, nullable | User notes. |
| `createdAt`, `updatedAt` | timestamp | — |

### Supporting tables

- `accounts` — institution, account type, display name, native currency,
  ownership, archived flag.
- `household_members` — configurable member names/initials/colors.
- `categories`, `priorities` — user-editable, soft-archived (never hard
  deleted while transactions reference them — see build brief §7).
- `import_batches` — one row per confirmed import, with the full
  inspected/imported/duplicate/warning/error counts shown in the import
  summary and import history page.
- `import_row_issues` — one row per source row that was **not** committed
  (duplicate, malformed, missing field, etc.), or an info-level note (e.g. a
  possible transfer) surfaced during review. Committed rows live only in
  `transactions`.
- `rules` — deterministic categorization rules with explicit `precedence`;
  see "Rule precedence" below.
- `savings_goals` — one goal per linked account (see build brief §9); the
  schema allows multiple goal rows but enforces at most one *targeting the
  same account* via a unique index, rather than pretending one account
  balance belongs to several simultaneous goals.
- `exchange_rates` — local cache of historical FX rates, keyed by
  (base currency, quote currency, *requested* date — see `src/lib/currency/rates.ts`),
  with `isExactDate` marking a nearest-available fallback versus an exact
  match. Populated by `src/lib/currency/convert.ts`'s
  `resolvePendingConversions()`, never read or written directly by import or
  UI code.
- `audit_log` — every manual/rule-driven change to a classified or edited
  field, with before/after values and the change's source.
- `error_log` — structured diagnostics (see `src/lib/logging/`).

## Rule precedence

Rules are evaluated in ascending `precedence` order (lower number = applied
first / wins). Ties are broken by `createdAt` ascending (the older rule
wins) — and if two rules with the *same* precedence and *different*
`createdAt` would both match a transaction and disagree on the result, the
transaction is flagged `conflicting_rules` for review rather than silently
picking one. See build brief §8.

## Sign convention

Every amount stored in this app — `originalAmount` and `eurAmount` alike —
follows one convention regardless of which institution it came from:
**negative = money left this account, positive = money entered it.**

Most bank exports already print amounts this way (ABN AMRO, Chase). Some
don't — EU Amex's "Bedrag" column is positive for a purchase/charge, the
opposite of this convention — and their adapters flip the sign on the way
into `NormalizedRow` so the canonical model stays consistent everywhere
downstream (analytics, the transaction table, transfer matching all get to
assume one convention rather than special-casing each institution). This is
a deliberate normalization, not data loss: the untouched, as-printed value
is always still available in that transaction's `originalRowJson`. See the
comment in `src/lib/import/adapters/amexEu.ts` for the specific reasoning.

## Financial calculations (defined as each phase implements them)

- **Duplicate fingerprint** (`src/lib/duplicates/fingerprint.ts`, Phase 1):
  SHA-256 of the institution transaction id + account (when available),
  otherwise of account + date + amount (2dp) + currency + a normalized
  description (lowercased, accents stripped, punctuation collapsed, capped
  at 80 characters to avoid noisy long remittance text producing spurious
  mismatches).
- **Duplicate matching** (`src/lib/duplicates/detector.ts`, Phase 2): exact
  fingerprint match against already-committed transactions on the *same
  account*. Computed twice per row during an import — once for the preview
  (informational, using whatever account the row would resolve to) and
  again at commit time against the final resolved account (authoritative).
- **Transfer suggestion** (`src/lib/transfers/detector.ts`): an existing
  transaction on a *different* account, with a EUR amount within €0.01 of
  the negated candidate amount, dated within 3 days either direction, not
  already a confirmed transfer. Both amounts must already have a resolved
  EUR value (a transaction still pending currency conversion is never
  guessed into a transfer match — `resolvePendingConversions()` re-runs this
  detector once a pending amount resolves, see below). This gate is
  unchanged from Phase 2 and intentionally narrow; Phase 4 adds only a
  tie-break — when more than one existing transaction matches it, the one
  whose extracted merchant matches a household member's name (or has no
  merchant at all, typical of a plain self-transfer) is preferred over one
  with an unrelated merchant name that happens to share the amount and date
  — see README "How duplicate and transfer detection work".
- **Currency conversion** (`src/lib/currency/`, Phase 4): EUR needs no
  conversion; a source-statement-provided EUR figure is trusted outright; a
  synchronous local-cache lookup (`rates.ts`'s `getCachedRate`, keyed by
  exact currency+date) is the only conversion import itself can do, since a
  commit runs inside one synchronous database transaction and can never make
  a network call mid-import. Anything not already cached stays
  `conversionStatus: 'pending'` until the manual "resolve pending currency
  conversions" action (`convert.ts`'s `resolvePendingConversions`) fetches
  it from the configured `ExchangeRateProvider` (retried twice with a short
  backoff on transient failure), caches it, and updates every transaction it
  can now resolve — marking `estimated` rather than `exact` when the
  provider had to fall back to the nearest earlier date with a published
  rate. See README "How currency conversion works" for the production
  provider and its verification status.
- **Credit-card settlement categorization** (Phase 2, `adapters/amexEu.ts`
  + `importPipeline.ts`): a row the adapter identifies with high confidence
  as a card payment (matched against the statement's own "thank you for
  your payment" text, not a heuristic) is stored with `direction:
  'transfer'`, category "Internal transfer", priority "Excluded /
  transfer", and `ownershipType: 'shared'` immediately at import time —
  skipping the review queue entirely, because this is a known fact from the
  statement's own text rather than a guess.
- **Review status** (`src/lib/categorization/reviewStatus.ts`, Phase 3): the
  single function every write path (import, rule application, manual edit,
  transfer confirm/reject) calls to recompute `reviewStatus`/
  `reviewReasonsJson` — a transaction is `needs_review` if it has no
  category, no owner, a `suggested` transfer, a `pending` conversion, or a
  rule conflict, and `ok` otherwise. Centralizing this means "why is this in
  the review queue" never has a path-dependent answer.
- **Rule application — import time vs. "apply historically"**
  (`src/lib/categorization/apply.ts`, Phase 3): at import, rules are matched
  once per newly-inserted row against the currently active rule set. "Apply
  historically" (rule-management page, or the "create a rule for past and
  future" correction option) re-runs the same `findApplicableRule` logic
  against every existing transaction and updates the ones this rule wins
  outright; one that would create a fresh conflict with another
  equal-precedence active rule is left untouched and reported separately,
  never resolved by guessing. Every change either path makes is written to
  `audit_log` with `changeSource: 'rule'`.
- **Manual transaction edits** (`src/lib/transactions/edit.ts`, Phase 3):
  category/priority/owner edits (single or bulk) clear `appliedRuleId` on
  the affected rows, since crediting a rule for a value a person just
  overrode by hand would misrepresent why the transaction looks the way it
  does. Every change is written to `audit_log` with `changeSource:
  'manual'`.
- **Household totals, monthly trend, category breakdown**
  (`src/lib/analytics/summary.ts`, Phase 5): a row counts toward
  income/expense totals only if `eurAmount` is resolved (not `null`),
  `direction !== 'transfer'`, and its priority isn't "Excluded / transfer"
  — the same set the transfer/settlement bullets above describe as
  excluded. `computeMonthlyTrend` sums the last N calendar months ending at
  the most recent month with any counted data (not wall-clock "today" —
  see README "How the dashboard works"), including zero-activity months so
  a quiet month isn't skipped from the chart. `computeCategoryBreakdown` is
  expense-only, grouped by category for one month, sorted descending, and
  capped to the top `topN - 1` categories plus one combined "Other" slice.
  All three are pure functions over `analytics/queries.ts`'s
  `listAnalyticsRows()` output, so the math is unit-tested
  (`tests/analytics.test.ts`) without a database.
- **Savings-goal progress** (`src/lib/analytics/savingsGoals.ts`, Phase 5):
  `startingBalanceEur` (as of `startingBalanceAsOf`) plus the sum of every
  resolved-EUR transaction on the linked account from that date forward,
  clamped to `[0, 1]` as a fraction of `targetBalanceEur`. This is a
  placeholder for real running-balance tracking (see the "Account balance"
  known limitation in the README) — a reversible approximation, not a
  guess, since it's built entirely from the account's actual transaction
  history plus one explicit starting point.
