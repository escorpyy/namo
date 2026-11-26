# Phase 1 Proposal — Statement Template Schema and NFRS Seed Structure

**Status:** design proposal only; no application schema, migration, seed, or database was changed or run.

This proposal follows the audit of the current `escorpyy/namo` source. It preserves the existing chart of accounts and GL Setup, supports one template containing all four statements, makes mappings stable under account renaming, and resolves the audit's open decisions explicitly.

## 1. Decisions to lock before implementing Phase 1

1. **GL Setup roles are optional.** A missing role does not block viewing a report or make the system template incomplete. Role mappings resolve when assigned. The seeded template includes stable-code fallback aliases for the three seed stock ledgers, so it works without silently writing to `GeneralLedgerSetup`.
2. **Role target and seed fallback are both retained.** For stock mappings, resolve the configured GL Setup role to its assigned ledger, and also map the stable seed ledger fallback to the same line. This is deliberate: if a user assigns the role to another ledger, the original seeded ledger may still carry balances and must not become unmapped. If both identify the same ledger, deduplicate it.
3. **No default tax-expense mapping is invented.** Seed a `Tax expense` P&L line with `allowedTypes = ['EXPENSE']`, but no mapping. The seeded `GL016` is a liability provision, not an expense, so map it only to the BS tax-provision line. A company can explicitly map an existing expense ledger/subgroup to the P&L tax line. Until then the line is zero; no other expense is silently reclassified as tax.
4. **Make period semantics explicit and stable, not a template toggle.** P&L, CFS, and SCOE movements/profit use the selected `from..to` range. The BS is as at `to`; its current-year result is fiscal-year-to-date (`FY start..to`) because that is the amount belonging in equity at the balance-sheet date. SCOE opens at the day before `from` and closes at `to`; its profit row is selected-period profit. CFS opens at the day before `from` and closes at `to`, using selected-period P&L. Comparative statements use the same effective interval in the prior fiscal year when available; the API must specify the mapped prior dates rather than silently compare an arbitrary full year.
5. **Cash is identified by the existing `isCashOrBank` flag, not the `CASH_BOOK` role.** `CASH_BOOK` is the default posting ledger, not the complete set of cash-equivalent ledgers.
6. **System templates are immutable in the service layer.** The database can mark them, but API/service validation must reject edits/deletes to the system template and all its children. Copying it creates an ordinary company-owned template.
7. **All mappings are company-validated.** For each request, template company must match each referenced account group, subgroup, ledger, or role assignment. Existing target tables do not expose composite `(id, companyId)` foreign keys, so this is validated in the service transaction (and may additionally be guarded by triggers if Phase 1 finds the existing migration patterns make that low-risk).

## 2. Statement and line enums

Use Postgres enums (and export matching TypeScript unions):

```text
StatementKind = PL | BS | CFS | SCOE
StatementLineType = HEADING | MAPPED | COMPUTED
StatementLineNature = DEBIT | CREDIT
StatementDrillDepth = NONE | GROUP | SUBGROUP | LEDGER
StatementLineAxis = LINE | ROW | COLUMN
StatementCfsSource = BS_MOVEMENT | PL_ADDBACK | CASH_FLAG
StatementMovementKind = DRAWINGS | DIVIDENDS | CAPITAL_INTRODUCED | TRANSFER | OTHER
StatementAccountFlag = IS_CASH_OR_BANK
```

`StatementLineAxis` is `LINE` for PL, BS, and CFS. SCOE uses `COLUMN` for equity components and `ROW` for the statement's movement rows. A row/column must have matching `statement = SCOE`; ordinary lines in the other three statements must use `LINE`.

Use a checked nullable `role` string instead of forcing future role evolution through a rigid enum migration. Initial accepted roles:

```text
# Singleton / semantic calculation roles
PROFIT_FOR_PERIOD, GROSS_PROFIT, CASH_AND_EQUIVALENTS,
TOTAL_ASSETS, TOTAL_EQUITY, TOTAL_EQUITY_AND_LIABILITIES,
TOTAL_CURRENT_ASSETS, TOTAL_NONCURRENT_ASSETS,
TOTAL_CURRENT_LIABILITIES, TOTAL_NONCURRENT_LIABILITIES,
CFS_OPERATING, CFS_INVESTING, CFS_FINANCING,

# Repeatable SCOE column marker
SCOE_COLUMN,

# Singleton SCOE row markers
SCOE_MOVEMENT_OPENING, SCOE_MOVEMENT_PROFIT,
SCOE_MOVEMENT_OTHER, SCOE_MOVEMENT_CLOSING
```

