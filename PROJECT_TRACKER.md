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
| Database / ORM | PostgreSQL 16 + Drizzle ORM 0.44 (`drizzle-kit push`; **no migrations committed**) |
| Validation | zod, driven by `shared/masters.ts` (single source for UI + server) |
| Deployment | None found. `npm run build && npm start` serves `dist/` from Express. `docker-compose.yml` = local Postgres only |
| Release / milestone | None established (package version 0.1.0) |
| Last actual audit | 2026-10-20 (session 1) |

---

## B. Current project state

- **Latest inspected commit:** `0fd03ab` on `origin/main` (owner's ERP-004 push; verified by cloning GitHub in session 3). GitHub Actions run `39455007886` on that commit: **success**, all steps incl. "Tests (unit + API integration)".
- **Branch:** `main`
- **Working tree (end of session 4):** ERP-003 + ERP-015 changes are **uncommitted** (file list in section E). ERP-001 (`dc3a184`) and ERP-004 (`0fd03ab`) are on GitHub.
- **Package manager:** pnpm (owner's choice). `package-lock.json` removed in the ERP-004 changes.
- **Phase:** Foundation / master-data, with an automated safety net (tests + CI) and committed migrations. **No transactional accounting yet** (no vouchers, sales, purchases, reports).

### Verified complete (this session, with evidence in section G)
- Master CRUD engine + the 22 master screens' API layer starts and serves (health, list, create, validation, delete guard exercised for the two term masters only; other masters not re-tested this session).
- Purchase Term / Sales Term masters (after ERP-001 fix).

### Partially implemented
- Opening Balance grid (API has transaction + lock; **untested**).
- Stock Opening grid + stock reconciliation (**untested**).
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
- **Resolved by ERP-003 (uncommitted):** migrations are committed (`drizzle/0000_baseline.sql`, `0001_account_company_integrity.sql` + `meta/`); `drizzle/` is no longer gitignored; `pnpm db:migrate` / `db:baseline` / CI drift check added. **Owner's existing dev DB (created by `db:push`) needs the one-time `pnpm db:baseline` then `pnpm db:migrate` — not yet run by the owner.**
- **Resolved by ERP-003 (uncommitted):** the account-hierarchy company invariant (`GeneralLedger.companyId` = its Account Group's company; parent ledger same company) is now enforced by 3 DB triggers. Before the fix the DB accepted such rows (proven by 6 failing tests); the API already rejected them ("Sub Group not found in this company"), so the master screens were never exposed.
- **Resolved by ERP-015 (uncommitted):** the cross-company gap on the other tables (e.g. `OpeningBalance` accepted `companyId=2` pointing at a company-1 ledger) is closed for all 41 registered tables / 68 links by one registry-driven trigger; a record's company can no longer change. Still **not** DB-enforced: voucher balance (Dr = Cr) — no voucher posting exists yet (ERP-005, ERP-016).
- **Mitigated (ERP-004, uncommitted):** `main` was non-compiling across 6 commits without anyone being alerted. Tests + CI now cover this; CI itself has not yet run on GitHub.
- **Risk (code-read, NOT reproduced):** `server/routes/openingBalance.ts` checks "locked/closed" before its write transaction (PUT) and computes balance before setting the lock (POST /lock), without row locking, so a concurrent save and lock could interleave (ERP-012).
- **Latent (confirmed by test):** `toCents` truncates beyond 2 decimals while `mulRound2` rounds half-up (`shared/decimal.ts`). Today `toCents` only sees 2-decimal strings (`stockRecon.ts`), so no live effect (ERP-011).
- **Observation:** 22 master list endpoints took ~4 s total in the AI sandbox but ~1.3 s on the owner's machine (his `pnpm test:db` output). Probably a slow sandbox, not a defect; ERP-013 downgraded to "measure only if it shows up in real use".
- **Resolved by ERP-003 (uncommitted):** that FK now has an explicit short name (`PurchaseDocTermAlloc_documentTermId_fk`); no identifier in the migrations exceeds 63 chars (scanned).
- **Resolved in ERP-004 changes:** single lockfile (`pnpm-lock.yaml`); README now says pnpm; `pnpm-workspace.yaml` `allowBuilds` placeholder set (`esbuild: true`) because a fresh/CI `pnpm install` failed on it.

---

## C. Module inventory

| Module | Status | Evidence / files | Known defects | Remaining |
|---|---|---|---|---|
| Master engine (generic CRUD, dup check, delete guard) | COMPLETE for current scope (NEEDS TESTING broadly) | `server/routes/masterFactory.ts`, `shared/masters.ts`, `server/masters.ts`; exercised via term masters | none found | automated tests |
| Account Group / Sub Group / GL / Sub Ledger masters | NEEDS TESTING | `server/db/schema/accounting.ts`, definitions in `shared/masters.ts`; seed runs | GL.companyId trigger absent | tests, DB-level cross-company checks |
| Party (Customer/Vendor) | NEEDS TESTING | `server/routes/party.ts` (transactional GL+Party+detail) | — | tests |
| Product (5 types) | NEEDS TESTING | `server/routes/product.ts` | — | tests |
| Company / Branch / Fiscal Year / User / User Access | PARTIAL | schema + masters | Roles recorded, not enforced; FY close workflow missing | auth, FY close |
| Area / Sub Area / Agent / Units / Tax Rate / Stock Category / Location / Product Groups | NEEDS TESTING | masters + seed | — | tests |
| **Purchase Term / Sales Term** | **COMPLETE (masters only)** | `shared/masters.ts` `termMaster()`, `server/masters.ts` CFG, `server/db/schema/billing.ts`; 16/16 API checks (section G) | Term-default assignment (party/product) has no UI; document terms have no consumer | calc engine (ERP-009) |
| Opening Balance (API) | COMPLETE for current scope; UI NEEDS TESTING | `server/routes/openingBalance.ts`; 17 API tests (validation, exact totals, Dr=Cr before lock, edit blocked when locked/closed, restore) | `userId` trusted from client; possible lock/save race (ERP-012) | UI check; ERP-012 |
| Stock Opening + Reconciliation | NEEDS TESTING | `server/routes/stockOpening.ts`, `stockRecon.ts`, `shared/decimal.ts` | — | tests |
| Journal / Cash-Bank Vouchers | MISSING (schema only) | `server/db/schema/vouchers.ts` | No balanced-entry enforcement | ERP-005/006 |
| Sales / Purchase documents | MISSING | — | — | ERP-009 |
| Reports | MISSING | — | — | ERP-008 |
| Auth / permissions | MISSING (deferred by owner) | — | see risks | ERP-002 |
| Tests / CI | PARTIAL (green on GitHub for `0fd03ab`; ERP-003 additions uncommitted) | `tests/`, `vitest.config.ts`, `.github/workflows/ci.yml`, `scripts/test-db.mjs` | CI not yet run on GitHub; no tests for party/product/stock-opening/other masters | ERP-014 |
| Migrations + DB integrity (account hierarchy + all tenant tables) | COMPLETE (uncommitted) | `drizzle/0000-0002`, `server/db/migrate.ts`, `server/db/baseline.ts`, `tests/db.integrity.test.ts` (8), `tests/db.companyConsistency.test.ts` (15) | voucher balance not DB-enforced (no vouchers yet) | ERP-005, ERP-016 |

---

## D. Prioritized backlog

| ID | Title | Pri | Status | Business objective | Dependencies | Acceptance criteria | Verification |
|---|---|---|---|---|---|---|---|
| ERP-001 | Restore corrupted `shared/masters.ts`; add Purchase/Sales Term definitions | P0 | **Done (pushed in `dc3a184`)** | App compiles and runs again | — | `tsc` clean, build clean, server starts, term CRUD+rules work | Section G |
| ERP-004 | Test + CI baseline | P1 | **Done (pushed `0fd03ab`; first CI run green)** | Prevent a repeat of ERP-001; safety net for accounting work | — | Vitest; unit tests for decimal + master definitions; API integration tests (master registry/CRUD, term rules, opening balance); GitHub Actions runs build + tests on Postgres | 154 tests pass; mutation checks; fresh-copy CI replay (section G). First GitHub Actions run (`39455007886`) green |
| ERP-002 | Authentication, authorization, tenant isolation | P0 | **Deferred by owner (2026-10-20)** | Stop cross-company access and user spoofing before any real data | Decision: auth approach (see F) | Login; server derives user + allowed companies from session; every route checks company membership and role; `userId` never read from body; tests for cross-tenant denial | Authz tests |
| ERP-003 | Commit real migrations; move invariants into DB | P1 | **Done (uncommitted)** | Reviewable, repeatable schema changes | — | `drizzle/` un-ignored; baseline migration; GL company triggers (+ parent-ledger rule, group/sub-group move guards, pre-flight on dirty data); fresh-DB and legacy-DB upgrade paths; FK name fixed; CI drift check | See section G (fresh DB, legacy `db:push` DB, dirty DB, idempotence, drift, 162 tests) |
| ERP-005 | Journal Voucher posting service | P1 | Backlog | First real financial transaction | ERP-014 (ERP-015 done; ERP-002 deferred: service takes an explicit `actorUserId` so real auth plugs in later; until then it is dev-only) | Atomic post; Σdebit = Σcredit enforced in service **and** DB; fiscal-year open + not closed; GL active/company-scoped; numbering; reversal (never edit posted); audit fields | Concrete Dr/Cr example tests |
| ERP-006 | Cash/Bank Voucher | P1 | Backlog | Receipts/payments | ERP-005 | Same controls as ERP-005 | Tests |
| ERP-007 | Fiscal-year close + period lock | P2 | Backlog | Audit freeze | ERP-005 | Close blocks posting; carry-forward creates openings (schema has roll-forward trace column) | Tests |
| ERP-008 | Reports: Ledger, Trial Balance, P&L, Balance Sheet | P2 | Backlog | Financial visibility | ERP-005 | TB balances; BS equation holds; ties to control accounts | Tests |
| ERP-009 | Sales & Purchase documents + terms calc engine | P2 | Backlog | Core trade workflow | ERP-005, ERP-008 | Terms calculated in `sequence` order, SINGLE_TERM base earlier, landed-cost allocation, posts journal | Tests |
| ERP-010 | Hygiene: single lockfile, README/package manager, FK name length | P3 | Partly done (uncommitted) | Maintainability | — | Lockfile + README done; FK identifier truncation notice remains (folds into ERP-003) | Clean install |
| ERP-011 | Align `toCents` (truncates) with `mulRound2` (rounds) | P3 | Backlog | Avoid 1-paisa drift if both are ever mixed | — | One documented rounding rule; test updated (currently characterizes truncation) | `tests/decimal.test.ts` |
| ERP-012 | Close lock/save race in opening balance | P2 | Backlog | Locked balances must not change | ERP-004 | Check lock/closed state and write inside one transaction with a row lock; concurrent test | Concurrency test |
| ERP-016 | Per-voucher balance (Dr = Cr) and posted-voucher immutability enforced in the database | P1 | Backlog | Books cannot be unbalanced or silently edited even by a buggy code path | ERP-005 design | Deferred constraint trigger on voucher lines + status guard; tests with concrete Dr/Cr examples | Red-first DB tests |
| ERP-013 | Master list latency | P3 | Backlog (low) | Snappy screens | — | Only if slowness appears in real use on the owner's machine (his run: 22 lists in ~1.3 s) | Timing |
| ERP-015 | DB-level company consistency for all tenant-scoped links (OpeningBalance, StockOpening, SubLedger, Party, Voucher tables…) | P1 | **Done (uncommitted)** | A bug or new code path must not be able to mix companies' books | ERP-003 | Registry-driven generic trigger (`namo.company_source`/`company_link`) covering every tenant-scoped table; completeness test fails CI if a new FK is unregistered; audit function; migration with dirty-data pre-flight | 15 tests red-then-green; mutation checks; legacy + dirty upgrade paths (section G) |
| ERP-014 | Extend tests: party [completed], product, stock opening + reconciliation, sub-ledger, user access, company/branch/fiscal-year masters | P1 | **Ready — next** | Cover the remaining existing workflows before building on them | ERP-004 | Each route has success + failure + invariant tests | CI green |

---

## E. Current task and next action

- **Current task:** ERP-015 (database-level company consistency for all tenant tables) — implemented and verified locally; **uncommitted**, stacked on ERP-003 which is also not yet on GitHub (GitHub `main` = `0fd03ab`).
- **Objective:** A bug or a new code path (vouchers, imports, scripts) must not be able to mix two companies' books.
- **Work done:** Registry-driven design (migration `0002_company_consistency.sql`): `namo.company_source` (where each of 41 tables gets its company; SubLedger can derive it from ledger or party), `namo.company_link` (68 links that must agree), generic trigger `namo.enforce_company()` (links must match; a record's company can never change), `namo.company_violations()` audit, dirty-data pre-flight, 41 triggers. Tests first (15, red for the right reasons), then green. Also fixed a real bug in the ERP-003 test runner (below).
- **Files changed (uncommitted, cumulative vs GitHub `0fd03ab`):** everything from ERP-003 (session 3) **plus** `drizzle/0002_company_consistency.sql` + `drizzle/meta/*`, `tests/db.companyConsistency.test.ts` (new), `tests/db.integrity.test.ts` (one test rewritten, see F), `scripts/test-db.mjs` (reset fix), `README.md`, `PROJECT_TRACKER.md`.
- **Remaining for ERP-015:** owner applies the cumulative patch, runs `pnpm db:baseline` (once, existing dev DB) then `pnpm db:migrate`, then `pnpm test:db` **twice**, commits, pushes, checks the Actions run.
- **Blocker:** none technical; needs owner action.
- **Single best next action:** **ERP-014** — tests for the existing routes that have none (party, product, stock opening/reconciliation, sub-ledger, user access, company/branch/fiscal-year masters). Reason: ERP-005 (Journal Voucher posting) should be built on verified workflows, and the DB-level safety net (ERP-003/015) now makes such tests meaningful. Then ERP-005 + ERP-016 (design together: DB-enforced Dr = Cr and posted-voucher immutability).

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
- (S3) Schema changes go through committed migrations (`pnpm db:generate` -> review -> commit); `db:push` is for throw-away experiments only; CI fails on schema/migration drift. Existing `db:push` databases use one-time `pnpm db:baseline`. Check violations (23514) surface as HTTP 409.
- (S4) **Company consistency is registry-driven.** One generic trigger instead of ~70 hand-written ones; every tenant-scoped table is registered; a **completeness test reads the catalog and fails CI if a new FK between tenant tables is not registered** (or a new table is neither registered nor listed as global: only `User` and `AuditLog`). Consequence: adding a table/FK means adding a registry row in a new migration.
- (S4) **A record's company can never change** (direct `companyId`; for child tables, the owner's company). **Behavior change vs ERP-003:** an *empty* Sub Group/Account Group can no longer be moved to another company; the ERP-003 control test that allowed it was rewritten to assert the refusal. Rationale: moving records between companies is a copy, never an UPDATE.
- (S4) A registered row whose company cannot be determined (e.g. a SubLedger with neither ledger nor party) is **rejected**; the migration pre-flight reports existing such rows.
- (S4) Implementation notes: trigger fires only when a company-relevant column is written (`UPDATE OF ...`); named `namo_company_consistency` so the more specific ERP-003 triggers (uppercase names) run first and their messages win; no row locks (company is immutable, so a parent's company cannot change underneath a check); functions are VOLATILE so they see rows written earlier in the same transaction. Cost: a few indexed lookups per write to registered tables.

**Assumptions awaiting owner confirmation:**
- Auth approach when ERP-002 resumes; deployment target; Nepal-specific tax/calendar rules (unspecified, not assumed); "Master Account" as an enum on Account Group.
- Owner's dev DB: baseline preserves it; recreating is the alternative.
- That a SubLedger with neither ledger nor party is not a real use case (the migration refuses existing ones rather than guessing).

---

## G. Verification record

Sandbox: Linux, Node 22, pnpm 12.14.0, throwaway PostgreSQL 16 databases (never the owner's DB). Owner independently ran `pnpm test:db` on Windows for ERP-004: 154/154. GitHub Actions run `39455007886` on `0fd03ab`: success (install, schema+seed, build, tests).

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

**Not verified / not run:** ERP-003/ERP-015 steps on real GitHub Actions; the baseline path on the owner's actual dev DB; behavior under truly concurrent transactions (design reasoned, not stress-tested); trigger overhead on large data (not measured); migrations on Supabase/Neon; rollback/down migrations (none; recovery = restore from backup, and no backup/restore procedure exists yet); lint; browser check of the two term screens (still owed).

**Manual verification still required:** Purchase Term / Sales Term screens in the browser; after applying the patch, `pnpm test:db` twice in a row on Windows.

---

## H. Change log

### 2026-10-20 — Session 1 — ERP-001 + initial audit
- Found `main` non-compiling (`6c567d8` wiped `shared/masters.ts`). Restored; added `termMaster()`; created this tracker. Pushed as `dc3a184`.

### 2026-10-20 — Session 2 — ERP-004
- Vitest + 154 tests, CI workflow, `pnpm test:db`, `server/app.ts` split, pnpm cleanup. Pushed as `0fd03ab`; first CI run green.

### 2026-10-20/21 — Session 3 — ERP-003
- Committed migrations (baseline + account-hierarchy triggers), `db:migrate`/`db:baseline`, FK rename, 23514 -> 409, CI drift check. **Not yet on GitHub.**

### 2026-10-21 — Session 4 — ERP-015
- Registry-driven company consistency for all tenant tables (migration 0002, 15 tests). Fixed the `test:db` second-run bug. Rewrote one ERP-003 control test to match the stricter "company never changes" rule.
- Verification: section G. **Commit hash: none (uncommitted).**

### 2026-10-21 — Session 4 — ERP-014
- party is only completed
---

## HANDOFF (end of session 4)

**Accomplished:** ERP-015 complete and verified locally; a runner bug in my earlier work found, reproduced and fixed.

**Not accomplished:** nothing of ERP-003/ERP-015 is on GitHub; owner's dev DB not yet baselined; no browser check; ERP-002 deferred; no new feature modules.

**Repo state:** one **cumulative** patch/zip vs GitHub `0fd03ab` contains ERP-003 + ERP-015 (it supersedes the session-3 files; apply only the newest one).

**Next task:** ERP-014 (tests for existing untested routes), then ERP-005 + ERP-016 (Journal Voucher posting with DB-enforced balance).
