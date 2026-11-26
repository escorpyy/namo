import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  serial,
  smallint,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import {
  accountTypeEnum,
  statementAccountFlagEnum,
  statementCfsSourceEnum,
  statementDrillDepthEnum,
  statementKindEnum,
  statementLineAxisEnum,
  statementLineNatureEnum,
  statementLineTypeEnum,
  statementMovementKindEnum,
} from "./enums";
import { accountGroup, accountSubGroup, generalLedger } from "./accounting";
import { company, user } from "./core";
import { createdAt, updatedAt } from "./_helpers";

const statementRoles = [
  "PROFIT_FOR_PERIOD",
  "GROSS_PROFIT",
  "CASH_AND_EQUIVALENTS",
  "TOTAL_ASSETS",
  "TOTAL_EQUITY",
  "TOTAL_EQUITY_AND_LIABILITIES",
  "TOTAL_CURRENT_ASSETS",
  "TOTAL_NONCURRENT_ASSETS",
  "TOTAL_CURRENT_LIABILITIES",
  "TOTAL_NONCURRENT_LIABILITIES",
  "CFS_OPERATING",
  "CFS_INVESTING",
  "CFS_FINANCING",
  "SCOE_COLUMN",
  "SCOE_MOVEMENT_OPENING",
  "SCOE_MOVEMENT_PROFIT",
  "SCOE_MOVEMENT_OTHER",
  "SCOE_MOVEMENT_CLOSING",
] as const;

const glSetupRoles = [
  "PROFIT_AND_LOSS",
  "CASH_BOOK",
  "SALES_ACCOUNT",
  "SALES_RETURN_ACCOUNT",
  "PURCHASE_ACCOUNT",
  "PURCHASE_RETURN_ACCOUNT",
  "INPUT_VAT",
  "OUTPUT_VAT",
  "IMPORT_INPUT_VAT",
  "OPENING_STOCK_PL",
  "CLOSING_STOCK_PL",
  "CLOSING_STOCK_BS",
] as const;

export const statementTemplate = pgTable(
  "StatementTemplate",
  {
    id: serial().primaryKey(),
    companyId: integer().notNull().references(() => company.id, { onDelete: "restrict" }),
    name: varchar({ length: 100 }).notNull(),
    description: varchar({ length: 500 }),
    isSystem: boolean().notNull().default(false),
    isDefault: boolean().notNull().default(false),
    isActive: boolean().notNull().default(true),
    createdBy: integer().references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("StatementTemplate_id_companyId_key").on(t.id, t.companyId),
    uniqueIndex("StatementTemplate_companyId_name_key").on(t.companyId, sql`lower(${t.name})`),
    uniqueIndex("StatementTemplate_companyId_default_key").on(t.companyId).where(sql`${t.isDefault} = true AND ${t.isActive} = true`),
    uniqueIndex("StatementTemplate_companyId_system_key").on(t.companyId).where(sql`${t.isSystem} = true AND ${t.isActive} = true`),
    index("StatementTemplate_companyId_idx").on(t.companyId),
    check("StatementTemplate_default_active_check", sql`NOT ${t.isDefault} OR ${t.isActive}`),
  ],
);