`SCOE_COLUMN` is explicitly repeatable. All other listed roles are at most one per template; this is enforced with partial unique indexes for singleton roles and service validation. A role-bearing `COMPUTED` line may be evaluated by the engine's defined semantic role even when it has no user formula (for example, `CASH_AND_EQUIVALENTS` and `PROFIT_FOR_PERIOD`).

## 3. Proposed tables

### 3.1 `StatementTemplate`

```text
id             serial primary key
companyId      int not null references Company(id) on delete restrict
name           varchar(100) not null
 description   varchar(500) null
isSystem       boolean not null default false
isDefault      boolean not null default false
isActive       boolean not null default true
createdBy      int null references User(id) on delete set null
createdAt      timestamptz not null default now()
updatedAt      timestamptz not null default now()
```

Constraints/indexes:

- unique `(id, companyId)` for composite child scoping;
- unique case-insensitive `(companyId, lower(name))`;
- partial unique `(companyId) WHERE isDefault AND isActive` (at most one active default);
- optional partial unique `(companyId) WHERE isSystem AND isActive` (one system template per company);
- check: `NOT isDefault OR isActive`.

A system template may be copied, but not renamed, deleted, deactivated, default-switched, or child-edited by the service. It can be the default. “Default” remains a company choice; seeding may make NFRS default only when the company has no default already.

### 3.2 `StatementLine`

```text
id             serial primary key
templateId     int not null
statement      StatementKind not null
code           varchar(64) not null
label          varchar(160) not null
parentLineId   int null
axis           StatementLineAxis not null default 'LINE'
sortOrder      int not null
lineType       StatementLineType not null
nature         StatementLineNature null
role           varchar(48) null
allowedTypes   AccountType[] not null default '{}'
noteNo         varchar(16) null
drillDepth     StatementDrillDepth not null default 'NONE'
showWhenZero   boolean not null default false
createdAt      timestamptz not null default now()
updatedAt      timestamptz not null default now()
```

Constraints/indexes:

- FK `(templateId)` → `StatementTemplate(id)` with delete cascade for copied/user templates;
- unique `(id, templateId)` and `(id, templateId, statement)`;
- unique `(templateId, statement, code)`;
- self-FK for `parentLineId` prevents dangling references; save/service validation enforces same-template/same-statement parents and rejects longer tree cycles;
- check: `lineType = 'HEADING'` implies `nature IS NULL` and `role IS NULL`; `lineType = 'MAPPED'` requires at least one allowed account type; `lineType = 'COMPUTED'` has no mapping rows;
- check axis compatibility: PL/BS/CFS only `LINE`; SCOE only `ROW` or `COLUMN`;
- prevent self-parenting; longer tree cycles rejected by service validation;
- partial unique `(templateId, role)` for non-null singleton roles; exclude `SCOE_COLUMN` from that index.

`allowedTypes` is a guard on resolved ledger types, not a classification rule. On save/validation, each direct or role-resolved mapping is checked against every affected ledger type. A group/subgroup mapping is validated against all current ledgers it resolves to and revalidated when a new ledger is introduced.

### 3.3 `StatementLineFormula`

```text
id             serial primary key
templateId     int not null
statement      StatementKind not null
lineId         int not null
termLineId     int not null
sign           smallint not null check (sign in (-1, 1))
sortOrder      int not null
```

Constraints/indexes:

- composite FK `(lineId, templateId, statement)` and `(termLineId, templateId, statement)` to `StatementLine(id, templateId, statement)`;
- unique `(lineId, termLineId)`;
- index `(lineId, sortOrder)`;
- service rejects formulas on non-computed lines and rejects cycles with a topological sort before save;
- formula terms must reference lines in the same statement. Cross-statement values are accessed only through semantic roles, never arbitrary cross-statement formula edges.

Formula evaluation uses integer micro-units / existing exact decimal helpers, not JavaScript floating point. Rounding is for display, not each addition.

### 3.4 `StatementLineMapping`

