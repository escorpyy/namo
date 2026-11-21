import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, serial, varchar } from "drizzle-orm/pg-core";
import { createdAt, money } from "./_helpers";
import { generalLedger } from "./accounting";
import { company } from "./core";
import { journalVoucher } from "./vouchers";

// ============================================================
// TERM LEDGER CORRECTION
//
// A posted bill / invoice is never rewritten. When a billing term was posted to the WRONG ledger (Trade Discount to Purchase), the fix is ONE
// correcting journal voucher that moves the amounts from the old ledger to the right one. This table is the link between that voucher and
// each document term it corrected:
//   - the "effective ledger" of a posted document term = its latest correction's toLedgerId, else the ledger it was posted to;
//   - a document is not corrected twice from the same ledger;
//   - reversing the document also reverses what was corrected, so the old ledger is not left with a residue.
// `side` is the side the amount sat on in the ORIGINAL posting (Dr or Cr of fromLedgerId). Rows are never edited.
// ============================================================
export const termLedgerCorrection = pgTable(
  "TermLedgerCorrection",
  {
    id: serial().primaryKey(),
    companyId: integer().notNull().references(() => company.id, { onDelete: "restrict" }),
    journalVoucherId: integer().notNull().references(() => journalVoucher.id, { onDelete: "restrict" }),
    documentType: varchar({ length: 20 }).notNull(), // PURCHASE_BILL | SALES_INVOICE
    documentId: integer().notNull(),
    documentTermId: integer().notNull(), // PurchaseDocumentTerm.id / SalesDocumentTerm.id, by documentType
    fromLedgerId: integer().notNull().references(() => generalLedger.id, { onDelete: "restrict" }),
    toLedgerId: integer().notNull().references(() => generalLedger.id, { onDelete: "restrict" }),
    side: varchar({ length: 2 }).notNull(),
    amount: money().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("TermLedgerCorrection_companyId_idx").on(t.companyId),
    index("TermLedgerCorrection_journalVoucherId_idx").on(t.journalVoucherId),
    index("TermLedgerCorrection_document_idx").on(t.documentType, t.documentId),
    index("TermLedgerCorrection_term_idx").on(t.documentType, t.documentTermId),
    check("TermLedgerCorrection_type_check", sql`${t.documentType} IN ('PURCHASE_BILL', 'SALES_INVOICE')`),
    check("TermLedgerCorrection_side_check", sql`${t.side} IN ('DR', 'CR')`),
    check("TermLedgerCorrection_amount_check", sql`${t.amount} > 0`),
    check("TermLedgerCorrection_ledgers_check", sql`${t.fromLedgerId} <> ${t.toLedgerId}`),
  ],
);
