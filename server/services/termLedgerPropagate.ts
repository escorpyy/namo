import { sql } from "drizzle-orm";
import { HttpError } from "../routes/_util";
import * as S from "../db/schema";
import type { Tx } from "./purchase/common";

// A billing term's General Ledger was changed in the master. Every bill / invoice that used the old ledger for this term follows: its voucher lines
// move to the new ledger (and so do the reversal vouchers of those bills, so a reversed bill still nets to zero). The audit trail keeps the old
// and the new lines. Called per batch of documents (`only`) by the background job; each batch is one transaction.
//   Purchase: ADDITIVE sits on Dr of the term ledger, DEDUCTIVE on Cr.  Sales: the other way round.  A reversal bill has the opposite side.
export type TermKind = "PURCHASE" | "SALES";

const sideOf = (kind: TermKind, nature: string, reversal: boolean): "DR" | "CR" => {
  const dr = kind === "PURCHASE" ? nature === "ADDITIVE" : nature !== "ADDITIVE";
  return dr !== reversal ? "DR" : "CR";
};

// Moves `amount` on one side of a posted voucher from one ledger to another: takes it off the old ledger's line (the line goes when nothing is left) and
// puts it on the same side of the new ledger (added to a plain line of that ledger if the voucher has one). False when the voucher has no such amount.
export async function moveOnVoucher(tx: Tx, jv: number, side: "DR" | "CR", amount: string, oldLedger: number, newLedger: number): Promise<boolean> {
  const col = side === "DR" ? "debit" : "credit";
  const [line] = (await tx.execute(sql`
    select id, ${sql.identifier(col)} as amt from "JournalVoucherLine"
     where "journalVoucherId" = ${jv} and "generalLedgerId" = ${oldLedger} and ${sql.identifier(col)} >= ${amount}
     order by ${sql.identifier(col)} desc limit 1`)) as unknown as { id: number; amt: string }[];
  if (!line) return false;
  if (Number(line.amt) === Number(amount)) await tx.execute(sql`delete from "JournalVoucherLine" where id = ${line.id}`);
  else await tx.execute(sql`update "JournalVoucherLine" set ${sql.identifier(col)} = ${sql.identifier(col)} - ${amount} where id = ${line.id}`);
  const [same] = (await tx.execute(sql`
    select id from "JournalVoucherLine"
     where "journalVoucherId" = ${jv} and "generalLedgerId" = ${newLedger} and "subLedgerId" is null and "agentId" is null and ${sql.identifier(col)} > 0
     order by id limit 1`)) as unknown as { id: number }[];
  if (same) await tx.execute(sql`update "JournalVoucherLine" set ${sql.identifier(col)} = ${sql.identifier(col)} + ${amount} where id = ${same.id}`);
  else {
    const [{ n }] = (await tx.execute(sql`select coalesce(max("lineNumber"), 0) + 1 as n from "JournalVoucherLine" where "journalVoucherId" = ${jv}`)) as unknown as { n: number }[];
    const [src] = (await tx.execute(sql`select narration, "agentId" from "JournalVoucherLine" where id = ${line.id}`)) as unknown as { narration: string | null }[];
    await tx.insert(S.journalVoucherLine).values({
      journalVoucherId: jv, lineNumber: n, generalLedgerId: newLedger, subLedgerId: null,
      debit: side === "DR" ? amount : "0", credit: side === "CR" ? amount : "0", narration: src?.narration ?? null,
    });
  }
  return true;
}

