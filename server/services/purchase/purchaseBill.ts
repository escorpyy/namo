import { and, asc, eq, inArray, sql } from "drizzle-orm";
import * as S from "../../db/schema";
import { HttpError } from "../../routes/_util";
import { type Actor, type Opts, type Tx, addDays, assertBranch, assertVendorLedger, idList, inTx, nextNumber, optDate, parseDate, resolveFiscalYear, today } from "./common";
import { assertMandatoryTerms, recalcTerms, saveTerms, type TermInput } from "./docTerms";
import { landed } from "./landed";
import { resolveLines, type LineInput, type ResolvedLine } from "./lines";
import { ZERO, fmt, toMicro, type Micro } from "./money";
import { billedByChallanLine, billedByOrderLine, pending, receivedByOrderLine, withTolerance } from "./quantities";

// PURCHASE BILL: the vendor's invoice. This is the document that hits the books.
//
//   save (draft) ─ prices terms, splits landed cost, totals ─▶ post (journal voucher) ─▶ reverse (if wrong)
//
// Posting writes ONE journal voucher:
//   Dr  each line's purchase ledger (stock: StockDetail.purchaseGLId, non-stock/service: its purchaseGLId, asset: assetGLId)  basic amount
//   Dr / Cr  each billing term's own ledger (additive = Dr, deductive = Cr)                                                    term amount
//   Cr  the vendor ledger                                                                                                      total
// Landed cost (freight, duty spread over lines) is for STOCK VALUATION only: the charges are booked once, to their own
// ledgers, and never double-counted into the purchase ledger.
//
// An ADDITIONAL bill (mainBillId set) books charges that arrive after the main bill (import duty, clearing, ...).
// It has no lines; its distributing terms re-value the MAIN bill's lines once it is posted.

export type BillLineInput = LineInput & {
  challanLineId?: number | null; // the challan line this bills
  purchaseOrderLineId?: number | null; // the order line this bills (reachable through the challan line too)
  locationId?: number | null;
  batchNo?: string | null;
  manufactureDate?: string | Date | null;
  expiryDate?: string | Date | null;
};

export type ImportDetailInput = Partial<{
  customsDeclarationNo: string; customsDeclarationDate: string | Date; customsOffice: string; countryOfOrigin: string;
  lcNo: string; lcDate: string | Date; lcBankName: string;
  transportMode: "ROAD" | "AIR" | "RAIL" | "OTHER"; blAwbNo: string; blAwbDate: string | Date; transporterName: string; vehicleNo: string; lrNo: string; lrDate: string | Date;
  importPermitNo: string; importPermitDate: string | Date;
}>;

export type PurchaseBillInput = {
  id?: number; // present = edit this draft
  companyId: number;
  branchId: number;
  invoiceNumber?: string;
  invoiceDate: string | Date;
  fiscalYear?: string;
  invoiceType?: "LOCAL" | "IMPORT";
  purchaseType?: "GOODS_PURCHASE_OTHERS" | "GOODS_PURCHASE_CAPITAL" | "SERVICE_PURCHASE_OTHERS" | "SERVICE_PURCHASE_CAPITAL";
  vendorGLId: number;
  subLedgerId?: number | null;
  agentId?: number | null;
  vendorInvoiceNo?: string | null;
  vendorInvoiceDate?: string | Date | null;
  purchaseChallanId?: number | null;
  purchaseOrderId?: number | null;
  mainBillId?: number | null; // set = this is an ADDITIONAL bill of that (posted) main bill
  dueDays?: number;
  dueDate?: string | Date | null; // blank = invoiceDate + dueDays
  remarks?: string | null;
  lines: BillLineInput[];
  terms?: TermInput[];
  importDetail?: ImportDetailInput | null;
};

type QtyOpts = { tolerancePercent?: number };

async function lockBill(tx: Tx, id: number) {
  const [b] = await tx.select().from(S.purchaseBill).where(eq(S.purchaseBill.id, id)).for("update");
  if (!b) throw new HttpError(404, "Purchase bill not found.");
  return b;
}