export const statementLine = pgTable(
  "StatementLine",
  {
    id: serial().primaryKey(),
    templateId: integer().notNull().references(() => statementTemplate.id, { onDelete: "cascade" }),
    statement: statementKindEnum().notNull(),
    code: varchar({ length: 64 }).notNull(),
    label: varchar({ length: 160 }).notNull(),
    // Same-template/same-statement scope is checked by the line service. A simple
    // self-FK prevents dangling parent IDs without a cyclic composite FK.
    parentLineId: integer().references((): AnyPgColumn => statementLine.id, { onDelete: "restrict" }),
    axis: statementLineAxisEnum().notNull().default("LINE"),
    sortOrder: integer().notNull(),
    lineType: statementLineTypeEnum().notNull(),
    nature: statementLineNatureEnum(),
    role: varchar({ length: 48 }),
    allowedTypes: accountTypeEnum().array().notNull().default(sql`ARRAY[]::"AccountType"[]`),
    noteNo: varchar({ length: 16 }),
    drillDepth: statementDrillDepthEnum().notNull().default("NONE"),
    showWhenZero: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("StatementLine_id_templateId_key").on(t.id, t.templateId),
    uniqueIndex("StatementLine_id_templateId_statement_key").on(t.id, t.templateId, t.statement),
    uniqueIndex("StatementLine_templateId_statement_code_key").on(t.templateId, t.statement, t.code),
    uniqueIndex("StatementLine_templateId_role_singleton_key")
      .on(t.templateId, t.role)
      .where(sql`${t.role} IS NOT NULL AND ${t.role} <> 'SCOE_COLUMN'`),
    index("StatementLine_templateId_statement_sortOrder_idx").on(t.templateId, t.statement, t.sortOrder),
    index("StatementLine_parentLineId_idx").on(t.parentLineId),
    check(
      "StatementLine_role_check",
      sql`${t.role} IS NULL OR ${t.role} IN (${sql.raw(statementRoles.map((role) => `'${role}'`).join(", "))})`,
    ),
    check(
      "StatementLine_shape_check",
      sql`(${t.lineType} = 'HEADING' AND ${t.nature} IS NULL AND ${t.role} IS NULL AND cardinality(${t.allowedTypes}) = 0)
        OR (${t.lineType} = 'MAPPED' AND ${t.nature} IS NOT NULL AND cardinality(${t.allowedTypes}) > 0)
        OR (${t.lineType} = 'COMPUTED' AND ${t.nature} IS NULL AND cardinality(${t.allowedTypes}) = 0)`,
    ),
    check(
      "StatementLine_axis_check",
      sql`((${t.statement} IN ('PL', 'BS', 'CFS')) AND ${t.axis} = 'LINE')
        OR (${t.statement} = 'SCOE' AND ${t.axis} IN ('ROW', 'COLUMN'))`,
    ),
    check("StatementLine_not_own_parent_check", sql`${t.parentLineId} IS NULL OR ${t.parentLineId} <> ${t.id}`),
  ],
);

export const statementLineFormula = pgTable(
  "StatementLineFormula",
  {
    id: serial().primaryKey(),
    templateId: integer().notNull().references(() => statementTemplate.id, { onDelete: "cascade" }),
    statement: statementKindEnum().notNull(),
    lineId: integer().notNull(),
    termLineId: integer().notNull(),
    sign: smallint().notNull(),
    sortOrder: integer().notNull(),
  },
  (t) => [
    foreignKey({
      name: "StatementLineFormula_line_scope_fk",
      columns: [t.lineId, t.templateId, t.statement],
      foreignColumns: [statementLine.id, statementLine.templateId, statementLine.statement],
    }).onDelete("cascade"),
    foreignKey({
      name: "StatementLineFormula_term_scope_fk",
      columns: [t.termLineId, t.templateId, t.statement],
      foreignColumns: [statementLine.id, statementLine.templateId, statementLine.statement],
    }).onDelete("restrict"),
    uniqueIndex("StatementLineFormula_line_term_key").on(t.lineId, t.termLineId),
    index("StatementLineFormula_line_sortOrder_idx").on(t.lineId, t.sortOrder),
    check("StatementLineFormula_sign_check", sql`${t.sign} IN (-1, 1)`),
    check("StatementLineFormula_distinct_lines_check", sql`${t.lineId} <> ${t.termLineId}`),
  ],
);

