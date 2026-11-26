# SUPER PROMPT: Dynamic, user-designed financial statement templates for NamoErp

Paste everything below into your coding AI (Claude Code, Codex, etc.) with the repo `escorpyy/namo` checked out.

---

## 1. ROLE

You are a senior ERP/accounting engineer working inside the existing NamoErp repository (React + Vite frontend in `src/`, Express backend in `server/`, Drizzle ORM + PostgreSQL, shared logic in `shared/`, tests in `tests/` run with Vitest). You build features the way this codebase already does: dense, keyboard-friendly ERP screens, slate/blue styling, clear status messages, two-decimal accounting amounts, company isolation on every query.

## 2. GOAL

Replace the hardcoded, name-regex-driven statement layout with a **user-designed, template-driven statement engine** covering all four statements:

- Profit & Loss (PL)
- Balance Sheet / Statement of Financial Position (BS)
- Statement of Cash Flows, indirect method (CFS)
- Statement of Changes in Equity (SCOE)

Users design the layout first (lines, nesting, subtotals, which account groups / subgroups / ledgers feed each line), can **save as many templates as they want**, and pick a template on each report screen. **One template ("NFRS for SMEs") is created by the seed** and is read-only; users copy it to customise. A template holds **all four statements together** so that profit, cash and equity links stay consistent.

## 3. VERIFIED FACTS ABOUT THE CURRENT CODEBASE (re-verify before relying on them)

Chart of accounts
- Three levels: `AccountGroup` (has `type`: ASSET | LIABILITY | EQUITY | REVENUE | EXPENSE) -> `AccountSubGroup` -> `GeneralLedger`. `GeneralLedger` also has `parentId` (ledger-to-ledger). Schema in `server/db/schema/accounting.ts`; enums in `server/db/schema/enums.ts`.
- Seed (`server/db/seed.ts`) creates groups AG001..AG013 (Current Assets, Fixed Assets, Current Liabilities, Capital, Direct Income, Indirect Income, Direct Expenses, Indirect Expenses, Non-current Liabilities, Provisions, Reserves & Surplus, Other Assets, Non-current Assets) with subgroups such as Sales Accounts, Sales Returns, Purchase Accounts, Purchase Returns, Direct Wages, Freight Inward, Factory / Production Overheads, Salaries & Wages, Depreciation, Sundry Creditors, Owner's Capital, Retained Earnings, Drawings.
- Seed quirk to fix through the template, not by editing the chart: ledger "Opening Stock" (GL050) lives in Direct Expenses / Purchase Accounts, and "Closing Stock (P&L)" (GL051) lives in Direct Income / Sales Accounts. Without ledger-level overrides, closing stock inflates revenue.

Reporting today
- `server/services/financialReportRows.ts` returns flat posted ledger rows (opening, debit, credit, closing; debit positive) per kind `trial-balance | profit-loss | balance-sheet`, including automatic stock ledgers from `stockLedgerAuto.ts` and excluding active year-end-close journals from P&L.
- `server/routes/financialReports.ts` adds `totals.currentResult`, `resultLedger` (the GL Setup "Profit and Loss Account" role ledger) and stock-opening mismatch warnings.
- `src/components/reports/HierarchicalStatement.tsx` builds P&L/BS in the browser using regexes on group names (`isDirect`, `isNonCurrentGroup`, `noteFor`). No subtotals for current / non-current. No unmapped-account validation.
- `src/lib/cashFlow.ts` builds CFS with regexes (`INVESTING_GROUP`, `FINANCING_LIABILITY`, `NON_CASH_EXPENSE`) and the `isCashOrBank` ledger flag.
- `src/screens/reports/ChangesInEquityScreen.tsx` builds SCOE with one column per EQUITY account group.
- GL Setup roles exist (Profit and Loss Account, Cash Book, Sales, Sales Return, Purchase, Purchase Return, Opening Stock P&L, Closing Stock P&L, Closing Stock B/S). Year-end close (`server/services/yearEndClose.ts`) posts to the Profit and Loss role ledger.
- `TODO.md` / `plan.md` already list NFRS statement-line definitions, ledger-to-line mappings and unmapped-account validation as planned. A reference workbook is committed: `NFRS for SMEs Model FS - Final Format with dummy figures.xlsx` (use as golden reference).

## 4. NON-NEGOTIABLE RULES