// Billed qty (this bill + every other standing bill) may not exceed what the challan line received / the order line ordered.
async function checkBillQuantities(tx: Tx, billId: number, lines: { lineNumber: number; qty: Micro; challanLineId: number | null; purchaseOrderLineId: number | null }[], tol?: number) {
  const clIds = [...new Set(lines.map((l) => l.challanLineId).filter((x): x is number => !!x))];
  const olIds = [...new Set(lines.map((l) => l.purchaseOrderLineId).filter((x): x is number => !!x))];
  const [cls, ols, clBilled, olBilled] = await Promise.all([
    clIds.length ? tx.select().from(S.purchaseChallanLine).where(inArray(S.purchaseChallanLine.id, clIds)) : [],
    olIds.length ? tx.select().from(S.purchaseOrderLine).where(inArray(S.purchaseOrderLine.id, olIds)) : [],
    billedByChallanLine(tx, clIds, billId), billedByOrderLine(tx, olIds, billId),
  ]);
  const sumBy = (key: "challanLineId" | "purchaseOrderLineId") => {
    const m = new Map<number, Micro>();
    for (const l of lines) if (l[key]) m.set(l[key]!, (m.get(l[key]!) ?? ZERO) + l.qty);
    return m;
  };
  for (const [id, q] of sumBy("challanLineId")) {
    const cl = cls.find((x) => x.id === id)!, limit = withTolerance(toMicro(cl.qty), tol), used = clBilled.get(id) ?? ZERO;
    if (used + q > limit) throw new HttpError(409, `Challan line ${cl.lineNumber}: billing ${fmt(q)} would exceed the ${fmt(toMicro(cl.qty))} received (already billed ${fmt(used)}). Pending: ${fmt(pending(limit, used))}.`, "lines");
  }
  for (const [id, q] of sumBy("purchaseOrderLineId")) {
    const ol = ols.find((x) => x.id === id)!, limit = withTolerance(toMicro(ol.qty), tol), used = olBilled.get(id) ?? ZERO;
    if (used + q > limit) throw new HttpError(409, `Order line ${ol.lineNumber}: billing ${fmt(q)} would exceed the ${fmt(toMicro(ol.qty))} ordered (already billed ${fmt(used)}). Pending: ${fmt(pending(limit, used))}.`, "lines");
  }
}

// landedAmount = basic + the signed net of every allocation that STANDS on the line, landedRate = landedAmount / qty.
// An allocation stands when its bill is posted (or it is the line's own draft bill) and that bill has not been reversed.
export async function recomputeLanded(tx: Tx, lineIds: number[]) {
  if (!lineIds.length) return;
  const lines = await tx.select().from(S.purchaseBillLine).where(inArray(S.purchaseBillLine.id, lineIds));
  const rows = (await tx.execute(sql`
    select a."documentLineId" as id,
           sum(case when t.nature = 'ADDITIVE' then a."allocatedAmount" else -a."allocatedAmount" end)::text as amt
      from "PurchaseDocumentTermAllocation" a
      join "PurchaseDocumentTerm" t on t.id = a."documentTermId" and t."documentType" = 'PURCHASE_BILL'
      join "PurchaseBill" b on b.id = t."documentId"
      join "PurchaseBillLine" l on l.id = a."documentLineId"
     where a."documentLineId" in (${idList(lineIds)})
       and (b."isPosted" or l."purchaseBillId" = b.id)
       and not exists (select 1 from "PurchaseBill" r where r."reversalOfId" = b.id and r."isPosted")
     group by 1`)) as any[];
  const alloc = new Map(rows.map((r) => [Number(r.id), toMicro(r.amt)]));
  for (const l of lines) {
    const x = landed({ basicAmount: toMicro(l.basicAmount), qty: toMicro(l.qty), allocated: alloc.get(l.id) ?? ZERO });
    await tx.update(S.purchaseBillLine).set({ allocatedTermAmount: fmt(x.allocatedTermAmount, 2), landedAmount: fmt(x.landedAmount, 2), landedRate: fmt(x.landedRate) }).where(eq(S.purchaseBillLine.id, l.id));
  }
}

async function recalcBill(tx: Tx, billId: number, mainBillId: number | null) {
  const t = await recalcTerms(tx, "PURCHASE_BILL", billId);
  await tx.update(S.purchaseBill).set({ basicAmount: fmt(t.itemTotal, 2), termAmount: fmt(t.termNet, 2), totalAmount: fmt(t.total, 2), updatedAt: new Date() }).where(eq(S.purchaseBill.id, billId));
  const own = await tx.select({ id: S.purchaseBillLine.id }).from(S.purchaseBillLine).where(eq(S.purchaseBillLine.purchaseBillId, billId));
  await recomputeLanded(tx, own.map((l) => l.id));
  return t;
}