export const statementLineMapping = pgTable(
  "StatementLineMapping",
  {
    id: serial().primaryKey(),
    templateId: integer().notNull().references(() => statementTemplate.id, { onDelete: "cascade" }),
    statement: statementKindEnum().notNull(),
    lineId: integer().notNull(),
    accountGroupId: integer().references(() => accountGroup.id, { onDelete: "restrict" }),
    accountSubGroupId: integer().references(() => accountSubGroup.id, { onDelete: "restrict" }),
    generalLedgerId: integer().references(() => generalLedger.id, { onDelete: "restrict" }),
    glSetupRole: varchar({ length: 32 }),
    fallbackGeneralLedgerId: integer().references(() => generalLedger.id, { onDelete: "restrict" }),
    accountFlag: statementAccountFlagEnum(),
    cfsSource: statementCfsSourceEnum(),
    movementKind: statementMovementKindEnum(),
    sortOrder: integer().notNull().default(0),
  },
  (t) => [
    foreignKey({
      name: "StatementLineMapping_line_scope_fk",
      columns: [t.lineId, t.templateId, t.statement],
      foreignColumns: [statementLine.id, statementLine.templateId, statementLine.statement],
    }).onDelete("cascade"),
    index("StatementLineMapping_template_statement_line_idx").on(t.templateId, t.statement, t.lineId),
    index("StatementLineMapping_fallbackGeneralLedgerId_idx").on(t.fallbackGeneralLedgerId),
    uniqueIndex("StatementLineMapping_group_target_key")
      .on(t.templateId, t.statement, t.accountGroupId)
      .where(sql`${t.accountGroupId} IS NOT NULL`),
    uniqueIndex("StatementLineMapping_subgroup_target_key")
      .on(t.templateId, t.statement, t.accountSubGroupId)
      .where(sql`${t.accountSubGroupId} IS NOT NULL`),
    uniqueIndex("StatementLineMapping_ledger_target_key")
      .on(t.templateId, t.statement, t.generalLedgerId)
      .where(sql`${t.generalLedgerId} IS NOT NULL`),
    uniqueIndex("StatementLineMapping_glSetupRole_target_key")
      .on(t.templateId, t.statement, t.glSetupRole)
      .where(sql`${t.glSetupRole} IS NOT NULL`),
    uniqueIndex("StatementLineMapping_fallbackLedger_target_key")
      .on(t.templateId, t.statement, t.fallbackGeneralLedgerId)
      .where(sql`${t.fallbackGeneralLedgerId} IS NOT NULL`),
    uniqueIndex("StatementLineMapping_accountFlag_target_key")
      .on(t.templateId, t.statement, t.accountFlag)
      .where(sql`${t.accountFlag} IS NOT NULL`),
    check(
      "StatementLineMapping_one_target_check",
      sql`num_nonnulls(${t.accountGroupId}, ${t.accountSubGroupId}, ${t.generalLedgerId}, ${t.glSetupRole}, ${t.accountFlag}) = 1`,
    ),
    check(
      "StatementLineMapping_role_fallback_check",
      sql`${t.fallbackGeneralLedgerId} IS NULL OR ${t.glSetupRole} IS NOT NULL`,
    ),
    check(
      "StatementLineMapping_glSetupRole_check",
      sql`${t.glSetupRole} IS NULL OR ${t.glSetupRole} IN (${sql.raw(glSetupRoles.map((role) => `'${role}'`).join(", "))})`,
    ),
    check(
      "StatementLineMapping_cfs_source_check",
      sql`(${t.statement} = 'CFS' AND ${t.cfsSource} IS NOT NULL)
        OR (${t.statement} <> 'CFS' AND ${t.cfsSource} IS NULL)`,
    ),
    check(
      "StatementLineMapping_movement_kind_check",
      sql`${t.movementKind} IS NULL OR ${t.statement} IN ('CFS', 'SCOE')`,
    ),
    check(
      "StatementLineMapping_account_flag_check",
      sql`${t.accountFlag} IS NULL OR ${t.statement} IN ('BS', 'CFS')`,
    ),
  ],
);