1. **Never apply migrations, seed or post journals against a production/shared database.** Add migration source only. Run DB integration tests only against a disposable local database, and only if one is explicitly configured. If none is configured, say so and stop at unit-level tests.
2. Do not silently rewrite existing masters, product GL mappings or GL Setup. Do not change the chart of accounts to fit the template.
3. Every query and API is scoped by `companyId` (and `branchId` where the existing reports are). Add company-isolation tests.
4. All amounts use the existing decimal/micro helpers; display two decimals. No floating-point accumulation in the engine.
5. Reports are read-only. Calculating or refreshing a statement must never create ledger entries.
6. Keep existing reports working until the new engine reproduces them (see golden tests). Switch screens over behind the template dropdown; do not delete the old path until Phase 6 and only if the user approves.
7. Reuse existing patterns (`wrap`, `HttpError`, `companyOf`, `masterFactory`, `MasterForm`, `Dialog`, `useEntryControl`, number/Nepali-date helpers). Typecheck and build must pass.
8. If a requirement is ambiguous or contradicts the code, **ask before assuming**. State every assumption in your phase report.

## 5. ACCOUNTING RULES THE ENGINE MUST ENCODE

- Gross Profit = Net Sales (Revenue from Operations) - Cost of Goods Sold. **Other Income is a separate line outside gross profit.**
- COGS = Opening Stock + Net Purchases + Direct Costs - Closing Stock. Stock lives under COGS lines; closing stock reduces COGS and never counts as revenue.
- Net Sales = Sales + Sales Returns; Net Purchases = Purchases + Purchase Returns. Netting happens through signed balances and each line's natural sign, with no per-ledger "negative" flag.
- Ledgers never appear on the face of a statement. They appear only through drill-down or notes.
- Subtotals are computed rows (formula over other rows). Computed rows may reference other computed rows; evaluate in dependency order; reject cycles.
- Profit for the period must flow into Reserves & Surplus on the BS (or the GL Setup Profit and Loss ledger), so Total Assets = Total Equity & Liabilities.
- Closing cash on the CFS = cash/bank balance on the BS. Closing equity on the SCOE = equity on the BS. Profit is identical in PL, CFS and SCOE.

## 6. DATA MODEL (Drizzle schema + migration SOURCE ONLY)

Create in `server/db/schema/statementTemplates.ts` and export from the schema index. Follow naming style of existing tables (quoted PascalCase table names, `companyId`, `createdAt/updatedAt`).

**StatementTemplate**: id, companyId, name (unique per company), description, `isSystem` (seeded; read-only), `isDefault` (at most one default per company, enforce with partial unique index), `isActive`, createdBy, createdAt, updatedAt.

**StatementLine**: id, templateId, `statement` enum (BS | PL | CFS | SCOE), code (unique per template+statement), label, parentLineId (nullable), sortOrder, `lineType` enum (HEADING | MAPPED | COMPUTED), `nature` enum (DEBIT | CREDIT | null), `role` enum nullable (PROFIT_FOR_PERIOD, CASH_AND_EQUIVALENTS, GROSS_PROFIT, TOTAL_ASSETS, TOTAL_EQUITY_AND_LIABILITIES, TOTAL_EQUITY, SCOE_COLUMN, SCOE_MOVEMENT_OPENING, SCOE_MOVEMENT_PROFIT, SCOE_MOVEMENT_OTHER, SCOE_MOVEMENT_CLOSING, CFS_OPERATING, CFS_INVESTING, CFS_FINANCING, ...; finalise the list in Phase 0), `allowedTypes` (array of AccountType), `noteNo`, `drillDepth` enum (NONE | GROUP | SUBGROUP | LEDGER), `showWhenZero` boolean.

**StatementLineFormula**: id, lineId (the computed line), termLineId (referenced line), sign (+1 | -1), sortOrder. Validate: same template and statement unless explicitly cross-statement for roles; no cycles.

**StatementLineMapping**: id, lineId, exactly one of `accountGroupId` | `accountSubGroupId` | `generalLedgerId` (CHECK constraint), plus optional `glSetupRole` as an alternative target so the seeded template can bind to roles (Opening Stock P&L, Closing Stock P&L, Closing Stock B/S, Profit and Loss Account) instead of fragile codes. Optional `cfsBucket` / `movementKind` where the statement needs a classification (see section 7).

Constraints
- A target maps to **at most one line per statement per template** (unique index over template+statement+target, enforced through a join or trigger-safe check in the service layer plus a DB-level guard where feasible).
- Mapped line `allowedTypes` must contain the account type of every ledger that resolves to it.
- System templates: block UPDATE/DELETE of the template, its lines, formulas and mappings in the service layer.

Provide `drizzle` migration SQL files in the repo's existing style. Do not run them against any shared DB.

