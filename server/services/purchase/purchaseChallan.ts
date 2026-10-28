import { and, asc, eq, inArray } from "drizzle-orm";
import * as S from "../../db/schema";
import { HttpError } from "../../routes/_util";
import { type Actor, type Opts, type Tx, assertBranch, assertVendorLedger, inActorTx, inTx, nextNumber, optDate, parseDate, resolveFiscalYear } from "./common";
import { resolveLines, type LineInput } from "./lines";
import { ZERO, fmt, toMicro, type Micro } from "./money";
import { billedByChallanLine, pending, receivedByOrderLine, withTolerance } from "./quantities";

// PURCHASE CHALLAN (goods receipt). Posts nothing to the ledger; the accounting happens when a bill closes it.
//   draft ──confirm──▶ confirmed (goods are in; the challan is now immutable)
//
// NOTE: the schema has no stock-movement table yet. Confirming validates the receipt and locks it; a confirmed
// challan's lines ARE the receipt records a stock ledger will be built from. Nothing is written to stock here.

export type ChallanLineInput = LineInput & {
  purchaseOrderLineId?: number | null; // the order line this receipt fulfils
  locationId?: number | null;
  batchNo?: string | null;
  manufactureDate?: string | Date | null;
  expiryDate?: string | Date | null;
};

export type PurchaseChallanInput = {
  id?: number;
  companyId: number;
  branchId: number;
  challanNumber?: string;
  challanDate: string | Date;
  fiscalYear?: string;
  vendorGLId: number;
  subLedgerId?: number | null;
  agentId?: number | null;
  purchaseOrderId?: number | null; // blank = goods that arrived with no order
  vendorChallanNo?: string | null;
  vendorChallanDate?: string | Date | null;
  transporterName?: string | null;
  vehicleNo?: string | null;
  lrNo?: string | null;
  lrDate?: string | Date | null;
  remarks?: string | null;
  lines: ChallanLineInput[];
};

async function lockChallan(tx: Tx, id: number) {
  const [c] = await tx.select().from(S.purchaseChallan).where(eq(S.purchaseChallan.id, id)).for("update");
  if (!c) throw new HttpError(404, "Purchase challan not found.");
  return c;
}