```text
id                       serial primary key
templateId               int not null
statement                StatementKind not null
lineId                   int not null
accountGroupId           int null references AccountGroup(id) on delete restrict
accountSubGroupId        int null references AccountSubGroup(id) on delete restrict
generalLedgerId          int null references GeneralLedger(id) on delete restrict
glSetupRole              varchar(32) null
fallbackGeneralLedgerId  int null references GeneralLedger(id) on delete restrict
accountFlag              StatementAccountFlag null
cfsSource                StatementCfsSource null
movementKind             StatementMovementKind null
sortOrder                int not null default 0
```

Constraints/indexes:

- composite FK `(lineId, templateId, statement)` to the matching line;
- exactly one primary target among `accountGroupId`, `accountSubGroupId`, `generalLedgerId`, `glSetupRole`, `accountFlag`:
  `num_nonnulls(accountGroupId, accountSubGroupId, generalLedgerId, glSetupRole, accountFlag) = 1`;
- `fallbackGeneralLedgerId` is permitted only when `glSetupRole IS NOT NULL`; it is an additional alias, not a second primary target;
- a direct group/subgroup/ledger or `accountFlag` cannot also specify a fallback ledger;
- `glSetupRole` must be in the existing 12 `GL_SETUP_ROLE_KEYS` (the accepted values are copied into a DB CHECK in the migration); no GL Setup row is created by this mapping;
- unique partial indexes per template+statement+target for group, subgroup, ledger, role, fallback ledger, and account flag. The same GL Setup role may map to different statement lines in different statements; one role target per statement/template;
- `cfsSource` is required for every CFS mapping and null outside CFS; `movementKind` is valid for CFS/SCOE mappings and null elsewhere;
- `accountFlag` currently allows `IS_CASH_OR_BANK`, only for BS/CFS and asset-compatible lines;
- service validates ownership of every resolved account target against the template's company, confirms subgroup is under the company-owned group, and checks GL Setup role row company ownership.

Resolution order within a statement: explicit ledger or resolved GL Setup role ledger → subgroup mapping → account-flag mapping → group mapping → unmapped. The account-flag tier precedes group fallback so flagged cash/bank ledgers are not swallowed by a broad current-assets mapping. For a role mapping, resolve the company’s configured role ledger first; additionally resolve its `fallbackGeneralLedgerId`; deduplicate identical GL IDs, then subject each ledger to line-type validation. A role left blank is optional and its fallback still resolves.

## 4. Period and amount contract

The report API should expose `periodMode` in its response for transparency, not store it on the template:

- **PL:** selected period movements (`from..to`), with credit-positive revenue and debit-positive expense. `PROFIT_FOR_PERIOD` equals that period's computed profit.
- **BS:** balances as of `to`, natural sign asset debit-positive / liability-equity credit-positive. Current-year profit for the equity side is P&L fiscal-year-to-date (`fiscalYear.start..to`), with closing journals included exactly once. A balance sheet at a partial date must not use only the selected-period profit.
- **CFS:** opening cash/BS movements at day before `from`, ending at `to`; movement and indirect-method profit relate only to `from..to`. Closing cash comes from all asset ledgers with `isCashOrBank = true` and must equal BS cash at `to`.
- **SCOE:** opening equity as of day before `from`, selected-period profit/movements, and closing equity as of `to`. Profit line must reconcile to selected-period PL; closing values must reconcile to BS at `to`.
- **Prior period:** compare like-for-like selected intervals (same relative period in prior FY, capped by prior FY end). If a valid prior fiscal year/date mapping is unavailable, return prior amount null and an explicit warning rather than comparing a partial current period with a full prior year.

`financialReportRows` currently uses opening balances plus postings before `start` for `opening`, and `closing` through `end`. Do not infer selected-period profit from `closing`; derive it from the period debit/credit or explicitly query FY start through end for the BS result. The new output should preserve opening/debit/credit/closing strings or a decimal-safe equivalent and distinguish selected-period profit from BS fiscal-YTD profit.

## 5. Seeded `NFRS for SMEs` structure

Template codes below are stable identifiers; labels are editable only on copies. Seed mappings use group/subgroup codes and GL Setup role keys, not display names. Stable GL codes are used only for fallback aliases to preserve the already-seeded stock ledgers and can be resolved to company-local IDs during idempotent seed creation.

### 5.1 P&L (`axis=LINE`)

