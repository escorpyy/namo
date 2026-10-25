# NAMO ERP — PROJECT TRACKER

> Continuity document. Code and verified behavior outrank this file. Re-verify before trusting any status.
> No secrets are recorded here.

---

## A. Project identity

| Item | Value |
|---|---|
| Repository | https://github.com/escorpyy/namo |
| Default branch | `main` (verified via `origin/HEAD`) |
| Active dev branch | `main`. Remote also lists `claude/purchase-bill-schema` (merged via PR #2; can be deleted). Owner commits straight to `main` |
| Frontend | React 18 + Vite 5 + Tailwind 3 + TypeScript 5 |
| Backend | Express 4 + TypeScript (run with `tsx`) |
| Database / ORM | PostgreSQL 16 + Drizzle ORM 0.44.7 (committed migrations in `drizzle/`, applied with `pnpm db:migrate`; `db:push` only for throw-away experiments) |
| Validation | zod, driven by `shared/masters.ts` (single source for UI + server) |
| Deployment | None found. `npm run build && npm start` serves `dist/` from Express. `docker-compose.yml` = local Postgres only |
| Release / milestone | None established (package version 0.1.0) |
| Last actual audit | 2026-10-25 (session 15: ERP-024 part 1 applied as `b7f4882`; `pnpm test:db` passed 490/490 twice on disposable PostgreSQL 16; `pnpm build` passed; Drizzle found no schema changes. No owner DB migration, Actions check, UI, concurrency or mutation checks in session 15. Review caveats are recorded below). |

---

## B. Current project state

- **Latest inspected application commit:** `b7f4882` (ERP-024 part 1: database audit trail, migration 0008 and 24 tests), on top of `d3621a2`; pushed to GitHub `main` in session 15.
- **Branch:** `main`
- **Working tree (session 15 after this update):** clean; ERP-024 commit `b7f4882` and the tracker update are on GitHub `main`.
- **Package manager:** pnpm (owner's choice). `package-lock.json` removed in the ERP-004 changes.
- **Phase:** Foundation / master-data, with purchase documents wired through schema/DB triggers, service, API routes, and React screens. The database-backed purchase/API tests now pass in the sandbox; manual UI/end-to-end verification remains open, as does owner dev-DB migration verification. Authentication remains absent. Generic vouchers, sales, and reports are still missing.

### Verified complete (session 6 evidence in section G; earlier items from sessions 1-5)
- Master CRUD engine + the 22 master screens' API layer starts and serves (health, list, create, validation, delete guard exercised for the two term masters only; other masters not re-tested this session).
- Purchase Term / Sales Term masters (after ERP-001 fix); both screens confirmed in the browser by the owner (2026-10-22).
- (Session 8; committed as `1079c7d`; **re-verified on the pushed commit in session 9**) ERP-018: database constraint errors answer a clear 409 and nothing else leaks SQL; **421/421 tests pass twice in a row** (18 files; session 9 re-ran drift check, build and the suite on `1079c7d`). Evidence in section G.
- (Session 7) `69b5559`: migrations 0000-0006 apply on an empty DB, seed runs, `drizzle-kit generate` reports no drift, `pnpm build` succeeds, 411/411 tests pass, twice in a row (17 files).
- (Session 7) Purchase service **as exercised by its own tests**: draft pricing, landed cost, order -> challan -> bill quantity control, posting with Dr = Cr, immutability after posting, reversal, additional bills. 32 service + 15 calculation + 26 order/challan DB + 21 bill DB tests pass. Not mutation-checked (see G).
- (Session 5) API tests now cover Product (31), Stock Opening + reconciliation (44), Sub Ledger (11), Users + User Access (14), Company / Branch / Fiscal Year (26); evidence in section G.

### Partially implemented
- **Purchase Order -> Challan -> Bill (schema + service + API + UI):** Tables/migrations 0003-0006, DB triggers, service layer, `/api/purchase` routes, Purchase Order/Challan/Bill screens, and shared line/terms grids; feature commit `23001a6`. The 23 purchase API tests and purchase service/DB tests passed as part of the 466/466 session 13 full-suite runs on PostgreSQL 16. **Gaps:** no authentication/authorization (ERP-002; company/user identifiers remain caller-supplied); posted-bill edit behavior conflicts with S9 (ERP-026); stock ledger/inventory accounting and the owner’s inventory-method decision; concurrency/mutation tests; owner dev-DB migration and manual UI verification.
- Opening Balance grid: API tested (17 tests); UI **not** checked.
- Stock Opening grid + stock reconciliation: API tested (44 tests, session 5); UI **not** checked.
- Billing-terms schema: purchase order/bill forms now consume document terms; a Sales-document consumer does not exist yet.
- Accounting hierarchy: tables exist for Account Group → Sub Group → General Ledger → Sub Ledger; "Master Account" (Asset/Liability/Equity/Revenue/Expense) appears to be an enum on Account Group, not a table (**verify**).

### Confirmed missing
- Authentication, authorization, tenant isolation.
- **Generic** Journal Voucher / Cash-Bank Voucher posting remains missing (no generic service, route, or UI); purchase-bill routes invoke the private writer in `server/services/purchase/purchaseBill.ts`. Dr = Cr is enforced at commit (ERP-016, migration 0007); audit trail part 1 now logs selected financial tables (ERP-024, migration 0008), but direct INSERTs into AuditLog are not restricted. Company lock date and required-reason controls remain open; S9 allows edits in open periods.
- Purchase documents now have service, API routes, and UI screens; their DB/API tests passed in session 13, but the screens have not been manually verified. Stock ledger/inventory accounting, Sales documents, Returns, Tax/VAT, and Depreciation remain missing.
- Reports (Trial Balance, P&L, Balance Sheet, Ledger).
- Audit trail: **part 1 implemented and pushed in session 15 (`b7f4882`, migration 0008)**: a database trigger logs INSERT / UPDATE / DELETE for vouchers and lines, purchase bills / lines / import detail / terms / allocations, and opening balances, with company, caller-supplied user, and optional reason. UPDATE, DELETE, and TRUNCATE are blocked. **Remaining:** direct INSERTs by a role with table access can forge log rows; caller-supplied actor is not authenticated (ERP-002), and the opening-balance route does not reject inactive users; nested service savepoints leave transaction-local actor/reason settings in the outer transaction; require reasons for posted-document edits (with ERP-026), add log-read API/views, decide whether orders/challans/stock openings are audited, and resolve history before migration 0008. Do not treat the log as tamper-proof until the DB-role/insert issue is addressed.
- Company lock (closing) date: no such column in the schema; only the year-level `FiscalYear.isClosed` and `isOpeningBalanceLocked` exist. Decision S9 needs it (ERP-025).
- Fiscal-year close workflow; closed-period posting control.
- Linting, deployment config, backup/restore procedure. (Tests + CI exist: ERP-004; migrations are committed: ERP-003.)

### Blockers and risks
- **Risk (confirmed; owner chose to defer login on 2026-10-20 — ERP-002):** No auth. The purchase routes also accept `companyId` and `userId` from the request body/query; there is no user-to-company or role authorization. Do not expose this app on a shared network or cloud with real data until ERP-002 is done. Existing opening-balance routes likewise trust caller-supplied company/user identifiers.
- **ERP-024 audit-trail caveat (reviewed session 15):** the trigger blocks UPDATE / DELETE / TRUNCATE but does not prevent a database role with INSERT permission from fabricating AuditLog rows; the runtime role/privilege model is not separated. `inActorTx` uses transaction-local settings in a nested savepoint, which remain set in the caller transaction after savepoint release. Opening-balance writes also accept an existing inactive user id. These are follow-ups before relying on the trail as tamper-proof.
- **Resolved by ERP-003 (committed `7547005`):** migrations are committed (`drizzle/0000_baseline.sql`, `0001_account_company_integrity.sql` + `meta/`); `drizzle/` is no longer gitignored; `pnpm db:migrate` / `db:baseline` / CI drift check added. **Owner's dev DB (2026-10-22): `pnpm db:baseline` refused with "Migration history already exists; nothing to baseline" (exit code 1 is how that script reports a refusal; it changes nothing), so the DB already had migration history; `pnpm db:migrate` then reported "Migrations applied".**
- **Resolved by ERP-003 (committed `7547005`):** the account-hierarchy company invariant (`GeneralLedger.companyId` = its Account Group's company; parent ledger same company) is now enforced by 3 DB triggers. Before the fix the DB accepted such rows (proven by 6 failing tests); the API already rejected them ("Sub Group not found in this company"), so the master screens were never exposed.
- **Resolved by ERP-015 (committed `7547005`):** the cross-company gap on the other tables (e.g. `OpeningBalance` accepted `companyId=2` pointing at a company-1 ledger) is closed for all 41 registered tables / 68 links by one registry-driven trigger; a record's company can no longer change. Voucher posting now exists in the purchase-bill service, voucher balance (Dr = Cr) is DB-enforced from migration 0007 (ERP-016, session 12).
- **Mitigated (ERP-004):** `main` was non-compiling across 6 commits without anyone being alerted. Tests + CI now cover this (first CI run, on `0fd03ab`, green).
- **Risk (code-read, NOT reproduced):** `server/routes/openingBalance.ts` checks "locked/closed" before its write transaction (PUT) and computes balance before setting the lock (POST /lock), without row locking, so a concurrent save and lock could interleave (ERP-012).
- **Latent (confirmed by test):** `toCents` truncates beyond 2 decimals while `mulRound2` rounds half-up (`shared/decimal.ts`). Today `toCents` only sees 2-decimal strings (`stockRecon.ts`), so no live effect (ERP-011).
- **Resolved by ERP-018 (session 8; committed `1079c7d`):** database errors used to answer HTTP 500 with the SQL text and parameters because the handler read `err.code`, while drizzle-orm 0.44.7 puts the Postgres code on `err.cause.code`. Now `pgError()` (`server/routes/_util.ts`) finds the real `PostgresError` through `.cause` and `errorHandler` (`server/app.ts`) maps 23505 / 23503 / 23514 to 409 using the Postgres code and its clean message; every other error answers a generic `{message: "Server error"}` 500 (full error only in the server log). 10 new tests (`tests/api.dbErrors.test.ts`), the old `it.fails` became a plain test; 5 mutation checks caught. **Behaviour changes to know about:** (a) unknown 500s no longer carry the real message (the UI just shows `data.message`, so it will say "Server error"); (b) a foreign-key failure on a non-DELETE request now says "A linked record does not exist or can no longer be used." instead of the misleading "Cannot delete"; (c) an object with a `code` of 23505 that is not a `PostgresError` is no longer treated as a duplicate (the old handler did).
- **Defect (reproduced session 5, STILL PRESENT in `dbf5b4b`: `server/app.ts` line 17 is a bare `express.json()` — ERP-017; session 8 note: oversize and malformed-JSON body errors still answer 500, now with the generic message instead of the parser's text):** `PUT /api/stock-opening` has a 5000-row limit that can never trigger: `express.json()` keeps its 100 KB default (about 1,300 minimal rows; fewer with batch/expiry) and an oversized body is answered 500 (same handler gap). Saving a few thousand stock lines in one go fails with a server error.
- **Observation:** 22 master list endpoints took ~4 s total in the AI sandbox but ~1.3 s on the owner's machine (his `pnpm test:db` output). Probably a slow sandbox, not a defect; ERP-013 downgraded to "measure only if it shows up in real use".
- **Resolved by ERP-003 (committed `7547005`):** that FK now has an explicit short name (`PurchaseDocTermAlloc_documentTermId_fk`); no identifier in the migrations exceeds 63 chars (scanned).
- **Resolved in ERP-004 changes:** single lockfile (`pnpm-lock.yaml`); README now says pnpm; `pnpm-workspace.yaml` `allowBuilds` placeholder set (`esbuild: true`) because a fresh/CI `pnpm install` failed on it.

---

- **Risk (new, session 6):** the Purchase Bill tables rely on a polymorphic link (`PurchaseDocumentTerm.documentType` + `documentId`, no foreign key) that is checked by triggers (`check_purchase_bill_term`, `check_purchase_bill_allocation`, cleanup on delete). That is covered by the 21 DB tests, but the same pattern will be needed for Sales; keep every new document type in that trigger set. Also: bill totals are not DB-checked against their lines, so a future service bug could store inconsistent totals (see ERP-020).
- **Resolved in part by ERP-016 (session 12, migration 0007, committed as `624a73c` and pushed in session 13):** unbalanced vouchers are now refused by deferred constraint triggers on `JournalVoucherLine` and `CashBankVoucherLine` (SQLSTATE 23514, which the API answers as 409). What remains open is the audit trail (ERP-024) and the lock date (ERP-025). Original note: **Risk (confirmed in the catalog, session 7 — raised ERP-016 priority):** real code now writes posted vouchers, yet the database had no balance constraint and no immutability guard on `JournalVoucher` / `JournalVoucherLine` (no CHECK or UNIQUE on either beyond keys; only `namo_company_consistency` triggers). A future code path, a manual SQL fix or a bug could store an unbalanced or edited posted voucher without the database objecting. Not reproduced as an exploit; absence of the constraint was read from `pg_trigger` / `pg_constraint`. **Session 10:** decision S9 narrows this risk. An unbalanced voucher was a risk (ERP-016: Dr = Cr), but "posted vouchers must be immutable" is no longer the goal; editing in an open period is intended, and the protection becomes the audit log (ERP-024) plus the lock date (ERP-025).
- **Accounting-policy question (session 7, for the owner):** the posting debits each product's *purchase ledger* and no stock ledger / inventory movement exists, while landed cost is computed per line for valuation. Is Namo meant to use a periodic method (purchases expense, stock adjusted at period end) or a perpetual one (Dr Inventory on receipt)? Not assumed; it decides ERP-020's stock and COGS design.
- **Unverified (session 6/7):** migrations 0003-0006 on (a) the owner's existing dev DB (owner must run `pnpm db:migrate`), (b) a legacy `db:push` DB, (c) a DB containing rows that violate the new rules. Only the fresh-DB path was run.

## C. Module inventory

| Module | Status | Evidence / files | Known defects | Remaining |
|---|---|---|---|---|
| Master engine (generic CRUD, dup check, delete guard; DB errors answered as 409, ERP-018) | COMPLETE for current scope (generic CRUD covered by `tests/api.masters.test.ts`; custom rules per master: see the per-master rows and ERP-019) | `server/routes/masterFactory.ts`, `shared/masters.ts`, `server/masters.ts`; exercised via term masters | none found | automated tests |
| Account Group / Sub Group / GL / Sub Ledger masters | PARTIAL: Sub Ledger TESTED (11 tests); Account Group / Sub Group / GL only by the generic tests | `server/db/schema/accounting.ts`, `shared/masters.ts`, `tests/api.subLedger.test.ts` | none found (company triggers exist since ERP-003/015) | tests for GL custom rules (ERP-019) |
| Party (Customer/Vendor) | TESTED (API, 14 tests) | `server/routes/party.ts` (transactional GL+Party+detail), `tests/api.party.test.ts` | — | UI check |
| Product (5 types) | TESTED (API, 31 tests, session 5) | `server/routes/product.ts`, `tests/api.product.test.ts` (per-type rules, links must be same company, uniqueness, type locked, all-or-nothing update, delete guards) | none found | UI check |
| Company / Branch / Fiscal Year / User / User Access | TESTED (API, 40 tests, session 5); roles still not enforced | `tests/api.company.test.ts` (26), `tests/api.userAccess.test.ts` (14) | Roles recorded, not enforced; FY close workflow missing | auth, FY close |
| Area / Sub Area / Agent / Units / Tax Rate / Stock Category / Location / Product Groups | NEEDS TESTING (generic tests only) | masters + seed | — | tests (ERP-019) |
| **Purchase Term / Sales Term** | **COMPLETE (masters only)** | `shared/masters.ts` `termMaster()`, `server/masters.ts` CFG, `server/db/schema/billing.ts`; 16/16 API checks (section G) | Term-default assignment (party/product) has no UI; purchase order/bill forms now consume document terms; no Sales-document term consumer yet | calc engine (ERP-009) |
| Opening Balance (API) | COMPLETE for current scope; UI NEEDS TESTING | `server/routes/openingBalance.ts`; 17 API tests (validation, exact totals, Dr=Cr before lock, edit blocked when locked/closed, restore) | `userId` trusted from client; possible lock/save race (ERP-012) | UI check; ERP-012 |
| Stock Opening + Reconciliation | TESTED (API, 44 tests, session 5); UI NEEDS TESTING | `server/routes/stockOpening.ts`, `stockRecon.ts`, `tests/api.stockOpening.test.ts` (value = Qty × Rate, decimals per unit, batch/expiry, uniqueness, all-or-nothing, lock/closed, per-branch reconciliation) | 5000-row cap unreachable, large saves answer 500 (ERP-017) | UI check; ERP-017 |
| Purchase Order / Challan / Bill (+ additional bill, reversal) | **PARTIAL: schema + service + API + UI; DB-backed tests pass; manual UI check outstanding** | `server/db/schema/purchase{Order,Challan,Bill}.ts`, `drizzle/0003-0006`, `server/services/purchase/*`, `server/routes/purchase.ts`, `src/screens/purchase/*`, `src/components/purchase/*`, `tests/api.purchase.test.ts` (23); service/calculation/API/DB tests | No auth/authorization; posted-bill edits conflict with S9; no stock ledger; no concurrency/mutation tests. Dr = Cr is DB-enforced (ERP-016). Session 13: full suite 466/466 twice on PostgreSQL 16 | Manual UI check; owner dev-DB migrations; ERP-002/020/022/024/025/026 |
| Journal / Cash-Bank Vouchers | PARTIAL: private purchase-bill voucher writer is used by purchase-bill routes; no generic posting service/route/UI. **Dr = Cr is DB-enforced at commit (ERP-016, migration 0007, 22 tests)** | `server/db/schema/vouchers.ts`, `drizzle/0007_voucher_balance.sql`, `tests/db.voucherBalance.test.ts`, `writeVoucher` in `server/services/purchase/purchaseBill.ts` | No lock-date guard, no audit writer (ERP-024, ERP-025) | ERP-005 (generalise the writer), ERP-006, ERP-024, ERP-025 |
| Sales documents | MISSING | — | — | ERP-009 |
| Reports | MISSING | — | — | ERP-008 |
| Auth / permissions | MISSING (deferred by owner) | — | see risks | ERP-002 |
| Tests / CI | Session 13 `pnpm test:db`: **466 tests passed twice across 20 files** on PostgreSQL 16; `pnpm build` passed; Drizzle generation check reported no schema changes. Historical sessions 8-9: 421 tests passed twice; session 11 had 309 DB-backed tests skipped before session 12 provisioned a local test DB | `tests/`, `vitest.config.ts`, `.github/workflows/ci.yml`, `scripts/test-db.mjs` | No manual UI, owner dev-DB migration, GitHub Actions check, or concurrency run in session 13; mutation checks reported by session 12 patch author but not repeated in session 13 | Owner: check Actions; run `pnpm db:migrate` on dev DB; ERP-017/019/022 |
| Migrations + DB integrity (account hierarchy + all tenant tables + purchase bill) | COMPLETE for current scope (0000-0002 in `7547005`; 0003-0005 in `dbf5b4b`; 0006 in `69b5559`; 0007 in `624a73c`) | `drizzle/0000-0007`, `server/db/migrate.ts`, `server/db/baseline.ts`, `tests/db.integrity.test.ts` (8), `tests/db.companyConsistency.test.ts` (15), `tests/db.purchaseBill.test.ts` (21), `tests/db.purchaseOrderChallan.test.ts` (26), `tests/db.voucherBalance.test.ts` (22) | none known in fresh local test database; owner dev-DB migration remains unverified | ERP-005 |

---

## D. Prioritized backlog

| ID | Title | Pri | Status | Business objective | Dependencies | Acceptance criteria | Verification |
|---|---|---|---|---|---|---|---|
| ERP-001 | Restore corrupted `shared/masters.ts`; add Purchase/Sales Term definitions | P0 | **Done (pushed in `dc3a184`)** | App compiles and runs again | — | `tsc` clean, build clean, server starts, term CRUD+rules work | Section G |
| ERP-004 | Test + CI baseline | P1 | **Done (pushed `0fd03ab`; first CI run green)** | Prevent a repeat of ERP-001; safety net for accounting work | — | Vitest; unit tests for decimal + master definitions; API integration tests (master registry/CRUD, term rules, opening balance); GitHub Actions runs build + tests on Postgres | 154 tests pass; mutation checks; fresh-copy CI replay (section G). First GitHub Actions run (`39455007886`) green |
| ERP-002 | Authentication, authorization, tenant isolation | P0 | **Deferred by owner (2026-10-20)** | Stop cross-company access and user spoofing before any real data | Decision: auth approach (see F) | Login; server derives user + allowed companies from session; every route checks company membership and role; `userId` never read from body; tests for cross-tenant denial | Authz tests |
| ERP-003 | Commit real migrations; move invariants into DB | P1 | **Done (committed `7547005`)** | Reviewable, repeatable schema changes | — | `drizzle/` un-ignored; baseline migration; GL company triggers (+ parent-ledger rule, group/sub-group move guards, pre-flight on dirty data); fresh-DB and legacy-DB upgrade paths; FK name fixed; CI drift check | See section G (fresh DB, legacy `db:push` DB, dirty DB, idempotence, drift, 162 tests) |
| ERP-005 | Journal Voucher posting service: **generalise** the purchase service's private `writeVoucher` / balance check / reversal into one shared service (do not build a second poster) | P1 | Backlog | Shared posting foundation for sales and non-purchase transaction workflows | ERP-014, ERP-016, ERP-024, ERP-025 (ERP-015 done; ERP-002 deferred: service takes an explicit `actorUserId` so real auth plugs in later; until then it is dev-only) | Atomic post; Σdebit = Σcredit enforced in service **and** DB; fiscal-year open + not closed; date after the company lock date (ERP-025); GL active/company-scoped; numbering; edit and delete of a posted voucher allowed in an open period and audit-logged (S9, ERP-024); reversal stays available as a correction route; audit fields | Concrete Dr/Cr example tests |
| ERP-006 | Cash/Bank Voucher | P1 | Backlog | Receipts/payments | ERP-005 | Same controls as ERP-005 | Tests |
| ERP-007 | Fiscal-year close + period lock | P2 | Backlog | Audit freeze | ERP-005, ERP-025 | Close blocks posting; carry-forward creates openings (schema has roll-forward trace column); the year close and the company lock date (S9, ERP-025) agree on what is frozen | Tests |
| ERP-008 | Reports: Ledger, Trial Balance, P&L, Balance Sheet | P2 | Backlog | Financial visibility | ERP-005 | TB balances; BS equation holds; ties to control accounts | Tests |
| ERP-009 | Sales documents; reuse the purchase terms calc engine (`server/services/purchase/terms.ts`, `docTerms.ts`) | P2 | Backlog (purchase side done under ERP-020's service) | Core trade workflow | ERP-005, ERP-008 | Terms calculated in `sequence` order, SINGLE_TERM base earlier, landed-cost allocation, posts journal | Tests |
| ERP-010 | Hygiene: single lockfile, README/package manager, FK name length | P3 | **Done** (lockfile + README in `0fd03ab`; FK rename in `7547005`) | Maintainability | — | Lockfile + README done; FK now has an explicit short name (ERP-003) | Clean install |
| ERP-011 | Align `toCents` (truncates) with `mulRound2` (rounds) | P3 | Backlog | Avoid 1-paisa drift if both are ever mixed | — | One documented rounding rule; test updated (currently characterizes truncation) | `tests/decimal.test.ts` |
| ERP-012 | Close lock/save race in opening balance | P2 | Backlog | Locked balances must not change | ERP-004 | Check lock/closed state and write inside one transaction with a row lock; concurrent test | Concurrency test |
| ERP-016 | Per-voucher balance (Dr = Cr) enforced in the database at commit (narrowed by decision S9; the earlier "posted vouchers immutable" half was dropped) | P1 | **Done and pushed in `624a73c` (session 13)** | Books cannot be unbalanced, even by a buggy code path or a manual edit | ERP-005 design | Deferred (commit-time) constraint trigger on the line tables of both voucher types: sum of debits = sum of credits per voucher, so an edit that deletes and re-inserts lines inside one transaction is allowed; readable message with `ERRCODE = 'check_violation'` (ERP-018 turns it into 409); tests with concrete Dr/Cr examples, including edits that rewrite the lines | Session 12: 22 new tests red-first and 7 mutation checks caught; session 13: 466/466 twice, build and drift check passed |
| ERP-013 | Master list latency | P3 | Backlog (low) | Snappy screens | — | Only if slowness appears in real use on the owner's machine (his run: 22 lists in ~1.3 s) | Timing |
| ERP-015 | DB-level company consistency for all tenant-scoped links (OpeningBalance, StockOpening, SubLedger, Party, Voucher tables…) | P1 | **Done (committed `7547005`)** | A bug or new code path must not be able to mix companies' books | ERP-003 | Registry-driven generic trigger (`namo.company_source`/`company_link`) covering every tenant-scoped table; completeness test fails CI if a new FK is unregistered; audit function; migration with dirty-data pre-flight | 15 tests red-then-green; mutation checks; legacy + dirty upgrade paths (section G) |
| ERP-014 | Extend tests: party, product, stock opening + reconciliation, sub-ledger, user access, company/branch/fiscal-year masters | P1 | **Done (party `a2e6a31`; the other five files `60a1cd0`, merged to `main` in `dbf5b4b`)** | Cover the remaining existing workflows before building on them | ERP-004 | Each route has success + failure + invariant tests | 317/317 in session 5; **re-verified in session 6 on the merged `main`: 338/338 twice** (317 + 21 purchase-bill DB tests). Mutation checks on every file (session 5). Remaining owner item: check the GitHub Actions run |
| ERP-018 | Map database errors correctly: read the Postgres error from `err.cause`; never return SQL text to clients | P1 | **Done (committed `1079c7d`); CI status unread: owner to check** | The DB safety net must answer 409, and clients must never see SQL | — | `pgError()` finds the PostgresError through `.cause`; 23505 / 23503 / 23514 -> 409 with safe messages; unknown errors -> generic 500, details only in the log; the `it.fails` test became a plain `it`; real-error tests for each code | 421/421 twice; 10 new tests red first (9 failed for the right reasons), then green; 5 mutation checks caught (section G) |
| ERP-017 | Stock opening: a save of more than ~1,300 rows answers 500; the 5000-row rule is unreachable | P2 | **Backlog (reproduced)** | Large catalogues must save, or be refused with a clear message | ERP-018 (same error handler) | Raise the JSON body limit for that route (or save in pages); also answer malformed JSON 400 (the generic handler now answers any body-parser error as 500 "Server error"); `entity.too.large` answered 413 with a message; the 5000-row rule reachable and tested; the `it.fails` test in `tests/api.stockOpening.test.ts` becomes a plain `it` | Same signal |
| ERP-019 | Tests for the remaining custom master rules: General Ledger (parent hierarchy and cycles, party-linked ledgers, "Requires Sub Ledger" toggle), Location hierarchy, Account Group / Sub Group, and the simple masters (Area, Sub Area, Agent, Unit, Tax Rate, Stock Category, Product Group) | P2 | Backlog | Finish covering every existing master before building on them | ERP-004 | Success + failure + invariant tests per master | CI green |

| ERP-020 | Purchase documents: API routes + screens (order, challan, bill), permissions, and the stock/inventory accounting decision | P2 | **PARTIAL: routes/screens and 23 API tests added and pushed in `23001a6`; DB-backed tests passed 466/466 in session 13; auth, inventory decision, and manual UI verification remain** | Make the existing service usable | ERP-018, ERP-016, ERP-002 (or an explicit dev-only actor), owner's inventory-method answer (section B) | Routes call `server/services/purchase` only (no duplicated logic); server-side validation and company scoping; errors map to 4xx; screens for order, challan, bill with keyboard entry; route tests incl. cross-company denial and double-post; stock ledger / inventory posting per the owner-selected decision | DB-backed route tests; manual UI check remains |
| ERP-022 | Harden the purchase layer: mutation-check the 73 service tests and 23 API tests; add concurrent tests (two posts of one bill, two numberings, billing the same challan quantity twice) | P2 | Backlog | Prove the service and routes hold under real use | — | Each business rule broken on purpose makes a test fail; concurrent tests pass; any race found is fixed | Mutation + concurrency runs |
| ERP-023 | Error-handling follow-ups from ERP-018: make `translate()` in `server/services/purchase/common.ts` use `pgError()` (it has its own copy of the `.cause` logic); decide answers for other client-fixable SQLSTATEs now generic 500 (23502 not-null, 22001 too long, 22003 out of range, 22P02 bad text); `/api/health` still returns the raw error message | P3 | Backlog | One consistent, safe error contract | ERP-018 committed (**satisfied: `1079c7d`**) | Single helper; chosen codes mapped to 400/409 with tests; health returns no internals | Tests |
| ERP-021 | Housekeeping: delete merged branch `claude/purchase-bill-schema`; decide whether tracker/PR descriptions should record the purchase-bill design rules (currently only in schema comments and migration SQL) | P3 | Backlog | Tidy repo | — | Branch removed by the owner; design rules mirrored in section F | — |
| ERP-024 | Audit trail for financial documents: who, when, old and new values, written by the database | P1 | **PART 1 DONE and pushed in `b7f4882`; integrity follow-ups remain** | In an open period posted documents may be edited, so every change must be traceable (S9) | ERP-002 for authenticated actor identity | Part 1: trigger logs changes to 10 tables, company and caller actor/reason settings, UPDATE/DELETE/TRUNCATE guards, `companyId` (S11). **Open:** prevent forged direct INSERTs by runtime DB roles; ensure actor/reason context does not leak past nested savepoints; validate active actors on opening-balance writes; require a reason for posted-document changes with ERP-026; add per-company log reads; decide whether orders, challans and stock openings are audited | `tests/db.auditTrail.test.ts` (24); patch author reports 12 mutations caught; not repeated in session 15 |
| ERP-025 | Company lock (closing) date and its override | P1 | Backlog | Freeze old periods without closing the whole year, like the QuickBooks closing date (S9) | ERP-024, ERP-016 | One lock date per company; creating, editing or deleting a voucher, voucher line, bill or other covered document dated on or before it is refused (database guard plus service check); override only with the lock password or an admin permission (either, per the owner); every override is audit-logged; the password is stored hashed and never appears in the tracker, logs or error messages; until ERP-002 only the password path can exist (roles are not enforced); covered documents: vouchers and their lines, purchase bills and their lines (terms and allocations included); the override allows one edit at a time (asked again for the next, no standing unlock window), needs a reason and is audit-logged (my choices, S9); the relation to `FiscalYear.isClosed` is stated and tested | Tests: before / on / after the date, override, wrong password |
| ERP-026 | Purchase service: allow editing and deleting a posted bill in an open period | P2 | Backlog | Match S9; today a posted bill is refused edits ("A posted bill cannot be edited. Reverse it and enter a correct one.", `purchaseBill.ts`) and corrected only by reversal | ERP-024, ERP-025, ERP-016 | Editing a posted bill re-prices, re-checks quantities against challan and order, and rewrites its voucher in the same transaction (still balanced), audit-logged; refused on or before the lock date; reversal still works; the additional-bill and reverse-once rules are reviewed; the existing "cannot be edited" tests are rewritten on purpose, not deleted; confirmed challans and approved orders keep today's rules (my choice, S9) | Service tests; mutation checks |
| ERP-027 | IRD edition: a separate, later version of the app | P3 | Not started (owner decision 2026-10-22: made later, separately) | Meet IRD requirements when the time comes | Requirements written from IRD's own documents first | Not specified and not assumed. This item exists so nothing in the SME edition is taken to be IRD-compliant. Expectation, unverified: stricter rules on editing posted documents. Recommendation, not decided: keep the editing and locking rules in one module so the second edition can replace them | — |

---

## E. Current task and next action

- **Current task:** none in progress. ERP-024 part 1 was applied, validated and pushed as `b7f4882` in session 15; tracker update is pushed on top.
- **What session 12/13 established (run, not read):** against a local PostgreSQL 16 test DB, baseline `2869c1b` passed 444/444; after ERP-016 the full suite passed 466/466 twice across 20 files. Session 13 independently repeated both full-suite runs, `pnpm build`, and the Drizzle migration-generation check (no schema changes). Only the ERP-017 `it.fails` tests remain.
- **Files changed for ERP-016:** `drizzle/0007_voucher_balance.sql` (new), `drizzle/meta/0007_snapshot.json` (new, generated), `drizzle/meta/_journal.json`, `tests/db.voucherBalance.test.ts` (new), `PROJECT_TRACKER.md`. Session 13 changed only the tracker after applying commit `624a73c`.
- **Owner actions still open:** (1) run `pnpm db:migrate` on the owner dev DB for 0003-0008; migration 0008 refuses if AuditLog already contains rows, which need investigation; (2) do not rely on AuditLog as tamper-proof until direct INSERT/DB-role access is addressed; (3) check GitHub Actions for `b7f4882`; (4) manually verify Purchase Order, Challan, and Bill screens; (5) answer the inventory-method question before ERP-020; (6) confirm or change choices 2-4 in decision S9.
- **Blocker:** no build/test blocker. AuditLog integrity is incomplete until direct INSERT access and caller-supplied actor identity are addressed; owner dev-DB migration, browser verification, and GitHub Actions status remain unconfirmed.
- **Single best next action (session 15): harden ERP-024 audit integrity before relying on the log, then ERP-025 (company lock date).** Restrict forged AuditLog inserts through a defensible runtime DB-role/trigger design; prevent audit-context leakage across nested savepoints; and validate active opening-balance actors. Then complete the posted-document reason rule with ERP-026, add company-scoped audit views, and decide on order/challan/stock-opening coverage. ERP-007 follows ERP-025; ERP-005, ERP-017, ERP-022 and ERP-020 remain in the recorded order after these controls.

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
- (S3) Schema changes go through committed migrations (`pnpm db:generate` -> review -> commit); `db:push` is for throw-away experiments only; CI fails on schema/migration drift. Existing `db:push` databases use one-time `pnpm db:baseline`. Check violations (23514) were meant to surface as HTTP 409 — found not true in session 5; **made true by ERP-018 (session 8, committed `1079c7d`)**.
- (S4) **Company consistency is registry-driven.** One generic trigger instead of ~70 hand-written ones; every tenant-scoped table is registered; a **completeness test reads the catalog and fails CI if a new FK between tenant tables is not registered** (or a new table is neither registered nor listed as global: only `User` and `AuditLog`). Consequence: adding a table/FK means adding a registry row in a new migration.
- (S4) **A record's company can never change** (direct `companyId`; for child tables, the owner's company). **Behavior change vs ERP-003:** an *empty* Sub Group/Account Group can no longer be moved to another company; the ERP-003 control test that allowed it was rewritten to assert the refusal. Rationale: moving records between companies is a copy, never an UPDATE.
- (S4) A registered row whose company cannot be determined (e.g. a SubLedger with neither ledger nor party) is **rejected**; the migration pre-flight reports existing such rows.
- (S4) Implementation notes: trigger fires only when a company-relevant column is written (`UPDATE OF ...`); named `namo_company_consistency` so the more specific ERP-003 triggers (uppercase names) run first and their messages win; no row locks (company is immutable, so a parent's company cannot change underneath a check); functions are VOLATILE so they see rows written earlier in the same transaction. Cost: a few indexed lookups per write to registered tables.
- (S5) A test that documents a **reproduced defect** uses `it.fails` with a comment naming the ERP id: CI stays green, and the test starts failing once the defect is fixed, which is the signal to turn it into a plain `it`. Two exist: ERP-017 (`tests/api.stockOpening.test.ts`), ERP-018 (`tests/api.company.test.ts`). Tests remove the data they create; users cannot be deleted through the API, so `tests/api.userAccess.test.ts` removes its own users directly in the database. The company/branch/fiscal-year tests build everything inside a throw-away **inactive** company so it never shows in the header switcher and the seeded companies are only read.

- (S6) **Purchase Bill design, as merged by the owner in PR #2 (taken from the schema comments and migrations; I did not independently confirm these business rules with the owner):** (a) invoice number unique per branch + fiscal year (vouchers stay unique per branch); (b) `invoiceType` (LOCAL / IMPORT) and `purchaseType` (goods/service x capital/other) are separate; the legacy \"Taxable Capital\" option was retired; (c) billing terms are not columns on the bill: they live in `PurchaseDocumentTerm` with `documentType = PURCHASE_BILL`; (d) an ADDITIONAL purchase is a second bill pointing at a main bill (one level only) and may allocate ADDITIONAL-category terms to the main bill's lines (landed cost); (e) vendor is a ledger (e.g. CASH A/C), not necessarily a Party; (f) credit limit, balances, stock qty and total qty are computed on read, not stored; (g) serial numbers are not modelled. Consequence: all totals and posting are service-layer duties (ERP-020). Nepal-specific VAT purchase-book rules are referenced by `purchaseType` but not verified against statute.

- (S7) **Purchase service design, as pushed in `69b5559` (read from the code; not confirmed with the owner):** services live in `server/services/purchase/` and are called with an explicit `actor.userId` and run inside one transaction (`inTx`); numbering is per branch + fiscal year under `pg_advisory_xact_lock`; a bill's quantity is capped by its challan / order (with optional tolerance); a posted bill is immutable and is undone only by a **reversal bill** (new posted bill + voucher with Dr/Cr swapped, only once, not itself reversible, blocked while live additional bills exist); posting writes one voucher: Dr purchase/asset ledger per line and additive terms, Cr deductive terms, Cr vendor; **landed cost is for valuation only and is never double-booked**; posting refuses missing ledgers, zero totals, missing batch/expiry on tracked products, and IMPORT bills without a customs declaration number. Consequence: ERP-005 should reuse this voucher writer; ERP-016 must keep these flows valid. **Partly superseded by S9:** "a posted bill is immutable" describes the current code, not the target (ERP-026); the reversal flow stays as a correction route.

- (S8) **Error contract (ERP-018):** the API answers from the Postgres error code, never from drizzle's wrapper text. 23505 -> 409 "Duplicate value..."; 23503 -> 409 ("Cannot delete: this record is used elsewhere." on DELETE, "A linked record does not exist or can no longer be used." otherwise, chosen by HTTP method so it does not depend on the database's message language); 23514 -> 409 with the database rule's own message (trigger messages are written for people, so ERP-016's voucher rules should raise readable messages with `ERRCODE = 'check_violation'`); everything else -> 500 `{message: "Server error"}` with the detail in the server log only. A `PostgresError` is recognised by `name === "PostgresError"` (postgres.js); if the driver ever changes that, errors fall back to the safe generic 500, never to leaking.

- (S9) **Immutability policy: QuickBooks / Xero style (owner decision, 2026-10-22, for the SME edition).** (a) While a period is open, posted documents (vouchers, purchase bills, their lines) can be edited and deleted; nothing becomes immutable at the moment of posting. (b) Every change is kept in an audit log: who, when, old and new values (ERP-024). (c) A company has a **closing (lock) date**; a document dated on or before it cannot be created, edited or deleted (ERP-025). (d) After the lock date, an edit needs the **lock password or admin permission** (the owner said either one; ERP-025). (e) A separate **IRD edition** will be made later as its own version (ERP-027); the SME edition is **not** claimed to meet IRD rules, and no IRD rule is assumed here. **Read from the code in session 10:** the `AuditLog` table exists but nothing writes to it (no trigger in migrations 0000-0006, no code reference); there is no company lock date (only the year-level `FiscalYear.isClosed` and `isOpeningBalanceLocked`); the purchase service refuses to edit a posted bill (`purchaseBill.ts`) and a confirmed challan (`purchaseChallan.ts`); the reversal flow works. **Consequences:** Dr = Cr must still be enforced by the database (ERP-016), because an edit must never leave an unbalanced voucher; reversal stays as a correction route but is no longer the only one (ERP-026); until ERP-002 exists there is no admin role to check, so only the password override can be built first; the `AuditLog` table has no `companyId` (it is global, S4), so per-company audit views need a design choice (ERP-024). **Owner's answers (2026-10-22):** (1) a reason is **required** when editing or deleting a posted document. For (2) to (4) the owner said "the best option" and left the choice to me, so these are **my choices, open to change**: (2) the override allows **one edit at a time** (QuickBooks asks again each time); it needs a reason and is audit-logged; there is no standing unlock window. (3) The lock date covers **vouchers and their lines and purchase bills and their lines** (terms and allocations included). Orders and challans are not accounting entries and are not covered. Opening balances and stock openings keep their own lock (`isOpeningBalanceLocked`, closed year) and are not tied to the lock date. (4) **Confirmed challans and approved orders keep today's rules** (a confirmed challan is not edited); revisit when the inventory method (section B) and a stock ledger are decided. **Recommendation (mine, not decided):** keep the editing and locking rules in one module so the IRD edition can replace them without touching the rest.

- (S10) **Voucher balance rule (ERP-016, session 12; my design, not confirmed with the owner beyond S9):** `namo.check_voucher_balance()` runs from two `CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED ... FOR EACH ROW` triggers (`JournalVoucherLine_balance`, `CashBankVoucherLine_balance`) on INSERT, DELETE and UPDATE OF voucher id / debit / credit. At commit it sums the voucher's lines and compares exactly (`numeric`, no tolerance); a line moved between vouchers checks both. A voucher with no lines (a draft) or all-zero lines is balanced and allowed. The message names the voucher and both totals and uses `ERRCODE = 'check_violation'`, so the API answers 409 (S8). Cost: one small indexed sum per changed line at commit. Not covered: negative amounts, a line with both debit and credit, TRUNCATE. Migration 0007 refuses to install if existing vouchers are unbalanced and lists their ids. Tests that need the check inside a transaction use `SET CONSTRAINTS ALL IMMEDIATE` followed by `SET CONSTRAINTS ALL DEFERRED` (immediate stays on for the rest of the transaction otherwise).

- (S11) **Audit trail design (ERP-024 part 1, session 14; my design, not confirmed with the owner beyond S9):** (a) `namo.audit_row()` is one AFTER row trigger named `Audit_trail` on 10 tables: `JournalVoucher`, `JournalVoucherLine`, `CashBankVoucher`, `CashBankVoucherLine`, `OpeningBalance`, `PurchaseBill`, `PurchaseBillLine`, `PurchaseBillImportDetail`, `PurchaseDocumentTerm`, `PurchaseDocumentTermAllocation` (the last two also hold purchase-order terms). Not audited: orders, challans, stock openings, masters. (b) `AuditLog` gets a required `companyId`, **not** a foreign key (history outlives a company, and the log can never be edited) worked out by the trigger with `namo.company_of`; a child row removed by ON DELETE CASCADE takes the company from its parent's earlier log entry. (c) Who and why come from two per-transaction settings, `namo.actor_user_id` and `namo.change_reason`, set by `setAuditContext` (`server/db/audit.ts`); every purchase write service now goes through `inActorTx`, and the opening-balance save sets it too. A call without a user clears the previous one. A setting that is not digits is refused. (d) `changedBy` is now ON DELETE RESTRICT: a user who appears in the log cannot be deleted (deactivate instead). (e) `AuditLog` refuses UPDATE, DELETE and TRUNCATE (23514, so the API answers 409); a database superuser can still drop the triggers. (f) An UPDATE that changes nothing writes nothing. (g) A bill is written in several steps, so one service call can leave several log rows for one bill. (h) History starts at migration 0008; migration refuses to run if `AuditLog` already holds rows. (i) The "reason required for a posted document" rule is NOT built yet: nothing edits a posted document until ERP-026, and the service also updates posted bills' landed-cost columns when an additional bill arrives, so the rule should be designed with the edit path. (j) Cost: one extra insert per audited row write, plus `to_jsonb` of the row.

**Assumptions awaiting owner confirmation:**
- Inventory method (periodic vs perpetual) and where stock is valued: see section B. Not assumed.
- Auth approach when ERP-002 resumes; deployment target; Nepal-specific tax/calendar rules (unspecified, not assumed); "Master Account" as an enum on Account Group.
- Owner's dev DB: baseline preserves it; recreating is the alternative.
- That a SubLedger with neither ledger nor party is not a real use case (the migration refuses existing ones rather than guessing).

---

## G. Verification record

Sandbox: Linux, Node 22, pnpm 12.14.0, throwaway PostgreSQL 16 databases (never the owner's DB). Owner independently ran `pnpm test:db` on Windows for ERP-004: 154/154. GitHub Actions run `39455007886` on `0fd03ab`: success (install, schema+seed, build, tests).

**Session 15 (apply and independently verify ERP-024 part 1, 2026-10-25):**
| Check | Result |
|---|---|
| Repository state | Applied uploaded patch as `b7f4882` on top of `d3621a2`; pushed to `escorpyy/namo` `main` with tracker update on top |
| `pnpm build` | exit 0; TypeScript and Vite production build passed |
| `pnpm exec drizzle-kit generate` | "No schema changes, nothing to migrate" |
| `pnpm test:db`, run 1 and run 2 | both exit 0 on disposable local PostgreSQL 16; **21 files, 490/490 tests** each time |
| Review / not repeated | Review found direct AuditLog INSERTs can be forged by a role with table access; caller actor is untrusted, opening-balance does not reject inactive users, nested savepoint settings persist in the outer transaction. Session 14 reports 12 mutation checks caught; not repeated in session 15 |
| Not run | Owner dev-DB migration, GitHub Actions, browser/manual UI, concurrency |

**Session 14 (ERP-024 part 1, 2026-10-25):**
| Check | Result |
|---|---|
| Repository state | Fresh shallow clone of `escorpyy/namo` `main` = `d3621a2` (tracker commit on top of `624a73c`); sandbox Node 22.23, pnpm 10.28, PostgreSQL 16 |
| Baseline `pnpm test:db` before any change | exit 0; 20 files, **466/466** |
| Red-first: 23 new tests in `tests/db.auditTrail.test.ts` against the unchanged DB | all 23 failed, for the right reasons (no `companyId` / `reason` column, no trigger, user FK still set-null, nothing refused) |
| After migration 0008 and the code changes | 20 passed, 3 failed; the 3 were **my tests' fault**: a bill is written in several steps, so I had expected one log row where the service writes several. Tests changed to assert the user changes exactly once and the first/last action. One test added after a mutation survived (reversal reason). |
| Full suite `pnpm test:db`, twice | both exit 0; **21 files, 490/490** (466 + 24) |
| `pnpm build` / `drizzle-kit generate` | exit 0 / "No schema changes", only the new migration files untracked |
| Mutation checks (rule broken in the live test DB or the code, audit tests must fail, then restored) | M1 drop line trigger 4 failures; M2 drop append-only 2; M3 drop no-truncate 1; M4 no-op skip removed 1; M5 actor ignored 12; M6 reason ignored 5; M7 no cascade company fallback 3; M9 old row not stored 4; M10 service never sets user 3; M11 opening-balance route never sets user 1; **M12 reversal reason dropped survived, test added, then caught (1)** |
| Not run | GitHub Actions; owner dev-DB migration of 0008 (and 0003-0007); browser/manual UI; concurrency; a legacy `db:push` DB or Supabase for 0008; trigger cost on large data; the audit trail through the HTTP purchase routes (covered at service level and for opening balance via the API) |

**Session 13 (apply and independently verify ERP-016, 2026-10-24):**
| Check | Result |
|---|---|
| Repository state | Applied the uploaded patch as commit `624a73c` on top of `2869c1b`; pushed to `escorpyy/namo` `main` with this tracker update on top |
| `pnpm build` | exit 0; TypeScript and Vite production build passed |
| `pnpm exec drizzle-kit generate` | "No schema changes, nothing to migrate" |
| `pnpm test:db`, run 1 and run 2 | both exit 0 on local PostgreSQL 16; **20 files, 466/466 tests** each time |
| Not run by session 13 | Owner dev-DB migration, browser/manual UI, GitHub Actions, concurrency tests, mutation checks (the session 12 patch records 7 caught) |

**Session 12 (ERP-016, 2026-10-24):**
| Check | Result |
|---|---|
| `git clone` (shallow) | `escorpyy/namo`, HEAD `2869c1b` |
| Sandbox | Node 22.23, pnpm 10.28, PostgreSQL 16 (system cluster started, password set; throw-away `namoerp_test`) |
| Baseline `pnpm test:db` before any change | exit 0 |
| Baseline detail | 19 files, **444/444 passed** (session 11 had 135 passed / 309 skipped; the skipped DB-backed suites, including the 23 purchase API tests, now run and pass) |
| Red-first: 21 new tests in `tests/db.voucherBalance.test.ts` against the unchanged DB | 12 failed, 9 passed. Every failure was "nothing refused" (an unbalanced voucher accepted); the 9 passes were the accepted cases |
| Migration `0007_voucher_balance.sql` (custom, generated with `drizzle-kit generate --custom`) | applied by `pnpm db:migrate` |
| First run after the migration | 3 failures, all **my test helper's fault**: `SET CONSTRAINTS ALL IMMEDIATE` stays on for the rest of the transaction, so later edit steps were checked at once; helper now switches back to DEFERRED |
| Full suite `pnpm test:db` twice | both exit 0; **20 files, 466/466** (444 + 22) |
| Drift check / build | `drizzle-kit generate`: no schema changes; `pnpm build` exit 0 |
| Pre-flight of 0007 | with triggers dropped and one unbalanced voucher planted: migration block stopped with "these journal vouchers are not balanced: JournalVoucher#126" (planted data removed afterwards); on clean data it passes silently |
| Mutation checks (rule broken in the live test DB, `tests/db.voucherBalance.test.ts` must fail, rule restored) | M1 drop journal trigger: 9 failures; M5 drop cash/bank trigger: 3; M4 trigger not deferred: 9; M3 tolerance of 0.01: 2; M2 ignore the voucher a line left: 1 (after test fix); M6 ignore the voucher a line joined: 1 (after test fix); M7 check only the first voucher id: 1. **Two survivors led to test fixes:** M2 passed because the second voucher in my test started unbalanced (right result, wrong reason); M6 passed because no test made only the receiving voucher unbalanced. Both tests were fixed or added, then M2/M6/M7 were caught |
| Not run | GitHub Actions; owner dev-DB migration; browser/manual UI; concurrency; a legacy `db:push` DB or Supabase for 0007; the purchase screens |

**Session 11 (purchase API/UI, 2026-10-24):**
| Check | Result |
|---|---|
| Repository state | `main` at feature commit `23001a6`; patch commit pushed successfully to `escorpyy/namo` |
| Dependency install | `npm install --no-save --package-lock=false`; no tracked dependency or lockfile changes |
| `npm run build` | exit 0; TypeScript check and Vite production build passed |
| `npm test` | exit 0; **135 passed, 309 skipped** (3 test files passed, 16 skipped; 19 files / 444 tests total) |
| Why tests were skipped | No `TEST_DATABASE_URL` or `DATABASE_URL`; all API/DB integration suites, including the new 23 purchase API tests and purchase service DB tests, were skipped |
| Not run | `pnpm test:db`, owner dev-DB migration, GitHub Actions for `23001a6`, browser/manual UI verification, mutation checks, concurrency tests |

**Session 10 (immutability decision, 2026-10-22):**
| Check | Result |
|---|---|
| `git clone` (shallow) | `escorpyy/namo`, HEAD `f6b8417` (tracker only, on top of `1079c7d`) |
| Read | the whole tracker; `server/db/schema/core.ts` (FiscalYear, AuditLog); grep of `server/db/schema` for lock, closing and status columns; grep of `drizzle/*.sql` and `server` for AuditLog; grep of `server/services/purchase` for edit refusals |
| Findings | `AuditLog` is only a table (`0000_baseline.sql`, line 20): no trigger in any migration and no code uses it; no company lock date column; posted-bill edit refused at `purchaseBill.ts` line 141, confirmed-challan edit refused at `purchaseChallan.ts` line 59 |
| Not run | `pnpm build`, tests, drift check, anything at runtime (no code changed this session) |

**Session 9 (reconciliation after the ERP-018 push, 2026-10-22):**
| Check | Result |
|---|---|
| `git fetch` / `git pull --ff-only` | `c209436` -> `1079c7d` (`erp-018 dberrormapping`, 1 commit by the owner, 5 files: `PROJECT_TRACKER.md`, `server/app.ts`, `server/routes/_util.ts`, `tests/api.company.test.ts`, `tests/api.dbErrors.test.ts`) |
| Code read | `pgError()` in `server/routes/_util.ts` (matches `name === "PostgresError"` through `.cause`, depth 5); `errorHandler` exported from `server/app.ts` (23505 / 23503 / 23514 -> 409, FK message chosen by HTTP method, everything else generic 500); matches decision S8 |
| `pnpm exec drizzle-kit generate` (drift) | "No schema changes, nothing to migrate"; `git status --porcelain drizzle` empty |
| `pnpm build` | exit 0 |
| `pnpm test:db` run 1 and run 2 on `1079c7d` | both exit 0; **18 files, 421/421** each time; 0 occurrences of "Failed query" in the log |
| `it.fails` count | 1 (`tests/api.stockOpening.test.ts`, ERP-017) |
| Not run | GitHub Actions (no access); mutation checks (session 8's 5 checks were not repeated); the dev DB migration; any UI |
| Note | Sandbox needed `apt-get update` before installing PostgreSQL 16 and a restart of the cluster between commands |


**Session 8 (ERP-018, 2026-10-22):**
| Check | Result |
|---|---|
| `git fetch` | `69b5559` -> `c209436` (tracker only). `diff` of `origin/main:PROJECT_TRACKER.md` against my local tracker: **0 lines** (the owner committed it verbatim); local copy dropped, fast-forwarded |
| Probe of the real error shape (throw-away statements, Postgres 16) | top-level `DrizzleQueryError`: `code` undefined, message `Failed query: ...`; `.cause`: `PostgresError` with `code` (23514 raised by a DO block; 22012 for `1/0`; 23502 for a null in `Company.name`) and a clean message. A stopped database gave a plain `Error` with code `ECONNREFUSED` (not a PostgresError) |
| Step 1: export the old handler unchanged (refactor) | `tsc` clean |
| Step 2: 10 new tests in `tests/api.dbErrors.test.ts` against the OLD handler (red) | 9 failed, 1 passed (the `HttpError` control). Reasons read: real 23505 / 23503 (x2) / 23514 answered 500 not 409; unknown errors returned their raw message; the old handler treated a plain object with `code: "23505"` as a duplicate (a false positive I had not known about); 2 tests failed only because `pgError` did not exist yet |
| Step 3: fix; `it.fails` -> `it` in `tests/api.company.test.ts` | the new file 10/10, company file 26/26 |
| Full suite `pnpm test:db`, run 1 and run 2 | both exit 0; **18 files, 421/421** (= 411 + 10). Only one `it.fails` remains (ERP-017) |
| Mutation checks (production file broken, tests must fail, file restored) | M1 handler reads `err.code` again: 6 failures incl. the company API test; M2 FK message always "Cannot delete": 1; M3 raw message on 500: 2; M4 `pgError` without the name guard: 2; M5 `pgError` ignores `.cause`: 6. After restore: 36/36 and the files identical to the good copies |
| Drift check / build | `drizzle-kit generate`: no schema changes; `pnpm build` exit 0 |
| UI dependence | `src/api.ts` shows `data.message` verbatim, so no UI code depends on the old 500 text |
| Not verified | GitHub Actions (rate-limited earlier; not retried); migrations 0003-0006 on the owner's dev DB; the 23514 path through a real API route (no route can reach it today; covered with a real database error fed to the real handler); runtime in a browser |

**Session 7 (re-pull + purchase service audit, 2026-10-22):**
| Check | Result |
|---|---|
| `git fetch` / `git pull --ff-only` | `dbf5b4b` -> `69b5559` (1 commit by the owner, 23 files, +14,422 lines); upstream did not touch `PROJECT_TRACKER.md` |
| `pnpm install --frozen-lockfile` | OK |
| `pnpm exec drizzle-kit generate` (drift) | \"No schema changes\"; `git status --porcelain drizzle` empty |
| `pnpm build` | exit 0 |
| `pnpm test:db` run 1 and run 2 | both exit 0; **17 files, 411/411 passed** each time |
| Count check | 411 = 338 + 26 (`db.purchaseOrderChallan`) + 32 (`service.purchase`) + 15 (`purchase.calc`) |
| Posting path read | `server/services/purchase/purchaseBill.ts` lines ~255-380: Dr = Cr compared in app code (`dr !== cr` -> HTTP 500, nothing posted); fiscal year checked by `resolveFiscalYear` (exists, active, not closed, date inside); reversal swaps Dr/Cr |
| Database enforcement check (live test DB catalog) | `JournalVoucher` and `JournalVoucherLine` have only the `namo_company_consistency` trigger and no CHECK/UNIQUE constraints besides keys and the two unique indexes: **no DB-level balance or immutability** |
| Consumers | grep of `server`, `src`, `shared` for `services/purchase`: no route or UI uses it; routes folder has no purchase file |
| Concurrency | no `Promise.all` / concurrent test in `tests/service.purchase.test.ts`; numbering uses an advisory lock, bill locking uses `FOR UPDATE` (read, not stress-tested) |
| Not run | GitHub Actions (rate-limited); mutation checks of the 73 new tests; dev-DB migration; runtime server/UI; legacy and dirty-data upgrade paths for 0006 |

**Session 6 (fresh clone + reconciliation, 2026-10-22) — superseded by session 7 for current counts (338 then; 411 now):**
| Check | Result |
|---|---|
| `git clone https://github.com/escorpyy/namo` | OK; `main` = `dbf5b4b`; branches: `main`, `claude/purchase-bill-schema`; clean tree |
| Sandbox | Node 22.22.2, pnpm 12.14.0, PostgreSQL 16 installed via apt (throw-away DB `namoerp_test`) |
| `pnpm install --frozen-lockfile` | OK |
| `pnpm exec drizzle-kit generate` (CI drift check) | \"No schema changes, nothing to migrate\"; `git status --porcelain drizzle` empty |
| `pnpm build` (tsc --noEmit + vite build) | exit 0, 1602 modules, built in ~3 s |
| `pnpm test:db` run 1 (migrate 0000-0005, seed, vitest) | exit 0; **14 files, 338/338 passed** |
| `pnpm test:db` run 2 (immediately after) | exit 0; **14 files, 338/338 passed** (shows repeatability) |
| Count check | 338 = 317 (session 5) + 21 (`tests/db.purchaseBill.test.ts`) |
| Known defects still present | `it.fails` at `tests/api.stockOpening.test.ts:189` (ERP-017) and `tests/api.company.test.ts:169` (ERP-018); handler in `server/app.ts` still reads `err.code`; `express.json()` still default |
| Purchase Bill structure | `drizzle-kit` listed `PurchaseBill` (31 cols, 12 indexes, 10 FKs), `PurchaseBillLine` (19 / 6 / 5), `PurchaseBillImportDetail` (20 / 2 / 1); 8 non-internal triggers on the three tables in the test DB; no route, service or UI references them (grep of `server`, `src`, `shared`) |
| GitHub Actions status | **Not read**: unauthenticated API call returned \"rate limit exceeded\" |

**Session 6 not verified:** GitHub Actions; migrations 0003-0005 on the owner's dev DB, on a legacy `db:push` DB, or over dirty data; the server running end to end (`pnpm start`) and any UI; mutation checks of `tests/db.purchaseBill.test.ts` (I did not break any rule to prove those 21 tests fail when they should; the file was read for coverage only); concurrency; lint (no linter configured). The expected stderr noise in the test log (a Postgres foreign-key error dump) comes from the ERP-018 known-defect path and did not fail anything.

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

**Manual verification still required:** owner to run `pnpm db:migrate` on the dev DB (0003-0008; session 15 tested migrations only on a disposable local database; investigate any existing AuditLog rows before migration 0008); manually check Purchase Order, Challan, and Bill screens; check GitHub Actions for `b7f4882`. Purchase Term / Sales Term screens: **verified by the owner on 2026-10-22.**

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
- Verification: section G. **Commit hash: none yet (patch); the tests were later merged as `60a1cd0`.**

### 2026-10-22 — Session 6 — verification and tracker reconciliation (no code changed)
- Fresh clone of `dbf5b4b`. Found the tracker one merge behind: the session-5 test patch was already merged (`60a1cd0`) and a Purchase Bill schema (4 commits, migrations 0003-0005, 21 DB tests) had been added by another session. Audited the schema and tests (read, plus counts from the live test DB), reproduced the CI steps (drift check, build, tests x2): all green, 338/338. Re-confirmed ERP-017/ERP-018 still present. Added ERP-020, ERP-021, decision S6, module row, risks and verification record.
- Files affected: `PROJECT_TRACKER.md`. **Commit hash: none (not committed).**

---

### 2026-10-22 — Session 7 — re-pull after `69b5559`, purchase service audit (no code changed)
- Pulled the owner's new commit (Purchase Order + Challan tables, migration 0006, purchase service layer, 73 tests). Re-ran drift check, build and tests twice: 411/411. Read the posting/reversal path and checked the database catalog: voucher balance and immutability are still not enforced by the database. Recorded: module rows, ERP-005 reframed (generalise the private writer), ERP-016 urgency up, ERP-020 narrowed to API/UI/stock accounting, new ERP-022, decision S7, an inventory-method question for the owner. ERP-009 reworded.
- Files affected: `PROJECT_TRACKER.md`. **Commit hash: committed by the owner as `c209436`.**

### 2026-10-22 — Session 8 — ERP-018
- Re-pulled (`c209436`, tracker only; identical to my session-7 tracker). Implemented ERP-018 red-first: `pgError()` + rewritten, exported `errorHandler`; 10 new tests; `it.fails` for ERP-018 became a plain test. 421/421 twice; 5 mutation checks caught. Recorded the three behaviour changes, decision S8, new ERP-023. No schema or migration change.
- Files affected: `server/app.ts`, `server/routes/_util.ts`, `tests/api.company.test.ts`, `tests/api.dbErrors.test.ts` (new), `PROJECT_TRACKER.md`. **Commit hash: `1079c7d` (committed and pushed by the owner).**

### 2026-10-22 — Session 9 — reconciliation after the ERP-018 push (no code changed)
- Pulled `1079c7d`, read the commit, re-ran drift check, build and the suite twice (421/421) on the pushed code, and updated this tracker: ERP-018 marked committed, working-tree and owner-action lines corrected, session 9 verification record and handoff added. A second, independent ERP-018 implementation (a separate `server/dbErrors.ts` and 21 tests, 432 passing) had been prepared before the pushed commit was seen; it was discarded as redundant. Its one extra idea, a generic message from `/api/health`, is already recorded in ERP-023.
- Files affected: `PROJECT_TRACKER.md`. **Commit hash: none (delivered as a patch).**

### 2026-10-22 — Session 10 — immutability decision (no code changed)
- Fresh clone (`f6b8417`). The owner chose the QuickBooks / Xero model for now (editable in an open period with an audit log; a closing date; override by password or admin permission) and an IRD edition later as a separate version. Recorded as decision S9. Read the code to see what exists (`AuditLog` table unused, no lock date, purchase service refuses edits of posted bills). Narrowed ERP-016 to the database-enforced Dr = Cr; reworded ERP-005 and ERP-007; added ERP-024 to ERP-027; updated risks, module rows and the order of next actions. The owner then answered the four design questions: a reason is required on edit; for the other three he said "best option", so I chose and recorded them in S9 as open to change.
- Files affected: `PROJECT_TRACKER.md`. **Commit hash: none (delivered as a patch).**


### 2026-10-24 — Session 11 — purchase API/UI integration and tracker reconciliation
- Applied the uploaded purchase CRUD patch and pushed feature commit `23001a6` to `main`: purchase API routes, order/challan/bill screens, shared form components, and 23 API tests.
- Verification: `npm run build` passed. `npm test` passed 135 runnable tests; 309 DB-backed tests were skipped because no `TEST_DATABASE_URL`/`DATABASE_URL` was configured. No manual UI check, dev-DB migration, CI status check, mutation check, or concurrency run was performed.
- Updated current status, ERP-020, verification record, and handoff. **This tracker update is committed and pushed separately in the same session.**
### 2026-10-24 — Session 12 — ERP-016 (database-enforced voucher balance)
- Fresh clone (`2869c1b`). Ran the full suite against a real Postgres 16 test DB: 444/444, which closes the session 11 gap (309 skipped tests). Implemented ERP-016 red-first: migration 0007 (deferred constraint triggers on both voucher line tables, readable 23514 message, pre-flight on dirty data) and 22 tests. 466/466 twice, drift clean, build exit 0, 7 mutation checks caught (two survivors exposed weak tests that I fixed). Recorded decision S10; ERP-016 done; next action now ERP-024.
- Files affected: `drizzle/0007_voucher_balance.sql`, `drizzle/meta/0007_snapshot.json`, `drizzle/meta/_journal.json`, `tests/db.voucherBalance.test.ts`, `PROJECT_TRACKER.md`. Initially delivered as a patch; applied and pushed in session 13 as `624a73c`.


### 2026-10-24 — Session 13 — apply, verify, and push ERP-016
- Applied the uploaded patch as commit `624a73c` on top of `2869c1b`. Independently ran `pnpm build`, `pnpm exec drizzle-kit generate` (no schema changes), and `pnpm test:db` twice on local PostgreSQL 16; both runs passed 20 files / 466 tests.
- Reconciled the tracker with the pushed change and current verification. No application code was changed beyond the supplied migration and test patch.
- Owner dev-DB migration, browser/UI verification, GitHub Actions status, and concurrency checks remain open. Session 12 reported seven mutation checks caught; they were not repeated in session 13.

### 2026-10-25 — Session 14 — ERP-024 part 1 (audit trail)
- Fresh clone (`d3621a2`), baseline 466/466. Implemented red-first: migration 0008 (`AuditLog` companyId + reason, changedBy restrict, generic `namo.audit_row` trigger on 10 financial tables, append-only guard), `server/db/audit.ts`, `inActorTx` in the purchase services, user setting in the opening-balance save, 24 tests. 490/490 twice, build and drift check clean, 12 mutation checks caught (one survivor led to a new test). Recorded decision S11; ERP-024 part 1 done, remainder listed; next action ERP-025.
- Files affected: `drizzle/0008_audit_trail.sql`, `drizzle/meta/0008_snapshot.json`, `drizzle/meta/_journal.json`, `server/db/schema/core.ts`, `server/db/audit.ts` (new), `server/services/purchase/{common,purchaseBill,purchaseChallan,purchaseOrder}.ts`, `server/routes/openingBalance.ts`, `tests/db.auditTrail.test.ts` (new), `tests/db.companyConsistency.test.ts` (comment only), `PROJECT_TRACKER.md`. **Commit hash: none (delivered as a patch).**


### 2026-10-25 — Session 15 — apply and push ERP-024 part 1
- Applied the uploaded patch as commit `b7f4882` on top of `d3621a2`; independently ran `pnpm build`, Drizzle generation check (no schema changes), and `pnpm test:db` twice on disposable local PostgreSQL 16; both runs passed 21 files / 490 tests.
- Updated the tracker with current verification and review caveats: direct AuditLog inserts can be forged by a role with write access; actor identity remains caller-supplied; nested savepoint settings persist in the outer transaction; opening-balance actor validation is weaker than the purchase routes.
- Session 14 reports 12 mutation checks caught; not repeated in session 15. Owner dev-DB migration, GitHub Actions, browser/UI, and concurrency checks remain open.

---

## HANDOFF (end of session 15)

**Accomplished:** Applied ERP-024 part 1 as `b7f4882` and pushed it with the tracker update to `main`. Migration 0008 logs changes to 10 selected financial tables; `pnpm build` passed, Drizzle reported no schema changes, and the PostgreSQL 16 full suite passed 490/490 twice.

**Not accomplished / open:** Direct AuditLog INSERTs can be forged by a database role with table access; transaction-local actor/reason values persist after nested savepoint release; opening-balance audit accepts an inactive but existing user id. Reasons for posted-document changes, audit reads, and audit of orders/challans/stock openings remain open. Owner dev-DB migration, GitHub Actions, browser/UI and concurrency checks were not performed in session 15. Session 14's 12 mutation checks were not repeated.

**Repo state:** ERP-024 commit `b7f4882` and this tracker update are pushed to GitHub `main`; working tree is clean.

**Next task:** Harden AuditLog insertion privileges/actor context and validate the opening-balance actor before treating this log as tamper-proof; then ERP-025 (lock date), ERP-026, ERP-005, ERP-017, ERP-022, and ERP-020. ERP-007 follows ERP-025. Owner decision still needed on the inventory method.

---

## (superseded) HANDOFF (end of session 14)

**Accomplished at end of session 14:** ERP-024 part 1 was written and verified locally: migration 0008 adds a database trigger audit trail for selected financial tables, with company, actor and reason; the log blocks UPDATE/DELETE/TRUNCATE. The suite passed 490/490 twice, build and drift check were clean, and the patch author reported 12 mutation checks caught.

**Open at end of session 14:** patch not yet applied or pushed; reason-required rule for posted documents, audit reads, and auditing orders/challans/stock openings were not built; owner dev-DB migration, browser check, GitHub Actions and concurrency checks remained unconfirmed. ERP-002 was still deferred.

**Repo state at end of session 14:** GitHub `main` = `d3621a2`; ERP-024 was delivered as a patch.

**Next task at end of session 14:** apply the patch, then ERP-025 (lock date, with override and reason), ERP-026, ERP-005, ERP-017, ERP-022, ERP-020; ERP-007 after ERP-025. Owner decision still needed on the inventory method.

---

## (superseded) HANDOFF (end of session 13)

**Accomplished:** Applied ERP-016 as `624a73c` and pushed it to `main`. The database now refuses unbalanced journal and cash/bank vouchers at commit while allowing balanced line rewrites in one transaction. `pnpm build` passed, Drizzle reported no schema changes, and the full Postgres 16 suite passed 466/466 twice. The tracker now records the verified status.

**Not accomplished / open:** Owner dev-DB migration (0003-0007), browser verification of purchase screens, and GitHub Actions status remain unconfirmed. No concurrency checks were run in session 13. ERP-002 is still deferred; the inventory-method decision remains open. The session 12 patch reports seven mutation checks caught; these were not repeated in session 13.

**Repo state:** ERP-016 commit `624a73c` and this tracker update are pushed to GitHub `main`; working tree is clean.

**Next task:** ERP-024 (audit trail; decide `AuditLog` company scope first), then ERP-025, ERP-026, ERP-005, ERP-017, ERP-022, ERP-020; ERP-007 after ERP-025. Owner decision still needed on the inventory method before stock-accounting work.

---

## (superseded) HANDOFF (end of session 12)

**Accomplished:** ERP-016 done: the database now refuses, at commit, any journal or cash/bank voucher whose debit total differs from its credit total, while edits that rewrite the lines inside one transaction pass (S9). 22 new tests; suite 466/466 twice; migration 0007 applies, pre-flight refuses dirty data. The DB-backed purchase tests that session 11 could not run pass (444/444 before the change).

**Not accomplished / open at end of session 12:** patch not yet committed or pushed at that point; GitHub Actions status unread; migrations 0003-0007 not confirmed on the owner's dev DB; purchase screens not checked in a browser; no concurrency run; ERP-002 still deferred; the inventory-method decision still open.

**Repo state at end of session 12:** GitHub `main` = `2869c1b`; the ERP-016 patch was delivered but not yet applied.

**Next task at end of session 12:** ERP-024 (audit trail; decide `AuditLog` company scope first), then ERP-025, ERP-026, ERP-005, ERP-017, ERP-022, ERP-020; ERP-007 after ERP-025. Owner decision still needed on the inventory method before stock-accounting work.

---

## (superseded) HANDOFF (end of session 11)

**Accomplished:** Purchase Order / Challan / Bill API routes and UI screens were added and pushed as `23001a6`; 23 route tests were added. The production build passed. `npm test` reported 135 passed and 309 skipped because no test database was configured. The tracker now reflects the delivered API/UI layer and the remaining risks.

**Not accomplished / open:** purchase DB/API/service tests were skipped; owner dev-DB migration and end-to-end/UI verification remain; GitHub Actions status for `23001a6` is unread; mutation/concurrency tests were not run; ERP-002 (auth) is still deferred; the inventory-method decision and stock ledger/accounting remain open.

**Repo state:** Feature commit `23001a6` is pushed to GitHub `main`; this tracker update is committed and pushed on top. Working tree is clean.

**Next task:** Owner to run `pnpm db:migrate` and `pnpm test:db` against the test/dev DB, manually verify the three purchase screens, and check Actions for `23001a6`; then ERP-016 (narrowed to DB Dr = Cr), ERP-024, ERP-025, ERP-026, ERP-005, ERP-017, ERP-022, ERP-020. ERP-007 after ERP-025. Owner decision still needed on the inventory method before stock-accounting work.

---

## (superseded) HANDOFF (end of session 10)

**Accomplished:** Recorded the owner's immutability decision (S9): QuickBooks / Xero style now (edit in an open period, audit log, lock date, override by password or admin permission), IRD edition later as a separate version. Checked what the code already has. Narrowed ERP-016 to the database-enforced Dr = Cr; added ERP-024 (audit trail), ERP-025 (lock date), ERP-026 (edit posted bills) and ERP-027 (IRD edition).

**Not accomplished / open:** no code changed and no tests run; my choices for S9 answers 2 to 4 await the owner's confirmation; GitHub Actions status unread; migrations 0003-0006 on the dev DB unconfirmed; ERP-002 still deferred (so no admin role to check until then).

**Repo state:** GitHub `main` = `f6b8417`, unchanged by me. One patch changes `PROJECT_TRACKER.md` only.

**Next task:** ERP-016 (narrowed), then ERP-024, ERP-025, ERP-026, ERP-005, ERP-017, ERP-022, ERP-020; ERP-007 after ERP-025. Owner decision still needed on the inventory method before ERP-020.

---

## (superseded) HANDOFF (end of session 9)

**Accomplished:** Reconciled the tracker with `main` = `1079c7d`: ERP-018 is committed and closed. Re-verified the pushed commit from a fresh pull: drift check clean, build exit 0, `pnpm test:db` twice, 18 files, 421/421.

**Not accomplished / open:** no application code changed; GitHub Actions status unread (no access); migrations 0003-0006 not confirmed on the owner's dev DB; mutation checks of ERP-018 not repeated (session 8's 5 stand); ERP-016, ERP-005, ERP-017, ERP-022, ERP-020, ERP-023, ERP-002 open.

**Repo state:** GitHub `main` = `1079c7d`, unchanged by me. One patch changes `PROJECT_TRACKER.md` only.

**Next task:** ERP-016 (database-enforced Dr = Cr and posted-voucher immutability; trigger messages written for people with `ERRCODE = 'check_violation'` so ERP-018 turns them into 409), then ERP-005, ERP-017, ERP-022, ERP-020; ERP-023 (P3) any time. Owner decision still needed on the inventory method before ERP-020.

---

## (superseded) HANDOFF (end of session 8)

**Accomplished:** ERP-018 done and verified in the sandbox: database constraint errors now answer a clear 409, unknown errors answer a generic 500 with details only in the log, 10 real-error tests added, the old known-defect test is now a plain test. Suite 421/421 twice, five mutation checks caught.

**Not accomplished / open:** nothing is committed or pushed; GitHub Actions status unread; ERP-017 (large stock-opening save), ERP-016, ERP-005, ERP-002 open; ERP-023 follow-ups recorded; dev DB migrations 0003-0006 unconfirmed.

**Repo state:** GitHub `main` = `c209436`. One patch (`ERP-018.patch`) against it adds the fix, the tests and this tracker; no schema change.

**Next task:** ERP-016 (database-enforced Dr = Cr and posted-voucher immutability), then ERP-005, ERP-017, ERP-022, ERP-020. Owner decision still needed on the inventory method before ERP-020.

---

## (superseded) HANDOFF (end of session 7)

**Accomplished:** `main` at `69b5559` verified from a fresh pull: install, drift check, build, 411/411 tests twice. Tracker reconciled with the new purchase service and its accounting behaviour; risks and priorities updated.

**Not accomplished / open:** no code changed or committed; Actions status unread; migrations 0003-0006 not confirmed on the owner's dev DB; nothing exercised at runtime (no route or UI exists for the new service); the 73 new tests not mutation-checked; ERP-018 / ERP-017 / ERP-016 / ERP-002 open.

**Repo state:** GitHub `main` = `69b5559`, unchanged by me. Updated `PROJECT_TRACKER.md` is **saved in the sandbox working tree and delivered as a file; not committed, not pushed**.

**Next task:** ERP-018, then ERP-016 (DB-enforced Dr = Cr and voucher immutability), then ERP-005, ERP-017, ERP-022, ERP-020. Owner decision needed on the inventory method before ERP-020.

---

## (superseded) HANDOFF (end of session 6)

**Accomplished:** Fresh clone of GitHub `main` (`dbf5b4b`) verified; tracker reconciled (338/338 then). Superseded by the session-7 handoff above.

---

## (superseded) HANDOFF (end of session 5)

**Accomplished:** ERP-014 finished locally: 126 new API tests (suite 317), every file mutation-checked and self-cleaning. Two real defects found and recorded (ERP-018, ERP-017). Tracker brought in line with the repository (commit state, module statuses, owner actions).

**Not accomplished / open:** the patch is not yet applied, committed or pushed; owner's `pnpm test:db` x2 result not reported; GitHub Actions status of `7547005`, `a2e6a31` and the new commit unchecked; no UI checks beyond the two term screens; ERP-002 (auth) still deferred; no new feature modules.

**Repo state:** GitHub `main` = `a2e6a31`. One patch against it adds five test files and updates this tracker; it changes no production code.

**Next task:** ERP-018 (database error mapping, small, P1), then ERP-005 + ERP-016 (Journal Voucher posting with DB-enforced balance). ERP-017 and ERP-019 are smaller follow-ups.
