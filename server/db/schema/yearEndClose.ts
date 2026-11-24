import { check, index, integer, pgTable, serial, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { money } from "./_helpers";
import { branch, company, fiscalYear, user } from "./core";
import { generalLedger } from "./accounting";
import { journalVoucher } from "./vouchers";

export const fiscalYearClose = pgTable(
  "FiscalYearClose",
  {
    id: serial().primaryKey(),
    companyId: integer().notNull().references(() => company.id, { onDelete: "restrict" }),
    fiscalYearId: integer().notNull().references(() => fiscalYear.id, { onDelete: "restrict" }),
    profitAndLossGLId: integer().notNull().references(() => generalLedger.id, { onDelete: "restrict" }),
    netResult: money().notNull(),
    status: varchar({ length: 16 }).notNull().default("CLOSED"),
    closedAt: timestamp({ precision: 3 }).notNull().defaultNow(),
    closedBy: integer().references(() => user.id, { onDelete: "set null" }),
    reopenedAt: timestamp({ precision: 3 }),
    reopenedBy: integer().references(() => user.id, { onDelete: "set null" }),
    reopenReason: varchar({ length: 500 }),
    createdAt: timestamp({ precision: 3 }).notNull().defaultNow(),
  },
  (t) => [
    index("FiscalYearClose_companyId_idx").on(t.companyId),
    index("FiscalYearClose_fiscalYearId_idx").on(t.fiscalYearId),
    index("FiscalYearClose_profitAndLossGLId_idx").on(t.profitAndLossGLId),
    uniqueIndex("FiscalYearClose_one_active_per_year_key").on(t.fiscalYearId).where(sql`${t.status} in ('CLOSED','REOPENING')`),
    check("FiscalYearClose_status_check", sql`${t.status} in ('CLOSED','REOPENING','REOPENED')`),
    check("FiscalYearClose_reopen_fields_check", sql`(${t.status} = 'REOPENED') = (${t.reopenedAt} is not null and ${t.reopenReason} is not null)`),
  ],
);

export const fiscalYearCloseVoucher = pgTable(
  "FiscalYearCloseVoucher",
  {
    id: serial().primaryKey(),
    fiscalYearCloseId: integer().notNull().references(() => fiscalYearClose.id, { onDelete: "restrict" }),
    branchId: integer().notNull().references(() => branch.id, { onDelete: "restrict" }),
    journalVoucherId: integer().notNull().unique().references(() => journalVoucher.id, { onDelete: "restrict" }),
    netResult: money().notNull(),
  },
  (t) => [
    uniqueIndex("FiscalYearCloseVoucher_close_branch_key").on(t.fiscalYearCloseId, t.branchId),
    index("FiscalYearCloseVoucher_branchId_idx").on(t.branchId),
  ],
);