| Code | Line / type | Nature or formula | Seed mapping |
|---|---|---|---|
| `PL_REVENUE` | Revenue from operations / MAPPED | CREDIT | AG005/AS001 and AG005/AS002; group AG005 fallback. Sales returns' debit balances net negative naturally. |
| `PL_OPEN_STOCK` | Opening stock / MAPPED | DEBIT | role `OPENING_STOCK_PL`, fallback GL050. |
| `PL_NET_PURCHASES` | Net purchases / MAPPED | DEBIT | AG007/AS001 and AG007/AS002; group mapping only if needed as fallback. |
| `PL_DIRECT_COSTS` | Direct costs / MAPPED | DEBIT | AG007/AS003, AS004, AS005. |
| `PL_CLOSING_STOCK` | Closing stock / MAPPED | CREDIT | role `CLOSING_STOCK_PL`, fallback GL051. |
| `PL_COGS` | Cost of goods sold / COMPUTED | `OPEN + NET_PURCHASES + DIRECT_COSTS - CLOSING_STOCK` | — |
| `PL_GROSS_PROFIT` | Gross profit / COMPUTED | `REVENUE - COGS`, role `GROSS_PROFIT` | — |
| `PL_OTHER_INCOME` | Other income / MAPPED | CREDIT | AG006 group. |
| `PL_EMPLOYEE_BENEFITS` | Employee benefits / MAPPED | DEBIT | AG008/AS002. |
| `PL_FINANCE_COSTS` | Finance costs / MAPPED | DEBIT | AG008/AS008; includes GL036 under seed chart. |
| `PL_DEPRECIATION` | Depreciation / MAPPED | DEBIT | AG008/AS006. |
| `PL_OTHER_EXPENSES` | Other expenses / MAPPED | DEBIT | AG008 group fallback; more-specific subgroup/ledger mappings override it. |
| `PL_PBT` | Profit before tax / COMPUTED | `GROSS_PROFIT + OTHER_INCOME - EMPLOYEE_BENEFITS - FINANCE_COSTS - DEPRECIATION - OTHER_EXPENSES` | — |
| `PL_TAX` | Income tax expense / MAPPED | DEBIT; `allowedTypes=[EXPENSE]` | **No default mapping.** Explicitly map an expense ledger/subgroup when company chart supports it. |
| `PL_PROFIT` | Profit for the period / COMPUTED | `PBT - TAX`, role `PROFIT_FOR_PERIOD` | — |

All mapped P&L rows have their account type restricted to REVENUE or EXPENSE as appropriate. `PL_CLOSING_STOCK` is credit-natural and subtracted in the formula, so GL051 never becomes revenue. If a future tax expense ledger is under AG008, map that specific ledger/subgroup to `PL_TAX`; the more-specific mapping overrides the AG008 fallback.

### 5.2 Balance Sheet (`axis=LINE`)

