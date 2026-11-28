# NamoERP Application Upgrade Tracker

> **Purpose:** Is document ka goal NamoERP ko security, accounting integrity, UX, performance, testing aur operations ke perspective se production-grade banana hai.
>
> **Audit target:** Is tracker ke saare mandatory items complete hone, evidence attach hone aur release gates pass hone ke baad application ko audit mein **10/10 target state** maana jayega.
>
> **Current baseline:** Audit completed on 2026-11-28. No code changes were made as part of the audit. The working tree was clean and `main` was synchronized with `origin/main`.
>
> **Status legend:** `[ ]` Not started · `[-]` In progress · `[x]` Complete and verified · `[!]` Blocked / needs decision
>
> **Rules:** Har implementation ke saath tests, migration review, security review aur evidence update hona chahiye. Existing accounting safeguards ko remove ya weaken nahi karna hai.

---

## 1. Current audit baseline

| Area | Baseline | Target |
|---|---|---|
| Authentication | Missing; request-supplied `userId` is only an audit actor | Server-derived authenticated identity on every protected request |
| Authorization | Roles/access records exist but are not enforced | Company, branch and role permission checks on every route |
| Tenant safety | Strong DB company-consistency safeguards | Preserve DB safeguards plus runtime authorization |
| Accounting integrity | Strong voucher, fiscal-year, period-lock, reversal and audit controls | Preserve and expand with concurrency coverage |
| Tests | `366 passed`, `656 skipped` locally because DB was not configured; CI has PostgreSQL | Full required unit, DB, API, concurrency and E2E gates |
| Production hardening | No auth middleware, rate limiting or security-header middleware | Hardened public/private deployment profile |
| Operations | Basic migration runner and local Docker setup | Backup/restore, observability, shutdown and migration runbook |
| Frontend performance | Main JS bundle approximately 1 MB | Measured budget with route-level code splitting |

### Audit evidence reviewed

- `server/app.ts`
- `server/index.ts`
- `server/routes/_input.ts`
- `server/routes/_util.ts`
- `server/routes/context.ts`
- `server/routes/masterFactory.ts`
- `server/routes/audit.ts`
- `server/routes/periodLock.ts`
- `server/routes/yearEndClose.ts`
- `server/services/periodLock.ts`
- `server/services/journalVoucher.ts`
- `server/services/cashBankVoucher.ts`
- `server/db/schema/core.ts`
- `server/db/schema/vouchers.ts`
- `docker-compose.yml`
- `.env.example`
- `.github/workflows/ci.yml`
- `scripts/test-db.mjs`
- `tests/`

---

## 2. P0 — Security blockers before real/shared data

### SEC-001 — Authentication and server-derived identity

- [ ] Choose and document the authentication mechanism: secure session, OIDC or JWT.
- [ ] Add authentication middleware before protected API routers.
- [ ] Populate `req.user` only from the verified credential.
- [ ] Stop trusting `userId` from request body/query for actor identity.
- [ ] Keep an explicit system/job actor for background operations.
- [ ] Add login/logout/session-expiry behavior and secure cookie/token settings.
- [ ] Add tests for missing, expired, malformed and forged credentials.

**Acceptance criteria**

- Unauthenticated requests receive `401` for every protected route.
- A caller cannot impersonate another active user by sending another `userId`.
- `createdBy`, `postedBy`, `changedBy`, `closedBy` and audit actor values come from the authenticated server identity.
- Health/readiness endpoints expose only operational status and no business data.

**Primary files:** `server/app.ts`, `server/index.ts`, `server/routes/_input.ts`, auth module to be added.

---

### SEC-002 — Company, branch and role authorization

- [ ] Implement reusable `requireCompanyAccess(companyId)` middleware/service guard.
- [ ] Implement branch access semantics: explicit branch access versus all-branches access.
- [ ] Implement role-to-permission mapping for view/create/edit/post/reverse/delete/admin actions.
- [ ] Apply authorization consistently to generic masters, reports, vouchers, stock, audit, period lock, GL setup and year-end close.
- [ ] Protect user management and user-access administration separately.
- [ ] Reject company/branch context that is not granted to the authenticated user.
- [ ] Remove client-side context as a security dependency; it remains UI state only.

