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

- **Latest inspected commit:** `699fa96` ("Restore shared/masters.ts with Purchase Term and Sales Term master definitions")
- **Branch:** `main`
- **Working tree (end of session 1):** `shared/masters.ts` modified (fix, **uncommitted**), `PROJECT_TRACKER.md` new (**uncommitted**). Nothing committed or pushed.
- **Phase:** Foundation / master-data. Masters and opening-balance screens exist. **No transactional accounting yet** (no vouchers, sales, purchases, reports).

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
- Automated tests, linting, CI, committed migrations, deployment config, backup/restore procedure.

### Blockers and risks
- **Risk (confirmed):** No auth. `companyId` comes from the query string; `userId` for audit/lock comes from the request body (`server/routes/openingBalance.ts` lines ~100, ~158). Any client can read/write any company and impersonate any user.
- **Risk (confirmed):** `drizzle/` is in `.gitignore` and `drizzle.config.ts` outputs there; only `db:push` is documented. Schema changes are not reviewable/reversible; production upgrade path undefined.
- **Risk (needs verification):** `GeneralLedger.companyId` is denormalized and the schema comment says "A trigger must keep it in sync". README confirms triggers are **not** in any migration, so that invariant is currently unenforced at DB level.
- **Risk (confirmed):** No test or CI safety net. `main` was non-compiling across 6 consecutive commits (see ERP-001) without anyone being alerted.
- **Minor (confirmed):** `db:push` emits Postgres NOTICE that FK name `PurchaseDocumentTermAllocation_documentTermId_PurchaseDocumentTerm_id_fk` is truncated to 63 chars.
- **Minor:** Both `package-lock.json` and `pnpm-lock.yaml` are committed; README mixes `npm` and `pnpm`.

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
| Opening Balance | NEEDS TESTING | `server/routes/openingBalance.ts`, `src/screens/OpeningBalanceScreen.tsx` | `userId` trusted from client | tests (Dr=Cr, lock/unlock, closed FY) |
| Stock Opening + Reconciliation | NEEDS TESTING | `server/routes/stockOpening.ts`, `stockRecon.ts`, `shared/decimal.ts` | — | tests |
| Journal / Cash-Bank Vouchers | MISSING (schema only) | `server/db/schema/vouchers.ts` | No balanced-entry enforcement | ERP-005/006 |
| Sales / Purchase documents | MISSING | — | — | ERP-009 |
| Reports | MISSING | — | — | ERP-008 |
| Auth / permissions | MISSING | — | see risks | ERP-002 |
| Tests / CI / migrations | MISSING | — | see risks | ERP-003, ERP-004 |

---

## D. Prioritized backlog

| ID | Title | Pri | Status | Business objective | Dependencies | Acceptance criteria | Verification |
|---|---|---|---|---|---|---|---|
| ERP-001 | Restore corrupted `shared/masters.ts`; add Purchase/Sales Term definitions | P0 | **Done (uncommitted)** | App compiles and runs again | — | `tsc` clean, build clean, server starts, term CRUD+rules work | Section G |
| ERP-004 | Test + CI baseline | P1 | **Ready — next** | Prevent a repeat of ERP-001; safety net for accounting work | — | Vitest configured; unit tests for `shared/decimal.ts`; API integration tests (seed DB, master CRUD, term rules, opening-balance Dr=Cr/lock); GitHub Actions runs `tsc`, build, tests against a Postgres service | CI green on a PR |
| ERP-002 | Authentication, authorization, tenant isolation | P0 | **Ready — needs decision** | Stop cross-company access and user spoofing before any real data | Decision: auth approach (see F) | Login; server derives user + allowed companies from session; every route checks company membership and role; `userId` never read from body; tests for cross-tenant denial | Authz tests |
| ERP-003 | Commit real migrations; move invariants into DB | P1 | Backlog | Reviewable, repeatable schema changes | — | `drizzle/` un-ignored; baseline migration generated; GL.companyId sync trigger (or composite FK) in a migration; fresh-DB and upgrade paths tested; fix truncated FK name | Migrate on empty DB + `db:push` parity |
| ERP-005 | Journal Voucher posting service | P1 | Backlog | First real financial transaction | ERP-002, ERP-003, ERP-004 | Atomic post; Σdebit = Σcredit enforced in service **and** DB; fiscal-year open + not closed; GL active/company-scoped; numbering; reversal (never edit posted); audit fields | Concrete Dr/Cr example tests |
| ERP-006 | Cash/Bank Voucher | P1 | Backlog | Receipts/payments | ERP-005 | Same controls as ERP-005 | Tests |
| ERP-007 | Fiscal-year close + period lock | P2 | Backlog | Audit freeze | ERP-005 | Close blocks posting; carry-forward creates openings (schema has roll-forward trace column) | Tests |
| ERP-008 | Reports: Ledger, Trial Balance, P&L, Balance Sheet | P2 | Backlog | Financial visibility | ERP-005 | TB balances; BS equation holds; ties to control accounts | Tests |
| ERP-009 | Sales & Purchase documents + terms calc engine | P2 | Backlog | Core trade workflow | ERP-005, ERP-008 | Terms calculated in `sequence` order, SINGLE_TERM base earlier, landed-cost allocation, posts journal | Tests |
| ERP-010 | Hygiene: single lockfile, README/package manager, FK name length | P3 | Backlog | Maintainability | — | One package manager documented | Clean install |