export function savePurchaseChallan(input: PurchaseChallanInput, actor: Actor, opts: Opts = {}) {
  return inActorTx(actor, opts.tx, async (tx) => {
    const challanDate = parseDate(input.challanDate, "challanDate");
    if (!input.lines?.length) throw new HttpError(400, "A challan needs at least one line.", "lines");

    let existing: Awaited<ReturnType<typeof lockChallan>> | null = null;
    if (input.id) {
      existing = await lockChallan(tx, input.id);
      if (existing.companyId !== input.companyId || existing.branchId !== input.branchId) throw new HttpError(400, "A challan cannot be moved to another company or branch.");
      if (existing.isConfirmed) throw new HttpError(409, "A confirmed challan cannot be edited.");
    }

    await assertBranch(tx, input.companyId, input.branchId);
    await assertVendorLedger(tx, input.companyId, input.vendorGLId, input.subLedgerId);
    const fy = await resolveFiscalYear(tx, input.companyId, challanDate, input.fiscalYear ?? null);

    if (input.purchaseOrderId) {
      const [o] = await tx.select().from(S.purchaseOrder).where(and(eq(S.purchaseOrder.id, input.purchaseOrderId), eq(S.purchaseOrder.companyId, input.companyId)));
      if (!o) throw new HttpError(404, "Purchase order not found in this company.", "purchaseOrderId");
      if (o.status !== "APPROVED") throw new HttpError(409, `Order ${o.orderNumber} is ${o.status}; goods can only be received against an APPROVED order.`, "purchaseOrderId");
    } else if (input.lines.some((l) => l.purchaseOrderLineId)) {
      throw new HttpError(400, "Lines refer to order lines but the challan has no purchase order.", "purchaseOrderId");
    }

    // A line received against an order line takes that line's rate unless the user typed one.
    const orderLineIds = [...new Set(input.lines.map((l) => l.purchaseOrderLineId).filter((x): x is number => !!x))];
    const olRate = new Map<number, string>();
    if (orderLineIds.length) for (const r of await tx.select({ id: S.purchaseOrderLine.id, rate: S.purchaseOrderLine.rate }).from(S.purchaseOrderLine).where(inArray(S.purchaseOrderLine.id, orderLineIds))) olRate.set(r.id, r.rate);
    const rows = input.lines.map((l) => ({ ...l, rate: l.rate ?? (l.purchaseOrderLineId ? olRate.get(l.purchaseOrderLineId) : undefined) ?? 0 }));
    const lines = await resolveLines(tx, input.companyId, rows);

    const challanNumber = input.challanNumber?.trim() || existing?.challanNumber || (await nextNumber(tx, "PurchaseChallan", "challanNumber", input.branchId, fy.code));
    const header = {
      companyId: input.companyId, branchId: input.branchId, challanNumber, challanDate, fiscalYear: fy.code, vendorGLId: input.vendorGLId,
      subLedgerId: input.subLedgerId ?? null, agentId: input.agentId ?? null, purchaseOrderId: input.purchaseOrderId ?? null,
      vendorChallanNo: input.vendorChallanNo?.trim() || null, vendorChallanDate: optDate(input.vendorChallanDate, "vendorChallanDate"),
      transporterName: input.transporterName ?? null, vehicleNo: input.vehicleNo ?? null, lrNo: input.lrNo ?? null, lrDate: optDate(input.lrDate, "lrDate"),
      remarks: input.remarks ?? null, updatedAt: new Date(),
    };

    let id: number;
    if (existing) {
      id = existing.id;
      await tx.delete(S.purchaseChallanLine).where(eq(S.purchaseChallanLine.purchaseChallanId, id));
      await tx.update(S.purchaseChallan).set(header).where(eq(S.purchaseChallan.id, id));
    } else {
      [{ id }] = await tx.insert(S.purchaseChallan).values({ ...header, createdBy: actor.userId }).returning({ id: S.purchaseChallan.id });
    }

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i], src = input.lines[i];
      await tx.insert(S.purchaseChallanLine).values({
        purchaseChallanId: id, lineNumber: l.lineNumber, productId: l.productId, purchaseOrderLineId: src.purchaseOrderLineId ?? null,
        altQty: l.altQty === null ? null : fmt(l.altQty), altUnitId: l.altUnitId, qty: fmt(l.qty), unitId: l.unitId,
        rate: fmt(l.rate), basicAmount: fmt(l.basicAmount, 2), locationId: src.locationId ?? null, batchNo: src.batchNo?.trim() || null,
        manufactureDate: optDate(src.manufactureDate, "manufactureDate"), expiryDate: optDate(src.expiryDate, "expiryDate"),
      });
    }
    return { id, challanNumber, fiscalYear: fy.code };
  });
}

