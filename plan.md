# GL Setup — Implementation Plan

## Goal

Add a company-scoped GL Setup screen for the nine requested roles: Profit and Loss Account, Cash Book, Sales Account, Sales Return Account, Purchase Account, Purchase Return Account, Opening Stock P&L, Closing Stock P&L, and Closing Stock B/S. Each role stores its selected General Ledger and entry-control permissions.

## Approach

- Add a dedicated `GeneralLedgerSetup` table with one row per company and role, a nullable General Ledger reference, explicit permission booleans, and a locked switch. Company ownership and the ledger link are enforced by the existing database company-integrity registry. A migration supplies the table, checks, indexes, integrity registration, and audit trigger.
- Add a dedicated GET/PUT API. GET returns all nine roles, using stable defaults for roles not yet saved. PUT validates the complete set, company-owned active GL references, role keys, and boolean controls, then upserts atomically with actor attribution.
- Implement a compact setup screen in the existing slate/blue ERP visual language. Show the nine roles as rows with a General Ledger picker and clearly labelled entry controls. Provide dirty-state protection, save feedback, and entry-control grouping.
- Enforce saved controls on existing Journal Voucher, Cash/Bank, Sales Invoice, Purchase Bill, Opening Balance, and Stock Opening entry paths. Stock Opening checks the mapped stock roles and affected products’ closing-stock GLs. Reversal postings use the same controls as their source entry type. Include settings for Sales Return and Purchase Return so those workflows can use them when implemented; do not invent missing transaction screens.

## Project structure

- `server/db/schema/accounting.ts` and `server/db/schema/index.ts`: GL setup persistence model and schema export.
- `drizzle/0034_gl_setup.sql`: new table, company-integrity links, audit trigger, and constraints.
- `server/routes/glSetup.ts` and `server/app.ts`: validated setup API.
- `server/services/glEntryControl.ts`: reusable company/GL/entry-type guard.
- `src/api.ts`: typed GL Setup API.
- `src/screens/GLSetupScreen.tsx`, `src/App.tsx`, and `src/components/Sidebar.tsx`: screen, routing, and navigation.
- Tests cover role completeness, persistence, company boundaries, control enforcement, and screen helpers where the existing test harness supports them.

## Design

Reuse Namo’s existing accounting-master design rather than introducing a new visual style: dense, keyboard-friendly ERP tables, familiar slate navigation, blue active states, and clear status messaging. Keep role names prominent, put each role’s chosen ledger beside its entry permissions, and group entry controls as a compact set of labelled toggles. Avoid decorative visuals; use short help text to distinguish a mapping from permission to post through an entry type.

## Constraints

- Setup applies per company, not per branch or fiscal year.
- Existing product-specific account mappings remain authoritative; this setup does not silently rewrite product masters.
- Existing workflows are guarded server-side; toggles for Sales Return and Purchase Return are persisted for when those entry workflows are added.
- Run migrations only against an explicitly local/test database. Never write to a production or shared customer database.

## Benchmark sources

- TallyPrime documents chart-of-accounts grouping, voucher types/classes for preconfigured ledger selection, and audit/edit history: https://help.tallysolutions.com/accounting-in-tally-prime/
- Tally ledger setup documents group classification, opening balances, and the restriction on deleting ledgers already used by vouchers: https://help.tallysolutions.com/article/Tally.ERP9/Creating_Masters/Accounts_Info/Predefined_Ledgers_in_TallyERP.htm
- QuickBooks Online documents account types driving financial reporting, inactive accounts retaining history while preventing new transactions, and locked accounts being excluded from posting selectors: https://quickbooks.intuit.com/learn-support/en-us/help-article/chart-accounts/learn-chart-accounts-quickbooks-online/L2yc6KBob_US_en_US
- Intuit documents required/default accounts and the limits on deactivating special accounts: https://quickbooks.intuit.com/learn-support/en-us/help-article/chart-accounts/manage-default-special-accounts-chart-accounts/L3WvLaIfa_US_en_US


# Keyboard Shortcuts — Implementation Plan

## Scope and approach

Add a functional keyboard-shortcut editor under Settings → Keyboard Shortcuts. Users can create, edit, and remove bindings for common screen actions (save/update, new, edit, search, help), toggling the sidebar, and navigating to ready screens. Screen actions dispatch the app's established keyboard events so current forms keep their existing behavior; sidebar and navigation actions call the app directly. New bindings supplement rather than silently replace the documented defaults.