**Acceptance criteria**

- User with company A access cannot read or mutate company B.
- User with branch A access cannot read or mutate branch B.
- Viewer cannot create, edit, delete, post, reverse or administer data.
- Privileged operations require explicit permissions.
- Cross-tenant and cross-branch negative tests pass for every route family.

**Primary files:** `server/routes/context.ts`, `server/routes/masterFactory.ts`, `server/routes/_input.ts`, all sensitive route files, `server/db/schema/core.ts`.

---

### SEC-003 — Protect sensitive endpoints and audit data

- [ ] Require authentication and permission for `/api/audit`.
- [ ] Add an `AUDIT_VIEW` permission.
- [ ] Restrict audit results to authorized companies/branches.
- [ ] Define masking rules for sensitive old/new values.
- [ ] Protect `/api/period-lock`, `/api/year-end-close`, `/api/gl-setup`, `/api/entry-control`, `/api/number-series` and user-access routes.
- [ ] Add security-event audit entries for authorization failures and privileged actions.

**Acceptance criteria**

- Unauthenticated caller cannot retrieve `oldData`/`newData` from audit logs.
- Audit output cannot be used to enumerate unauthorized companies.
- Every privileged change has authenticated actor, timestamp and reason where applicable.

---

## 3. P1 — Security hardening and accounting controls

### SEC-004 — Rate limiting and abuse protection

- [ ] Add global API rate limiting appropriate for deployment topology.
- [ ] Add stricter limits for login, password verification, period-lock override, audit search and heavy reports.
- [ ] Add per-IP and per-company failed-attempt throttling for period-lock password checks.
- [ ] Add exponential backoff or temporary lockout after repeated failures.
- [ ] Log security events without logging secrets or passwords.

**Acceptance criteria**

- Repeated lock-password failures are throttled and observable.
- Legitimate accounting workflows are not blocked by overly aggressive global limits.
- Load/abuse tests demonstrate bounded resource usage.

---

### SEC-005 — HTTP and deployment hardening

- [ ] Add security headers using a reviewed middleware configuration.
- [ ] Configure trusted proxy behavior explicitly for production.
- [ ] Keep CORS disabled by default; when enabled, validate an explicit allowlist and deployment origin.
- [ ] Keep production database credentials out of repository files.
- [ ] Mark `docker-compose.yml` as development-only or split development and production compose files.
- [ ] Remove public PostgreSQL port exposure from production deployment.
- [ ] Use a least-privilege database role for the application.
- [ ] Document TLS requirements and certificate validation.
- [ ] Add dependency vulnerability scanning and lockfile review to CI.

**Acceptance criteria**

- No default production database password exists.
- Production database is not directly reachable from the public network.
- Security-header and CORS tests pass against the production profile.
- CI reports dependency vulnerabilities according to a documented severity policy.

**Primary files:** `server/app.ts`, `server/db/index.ts`, `docker-compose.yml`, `.env.example`, `.github/workflows/ci.yml`.

---

### ACC-001 — Preserve and expand accounting invariants

- [ ] Keep company-consistency DB triggers and registry completeness checks.
- [ ] Keep voucher debit/credit balance triggers.
- [ ] Keep fiscal-year date, active and closed checks.
- [ ] Keep period-lock password/reason and DB-level enforcement.
- [ ] Keep posted-document audit/reason rules.
- [ ] Keep reversal-only correction rules for finalized documents.
- [ ] Keep branch-scoped duplicate-number constraints and advisory locks.
- [ ] Add concurrency tests for duplicate numbering, posting, reversal, lock/save and year-end close.
- [ ] Review the known opening-balance lock/save race and close it transactionally.

**Acceptance criteria**

