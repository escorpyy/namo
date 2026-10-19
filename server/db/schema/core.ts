import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { createdAt, updatedAt } from "./_helpers";
import {
  auditActionEnum,
  businessTypeEnum,
  calendarPreferenceEnum,
  companyRoleEnum,
} from "./enums";
import { generalLedger } from "./accounting";

// ============================================================
// COMPANY — top level of the header switcher:
// Company -> Branch -> Fiscal Year. Each row is one legal entity.
// ============================================================

export const company = pgTable(
  "Company",
  {
    id: serial().primaryKey(),
    code: varchar({ length: 15 }).notNull(), // short slug used in the switcher
    name: varchar({ length: 200 }).notNull(), // trade/display name
    legalName: varchar({ length: 200 }), // full registered name
    businessType: businessTypeEnum().notNull().default("OTHER"),

    registrationNo: varchar({ length: 50 }),
    panNo: varchar({ length: 25 }),
    vatNo: varchar({ length: 25 }),
    isVatRegistered: boolean().notNull().default(false),
    taxOfficeName: varchar({ length: 100 }),

    address: varchar({ length: 300 }),
    city: varchar({ length: 50 }),
    district: varchar({ length: 50 }),
    province: varchar({ length: 50 }),
    country: varchar({ length: 50 }).default("Nepal"),
    phone: varchar({ length: 20 }),
    email: varchar({ length: 255 }),
    website: varchar({ length: 255 }),
    logoUrl: varchar({ length: 500 }),

    baseCurrency: varchar({ length: 3 }).notNull().default("NPR"),
    defaultCalendarPref: calendarPreferenceEnum().notNull().default("BS"),

    // Year-end P&L closing target. Nullable for a brand-new company, but
    // must be set before any roll-forward runs. A trigger (not expressible
    // here) must ensure the GL belongs to this same company.
    retainedEarningsGLId: integer().references(
      (): AnyPgColumn => generalLedger.id,
      { onDelete: "restrict" },
    ),

    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("Company_code_key").on(t.code),
    uniqueIndex("Company_retainedEarningsGLId_key").on(t.retainedEarningsGLId),
    index("Company_isActive_idx").on(t.isActive),
  ],
);

// ============================================================
// BRANCH — second level of the switcher. Scoped to one Company.
// ============================================================

export const branch = pgTable(
  "Branch",
  {
    id: serial().primaryKey(),
    companyId: integer()
      .notNull()
      .references(() => company.id, { onDelete: "restrict" }),

    code: varchar({ length: 15 }).notNull(),
    name: varchar({ length: 100 }).notNull(),
    isHeadOffice: boolean().notNull().default(false),

    address: varchar({ length: 300 }),
    phone: varchar({ length: 20 }),
    email: varchar({ length: 255 }),

    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("Branch_companyId_code_key").on(t.companyId, t.code),
    uniqueIndex("Branch_companyId_name_key").on(t.companyId, t.name),
    index("Branch_companyId_idx").on(t.companyId),
    // Only one head office per company. (Prisma couldn't express this; it
    // lived in raw migration SQL. Drizzle can, so it is declared here.)
    uniqueIndex("Branch_companyId_headOffice_key")
      .on(t.companyId)
      .where(sql`${t.isHeadOffice} = true`),
  ],
);

// ============================================================
// USER
// ============================================================

export const user = pgTable(
  "User",
  {
    id: serial().primaryKey(),
    name: varchar({ length: 100 }).notNull(),
    email: varchar({ length: 255 }).notNull(),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),

    // Which side of NepaliDatePicker is the free-typed input. Display only:
    // every date column in the schema is stored as AD regardless.
    calendarPreference: calendarPreferenceEnum().notNull().default("BS"),
  },
  (t) => [uniqueIndex("User_email_key").on(t.email)],
);

// ============================================================
// USER <-> COMPANY ACCESS
// A null branchId means "all branches of that company".
// ============================================================

export const userCompanyAccess = pgTable(
  "UserCompanyAccess",
  {
    id: serial().primaryKey(),
    userId: integer()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    companyId: integer()
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    branchId: integer().references(() => branch.id, { onDelete: "cascade" }),

    role: companyRoleEnum().notNull().default("VIEWER"),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("UserCompanyAccess_userId_companyId_branchId_key").on(
      t.userId,
      t.companyId,
      t.branchId,
    ),
    index("UserCompanyAccess_companyId_idx").on(t.companyId),
    index("UserCompanyAccess_branchId_idx").on(t.branchId),
  ],
);

// ============================================================
// FISCAL YEAR
// ============================================================

export const fiscalYear = pgTable(
  "FiscalYear",
  {
    id: serial().primaryKey(),
    companyId: integer()
      .notNull()
      .references(() => company.id, { onDelete: "restrict" }),

    code: varchar({ length: 15 }).notNull(), // "2082/083"

    // AD is the only source of truth; BS is derived at the edges for display.
    startDate: date({ mode: "date" }).notNull(),
    endDate: date({ mode: "date" }).notNull(),

    isCurrent: boolean().notNull().default(false),

    isClosed: boolean().notNull().default(false),
    closedAt: timestamp({ precision: 3 }),
    closedBy: integer().references(() => user.id, { onDelete: "set null" }),

    // One flag locking every OpeningBalance/StockOpeningBalance row for
    // this year at once (see fn_block_locked_ob_edit trigger).
    isOpeningBalanceLocked: boolean().notNull().default(false),
    openingBalanceLockedAt: timestamp({ precision: 3 }),
    openingBalanceLockedBy: integer().references(() => user.id, {
      onDelete: "set null",
    }),

    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("FiscalYear_companyId_code_key").on(t.companyId, t.code),
    index("FiscalYear_companyId_idx").on(t.companyId),
    index("FiscalYear_companyId_isCurrent_idx").on(t.companyId, t.isCurrent),
    index("FiscalYear_isClosed_idx").on(t.isClosed),
    // Only one CURRENT fiscal year per company. (Was raw migration SQL.)
    uniqueIndex("FiscalYear_companyId_current_key")
      .on(t.companyId)
      .where(sql`${t.isCurrent} = true`),
  ],
);

// ============================================================
// AUDIT LOG (generic, DB-trigger based)
// ============================================================

export const auditLog = pgTable(
  "AuditLog",
  {
    id: bigserial({ mode: "bigint" }).primaryKey(),
    tableName: varchar({ length: 63 }).notNull(),
    recordId: text().notNull(),
    action: auditActionEnum().notNull(),
    oldData: jsonb(),
    newData: jsonb(),
    changedBy: integer().references(() => user.id, { onDelete: "set null" }),
    changedAt: timestamp({ precision: 3 }).notNull().defaultNow(),
  },
  (t) => [
    index("AuditLog_tableName_recordId_idx").on(t.tableName, t.recordId),
    index("AuditLog_changedAt_idx").on(t.changedAt),
  ],
);
