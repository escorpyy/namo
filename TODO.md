# Namo ERP ToDo

## Keyboard Shortcuts

- [x] **Create and manage shortcuts** — Under Settings → Keyboard Shortcuts, let the current user create, edit, and remove keyboard shortcuts for supported common screen actions, toggling the sidebar, and navigating to ready screens. Capture and display key combinations clearly; saved combinations must trigger the selected action. Keep bindings scoped to the current user in browser-local storage and keep existing default shortcuts working.

- [x] **Warn and restrict conflicts** — Show a clear warning when a shortcut conflicts with another custom binding, an existing built-in ERP shortcut, or a reserved browser shortcut. Do not allow a conflicted set to be saved; disable and guard Save until every conflict has been resolved. Provide a way to remove or re-record a conflicting binding.

## GL Setup

- [x] **Company-level GL role mappings** — Add GL Setup for exactly these roles: Profit and Loss Account; Cash Book; Sales Account; Sales Return Account; Purchase Account; Purchase Return Account; Opening Stock P&L; Closing Stock P&L; Closing Stock B/S. Each role can select a General Ledger from the current company; selections and settings persist per company and load again when the screen is reopened. An unassigned role is permitted until configured. Existing Product GL mappings must not be silently overwritten.

- [x] **Entry controls and safe enforcement** — Each role includes controls for Journal Voucher, Cash/Bank, Sales Invoice, Sales Return, Purchase Bill, Purchase Return, Opening Balance, and Stock Opening, plus a Locked control. Save is atomic; server validation rejects malformed roles, missing/duplicate role rows, inactive or cross-company GLs, and invalid control values. For currently implemented entry paths, a selected role’s saved permission/lock is enforced server-side; an unassigned ledger remains unrestricted. Sales Return and Purchase Return controls are stored for their workflows, which are not implemented yet; Stock Opening is enforced on mapped stock roles and affected product GLs.

- [x] **Integrated screen and navigation** — Add the GL Setup screen to Setup navigation. Display the nine roles with a GL picker and their entry controls; allow editing, saving, reload, and visible success/error feedback. Warn before navigating away from unsaved changes and follow Namo’s existing UI conventions.

- [ ] **Migration and checks** — Register the new table and ledger foreign key with database company-integrity enforcement, add audit logging, and test company isolation and control rules. Typecheck and build successfully. Do not apply migrations or seed against any production/shared database. Migration and audit/integrity wiring are complete; typecheck, build, and six focused unit tests pass. Database integration tests were skipped because no local test database is configured, so company-isolation integration verification remains open. No migration was applied.
