# Carera's Cash Flow

A calm, local-first household finance dashboard for a two-person household. It
imports CSV/Excel statements from multiple banks, normalizes everything to
EUR, helps you categorize and review spending, tracks a savings goal, and
shows long-term trends — without a bank connection, a cloud account, or a
subscription.

**Status: all 6 planned phases are complete** (Foundation, Reliable import,
Classification, Currency and transfers, Dashboard, Resilience). See
[Implementation phases](#implementation-phases) below for what each phase
delivered and the honest list of [known limitations](#known-limitations)
that remain even so — "complete" means the planned scope is built and
tested, not that there's nothing left to improve.

## Product purpose

1. Help the household meet a customizable savings goal.
2. Help understand and reduce discretionary spending.
3. Make financial conversations calmer, clearer, and less judgmental —
   neutral language, no shame-based framing, no ranking the two of you
   against each other.
4. Make importing statements once or twice a month quick and dependable.
5. Preserve historical knowledge and categorization rules across uploads.
6. Make errors easy to locate, understand, and fix.

Direct bank connections are explicitly out of scope for this version — all
data enters the app through reviewed, previewable file imports.

## Architecture overview

TypeScript throughout. Next.js (App Router) for the interface, a local
SQLite database via `better-sqlite3`, Drizzle ORM as the typed database
access layer, Zod for strict schema validation at every trust boundary, and
Recharts for charts (added in the dashboard phase). Vitest for unit and
integration tests.

Code is organized by concern, not by page, so a bank-format quirk or a
currency edge case is fixed in exactly one place:

```
src/lib/
  db/            Database connection, Drizzle schema, and query layer.
                 UI code should go through queries.ts, not raw schema access.
  domain/        Zod schemas and TypeScript types for the canonical
                 transaction model and shared enums.
  import/        File inspection (CSV/Excel), institution adapters, the
                 import pipeline (preview -> validate -> commit -> undo).
  duplicates/    Duplicate fingerprinting and DB matching.
  transfers/     Internal transfer suggestion logic — the Phase 2 amount/
                 date gate, plus Phase 4's counterparty-aware tie-break
                 when more than one transaction matches it (detector.ts).
  currency/      Exchange-rate provider interface + the production
                 Frankfurter-based implementation (provider.ts), the local
                 rate cache with retry (rates.ts), and the synchronous
                 import-time resolver plus the async "resolve pending
                 conversions" step (convert.ts).
  categorization/Deterministic rule matching (rules.ts), review-status
                 computation shared by import/rules/manual edits
                 (reviewStatus.ts), and rule CRUD + "apply historically"
                 (apply.ts).
  settings/      Category, priority, and household-member CRUD — archive
                 only, never hard-delete (mutations.ts).
  transactions/  Manual single/bulk transaction edits and transfer-
                 suggestion confirm/reject (edit.ts).
  audit/         Single write path to the audit_log table (log.ts) — every
                 mutation above goes through this so the audit trail can't
                 drift out of sync with what actually changed.
  analytics/     Dashboard totals, monthly trend, and category-breakdown
                 math (summary.ts) as pure, DB-free functions over plain
                 rows fetched by queries.ts — see "How the dashboard works"
                 below. Savings-goal progress lives alongside it
                 (savingsGoals.ts).
  logging/       Structured error codes (errors.ts) and the logger that
                 writes them to the error_log table (logger.ts) — read back
                 by src/lib/diagnostics/queries.ts for the /diagnostics
                 page. See "How diagnostics, backup, and restore work".
  diagnostics/   Read-only stats/log queries (queries.ts), the sanitized
                 log export (export.ts), and the shared backup-file
                 validation (restoreValidation.ts) used by both the
                 /diagnostics upload flow and scripts/restore.ts.
  auth/          The opt-in shared-password session (session.ts) and a
                 best-effort login rate limiter (rateLimit.ts) — see
                 "Deploying (remote hosting)" below.
scripts/         db:migrate, db:seed, db:restore — see "Commands" below.
src/app/         Next.js pages, layouts, server actions, and the two
                 backup/export route handlers under app/api/diagnostics/.
                 Each area's UI talks to the database only through its own
                 actions.ts (import/actions.ts, settings/actions.ts,
                 rules/actions.ts, transactions/actions.ts,
                 diagnostics/actions.ts, login/actions.ts) — pages and
                 components never import src/lib/db or src/lib/*/mutations
                 directly.
src/proxy.ts     The auth gate — Next.js 16's replacement for
                 middleware.ts, runs before every page/API route except
                 /login and /api/health.
src/components/  UI components.
tests/           Vitest unit/integration tests; tests/fixtures/ holds
                 synthetic per-institution sample files (never real
                 statements — see "Testing").
e2e/             The one real-browser Playwright test (npm run test:e2e) —
                 import a statement, correct a transaction, confirm the
                 dashboard reflects it. Runs against its own disposable
                 database (e2e/setup.ts), never data/carera-cashflow.db.
Dockerfile,      Container build and Railway deploy config — see
railway.json     "Deploying (remote hosting)" below.
```

Institution-specific parsing never lives in a UI component. Each bank has a
dedicated adapter (`src/lib/import/adapters/*`) that converts its native
export format into the single canonical transaction shape defined in
`src/lib/domain/transaction.ts`. Adding a new institution means adding one
new adapter file and registering it in `adapters/registry.ts` — nothing else
in the import pipeline changes.

## Canonical transaction model

The full field list and the reasoning behind it (e.g. why account display
name is joined rather than duplicated on every row) lives in
[`docs/schema.md`](./docs/schema.md). The authoritative definition is the
Drizzle schema in `src/lib/db/schema.ts` plus the Zod validation schema in
`src/lib/domain/transaction.ts` — every row written to `transactions` must
satisfy `NormalizedRowSchema` before database IDs and derived fields
(duplicate fingerprint, currency conversion, categorization) are attached.

## Setup

Requirements: Node.js 20.9+ and npm.

```bash
npm install
npm run db:migrate   # creates/updates the local SQLite database
npm run db:seed      # populates synthetic sample data (skips if data already exists)
npm run dev           # http://localhost:3000
```

`npm run dev` runs pending migrations automatically before starting the
server, so day-to-day you only need `npm install` once and `npm run dev`
after that.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Applies migrations, then starts the local dev server. |
| `npm run build` / `npm run start` | Production build and start, for a faster local server. |
| `npm run db:generate` | Regenerates SQL migrations from `src/lib/db/schema.ts` after a schema change. |
| `npm run db:migrate` | Applies pending migrations. Safe to run repeatedly. |
| `npm run db:seed` | Seeds synthetic sample data. Refuses to run if the database already has transactions. |
| `npm run db:reset` | **Destructive.** Wipes all data and reseeds synthetic sample data. Local dev only. |
| `npm run db:restore -- <path>` | **Destructive.** Finishes a restore staged from `/diagnostics`. Run with the app stopped — see "How diagnostics, backup, and restore work". |
| `npm test` | Runs the Vitest test suite once. |
| `npm run test:watch` | Runs tests in watch mode. |
| `npm run test:e2e` | Runs the Playwright end-to-end test against its own disposable database. |
| `npm run lint` | ESLint. |

## Database location

A single SQLite file at `./data/carera-cashflow.db` (plus its WAL/SHM
sidecar files while the app is running). Override the path with the
`CARERA_DB_PATH` environment variable — used by the test suite to keep tests
isolated from your real data. The `data/` directory is gitignored; your
financial data never gets committed to version control.

## Deploying (remote hosting)

Running this on `localhost` needs nothing beyond "Setup" above. This
section is for when you want to reach it from your phone or another
device away from home — that changes the security picture, so read
"Before you expose this to the internet" first even if you skip everything
else.

### Before you expose this to the internet

**This app ships with no login by default.** That's fine on `localhost` —
nothing outside your own machine can reach it — but the moment it's
reachable from the internet, anyone with the URL can see every transaction
in the database. Set both of these environment variables before deploying
anywhere reachable off your own machine:

- `APP_PASSWORD` — a shared household password. Pick something you'd
  actually be comfortable typing on a phone; it's checked with a
  constant-time comparison (`src/lib/auth/session.ts`) and rate-limited to
  5 attempts per 5 minutes per source IP (`src/lib/auth/rateLimit.ts`).
- `SESSION_SECRET` — a long random string used to sign the login session
  cookie (HMAC-SHA256, `src/lib/auth/session.ts`). Generate one with
  `openssl rand -hex 32` or similar. If this leaks, an attacker can forge a
  session without knowing `APP_PASSWORD`; treat it like a password.

Leaving `APP_PASSWORD` unset disables the login entirely (`src/proxy.ts`
lets every request through) — this is the local-dev default, not something
to carry into a public deployment. There is deliberately no third
option here (no per-page opt-out, no "just protect the dashboard") — every
page and API route is behind the same gate once `APP_PASSWORD` is set,
including the backup-download and diagnostics-export endpoints, which are
exactly the ones most worth protecting.

Logging in sets an HTTP-only, `secure`, `sameSite=lax` cookie for 30 days
— long enough that a household member's phone doesn't need to re-log-in
every visit, short enough that it isn't forever. There's a "Log out" link
in the nav (desktop) or mobile menu once auth is enabled.

### Why not Vercel or another serverless host

This app uses `better-sqlite3` — a single SQLite file on disk, accessed by
a long-running Node.js process. Serverless platforms (Vercel, Netlify
Functions, and similar) give each request an ephemeral or read-only
filesystem and no guarantee the same instance handles the next request —
both break a design that assumes one process holds one open connection to
one file. This app needs a host that runs a persistent Node.js server
with a persistent disk, not a serverless one.

It also needs to run as **exactly one instance**. WAL-mode SQLite (see
`src/lib/db/client.ts`) assumes a single writer; two instances of this app
writing to the same database file — whether from manual horizontal
scaling or a rolling deploy briefly running old and new versions
side-by-side — risks corrupting it. Whatever host you choose, don't turn
on multi-replica/autoscaling for this service.

### Deploying to Railway

Railway was chosen for this app specifically: a persistent volume for the
SQLite file, GitHub-connected auto-deploy with almost no CLI work, and a
single-instance-by-default model that matches the constraint above. (Render
is a solid second choice with a similar model; see the note at the end of
this section.)

1. Push this repository to GitHub if it isn't already there.
2. Create a Railway account and, from the dashboard, "New Project" → "Deploy
   from GitHub repo" → select this repository. Railway will detect the
   `Dockerfile` and `railway.json` in the repo root and build from those
   automatically — no build configuration to fill in by hand.
3. Before the first deploy finishes successfully, add a **volume**: in the
   service's Settings → Volumes, create one and mount it at `/data`. This
   is what makes your data survive a redeploy or restart — without it,
   every deploy would start from an empty database.
4. Add environment variables (service Settings → Variables):
   - `CARERA_DB_PATH` = `/data/carera-cashflow.db`
   - `APP_PASSWORD` = (your chosen household password)
   - `SESSION_SECRET` = (output of `openssl rand -hex 32`)
   - `NODE_ENV` = `production`
5. Generate a public domain for the service (Settings → Networking →
   "Generate Domain") — Railway provides free HTTPS on this automatically.
6. Redeploy (or it will redeploy automatically once the variables and
   volume are saved). Visit the generated URL — you should land on the
   login page. `GET /api/health` (used by Railway's own health check,
   `railway.json`) is intentionally reachable without logging in; every
   other route is not.
7. The very first thing to do once you're in: go to `/diagnostics` and
   download a backup, just to confirm the whole flow works end to end
   before you rely on this for real data.

**Seeding or restoring data on first deploy.** A fresh Railway deploy
starts with an empty (but migrated) database — same as a fresh local
install. Two ways to get real data onto it: import your bank statements
normally through `/import` once it's live, or restore a backup you already
made locally. Restoring needs the CLI script run against the *live*
container, which means using Railway's own shell access to that container
(from the service page: the "⋮" menu → "Shell", or `railway shell` via
their CLI if you do end up wanting the CLI for anything) rather than your
own machine's terminal, since the volume only exists inside that
container. See "How diagnostics, backup, and restore work" above for what
the restore script itself does.

**A note on verification.** This Dockerfile and Railway configuration were
written and reasoned through carefully, but this development environment
has no Docker daemon available to actually run `docker build` against —
so, honestly, the image itself is unverified the same way the Chase
adapter and the live Frankfurter API call are (see "Known limitations").
Railway will build it fresh from source on its own infrastructure on
first deploy, which is the real test. If that build fails, the error in
Railway's deploy log is the place to start.

**Render as an alternative:** same shape (connect the GitHub repo, it
builds from the same `Dockerfile`, attach a persistent disk, set the same
three environment variables), with a similarly point-and-click setup —
worth trying if Railway's usage-based pricing feels unpredictable for
your usage. Render's free tier isn't suitable here (it sleeps when idle,
and persistent disks require a paid instance type).

## Backup and restore

See "How diagnostics, backup, and restore work" below for the full
in-app flow. Short version: download a backup any time from
`/diagnostics` (safe while the app is running); restoring needs the app
stopped and finishes with `npm run db:restore -- <path>`.

## Data privacy and security limitations

Stated plainly, per the project's own ground rules — no vague "your data is
secure" claims:

- All data stays on your machine in a local SQLite file. Nothing is sent to
  any analytics service, ad network, or AI service by default.
- **The database file is not encrypted at rest.** Anyone with access to your
  filesystem (or an unencrypted backup of it) can read it. If you need
  encryption at rest, use full-disk encryption on the machine this runs on.
- The dev server binds to localhost only; there is no built-in mechanism to
  expose it to your network, and you should not add one without
  understanding the exposure.
- Uploaded files are validated before parsing — a 25 MB size cap and a
  50,000-row-per-sheet cap (`src/lib/import/fileInspector.ts`), rejected
  with a specific error rather than silently truncated — but the
  Excel-parsing library used for `.xls`/`.xlsx` imports (`xlsx` a.k.a.
  SheetJS) has known, currently-unpatched advisories in its npm release
  (prototype pollution, ReDoS — see `npm audit`). The threat model here is
  low (you are only ever parsing your own household's bank statements, not
  attacker-supplied files), but this is a real, acknowledged limitation,
  not a hypothetical one, and those size/row caps are the mitigation until
  an unaffected release is available through the npm registry.
- Logs (see `error_log` table / the `/diagnostics` page) never contain full
  transaction descriptions, merchant names, notes, or raw imported rows —
  only identifiers (batch id, row number, account id, error code).
- A downloaded backup (`/diagnostics` → "Download a backup") is a complete,
  unencrypted copy of every transaction — treat the file itself with the
  same care as the live database once it leaves the app (see the
  full-disk-encryption note above). A file staged for restore
  (`data/pending-restore/`) sits on disk unencrypted too, the same as
  `data/carera-cashflow.db` itself, until you either finish the restore or
  run "Discard staged file(s)" from `/diagnostics`.

## How CSV/Excel adapters work

An adapter (`src/lib/import/adapters/*.ts`) takes a generically-parsed file
(`InspectedFile` — a grid of cells per sheet, produced by
`fileInspector.ts` from either CSV or Excel input) and turns each row into
either a `NormalizedRow` or an explained failure. Adapters never touch the
database and never import UI code — see `adapters/types.ts`.

Real (redacted) sample exports were provided for ABN AMRO (checking +
savings) and EU American Express, and both adapters were built and tested
against them — not just against synthetic fixtures. Two things learned from
those real files shaped the design in ways worth knowing about:

- **ABN AMRO checking and savings share one file format and one adapter**
  (`adapters/abnAmro.ts`). A single "download transactions" export can (and
  in the real samples, did) mix rows from several accounts of different
  types together. There's no separate file format to detect between
  "checking" and "savings" — instead, each row is classified by content
  (ABN AMRO's own interest-posting language, e.g. rows starting with
  "ACCOUNT BALANCED" or "Basic interest", is a reliable signal that
  particular row belongs to a savings account; its absence just means
  "no evidence either way," not "definitely checking" — see the code
  comment on `looksLikeSavingsRow` for a real false-positive this avoids).
- **EU Amex is a multi-sheet `.xlsx`, and its "account" is a shared card**
  (`adapters/amexEu.ts`). The transaction detail lives on a specific sheet
  among several; the file's header block states one card number shared by
  every row even when a per-row column shows a different physical card
  number (a household's supplementary cardholders). The per-row cardholder
  name is surfaced as a suggested owner, not a hard assumption.

No Chase sample has been provided yet, so `adapters/chaseUs.ts` is built and
tested only against a synthetic fixture shaped like Chase's publicly
documented CSV export, and is clearly labeled **unverified** in the import
UI (both in the detected-format badge and by never returning full detection
confidence) until a real export can be checked against it.

## How to add another institution

1. Add a new file under `src/lib/import/adapters/` implementing
   `InstitutionAdapter` (see `adapters/types.ts`): a `detect()` that
   recognizes the file's column headers, and a `parse()` that turns rows
   into `NormalizedRow`s or explained `issue`s.
2. Register it in `adapters/registry.ts`'s `ADAPTERS` array.
3. Add a synthetic fixture under `tests/fixtures/<institution>/` (see
   `tests/fixtures/generate.ts` for how the existing ones were built) and
   adapter tests in `tests/adapters.test.ts`.

Nothing in `importPipeline.ts`, the preview UI, or the database schema needs
to change — that's the point of the adapter boundary.

## How currency conversion works

A transaction whose native currency is EUR needs no conversion
(`conversionStatus: 'exact'`, `eurAmount = originalAmount`). A transaction in
any other currency (currently only Chase's USD) resolves through, in order:

1. **The source statement's own EUR figure**, when a bank export states one
   directly (`providedEurAmount`/`providedExchangeRate` on `NormalizedRow`) —
   the file's own numbers always win over a fetched rate.
2. **The local rate cache** (`exchange_rates` table, `src/lib/currency/rates.ts`)
   — a synchronous, network-free lookup for that exact (currency, date) pair.
   This is the only conversion path import itself can take: a commit runs
   inside one synchronous database transaction (see `importPipeline.ts`'s
   comment on why), so a network call can never happen mid-import.
3. **A manual "Resolve pending currency conversions" step** — a button on
   the Review queue and Import history pages, wired to
   `resolvePendingConversions()` (`src/lib/currency/convert.ts`). It collects
   every distinct (currency, date) still needed across every `pending`
   transaction, fetches each one from the configured `ExchangeRateProvider`
   (retrying transient failures twice with a short backoff), caches whatever
   it gets, and updates every transaction it can now resolve in one pass —
   including re-running transfer detection on each one, since a transfer
   match against a still-pending amount is something the detector explicitly
   refuses to guess at.

A transaction the provider has no rate for (yet) simply stays
`conversionStatus: 'pending'`, `eurAmount: null`, flagged `missing_conversion`
in the review queue — see build brief §6 ("do not lose the uploaded data...
place it in a review/pending-conversion state"). **No transaction is ever
silently converted using today's exchange rate** — a rate is always looked
up for the transaction's own date, and if the provider had to fall back to
the nearest earlier date with a published rate (a weekend or holiday), that
transaction is marked `conversionStatus: 'estimated'` rather than `'exact'`
so the distinction stays visible everywhere the amount is shown.

The production provider (`FrankfurterProvider`,
`src/lib/currency/provider.ts`) calls
[Frankfurter](https://www.frankfurter.app), a free, no-API-key, ECB
reference-rate service — chosen because it's exactly EUR-denominated, which
is all this app ever converts to. **Documented limitation:** this
development sandbox has no general internet access (only the npm registry is
reachable — the same constraint noted for the unverified Chase adapter), so
`FrankfurterProvider` could not be exercised against the real API from here.
It's built against Frankfurter's publicly documented response shape and is
unit-tested against a fake provider (`tests/currency.test.ts`) that exercises
the caching, retry, and never-guess-on-failure logic deterministically — the
one thing a real HTTP call couldn't give tests anyway. It should work
unmodified on a household's own machine, which has normal internet access,
but the live HTTP call itself is unverified the same way the Chase adapter
is, until someone runs it for real. Failure is designed to fail closed: if
the response shape has drifted, a transaction just stays `pending` rather
than getting a wrong or guessed rate.

**Sign convention**, decided in Phase 2 and documented here since it isn't
obvious from any single bank's export: every amount in this app — original
and EUR alike — is stored as *negative = money left this account, positive
= money entered it*, regardless of how the source institution encodes it.
ABN AMRO and Chase already print amounts this way. EU Amex's own "Bedrag"
column is the opposite (positive = a purchase/charge), so `adapters/amexEu.ts`
flips its sign on the way into the canonical model — the untouched printed
value is still fully preserved in that transaction's raw row
(`originalRowJson`). See `docs/schema.md` "Sign convention" for the full
reasoning.

## How duplicate and transfer detection work

**Duplicates.** `src/lib/duplicates/fingerprint.ts` computes a stable hash
of account + date + amount + currency + a normalized description, or of the
institution's own transaction id when the source provides one (preferred —
stable even if remittance text is reformatted between two exports of the
same transaction). `src/lib/duplicates/detector.ts` matches that fingerprint
against already-committed transactions on the same account during both
preview (informational) and commit (authoritative — recomputed against the
final resolved account, independent of whatever preview guessed). A
duplicate is never silently dropped: it's logged in `import_row_issues` with
which existing transaction it matched and why, visible from each import
batch's detail page.

**Transfers.** `src/lib/transfers/detector.ts`'s core gate is unchanged from
Phase 2 and deliberately narrow: an opposite-signed EUR amount on a
*different* account within 3 days. A transfer this misses just stays a
normal transaction (safe); the tolerance stays tight on purpose rather than
being loosened to catch more automatically — false negatives are safe here
(the household still sees and can manually confirm it from the review
queue), false positives would not be. This gate is why currency conversion
had to land first: comparing amounts "fairly" across a EUR account and a USD
account only makes sense once the USD side has a resolved EUR amount, which
is also why `resolvePendingConversions()` re-runs this detector for every
transaction it just resolved (see "How currency conversion works" above).

Phase 4 adds one refinement on top of that gate: when more than one existing
transaction matches it (rare — two same-amount transfers within the same
window), the detector picks the most plausible one using a
household-name/counterparty signal (a candidate whose extracted merchant
name matches a household member, or has no merchant at all — typical of a
plain self-transfer — beats one with an unrelated third-party merchant name
that just happens to share the amount and date) instead of just the first
row a query happens to return, and says so in the explanation shown when
reviewing the suggestion. This never changes *whether* something gets
suggested, only *which* candidate wins when there's more than one — nothing
here is ever auto-confirmed; the household always sees the match and
confirms or rejects it from the review queue or transaction table.

**Credit-card settlements are handled separately and more confidently.**
Amex's own statement text ("HARTELIJK BEDANKT VOOR UW BETALING" / "thank you
for your payment") identifies a card-payment row unambiguously — that's not
a heuristic guess, so `adapters/amexEu.ts` marks it `direction: 'transfer'`
directly, and the import pipeline categorizes it as "Internal transfer" /
"Excluded / transfer" immediately rather than leaving it in the review
queue. Confirmed transfers and settlements stay visible in the account's
own history but are excluded from household income/expense totals wherever
those are computed — see "How the dashboard works" below.

## How classification works

**Categories, priorities, and household members** (`/settings`) are fully
editable. "Delete" in the settings UI always means archive
(`src/lib/settings/mutations.ts`): an archived category disappears from
pickers but every transaction that already used it keeps that categorization
exactly as it was. Nothing outside the seed data (`Uncategorized`, `Internal
transfer`, etc.) is protected from renaming — the household's own vocabulary
is meant to win.

**Rules** (`/rules`, `src/lib/categorization/rules.ts`) are a plain,
inspectable AND-of-conditions → set-of-effects mapping — never an opaque
guess. Every rule is evaluated in ascending precedence order (lower number
first); when two *active* rules share the same precedence and would
categorize a transaction differently, that transaction is left
`needs_review` with reason `conflicting_rules` rather than silently picked
one way (`findApplicableRule`). A rule can be created from scratch on the
Rules page (with a live "would match N existing transactions" preview before
saving), edited, disabled (reversible), or deleted — hard delete is refused
with an explanation if any transaction still credits that rule as the reason
it was categorized, since that would break a foreign key the audit trail
depends on; disabling is the reversible alternative offered instead.
"Apply historically" (`applyRuleHistorically`) runs a saved rule against
every existing transaction it unambiguously wins and updates them
immediately — a transaction that would become a new conflict between two
active rules is left untouched and counted separately, never resolved by
guessing.

**The review queue and transaction table are both interactive
now** (`/review`, `/transactions`) — inline dropdowns change a row's
category, priority, or owner, and a `possible_transfer` suggestion can be
confirmed (linking both sides as an internal transfer) or rejected (clears
the flag, leaves everything else alone) directly from the table. Changing a
single row's category/priority/owner opens a three-way prompt, per the
build brief: apply the change to just that transaction, to every other
transaction in the *same import* with the same merchant, or turn it into a
standing rule that also reaches backward and applies to every existing
match immediately ("past and future"). Selecting several rows first and
using the bulk toolbar skips that prompt and applies directly, since
selecting the rows *is* how the household already chose the scope.

Every classification change — from import-time rule application, a manual
edit, or "apply historically" — is written to `audit_log`
(`src/lib/audit/log.ts`) with what changed, from what, to what, and why
(`changeSource`: `rule`, `manual`, or `imported`). A manual edit to
category/priority/owner also clears that transaction's `appliedRuleId`,
since crediting a rule for a value the household just overrode by hand
would be misleading.

**Documented assumption:** applying a rule historically (either from the
Rules page or via "create a rule for past and future") overwrites the
matching fields on every transaction it wins against, even ones a person
already set by hand — there's no "manually locked" flag in this version.
This is the simplest reversible option available (every prior value is still
visible in `audit_log`), chosen over building a full manual-override-lock
system for an MVP household of two. If this turns out to be surprising in
practice, the fix is a `locked` per-field flag on `transactions`, not a
change to the rule engine itself.

## How the dashboard works

The home page (`src/app/page.tsx`) is deliberately simple and colorful
rather than dense — three big "Money in / Money out / Left over" stat
cards, a 6-month income-vs-spending bar chart, a spending-by-category
donut for the current month, and a progress bar per active savings goal.
The goal was to make the household's position readable at a glance without
needing to interpret a table, per the brief's "calm, non-judgmental" tone.

The math is split from the database on purpose:
`src/lib/analytics/queries.ts` has the *only* dashboard query
(`listAnalyticsRows()`), returning every transaction unfiltered — even
transfers and pending-conversion rows — joined with its category and
priority name. `src/lib/analytics/summary.ts` then does the actual totals,
trend, and category-breakdown math as pure functions over that plain array
(`computeHouseholdSummary`, `computeMonthlyTrend`,
`computeCategoryBreakdown`), so the logic is unit-testable
(`tests/analytics.test.ts`) without touching SQLite at all.

A transaction counts toward income/expense totals only if it has a
resolved EUR amount, isn't `direction: 'transfer'`, and isn't tagged
"Excluded / transfer" — the same exclusion described in "How duplicate and
transfer detection work" above. A transaction still waiting on currency
conversion is never guessed into a total; it's left out and counted
separately, and the dashboard says so ("N transactions still waiting on a
currency conversion") rather than silently under-reporting spending.

The trend chart shows the 6 calendar months ending at the most recent
month that actually has counted data — not necessarily "this month" by the
system clock, since a local-first app's last import might be a few weeks
old and an all-zero "current month" would read as alarming rather than
calm. Months with no transactions still appear, at zero, so a quiet month
isn't silently skipped from the chart.

The category donut caps itself to the top 5 categories plus a combined
"Other" slice (`computeCategoryBreakdown`'s `topN` parameter, default 6) —
a pie chart with fifteen slivers works against "idiot proof," not for it.

Savings-goal progress (`src/lib/analytics/savingsGoals.ts`) is described
in that file's header comment: since the app doesn't yet track a running
account balance from statement balance columns, a goal's current balance
is the goal's own starting balance/date plus every resolved-EUR
transaction on the linked account since then — see "Known limitations"
below.

**Filters.** The filter bar above the stat cards (`DashboardClient.tsx`)
has three controls: whose spending ("Everyone" or one household member —
selecting a member keeps their own transactions plus every shared one,
since shared spending is relevant to both people, via
`filterByMember` in `summary.ts`), which month the stat cards/donut show
(defaults to the latest month with data; `listAvailableMonths` only offers
months that actually have counted data), and how many months the trend
chart covers (3/6/12). All three are client-side state over data already
fetched for the page load — the same "fetch once, filter in the browser"
pattern `TransactionTable` already used, appropriate at a two-person
household's data volume. Changing the member resets the month selection
back to "latest," since a member's own data may not cover the same months
as the household total.

## How diagnostics, backup, and restore work

**Diagnostics** (`/diagnostics`, `src/lib/diagnostics/queries.ts`) shows
row counts for every table, the database file's size and path, whether
pending migrations need to be applied (compares the `__drizzle_migrations`
bookkeeping table against `drizzle/meta/_journal.json`), and the
structured error/activity log — filterable by severity, each entry
expandable for its operation, category, root cause, and sanitized context.
Nothing shown here, on-screen or in the "download sanitized export" link,
includes a transaction amount, merchant, or description: `logger.ts`
strips those (`SENSITIVE_KEYS`) at write time, before a log entry ever
reaches the database, and the export additionally drops JS stack traces
(which can contain local file paths) on top of that.

**Backup** is one click from `/diagnostics` — "Download a backup" hits
`GET /api/diagnostics/backup`, which uses better-sqlite3's native
`.backup()` (not a plain file copy) to produce one consistent snapshot
file even though the app runs with `journal_mode = WAL`, without stopping
the server or disturbing the live connection other pages are using at the
same moment.

**Restore is deliberately two steps, not one button**, because of a real
constraint: the app holds one long-lived SQLite connection for its whole
process (`src/lib/db/client.ts`), and swapping the underlying file out
from under that open connection while it might be mid-write is exactly
the kind of thing that corrupts a database. So the in-app half
(`src/app/diagnostics/actions.ts`) only validates an uploaded file —
`PRAGMA integrity_check` plus a check that the app's core tables are
present (`restoreValidation.ts`, shared with the CLI so the two can't
drift apart on what counts as valid) — and stages it under
`data/pending-restore/`. Finishing the restore is a CLI script run with
the app stopped: `npm run db:restore -- <staged path>`
(`scripts/restore.ts`), which copies the *current* database aside to
`data/backups/` first (so a restore is itself undoable), then swaps in the
validated file and clears any stale `-wal`/`-shm` sidecar files. The
script prints a reminder to run `npm run db:migrate` afterward, in case
the backup predates a schema change in the current checkout.

## How to inspect errors

The structured error/diagnostics log (`error_log` table, `CareraError`,
`logError`) is written throughout the app (`src/lib/logging/`) and
surfaced at `/diagnostics` — see "How diagnostics, backup, and restore
work" above. You can also inspect `data/carera-cashflow.db`'s `error_log`
table directly with any SQLite client if you'd rather query it yourself.

## Testing

`npm test` runs the Vitest suite (unit tests plus database-backed
integration tests, each integration test file using its own throwaway
SQLite file). Test fixtures use synthetic data only — `tests/fixtures/`
holds small, fake CSV/Excel files shaped like real bank exports (same
headers/format quirks, generated by `tests/fixtures/generate.ts`) but with
invented amounts and merchants. No real personal financial data is ever
committed to this repository — adapters were additionally verified by hand
against real (redacted) sample files that never left the local working
environment and are not part of this repo.

Current coverage includes: each adapter against its fixture (decimal
comma/point, thousands separators, YYYYMMDD and MM/DD/YYYY dates, malformed
rows quarantined rather than guessed), multi-account files, the savings-vs-
checking classification heuristic (including a regression test for a real
false-positive it used to produce), duplicate detection on an overlapping
statement, credit-card payment-settlement exclusion, cardholder-based
ownership suggestion, undoing an import batch without touching other
batches, the rule-matching engine's precedence/conflict logic, category and
rule create/rename/archive/delete-guard behavior, "apply rule historically"
(including the conflict-skip path), manual single/bulk transaction edits,
transfer-suggestion confirm/reject, exchange-rate caching/retry/failure
behavior against a fake provider, the import-time synchronous conversion
resolver, `resolvePendingConversions()` end-to-end (including re-triggered
transfer detection), the transfer detector's counterparty tie-break, the
dashboard's monthly-trend/household-summary/category-breakdown math
(`tests/analytics.test.ts`, including the "anchor on latest data, not
wall-clock today" behavior, the member filter, and a December→January
month-boundary case), and the shared backup-file validation
(`tests/restoreValidation.test.ts` — a corrupt file, a valid-but-unrelated
SQLite file, and the WAL sidecar-file cleanup after validation, each
caught a real bug during development, which is exactly the case for
testing this rather than trusting it by inspection).

`npm run test:e2e` runs the one real-browser test (Playwright,
`e2e/household-flow.spec.ts`): import the ABN AMRO checking fixture,
correct a transaction's category through the actual three-way prompt, and
confirm the dashboard reflects both the import and the correction. It
builds and starts a production server against its own disposable database
(`e2e/setup.ts` — migrated and given minimal household scaffolding, no
pre-existing transactions) on port 3101, so it never touches
`data/carera-cashflow.db`. Unit and integration tests cover each phase's
internals in isolation; this is the one test that would catch a wiring
mistake *between* them — e.g. the dashboard silently not picking up a
change the transaction table made, since the two go through different
query modules (`analytics/queries.ts` vs `db/queries.ts`).

## Known limitations

- The real currency-conversion HTTP call (`FrankfurterProvider`) is
  unverified against the live API the same way the Chase adapter is
  unverified — see "How currency conversion works" above for why (no general
  internet access from this development sandbox) and what is and isn't
  tested as a result.
- Rule application (both at import time and "apply historically") always
  overwrites a matching transaction's rule-set fields, even ones set
  manually — there's no per-field "locked" flag yet. See "How
  classification works" above for the reasoning and the documented
  fallback if this needs to change.
- The "apply to matching transactions in this import" correction option
  matches by exact (case-insensitive) merchant, or cleaned description when
  there's no merchant — it doesn't fuzzy-match near-identical merchant
  spellings across different imports the way a saved rule would.
- The currency rate cache is keyed by exact (currency, date) only — a cache
  miss always means a fresh fetch for that exact date, even if a nearby date
  for the same currency is already cached. See `src/lib/currency/rates.ts`'s
  header comment for why this simpler behavior was chosen over a "reuse the
  nearest cached date" optimization.
- "Resolve pending currency conversions" is a manual, user-triggered action
  (Review and Import history pages) rather than an automatic background
  job — intentional for a local-first app with no always-on server, but it
  does mean a pending conversion stays pending until someone clicks the
  button.
- Transfer detection's core amount/date gate is still the tight Phase 2
  heuristic (see "How duplicate and transfer detection work" above); Phase 4
  only adds tie-breaking when more than one candidate matches it, not a
  fundamentally richer signal set.
- Restoring a backup is intentionally two steps (validate/stage in-app,
  finish with a CLI command while the app is stopped) rather than one
  button — see "How diagnostics, backup, and restore work" above for why a
  live database swap isn't safe to do to the app's own open connection.
  This is a deliberate design constraint, not a missing feature.
- The accessibility pass covers what was checked directly (mobile
  navigation, dialog keyboard/focus behavior, unlabeled form controls,
  color-contrast ratios computed and bumped where they fell short of WCAG
  AA — see the `--muted-2` and `--border` comments in `globals.css`) —
  it is not a full audit against every WCAG success criterion or a
  screen-reader-by-screen-reader verification.
- Account "balance" is not yet tracked from statement running balances
  (ABN AMRO's own `startsaldo`/`endsaldo` columns, preserved in every
  transaction's raw row but not yet surfaced) — the savings goal and any
  future balance display will use those statement-provided balances rather
  than summing transaction amounts from an arbitrary start point — see the
  header comment in `src/lib/analytics/savingsGoals.ts`.
- The account-resolution step during import lets you link a detected
  account number to an existing account or create a new one, but there's no
  full manual *column-mapping* UI for a totally unrecognized file layout
  yet — an unrecognized file lets you force a specific institution's parser
  (useful if a bank tweaks its export slightly) but not remap arbitrary
  columns by hand.
- Chase's own CSV export has no per-file account-number column, so every
  Chase file currently attributes to one default account; a household with
  more than one Chase account would need the real export checked for a
  usable identifying field (see `adapters/chaseUs.ts`).
- Auth is one shared household password, not individual logins — a
  deliberate scope choice for a two-person household (see "Deploying
  (remote hosting)"), not a placeholder for something more built out.
  There's no password-reset flow either: rotating it means changing the
  `APP_PASSWORD` environment variable and redeploying.
- The Dockerfile and `railway.json` were written carefully but couldn't be
  built or run in this development sandbox (no Docker daemon available) —
  see "Deploying (remote hosting)" → "A note on verification" for what
  that means in practice.

## Implementation phases

1. **Foundation** *(done)* — project setup, local database, canonical
   transaction schema, household/account settings, synthetic sample data,
   basic transaction table.
2. **Reliable import** *(done)* — CSV/Excel inspection, institution
   adapters (ABN AMRO checking + savings and EU Amex verified against real
   sample files; Chase built and tested but unverified), import preview,
   validation, import history with batch inspection, duplicate detection,
   undoable import batches, a minimal transfer-suggestion heuristic, and
   confident credit-card-settlement exclusion.
3. **Classification** *(done)* — editable categories/priorities/household
   members (archive, never hard-delete), a deterministic and transparent
   merchant-rules engine wired into import with precedence-based conflict
   detection, an interactive review queue and transaction table (inline
   category/priority/owner edits, bulk edit, transfer confirm/reject), the
   three-way correction workflow (this transaction / matching transactions
   in this import / a standing rule applied to past and future), and a full
   audit trail for every classification change.
4. **Currency and transfers** *(done)* — a pluggable exchange-rate provider
   interface with a Frankfurter-based production implementation, a local
   rate cache with retry, the synchronous import-time resolver plus a
   manual "resolve pending conversions" step that also re-triggers transfer
   detection, and counterparty-aware tie-breaking when more than one
   transaction matches the transfer-detection gate. Credit-card settlement
   handling was already confident/complete since Phase 2.
5. **Dashboard** *(done)* — a colorful, simplified home page: household
   summary stat cards, a monthly income/expense trend chart, a
   spending-by-category donut, savings-goal progress bars, and filters by
   household member, month, and trend-chart range (see "How the dashboard
   works" above). Also covered: an accessibility/responsive pass across the
   whole app, not just the dashboard — mobile navigation, dialog
   keyboard/focus behavior, unlabeled form controls, and color-contrast
   fixes (see "Known limitations" for this pass's actual scope).
6. **Resilience** *(done)* — a diagnostics page (database stats, migration
   status, the structured error/activity log with severity filtering), a
   sanitized log export, in-app backup download plus a validate-and-stage
   restore flow finished by a CLI script, a real-browser end-to-end test,
   and this documentation pass.
