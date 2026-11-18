import { sql } from "drizzle-orm";
import { check, date, index, integer, pgTable, serial } from "drizzle-orm/pg-core";
import { createdAt, money } from "./_helpers";
import { generalLedger } from "./accounting";
import { company } from "./core";
import { purchaseBill } from "./purchaseBill";
import { salesInvoice } from "./salesInvoice";
import { cashBankVoucher } from "./vouchers";

// ============================================================
// ADVANCE APPLICATION
//
// An advance is the part of a posted receipt (from a customer) or payment (to a vendor) that was not settled against any bill when it was made.
// Applying it to a LATER invoice / bill is recorded here. No money moves (the advance is already in the party's ledger); this only
// uses up the advance and reduces what is outstanding on the document.
//   advance available = voucher's amount on that account - its settlements - its applications
// Rows are never edited; removing one (undoing the application) needs a reason and is audited.
// ============================================================
export const advanceApplication = pgTable(
  "AdvanceApplication",
  {
    id: serial().primaryKey(),
    companyId: integer().notNull().references(() => company.id, { onDelete: "restrict" }),
    // the receipt / payment that holds the advance
    cashBankVoucherId: integer().notNull().references(() => cashBankVoucher.id, { onDelete: "restrict" }),
    generalLedgerId: integer().notNull().references(() => generalLedger.id, { onDelete: "restrict" }),
    // exactly one of the two documents it is applied to
    salesInvoiceId: integer().references(() => salesInvoice.id, { onDelete: "restrict" }),
    purchaseBillId: integer().references(() => purchaseBill.id, { onDelete: "restrict" }),
    amount: money().notNull(),
    appliedDate: date({ mode: "string" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("AdvanceApplication_companyId_idx").on(t.companyId),
    index("AdvanceApplication_cashBankVoucherId_idx").on(t.cashBankVoucherId),
    index("AdvanceApplication_salesInvoiceId_idx").on(t.salesInvoiceId),
    index("AdvanceApplication_purchaseBillId_idx").on(t.purchaseBillId),
    check("AdvanceApplication_one_document_check", sql`(${t.salesInvoiceId} IS NOT NULL)::int + (${t.purchaseBillId} IS NOT NULL)::int = 1`),
    check("AdvanceApplication_amount_check", sql`${t.amount} > 0`),
  ],
);