// Confirm = the goods are really here. Checked now (not while drafting) because only now do the quantities count:
//  - the date is still inside an OPEN fiscal year
//  - the order (if any) is still APPROVED
//  - received qty (this + every other confirmed challan) does not exceed the order line's qty (+ tolerance)
//  - batch / expiry are present when the product tracks them
export function confirmPurchaseChallan(id: number, actor: Actor, opts: Opts & { tolerancePercent?: number } = {}) {
  return inActorTx(actor, opts.tx, async (tx) => {
    const c = await lockChallan(tx, id);
    if (c.isConfirmed) throw new HttpError(409, "Challan is already confirmed.");
    await resolveFiscalYear(tx, c.companyId, c.challanDate, c.fiscalYear);

    const lines = await tx.select().from(S.purchaseChallanLine).where(eq(S.purchaseChallanLine.purchaseChallanId, id)).orderBy(asc(S.purchaseChallanLine.lineNumber));
    if (!lines.length) throw new HttpError(409, "A challan without lines cannot be confirmed.");

    if (c.purchaseOrderId) {
      // Lock the order row so two challans confirming at once take turns and cannot both squeeze under the limit.
      const [o] = await tx.select().from(S.purchaseOrder).where(eq(S.purchaseOrder.id, c.purchaseOrderId)).for("update");
      if (o.status !== "APPROVED") throw new HttpError(409, `Order ${o.orderNumber} is ${o.status}; goods can only be received against an APPROVED order.`);
      const olIds = [...new Set(lines.map((l) => l.purchaseOrderLineId).filter((x): x is number => !!x))];
      const ols = olIds.length ? await tx.select().from(S.purchaseOrderLine).where(inArray(S.purchaseOrderLine.id, olIds)) : [];
      const ordered = new Map(ols.map((l) => [l.id, l]));
      const received = await receivedByOrderLine(tx, olIds, id);
      const thisChallan = new Map<number, Micro>();
      for (const l of lines) if (l.purchaseOrderLineId) thisChallan.set(l.purchaseOrderLineId, (thisChallan.get(l.purchaseOrderLineId) ?? ZERO) + toMicro(l.qty));
      for (const [olId, q] of thisChallan) {
        const ol = ordered.get(olId)!;
        const limit = withTolerance(toMicro(ol.qty), opts.tolerancePercent);
        const already = received.get(olId) ?? ZERO;
        if (already + q > limit) {
          throw new HttpError(409, `Order line ${ol.lineNumber}: receiving ${fmt(q)} would exceed the ordered ${fmt(toMicro(ol.qty))} (already received ${fmt(already)}). Pending: ${fmt(pending(limit, already))}.`);
        }
      }
    }

    for (const l of lines) {
      const [sd] = await tx.select({ tracksBatch: S.stockDetail.tracksBatch, tracksExpiry: S.stockDetail.tracksExpiry }).from(S.stockDetail).where(eq(S.stockDetail.productId, l.productId));
      if (sd?.tracksBatch && !l.batchNo) throw new HttpError(409, `Line ${l.lineNumber}: this product is batch-tracked; enter the batch number.`);
      if (sd?.tracksExpiry && !l.expiryDate) throw new HttpError(409, `Line ${l.lineNumber}: this product expires; enter the expiry date.`);
    }

    await tx.update(S.purchaseChallan).set({ isConfirmed: true, confirmedAt: new Date(), confirmedBy: actor.userId, updatedAt: new Date() }).where(eq(S.purchaseChallan.id, id));
    return { id, isConfirmed: true as const };
  });
}

// Delete is for an unconfirmed challan only (a bill needs a confirmed one, so nothing can refer to it).
export function deletePurchaseChallan(id: number, actor: Actor, opts: Opts = {}) {
  return inActorTx(actor, opts.tx, async (tx) => {
    const c = await lockChallan(tx, id);
    if (c.isConfirmed) throw new HttpError(409, "A confirmed challan cannot be deleted; it is a record of goods received.");
    await tx.delete(S.purchaseChallan).where(eq(S.purchaseChallan.id, id));
    return { id, deleted: true as const };
  });
}

// Received / billed / pending-to-bill for each line of a challan.
export function getPurchaseChallanProgress(id: number, opts: Opts = {}) {
  return inTx(opts.tx, async (tx) => {
    const [c] = await tx.select().from(S.purchaseChallan).where(eq(S.purchaseChallan.id, id));
    if (!c) throw new HttpError(404, "Purchase challan not found.");
    const lines = await tx.select().from(S.purchaseChallanLine).where(eq(S.purchaseChallanLine.purchaseChallanId, id)).orderBy(asc(S.purchaseChallanLine.lineNumber));
    const billed = await billedByChallanLine(tx, lines.map((l) => l.id));
    return {
      challanId: id, isConfirmed: c.isConfirmed,
      lines: lines.map((l) => {
        const received = toMicro(l.qty), b = billed.get(l.id) ?? ZERO;
        return { lineId: l.id, lineNumber: l.lineNumber, productId: l.productId, received: fmt(received), billed: fmt(b), pendingToBill: fmt(pending(received, b)) };
      }),
    };
  });
}
