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