export function savePurchaseBill(input: PurchaseBillInput, actor: Actor, opts: Opts & QtyOpts = {}) {
  return inTx(opts.tx, async (tx) => {
    const invoiceDate = parseDate(input.invoiceDate, "invoiceDate");
    const invoiceType = input.invoiceType ?? "LOCAL";
    const dueDays = input.dueDays ?? 0;
    if (!Number.isInteger(dueDays) || dueDays < 0) throw new HttpError(400, "Due days must be a whole number, 0 or more.", "dueDays");
    if (invoiceType === "LOCAL" && input.importDetail) throw new HttpError(400, "Import details belong on an IMPORT invoice.", "importDetail");

    let existing: Awaited<ReturnType<typeof lockBill>> | null = null;
    if (input.id) {
      existing = await lockBill(tx, input.id);
      if (existing.companyId !== input.companyId || existing.branchId !== input.branchId) throw new HttpError(400, "A bill cannot be moved to another company or branch.");
      if (existing.isPosted) throw new HttpError(409, "A posted bill cannot be edited. Reverse it and enter a correct one.");
      if ((existing.mainBillId ?? null) !== (input.mainBillId ?? null)) throw new HttpError(400, "A bill cannot change between main and additional.");
    }

    await assertBranch(tx, input.companyId, input.branchId);
    await assertVendorLedger(tx, input.companyId, input.vendorGLId, input.subLedgerId);
    const fy = await resolveFiscalYear(tx, input.companyId, invoiceDate, input.fiscalYear ?? null);

    const isAdditional = !!input.mainBillId;
    if (isAdditional) {
      const [m] = await tx.select().from(S.purchaseBill).where(and(eq(S.purchaseBill.id, input.mainBillId!), eq(S.purchaseBill.companyId, input.companyId)));
      if (!m) throw new HttpError(404, "Main bill not found in this company.", "mainBillId");
      if (m.mainBillId) throw new HttpError(400, "An additional bill cannot be added to another additional bill.", "mainBillId");
      if (m.reversalOfId) throw new HttpError(400, "A reversal bill cannot have additional bills.", "mainBillId");
      if (!m.isPosted) throw new HttpError(409, "Post the main bill before adding charges to it.", "mainBillId");
      const [rev] = await tx.select({ id: S.purchaseBill.id }).from(S.purchaseBill).where(and(eq(S.purchaseBill.reversalOfId, m.id), eq(S.purchaseBill.isPosted, true)));
      if (rev) throw new HttpError(409, "The main bill has been reversed.", "mainBillId");
      if (input.lines?.length) throw new HttpError(400, "An additional bill carries charges only; it has no item lines.", "lines");
      if (!input.terms?.length) throw new HttpError(400, "An additional bill needs at least one charge.", "terms");
      if (input.purchaseChallanId || input.purchaseOrderId) throw new HttpError(400, "An additional bill does not close a challan or order; its main bill does.");
    } else if (!input.lines?.length) {
      throw new HttpError(400, "A bill needs at least one line.", "lines");
    }

    // Documents this bill closes.
    if (input.purchaseChallanId) {
      const [c] = await tx.select().from(S.purchaseChallan).where(and(eq(S.purchaseChallan.id, input.purchaseChallanId), eq(S.purchaseChallan.companyId, input.companyId)));
      if (!c) throw new HttpError(404, "Challan not found in this company.", "purchaseChallanId");
      if (!c.isConfirmed) throw new HttpError(409, `Challan ${c.challanNumber} is not confirmed yet; confirm the receipt before billing it.`, "purchaseChallanId");
    }
    if (input.purchaseOrderId) {
      const [o] = await tx.select().from(S.purchaseOrder).where(and(eq(S.purchaseOrder.id, input.purchaseOrderId), eq(S.purchaseOrder.companyId, input.companyId)));
      if (!o) throw new HttpError(404, "Purchase order not found in this company.", "purchaseOrderId");
      if (o.status === "DRAFT" || o.status === "CANCELLED") throw new HttpError(409, `Order ${o.orderNumber} is ${o.status}; it cannot be billed.`, "purchaseOrderId");
    }

    const lines = await resolveLines(tx, input.companyId, input.lines ?? [], { allowZeroQty: false });
    await checkBillQuantities(tx, existing?.id ?? 0, lines.map((l, i) => ({ lineNumber: l.lineNumber, qty: l.qty, challanLineId: input.lines[i].challanLineId ?? null, purchaseOrderLineId: input.lines[i].purchaseOrderLineId ?? null })), opts.tolerancePercent);

    const invoiceNumber = input.invoiceNumber?.trim() || existing?.invoiceNumber || (await nextNumber(tx, "PurchaseBill", "invoiceNumber", input.branchId, fy.code));
    const dueDate = input.dueDate ? parseDate(input.dueDate, "dueDate") : addDays(invoiceDate, dueDays);
    const header = {
      companyId: input.companyId, branchId: input.branchId, invoiceNumber, invoiceDate, fiscalYear: fy.code, invoiceType,
      purchaseType: input.purchaseType ?? "GOODS_PURCHASE_OTHERS", vendorGLId: input.vendorGLId, subLedgerId: input.subLedgerId ?? null, agentId: input.agentId ?? null,
      vendorInvoiceNo: input.vendorInvoiceNo?.trim() || null, vendorInvoiceDate: optDate(input.vendorInvoiceDate, "vendorInvoiceDate"),
      purchaseChallanId: input.purchaseChallanId ?? null, purchaseOrderId: input.purchaseOrderId ?? null, mainBillId: input.mainBillId ?? null,
      dueDays, dueDate, remarks: input.remarks ?? null, updatedAt: new Date(),
    };

    let id: number;
    if (existing) {
      id = existing.id;
      await tx.delete(S.purchaseDocumentTerm).where(and(eq(S.purchaseDocumentTerm.documentType, "PURCHASE_BILL"), eq(S.purchaseDocumentTerm.documentId, id)));
      await tx.delete(S.purchaseBillImportDetail).where(eq(S.purchaseBillImportDetail.purchaseBillId, id));
      await tx.delete(S.purchaseBillLine).where(eq(S.purchaseBillLine.purchaseBillId, id));
      await tx.update(S.purchaseBill).set(header).where(eq(S.purchaseBill.id, id));
    } else {
      [{ id }] = await tx.insert(S.purchaseBill).values({ ...header, createdBy: actor.userId }).returning({ id: S.purchaseBill.id });
    }

    const lineIdByNumber = new Map<number, number>();
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i], src = input.lines[i];
      const [row] = await tx.insert(S.purchaseBillLine).values({
        purchaseBillId: id, lineNumber: l.lineNumber, productId: l.productId, particular: l.particular,
        challanLineId: src.challanLineId ?? null, purchaseOrderLineId: src.purchaseOrderLineId ?? null,
        altQty: l.altQty === null ? null : fmt(l.altQty), altUnitId: l.altUnitId, qty: fmt(l.qty), unitId: l.unitId, rate: fmt(l.rate), basicAmount: fmt(l.basicAmount, 2),
        locationId: src.locationId ?? null, batchNo: src.batchNo?.trim() || null,
        manufactureDate: optDate(src.manufactureDate, "manufactureDate"), expiryDate: optDate(src.expiryDate, "expiryDate"),
      }).returning({ id: S.purchaseBillLine.id });
      lineIdByNumber.set(l.lineNumber, row.id);
    }

    if (input.importDetail && invoiceType === "IMPORT") {
      const d = input.importDetail;
      await tx.insert(S.purchaseBillImportDetail).values({
        purchaseBillId: id, customsDeclarationNo: d.customsDeclarationNo ?? null, customsDeclarationDate: optDate(d.customsDeclarationDate, "customsDeclarationDate"),
        customsOffice: d.customsOffice ?? null, countryOfOrigin: d.countryOfOrigin ?? null, lcNo: d.lcNo ?? null, lcDate: optDate(d.lcDate, "lcDate"), lcBankName: d.lcBankName ?? null,
        transportMode: d.transportMode ?? null, blAwbNo: d.blAwbNo ?? null, blAwbDate: optDate(d.blAwbDate, "blAwbDate"), transporterName: d.transporterName ?? null,
        vehicleNo: d.vehicleNo ?? null, lrNo: d.lrNo ?? null, lrDate: optDate(d.lrDate, "lrDate"), importPermitNo: d.importPermitNo ?? null, importPermitDate: optDate(d.importPermitDate, "importPermitDate"),
      });
    }

    await saveTerms(tx, { companyId: input.companyId, docType: "PURCHASE_BILL", docId: id, isAdditionalBill: isAdditional }, input.terms ?? [], lineIdByNumber);
    const t = await recalcBill(tx, id, input.mainBillId ?? null);
    return { id, invoiceNumber, fiscalYear: fy.code, basicAmount: fmt(t.itemTotal, 2), termAmount: fmt(t.termNet, 2), totalAmount: fmt(t.total, 2), dueDate };
  });
}

