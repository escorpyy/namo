import { sql } from "drizzle-orm";
import { boolean, check, integer, pgTable, serial, uniqueIndex, varchar, index } from "drizzle-orm/pg-core";
import { updatedAt } from "./_helpers";
import { branch, company, user } from "./core";

// ============================================================
// NUMBER SERIES (shared/numberSeries.ts explains the idea)
//
// NumberSeries        one numbering rule for one kind of document; a company may have many per kind (cash / bank, local / import).
// NumberSeriesUser    which users may use it  (only read when allUsers = false)
// NumberSeriesBranch  which branches may use it (only read when allBranches = false)
// NumberCounter       the last number given, per series, branch and fiscal year. branchId 0 = one count for all branches (perBranch off),
//                     fiscalYear '' = one count for all years (resetPerFy off). Taken with an atomic upsert, so no two documents get the same number.
// Changing a series changes future documents only; the counters keep their last number.
// ============================================================

export const numberSeries = pgTable(
  "NumberSeries",
  {
    id: serial().primaryKey(),
    companyId: integer().notNull().references(() => company.id, { onDelete: "cascade" }),
    documentType: varchar({ length: 30 }).notNull(),
    name: varchar({ length: 60 }).notNull(),
    prefix: varchar({ length: 20 }).notNull().default(""),
    suffix: varchar({ length: 20 }).notNull().default(""),
    padding: integer().notNull().default(4),
    startNumber: integer().notNull().default(1),
    endNumber: integer(),
    increment: integer().notNull().default(1),
    mode: varchar({ length: 10 }).notNull().default("AUTOMATIC"),
    assignAt: varchar({ length: 5 }).notNull().default("DRAFT"),
    resetPerFy: boolean().notNull().default(true),
    perBranch: boolean().notNull().default(true),
    isDefault: boolean().notNull().default(false),
    isActive: boolean().notNull().default(true),
    allUsers: boolean().notNull().default(true),
    allBranches: boolean().notNull().default(true),
    updatedAt: updatedAt(),
    updatedBy: integer().references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("NumberSeries_companyId_documentType_name_key").on(t.companyId, t.documentType, t.name),
    // one default per kind of document
    uniqueIndex("NumberSeries_default_key").on(t.companyId, t.documentType).where(sql`${t.isDefault}`),
    index("NumberSeries_companyId_idx").on(t.companyId),
    check("NumberSeries_mode_check", sql`${t.mode} IN ('AUTOMATIC', 'SUGGESTED', 'MANUAL')`),
    check("NumberSeries_assignAt_check", sql`${t.assignAt} IN ('DRAFT', 'POST')`),
    check("NumberSeries_range_check", sql`${t.padding} BETWEEN 1 AND 10 AND ${t.startNumber} >= 0 AND ${t.increment} BETWEEN 1 AND 1000 AND (${t.endNumber} IS NULL OR ${t.endNumber} >= ${t.startNumber})`),
  ],
);

export const numberSeriesUser = pgTable(
  "NumberSeriesUser",
  {
    id: serial().primaryKey(),
    seriesId: integer().notNull().references(() => numberSeries.id, { onDelete: "cascade" }),
    userId: integer().notNull().references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("NumberSeriesUser_seriesId_userId_key").on(t.seriesId, t.userId)],
);

export const numberSeriesBranch = pgTable(
  "NumberSeriesBranch",
  {
    id: serial().primaryKey(),
    seriesId: integer().notNull().references(() => numberSeries.id, { onDelete: "cascade" }),
    branchId: integer().notNull().references(() => branch.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("NumberSeriesBranch_seriesId_branchId_key").on(t.seriesId, t.branchId)],
);

export const numberCounter = pgTable(
  "NumberCounter",
  {
    id: serial().primaryKey(),
    seriesId: integer().notNull().references(() => numberSeries.id, { onDelete: "cascade" }),
    branchId: integer().notNull().default(0),
    fiscalYear: varchar({ length: 15 }).notNull().default(""),
    lastNumber: integer().notNull(),
  },
  (t) => [uniqueIndex("NumberCounter_seriesId_branchId_fiscalYear_key").on(t.seriesId, t.branchId, t.fiscalYear)],
);
