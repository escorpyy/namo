import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  pgTable,
  serial,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createdAt, updatedAt } from "./_helpers";
import { accountTypeEnum, glTypeEnum, normalBalanceEnum } from "./enums";
import { company } from "./core";
import { agent, party, subArea } from "./parties";

// ============================================================
// CHART OF ACCOUNTS
// ============================================================

export const accountGroup = pgTable(
  "AccountGroup",
  {
    id: serial().primaryKey(),
    companyId: integer()
      .notNull()
      .references(() => company.id, { onDelete: "restrict" }),

    code: varchar({ length: 10 }).notNull(),
    description: varchar({ length: 50 }).notNull(),
    type: accountTypeEnum().notNull(),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("AccountGroup_companyId_code_key").on(t.companyId, t.code),
    uniqueIndex("AccountGroup_companyId_description_key").on(
      t.companyId,
      t.description,
    ),
    index("AccountGroup_companyId_idx").on(t.companyId),
  ],
);

export const accountSubGroup = pgTable(
  "AccountSubGroup",
  {
    id: serial().primaryKey(),
    code: varchar({ length: 10 }).notNull(),
    description: varchar({ length: 50 }).notNull(),
    accountGroupId: integer()
      .notNull()
      .references(() => accountGroup.id, { onDelete: "restrict" }),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("AccountSubGroup_accountGroupId_code_key").on(
      t.accountGroupId,
      t.code,
    ),
    uniqueIndex("AccountSubGroup_accountGroupId_description_key").on(
      t.accountGroupId,
      t.description,
    ),
  ],
);

// ============================================================
// GENERAL LEDGER (formerly "Account")
// ============================================================

export const generalLedger = pgTable(
  "GeneralLedger",
  {
    id: serial().primaryKey(),
    // Denormalized from accountGroup -> company, since GL
    // is the most frequently company-filtered table. A trigger must keep it
    // in sync with the parent AccountGroup's companyId.
    companyId: integer()
      .notNull()
      .references(() => company.id, { onDelete: "restrict" }),

    code: varchar({ length: 20 }).notNull(),
    name: varchar({ length: 100 }).notNull(),
    accountGroupId: integer()
      .notNull()
      .references(() => accountGroup.id, { onDelete: "restrict" }),
    accountSubGroupId: integer()
      .references(() => accountSubGroup.id, { onDelete: "restrict" }),
    normalBalance: normalBalanceEnum().notNull(),
    glType: glTypeEnum().notNull().default("OTHER"),

    parentId: integer().references((): AnyPgColumn => generalLedger.id, {
      onDelete: "restrict",
    }),

    isCashOrBank: boolean().notNull().default(false),
    postsToCashBook: boolean().notNull().default(false),
    requiresSubLedger: boolean().notNull().default(false),
    allowDocAdjust: boolean().notNull().default(false),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),

    subAreaId: integer().references(() => subArea.id, { onDelete: "set null" }),
    agentId: integer().references(() => agent.id, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("GeneralLedger_companyId_code_key").on(t.companyId, t.code),
    index("GeneralLedger_companyId_idx").on(t.companyId),
    index("GeneralLedger_accountGroupId_idx").on(t.accountGroupId),
    index("GeneralLedger_accountSubGroupId_idx").on(t.accountSubGroupId),
    index("GeneralLedger_parentId_idx").on(t.parentId),
    index("GeneralLedger_glType_idx").on(t.glType),
    index("GeneralLedger_subAreaId_idx").on(t.subAreaId),
    index("GeneralLedger_agentId_idx").on(t.agentId),
  ],
);

// Company-level default GL mappings and entry permissions. These do not replace
// per-product ledger mappings; they define named roles and gate matching entries.
export const generalLedgerSetup = pgTable(
  "GeneralLedgerSetup",
  {
    id: serial().primaryKey(),
    companyId: integer().notNull().references(() => company.id, { onDelete: "restrict" }),
    role: varchar({ length: 32 }).notNull(),
    generalLedgerId: integer().references(() => generalLedger.id, { onDelete: "restrict" }),
    allowJournal: boolean().notNull().default(false),
    allowCashBank: boolean().notNull().default(false),
    allowSalesInvoice: boolean().notNull().default(false),
    allowSalesReturn: boolean().notNull().default(false),
    allowPurchaseBill: boolean().notNull().default(false),
    allowPurchaseReturn: boolean().notNull().default(false),
    allowOpeningBalance: boolean().notNull().default(false),
    allowStockOpening: boolean().notNull().default(false),
    isLocked: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("GeneralLedgerSetup_companyId_role_key").on(t.companyId, t.role),
    index("GeneralLedgerSetup_companyId_idx").on(t.companyId),
    index("GeneralLedgerSetup_generalLedgerId_idx").on(t.generalLedgerId),
    check("GeneralLedgerSetup_role_check", sql`${t.role} in ('PROFIT_AND_LOSS','CASH_BOOK','SALES_ACCOUNT','SALES_RETURN_ACCOUNT','PURCHASE_ACCOUNT','PURCHASE_RETURN_ACCOUNT','INPUT_VAT','OUTPUT_VAT','IMPORT_INPUT_VAT','OPENING_STOCK_PL','CLOSING_STOCK_PL','CLOSING_STOCK_BS')`),
  ],
);

// Entry Control: a company's choices for the features of each source module (see shared/entryControl.ts). No row means the feature's defaults.
export const entryControl = pgTable(
  "EntryControl",
  {
    id: serial().primaryKey(),
    companyId: integer().notNull().references(() => company.id, { onDelete: "restrict" }),
    module: varchar({ length: 40 }).notNull(),
    feature: varchar({ length: 40 }).notNull(),
    isShown: boolean().notNull().default(true),
    isEditable: boolean().notNull().default(true),
    isMandatory: boolean().notNull().default(false),
    ruleLevel: varchar({ length: 6 }).notNull().default("WARN"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("EntryControl_companyId_module_feature_key").on(t.companyId, t.module, t.feature),
    check("EntryControl_ruleLevel_check", sql`${t.ruleLevel} in ('IGNORE','WARN','BLOCK')`),
  ],
);

// ============================================================
// SUB LEDGER
// Finer-grained posting account under a GL and/or tied to a Party; used
// where a GL has `requiresSubLedger` set.
// ============================================================

export const subLedger = pgTable(
  "SubLedger",
  {
    id: serial().primaryKey(),
    code: varchar({ length: 20 }).notNull(),
    name: varchar({ length: 100 }).notNull(),

    generalLedgerId: integer().references(() => generalLedger.id, {
      onDelete: "restrict",
    }),
    partyId: integer().references(() => party.id, { onDelete: "restrict" }),

    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("SubLedger_code_key").on(t.code),
    index("SubLedger_generalLedgerId_idx").on(t.generalLedgerId),
    index("SubLedger_partyId_idx").on(t.partyId),
  ],
);
