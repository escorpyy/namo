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

- **Latest inspected commit:** `dc3a184` on `origin/main` (merge that pushed the ERP-001 fix; verified on GitHub by the owner's push output)
- **Branch:** `main`
- **Working tree (end of session 2):** ERP-004 changes are **uncommitted** (see section E for the file list). Owner's push of ERP-001 succeeded (`699fa96..dc3a184`).
- **Package manager:** pnpm (owner's choice). `package-lock.json` removed in the ERP-004 changes.
- **Phase:** Foundation / master-data, now with an automated safety net (tests + CI). **No transactional accounting yet** (no vouchers, sales, purchases, reports).

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
- **Risk (confirmed):** `drizzle/` is in `.gitignore` and `drizzle.config.ts` outputs there; only `db:push` is documented. Schema changes are not reviewable/reversible; production upgrade path undefined.
- **Risk (needs verification):** `GeneralLedger.companyId` is denormalized and the schema comment says "A trigger must keep it in sync". README confirms triggers are **not** in any migration, so that invariant is currently unenforced at DB level.
- **Mitigated (ERP-004, uncommitted):** `main` was non-compiling across 6 commits without anyone being alerted. Tests + CI now cover this; CI itself has not yet run on GitHub.
- **Risk (code-read, NOT reproduced):** `server/routes/openingBalance.ts` checks "locked/closed" before its write transaction (PUT) and computes balance before setting the lock (POST /lock), without row locking, so a concurrent save and lock could interleave (ERP-012).
- **Latent (confirmed by test):** `toCents` truncates beyond 2 decimals while `mulRound2` rounds half-up (`shared/decimal.ts`). Today `toCents` only sees 2-decimal strings (`stockRecon.ts`), so no live effect (ERP-011).
- **Observation:** 22 master list endpoints took ~4 s total (~180 ms each) on a local seeded DB; likely per-row count queries. Not investigated (ERP-013).
- **Minor (confirmed):** `db:push` emits Postgres NOTICE that FK name `PurchaseDocumentTermAllocation_documentTermId_PurchaseDocumentTerm_id_fk` is truncated to 63 chars.
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
| Tests / CI | PARTIAL (uncommitted) | `tests/`, `vitest.config.ts`, `.github/workflows/ci.yml`, `scripts/test-db.mjs` | CI not yet run on GitHub; no tests for party/product/stock-opening/other masters | ERP-014 |
| Migrations | MISSING | — | see risks | ERP-003 |

---

## D. Prioritized backlog

| ID | Title | Pri | Status | Business objective | Dependencies | Acceptance criteria | Verification |
|---|---|---|---|---|---|---|---|
| ERP-001 | Restore corrupted `shared/masters.ts`; add Purchase/Sales Term definitions | P0 | **Done (pushed in `dc3a184`)** | App compiles and runs again | — | `tsc` clean, build clean, server starts, term CRUD+rules work | Section G |
| ERP-004 | Test + CI baseline | P1 | **Done (uncommitted)** | Prevent a repeat of ERP-001; safety net for accounting work | — | Vitest; unit tests for decimal + master definitions; API integration tests (master registry/CRUD, term rules, opening balance); GitHub Actions runs build + tests on Postgres | 154 tests pass; mutation checks; fresh-copy CI replay (section G). **Still needed:** first green run on GitHub |
| ERP-002 | Authentication, authorization, tenant isolation | P0 | **Deferred by owner (2026-10-20)** | Stop cross-company access and user spoofing before any real data | Decision: auth approach (see F) | Login; server derives user + allowed companies from session; every route checks company membership and role; `userId` never read from body; tests for cross-tenant denial | Authz tests |
| ERP-003 | Commit real migrations; move invariants into DB | P1 | **Ready — next** | Reviewable, repeatable schema changes | — | `drizzle/` un-ignored; baseline migration generated; GL.companyId sync trigger (or composite FK) in a migration; fresh-DB and upgrade paths tested; fix truncated FK name | Migrate on empty DB + `db:push` parity |
| ERP-005 | Journal Voucher posting service | P1 | Backlog | First real financial transaction | ERP-003, ERP-004 (ERP-002 deferred: service takes an explicit `actorUserId` so real auth plugs in later; until then it is dev-only) | Atomic post; Σdebit = Σcredit enforced in service **and** DB; fiscal-year open + not closed; GL active/company-scoped; numbering; reversal (never edit posted); audit fields | Concrete Dr/Cr example tests |
| ERP-006 | Cash/Bank Voucher | P1 | Backlog | Receipts/payments | ERP-005 | Same controls as ERP-005 | Tests |
| ERP-007 | Fiscal-year close + period lock | P2 | Backlog | Audit freeze | ERP-005 | Close blocks posting; carry-forward creates openings (schema has roll-forward trace column) | Tests |
| ERP-008 | Reports: Ledger, Trial Balance, P&L, Balance Sheet | P2 | Backlog | Financial visibility | ERP-005 | TB balances; BS equation holds; ties to control accounts | Tests |
| ERP-009 | Sales & Purchase documents + terms calc engine | P2 | Backlog | Core trade workflow | ERP-005, ERP-008 | Terms calculated in `sequence` order, SINGLE_TERM base earlier, landed-cost allocation, posts journal | Tests |
| ERP-010 | Hygiene: single lockfile, README/package manager, FK name length | P3 | Partly done (uncommitted) | Maintainability | — | Lockfile + README done; FK identifier truncation notice remains (folds into ERP-003) | Clean install |
| ERP-011 | Align `toCents` (truncates) with `mulRound2` (rounds) | P3 | Backlog | Avoid 1-paisa drift if both are ever mixed | — | One documented rounding rule; test updated (currently characterizes truncation) | `tests/decimal.test.ts` |
| ERP-012 | Close lock/save race in opening balance | P2 | Backlog | Locked balances must not change | ERP-004 | Check lock/closed state and write inside one transaction with a row lock; concurrent test | Concurrency test |
| ERP-013 | Master list latency | P3 | Backlog | Snappy screens | — | Measure; replace per-row count queries if confirmed | Timing before/after |
| ERP-014 | Extend tests: party, product, stock opening + reconciliation, sub-ledger, hierarchy/cross-company checks | P1 | Backlog | Cover the remaining existing workflows before building on them | ERP-004 | Each route has success + failure + invariant tests | CI green |

---

## E. Current task and next action

- **Current task:** ERP-004 (tests + CI) — implemented and verified locally; **uncommitted**, and CI has **not yet run on GitHub**.
- **Objective:** Make a repeat of ERP-001 (a broken `main` nobody noticed) impossible, and give later accounting work a regression net.
- **Work done:** Split `server/app.ts` out of `server/index.ts` (behavior unchanged; lets tests load the app). Added Vitest, 154 tests, a safe one-command test-DB runner, the CI workflow, pnpm cleanup.
- **Files changed (uncommitted):** `.env.example`, `.github/workflows/ci.yml` (new), `PROJECT_TRACKER.md`, `README.md`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `scripts/test-db.mjs` (new), `server/app.ts` (new), `server/index.ts`, `tests/*` (new: `helpers.ts`, `decimal`, `masters.definitions`, `api.terms`, `api.masters`, `api.openingBalance`), `vitest.config.ts` (new); `package-lock.json` deleted.
- **Remaining for ERP-004:** owner commits + pushes; confirm the first GitHub Actions run is green (workflow pins pnpm `12`; owner to confirm `pnpm -v`); run `pnpm test:db` once on Windows (script uses `shell: true`; untested on Windows).
- **Blocker:** none technical. Commit/push needs owner action.
- **Single best next action:** **ERP-003** — commit real migrations and move the `GeneralLedger.companyId` sync invariant into the database, because the voucher posting engine (ERP-005) must not be built on schema that is only `db:push`ed and has an unenforced cross-company invariant. Add a test for the invariant first (it should fail today), then the migration.

---

## F. Decisions and assumptions

**Confirmed (from code):**
- One shared master definition drives both UI and server validation (`shared/masters.ts`). Corrupting it breaks everything (ERP-001); `tests/masters.definitions.test.ts` now guards its structure.
- Term semantics follow `server/db/schema/billing.ts`: purchase and sales are separate schemas; header vs line via `isProductwise`; landed-cost distribution is purchase header terms only; SINGLE_TERM base must have a lower sequence.
- Money is `numeric`; arithmetic via BigInt in `shared/decimal.ts`.
- Display columns like `userName`/`branchName` are server-joined (`refs` in `server/masters.ts`); tests accept `<lookup>Id` -> `<lookup>Name`.

**Decisions made:**
- (S1) Restore `shared/masters.ts` from git history; term definitions come from one factory so purchase/sales stay identical.
- (S2) **Owner: skip login for now** (2026-10-20). ERP-002 deferred, not cancelled; the risk stays open in section B.
- (S2) **pnpm is the package manager.** Single lockfile `pnpm-lock.yaml`.
- (S2) Integration tests may only run against a **local database whose name contains "test"** (`TEST_DATABASE_URL`/`DATABASE_URL`; override flags exist but are for experts). In CI an unsafe/missing DB **fails** the run instead of skipping. `scripts/test-db.mjs` pins `DATABASE_URL_DIRECT` too, because `drizzle.config.ts` prefers it and a cloud value in `.env` could otherwise redirect `db:push`.
- (S2) `pnpm-workspace.yaml`: `allowBuilds: esbuild: true` (was an unresolved placeholder that made a clean `pnpm install` exit non-zero).

**Assumptions awaiting owner confirmation:**
- Auth approach when ERP-002 resumes (sessions vs Supabase Auth); `User` has no credential fields today.
- Deployment target (README suggests Supabase/Neon).
- Nepal-specific rules (VAT, BS fiscal calendar, PAN) are unspecified; confirm before tax work.
- "Master Account" modeled as an enum on Account Group, not a table — confirm intended.
- Owner's pnpm major version (CI pins `12`, matching the version used to generate/verify the lockfile here).

---

## G. Verification record

All run 2026-10-20 in the AI sandbox (Linux, Node 22, pnpm 12.14.0) against throwaway local PostgreSQL 16 databases — never the owner's database or production.

**Session 1 (ERP-001):** `tsc` failed on untouched `main` @ `699fa96`; passes after fix. `build`, `db:push`, `db:seed` pass. 16/16 ad-hoc API checks on term masters. (Superseded by the committed tests below.)

**Session 2 (ERP-004):**
| Check | Result |
|---|---|
| `pnpm exec tsc --noEmit` after `server/app.ts` split | PASS |
| Clean `pnpm install --frozen-lockfile` (twice) | exit 0 |
| `pnpm exec vitest run` on seeded `namoerp_test` | **154/154 PASS** (decimal 8, definitions 112, terms 9, masters 8, opening balance 17) |
| Mutation checks (temporarily broke the app, tests must fail): lock ignores imbalance; PUT ignores closed FY; term "base must run earlier" removed | **3/3 caught** (3, 1, 1 tests failed); code restored via `git checkout`; suite self-heals after a failed run |
| Fresh-copy CI replay, exact workflow steps with `CI=true`, no `.env`, empty DB: install `--frozen-lockfile`, `drizzle-kit push --force` (non-interactive), `db:seed`, `pnpm build`, `pnpm test` | all steps exit 0; 154/154 |
| `pnpm test:db` end to end | PASS (154/154) |
| Safety: runner refuses non-"test" DB name; refuses remote host; vitest skips integration tests (units still run) on a non-test DB; with `CI=true` the same situation FAILS the run | all behaved as designed |
| `pnpm build` (tsc + vite) in CI replay | PASS (same bundle hash as the owner's build: `index-D_Khb6XO.js`) |

**Not verified / not run:** the workflow on real GitHub Actions; `pnpm test:db` on Windows; any browser/UI check (owner's check of the two term screens was requested, result not yet reported); lint (none configured); routes without tests — party, product, stock opening, stock reconciliation, sub-ledger, user access, company/branch/fiscal-year masters beyond "list responds 200"; concurrency; `db:push` against an existing populated DB.

**Manual verification still required:** Purchase Term / Sales Term screens in the browser (conditional fields, Seq sorting, SINGLE TERM base error).

---

## H. Change log

### 2026-10-20 — Session 1 — ERP-001 + initial audit
- Found `main` non-compiling: `6c567d8` wiped `shared/masters.ts` (490 -> 0 lines); "restore" commits left a placeholder.
- Restored from history; added `termMaster()` (Purchase/Sales Term); created this tracker.
- Owner merged and pushed as `dc3a184` (local history had diverged from GitHub; resolved by keeping the local good file; `tsc` clean, 559 lines).

### 2026-10-20 — Session 2 — ERP-004
- Owner: skip login for now (ERP-002 deferred); use pnpm.
- Added Vitest + 154 tests, CI workflow, `pnpm test:db` runner with DB-safety guards, `server/app.ts` split, pnpm cleanup (lockfile, README, `allowBuilds`).
- New findings logged: ERP-011, ERP-012, ERP-013, ERP-014.
- Verification: section G. **Commit hash: none yet (uncommitted).**

---

## HANDOFF (end of session 2)

**Accomplished:** ERP-004 implemented and verified locally (tests, mutation checks, CI replay, safety guards). Tracker updated.

**Not accomplished:** nothing committed/pushed by me; CI not yet seen green on GitHub; no browser check; ERP-002 intentionally deferred; no new feature modules.

**Repo state:** changes are in the sandbox working tree and in the exported zip/patch; **not on GitHub**. Owner applies them, runs `pnpm install`, `pnpm test:db`, commits, pushes, and watches the Actions tab.

**Next task:** ERP-003 (migrations + DB-level company-consistency invariant), then ERP-014 (more tests), then ERP-005 (Journal Voucher posting). Reason: financial posting needs reviewable migrations and DB-enforced integrity first.