type JvRow = { generalLedgerId: number; debit: Micro; credit: Micro; narration: string; agentId?: number | null };

// Same ledger on the same side is one row.
function mergeRows(rows: JvRow[]): JvRow[] {
  const out = new Map<string, JvRow>();
  for (const r of rows) {
    const k = `${r.generalLedgerId}:${r.debit > ZERO ? "D" : "C"}`;
    const e = out.get(k);
    if (e) { e.debit += r.debit; e.credit += r.credit; } else out.set(k, { ...r });
  }
  return [...out.values()].filter((r) => r.debit !== ZERO || r.credit !== ZERO);
}

async function purchaseLedgerOf(tx: Tx, l: { productId: number }, p: { code: string; type: string }): Promise<number> {
  let gl: number | null | undefined;
  if (p.type === "STOCK") gl = (await tx.select({ g: S.stockDetail.purchaseGLId }).from(S.stockDetail).where(eq(S.stockDetail.productId, l.productId)))[0]?.g;
  else if (p.type === "NON_STOCK") gl = (await tx.select({ g: S.nonStockDetail.purchaseGLId }).from(S.nonStockDetail).where(eq(S.nonStockDetail.productId, l.productId)))[0]?.g;
  else if (p.type === "SERVICE") gl = (await tx.select({ g: S.serviceDetail.purchaseGLId }).from(S.serviceDetail).where(eq(S.serviceDetail.productId, l.productId)))[0]?.g;
  else if (p.type === "FIXED_ASSET") gl = (await tx.select({ g: S.fixedAssetDetail.assetGLId }).from(S.fixedAssetDetail).where(eq(S.fixedAssetDetail.productId, l.productId)))[0]?.g;
  if (!gl) throw new HttpError(409, `Product ${p.code} has no purchase ledger set up, so it cannot be posted.`);
  return gl;
}

