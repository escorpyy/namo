import { and, asc, eq, sql } from "drizzle-orm";
import * as S from "../../db/schema";
import { HttpError } from "../../routes/_util";
import { type Actor, type Opts, type Tx, assertBranch, assertVendorLedger, inActorTx, inTx, nextNumber, optDate, parseDate, resolveFiscalYear } from "./common";
import { assertMandatoryTerms, recalcTerms, saveTerms, type TermInput } from "./docTerms";
import { resolveLines, type LineInput } from "./lines";
import { ZERO, fmt, toMicro } from "./money";
import { billedByOrderLine, pending, receivedByOrderLine } from "./quantities";

// PURCHASE ORDER: a commitment to buy. It posts nothing and moves no stock.
//   DRAFT ──approve──▶ APPROVED ──close──▶ CLOSED          (DRAFT / APPROVED ──cancel──▶ CANCELLED)
// Lines and terms are editable only while DRAFT.

export type PurchaseOrderInput = {
  id?: number; // present = edit this draft
  companyId: number;
  branchId: number;
  orderNumber?: string; // blank = next number for the branch and fiscal year
  orderDate: string | Date;
  fiscalYear?: string; // blank = the fiscal year that contains the order date
  vendorGLId: number;
  subLedgerId?: number | null;
  agentId?: number | null;
  vendorRefNo?: string | null;
  vendorRefDate?: string | Date | null;
  expectedDate?: string | Date | null;
  remarks?: string | null;
  lines: (LineInput & { expectedDate?: string | Date | null })[];
  terms?: TermInput[];
};

async function lockOrder(tx: Tx, id: number) {
  const [o] = await tx.select().from(S.purchaseOrder).where(eq(S.purchaseOrder.id, id)).for("update");
  if (!o) throw new HttpError(404, "Purchase order not found.");
  return o;
}

export function savePurchaseOrder(input: PurchaseOrderInput, actor: Actor, opts: Opts = {}) {
  return inActorTx(actor, opts.tx, async (tx) => {
    const orderDate = parseDate(input.orderDate, "orderDate");
    const expectedDate = optDate(input.expectedDate, "expectedDate");
    if (expectedDate && expectedDate < orderDate) throw new HttpError(400, "Expected date cannot be before the order date.", "expectedDate");
    if (!input.lines?.length) throw new HttpError(400, "An order needs at least one line.", "lines");

    let existing: Awaited<ReturnType<typeof lockOrder>> | null = null;
    if (input.id) {
      existing = await lockOrder(tx, input.id);
      if (existing.companyId !== input.companyId || existing.branchId !== input.branchId) throw new HttpError(400, "An order cannot be moved to another company or branch.");
      if (existing.status !== "DRAFT") throw new HttpError(409, `Order is ${existing.status}; only a DRAFT can be edited.`);
    }

    await assertBranch(tx, input.companyId, input.branchId);
    await assertVendorLedger(tx, input.companyId, input.vendorGLId, input.subLedgerId);
    const fy = await resolveFiscalYear(tx, input.companyId, orderDate, input.fiscalYear ?? null);
    const lines = await resolveLines(tx, input.companyId, input.lines);

    const orderNumber = input.orderNumber?.trim() || existing?.orderNumber || (await nextNumber(tx, "PurchaseOrder", "orderNumber", input.branchId, fy.code));
    const header = {
      companyId: input.companyId, branchId: input.branchId, orderNumber, orderDate, fiscalYear: fy.code, vendorGLId: input.vendorGLId,
      subLedgerId: input.subLedgerId ?? null, agentId: input.agentId ?? null, vendorRefNo: input.vendorRefNo ?? null,
      vendorRefDate: optDate(input.vendorRefDate, "vendorRefDate"), expectedDate, remarks: input.remarks ?? null, updatedAt: new Date(),
    };

    let id: number;
    if (existing) {
      id = existing.id;
      await tx.delete(S.purchaseDocumentTerm).where(and(eq(S.purchaseDocumentTerm.documentType, "PURCHASE_ORDER"), eq(S.purchaseDocumentTerm.documentId, id)));
      await tx.delete(S.purchaseOrderLine).where(eq(S.purchaseOrderLine.purchaseOrderId, id));
      await tx.update(S.purchaseOrder).set(header).where(eq(S.purchaseOrder.id, id));
    } else {
      [{ id }] = await tx.insert(S.purchaseOrder).values({ ...header, createdBy: actor.userId }).returning({ id: S.purchaseOrder.id });
    }

    const lineIdByNumber = new Map<number, number>();
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const [row] = await tx.insert(S.purchaseOrderLine).values({
        purchaseOrderId: id, lineNumber: l.lineNumber, productId: l.productId,
        altQty: l.altQty === null ? null : fmt(l.altQty), altUnitId: l.altUnitId, qty: fmt(l.qty), unitId: l.unitId,
        rate: fmt(l.rate), basicAmount: fmt(l.basicAmount, 2), expectedDate: optDate(input.lines[i].expectedDate, "line expectedDate"),
      }).returning({ id: S.purchaseOrderLine.id });
      lineIdByNumber.set(l.lineNumber, row.id);
    }

    await saveTerms(tx, { companyId: input.companyId, docType: "PURCHASE_ORDER", docId: id }, input.terms ?? [], lineIdByNumber);
    const t = await recalcTerms(tx, "PURCHASE_ORDER", id);
    await tx.update(S.purchaseOrder).set({ basicAmount: fmt(t.itemTotal, 2), termAmount: fmt(t.termNet, 2), totalAmount: fmt(t.total, 2) }).where(eq(S.purchaseOrder.id, id));
    return { id, orderNumber, fiscalYear: fy.code, basicAmount: fmt(t.itemTotal, 2), termAmount: fmt(t.termNet, 2), totalAmount: fmt(t.total, 2) };
  });
}