## Persistence and runtime

Persist the current user's bindings in browser `localStorage`, keyed by user ID, consistent with existing lightweight preferences. Validate and normalize saved data before using it. A shared shortcut utility owns normalization, display labels, the supported action catalog, storage access, and conflict detection. The app-level capture-phase dispatcher checks user bindings before screen listeners; it skips key-recording controls and text composition, prevents the captured custom chord from reaching browser defaults, and dispatches the selected action. Navigation goes through the existing unsaved-change guard.

## Conflict policy

Normalize Ctrl/Command to one portable Ctrl label. Require a modifier for ordinary keys, permit function keys, and reject duplicate custom combinations plus combinations already used by built-in ERP actions or common browser controls. Show actionable inline warnings on the affected rows and disable/guard Save until every binding is conflict-free. Users can cancel/reset a recording or remove a binding to resolve a conflict.

## Project structure and design

- `src/lib/keyboardShortcuts.ts`: action definitions, combination capture/normalization, conflict policy, and per-user localStorage helpers.
- `src/screens/KeyboardShortcutsScreen.tsx`: compact editor in the existing dense slate/blue ERP style, with capture buttons, action selectors, conflict alerts, save/reset feedback, and dirty-state protection.
- `src/components/Sidebar.tsx`: expose ready-screen labels for the navigation-action selector and add the new settings entry.
- `src/App.tsx`: render the settings screen and host the configurable shortcut dispatcher alongside current navigation and sidebar handlers.
- `tests/keyboardShortcuts.test.ts`: verify normalization, duplicate/reserved conflict blocking, and stored-binding validation.

Keep existing hard-coded shortcuts working; the configurable bindings provide additional chords and do not rewrite transaction semantics. The settings are browser-local and per-user, not synchronized across devices.


# NFRS Reporting — SME Implementation Plan

## Goal

Add a new `NFRS Reporting` navigation section with an `SMEs` subsection, then build a data-driven NFRS for SMEs reporting layer over the existing company, fiscal-year, General Ledger, opening-balance, journal-voucher, and cash/bank-voucher engine.

## Approach

- Keep posted ledgers and vouchers as the accounting source of truth; do not copy Excel cell formulas into runtime code.
- Add NFRS statement-line definitions and company/fiscal-year account mappings for balance sheet, profit or loss/OCI, cash flow, changes in equity, and notes.
- Add controlled NFRS adjustment records for revaluation, deferred tax, leases, deferred income, employee benefits, and first-time adoption, with post/reverse/audit behavior.
- Add supporting schedules for PPE, investment property, intangible assets, deferred tax, leases, debtors, payables, related parties, and equity reconciliation.
- Use the committed NFRS workbook as a migration/golden-reference source: import inputs, trial-balance mappings, comparative values, and adjustments, then compare generated reports against it.
- Add report validation for trial-balance balance, balance-sheet equality, cash-flow reconciliation, equity movement, unmapped accounts, broken mappings, and unposted adjustments.

## Project structure

- `src/components/Sidebar.tsx`: `NFRS Reporting` section and nested `SMEs` subsection.
- `src/screens/reports/NfrsSmeReportingScreen.tsx`: SME workspace and module entry point.
- `server/db/schema/`: NFRS mappings, statement definitions, adjustments, schedules, and reconciliation persistence.
- `server/routes/nfrs/`: setup, mapping, adjustment, statement, note, reconciliation, and validation APIs.
- `server/services/nfrs/`: calculation engine, schedules, workbook importer, and validation rules.
- `src/screens/nfrs/`: setup, mapping, adjustment, statement, note, reconciliation, and close screens.
- `tests/nfrs/`: calculation, import, mapping, validation, and company-isolation tests.

## Delivery stages

1. Navigation and SME workspace foundation.
2. Mapping model and generated balance sheet, profit/loss/OCI, and trial-balance reports.
3. Workbook import and golden-reference comparison.
4. NFRS adjustment posting and reversal.
5. Cash flow, changes in equity, notes, reconciliations, and supporting schedules.
6. Validation, period close, exports, and audit package.

## Design

Reuse Namo's dense ERP visual language: slate navigation, blue active states, keyboard-friendly tables, compact report filters, clear posted/draft states, and validation banners. Avoid decorative dashboard graphics; financial clarity and traceability take priority.