// POST: checks everything that could not be checked while drafting, writes the journal voucher, and locks the bill.
export function postPurchaseBill(id: number, actor: Actor, opts: Opts & QtyOpts = {}) {
  return inTx(opts.tx, async (tx) => {
    const bill = await lockBill(tx, id);
    if (bill.isPosted) throw new HttpError(409, "Bill is already posted.");
    await resolveFiscalYear(tx, bill.companyId, bill.invoiceDate, bill.fiscalYear);
    const isAdditional = !!bill.mainBillId;

    if (isAdditional) {
      const [m] = await tx.select().from(S.purchaseBill).where(eq(S.purchaseBill.id, bill.mainBillId!));
      const [rev] = await tx.select({ id: S.purchaseBill.id }).from(S.purchaseBill).where(and(eq(S.purchaseBill.reversalOfId, m.id), eq(S.purchaseBill.isPosted, true)));
      if (!m.isPosted || rev) throw new HttpError(409, "The main bill is not posted (or has been reversed).");
    } else if (bill.purchaseChallanId) {
      const [c] = await tx.select().from(S.purchaseChallan).where(eq(S.purchaseChallan.id, bill.purchaseChallanId));
      if (!c.isConfirmed) throw new HttpError(409, `Challan ${c.challanNumber} is not confirmed.`);
    }

    const vendor = await assertVendorLedger(tx, bill.companyId, bill.vendorGLId, bill.subLedgerId, { requireSubWhenFlagged: true });

    if (bill.invoiceType === "IMPORT") {
      const [d] = await tx.select().from(S.purchaseBillImportDetail).where(eq(S.purchaseBillImportDetail.purchaseBillId, id));
      if (!d?.customsDeclarationNo) throw new HttpError(409, "An import invoice needs the customs declaration number before it can be posted.");
    }

    const dbLines = await tx.select().from(S.purchaseBillLine).where(eq(S.purchaseBillLine.purchaseBillId, id)).orderBy(asc(S.purchaseBillLine.lineNumber));
    if (!isAdditional && !dbLines.length) throw new HttpError(409, "A bill without lines cannot be posted.");
    await checkBillQuantities(tx, id, dbLines.map((l) => ({ lineNumber: l.lineNumber, qty: toMicro(l.qty), challanLineId: l.challanLineId, purchaseOrderLineId: l.purchaseOrderLineId })), opts.tolerancePercent);

    // Product tracking: a batch / expiry must come from somewhere. Billing a challan line takes them from the challan.
    for (const l of dbLines) {
      if (l.challanLineId) continue;
      const [sd] = await tx.select({ tracksBatch: S.stockDetail.tracksBatch, tracksExpiry: S.stockDetail.tracksExpiry }).from(S.stockDetail).where(eq(S.stockDetail.productId, l.productId));
      if (sd?.tracksBatch && !l.batchNo) throw new HttpError(409, `Line ${l.lineNumber}: this product is batch-tracked; enter the batch number.`);
      if (sd?.tracksExpiry && !l.expiryDate) throw new HttpError(409, `Line ${l.lineNumber}: this product expires; enter the expiry date.`);
    }

    if (!isAdditional) await assertMandatoryTerms(tx, bill.companyId, "PURCHASE_BILL", id);
    const totals = await recalcBill(tx, id, bill.mainBillId); // price once more: what is posted is what is stored
    if (totals.total <= ZERO) throw new HttpError(409, "The bill total must be greater than zero to post.");

    // --- build the journal voucher ---
    const rows: JvRow[] = [];
    for (const l of dbLines) {
      const [p] = await tx.select({ code: S.product.code, type: S.product.type }).from(S.product).where(eq(S.product.id, l.productId));
      const amount = toMicro(l.basicAmount);
      if (amount !== ZERO) rows.push({ generalLedgerId: await purchaseLedgerOf(tx, l, p), debit: amount, credit: ZERO, narration: `Purchase ${bill.invoiceNumber}` });
    }
    const terms = await tx.select({ t: S.purchaseDocumentTerm, name: S.purchaseTerm.name, code: S.purchaseTerm.code, masterGL: S.purchaseTerm.generalLedgerId })
      .from(S.purchaseDocumentTerm).innerJoin(S.purchaseTerm, eq(S.purchaseTerm.id, S.purchaseDocumentTerm.termId))
      .where(and(eq(S.purchaseDocumentTerm.documentType, "PURCHASE_BILL"), eq(S.purchaseDocumentTerm.documentId, id)))
      .orderBy(asc(S.purchaseDocumentTerm.sequence), asc(S.purchaseDocumentTerm.id)); // a stable, readable voucher
    for (const { t, name, code, masterGL } of terms) {
      const amount = toMicro(t.finalAmount);
      if (amount === ZERO) continue;
      const gl = t.generalLedgerId ?? masterGL;
      if (!gl) throw new HttpError(409, `Term ${code} (${name}) has no ledger, so it cannot be posted.`);
      rows.push(t.nature === "ADDITIVE" ? { generalLedgerId: gl, debit: amount, credit: ZERO, narration: `${name} ${bill.invoiceNumber}` } : { generalLedgerId: gl, debit: ZERO, credit: amount, narration: `${name} ${bill.invoiceNumber}` });
    }
    rows.push({ generalLedgerId: bill.vendorGLId, debit: ZERO, credit: totals.total, narration: `Bill ${bill.invoiceNumber}${bill.vendorInvoiceNo ? ` / vendor invoice ${bill.vendorInvoiceNo}` : ""}`, agentId: bill.agentId });
    const jv = mergeRows(rows);
    const dr = jv.reduce((a, r) => a + r.debit, ZERO), cr = jv.reduce((a, r) => a + r.credit, ZERO);
    if (dr !== cr) throw new HttpError(500, `Journal does not balance (Dr ${fmt(dr, 2)} / Cr ${fmt(cr, 2)}). Nothing was posted.`);

    const jvId = await writeVoucher(tx, { companyId: bill.companyId, branchId: bill.branchId, voucherNumber: voucherNumberFor(bill), voucherDate: bill.invoiceDate, fiscalYear: bill.fiscalYear, remarks: `Purchase bill ${bill.invoiceNumber}`, reversalOfId: null }, jv, actor);
    await tx.update(S.purchaseBill).set({ isPosted: true, postedAt: new Date(), postedBy: actor.userId, journalVoucherId: jvId, updatedAt: new Date() }).where(eq(S.purchaseBill.id, id));

    // Now that this bill stands, re-value the lines it allocates to (its own, or the main bill's).
    const targets = isAdditional ? await tx.select({ id: S.purchaseBillLine.id }).from(S.purchaseBillLine).where(eq(S.purchaseBillLine.purchaseBillId, bill.mainBillId!)) : dbLines;
    await recomputeLanded(tx, targets.map((l) => l.id));
    return { id, isPosted: true as const, journalVoucherId: jvId, voucherNumber: voucherNumberFor(bill), totalAmount: fmt(totals.total, 2), debit: fmt(dr, 2), credit: fmt(cr, 2) };
  });
}

