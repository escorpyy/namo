import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../../db";
import * as S from "../../db/schema";
import { HttpError } from "../../routes/_util";
import { type Tx } from "./common";
import { ZERO, fmt, toMicro } from "./money";
import { billedByChallanLine, billedByOrderLine, pending, receivedByOrderLine } from "./quantities";

// READ side of the purchase documents: lists for the screens, one whole document with everything its screen shows, and the
// pick-lists a document form needs. Nothing here writes, and nothing here repeats a business rule: quantities received / billed
// come from quantities.ts, totals are the ones the services stored.

const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
// A transaction that only reads and sees one snapshot, so a document and its lines cannot come from two different moments.
const snapshot = <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => db.transaction(fn, { isolationLevel: "repeatable read", accessMode: "read only" });
// Amounts are whole paisa (the services round them); the columns are numeric(18,6), so show them as 2 decimals. Quantities and rates keep 6.
const amt = (v: string | null | undefined) => fmt(toMicro(v), 2);
const like = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export const ORDER_STATUSES = ["DRAFT", "APPROVED", "CLOSED", "CANCELLED"] as const;
export const BILL_STATES = ["DRAFT", "POSTED", "REVERSED", "REVERSAL"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type BillState = (typeof BILL_STATES)[number];

export type DocListFilter = {
  companyId: number;
  branchId?: number;
  fiscalYear?: string;
  vendorGLId?: number;
  search?: string;
  status?: string; // order: DRAFT | APPROVED | CLOSED | CANCELLED; challan: DRAFT | CONFIRMED; bill: DRAFT | POSTED | REVERSED | REVERSAL
  limit?: number;
};
const capLimit = (n?: number) => Math.min(Math.max(Math.trunc(n ?? 300), 1), 1000);

// ---------------------------------------------------------------------------------------------------------------------------
// ORDERS
// ---------------------------------------------------------------------------------------------------------------------------
export async function listPurchaseOrders(f: DocListFilter) {
  const O = S.purchaseOrder, G = S.generalLedger;
  const where: (SQL | undefined)[] = [eq(O.companyId, f.companyId)];
  if (f.branchId) where.push(eq(O.branchId, f.branchId));
  if (f.fiscalYear) where.push(eq(O.fiscalYear, f.fiscalYear));
  if (f.vendorGLId) where.push(eq(O.vendorGLId, f.vendorGLId));
  if (f.status) {
    if (!(ORDER_STATUSES as readonly string[]).includes(f.status)) throw new HttpError(400, `Unknown order status ${f.status}.`, "status");
    where.push(eq(O.status, f.status as OrderStatus));
  }
  if (f.search?.trim()) {
    const s = like(f.search.trim());
    where.push(or(ilike(O.orderNumber, s), ilike(G.name, s), ilike(G.code, s), ilike(O.vendorRefNo, s)));
  }
  return snapshot(async (tx) => {
    const base = tx.select({ n: sql<number>`count(*)::int` }).from(O).innerJoin(G, eq(G.id, O.vendorGLId)).where(and(...where));
    const [{ n }] = await base;
    const rows = await tx
      .select({
        id: O.id, branchId: O.branchId, orderNumber: O.orderNumber, orderDate: O.orderDate, fiscalYear: O.fiscalYear, status: O.status,
        vendorGLId: O.vendorGLId, vendorCode: G.code, vendorName: G.name, vendorRefNo: O.vendorRefNo, expectedDate: O.expectedDate,
        basicAmount: O.basicAmount, termAmount: O.termAmount, totalAmount: O.totalAmount,
      })
      .from(O).innerJoin(G, eq(G.id, O.vendorGLId)).where(and(...where)).orderBy(desc(O.orderDate), desc(O.id)).limit(capLimit(f.limit));
    return { total: n, rows: rows.map((r) => ({ ...r, orderDate: iso(r.orderDate), expectedDate: iso(r.expectedDate), basicAmount: amt(r.basicAmount), termAmount: amt(r.termAmount), totalAmount: amt(r.totalAmount) })) };
  });
}

// One order with its lines (and how much of each was received / billed so far) and its billing terms.
export function getPurchaseOrder(id: number, companyId: number) {
  return snapshot(async (tx) => {
    const O = S.purchaseOrder;
    const [o] = await tx.select().from(O).where(and(eq(O.id, id), eq(O.companyId, companyId)));
    if (!o) throw new HttpError(404, "Purchase order not found.");
    const [names, lines] = await Promise.all([
      headerNames(tx, o.vendorGLId, o.subLedgerId, o.agentId, o.branchId),
      tx.select().from(S.purchaseOrderLine).where(eq(S.purchaseOrderLine.purchaseOrderId, id)).orderBy(asc(S.purchaseOrderLine.lineNumber)),
    ]);
    const ids = lines.map((l) => l.id);
    const [rec, bil, prod, units, terms] = await Promise.all([
      receivedByOrderLine(tx, ids), billedByOrderLine(tx, ids), productNames(tx, lines.map((l) => l.productId)),
      unitCodes(tx, lines.flatMap((l) => [l.unitId, l.altUnitId])), termRows(tx, "PURCHASE_ORDER", id, lines),
    ]);
    const [challans, bills] = await Promise.all([
      tx.select({ id: S.purchaseChallan.id, challanNumber: S.purchaseChallan.challanNumber, isConfirmed: S.purchaseChallan.isConfirmed }).from(S.purchaseChallan).where(eq(S.purchaseChallan.purchaseOrderId, id)).orderBy(asc(S.purchaseChallan.id)),
      tx.select({ id: S.purchaseBill.id, invoiceNumber: S.purchaseBill.invoiceNumber, isPosted: S.purchaseBill.isPosted }).from(S.purchaseBill).where(eq(S.purchaseBill.purchaseOrderId, id)).orderBy(asc(S.purchaseBill.id)),
    ]);
    return {
      id: o.id, companyId: o.companyId, branchId: o.branchId, ...names,
      orderNumber: o.orderNumber, orderDate: iso(o.orderDate), fiscalYear: o.fiscalYear, vendorGLId: o.vendorGLId, subLedgerId: o.subLedgerId, agentId: o.agentId,
      vendorRefNo: o.vendorRefNo, vendorRefDate: iso(o.vendorRefDate), expectedDate: iso(o.expectedDate), remarks: o.remarks,
      status: o.status, approvedAt: o.approvedAt, closedAt: o.closedAt,
      basicAmount: amt(o.basicAmount), termAmount: amt(o.termAmount), totalAmount: amt(o.totalAmount),
      lines: lines.map((l) => {
        const ordered = toMicro(l.qty), received = rec.get(l.id) ?? ZERO, billed = bil.get(l.id) ?? ZERO;
        return {
          id: l.id, lineNumber: l.lineNumber, productId: l.productId, ...prod.get(l.productId), particular: l.particular,
          altQty: l.altQty, altUnitId: l.altUnitId, altUnitCode: l.altUnitId ? units.get(l.altUnitId) ?? null : null,
          qty: l.qty, unitId: l.unitId, unitCode: units.get(l.unitId) ?? null, rate: l.rate, basicAmount: amt(l.basicAmount), expectedDate: iso(l.expectedDate),
          received: fmt(received), billed: fmt(billed), pendingToReceive: fmt(pending(ordered, received)), pendingToBill: fmt(pending(ordered, billed)),
        };
      }),
      terms,
      challans, bills,
    };
  });
}

// ---------------------------------------------------------------------------------------------------------------------------
// CHALLANS
// ---------------------------------------------------------------------------------------------------------------------------
export async function listPurchaseChallans(f: DocListFilter) {
  const C = S.purchaseChallan, G = S.generalLedger, O = S.purchaseOrder;
  const where: (SQL | undefined)[] = [eq(C.companyId, f.companyId)];
  if (f.branchId) where.push(eq(C.branchId, f.branchId));
  if (f.fiscalYear) where.push(eq(C.fiscalYear, f.fiscalYear));
  if (f.vendorGLId) where.push(eq(C.vendorGLId, f.vendorGLId));
  if (f.status) {
    if (f.status !== "DRAFT" && f.status !== "CONFIRMED") throw new HttpError(400, `Unknown challan status ${f.status}.`, "status");
    where.push(eq(C.isConfirmed, f.status === "CONFIRMED"));
  }
  if (f.search?.trim()) {
    const s = like(f.search.trim());
    where.push(or(ilike(C.challanNumber, s), ilike(G.name, s), ilike(G.code, s), ilike(C.vendorChallanNo, s), ilike(O.orderNumber, s)));
  }
  return snapshot(async (tx) => {
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(C).innerJoin(G, eq(G.id, C.vendorGLId)).leftJoin(O, eq(O.id, C.purchaseOrderId)).where(and(...where));
    const rows = await tx
      .select({
        id: C.id, branchId: C.branchId, challanNumber: C.challanNumber, challanDate: C.challanDate, fiscalYear: C.fiscalYear, isConfirmed: C.isConfirmed,
        vendorGLId: C.vendorGLId, vendorCode: G.code, vendorName: G.name, vendorChallanNo: C.vendorChallanNo, purchaseOrderId: C.purchaseOrderId, orderNumber: O.orderNumber,
        totalQty: sql<string>`(select coalesce(sum(l.qty), 0)::text from "PurchaseChallanLine" l where l."purchaseChallanId" = ${C.id})`,
        totalAmount: sql<string>`(select coalesce(sum(l."basicAmount"), 0)::text from "PurchaseChallanLine" l where l."purchaseChallanId" = ${C.id})`,
      })
      .from(C).innerJoin(G, eq(G.id, C.vendorGLId)).leftJoin(O, eq(O.id, C.purchaseOrderId)).where(and(...where)).orderBy(desc(C.challanDate), desc(C.id)).limit(capLimit(f.limit));
    return { total: n, rows: rows.map((r) => ({ ...r, challanDate: iso(r.challanDate), totalAmount: amt(r.totalAmount) })) };
  });
}

export function getPurchaseChallan(id: number, companyId: number) {
  return snapshot(async (tx) => {
    const C = S.purchaseChallan;
    const [c] = await tx.select().from(C).where(and(eq(C.id, id), eq(C.companyId, companyId)));
    if (!c) throw new HttpError(404, "Purchase challan not found.");
    const [names, lines, order] = await Promise.all([
      headerNames(tx, c.vendorGLId, c.subLedgerId, c.agentId, c.branchId),
      tx.select().from(S.purchaseChallanLine).where(eq(S.purchaseChallanLine.purchaseChallanId, id)).orderBy(asc(S.purchaseChallanLine.lineNumber)),
      c.purchaseOrderId ? tx.select({ orderNumber: S.purchaseOrder.orderNumber, status: S.purchaseOrder.status }).from(S.purchaseOrder).where(eq(S.purchaseOrder.id, c.purchaseOrderId)) : Promise.resolve([]),
    ]);
    const [billed, prod, units, locs, orderLines, bills] = await Promise.all([
      billedByChallanLine(tx, lines.map((l) => l.id)), productNames(tx, lines.map((l) => l.productId)), unitCodes(tx, lines.flatMap((l) => [l.unitId, l.altUnitId])),
      locationCodes(tx, lines.map((l) => l.locationId)),
      lines.some((l) => l.purchaseOrderLineId)
        ? tx.select({ id: S.purchaseOrderLine.id, lineNumber: S.purchaseOrderLine.lineNumber }).from(S.purchaseOrderLine).where(inArray(S.purchaseOrderLine.id, lines.map((l) => l.purchaseOrderLineId).filter((x): x is number => !!x)))
        : Promise.resolve([]),
      tx.select({ id: S.purchaseBill.id, invoiceNumber: S.purchaseBill.invoiceNumber, isPosted: S.purchaseBill.isPosted }).from(S.purchaseBill).where(eq(S.purchaseBill.purchaseChallanId, id)).orderBy(asc(S.purchaseBill.id)),
    ]);
    const olNo = new Map(orderLines.map((l) => [l.id, l.lineNumber]));
    return {
      id: c.id, companyId: c.companyId, branchId: c.branchId, ...names,
      challanNumber: c.challanNumber, challanDate: iso(c.challanDate), fiscalYear: c.fiscalYear, vendorGLId: c.vendorGLId, subLedgerId: c.subLedgerId, agentId: c.agentId,
      purchaseOrderId: c.purchaseOrderId, orderNumber: order[0]?.orderNumber ?? null, orderStatus: order[0]?.status ?? null,
      vendorChallanNo: c.vendorChallanNo, vendorChallanDate: iso(c.vendorChallanDate), transporterName: c.transporterName, vehicleNo: c.vehicleNo, lrNo: c.lrNo, lrDate: iso(c.lrDate),
      remarks: c.remarks, isConfirmed: c.isConfirmed, confirmedAt: c.confirmedAt,
      totalAmount: fmt(lines.reduce((a, l) => a + toMicro(l.basicAmount), ZERO), 2),
      lines: lines.map((l) => {
        const received = toMicro(l.qty), b = billed.get(l.id) ?? ZERO;
        return {
          id: l.id, lineNumber: l.lineNumber, productId: l.productId, ...prod.get(l.productId), particular: l.particular,
          purchaseOrderLineId: l.purchaseOrderLineId, orderLineNumber: l.purchaseOrderLineId ? olNo.get(l.purchaseOrderLineId) ?? null : null,
          altQty: l.altQty, altUnitId: l.altUnitId, altUnitCode: l.altUnitId ? units.get(l.altUnitId) ?? null : null,
          qty: l.qty, unitId: l.unitId, unitCode: units.get(l.unitId) ?? null, rate: l.rate, basicAmount: amt(l.basicAmount),
          locationId: l.locationId, locationCode: l.locationId ? locs.get(l.locationId) ?? null : null,
          batchNo: l.batchNo, manufactureDate: iso(l.manufactureDate), expiryDate: iso(l.expiryDate),
          billed: fmt(b), pendingToBill: fmt(pending(received, b)),
        };
      }),
      bills,
    };
  });
}

// ---------------------------------------------------------------------------------------------------------------------------
// BILLS
// ---------------------------------------------------------------------------------------------------------------------------
const billState = (isPosted: boolean, reversalOfId: number | null, reversed: boolean): BillState => (reversalOfId ? "REVERSAL" : !isPosted ? "DRAFT" : reversed ? "REVERSED" : "POSTED");
const reversedSql = (id: unknown) => sql<boolean>`exists (select 1 from "PurchaseBill" r where r."reversalOfId" = ${id} and r."isPosted")`;

export async function listPurchaseBills(f: DocListFilter) {
  const B = S.purchaseBill, G = S.generalLedger;
  const where: (SQL | undefined)[] = [eq(B.companyId, f.companyId)];
  if (f.branchId) where.push(eq(B.branchId, f.branchId));
  if (f.fiscalYear) where.push(eq(B.fiscalYear, f.fiscalYear));
  if (f.vendorGLId) where.push(eq(B.vendorGLId, f.vendorGLId));
  if (f.status) {
    if (!(BILL_STATES as readonly string[]).includes(f.status)) throw new HttpError(400, `Unknown bill status ${f.status}.`, "status");
    const isReversed = reversedSql(B.id);
    where.push(
      f.status === "REVERSAL" ? sql`${B.reversalOfId} is not null`
      : f.status === "DRAFT" ? sql`${B.reversalOfId} is null and not ${B.isPosted}`
      : f.status === "POSTED" ? sql`${B.reversalOfId} is null and ${B.isPosted} and not ${isReversed}`
      : sql`${B.reversalOfId} is null and ${B.isPosted} and ${isReversed}`,
    );
  }
  if (f.search?.trim()) {
    const s = like(f.search.trim());
    where.push(or(ilike(B.invoiceNumber, s), ilike(G.name, s), ilike(G.code, s), ilike(B.vendorInvoiceNo, s)));
  }
  return snapshot(async (tx) => {
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(B).innerJoin(G, eq(G.id, B.vendorGLId)).where(and(...where));
    const rows = await tx
      .select({
        id: B.id, branchId: B.branchId, invoiceNumber: B.invoiceNumber, invoiceDate: B.invoiceDate, fiscalYear: B.fiscalYear, invoiceType: B.invoiceType, purchaseType: B.purchaseType,
        vendorGLId: B.vendorGLId, vendorCode: G.code, vendorName: G.name, vendorInvoiceNo: B.vendorInvoiceNo, dueDate: B.dueDate,
        mainBillId: B.mainBillId, reversalOfId: B.reversalOfId, isPosted: B.isPosted, reversed: reversedSql(B.id),
        basicAmount: B.basicAmount, termAmount: B.termAmount, totalAmount: B.totalAmount,
      })
      .from(B).innerJoin(G, eq(G.id, B.vendorGLId)).where(and(...where)).orderBy(desc(B.invoiceDate), desc(B.id)).limit(capLimit(f.limit));
    return {
      total: n,
      rows: rows.map(({ reversed, ...r }) => ({ ...r, invoiceDate: iso(r.invoiceDate), dueDate: iso(r.dueDate), basicAmount: amt(r.basicAmount), termAmount: amt(r.termAmount), totalAmount: amt(r.totalAmount), isAdditional: r.mainBillId !== null, state: billState(r.isPosted, r.reversalOfId, reversed) })),
    };
  });
}

export function getPurchaseBill(id: number, companyId: number) {
  return snapshot(async (tx) => {
    const B = S.purchaseBill;
    const [b] = await tx.select().from(B).where(and(eq(B.id, id), eq(B.companyId, companyId)));
    if (!b) throw new HttpError(404, "Purchase bill not found.");
    const [names, lines, importRow, voucher, reversedBy, main, additional, challan, order] = await Promise.all([
      headerNames(tx, b.vendorGLId, b.subLedgerId, b.agentId, b.branchId),
      tx.select().from(S.purchaseBillLine).where(eq(S.purchaseBillLine.purchaseBillId, id)).orderBy(asc(S.purchaseBillLine.lineNumber)),
      tx.select().from(S.purchaseBillImportDetail).where(eq(S.purchaseBillImportDetail.purchaseBillId, id)),
      b.journalVoucherId ? tx.select({ id: S.journalVoucher.id, voucherNumber: S.journalVoucher.voucherNumber, voucherDate: S.journalVoucher.voucherDate }).from(S.journalVoucher).where(eq(S.journalVoucher.id, b.journalVoucherId)) : Promise.resolve([]),
      tx.select({ id: B.id, invoiceNumber: B.invoiceNumber }).from(B).where(and(eq(B.reversalOfId, id), eq(B.isPosted, true))),
      b.mainBillId ? tx.select({ id: B.id, invoiceNumber: B.invoiceNumber }).from(B).where(eq(B.id, b.mainBillId)) : Promise.resolve([]),
      tx.select({ id: B.id, invoiceNumber: B.invoiceNumber, isPosted: B.isPosted, totalAmount: B.totalAmount, reversalOfId: B.reversalOfId, reversed: reversedSql(B.id) }).from(B).where(eq(B.mainBillId, id)).orderBy(asc(B.id)),
      b.purchaseChallanId ? tx.select({ challanNumber: S.purchaseChallan.challanNumber }).from(S.purchaseChallan).where(eq(S.purchaseChallan.id, b.purchaseChallanId)) : Promise.resolve([]),
      b.purchaseOrderId ? tx.select({ orderNumber: S.purchaseOrder.orderNumber }).from(S.purchaseOrder).where(eq(S.purchaseOrder.id, b.purchaseOrderId)) : Promise.resolve([]),
    ]);
    const reversalOf = b.reversalOfId ? (await tx.select({ id: B.id, invoiceNumber: B.invoiceNumber }).from(B).where(eq(B.id, b.reversalOfId)))[0] ?? null : null;
    const [prod, units, locs, terms, clLines, olLines] = await Promise.all([
      productNames(tx, lines.map((l) => l.productId)), unitCodes(tx, lines.flatMap((l) => [l.unitId, l.altUnitId])), locationCodes(tx, lines.map((l) => l.locationId)),
      termRows(tx, "PURCHASE_BILL", id, lines),
      lines.some((l) => l.challanLineId) ? tx.select({ id: S.purchaseChallanLine.id, lineNumber: S.purchaseChallanLine.lineNumber }).from(S.purchaseChallanLine).where(inArray(S.purchaseChallanLine.id, lines.map((l) => l.challanLineId).filter((x): x is number => !!x))) : Promise.resolve([]),
      lines.some((l) => l.purchaseOrderLineId) ? tx.select({ id: S.purchaseOrderLine.id, lineNumber: S.purchaseOrderLine.lineNumber }).from(S.purchaseOrderLine).where(inArray(S.purchaseOrderLine.id, lines.map((l) => l.purchaseOrderLineId).filter((x): x is number => !!x))) : Promise.resolve([]),
    ]);
    const clNo = new Map(clLines.map((l) => [l.id, l.lineNumber])), olNo = new Map(olLines.map((l) => [l.id, l.lineNumber]));
    const d = importRow[0];
    const reversed = reversedBy.length > 0;
    return {
      id: b.id, companyId: b.companyId, branchId: b.branchId, ...names,
      invoiceNumber: b.invoiceNumber, invoiceDate: iso(b.invoiceDate), fiscalYear: b.fiscalYear, invoiceType: b.invoiceType, purchaseType: b.purchaseType,
      vendorGLId: b.vendorGLId, subLedgerId: b.subLedgerId, agentId: b.agentId, vendorInvoiceNo: b.vendorInvoiceNo, vendorInvoiceDate: iso(b.vendorInvoiceDate),
      purchaseChallanId: b.purchaseChallanId, challanNumber: challan[0]?.challanNumber ?? null, purchaseOrderId: b.purchaseOrderId, orderNumber: order[0]?.orderNumber ?? null,
      mainBillId: b.mainBillId, mainBill: main[0] ?? null, reversalOfId: b.reversalOfId, reversalOf, reversedBy: reversedBy[0] ?? null,
      dueDays: b.dueDays, dueDate: iso(b.dueDate), remarks: b.remarks,
      isPosted: b.isPosted, postedAt: b.postedAt, state: billState(b.isPosted, b.reversalOfId, reversed),
      journalVoucher: voucher[0] ? { ...voucher[0], voucherDate: iso(voucher[0].voucherDate) } : null,
      basicAmount: amt(b.basicAmount), termAmount: amt(b.termAmount), totalAmount: amt(b.totalAmount),
      lines: lines.map((l) => ({
        id: l.id, lineNumber: l.lineNumber, productId: l.productId, ...prod.get(l.productId), particular: l.particular,
        challanLineId: l.challanLineId, challanLineNumber: l.challanLineId ? clNo.get(l.challanLineId) ?? null : null,
        purchaseOrderLineId: l.purchaseOrderLineId, orderLineNumber: l.purchaseOrderLineId ? olNo.get(l.purchaseOrderLineId) ?? null : null,
        altQty: l.altQty, altUnitId: l.altUnitId, altUnitCode: l.altUnitId ? units.get(l.altUnitId) ?? null : null,
        qty: l.qty, unitId: l.unitId, unitCode: units.get(l.unitId) ?? null, rate: l.rate, basicAmount: amt(l.basicAmount),
        allocatedTermAmount: amt(l.allocatedTermAmount), landedAmount: amt(l.landedAmount), landedRate: l.landedRate,
        locationId: l.locationId, locationCode: l.locationId ? locs.get(l.locationId) ?? null : null,
        batchNo: l.batchNo, manufactureDate: iso(l.manufactureDate), expiryDate: iso(l.expiryDate),
      })),
      terms,
      importDetail: d
        ? {
            customsDeclarationNo: d.customsDeclarationNo, customsDeclarationDate: iso(d.customsDeclarationDate), customsOffice: d.customsOffice, countryOfOrigin: d.countryOfOrigin,
            lcNo: d.lcNo, lcDate: iso(d.lcDate), lcBankName: d.lcBankName, transportMode: d.transportMode, blAwbNo: d.blAwbNo, blAwbDate: iso(d.blAwbDate),
            transporterName: d.transporterName, vehicleNo: d.vehicleNo, lrNo: d.lrNo, lrDate: iso(d.lrDate), importPermitNo: d.importPermitNo, importPermitDate: iso(d.importPermitDate),
          }
        : null,
      additionalBills: additional.map(({ reversed: r, ...a }) => ({ ...a, totalAmount: amt(a.totalAmount), state: billState(a.isPosted, a.reversalOfId, r) })),
    };
  });
}

// ---------------------------------------------------------------------------------------------------------------------------
// PICK-LISTS for the forms
// ---------------------------------------------------------------------------------------------------------------------------
// Everything a purchase form lets the user choose from, in one call: vendor ledgers (+ sub-ledgers), agents, purchasable products with their
// units and tracking, locations, purchase terms, and the fiscal years (the screen needs their dates to default a document date).
export function purchaseLookups(companyId: number) {
  return snapshot(async (tx) => {
    const [ledgers, subs, agents, products, alts, locations, terms, years, units] = await Promise.all([
      tx.select({ id: S.generalLedger.id, code: S.generalLedger.code, name: S.generalLedger.name, requiresSubLedger: S.generalLedger.requiresSubLedger, isActive: S.generalLedger.isActive }).from(S.generalLedger).where(eq(S.generalLedger.companyId, companyId)).orderBy(asc(S.generalLedger.code)),
      tx.select({ id: S.subLedger.id, code: S.subLedger.code, name: S.subLedger.name, generalLedgerId: S.subLedger.generalLedgerId, isActive: S.subLedger.isActive }).from(S.subLedger).innerJoin(S.generalLedger, eq(S.generalLedger.id, S.subLedger.generalLedgerId)).where(eq(S.generalLedger.companyId, companyId)).orderBy(asc(S.subLedger.code)),
      tx.select({ id: S.agent.id, code: S.agent.code, name: S.agent.name, isActive: S.agent.isActive }).from(S.agent).where(eq(S.agent.companyId, companyId)).orderBy(asc(S.agent.code)),
      tx.select({
        id: S.product.id, code: S.product.code, description: S.product.description, type: S.product.type, isActive: S.product.isActive,
        stockDetailId: S.stockDetail.id, baseUnitId: sql<number | null>`coalesce(${S.stockDetail.baseUnitId}, ${S.nonStockDetail.unitId}, ${S.serviceDetail.unitId})`,
        tracksBatch: sql<boolean>`coalesce(${S.stockDetail.tracksBatch}, false)`, tracksExpiry: sql<boolean>`coalesce(${S.stockDetail.tracksExpiry}, false)`,
        defaultLocationId: S.stockDetail.defaultLocationId,
      })
        .from(S.product)
        .leftJoin(S.stockDetail, eq(S.stockDetail.productId, S.product.id))
        .leftJoin(S.nonStockDetail, eq(S.nonStockDetail.productId, S.product.id))
        .leftJoin(S.serviceDetail, eq(S.serviceDetail.productId, S.product.id))
        .where(and(eq(S.product.companyId, companyId), sql`${S.product.type} <> 'BUNDLE'`)).orderBy(asc(S.product.code)),
      tx.select({ stockDetailId: S.alternateUnit.stockDetailId, unitId: S.alternateUnit.unitId, conversionFactor: S.alternateUnit.conversionFactor }).from(S.alternateUnit).innerJoin(S.stockDetail, eq(S.stockDetail.id, S.alternateUnit.stockDetailId)).innerJoin(S.product, eq(S.product.id, S.stockDetail.productId)).where(eq(S.product.companyId, companyId)),
      tx.select({ id: S.location.id, code: S.location.code, name: S.location.name, isActive: S.location.isActive }).from(S.location).where(eq(S.location.companyId, companyId)).orderBy(asc(S.location.code)),
      tx.select().from(S.purchaseTerm).where(eq(S.purchaseTerm.companyId, companyId)).orderBy(asc(S.purchaseTerm.sequence), asc(S.purchaseTerm.code)),
      tx.select({ id: S.fiscalYear.id, code: S.fiscalYear.code, startDate: S.fiscalYear.startDate, endDate: S.fiscalYear.endDate, isActive: S.fiscalYear.isActive, isClosed: S.fiscalYear.isClosed, isCurrent: S.fiscalYear.isCurrent }).from(S.fiscalYear).where(eq(S.fiscalYear.companyId, companyId)).orderBy(desc(S.fiscalYear.startDate)),
      tx.select({ id: S.productUnit.id, code: S.productUnit.code, name: S.productUnit.name, decimalPlaces: S.productUnit.decimalPlaces }).from(S.productUnit).where(eq(S.productUnit.companyId, companyId)).orderBy(asc(S.productUnit.code)),
    ]);
    const altBy = new Map<number, { unitId: number; conversionFactor: string }[]>();
    for (const a of alts) altBy.set(a.stockDetailId, [...(altBy.get(a.stockDetailId) ?? []), { unitId: a.unitId, conversionFactor: a.conversionFactor }]);
    return {
      vendors: ledgers, subLedgers: subs, agents, locations, units,
      products: products.map(({ stockDetailId, ...p }) => ({ ...p, alternateUnits: stockDetailId ? altBy.get(stockDetailId) ?? [] : [] })),
      terms: terms.map((t) => ({
        id: t.id, code: t.code, name: t.name, category: t.category, nature: t.nature, isProductwise: t.isProductwise, isMandatory: t.isMandatory, sequence: t.sequence,
        defaultCalcType: t.defaultCalcType, defaultValue: t.defaultValue, calcBase: t.calcBase, distributeToLines: t.distributeToLines, isActive: t.isActive,
      })),
      fiscalYears: years.map((y) => ({ ...y, startDate: iso(y.startDate), endDate: iso(y.endDate) })),
    };
  });
}

// ---------------------------------------------------------------------------------------------------------------------------
// small shared lookups
// ---------------------------------------------------------------------------------------------------------------------------
async function headerNames(tx: Tx, vendorGLId: number, subLedgerId: number | null, agentId: number | null, branchId: number) {
  const SL = alias(S.subLedger, "sl");
  const [[v], sl, ag, [br]] = await Promise.all([
    tx.select({ code: S.generalLedger.code, name: S.generalLedger.name }).from(S.generalLedger).where(eq(S.generalLedger.id, vendorGLId)),
    subLedgerId ? tx.select({ code: SL.code, name: SL.name }).from(SL).where(eq(SL.id, subLedgerId)) : Promise.resolve([]),
    agentId ? tx.select({ code: S.agent.code, name: S.agent.name }).from(S.agent).where(eq(S.agent.id, agentId)) : Promise.resolve([]),
    tx.select({ name: S.branch.name }).from(S.branch).where(eq(S.branch.id, branchId)),
  ]);
  return { vendorCode: v?.code ?? null, vendorName: v?.name ?? null, subLedgerCode: sl[0]?.code ?? null, subLedgerName: sl[0]?.name ?? null, agentCode: ag[0]?.code ?? null, agentName: ag[0]?.name ?? null, branchName: br?.name ?? null };
}

async function productNames(tx: Tx, ids: number[]) {
  const uniq = [...new Set(ids)];
  const rows = uniq.length ? await tx.select({ id: S.product.id, code: S.product.code, description: S.product.description, type: S.product.type }).from(S.product).where(inArray(S.product.id, uniq)) : [];
  return new Map(rows.map((r) => [r.id, { productCode: r.code, productDescription: r.description, productType: r.type }]));
}
async function unitCodes(tx: Tx, ids: (number | null)[]) {
  const uniq = [...new Set(ids.filter((x): x is number => !!x))];
  const rows = uniq.length ? await tx.select({ id: S.productUnit.id, code: S.productUnit.code }).from(S.productUnit).where(inArray(S.productUnit.id, uniq)) : [];
  return new Map(rows.map((r) => [r.id, r.code]));
}
async function locationCodes(tx: Tx, ids: (number | null)[]) {
  const uniq = [...new Set(ids.filter((x): x is number => !!x))];
  const rows = uniq.length ? await tx.select({ id: S.location.id, code: S.location.code }).from(S.location).where(inArray(S.location.id, uniq)) : [];
  return new Map(rows.map((r) => [r.id, r.code]));
}

// The billing terms of one order / bill as the screen shows them (with the master's name and the line a productwise term sits on).
async function termRows(tx: Tx, docType: "PURCHASE_ORDER" | "PURCHASE_BILL", docId: number, lines: { id: number; lineNumber: number }[]) {
  const T = S.purchaseDocumentTerm, M = S.purchaseTerm;
  const rows = await tx.select({ t: T, code: M.code, name: M.name, category: M.category }).from(T).innerJoin(M, eq(M.id, T.termId)).where(and(eq(T.documentType, docType), eq(T.documentId, docId))).orderBy(asc(T.sequence), asc(T.id));
  const lineNo = new Map(lines.map((l) => [l.id, l.lineNumber]));
  return rows.map(({ t, code, name, category }) => ({
    id: t.id, termId: t.termId, termCode: code, termName: name, category, nature: t.nature, sequence: t.sequence, calcBase: t.calcBase, distributeToLines: t.distributeToLines,
    lineNumber: t.documentLineId ? lineNo.get(t.documentLineId) ?? null : null,
    calcType: t.calcType, rate: t.rate, inputAmount: t.inputAmount, isOverridden: t.isOverridden,
    baseAmount: t.baseAmount, calculatedAmount: t.calculatedAmount, finalAmount: t.finalAmount,
  }));
}