| Code | Line / type | Nature or formula | Seed mapping |
|---|---|---|---|
| `BS_SHARE_CAPITAL` | Share / owner / partners' capital / MAPPED | CREDIT | AG004/AS001, AS003, AS004; use subgroup overrides if separate displayed lines are desired. |
| `BS_RESERVES` | Reserves and retained earnings / MAPPED | CREDIT | AG011 group; AG004/AS005 (covers seeded GL018); role `PROFIT_AND_LOSS` may alias to this line only when its ledger is EQUITY. |
| `BS_SHORT_BORROW` | Short-term borrowings / MAPPED | CREDIT | AG003/AS005. |
| `BS_TRADE_PAYABLES` | Trade payables / MAPPED | CREDIT | AG003/AS001. |
| `BS_OTHER_CURRENT_LIAB` | Other current liabilities / MAPPED | CREDIT | AG003 fallback, with AS001 and AS005 overridden to trade-payables and borrowing lines; AG010 provision subgroups map to provisions. |
| `BS_PROVISIONS` | Provisions / MAPPED | CREDIT | AG010 group; GL016 is covered. |
| `BS_NONCURRENT_LIAB` | Non-current liabilities / MAPPED | CREDIT | AG009 group. |
| `BS_PPE` | Property, plant and equipment / MAPPED | DEBIT | AG002 group; credit accumulated depreciation nets inside by its credit posting. |
| `BS_NONCURRENT_ASSETS` | Other non-current assets / MAPPED | DEBIT | AG013 group; AG012/AS002 deposits may be classified here by explicit override if company policy requires. |
| `BS_INVENTORIES` | Inventories / MAPPED | DEBIT | role `CLOSING_STOCK_BS`, fallback GL003. |
| `BS_RECEIVABLES` | Trade receivables / MAPPED | DEBIT | AG001/AS004. |
| `BS_CASH` | Cash and cash equivalents / MAPPED | DEBIT; `allowedTypes=[ASSET]`; role `CASH_AND_EQUIVALENTS` | `accountFlag=IS_CASH_OR_BANK`, resolving every flagged asset ledger. Do not use `CASH_BOOK` as the only cash balance. |
| `BS_OTHER_CURRENT_ASSETS` | Other current assets / MAPPED | DEBIT | AG001 group fallback; specialized AS003 inventory, AS004 receivables, and cash-flag ledgers resolve to their own lines. AG012/AS001 may be assigned here by account policy. |
| `BS_TOTAL_EQUITY` | Total equity / COMPUTED | formula: share capital + reserves; role `TOTAL_EQUITY` | — |
| `BS_TOTAL_NCL` | Total non-current liabilities / COMPUTED | formula references non-current liability lines; role `TOTAL_NONCURRENT_LIABILITIES` | — |
| `BS_TOTAL_CL` | Total current liabilities / COMPUTED | formula references current liability lines; role `TOTAL_CURRENT_LIABILITIES` | — |
| `BS_TOTAL_EL` | Total equity and liabilities / COMPUTED | equity + non-current liabilities + current liabilities; role `TOTAL_EQUITY_AND_LIABILITIES` | — |
| `BS_TOTAL_NCA` | Total non-current assets / COMPUTED | PPE + non-current assets; role `TOTAL_NONCURRENT_ASSETS` | — |
| `BS_TOTAL_CA` | Total current assets / COMPUTED | inventory + receivables + cash + other current assets; role `TOTAL_CURRENT_ASSETS` | — |
| `BS_TOTAL_ASSETS` | Total assets / COMPUTED | non-current assets + current assets; role `TOTAL_ASSETS` | — |
| `BS_DIFFERENCE` | Difference / COMPUTED | assets - equity and liabilities; show when non-zero | — |

The system template should include any needed additional lines for current/non-current liability detail without changing these calculation roles. Group fallback maps only ledgers not caught by a more-specific subgroup/ledger/flag mapping. If `PROFIT_AND_LOSS` is unconfigured, current-year result is presented as an explicit computed result line in equity (or on the asset side for a loss), matching existing presentation behavior; it is not a required mapping. If that role is configured to a non-equity ledger, do not coerce it into reserves: keep the result separate, retain the actual ledger in its own balance-sheet classification, and emit a warning.

### 5.3 Cash Flow (`axis=LINE`)

| Code | Line / role | Source / mapping |
|---|---|---|
| `CFS_PROFIT` | Profit for selected period | Cross-statement `PROFIT_FOR_PERIOD` from PL; no account mapping. |
| `CFS_NONCASH` | Non-cash adjustments | PL add-back mappings, seeded AG008/AS006 (Depreciation), with `cfsSource=PL_ADDBACK`. No name regex. |
| `CFS_WC_ASSETS` | Working capital changes — assets | BS movements for operating current-asset subgroups; `cfsSource=BS_MOVEMENT`, asset increase is cash use. Exclude the cash flag. |
| `CFS_WC_LIABS` | Working capital changes — liabilities | BS movements for current operating liabilities (AG003 subgroups except borrowings), liability increase is cash source. |
| `CFS_OPERATING_TOTAL` | Net cash from operating activities / COMPUTED | profit + non-cash + working-capital rows; role `CFS_OPERATING`. |
| `CFS_INVEST` | Investing movements | `BS_MOVEMENT` targets AG002 and AG013 (and any explicitly investment-classified AG001/AS012), debit-positive increase is cash use; role `CFS_INVESTING`. |
| `CFS_FINANCE_DEBT` | Financing movements — borrowings | `BS_MOVEMENT` targets AG003/AS005 and AG009; liability increase is cash source. |
| `CFS_FINANCE_EQUITY` | Financing movements — equity | Equity movements excluding period profit; capital introduced, drawings, dividends can use `movementKind`; role `CFS_FINANCING`. |
| `CFS_NET_CHANGE` | Net change in cash / COMPUTED | operating + investing + financing. |
| `CFS_OPENING_CASH` | Opening cash / COMPUTED | all cash-flag ledger balances at day before `from`. |
| `CFS_CLOSING_CASH` | Closing cash / COMPUTED | all cash-flag ledger balances at `to`. |
| `CFS_CHECK` | Cash reconciliation / COMPUTED | closing - opening - net change; must equal zero (subject to rounding tolerance). |