const voucherNumberFor = (b: { id: number; invoiceNumber: string; fiscalYear: string }) => {
  const n = `PB-${b.fiscalYear}-${b.invoiceNumber}`;
  return n.length <= 30 ? n : `PB-${b.id}`;
};

async function writeVoucher(tx: Tx, h: { companyId: number; branchId: number; voucherNumber: string; voucherDate: Date; fiscalYear: string; remarks: string; reversalOfId: number | null }, rows: JvRow[], actor: Actor) {
  const [v] = await tx.insert(S.journalVoucher).values({ ...h, isPosted: true, postedAt: new Date(), postedBy: actor.userId, createdBy: actor.userId }).returning({ id: S.journalVoucher.id });
  let n = 1;
  for (const r of rows) {
    await tx.insert(S.journalVoucherLine).values({ journalVoucherId: v.id, lineNumber: n++, generalLedgerId: r.generalLedgerId, debit: fmt(r.debit, 2), credit: fmt(r.credit, 2), narration: r.narration, agentId: r.agentId ?? null });
  }
  return v.id;
}

// REVERSE a posted bill: a reversal bill (copy, no links, so quantities free up) plus a voucher with Dr and Cr swapped.
// The original is never edited. An additional bill's reversal also takes its charges back off the main bill's landed cost.
export function reversePurchaseBill(id: number, actor: Actor, opts: Opts & { date?: string | Date; reason?: string } = {}) {
  return inTx(opts.tx, async (tx) => {
    const orig = await lockBill(tx, id);
    if (!orig.isPosted) throw new HttpError(409, "Only a posted bill can be reversed. Edit or delete a draft instead.");
    if (orig.reversalOfId) throw new HttpError(409, "A reversal cannot itself be reversed.");
    const [already] = await tx.select({ id: S.purchaseBill.id }).from(S.purchaseBill).where(and(eq(S.purchaseBill.reversalOfId, id), eq(S.purchaseBill.isPosted, true)));
    if (already) throw new HttpError(409, "This bill has already been reversed.");
    if (!orig.mainBillId) {
      const live = (await tx.execute(sql`
        select a.id from "PurchaseBill" a
         where a."mainBillId" = ${id} and a."isPosted" and a."reversalOfId" is null
           and not exists (select 1 from "PurchaseBill" r where r."reversalOfId" = a.id and r."isPosted")`)) as any[];
      if (live.length) throw new HttpError(409, "Reverse this bill's additional bills first.");
    }

    const date = opts.date ? parseDate(opts.date, "date") : today();
    if (date.getTime() < orig.invoiceDate.getTime()) throw new HttpError(400, "A reversal cannot be dated before the bill it reverses.", "date");
    const fy = await resolveFiscalYear(tx, orig.companyId, date, null);

    const [ojv] = await tx.select().from(S.journalVoucher).where(eq(S.journalVoucher.id, orig.journalVoucherId!));
    const ojl = await tx.select().from(S.journalVoucherLine).where(eq(S.journalVoucherLine.journalVoucherId, ojv.id)).orderBy(asc(S.journalVoucherLine.lineNumber));
    const swapped: JvRow[] = ojl.map((l) => ({ generalLedgerId: l.generalLedgerId, debit: toMicro(l.credit), credit: toMicro(l.debit), narration: `Reversal: ${l.narration ?? ""}`.slice(0, 500), agentId: l.agentId }));
    const rvNumber = `R-${ojv.voucherNumber}`.length <= 30 ? `R-${ojv.voucherNumber}` : `R-${ojv.id}`;
    const rjv = await writeVoucher(tx, { companyId: orig.companyId, branchId: orig.branchId, voucherNumber: rvNumber, voucherDate: date, fiscalYear: fy.code, remarks: `Reversal of purchase bill ${orig.invoiceNumber}${opts.reason ? `: ${opts.reason}` : ""}`.slice(0, 1024), reversalOfId: ojv.id }, swapped, actor);

    let number = `R-${orig.invoiceNumber}`.slice(0, 30), k = 1;
    while ((await tx.select({ id: S.purchaseBill.id }).from(S.purchaseBill).where(and(eq(S.purchaseBill.branchId, orig.branchId), eq(S.purchaseBill.fiscalYear, fy.code), eq(S.purchaseBill.invoiceNumber, number)))).length) number = `R${++k}-${orig.invoiceNumber}`.slice(0, 30);

    const [rb] = await tx.insert(S.purchaseBill).values({
      companyId: orig.companyId, branchId: orig.branchId, invoiceNumber: number, invoiceDate: date, fiscalYear: fy.code, invoiceType: orig.invoiceType, purchaseType: orig.purchaseType,
      vendorGLId: orig.vendorGLId, subLedgerId: orig.subLedgerId, agentId: orig.agentId, mainBillId: orig.mainBillId, reversalOfId: orig.id, journalVoucherId: rjv,
      dueDays: 0, basicAmount: orig.basicAmount, termAmount: orig.termAmount, totalAmount: orig.totalAmount,
      remarks: `Reversal of ${orig.invoiceNumber}${opts.reason ? `: ${opts.reason}` : ""}`.slice(0, 1024),
      isPosted: true, postedAt: new Date(), postedBy: actor.userId, createdBy: actor.userId,
    }).returning({ id: S.purchaseBill.id });

    // copy lines and terms (amounts as they were; no challan / order links, no allocations)
    const olines = await tx.select().from(S.purchaseBillLine).where(eq(S.purchaseBillLine.purchaseBillId, orig.id)).orderBy(asc(S.purchaseBillLine.lineNumber));
    const lineMap = new Map<number, number>();
    for (const l of olines) {
      const { id: oldId, purchaseBillId: _b, challanLineId: _c, purchaseOrderLineId: _o, createdAt: _t, ...rest } = l;
      const [nl] = await tx.insert(S.purchaseBillLine).values({ ...rest, purchaseBillId: rb.id }).returning({ id: S.purchaseBillLine.id });
      lineMap.set(oldId, nl.id);
    }
    const oterms = await tx.select().from(S.purchaseDocumentTerm).where(and(eq(S.purchaseDocumentTerm.documentType, "PURCHASE_BILL"), eq(S.purchaseDocumentTerm.documentId, orig.id)));
    for (const t of oterms) {
      const { id: _i, createdAt: _c, updatedAt: _u, documentId: _d, documentLineId, ...rest } = t;
      await tx.insert(S.purchaseDocumentTerm).values({ ...rest, documentId: rb.id, documentLineId: documentLineId ? lineMap.get(documentLineId)! : null });
    }

    if (orig.mainBillId) {
      const ml = await tx.select({ id: S.purchaseBillLine.id }).from(S.purchaseBillLine).where(eq(S.purchaseBillLine.purchaseBillId, orig.mainBillId));
      await recomputeLanded(tx, ml.map((l) => l.id));
    }
    return { reversalBillId: rb.id, invoiceNumber: number, reversalVoucherId: rjv, voucherNumber: rvNumber };
  });
}