export async function propagateTermLedger(tx: Tx, companyId: number, kind: TermKind, termId: number, oldLedger: number, newLedger: number, only?: number[]) {
  const bill = kind === "PURCHASE" ? "PurchaseBill" : "SalesInvoice";
  const termTbl = kind === "PURCHASE" ? "PurchaseDocumentTerm" : "SalesDocumentTerm";
  const type = kind === "PURCHASE" ? "PURCHASE_BILL" : "SALES_INVOICE";
  const rows = (await tx.execute(sql`
    select t.id as "termRowId", t.nature, t."finalAmount" as amount, b.id as "billId", b."invoiceNumber" as "number", b."isPosted", (b."reversalOfId" is not null or ${kind === "PURCHASE" ? sql`b."returnOfBillId" is not null` : sql`false`}) as reversal, b."journalVoucherId" as jv
      from ${sql.identifier(termTbl)} t
      join ${sql.identifier(bill)} b on b.id = t."documentId" and t."documentType" = ${type}
     where b."companyId" = ${companyId} and t."termId" = ${termId} and t."generalLedgerId" = ${oldLedger}
       ${only ? sql`and b.id in (${sql.join(only.map((i) => sql`${i}`), sql`, `)})` : sql``}
     order by b.id, t.id
     for update of t`)) as unknown as { termRowId: number; nature: string; amount: string; billId: number; number: string; isPosted: boolean; reversal: boolean; jv: number | null }[];

  let skipped = 0;
  for (const r of rows) {
    if (r.isPosted && r.jv && Number(r.amount) > 0) {
      const side = sideOf(kind, r.nature, r.reversal);
      if (!(await moveOnVoucher(tx, r.jv, side, r.amount, oldLedger, newLedger))) {
        // The voucher does not carry this amount on the old ledger (it was posted some other way): nothing to move. The document still takes the new
        // ledger for the term and the job reports it as skipped, so the person can look at it.
        skipped++;
      }
    }
    // the ledger the document remembers for this term follows too (drafts included: they post to the master's ledger anyway)
    await tx.execute(sql`update ${sql.identifier(termTbl)} set "generalLedgerId" = ${newLedger} where id = ${r.termRowId}`);
  }
  return { documents: new Set(rows.map((r) => r.billId)).size, terms: rows.length, skipped };
}

// Cost / import assessments carry their own copy of a purchase term (PurchaseImportAssessmentTerm): the charge posts Dr its own ledger (ADDITIVE) or
// Cr (DEDUCTIVE) against the "against" ledger; the reversal voucher of a reversed assessment is the mirror image. Both follow a ledger change.
export async function propagateAssessmentTerm(tx: Tx, companyId: number, termId: number, oldLedger: number, newLedger: number, only?: number[]) {
  const rows = (await tx.execute(sql`
    select d.id as "termRowId", d.nature, d."finalAmount" as amount, d."againstLedgerId" as against, a.id as "assessmentId", a."assessmentNumber" as "number", a."isPosted", a."journalVoucherId" as jv, a."reversalVoucherId" as rjv
      from "PurchaseImportAssessmentTerm" d join "PurchaseImportAssessment" a on a.id = d."assessmentId"
     where a."companyId" = ${companyId} and d."termId" = ${termId} and d."generalLedgerId" = ${oldLedger}
       ${only ? sql`and a.id in (${sql.join(only.map((i) => sql`${i}`), sql`, `)})` : sql``}
     order by a.id, d.id
     for update of d`)) as unknown as { termRowId: number; nature: string; amount: string; against: number | null; assessmentId: number; number: string; isPosted: boolean; jv: number | null; rjv: number | null }[];
  let skipped = 0;
  await tx.execute(sql`select set_config('namo.ledger_reassign', 'on', true)`); // the one change an applied assessment's rows allow (migration 0039)
  for (const r of rows) {
    if (r.against === newLedger) throw new HttpError(409, `Cost assessment ${r.number} uses the new ledger as the against ledger of this charge, so the charge cannot be moved there. Change the against ledger on that assessment first.`);
    if (r.isPosted && r.jv && Number(r.amount) > 0) {
      const side = r.nature === "ADDITIVE" ? "DR" : "CR";
      let ok = await moveOnVoucher(tx, r.jv, side, r.amount, oldLedger, newLedger);
      if (ok && r.rjv) ok = await moveOnVoucher(tx, r.rjv, side === "DR" ? "CR" : "DR", r.amount, oldLedger, newLedger);
      if (!ok) skipped++;
    }
    await tx.execute(sql`update "PurchaseImportAssessmentTerm" set "generalLedgerId" = ${newLedger} where id = ${r.termRowId}`);
  }
  return { documents: new Set(rows.map((r) => r.assessmentId)).size, terms: rows.length, skipped };
}
