import {
  type AnyPgColumn,
  boolean,
  date,
  index,
  integer,
  pgTable,
  serial,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { createdAt, money, updatedAt } from "./_helpers";
import { documentTypeEnum, instrumentTypeEnum } from "./enums";
import { branch, company, user } from "./core";
import { generalLedger } from "./accounting";
import { agent } from "./parties";

// ============================================================
// JOURNAL VOUCHER (non-cash/bank entries)
// ============================================================

export const journalVoucher = pgTable(
  "JournalVoucher",
  {
    id: serial().primaryKey(),
    companyId: integer()
      .notNull()
      .references(() => company.id, { onDelete: "restrict" }),
    branchId: integer()
      .notNull()
      .references(() => branch.id, { onDelete: "restrict" }),

    documentType: documentTypeEnum().notNull().default("JOURNAL_VOUCHER"),
    // Unique per branch, not globally — two branches can both have "JV-1".
    voucherNumber: varchar({ length: 30 }).notNull(),
    voucherDate: date({ mode: "date" }).notNull(),
    fiscalYear: varchar({ length: 15 }).notNull(),
    remarks: varchar({ length: 1024 }),

    reversalOfId: integer().references((): AnyPgColumn => journalVoucher.id, {
      onDelete: "set null",
    }),

    isPosted: boolean().notNull().default(false),
    postedAt: timestamp({ precision: 3 }),
    postedBy: integer().references(() => user.id, { onDelete: "set null" }),

    createdBy: integer().references(() => user.id, { onDelete: "set null" }),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("JournalVoucher_branchId_voucherNumber_key").on(
      t.branchId,
      t.voucherNumber,
    ),
    index("JournalVoucher_companyId_idx").on(t.companyId),
    index("JournalVoucher_branchId_idx").on(t.branchId),
    index("JournalVoucher_documentType_idx").on(t.documentType),
    index("JournalVoucher_fiscalYear_idx").on(t.fiscalYear),
  ],
);

export const journalVoucherLine = pgTable(
  "JournalVoucherLine",
  {
    id: serial().primaryKey(),
    journalVoucherId: integer()
      .notNull()
      .references(() => journalVoucher.id, { onDelete: "cascade" }),

    lineNumber: integer().notNull(),
    generalLedgerId: integer()
      .notNull()
      .references(() => generalLedger.id, { onDelete: "restrict" }),

    debit: money().notNull().default("0"),
    credit: money().notNull().default("0"),
    narration: varchar({ length: 500 }),

    agentId: integer().references(() => agent.id, { onDelete: "set null" }),

    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("JournalVoucherLine_journalVoucherId_lineNumber_key").on(
      t.journalVoucherId,
      t.lineNumber,
    ),
    index("JournalVoucherLine_generalLedgerId_idx").on(t.generalLedgerId),
    index("JournalVoucherLine_agentId_idx").on(t.agentId),
  ],
);

// ============================================================
// CASH / BANK VOUCHER (cash and bank-touching entries)
// ============================================================

export const cashBankVoucher = pgTable(
  "CashBankVoucher",
  {
    id: serial().primaryKey(),
    companyId: integer()
      .notNull()
      .references(() => company.id, { onDelete: "restrict" }),
    branchId: integer()
      .notNull()
      .references(() => branch.id, { onDelete: "restrict" }),

    documentType: documentTypeEnum().notNull().default("CASH_BANK_VOUCHER"),
    // Unique per branch, not globally.
    voucherNumber: varchar({ length: 30 }).notNull(),
    voucherDate: date({ mode: "date" }).notNull(),
    fiscalYear: varchar({ length: 15 }).notNull(),
    remarks: varchar({ length: 1024 }),

    reversalOfId: integer().references((): AnyPgColumn => cashBankVoucher.id, {
      onDelete: "set null",
    }),

    isPosted: boolean().notNull().default(false),
    postedAt: timestamp({ precision: 3 }),
    postedBy: integer().references(() => user.id, { onDelete: "set null" }),

    createdBy: integer().references(() => user.id, { onDelete: "set null" }),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("CashBankVoucher_branchId_voucherNumber_key").on(
      t.branchId,
      t.voucherNumber,
    ),
    index("CashBankVoucher_companyId_idx").on(t.companyId),
    index("CashBankVoucher_branchId_idx").on(t.branchId),
    index("CashBankVoucher_documentType_idx").on(t.documentType),
    index("CashBankVoucher_fiscalYear_idx").on(t.fiscalYear),
  ],
);

export const cashBankVoucherLine = pgTable(
  "CashBankVoucherLine",
  {
    id: serial().primaryKey(),
    cashBankVoucherId: integer()
      .notNull()
      .references(() => cashBankVoucher.id, { onDelete: "cascade" }),

    lineNumber: integer().notNull(),
    generalLedgerId: integer()
      .notNull()
      .references(() => generalLedger.id, { onDelete: "restrict" }),

    debit: money().notNull().default("0"),
    credit: money().notNull().default("0"),
    narration: varchar({ length: 500 }),

    instrumentType: instrumentTypeEnum(),
    chequeNumber: varchar({ length: 30 }),
    chequeDate: date({ mode: "date" }),
    chequeBankName: varchar({ length: 50 }),
    chequeBankBranch: varchar({ length: 50 }),

    isCleared: boolean().notNull().default(false),
    clearedDate: date({ mode: "date" }),
    clearedBy: integer().references(() => user.id, { onDelete: "set null" }),

    agentId: integer().references(() => agent.id, { onDelete: "set null" }),

    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("CashBankVoucherLine_cashBankVoucherId_lineNumber_key").on(
      t.cashBankVoucherId,
      t.lineNumber,
    ),
    index("CashBankVoucherLine_generalLedgerId_idx").on(t.generalLedgerId),
    index("CashBankVoucherLine_agentId_idx").on(t.agentId),
    index("CashBankVoucherLine_chequeNumber_idx").on(t.chequeNumber),
  ],
);