// A starting point for a bill from a confirmed challan: its header, and a line for everything not yet billed.
// Nothing is saved; the user reviews it (rates, terms) and saves it with savePurchaseBill.
export function billInputFromChallan(challanId: number, opts: Opts = {}): Promise<PurchaseBillInput> {
  return inTx(opts.tx, async (tx) => {
    const [c] = await tx.select().from(S.purchaseChallan).where(eq(S.purchaseChallan.id, challanId));
    if (!c) throw new HttpError(404, "Purchase challan not found.");
    if (!c.isConfirmed) throw new HttpError(409, "Confirm the challan before billing it.");
    const cls = await tx.select().from(S.purchaseChallanLine).where(eq(S.purchaseChallanLine.purchaseChallanId, challanId)).orderBy(asc(S.purchaseChallanLine.lineNumber));
    const billed = await billedByChallanLine(tx, cls.map((l) => l.id));
    const lines: BillLineInput[] = [];
    for (const l of cls) {
      const left = pending(toMicro(l.qty), billed.get(l.id) ?? ZERO);
      if (left === ZERO) continue;
      lines.push({ productId: l.productId, particular: l.particular, qty: fmt(left), unitId: l.unitId, rate: l.rate, challanLineId: l.id, purchaseOrderLineId: l.purchaseOrderLineId, locationId: l.locationId, batchNo: l.batchNo, manufactureDate: l.manufactureDate, expiryDate: l.expiryDate });
    }
    if (!lines.length) throw new HttpError(409, "Everything on this challan has already been billed.");
    return {
      companyId: c.companyId, branchId: c.branchId, invoiceDate: today(), vendorGLId: c.vendorGLId, subLedgerId: c.subLedgerId, agentId: c.agentId,
      purchaseChallanId: c.id, purchaseOrderId: c.purchaseOrderId, vendorInvoiceNo: null, lines, terms: [],
    };
  });
}
