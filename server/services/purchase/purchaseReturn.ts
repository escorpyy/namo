import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { withInitialPostedChildInsert } from "../../db/audit";
import * as S from "../../db/schema";
import { HttpError } from "../../routes/_util";
import { guardPeriod } from "../periodLock";
import { assertGlEntryAllowed } from "../glEntryControl";
import { assertStockCovers, recordMovements } from "../stockLedger";
import { type Actor, type Opts, type Tx, inActorTx, parseDate, resolveFiscalYear, today } from "./common";
import { type JvRow, type LockOpts, writeVoucher } from "./purchaseBill";
import { ZERO, fmt, mul, roundTo, toMicro, type Micro } from "./money";

// PURCHASE RETURN (debit note): goods sent back to the vendor from one posted bill, in whole or in part.
//
//   Dr  the vendor ledger                                         the return total
//   Cr  each returned line's purchase-return ledger (the product's own; else its purchase ledger)   basic amount
//   Cr / Dr  each of the bill's terms, in the same share as the goods returned (VAT back = Cr, a discount given back = Dr)
//
// It is a bill of its own (PurchaseBill.returnOfBillId) that posts the moment it is made, takes the goods out of stock, and leaves the original bill
// live for what was not returned. A wrong return is undone with the ordinary reverse of that return bill.
export type PurchaseReturnInput = {
  companyId: number;
  billId: number;
  returnDate?: string | Date;
  reason?: string;
  debitNoteNo?: string | null; // the vendor's credit note number, if they sent one
  lines: { billLineId: number; qty: string | number }[];
};

const liveReturn = sql`b."returnOfBillId" is not null and b."isPosted" and not exists (select 1 from "PurchaseBill" r where r."reversalOfId" = b.id and r."isPosted")`;

/** Quantity already sent back per original line (returns that still stand). */
export async function returnedQtyByLine(tx: Tx, lineIds: number[]): Promise<Map<number, Micro>> {
  const out = new Map<number, Micro>();
  if (!lineIds.length) return out;
  const rows = (await tx.execute(sql`
    select l."returnOfLineId" as id, sum(l.qty)::text as qty
      from "PurchaseBillLine" l join "PurchaseBill" b on b.id = l."purchaseBillId"
     where l."returnOfLineId" in (${sql.join(lineIds.map((i) => sql`${i}`), sql`, `)}) and ${liveReturn}
     group by 1`)) as any[];
  for (const r of rows) out.set(Number(r.id), toMicro(r.qty));
  return out;
}

/** Purchase returns of a bill that still stand (reversed ones are not listed). */
export async function standingReturnsOf(tx: Tx, billId: number) {
  return (await tx.execute(sql`
    select b.id, b."invoiceNumber", b."invoiceDate", b."totalAmount"::text as "totalAmount"
      from "PurchaseBill" b where b."returnOfBillId" = ${billId} and ${liveReturn} order by b.id`)) as any[];
}

async function returnLedgerOf(tx: Tx, productId: number, p: { code: string; type: string }): Promise<number> {
  let gl: number | null | undefined;
  if (p.type === "STOCK") {
    const [sd] = await tx.select({ ret: S.stockDetail.purchaseReturnGLId, buy: S.stockDetail.purchaseGLId }).from(S.stockDetail).where(eq(S.stockDetail.productId, productId));
    gl = sd?.ret ?? sd?.buy;
  } else if (p.type === "NON_STOCK") gl = (await tx.select({ g: S.nonStockDetail.purchaseGLId }).from(S.nonStockDetail).where(eq(S.nonStockDetail.productId, productId)))[0]?.g;
  if (!gl) throw new HttpError(409, `Product ${p.code} has no purchase return ledger or purchase ledger set up, so it cannot be returned.`);
  return gl;
}

// amount x part / whole, to the paisa; the whole share (part = whole) is exactly the amount
const share = (amount: Micro, part: Micro, whole: Micro): Micro => (whole === ZERO ? ZERO : part === whole ? amount : roundTo((amount * part) / whole, 2));

