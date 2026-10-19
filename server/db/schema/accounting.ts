import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  pgTable,
  serial,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
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
    // Denormalized from accountSubGroup -> accountGroup -> company, since GL
    // is the most frequently company-filtered table. A trigger must keep it
    // in sync with the parent AccountGroup's companyId.
    companyId: integer()
      .notNull()
      .references(() => company.id, { onDelete: "restrict" }),

    code: varchar({ length: 20 }).notNull(),
    name: varchar({ length: 100 }).notNull(),
    accountSubGroupId: integer()
      .notNull()
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
    index("GeneralLedger_accountSubGroupId_idx").on(t.accountSubGroupId),
    index("GeneralLedger_parentId_idx").on(t.parentId),
    index("GeneralLedger_glType_idx").on(t.glType),
    index("GeneralLedger_subAreaId_idx").on(t.subAreaId),
    index("GeneralLedger_agentId_idx").on(t.agentId),
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