export function approvePurchaseOrder(id: number, actor: Actor, opts: Opts = {}) {
  return inActorTx(actor, opts.tx, async (tx) => {
    const o = await lockOrder(tx, id);
    if (o.status !== "DRAFT") throw new HttpError(409, `Order is ${o.status}; only a DRAFT can be approved.`);
    await resolveFiscalYear(tx, o.companyId, o.orderDate, o.fiscalYear);
    const [{ n }] = (await tx.execute(sql`select count(*)::int as n from "PurchaseOrderLine" where "purchaseOrderId" = ${id}`)) as any[];
    if (!n) throw new HttpError(409, "An order without lines cannot be approved.");
    await assertMandatoryTerms(tx, o.companyId, "PURCHASE_ORDER", id);
    const t = await recalcTerms(tx, "PURCHASE_ORDER", id); // price it once more so what is approved is what is stored
    if (t.total < ZERO) throw new HttpError(409, "The order total is negative.");
    await tx.update(S.purchaseOrder).set({ basicAmount: fmt(t.itemTotal, 2), termAmount: fmt(t.termNet, 2), totalAmount: fmt(t.total, 2), status: "APPROVED", approvedAt: new Date(), approvedBy: actor.userId, updatedAt: new Date() }).where(eq(S.purchaseOrder.id, id));
    return { id, status: "APPROVED" as const };
  });
}

// Short-close: nothing more will be received or billed against it (whatever is still pending is abandoned).
export function closePurchaseOrder(id: number, actor: Actor, opts: Opts = {}) {
  return inActorTx(actor, opts.tx, async (tx) => {
    const o = await lockOrder(tx, id);
    if (o.status !== "APPROVED") throw new HttpError(409, `Order is ${o.status}; only an APPROVED order can be closed.`);
    await tx.update(S.purchaseOrder).set({ status: "CLOSED", closedAt: new Date(), closedBy: actor.userId, updatedAt: new Date() }).where(eq(S.purchaseOrder.id, id));
    return { id, status: "CLOSED" as const };
  });
}

// Cancel is for an order nobody has acted on. Once a challan or bill refers to it, close it instead.
export function cancelPurchaseOrder(id: number, actor: Actor, opts: Opts = {}) {
  return inActorTx(actor, opts.tx, async (tx) => {
    const o = await lockOrder(tx, id);
    if (o.status !== "DRAFT" && o.status !== "APPROVED") throw new HttpError(409, `Order is ${o.status}; it cannot be cancelled.`);
    const [{ n }] = (await tx.execute(sql`
      select (select count(*) from "PurchaseChallan" where "purchaseOrderId" = ${id})
           + (select count(*) from "PurchaseBill" where "purchaseOrderId" = ${id})
           + (select count(*) from "PurchaseBillLine" bl join "PurchaseOrderLine" ol on ol.id = bl."purchaseOrderLineId" where ol."purchaseOrderId" = ${id}) as n`)) as any[];
    if (Number(n) > 0) throw new HttpError(409, "Challans or bills already refer to this order. Close it instead of cancelling.");
    await tx.update(S.purchaseOrder).set({ status: "CANCELLED", updatedAt: new Date() }).where(eq(S.purchaseOrder.id, id));
    return { id, status: "CANCELLED" as const };
  });
}

// Delete is for a draft only. Nothing can refer to a DRAFT (challans need an APPROVED order, bills a non-draft one), and the database
// removes its lines, terms and allocations with it. An approved order that was never used is cancelled, not deleted.
export function deletePurchaseOrder(id: number, actor: Actor, opts: Opts = {}) {
  return inActorTx(actor, opts.tx, async (tx) => {
    const o = await lockOrder(tx, id);
    if (o.status !== "DRAFT") throw new HttpError(409, `Order is ${o.status}; only a DRAFT can be deleted. Cancel or close it instead.`);
    await tx.delete(S.purchaseOrder).where(eq(S.purchaseOrder.id, id));
    return { id, deleted: true as const };
  });
}

// Ordered / received / billed / pending for each line of an order, worked out from the documents.
export function getPurchaseOrderProgress(id: number, opts: Opts = {}) {
  return inTx(opts.tx, async (tx) => {
    const o = await lockOrderRead(tx, id);
    const lines = await tx.select().from(S.purchaseOrderLine).where(eq(S.purchaseOrderLine.purchaseOrderId, id)).orderBy(asc(S.purchaseOrderLine.lineNumber));
    const ids = lines.map((l) => l.id);
    const [rec, bil] = await Promise.all([receivedByOrderLine(tx, ids), billedByOrderLine(tx, ids)]);
    return {
      orderId: id, status: o.status,
      lines: lines.map((l) => {
        const ordered = toMicro(l.qty), received = rec.get(l.id) ?? ZERO, billed = bil.get(l.id) ?? ZERO;
        return { lineId: l.id, lineNumber: l.lineNumber, productId: l.productId, ordered: fmt(ordered), received: fmt(received), billed: fmt(billed), pendingToReceive: fmt(pending(ordered, received)), pendingToBill: fmt(pending(ordered, billed)) };
      }),
    };
  });
}
async function lockOrderRead(tx: Tx, id: number) {
  const [o] = await tx.select().from(S.purchaseOrder).where(eq(S.purchaseOrder.id, id));
  if (!o) throw new HttpError(404, "Purchase order not found.");
  return o;
}