export function createPurchaseReturn(input: PurchaseReturnInput, actor: Actor, opts: Opts & LockOpts = {}) {
  return inActorTx({ ...actor, reason: input.reason }, opts.tx, async (tx) => {
    const B = S.purchaseBill;
    const [orig] = await tx.select().from(B).where(and(eq(B.id, input.billId), eq(B.companyId, input.companyId))).for("update");
    if (!orig) throw new HttpError(404, "Purchase bill not found.");
    if (!orig.isPosted) throw new HttpError(409, "Only a posted bill can have goods returned. Edit the draft instead.");
    if (orig.reversalOfId || orig.returnOfBillId || orig.mainBillId || orig.importCostForBillId) throw new HttpError(409, "Goods can only be returned from a main purchase bill.");
    if (!orig.purchaseType.startsWith("GOODS_PURCHASE_")) throw new HttpError(409, "Only a goods bill can have goods returned.");
    if (orig.invoiceType === "IMPORT") throw new HttpError(409, "A return against an import bill is not supported yet: its landed cost includes customs charges. Reverse the bill, or record the return with a journal voucher.");
    const [reversed] = await tx.select({ id: B.id }).from(B).where(and(eq(B.reversalOfId, orig.id), eq(B.isPosted, true)));
    if (reversed) throw new HttpError(409, "This bill has been reversed.");
    if (!input.lines?.length) throw new HttpError(400, "Choose at least one line to return.", "lines");

    const date = input.returnDate ? parseDate(input.returnDate, "returnDate") : today();
    if (date.getTime() < orig.invoiceDate.getTime()) throw new HttpError(400, "A return cannot be dated before the bill it returns goods from.", "returnDate");
    await guardPeriod(tx, orig.companyId, [date], opts.lockOverride, "returnDate");
    const fy = await resolveFiscalYear(tx, orig.companyId, date, null);

    const olines = await tx.select().from(S.purchaseBillLine).where(eq(S.purchaseBillLine.purchaseBillId, orig.id)).orderBy(asc(S.purchaseBillLine.lineNumber));
    const byId = new Map(olines.map((l) => [l.id, l]));
    const already = await returnedQtyByLine(tx, olines.map((l) => l.id));
    const seen = new Set<number>();
    const picks = input.lines.map((r, i) => {
      const line = byId.get(Number(r.billLineId));
      if (!line) throw new HttpError(400, `Row ${i + 1}: that line is not on this bill.`, "lines");
      if (seen.has(line.id)) throw new HttpError(400, `Line ${line.lineNumber} is listed twice.`, "lines");
      seen.add(line.id);
      const qty = toMicro(r.qty);
      if (qty <= ZERO) throw new HttpError(400, `Line ${line.lineNumber}: the quantity to return must be more than zero.`, "lines");
      const left = toMicro(line.qty) - (already.get(line.id) ?? ZERO);
      if (qty > left) throw new HttpError(409, `Line ${line.lineNumber}: returning ${fmt(qty)} is more than what is left to return (${fmt(left)} of ${fmt(toMicro(line.qty))}).`, "lines");
      return { line, qty, basic: share(toMicro(line.basicAmount), qty, toMicro(line.qty)) };
    }).sort((a, b) => a.line.lineNumber - b.line.lineNumber);

    // stock must be there to send back
    await assertStockCovers(tx, { companyId: orig.companyId, branchId: orig.branchId }, picks.map((p, i) => ({ lineNumber: p.line.lineNumber, productId: p.line.productId, qty: fmt(p.qty), locationId: p.line.locationId, batchNo: p.line.batchNo })));

    // terms in the share of the goods returned: header terms by the share of the bill's basic amount, a line's own terms by that line's share
    const basicBack = picks.reduce((a, p) => a + p.basic, ZERO), basicWhole = toMicro(orig.basicAmount);
    const pickByLine = new Map(picks.map((p) => [p.line.id, p]));
    const oterms = await tx.select().from(S.purchaseDocumentTerm).where(and(eq(S.purchaseDocumentTerm.documentType, "PURCHASE_BILL"), eq(S.purchaseDocumentTerm.documentId, orig.id))).orderBy(asc(S.purchaseDocumentTerm.sequence), asc(S.purchaseDocumentTerm.id));
    const scaled = oterms.map((t) => {
      const final = toMicro(t.finalAmount);
      if (t.documentLineId) {
        const p = pickByLine.get(t.documentLineId);
        const ol = byId.get(t.documentLineId)!;
        return { t, amount: p ? share(final, p.qty, toMicro(ol.qty)) : ZERO, base: p ? share(toMicro(t.baseAmount), p.qty, toMicro(ol.qty)) : ZERO };
      }
      return { t, amount: share(final, basicBack, basicWhole), base: share(toMicro(t.baseAmount), basicBack, basicWhole) };
    }).filter((x) => x.amount !== ZERO);
    const termNet = scaled.reduce((a, x) => a + (x.t.nature === "ADDITIVE" ? x.amount : -x.amount), ZERO);
    const total = basicBack + termNet;
    if (total <= ZERO) throw new HttpError(409, "The return total must be more than zero.");

    // journal: the posting of the bill, mirrored
    const rows: JvRow[] = [];
    const narr = `Return of ${orig.invoiceNumber}`;
    for (const p of picks) {
      const [prod] = await tx.select({ code: S.product.code, type: S.product.type }).from(S.product).where(eq(S.product.id, p.line.productId));
      if (p.basic !== ZERO) rows.push({ generalLedgerId: await returnLedgerOf(tx, p.line.productId, prod), debit: ZERO, credit: p.basic, narration: narr });
    }
    for (const { t, amount } of scaled) {
      const [m] = await tx.select({ gl: S.purchaseTerm.generalLedgerId, name: S.purchaseTerm.name, code: S.purchaseTerm.code }).from(S.purchaseTerm).where(eq(S.purchaseTerm.id, t.termId));
      const gl = m?.gl ?? t.generalLedgerId;
      if (!gl) throw new HttpError(409, `Term ${m?.code ?? t.termId} has no ledger, so the return cannot be posted.`);
      rows.push(t.nature === "ADDITIVE" ? { generalLedgerId: gl, debit: ZERO, credit: amount, narration: `${m?.name ?? "Term"} ${narr}` } : { generalLedgerId: gl, debit: amount, credit: ZERO, narration: `${m?.name ?? "Term"} ${narr}` });
    }
    rows.push({ generalLedgerId: orig.vendorGLId, debit: total, credit: ZERO, narration: `${narr}${input.debitNoteNo ? ` / debit note ${input.debitNoteNo}` : ""}`, agentId: orig.agentId });
    // merge same ledger on the same side
    const merged = new Map<string, JvRow>();
    for (const r of rows) { const k = `${r.generalLedgerId}:${r.debit > ZERO ? "D" : "C"}`; const e = merged.get(k); if (e) { e.debit += r.debit; e.credit += r.credit; } else merged.set(k, { ...r }); }
    const jv = [...merged.values()].filter((r) => r.debit !== ZERO || r.credit !== ZERO);
    await assertGlEntryAllowed(tx, orig.companyId, jv.map((r) => r.generalLedgerId), "PURCHASE_RETURN");
    const dr = jv.reduce((a, r) => a + r.debit, ZERO), cr = jv.reduce((a, r) => a + r.credit, ZERO);
    if (dr !== cr) throw new HttpError(500, `Journal does not balance (Dr ${fmt(dr, 2)} / Cr ${fmt(cr, 2)}). Nothing was posted.`);

    let number = `DN-${orig.invoiceNumber}`.slice(0, 30), k = 1;
    while ((await tx.select({ id: B.id }).from(B).where(and(eq(B.branchId, orig.branchId), eq(B.fiscalYear, fy.code), eq(B.invoiceNumber, number)))).length) number = `DN${++k}-${orig.invoiceNumber}`.slice(0, 30);
    const vno = `PR-${fy.code}-${number}`;
    const voucherId = await writeVoucher(tx, { companyId: orig.companyId, branchId: orig.branchId, voucherNumber: vno.length <= 30 ? vno : `PR-${orig.id}-${k}`, voucherDate: date, fiscalYear: fy.code, remarks: `Purchase return of bill ${orig.invoiceNumber}${input.reason ? `: ${input.reason}` : ""}`.slice(0, 1024), reversalOfId: null }, jv, actor);

    const [rb] = await tx.insert(B).values({
      companyId: orig.companyId, branchId: orig.branchId, invoiceNumber: number, invoiceDate: date, fiscalYear: fy.code, invoiceType: orig.invoiceType, purchaseType: orig.purchaseType,
      vendorGLId: orig.vendorGLId, subLedgerId: orig.subLedgerId, agentId: orig.agentId, returnOfBillId: orig.id, journalVoucherId: voucherId,
      vendorInvoiceNo: input.debitNoteNo?.trim() || null, dueDays: 0, basicAmount: fmt(basicBack, 2), termAmount: fmt(termNet, 2), totalAmount: fmt(total, 2), tdsApplicable: orig.tdsApplicable,
      remarks: `Return of ${orig.invoiceNumber}${input.reason ? `: ${input.reason}` : ""}`.slice(0, 1024),
      isPosted: true, postedAt: new Date(), postedBy: actor.userId, createdBy: actor.userId,
    }).returning({ id: B.id });

    const newLine = new Map<number, number>(); // original line id -> return line id
    await withInitialPostedChildInsert(tx, "PurchaseBillLine", rb.id, async () => {
      let n = 1;
      for (const p of picks) {
        const l = p.line;
        const [nl] = await tx.insert(S.purchaseBillLine).values({
          purchaseBillId: rb.id, lineNumber: n++, productId: l.productId, qty: fmt(p.qty), unitId: l.unitId, rate: l.rate, basicAmount: fmt(p.basic, 2),
          locationId: l.locationId, batchNo: l.batchNo, manufactureDate: l.manufactureDate, expiryDate: l.expiryDate, returnOfLineId: l.id,
        }).returning({ id: S.purchaseBillLine.id });
        newLine.set(l.id, nl.id);
      }
    });
    await withInitialPostedChildInsert(tx, "PurchaseDocumentTerm", rb.id, async () => {
      for (const { t, amount, base } of scaled) {
        const { id: _i, createdAt: _c, updatedAt: _u, documentId: _d, documentLineId, ...rest } = t;
        await tx.insert(S.purchaseDocumentTerm).values({ ...rest, documentId: rb.id, documentLineId: documentLineId ? newLine.get(documentLineId) ?? null : null, baseAmount: fmt(base, 2), calculatedAmount: fmt(amount, 2), finalAmount: fmt(amount, 2), isOverridden: false });
      }
    });
    // the goods leave: one OUT movement per returned stock line
    await recordMovements(tx, { companyId: orig.companyId, branchId: orig.branchId, date, source: "PURCHASE_BILL", sourceId: rb.id, direction: "OUT" },
      picks.map((p) => ({ id: newLine.get(p.line.id)!, productId: p.line.productId, qty: fmt(p.qty), locationId: p.line.locationId, batchNo: p.line.batchNo, expiryDate: p.line.expiryDate })));

    return { returnBillId: rb.id, invoiceNumber: number, journalVoucherId: voucherId, voucherNumber: vno.length <= 30 ? vno : `PR-${orig.id}-${k}`, basicAmount: fmt(basicBack, 2), termAmount: fmt(termNet, 2), totalAmount: fmt(total, 2) };
  });
}