- No test or refactor weakens an existing DB constraint or trigger.
- Two concurrent posts cannot create duplicate posting or duplicate numbers.
- Two concurrent reversals cannot reverse one document twice.
- A locked period cannot be changed without valid override credentials and reason.
- A closed fiscal year cannot accept normal posting, edit or reversal.
- Opening-balance lock and save operations are serialized safely.

**Primary files:** `server/services/purchase/common.ts`, `server/services/periodLock.ts`, `server/services/journalVoucher.ts`, `server/services/cashBankVoucher.ts`, `server/services/yearEndClose.ts`, opening-balance routes/services, `drizzle/`.

---

### ACC-002 — Year-end close and privileged accounting operations

- [ ] Assign explicit permission for year-end close and reopen.
- [ ] Require authenticated actor and reason for reopen.
- [ ] Ensure close, linked vouchers and fiscal-year state change atomically.
- [ ] Prevent duplicate active closes under concurrent requests.
- [ ] Verify historical P&L behavior after close and after reopen.
- [ ] Add branch-wide close tests and failure rollback tests.

**Acceptance criteria**

- Missing/invalid P&L mapping blocks close.
- Close preview is read-only and does not create entries.
- Close creates balanced, traceable branch vouchers atomically.
- Reopen reverses linked vouchers atomically and requires a reason.
- Repeated close/reopen requests are idempotent or safely rejected.

---

## 4. P1 — Testing and release quality

### QA-001 — Required test layers

- [ ] Keep fast unit tests for decimal math, validation, keyboard rules and statement calculations.
- [ ] Run DB/API/service tests against a disposable PostgreSQL database in every PR.
- [ ] Make skipped DB-test count visible and fail the required gate when DB setup is unexpectedly missing.
- [ ] Add cross-tenant and role authorization tests for every route family.
- [ ] Add mutation tests for critical accounting guards.
- [ ] Add concurrency tests for posting, numbering, locks, settlements and close.
- [ ] Add migration-upgrade tests for fresh, legacy and dirty-data databases.
- [ ] Add browser E2E tests for the critical workflows.

**Minimum E2E journeys**

- Login → company/branch selection → purchase bill draft → immediate validation → save → post → reverse.
- Sales invoice draft → post → reverse.
- Journal voucher draft → edit → post → reverse.
- Cash/bank voucher draft → post → reverse.
- Period lock → valid override → audit verification.
- User access → allowed company/branch → denied company/branch.
- Year-end close preview → close → reopen.
- Opening balance save versus lock concurrency scenario.

**Acceptance criteria**

- Required CI run has zero unexpected skipped tests.
- Fresh PostgreSQL migrations, seed, typecheck, build and all required tests pass.
- Critical E2E journeys pass on the supported browser matrix.
- Test artifacts include migration version, commit SHA and database version.

**Primary files:** `.github/workflows/ci.yml`, `scripts/test-db.mjs`, `tests/`, new E2E test configuration.

---

### QA-002 — Release checklist and change control

- [ ] Add a release checklist to the repository.
- [ ] Require migration review for every schema change.
- [ ] Require rollback/recovery notes for destructive or irreversible migrations.
- [ ] Require security impact review for auth, permissions and sensitive endpoints.
- [ ] Require accounting impact review for posting, reversal, balance and period-lock changes.
- [ ] Record manual UI verification for changed workflows.
- [ ] Protect `main` with required CI checks and review rules where repository policy permits.

**Acceptance criteria**

- No release bypasses migrations, tests or security checks.
- Every production release has a reproducible commit and migration list.
- Failed deployment has a documented recovery path.

---

## 5. P1 — Operations and data protection

### OPS-001 — Backup, restore and disaster recovery

- [ ] Define RPO and RTO for accounting data.
- [ ] Configure encrypted automated backups.
- [ ] Define retention and off-host backup policy.
- [ ] Document point-in-time recovery where supported.
- [ ] Perform and record a restore drill.
- [ ] Verify restored data with accounting integrity checks.
- [ ] Document who can access backups and how credentials are rotated.

**Acceptance criteria**