---

## E. Current task and next action

- **Current task:** ERP-001 — complete in working tree, awaiting owner commit.
- **Objective:** Make `main` compile and run; deliver Purchase Term / Sales Term masters.
- **Work done:** Restored `shared/masters.ts` from `6c567d8^` (last complete 490-line version); added `termMaster("purchase"|"sales")` plus option lists; type-check, build, schema push, seed, and API rule tests all pass.
- **Files changed:** `shared/masters.ts`, `PROJECT_TRACKER.md` (new).
- **Remaining:** Owner reviews and commits. **Browser/UI check of the two new screens was NOT done** (no browser in the sandbox).
- **Blocker:** None technical. Commit/push needs the owner's authorization.
- **Single best next action:** **ERP-004** — add Vitest + API integration tests + GitHub Actions CI. Not blocked, small, and it protects everything after it. Then ERP-002 once the auth decision is made.

---

## F. Decisions and assumptions

**Confirmed (from code):**
- One shared master definition drives both UI and server validation (`shared/masters.ts`). Consequence: corrupting that file breaks everything, which is what happened.
- Term semantics follow `server/db/schema/billing.ts` comments: purchase and sales are separate schemas; header vs line via `isProductwise`; landed-cost distribution is purchase header terms only; SINGLE_TERM base must have a lower sequence.
- Money is `numeric`, arithmetic via BigInt in `shared/decimal.ts`.

**Decisions made this session:**
- Restore `shared/masters.ts` from git history rather than rewrite; term definitions generated by one factory to keep purchase/sales identical. Consequence: `distributeToLines`/`allocationBasis` appear only for purchase.

**Assumptions awaiting owner approval:**
- Auth approach for ERP-002 (not yet chosen): e.g. email+password with server sessions vs an external provider (Supabase Auth is plausible since README mentions Supabase). `User` has no credential fields today, so this needs a schema change.
- Intended deployment target (README suggests Supabase/Neon).
- Nepal-specific rules (VAT, BS fiscal calendar, PAN) have not been specified; must be confirmed before tax work, not assumed.
- "Master Account" as an enum rather than a table: confirm that is intended.

---

## G. Verification record

All run 2026-10-20 in the AI sandbox against a throwaway local PostgreSQL 16 (not the owner's DB, not production).

| Check | Result |
|---|---|
| `npx tsc --noEmit` on untouched `main` @ `699fa96` | **FAILED** — `shared/masters.ts` "is not a module" + cascading implicit-any errors (dozens) |
| `npx tsc --noEmit` after fix | PASS (exit 0) |
| `npm run build` (`tsc` + `vite build`) after fix | PASS (1602 modules; ~286 kB JS) |
| `drizzle-kit push` on empty DB | PASS (one NOTICE: truncated FK identifier) |
| `npm run db:seed` | PASS ("Seed done.") |
| API: `/api/health`, list purchase-terms (3 seeded), list sales-terms (3 seeded) | PASS |
| API term rule tests (`/tmp` script, not committed): create 201, case-insensitive duplicate 409, SINGLE_TERM needs/forbids base, base must have lower sequence, distribute needs basis, distribute rejected for productwise, negative default rejected, foreign GL rejected, delete blocked when dependent exists, update 200, sales variant | **16/16 PASS** (first run showed 6 mismatches that were my wrong expected status codes, not app bugs; re-run with correct expectations) |

**Not verified / not run:** any automated tests (none exist), lint (none configured), UI in a browser, opening-balance and stock-opening endpoints, other masters' CRUD, concurrency/duplicate-submit behavior, `db:push` against an existing populated DB, any deployment.

**Manual verification still required:** open Purchase Term and Sales Term screens in the browser — check conditional fields (Base Term appears for SINGLE TERM; landed-cost fields only for non-productwise purchase terms), tab order, keyboard shortcuts, list sorting by Seq.

---

## H. Change log

### 2026-10-20 — Session 1 — ERP-001 + initial audit
- **Found:** `main` did not compile. Commit `6c567d8` wiped `shared/masters.ts` (490 → 0 lines); later "restore" commits (`ff38db8`…`699fa96`) left a one-line `// PLACEHOLDER`.
- **Changed:** `shared/masters.ts` (restored + `termMaster()` factory, 5 option lists, Purchase/Sales Term registered); created `PROJECT_TRACKER.md`.
- **Verification:** section G.
- **Remaining issues:** section B risks; UI check of term screens.
- **Commit hash:** none (not committed).

---

## HANDOFF (end of session 1)

**Accomplished:** Cloned and audited the repo. Found and fixed the P0 break on `main`. Delivered Purchase/Sales Term masters and verified them at API level on a real Postgres. Created this tracker.

**Not accomplished:** No commit/push (not authorized). No browser check. No tests/CI yet. Auth, migrations, vouchers untouched.

**Repo state:** Changes exist only in the sandbox working tree and in the exported patch; **they are not on GitHub**. To publish: `git apply` the patch (or copy `shared/masters.ts` and `PROJECT_TRACKER.md`), review, commit, push.

**Next task:** ERP-004 (tests + CI). Reason: unblocked, cheap, and the repo just proved it needs a safety net. Immediately after: ERP-002 (needs the auth decision in section F) and ERP-003.