Each CFS mapped target includes the `cfsSource` so the engine knows whether to take selected-period P&L debit/credit add-back or balance-sheet closing-minus-opening movement. Apply configured group/subgroup classifications rather than matching names. The cash-flow categories are company policy; no mandatory name-based default classification is needed to pass basic zero-unmapped checks, but the template validator should warn if a nonzero balance/movement has no CFS classification.

### 5.4 Statement of Changes in Equity (`axis=ROW` and `COLUMN`)

**Columns (`axis=COLUMN`, `lineType=MAPPED`, role `SCOE_COLUMN`):**

| Code | Column | Seed mapping |
|---|---|---|
| `SCOE_OWNER_CAPITAL` | Owner / partners / share capital | AG004/AS001, AS003, AS004; the relevant ledgers resolve by subgroup. |
| `SCOE_RESERVES` | Reserves and retained earnings | AG011 group plus AG004/AS005 (seed GL018); if configured and equity-typed, `PROFIT_AND_LOSS` role is an alias here. |

`SCOE_COLUMN` is repeatable. A copied template can add separate columns for share capital, partners' capital, drawings, or individual reserves without schema changes.

**Rows (`axis=ROW`, `lineType=COMPUTED`):**

| Code | Role | Calculation |
|---|---|---|
| `SCOE_OPENING` | `SCOE_MOVEMENT_OPENING` | Column balance at day before `from`. |
| `SCOE_PROFIT` | `SCOE_MOVEMENT_PROFIT` | Selected-period PL `PROFIT_FOR_PERIOD`, allocated to retained earnings by default. |
| `SCOE_OTHER` | `SCOE_MOVEMENT_OTHER` | Mapped movements (drawings/dividends/transfers) plus explicit residual “other”; residual is shown, not silently discarded. |
| `SCOE_CLOSING` | `SCOE_MOVEMENT_CLOSING` | Column balance at `to`; must reconcile to BS equity. |

Each movement mapping targets an equity ledger/subgroup and uses `movementKind` (`DRAWINGS`, `DIVIDENDS`, `CAPITAL_INTRODUCED`, `TRANSFER`, `OTHER`). Seed GL017 Drawings is AG004/AS002 and should classify as a movement, not as a standalone negative equity group. Opening/profit/other/closing are rows; the group/subgroup ledger balances form columns. The current-period profit remains visible when GL Setup `PROFIT_AND_LOSS` has not been assigned.

## 6. Validation contract for mappings and templates

Before a template may be selected as default or used for a final report:

- all line codes are unique within `(template, statement)`; parent links are acyclic and same-statement;
- computed formula graph is acyclic; every formula term exists and has the same statement;
- account target IDs belong to the template company; subgroup belongs to the stated company-owned group; role resolution is company-local;
- each resolved ledger type is in the mapped line's `allowedTypes`;
- no ledger/group/subgroup is claimed by two different lines in the same statement at the same specificity;
- each singleton semantic role is unique; required roles for that statement exist (e.g. PL `PROFIT_FOR_PERIOD`, BS totals, CFS reconciliation roles, SCOE standard rows/column); `SCOE_COLUMN` may repeat;
- nonzero unresolved ledgers and unclassified nonzero CFS movements appear in the returned unmapped/warning list. An incomplete user template can be saved as a draft, but cannot become the default or be used for a final report;
- if GL Setup roles are unset, only role-specific data may be absent; the system NFRS template remains usable because its stock fallback and computed profit/cash behavior do not depend on role assignment;
- revalidate existing group/subgroup mappings after account creation or type changes before finalizing a report, so a new ledger under a mapped fallback group is included or flagged predictably.

## 7. Phase 1 implementation boundary

Once this proposal is approved, Phase 1 implementation should add only:

1. Drizzle enums/schema in `server/db/schema/statementTemplates.ts`, export it from `server/db/schema/index.ts`, and update relations if needed.
2. A numbered migration source using the repository's Drizzle migration format, including partial unique indexes, checks, and FKs. Do **not** run it against any database.
3. Typecheck/build and schema-level unit/source tests that do not require a database.

Do not yet implement the engine, seed template, API, UI, or mutate GL Setup. Those remain later phases. The system-template rows described above should be implemented with the template/seed work in Phases 2–3, after this schema has been agreed.
