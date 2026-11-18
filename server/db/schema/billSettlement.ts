import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, serial, uniqueIndex } from "drizzle-orm/pg-core";
import { createdAt, money } from "./_helpers";
import { company } from "./core";
import { purchaseBill } from "./purchaseBill";
import { salesInvoice } from "./salesInvoice";
import { cashBankVoucher } from "./vouchers";

// ============================================================
// BILL SETTLEMENT (bill-wise adjustment)
//
// Says which invoices / bills a Cash/Bank voucher pays off: a receipt settles sales invoices, a payment settles purchase bills.
// It never moves money (the voucher's own lines do that); it only splits the voucher's amount over documents.
//   outstanding of a document = its total - the settlements of POSTED, not-reversed vouchers
// A draft voucher's settlements are rewritten freely with the draft; once posted they never change (reverse the voucher instead).
// ============================================================
export const billSettlement = pgTable(
  "BillSettlement",
  {
    id: serial().primaryKey(),
    companyId: integer()
      .notNull()
      .references(() => company.id, { onDelete: "restrict" }),
    cashBankVoucherId: integer()
      .notNull()
      .references(() => cashBankVoucher.id, { onDelete: "cascade" }),
    // exactly one of the two
    salesInvoiceId: integer().references(() => salesInvoice.id, { onDelete: "restrict" }),
    purchaseBillId: integer().references(() => purchaseBill.id, { onDelete: "restrict" }),
    amount: money().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("BillSettlement_voucher_invoice_key").on(t.cashBankVoucherId, t.salesInvoiceId).where(sql`${t.salesInvoiceId} IS NOT NULL`),
    uniqueIndex("BillSettlement_voucher_bill_key").on(t.cashBankVoucherId, t.purchaseBillId).where(sql`${t.purchaseBillId} IS NOT NULL`),
    index("BillSettlement_companyId_idx").on(t.companyId),
    index("BillSettlement_salesInvoiceId_idx").on(t.salesInvoiceId),
    index("BillSettlement_purchaseBillId_idx").on(t.purchaseBillId),
    check("BillSettlement_one_document_check", sql`(${t.salesInvoiceId} IS NOT NULL)::int + (${t.purchaseBillId} IS NOT NULL)::int = 1`),
    check("BillSettlement_amount_check", sql`${t.amount} > 0`),
  ],
);
