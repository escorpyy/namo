# NAMO ERP — PROJECT TRACKER

> Continuity document. Code and verified behavior outrank this file. Re-verify before trusting any status.
> No secrets are recorded here.

---

## A. Project identity

| Item | Value |
|---|---|
| Repository | https://github.com/escorpyy/namo |
| Default branch | `main` (verified via `origin/HEAD`) |
| Active dev branch | `main` (no other branches exist) |
| Frontend | React 18 + Vite 5 + Tailwind 3 + TypeScript 5 |
| Backend | Express 4 + TypeScript (run with `tsx`) |
| Database / ORM | PostgreSQL 16 + Drizzle ORM 0.44.7 (committed migrations in `drizzle/`, applied with `pnpm db:migrate`; `db:push` only for throw-away experiments) |
| Validation | zod, driven by `shared/masters.ts` (single source for UI + server) |
| Deployment | None found. `npm run build && npm start` serves `dist/` from Express. `docker-compose.yml` = local Postgres only |
| Release / milestone | None established (package version 0.1.0) |
| Last actual audit | 2026-10-22 (session 5: fresh clone of GitHub, full local test run) |

---

## B. Current project state

- **Latest inspected commit:** `a2e6a31` (`party-tests`) on `origin/main`, verified by cloning GitHub on 2026-10-22 (session 5). It sits on `7547005` (ERP-003 + ERP-015 committed) and `0fd03ab` (ERP-004; its GitHub Actions run `39455007886` was **success**, incl. "Tests (unit + API integration)"). I could not read the Actions status of `7547005` / `a2e6a31` (GitHub API rate-limited from the sandbox): **owner to check the Actions tab**.
- **Branch:** `main`
- **Working tree (end of session 5):** ERP-001, ERP-004, ERP-003, ERP-015 and the party tests are on GitHub (`dc3a184`, `0fd03ab`, `7547005`, `a2e6a31`). **Uncommitted, delivered as one patch:** five new ERP-014 test files (`tests/api.product.test.ts`, `api.stockOpening.test.ts`, `api.subLedger.test.ts`, `api.userAccess.test.ts`, `api.company.test.ts`) and this tracker. **No production code was changed.**
- **Package manager:** pnpm (owner's choice). `package-lock.json` removed in the ERP-004 changes.
- **Phase:** Foundation / master-data, with an automated safety net (tests + CI) and committed migrations. **No transactional accounting yet** (no vouchers, sales, purchases, reports).

### Verified complete (this session, with evidence in section G)
- Master CRUD engine + the 22 master screens' API layer starts and serves (health, list, create, validation, delete guard exercised for the two term masters only; other masters not re-tested this session).
- Purchase Term / Sales Term masters (after ERP-001 fix); both screens confirmed in the browser by the owner (2026-10-22).
- (Session 5) API tests now cover Product (31), Stock Opening + reconciliation (44), Sub Ledger (11), Users + User Access (14), Company / Branch / Fiscal Year (26); evidence in section G.

### Partially implemented
- Opening Balance grid: API tested (17 tests); UI **not** checked.
- Stock Opening grid + stock reconciliation: API tested (44 tests, session 5); UI **not** checked.
- Billing-terms schema: master tables done; document-level tables (`*DocumentTerm`, allocation) exist in schema with no documents to attach to.
- Accounting hierarchy: tables exist for Account Group → Sub Group → General Ledger → Sub Ledger; "Master Account" (Asset/Liability/Equity/Revenue/Expense) appears to be an enum on Account Group, not a table (**verify**).

### Confirmed missing
- Authentication, authorization, tenant isolation.
- Journal Voucher / Cash-Bank Voucher posting (schema only: `server/db/schema/vouchers.ts`; no routes, no UI, no balance enforcement).
- Sales, Purchase, Returns, Inventory movements, Tax/VAT, Depreciation.
- Reports (Trial Balance, P&L, Balance Sheet, Ledger).
- Fiscal-year close workflow; closed-period posting control.
- Linting, committed migrations, deployment config, backup/restore procedure. (Tests + CI now exist: ERP-004.)

### Blockers and risks
- **Risk (confirmed; owner chose to defer login on 2026-10-20 — ERP-002):** No auth. **Do not expose this app on a shared network or cloud with real data until ERP-002 is done.** `companyId` comes from the query string; `userId` for audit/lock comes from the request body (`server/routes/openingBalance.ts` lines ~100, ~158). Any client can read/write any company and impersonate any user.
- **Resolved by ERP-003 (committed `7547005`):** migrations are committed (`drizzle/0000_baseline.sql`, `0001_account_company_integrity.sql` + `meta/`); `drizzle/` is no longer gitignored; `pnpm db:migrate` / `db:baseline` / CI drift check added. **Owner's dev DB (2026-10-22): `pnpm db:baseline` refused with "Migration history already exists; nothing to baseline" (exit code 1 is how that script reports a refusal; it changes nothing), so the DB already had migration history; `pnpm db:migrate` then reported "Migrations applied".**
- **Resolved by ERP-003 (committed `7547005`):** the account-hierarchy company invariant (`GeneralLedger.companyId` = its Account Group's company; parent ledger same company) is now enforced by 3 DB triggers. Before the fix the DB accepted such rows (proven by 6 failing tests); the API already rejected them ("Sub Group not found in this company"), so the master screens were never exposed.
- **Resolved by ERP-015 (committed `7547005`):** the cross-company gap on the other tables (e.g. `OpeningBalance` accepted `companyId=2` pointing at a company-1 ledger) is closed for all 41 registered tables / 68 links by one registry-driven trigger; a record's company can no longer change. Still **not** DB-enforced: voucher balance (Dr = Cr) — no voucher posting exists yet (ERP-005, ERP-016).
- **Mitigated (ERP-004):** `main` was non-compiling across 6 commits without anyone being alerted. Tests + CI now cover this (first CI run, on `0fd03ab`, green).
- **Risk (code-read, NOT reproduced):** `server/routes/openingBalance.ts` checks "locked/closed" before its write transaction (PUT) and computes balance before setting the lock (POST /lock), without row locking, so a concurrent save and lock could interleave (ERP-012).
- **Latent (confirmed by test):** `toCents` truncates beyond 2 decimals while `mulRound2` rounds half-up (`shared/decimal.ts`). Today `toCents` only sees 2-decimal strings (`stockRecon.ts`), so no live effect (ERP-011).
- **Defect (reproduced, session 5 — ERP-018):** database errors never reach the 409 mapping in `server/app.ts`. drizzle-orm 0.44.7 wraps every database error in a `DrizzleQueryError`: probes showed `err.code` is `undefined` and the Postgres code sits on `err.cause.code` (seen for 23503 foreign key, 23505 unique, 23514 trigger/check). The handler reads `err.code`, so all three become **HTTP 500 with the SQL text and parameters in the message**. Reproduced through the API: deleting a ledger that is a company's Retained Earnings GL returns 500 ("Failed query: delete from ... params: ..."). The session-3 claim "check violations (23514) surface as HTTP 409" is therefore **not true at runtime**. Mostly masked today because routes pre-check; it matters for races and for any new code path that relies on the database as the safety net (vouchers!). The 23514 case was shown at the database layer (cross-company `OpeningBalance` insert), not through an API route.
- **Defect (reproduced, session 5 — ERP-017):** `PUT /api/stock-opening` has a 5000-row limit that can never trigger: `express.json()` keeps its 100 KB default (about 1,300 minimal rows; fewer with batch/expiry) and an oversized body is answered 500 (same handler gap). Saving a few thousand stock lines in one go fails with a server error.
- **Observation:** 22 master list endpoints took ~4 s total in the AI sandbox but ~1.3 s on the owner's machine (his `pnpm test:db` output). Probably a slow sandbox, not a defect; ERP-013 downgraded to "measure only if it shows up in real use".
- **Resolved by ERP-003 (committed `7547005`):** that FK now has an explicit short name (`PurchaseDocTermAlloc_documentTermId_fk`); no identifier in the migrations exceeds 63 chars (scanned).
- **Resolved in ERP-004 changes:** single lockfile (`pnpm-lock.yaml`); README now says pnpm; `pnpm-workspace.yaml` `allowBuilds` placeholder set (`esbuild: true`) because a fresh/CI `pnpm install` failed on it.

---

## C. Module inventory

| Module | Status | Evidence / files | Known defects | Remaining |
|---|---|---|---|---|
| Master engine (generic CRUD, dup check, delete guard) | COMPLETE for current scope (generic CRUD covered by `tests/api.masters.test.ts`; custom rules per master: see the per-master rows and ERP-019) | `server/routes/masterFactory.ts`, `shared/masters.ts`, `server/masters.ts`; exercised via term masters | none found | automated tests |
| Account Group / Sub Group / GL / Sub Ledger masters | PARTIAL: Sub Ledger TESTED (11 tests); Account Group / Sub Group / GL only by the generic tests | `server/db/schema/accounting.ts`, `shared/masters.ts`, `tests/api.subLedger.test.ts` | none found (company triggers exist since ERP-003/015) | tests for GL custom rules (ERP-019) |
| Party (Customer/Vendor) | TESTED (API, 14 tests) | `server/routes/party.ts` (transactional GL+Party+detail), `tests/api.party.test.ts` | — | UI check |
| Product (5 types) | TESTED (API, 31 tests, session 5) | `server/routes/product.ts`, `tests/api.product.test.ts` (per-type rules, links must be same company, uniqueness, type locked, all-or-nothing update, delete guards) | none found | UI check |
| Company / Branch / Fiscal Year / User / User Access | TESTED (API, 40 tests, session 5); roles still not enforced | `tests/api.company.test.ts` (26), `tests/api.userAccess.test.ts` (14) | Roles recorded, not enforced; FY close workflow missing; deleting a company's Retained Earnings GL answers 500 (ERP-018) | auth, FY close |
| Area / Sub Area / Agent / Units / Tax Rate / Stock Category / Location / Product Groups | NEEDS TESTING (generic tests only) | masters + seed | — | tests (ERP-019) |
| **Purchase Term / Sales Term** | **COMPLETE (masters only)** | `shared/masters.ts` `termMaster()`, `server/masters.ts` CFG, `server/db/schema/billing.ts`; 16/16 API checks (section G) | Term-default assignment (party/product) has no UI; document terms have no consumer | calc engine (ERP-009) |
| Opening Balance (API) | COMPLETE for current scope; UI NEEDS TESTING | `server/routes/openingBalance.ts`; 17 API tests (validation, exact totals, Dr=Cr before lock, edit blocked when locked/closed, restore) | `userId` trusted from client; possible lock/save race (ERP-012) | UI check; ERP-012 |
| Stock Opening + Reconciliation | TESTED (API, 44 tests, session 5); UI NEEDS TESTING | `server/routes/stockOpening.ts`, `stockRecon.ts`, `tests/api.stockOpening.test.ts` (value = Qty × Rate, decimals per unit, batch/expiry, uniqueness, all-or-nothing, lock/closed, per-branch reconciliation) | 5000-row cap unreachable, large saves answer 500 (ERP-017) | UI check; ERP-017 |
| Journal / Cash-Bank Vouchers | MISSING (schema only) | `server/db/schema/vouchers.ts` | No balanced-entry enforcement | ERP-005/006 |
| Sales / Purchase documents | MISSING | — | — | ERP-009 |
| Reports | MISSING | — | — | ERP-008 |
| Auth / permissions | MISSING (deferred by owner) | — | see risks | ERP-002 |
| Tests / CI | GOOD for the API layer: 317 tests locally (session 5); GitHub green for `0fd03ab`, later commits not checked by me | `tests/`, `vitest.config.ts`, `.github/workflows/ci.yml`, `scripts/test-db.mjs` | no UI tests; 2 known-defect tests use `it.fails` (ERP-017, ERP-018); General Ledger / Location custom rules untested (ERP-019) | owner: check Actions; ERP-017/018/019 |
| Migrations + DB integrity (account hierarchy + all tenant tables) | COMPLETE (committed `7547005`) | `drizzle/0000-0002`, `server/db/migrate.ts`, `server/db/baseline.ts`, `tests/db.integrity.test.ts` (8), `tests/db.companyConsistency.test.ts` (15) | voucher balance not DB-enforced (no vouchers yet) | ERP-005, ERP-016 |

---

## D. Prioritized backlog

| ID | Title | Pri | Status | Business objective | Dependencies | Acceptance criteria | Verification |
|---|---|---|---|---|---|---|---|
| ERP-001 | Restore corrupted `shared/masters.ts`; add Purchase/Sales Term definitions | P0 | **Done (pushed in `dc3a184`)** | App compiles and runs again | — | `tsc` clean, build clean, server starts, term CRUD+rules work | Section G |
| ERP-004 | Test + CI baseline | P1 | **Done (pushed `0fd03ab`; first CI run green)** | Prevent a repeat of ERP-001; safety net for accounting work | — | Vitest; unit tests for decimal + master definitions; API integration tests (master registry/CRUD, term rules, opening balance); GitHub Actions runs build + tests on Postgres | 154 tests pass; mutation checks; fresh-copy CI replay (section G). First GitHub Actions run (`39455007886`) green |
| ERP-002 | Authentication, authorization, tenant isolation | P0 | **Deferred by owner (2026-10-20)** | Stop cross-company access and user spoofing before any real data | Decision: auth approach (see F) | Login; server derives user + allowed companies from session; every route checks company membership and role; `userId` never read from body; tests for cross-tenant denial | Authz tests |
| ERP-003 | Commit real migrations; move invariants into DB | P1 | **Done (committed `7547005`)** | Reviewable, repeatable schema changes | — | `drizzle/` un-ignored; baseline migration; GL company triggers (+ parent-ledger rule, group/sub-group move guards, pre-flight on dirty data); fresh-DB and legacy-DB upgrade paths; FK name fixed; CI drift check | See section G (fresh DB, legacy `db:push` DB, dirty DB, idempotence, drift, 162 tests) |
| ERP-005 | Journal Voucher posting service | P1 | Backlog | First real financial transaction | ERP-014 (ERP-015 done; ERP-002 deferred: service takes an explicit `actorUserId` so real auth plugs in later; until then it is dev-only) | Atomic post; Σdebit = Σcredit enforced in service **and** DB; fiscal-year open + not closed; GL active/company-scoped; numbering; reversal (never edit posted); audit fields | Concrete Dr/Cr example tests |
| ERP-006 | Cash/Bank Voucher | P1 | Backlog | Receipts/payments | ERP-005 | Same controls as ERP-005 | Tests |
| ERP-007 | Fiscal-year close + period lock | P2 | Backlog | Audit freeze | ERP-005 | Close blocks posting; carry-forward creates openings (schema has roll-forward trace column) | Tests |
| ERP-008 | Reports: Ledger, Trial Balance, P&L, Balance Sheet | P2 | Backlog | Financial visibility | ERP-005 | TB balances; BS equation holds; ties to control accounts | Tests |
| ERP-009 | Sales & Purchase documents + terms calc engine | P2 | Backlog | Core trade workflow | ERP-005, ERP-008 | Terms calculated in `sequence` order, SINGLE_TERM base earlier, landed-cost allocation, posts journal | Tests |
| ERP-010 | Hygiene: single lockfile, README/package manager, FK name length | P3 | **Done** (lockfile + README in `0fd03ab`; FK rename in `7547005`) | Maintainability | — | Lockfile + README done; FK now has an explicit short name (ERP-003) | Clean install |
| ERP-011 | Align `toCents` (truncates) with `mulRound2` (rounds) | P3 | Backlog | Avoid 1-paisa drift if both are ever mixed | — | One documented rounding rule; test updated (currently characterizes truncation) | `tests/decimal.test.ts` |
| ERP-012 | Close lock/save race in opening balance | P2 | Backlog | Locked balances must not change | ERP-004 | Check lock/closed state and write inside one transaction with a row lock; concurrent test | Concurrency test |
| ERP-016 | Per-voucher balance (Dr = Cr) and posted-voucher immutability enforced in the database | P1 | Backlog | Books cannot be unbalanced or silently edited even by a buggy code path | ERP-005 design | Deferred constraint trigger on voucher lines + status guard; tests with concrete Dr/Cr examples | Red-first DB tests |
| ERP-013 | Master list latency | P3 | Backlog (low) | Snappy screens | — | Only if slowness appears in real use on the owner's machine (his run: 22 lists in ~1.3 s) | Timing |
| ERP-015 | DB-level company consistency for all tenant-scoped links (OpeningBalance, StockOpening, SubLedger, Party, Voucher tables…) | P1 | **Done (committed `7547005`)** | A bug or new code path must not be able to mix companies' books | ERP-003 | Registry-driven generic trigger (`namo.company_source`/`company_link`) covering every tenant-scoped table; completeness test fails CI if a new FK is unregistered; audit function; migration with dirty-data pre-flight | 15 tests red-then-green; mutation checks; legacy + dirty upgrade paths (section G) |
| ERP-014 | Extend tests: party, product, stock opening + reconciliation, sub-ledger, user access, company/branch/fiscal-year masters | P1 | **Done (party pushed `a2e6a31`; the other five files are in the session-5 patch, uncommitted)** | Cover the remaining existing workflows before building on them | ERP-004 | Each route has success + failure + invariant tests | 317/317 locally (191 before + 126 new); mutation checks on every file; table row counts identical across repeated runs (section G). Owner: apply patch, `pnpm test:db` twice, commit, check CI |
| ERP-018 | Map database errors correctly: read `err.cause?.code` (fall back to `err.code`); never return SQL text to clients | P1 | **Backlog (reproduced)** | The DB safety net must answer 409, and clients must never see SQL | — | `server/app.ts` handler maps 23505 / 23503 / 23514 to 409 with a safe message; unknown 500s return a generic message (details only in the server log); the `it.fails` test in `tests/api.company.test.ts` becomes a plain `it`; one test that reaches 23514 through an API route | The `it.fails` test starts failing the moment the fix lands |
| ERP-017 | Stock opening: a save of more than ~1,300 rows answers 500; the 5000-row rule is unreachable | P2 | **Backlog (reproduced)** | Large catalogues must save, or be refused with a clear message | ERP-018 (same error handler) | Raise the JSON body limit for that route (or save in pages); `entity.too.large` answered 413 with a message; the 5000-row rule reachable and tested; the `it.fails` test in `tests/api.stockOpening.test.ts` becomes a plain `it` | Same signal |
| ERP-019 | Tests for the remaining custom master rules: General Ledger (parent hierarchy and cycles, party-linked ledgers, "Requires Sub Ledger" toggle), Location hierarchy, Account Group / Sub Group, and the simple masters (Area, Sub Area, Agent, Unit, Tax Rate, Stock Category, Product Group) | P2 | Backlog | Finish covering every existing master before building on them | ERP-004 | Success + failure + invariant tests per master | CI green |

---

## E. Current task and next action

- **Current task:** ERP-014 (tests for the existing untested routes) — **done locally, delivered as a patch, uncommitted.** Party was done earlier (`a2e6a31`).
- **Objective:** Cover the existing workflows before building transactional accounting on top of them.
- **Work done (session 5):** 126 new API integration tests in five files: Product 31, Stock Opening + reconciliation 44, Sub Ledger 11, Users + User Access 14, Company / Branch / Fiscal Year 26. Suite: 317 tests in 13 files, all passing locally. Every file was mutation-checked (a business rule broken on purpose; the tests failed each time; production files restored, git clean). Each file removes what it creates (identical table row counts across repeated runs). **No production code was changed.** Two real defects were found and are recorded as `it.fails` tests so CI stays green: ERP-018 and ERP-017 (section B, section D).
- **Files changed (uncommitted):** `tests/api.product.test.ts`, `tests/api.stockOpening.test.ts`, `tests/api.subLedger.test.ts`, `tests/api.userAccess.test.ts`, `tests/api.company.test.ts` (all new) and `PROJECT_TRACKER.md`.
- **Owner actions (2026-10-22):** `pnpm db:baseline` — refused, migration history already existed (nothing changed); `pnpm db:migrate` — "Migrations applied"; Purchase Term + Sales Term screens — both show up in the browser; `pnpm test:db` twice in a row — the owner was running it when this was written, **result not reported to me**.
- **Remaining for ERP-014:** apply the patch (`git apply`), run `pnpm test:db` twice on Windows (expect 317 passing both times), commit, push, check the GitHub Actions run (also for `7547005` and `a2e6a31`, which I could not check).
- **Blocker:** none technical.
- **Single best next action:** **ERP-018** (small, P1): make `server/app.ts` read `err.cause?.code`. Reason: ERP-005 / ERP-016 will rely on database constraints (Dr = Cr, posted-voucher immutability) answering a clear 409, and today those errors would surface as 500 with SQL text. Then **ERP-005 + ERP-016** together (Journal Voucher posting with DB-enforced balance). ERP-017 is a small follow-up in the same handler; ERP-019 (remaining masters' tests) can run in parallel.

---

## F. Decisions and assumptions

**Confirmed (from code):**
- One shared master definition drives UI and server validation (`shared/masters.ts`); `tests/masters.definitions.test.ts` guards it.
- Term semantics follow `server/db/schema/billing.ts`. Money is `numeric`; arithmetic via BigInt in `shared/decimal.ts`.
- Server-joined display columns follow the `<lookup>Id` -> `<lookup>Name` convention.
- `SubLedger` may belong to a ledger and/or a party (schema comment); the master screen always sets the ledger.

**Decisions made:**
- (S1) Restore `shared/masters.ts` from history; one factory for both term masters.
- (S2) **Owner: skip login for now**; ERP-002 deferred (risk open). **pnpm** is the package manager. Integration tests only run against a local DB whose name contains "test"; in CI an unsafe/missing DB fails the run; `scripts/test-db.mjs` pins `DATABASE_URL_DIRECT`. `allowBuilds: esbuild: true`.
- (S3) Schema changes go through committed migrations (`pnpm db:generate` -> review -> commit); `db:push` is for throw-away experiments only; CI fails on schema/migration drift. Existing `db:push` databases use one-time `pnpm db:baseline`. Check violations (23514) were meant to surface as HTTP 409 — **not true at runtime until ERP-018 is fixed** (found in session 5).
- (S4) **Company consistency is registry-driven.** One generic trigger instead of ~70 hand-written ones; every tenant-scoped table is registered; a **completeness test reads the catalog and fails CI if a new FK between tenant tables is not registered** (or a new table is neither registered nor listed as global: only `User` and `AuditLog`). Consequence: adding a table/FK means adding a registry row in a new migration.
- (S4) **A record's company can never change** (direct `companyId`; for child tables, the owner's company). **Behavior change vs ERP-003:** an *empty* Sub Group/Account Group can no longer be moved to another company; the ERP-003 control test that allowed it was rewritten to assert the refusal. Rationale: moving records between companies is a copy, never an UPDATE.
- (S4) A registered row whose company cannot be determined (e.g. a SubLedger with neither ledger nor party) is **rejected**; the migration pre-flight reports existing such rows.
- (S4) Implementation notes: trigger fires only when a company-relevant column is written (`UPDATE OF ...`); named `namo_company_consistency` so the more specific ERP-003 triggers (uppercase names) run first and their messages win; no row locks (company is immutable, so a parent's company cannot change underneath a check); functions are VOLATILE so they see rows written earlier in the same transaction. Cost: a few indexed lookups per write to registered tables.
- (S5) A test that documents a **reproduced defect** uses `it.fails` with a comment naming the ERP id: CI stays green, and the test starts failing once the defect is fixed, which is the signal to turn it into a plain `it`. Two exist: ERP-017 (`tests/api.stockOpening.test.ts`), ERP-018 (`tests/api.company.test.ts`). Tests remove the data they create; users cannot be deleted through the API, so `tests/api.userAccess.test.ts` removes its own users directly in the database. The company/branch/fiscal-year tests build everything inside a throw-away **inactive** company so it never shows in the header switcher and the seeded companies are only read.

**Assumptions awaiting owner confirmation:**
- Auth approach when ERP-002 resumes; deployment target; Nepal-specific tax/calendar rules (unspecified, not assumed); "Master Account" as an enum on Account Group.
- Owner's dev DB: baseline preserves it; recreating is the alternative.
- That a SubLedger with neither ledger nor party is not a real use case (the migration refuses existing ones rather than guessing).

---

## G. Verification record

Sandbox: Linux, Node 22, pnpm 12.14.0, throwaway PostgreSQL 16 databases (never the owner's DB). Owner independently ran `pnpm test:db` on Windows for ERP-004: 154/154. GitHub Actions run `39455007886` on `0fd03ab`: success (install, schema+seed, build, tests).

**Session 5 (ERP-014 tests, 2026-10-22):**
| Check | Result |
|---|---|
| Fresh clone of GitHub `a2e6a31`; sandbox PostgreSQL 16, pnpm 12.14.0, Node 22; `pnpm test:db` before adding anything | 191/191 pass (8 files) |
| New test files | product 31, stock opening 44, sub ledger 11, user access 14, company/branch/fiscal year 26 = **126**. Full suite **317/317** (13 files) |
| First runs: failures read before changing anything | 2 real findings, 2 test mistakes (mine). Findings: stock-opening 5000-row cap unreachable (500 from the 100 KB body limit); deleting a company's Retained Earnings GL answers 500 with SQL text, traced to `err.cause.code` vs `err.code` (probe: FK 23503, unique 23505, trigger 23514 all wrapped, `err.code` undefined). Test mistakes: an upper-case random tag compared with a lower-cased e-mail; a sandbox Postgres that had stopped |
| Mutation checks (rule broken in production code, tests must fail, file restored, `git status` clean) | product: 2 rules -> 4 failures. stock opening: value check 2, locked-year check 1, duplicate key 5, reconciliation 5. sub ledger: ledger must require sub ledgers 2. user access: duplicate / exclusivity 3. branch: one head office 2. fiscal year: overlap 4, closed year frozen 1. company: VAT No required 1 |
| Clean-up | after a full `pnpm test:db`, two more runs of the five files: table row counts identical to the seeded baseline each time (2 companies, 3 branches, 2 fiscal years, 12 account groups, 18 ledgers, 2 sub ledgers, 2 users, 3 access rows, 6 products, 2 stock rows) |
| Known-defect tests | 2 `it.fails` (ERP-017, ERP-018), counted among the 317 passing |

**Session 5 not verified:** the patch on the owner's Windows machine; GitHub Actions for `7547005`, `a2e6a31` and the ERP-014 commit (API rate-limited from the sandbox); any UI screen (Product, Stock Opening, Sub Ledger, User Access, Company, Branch, Fiscal Year); concurrent requests; the 23514 case through an API route (shown only at the database layer).

**Session 4 (ERP-015 + runner fix):**
| Check | Result |
|---|---|
| Exposure map from the catalog | 21 tables with `companyId`, 22 direct links, ~50 more on child tables; classified 43 tables: 41 registered (tenant or derived), 2 global (`User`, `AuditLog`) |
| Probe (rolled back) before the fix: company-2 `OpeningBalance` on a company-1 ledger | accepted by the DB |
| New `tests/db.companyConsistency.test.ts` against the pre-fix DB | 15/15 red. Reasons: 10 "bad data accepted", 5 "registry/trigger missing". Two fixture bugs (wrong-reason failures: duplicate names, unique-key collision) found by reading the messages and fixed before proceeding |
| After migration 0002: full suite | **177/177 PASS** (7 files); seed runs with all triggers active |
| Mutation checks on the live DB: drop one trigger; delete one registry rule; neutralize the trigger function | all detected (3, then 5 cumulative incl. the completeness test and the table's behavior test, then 12 failures) |
| Legacy `db:push`-built seeded DB: `db:baseline` -> `db:migrate` | 44 triggers (3 + 41), 3 migrations recorded, audit 0 violations, seed idempotent afterwards |
| Dirty DB (planted cross-company `OpeningBalance`, and separately an owner-less `SubLedger`) | migration **refused** and named the rows (`OpeningBalance#8.branchId/.fiscalYearId/.generalLedgerId`; `SubLedger#3.(owner)`); 0 triggers, no `namo` schema, only baseline recorded (0001 rolled back too) |
| Fresh-repo CI replay, `CI=true`: install --frozen-lockfile, drift check, migrate, seed, build, test | all exit 0; **177/177** |
| **Bug found and fixed:** `pnpm test:db` (ERP-003 version) reset only `public`; the migration history in schema `drizzle` survived, so every run after the first failed in seed ("relation User does not exist"). Reproduced, fixed (now also drops `drizzle` and `namo`), then run twice in a row | 162/162 both runs (before ERP-015 tests added); 177/177 afterwards |

**Not verified / not run:** ERP-003/ERP-015 steps on real GitHub Actions; the baseline path on the owner's actual dev DB; behavior under truly concurrent transactions (design reasoned, not stress-tested); trigger overhead on large data (not measured); migrations on Supabase/Neon; rollback/down migrations (none; recovery = restore from backup, and no backup/restore procedure exists yet); lint; (the browser check of the two term screens was done by the owner on 2026-10-22).

**Manual verification still required:** after applying the session-5 patch, `pnpm test:db` twice in a row on Windows (expect 317 passing both times; the owner was running it, result not reported); GitHub Actions status for the latest commits. Purchase Term / Sales Term screens: **verified by the owner on 2026-10-22.**

---

## H. Change log

### 2026-10-20 — Session 1 — ERP-001 + initial audit
- Found `main` non-compiling (`6c567d8` wiped `shared/masters.ts`). Restored; added `termMaster()`; created this tracker. Pushed as `dc3a184`.

### 2026-10-20 — Session 2 — ERP-004
- Vitest + 154 tests, CI workflow, `pnpm test:db`, `server/app.ts` split, pnpm cleanup. Pushed as `0fd03ab`; first CI run green.

### 2026-10-20/21 — Session 3 — ERP-003
- Committed migrations (baseline + account-hierarchy triggers), `db:migrate`/`db:baseline`, FK rename, 23514 -> 409 (**intended; found not to work at runtime in session 5, see ERP-018**), CI drift check. Now on GitHub (`7547005`).

### 2026-10-21 — Session 4 — ERP-015
- Registry-driven company consistency for all tenant tables (migration 0002, 15 tests). Fixed the `test:db` second-run bug. Rewrote one ERP-003 control test to match the stricter "company never changes" rule.
- Verification: section G. Now on GitHub (`7547005`).

### 2026-10-21 — Session 4 — ERP-014 (part 1)
- Party tests (14). Pushed as `a2e6a31`.

### 2026-10-22 — Session 5 — ERP-014 (rest)
- Added 126 API tests (product, stock opening + reconciliation, sub ledger, users + user access, company / branch / fiscal year); suite now 317. No production code changed. Found and recorded two defects as `it.fails` tests: ERP-018 (database errors answered 500 with SQL text), ERP-017 (stock opening large saves answer 500). Tracker corrected: commit state of ERP-003/015, module statuses, owner actions, stale "no migrations committed".
- Owner actions: baseline refused (history existed), migrate applied, both term screens verified, `test:db` x2 running (result not reported).
- Verification: section G. **Commit hash: none yet (patch).**

---

## HANDOFF (end of session 5)

**Accomplished:** ERP-014 finished locally: 126 new API tests (suite 317), every file mutation-checked and self-cleaning. Two real defects found and recorded (ERP-018, ERP-017). Tracker brought in line with the repository (commit state, module statuses, owner actions).

**Not accomplished / open:** the patch is not yet applied, committed or pushed; owner's `pnpm test:db` x2 result not reported; GitHub Actions status of `7547005`, `a2e6a31` and the new commit unchecked; no UI checks beyond the two term screens; ERP-002 (auth) still deferred; no new feature modules.

**Repo state:** GitHub `main` = `a2e6a31`. One patch against it adds five test files and updates this tracker; it changes no production code.

**Next task:** ERP-018 (database error mapping, small, P1), then ERP-005 + ERP-016 (Journal Voucher posting with DB-enforced balance). ERP-017 and ERP-019 are smaller follow-ups.
