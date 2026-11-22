import { sql } from "drizzle-orm";
import * as S from "../db/schema";
import { HttpError } from "../routes/_util";
import type { Tx } from "./purchase/common";

// A billing term's General Ledger was changed in the master. Every bill / invoice that used the old ledger for this term follows: its voucher lines
// move to the new ledger (and so do the reversal vouchers of those bills, so a reversed bill still nets to zero). The audit trail keeps the old
// and the new lines. Runs inside the master's own transaction: either everything moves, or the master change itself fails.
//   Purchase: ADDITIVE sits on Dr of the term ledger, DEDUCTIVE on Cr.  Sales: the other way round.  A reversal bill has the opposite side.
export type TermKind = "PURCHASE" | "SALES";

const sideOf = (kind: TermKind, nature: string, reversal: boolean): "DR" | "CR" => {
  const dr = kind === "PURCHASE" ? nature === "ADDITIVE" : nature !== "ADDITIVE";
  return dr !== reversal ? "DR" : "CR";
};

export async function propagateTermLedger(tx: Tx, companyId: number, kind: TermKind, termId: number, oldLedger: number, newLedger: number) {
  const bill = kind === "PURCHASE" ? "PurchaseBill" : "SalesInvoice";
  const termTbl = kind === "PURCHASE" ? "PurchaseDocumentTerm" : "SalesDocumentTerm";
  const type = kind === "PURCHASE" ? "PURCHASE_BILL" : "SALES_INVOICE";
  const rows = (await tx.execute(sql`
    select t.id as "termRowId", t.nature, t."finalAmount" as amount, b.id as "billId", b."invoiceNumber" as "number", b."isPosted", b."reversalOfId" is not null as reversal, b."journalVoucherId" as jv
      from ${sql.identifier(termTbl)} t
      join ${sql.identifier(bill)} b on b.id = t."documentId" and t."documentType" = ${type}
     where b."companyId" = ${companyId} and t."termId" = ${termId} and t."generalLedgerId" = ${oldLedger}
     order by b.id, t.id
     for update of t`)) as unknown as { termRowId: number; nature: string; amount: string; billId: number; number: string; isPosted: boolean; reversal: boolean; jv: number | null }[];

  for (const r of rows) {
    if (r.isPosted && r.jv && Number(r.amount) > 0) {
      const side = sideOf(kind, r.nature, r.reversal);
      const col = side === "DR" ? "debit" : "credit";
      const [line] = (await tx.execute(sql`
        select id, ${sql.identifier(col)} as amt from "JournalVoucherLine"
         where "journalVoucherId" = ${r.jv} and "generalLedgerId" = ${oldLedger} and ${sql.identifier(col)} >= ${r.amount}
         order by ${sql.identifier(col)} desc limit 1`)) as unknown as { id: number; amt: string }[];
      if (!line) throw new HttpError(409, `${kind === "PURCHASE" ? "Bill" : "Invoice"} ${r.number} has no ${side === "DR" ? "debit" : "credit"} of ${r.amount} on the old ledger, so its voucher cannot be moved. The ledger was not changed.`);
      // take the amount off the old line (drop the line when nothing is left) ...
      if (Number(line.amt) === Number(r.amount)) await tx.execute(sql`delete from "JournalVoucherLine" where id = ${line.id}`);
      else await tx.execute(sql`update "JournalVoucherLine" set ${sql.identifier(col)} = ${sql.identifier(col)} - ${r.amount} where id = ${line.id}`);
      // ... and put it on the new ledger, on the same side (added to an existing plain line of that ledger if there is one)
      const [same] = (await tx.execute(sql`
        select id from "JournalVoucherLine"
         where "journalVoucherId" = ${r.jv} and "generalLedgerId" = ${newLedger} and "subLedgerId" is null and "agentId" is null and ${sql.identifier(col)} > 0
         order by id limit 1`)) as unknown as { id: number }[];
      if (same) await tx.execute(sql`update "JournalVoucherLine" set ${sql.identifier(col)} = ${sql.identifier(col)} + ${r.amount} where id = ${same.id}`);
      else {
        const [{ n }] = (await tx.execute(sql`select coalesce(max("lineNumber"), 0) + 1 as n from "JournalVoucherLine" where "journalVoucherId" = ${r.jv}`)) as unknown as { n: number }[];
        const [src] = (await tx.execute(sql`select narration from "JournalVoucherLine" where id = ${line.id}`)) as unknown as { narration: string | null }[];
        await tx.insert(S.journalVoucherLine).values({
          journalVoucherId: r.jv, lineNumber: n, generalLedgerId: newLedger, subLedgerId: null,
          debit: side === "DR" ? r.amount : "0", credit: side === "CR" ? r.amount : "0", narration: src?.narration ?? null,
        });
      }
    }
    // the ledger the document remembers for this term follows too (drafts included: they post to the master's ledger anyway)
    await tx.execute(sql`update ${sql.identifier(termTbl)} set "generalLedgerId" = ${newLedger} where id = ${r.termRowId}`);
  }
  return { documents: new Set(rows.map((r) => r.billId)).size, terms: rows.length };
}