## 7. ENGINE (server-side, pure and unit-testable)

Put in `server/services/statementEngine/`. The browser must not do the accounting; it renders what the engine returns.

Resolution order for a ledger within a statement: **ledger mapping -> subgroup mapping -> group mapping -> UNMAPPED**. GL Setup role mappings resolve to a ledger first. A group mapping is a fallback; a subgroup mapping overrides it; a ledger overrides both.

Evaluation
1. Load `financialReportRows` for the period (and the comparative period) once.
2. Convert each ledger's balance to its line's natural sign using `nature` (credit lines: credit - debit; debit lines: debit - credit).
3. Sum into MAPPED lines; evaluate COMPUTED lines by topological order over `StatementLineFormula`; detect and reject cycles at save time.
4. Return a tree: line (code, label, note, amounts current/prior, children, optional drill-down group -> subgroup -> ledger according to `drillDepth`) plus `unmapped` (ledgers with a non-zero balance that reach no line, per statement), `checks` and `warnings` (reuse stock-opening mismatches).

Per statement
- **PL**: lines as in section 5. Period result is exposed as the `PROFIT_FOR_PERIOD` role line for other statements. Keep excluding active close journals from P&L only, as today.
- **BS**: current / non-current and Schedule III-style subtotals are just computed lines. The period result is added into the equity line bound to the GL Setup Profit and Loss ledger, or shown as its own line if that ledger is not equity (keep today's behaviour). Show the difference row if unbalanced.
- **CFS (indirect)**: starts from `PROFIT_FOR_PERIOD`. Each non-cash BS target is mapped to a bucket (OPERATING_WORKING_CAPITAL | INVESTING | FINANCING | CASH) through `cfsBucket`; line amount = movement (closing - opening) with the correct sign. Non-cash P&L ledgers (e.g. depreciation) map to add-back lines; keep the existing depreciation/fixed-asset interplay. The cash bucket is driven by the existing `isCashOrBank` flag. This replaces the regexes in `src/lib/cashFlow.ts`.
- **SCOE**: columns are lines with role `SCOE_COLUMN`, fed by mapping EQUITY groups/subgroups/ledgers. Rows are Opening, Profit for the period, Other movements, Closing, plus optional movement rows (e.g. Drawings / dividends) bound through `movementKind` on a ledger mapping. The remainder stays "Other movements".

Cross-statement checks (returned as `checks`, severity ERROR or WARN)
- BS: assets = liabilities + equity.
- CFS closing cash = BS cash and equivalents; CFS difference = 0.
- SCOE closing equity = BS equity.
- Profit equal across PL, CFS and SCOE.
- Trial balance balanced.
- No UNMAPPED ledger with a non-zero balance.
- A template cannot be set default or used for final reports if required roles are missing.

## 8. API

Under `server/routes/statementTemplates.ts` (register next to `financialReports`):
- CRUD for templates (list, get with lines/formulas/mappings, create blank, **copy from** any template, rename, delete non-system, set default).
- Bulk-replace of a statement's lines/formulas/mappings in one transaction (editor "Save"), with validation errors keyed to line codes.
- `GET /statement-templates/:id/unmapped?statement=&fiscalYear=&from=&to=&branchId=`.
- `GET /financial-reports/statements?templateId=&statement=&fiscalYear=&from=&to=&branchId=` returning the engine output for one statement. Keep the existing `/financial-reports/:kind` working.
- All routes: `companyOf(req)`, input helpers from `_input.ts`, audit trail where the repo audits masters.

## 9. UI

Reuse the existing look (dense tables, slate/blue, shortcuts overlay, status bar).
1. **Statement Templates** list screen: name, system/default badges, statements complete?, actions Copy / Rename / Set default / Delete.
2. **Layout editor** (one tab per statement): left panel = account groups -> subgroups -> ledgers not yet placed (search, filter by account type); right panel = statement lines tree. Add/rename/delete/reorder/nest lines (drag and keyboard); drop an item onto a line to map it; subgroup or ledger can override its group; set nature, note number, drill depth; build a subtotal with a +/- term picker (no free-text formulas); mark roles. Live preview against the current period. Unmapped panel and validation errors inline. Save anytime; incomplete templates are allowed but flagged.
3. **Report screens** (`FinancialStatementScreen`, `CashFlowScreen`, `ChangesInEquityScreen`): template dropdown (default preselected), comparative period, drill-down expand/collapse, unmapped banner, check results, print.
4. System template shows read-only with a prominent "Save as copy" action.

## 10. SEEDED TEMPLATE: "NFRS for SMEs"

Create from the seed for every company, after its groups are seeded; idempotent; mapped by group/subgroup **code** and GL Setup **role**, never by names. Cover all four statements using the NFRS workbook as the layout reference. Minimum PL/BS mapping to reproduce (verify the actual codes in the seed):

PL
- Revenue from operations (credit): subgroups Sales Accounts + Sales Returns; group Direct Income as fallback
- COGS: Opening stock <- GL Setup role Opening Stock P&L; Net purchases <- subgroups Purchase Accounts + Purchase Returns; Direct costs <- subgroups Direct Wages, Freight Inward, Factory / Production Overheads; Closing stock (deducted) <- GL Setup role Closing Stock P&L
- Gross profit = Revenue - COGS (role GROSS_PROFIT)
- Other income <- group Indirect Income
- Employee benefits <- subgroup Salaries & Wages; Finance costs <- Interest Expense; Depreciation <- subgroup Depreciation; Other expenses <- group Indirect Expenses (fallback)
- PBT, Tax, Profit for the year computed or mapped; Profit for the year has role PROFIT_FOR_PERIOD

BS
- Share capital <- Owner's / Share / Partners' Capital; Reserves & surplus <- group Reserves & Surplus + Retained Earnings + Profit and Loss role ledger (Drawings net here)
- Short-term borrowings, Trade payables (Sundry Creditors), Other current liabilities (Duties & Taxes Payable, Outstanding Expenses, Customer Advances, Tax and Statutory Payables, Deferred Revenue), Provisions, Non-current liabilities
- PPE <- group Fixed Assets (Accumulated Depreciation nets inside), Non-current assets, Inventories <- role Closing Stock B/S, Trade receivables, Cash and equivalents (isCashOrBank), Other current assets <- Current Assets fallback
- Computed: Total shareholders' funds, Total non-current liabilities, Total current liabilities, Total equity & liabilities, Total non-current assets, Total current assets, Total assets

CFS and SCOE: map every seeded BS group/subgroup to a bucket / column so the seeded template reports **zero unmapped** on a freshly seeded company.

## 11. TESTING

- Unit tests for the engine: resolution order (ledger > subgroup > group), natural-sign netting (sales returns, closing stock), cycle detection, role requirements, unmapped detection, allowedTypes violations.
- **Golden tests**: on a seeded company with sample vouchers, the seeded template must reproduce today's P&L result, BS totals, CFS and SCOE numbers (same profit, same total assets, same closing cash). Where the new output intentionally differs (closing stock out of revenue, other income outside gross profit), assert the new behaviour and document why.
- Cross-statement check tests (all four reconcile).
- Company-isolation tests; system-template immutability tests; copy-template tests; default-template uniqueness.
- Follow existing test conventions in `tests/`; DB tests only against a disposable local DB.

## 12. DELIVERY PLAN (stop after each phase and report)

- **Phase 0 - Audit (read-only).** Re-verify section 3, list real seed codes, GL Setup role names, existing helpers to reuse, and finalise the `role` enum. Output: findings, assumptions, questions. No code changes.
- **Phase 1 - Schema.** Tables, constraints, migration source, schema exports, typecheck.
- **Phase 2 - Engine for PL and BS** + seeded template for those two + unit and golden tests.
- **Phase 3 - Engine for CFS and SCOE** + seeded template for those + cross-statement checks and tests.
- **Phase 4 - API** + route tests.
- **Phase 5 - UI**: templates list, layout editor, report screens with dropdown, unmapped banner.
- **Phase 6 - Hardening.** Accessibility/keyboard pass, audit trail, docs (update `TODO.md`, `PROJECT_TRACKER.md`, `plan.md`), decide with the user whether to retire the old regex path.

**Phase report format:** what changed (files), what was verified and how (commands run and results), tests added, assumptions made, open questions, risks, and the exact next step. Never claim something works unless you ran it. If you cannot run something (no disposable DB, blocked network), say so explicitly.

## 13. DEFINITION OF DONE

- A user can design a template from scratch or from a copy, save multiple templates, set a default, and pick one on every statement screen.
- The seeded NFRS template works on a fresh company with zero unmapped ledgers and all cross-statement checks passing.
- Renaming an account group or subgroup never moves it between statement sections.
- A new ledger under a mapped group appears automatically; a new group appears in the Unmapped panel until placed.
- No migration, seed or journal was applied to any shared database; typecheck, build and tests pass; docs updated.

Begin with **Phase 0 only**, then stop and report.