- A documented restore drill succeeds on a clean environment.
- `namo.company_violations()` returns no violations after restore.
- Voucher balance, audit trail and migration-history checks pass after restore.
- Restore duration meets the documented RTO.

---

### OPS-002 — Observability and graceful runtime behavior

- [ ] Add structured JSON logs.
- [ ] Add request IDs and correlation IDs.
- [ ] Record authenticated actor/company/branch context without sensitive payloads.
- [ ] Add DB query latency, connection and error metrics.
- [ ] Add background-job status and failure metrics.
- [ ] Add readiness and liveness endpoints separately.
- [ ] Add graceful SIGTERM/SIGINT shutdown and DB connection cleanup.
- [ ] Configure pool size, connect timeout, idle timeout and statement timeout.
- [ ] Add alerting for repeated authorization failures, lock-password failures, DB errors and failed migrations.

**Acceptance criteria**

- An incident can be traced from request ID to server log and DB operation.
- Shutdown does not abruptly drop accepted requests beyond the documented timeout.
- DB outage produces bounded failures and a clear readiness signal.
- Secrets, passwords and full accounting payloads are not logged.

**Primary files:** `server/index.ts`, `server/db/index.ts`, `server/app.ts`, deployment configuration.

---

## 6. P2 — UX, accessibility and performance

### UX-001 — Keyboard and validation E2E coverage

- [ ] Add browser tests for Enter/Shift+Enter field progression.
- [ ] Verify invoice-number field does not trap focus during purchase entry.
- [ ] Verify async duplicate-number validation does not create keyboard races.
- [ ] Verify modal, combobox and portal focus behavior.
- [ ] Verify Ctrl+S, F2, F3, F4, F6 and Escape behavior in each main document screen.
- [ ] Verify loading, conflict, timeout and retry states.
- [ ] Verify screen-reader labels, focus indicators and error association.

**Acceptance criteria**

- Critical entry screens are keyboard-completable without mouse interaction.
- Validation errors move focus to the actionable field.
- No shortcut triggers destructive actions without the existing confirmation policy.
- Accessibility smoke checks pass for the supported browser matrix.

---

### PERF-001 — Bundle and runtime performance

- [ ] Add bundle-size report to CI.
- [ ] Lazy-load reports, admin, purchase, sales and stock feature areas.
- [ ] Split heavy screens and non-critical icon/assets.
- [ ] Enable production compression/Brotli at the serving layer.
- [ ] Measure first load and interaction latency on a low-end/mobile profile.
- [ ] Add server pagination and query limits to heavy reports/audit screens.
- [ ] Review N+1 queries in master lists, reports and audit views.

**Suggested initial budgets**

- Initial compressed JS: define and enforce a team-approved budget.
- No single feature route should load unrelated admin/reporting code.
- Main document screen should become interactive within the agreed device budget.

**Acceptance criteria**

- CI fails or warns on unexplained bundle regression.
- Main entry screen loads without downloading every feature module.
- Heavy reports remain bounded by pagination and query limits.

---

## 7. P2 — Maintainability and dependency hygiene

### DEV-001 — Dependency and code health

- [ ] Run `pnpm audit` in CI with documented policy.
- [ ] Review outdated React, Vite, TypeScript, Express, Zod, Vitest, PostgreSQL driver and UI dependencies.
- [ ] Resolve security advisories before release or document accepted risk with expiry date.
- [ ] Add linting and formatting checks if not already present.
- [ ] Keep one lockfile and use frozen installs in CI/deployment.
- [ ] Add ownership/review guidance for accounting services and migrations.
- [ ] Keep `dist/` out of source control unless the deployment process explicitly requires it.

**Acceptance criteria**

- Dependency scan has no unreviewed high/critical findings.
- Clean install, typecheck, build and tests work from a fresh checkout.
- Every migration and accounting service has an identifiable reviewer/owner.

---

## 8. 10/10 audit exit criteria

The application can be marked **Audit 10/10 target achieved** only when all of the following are true:

### Security

- [ ] Authentication is mandatory for all business APIs.
- [ ] Identity is server-derived; client cannot spoof `userId`.
- [ ] Company, branch and role authorization is enforced server-side.
- [ ] Unauthorized reads and writes return safe `401/403` responses.
- [ ] Audit, user-access, period-lock, GL setup and year-end close are permission-protected.
- [ ] Rate limiting, security headers, secure CORS and production DB isolation are verified.

### Accounting integrity

- [ ] Company/branch DB invariants remain enabled and tested.
- [ ] Voucher balance, fiscal-year, period-lock and reversal safeguards remain enabled.
- [ ] Posted/closed-period behavior is covered by service, API and DB tests.
- [ ] Concurrency tests pass for numbering, posting, reversal, locking and close.
- [ ] Audit actor, reason and timestamps are authentic and complete.

### Testing and release

- [ ] CI runs fresh PostgreSQL migrations, seed, typecheck, build and all required tests.
- [ ] No unexpected integration-test skips.
- [ ] Critical browser E2E journeys pass.
- [ ] Migration drift check passes.
- [ ] Release checklist, rollback notes and migration review are complete.

### Operations

- [ ] Backup and restore drill is successful.
- [ ] RPO/RTO are documented and met.
- [ ] Structured logs, request IDs, health/readiness, metrics and alerts exist.
- [ ] Graceful shutdown and DB timeout/pool settings are verified.
- [ ] Production secrets and database access are protected.

### UX and performance

- [ ] Keyboard-critical entry flows pass browser tests.
- [ ] Validation and error recovery are usable.
- [ ] Accessibility smoke checks pass.
- [ ] Bundle and performance budgets are enforced.
- [ ] Heavy reports and audit screens are paginated and bounded.

### Evidence package

- [ ] Latest commit SHA recorded.
- [ ] Migration list recorded.
- [ ] CI run URL/status recorded.
- [ ] Test summary recorded, including DB version and skipped count.
- [ ] Security test summary recorded.
- [ ] E2E artifact/report link recorded.
- [ ] Backup/restore drill evidence recorded.
- [ ] Manual UI verification date, browser and tester recorded.
- [ ] Known accepted risks have owner, mitigation and expiry date.

---

## 9. Progress tracker

| ID | Priority | Status | Evidence / PR / commit | Owner | Target date | Notes |
|---|---|---|---|---|---|---|
| SEC-001 | P0 | [ ] |  |  |  | Authentication and server identity |
| SEC-002 | P0 | [ ] |  |  |  | Company/branch/role authorization |
| SEC-003 | P0 | [ ] |  |  |  | Sensitive endpoints and audit access |
| SEC-004 | P1 | [ ] |  |  |  | Rate limiting and lock-password throttling |
| SEC-005 | P1 | [ ] |  |  |  | HTTP/deployment hardening |
| ACC-001 | P1 | [ ] |  |  |  | Invariants and concurrency |
| ACC-002 | P1 | [ ] |  |  |  | Year-end close permissions and atomicity |
| QA-001 | P1 | [ ] |  |  |  | Required test layers and E2E |
| QA-002 | P1 | [ ] |  |  |  | Release/change-control gates |
| OPS-001 | P1 | [ ] |  |  |  | Backup/restore/DR |
| OPS-002 | P1 | [ ] |  |  |  | Observability/runtime |
| UX-001 | P2 | [ ] |  |  |  | Keyboard/accessibility/recovery |
| PERF-001 | P2 | [ ] |  |  |  | Bundle/query/runtime performance |
| DEV-001 | P2 | [ ] |  |  |  | Dependency and maintainability |

---

## 10. Change log

| Date | Change | Commit |
|---|---|---|
| 2026-11-28 | Initial tracker created from application audit; no implementation changes included | Pending |

---

## Related documents

- `PROJECT_TRACKER.md` — existing project/module tracker.
- `TODO.md` — feature-level TODOs and workflow plans.
- `README.md` — setup, migration and test commands.
