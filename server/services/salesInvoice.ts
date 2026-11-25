import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import * as S from "../db/schema";
import { HttpError } from "../routes/_util";
import { guardPeriod, type LockOverride } from "./periodLock";
import { numberForSave, usableSeries } from "./numberSeries";
import { type Actor, type Opts, addDays, assertBranch, assertDateOrder, inActorTx, inTx, optDate, parseDate, resolveFiscalYear, today } from "./purchase/common";
import { resolveLines, type LineInput } from "./purchase/lines";
import { fmt, mul, roundTo, toMicro, ZERO } from "./purchase/money";
import { cleanExport, EXPORT_COLUMNS, NO_EXPORT, type ExportInput } from "./salesExport";
import { assertMandatorySalesTerms, recalcSalesTerms, saveSalesTerms, type SalesTermInput } from "./salesInvoiceTerms";
import { mergeRows, writeVoucher, type JvRow } from "./voucherWriter";
import { assertGlEntryAllowed } from "./glEntryControl";
import { assertStockCovers, recordMovements, reverseMovements } from "./stockLedger";
import { assertLinesMatchSalesType, type SalesType } from "./salesTypes";
import { billedBySalesChallanLine } from "./salesChallan";

type SaveInput = {
  id?: number;
  companyId: number;
  branchId: number;
  invoiceNumber?: string;
  numberSeriesId?: number | null;
  invoiceDate: string | Date;
  invoiceType?: "LOCAL" | "EXPORT";
  salesType?: SalesType;
  fiscalYear?: string;
  customerGLId: number;
  subLedgerId?: number | null;
  agentId?: number | null;
  dueDays?: number;
  dueDate?: string | Date | null;
  remarks?: string | null;
  salesChallanId?: number | null; // bills this delivery note; its lines (challanLineId) take no stock out again
  lines: (LineInput & { foreignRate?: string | number | null; locationId?: number | null; batchNo?: string | null; expiryDate?: string | Date | null; challanLineId?: number | null })[];
  terms?: SalesTermInput[];
  exportDetail?: ExportInput | null; // EXPORT invoices only
};
type WriteOpts = Opts & { lockOverride?: LockOverride | null; reason?: string | null };
type InvoiceState = "DRAFT" | "POSTED" | "REVERSED" | "REVERSAL";
const iso = (d: Date | null | undefined) => d ? new Date(d).toISOString().slice(0, 10) : null;
const like = (s: string) => `%${s.replace(/[\\%_]/g, "\\$&")}%`;
const stateOf = (posted: boolean, reversalOfId: number | null, reversed: boolean): InvoiceState => reversalOfId ? "REVERSAL" : !posted ? "DRAFT" : reversed ? "REVERSED" : "POSTED";
const reversedSql = (id: unknown) => sql<boolean>`exists (select 1 from "SalesInvoice" r where r."reversalOfId" = ${id} and r."isPosted")`;

async function lockInvoice(tx: any, id: number) {
  const [invoice] = await tx.select().from(S.salesInvoice).where(eq(S.salesInvoice.id, id)).for("update");
  if (!invoice) throw new HttpError(404, "Sales invoice not found.");
  return invoice;
}

async function assertCustomerLedger(tx: any, companyId: number, glId: number, subLedgerId: number | null | undefined, requireSub = true) {
  const [gl] = await tx.select().from(S.generalLedger).where(and(eq(S.generalLedger.id, glId), eq(S.generalLedger.companyId, companyId)));
  if (!gl) throw new HttpError(404, "Customer ledger not found in this company.", "customerGLId");
  if (!gl.isActive) throw new HttpError(409, `Ledger ${gl.code} is not active.`, "customerGLId");
  if (!(["CUSTOMER", "BOTH"].includes(gl.glType) || gl.isCashOrBank)) throw new HttpError(400, `Ledger ${gl.code} is not marked as a customer or cash/bank ledger.`, "customerGLId");
  if (subLedgerId) {
    const [sub] = await tx.select().from(S.subLedger).where(and(eq(S.subLedger.id, subLedgerId), eq(S.subLedger.generalLedgerId, glId)));
    if (!sub || !sub.isActive) throw new HttpError(400, "That sub-ledger does not belong to the customer ledger or is inactive.", "subLedgerId");
  } else if (requireSub && gl.requiresSubLedger) {
    throw new HttpError(400, `Ledger ${gl.code} needs a sub-ledger.`, "subLedgerId");
  }
  return gl;
}

// An invoice that bills a challan: the challan must be confirmed and the customer's own, each billed line must be that challan's line
// for the same product, and nothing may be billed beyond what was delivered (standing invoices, drafts included, reserve their share).
async function assertChallanBilling(tx: any, a: { companyId: number; customerGLId: number; invoiceId: number; salesChallanId: number | null; lines: { lineNumber: number; productId: number; qty: string; challanLineId: number | null }[] }) {
  const linked = a.lines.filter((l) => l.challanLineId);
  if (!a.salesChallanId) {
    if (linked.length) throw new HttpError(400, "Lines refer to challan lines but the invoice has no challan.", "salesChallanId");
    return;
  }
  const [c] = await tx.select().from(S.salesChallan).where(and(eq(S.salesChallan.id, a.salesChallanId), eq(S.salesChallan.companyId, a.companyId)));
  if (!c) throw new HttpError(404, "Sales challan not found in this company.", "salesChallanId");
  if (!c.isConfirmed) throw new HttpError(409, `Challan ${c.challanNumber} is not confirmed; only delivered goods can be billed.`, "salesChallanId");
  if (c.customerGLId !== a.customerGLId) throw new HttpError(409, `Challan ${c.challanNumber} was made out to a different customer.`, "customerGLId");
  const ids = [...new Set(linked.map((l) => l.challanLineId as number))];
  if (!ids.length) return;
  const cls = await tx.select().from(S.salesChallanLine).where(and(eq(S.salesChallanLine.salesChallanId, c.id), inArray(S.salesChallanLine.id, ids)));
  const byId = new Map(cls.map((l: any) => [l.id, l]));
  const wanted = new Map<number, bigint>();
  for (const l of linked) {
    const cl: any = byId.get(l.challanLineId as number);
    if (!cl) throw new HttpError(409, `Line ${l.lineNumber}: that is not a line of challan ${c.challanNumber}.`, "lines");
    if (cl.productId !== l.productId) throw new HttpError(409, `Line ${l.lineNumber}: the product differs from challan line ${cl.lineNumber}.`, "lines");
    wanted.set(cl.id, (wanted.get(cl.id) ?? ZERO) + toMicro(l.qty));
  }
  const billed = await billedBySalesChallanLine(tx, ids, a.invoiceId);
  for (const [lineId, q] of wanted) {
    const cl: any = byId.get(lineId), already = billed.get(lineId) ?? ZERO, delivered = toMicro(cl.qty);
    if (already + q > delivered) throw new HttpError(409, `Challan ${c.challanNumber} line ${cl.lineNumber}: billing ${fmt(q)} would exceed the delivered ${fmt(delivered)} (already billed ${fmt(already)}).`, "lines");
  }
}

async function assertAgent(tx: any, companyId: number, agentId: number | null | undefined) {
  if (!agentId) return null;
  const [agent] = await tx.select({ id: S.agent.id, isActive: S.agent.isActive }).from(S.agent).where(and(eq(S.agent.id, agentId), eq(S.agent.companyId, companyId)));
  if (!agent) throw new HttpError(400, "Salesperson not found in this company.", "agentId");
  if (!agent.isActive) throw new HttpError(409, "Salesperson is not active.", "agentId");
  return agent;
}

async function salesLedgerOf(tx: any, companyId: number, productId: number, productType: string, code: string): Promise<number> {
  let gl: number | null | undefined;
  if (productType === "STOCK") gl = (await tx.select({ id: S.stockDetail.salesGLId }).from(S.stockDetail).where(eq(S.stockDetail.productId, productId)))[0]?.id;
  else if (productType === "NON_STOCK") gl = (await tx.select({ id: S.nonStockDetail.salesGLId }).from(S.nonStockDetail).where(eq(S.nonStockDetail.productId, productId)))[0]?.id;
  else if (productType === "SERVICE") gl = (await tx.select({ id: S.serviceDetail.salesGLId }).from(S.serviceDetail).where(eq(S.serviceDetail.productId, productId)))[0]?.id;
  if (!gl) throw new HttpError(409, `Product ${code} has no sales ledger set up, so it cannot be posted.`);
  const [ledger] = await tx.select({ id: S.generalLedger.id, companyId: S.generalLedger.companyId, isActive: S.generalLedger.isActive }).from(S.generalLedger).where(eq(S.generalLedger.id, gl));
  if (!ledger?.isActive || ledger.companyId !== companyId) throw new HttpError(409, `The sales ledger for product ${code} is not active in this company.`);
  return gl;
}

function voucherNumber(invoice: { id?: number; invoiceNumber: string; fiscalYear: string }) {
  const number = `SI-${invoice.fiscalYear}-${invoice.invoiceNumber}`;
  return number.length <= 30 ? number : `SI-${invoice.id ?? invoice.invoiceNumber.slice(-18)}`;
}

// Read-only form lookups: active customer/control ledgers, sub-ledgers, salesperson, sellable products, sales terms, years and series.
export function salesInvoiceLookups(companyId: number, branchId: number, userId: number | null, opts: { tx?: any } = {}) {
  return inTx(opts.tx, async (tx) => {
    const [customers, subLedgers, agents, products, locations, stock, nonStock, services, allUnits, alternateUnits, terms, fiscalYears, series] = await Promise.all([
      tx.select({ id: S.generalLedger.id, code: S.generalLedger.code, name: S.generalLedger.name, requiresSubLedger: S.generalLedger.requiresSubLedger, isCashOrBank: S.generalLedger.isCashOrBank, creditLimit: S.customerDetail.creditLimit, creditDays: S.customerDetail.creditDays })
        .from(S.generalLedger).leftJoin(S.party, eq(S.party.generalLedgerId, S.generalLedger.id)).leftJoin(S.customerDetail, eq(S.customerDetail.partyId, S.party.id)).where(and(eq(S.generalLedger.companyId, companyId), eq(S.generalLedger.isActive, true), or(inArray(S.generalLedger.glType, ["CUSTOMER", "BOTH"]), eq(S.generalLedger.isCashOrBank, true)))).orderBy(asc(S.generalLedger.code)),
      tx.select({ id: S.subLedger.id, code: S.subLedger.code, name: S.subLedger.name, generalLedgerId: S.subLedger.generalLedgerId })
        .from(S.subLedger).innerJoin(S.generalLedger, eq(S.generalLedger.id, S.subLedger.generalLedgerId))
        .where(and(eq(S.generalLedger.companyId, companyId), eq(S.generalLedger.isActive, true), eq(S.subLedger.isActive, true))).orderBy(asc(S.subLedger.code)),
      tx.select({ id: S.agent.id, code: S.agent.code, name: S.agent.name }).from(S.agent).where(and(eq(S.agent.companyId, companyId), eq(S.agent.isActive, true))).orderBy(asc(S.agent.code)),
      tx.select({ id: S.product.id, code: S.product.code, description: S.product.description, type: S.product.type }).from(S.product)
        .where(and(eq(S.product.companyId, companyId), eq(S.product.isActive, true), inArray(S.product.type, ["STOCK", "NON_STOCK", "SERVICE"]))).orderBy(asc(S.product.code)),
      tx.select({ id: S.location.id, code: S.location.code, name: S.location.name, isActive: S.location.isActive }).from(S.location).where(and(eq(S.location.companyId, companyId), eq(S.location.isActive, true))).orderBy(asc(S.location.code)),
      tx.select().from(S.stockDetail).innerJoin(S.product, eq(S.product.id, S.stockDetail.productId)).where(and(eq(S.product.companyId, companyId), eq(S.product.isActive, true))),
      tx.select().from(S.nonStockDetail).innerJoin(S.product, eq(S.product.id, S.nonStockDetail.productId)).where(and(eq(S.product.companyId, companyId), eq(S.product.isActive, true))),
      tx.select().from(S.serviceDetail).innerJoin(S.product, eq(S.product.id, S.serviceDetail.productId)).where(and(eq(S.product.companyId, companyId), eq(S.product.isActive, true))),
      tx.select({ id: S.productUnit.id, code: S.productUnit.code, name: S.productUnit.name, decimalPlaces: S.productUnit.decimalPlaces }).from(S.productUnit).where(and(eq(S.productUnit.companyId, companyId), eq(S.productUnit.isActive, true))).orderBy(asc(S.productUnit.code)),
      tx.select({ productId: S.stockDetail.productId, unitId: S.alternateUnit.unitId, conversionFactor: S.alternateUnit.conversionFactor, unitCode: S.productUnit.code })
        .from(S.alternateUnit).innerJoin(S.stockDetail, eq(S.stockDetail.id, S.alternateUnit.stockDetailId)).innerJoin(S.product, eq(S.product.id, S.stockDetail.productId))
        .innerJoin(S.productUnit, eq(S.productUnit.id, S.alternateUnit.unitId)).where(and(eq(S.product.companyId, companyId), eq(S.product.isActive, true))).orderBy(asc(S.productUnit.code)),
      tx.select({ id: S.salesTerm.id, code: S.salesTerm.code, name: S.salesTerm.name, category: S.salesTerm.category, nature: S.salesTerm.nature,
        isProductwise: S.salesTerm.isProductwise, isMandatory: S.salesTerm.isMandatory, isEditable: S.salesTerm.isEditable,
        defaultCalcType: S.salesTerm.defaultCalcType, defaultValue: S.salesTerm.defaultValue, calcBase: S.salesTerm.calcBase,
        baseTermId: S.salesTerm.baseTermId, sequence: S.salesTerm.sequence, generalLedgerId: S.salesTerm.generalLedgerId, roundingMethod: S.salesTerm.roundingMethod })
        .from(S.salesTerm).where(and(eq(S.salesTerm.companyId, companyId), eq(S.salesTerm.isActive, true))).orderBy(asc(S.salesTerm.sequence), asc(S.salesTerm.code)),
      tx.select({ id: S.fiscalYear.id, code: S.fiscalYear.code, startDate: S.fiscalYear.startDate, endDate: S.fiscalYear.endDate, isCurrent: S.fiscalYear.isCurrent, isClosed: S.fiscalYear.isClosed })
        .from(S.fiscalYear).where(and(eq(S.fiscalYear.companyId, companyId), eq(S.fiscalYear.isActive, true))).orderBy(desc(S.fiscalYear.startDate)),
      usableSeries(tx, companyId, "SALES_INVOICE", userId, branchId),
    ]);
    const unitById = new Map(allUnits.map((u: any) => [u.id, u.code]));
    const stockByProduct = new Map(stock.map((r: any) => [r.StockDetail.productId, r.StockDetail]));
    const nonStockByProduct = new Map(nonStock.map((r: any) => [r.NonStockDetail.productId, r.NonStockDetail]));
    const serviceByProduct = new Map(services.map((r: any) => [r.ServiceDetail.productId, r.ServiceDetail]));
    const altsByProduct = new Map<number, { unitId: number; unitCode: string; conversionFactor: string }[]>();
    for (const alt of alternateUnits) altsByProduct.set(alt.productId, [...(altsByProduct.get(alt.productId) ?? []), { unitId: alt.unitId, unitCode: alt.unitCode, conversionFactor: String(alt.conversionFactor) }]);
    const sellable = products.map((p: any) => {
      const detail = p.type === "STOCK" ? stockByProduct.get(p.id) : p.type === "NON_STOCK" ? nonStockByProduct.get(p.id) : serviceByProduct.get(p.id);
      const unitId = p.type === "STOCK" ? detail?.baseUnitId : detail?.unitId ?? null;
      return {
        id: p.id, code: p.code, description: p.description, type: p.type,
        unitId: unitId ?? null, unitCode: unitId ? unitById.get(unitId) ?? "" : "",
        salesRate: p.type === "STOCK" ? detail?.salesRate ?? null : null,
        salesGLId: detail?.salesGLId ?? null,
        alternateUnits: p.type === "STOCK" ? altsByProduct.get(p.id) ?? [] : [],
        tracksBatch: p.type === "STOCK" ? !!detail?.tracksBatch : false, tracksExpiry: p.type === "STOCK" ? !!detail?.tracksExpiry : false, defaultLocationId: p.type === "STOCK" ? detail?.defaultLocationId ?? null : null,
      };
    });
    return {
      customers, subLedgers, agents, locations, products: sellable.filter((p: any) => p.unitId), units: allUnits, terms, fiscalYears: fiscalYears.map((f: any) => ({ ...f, startDate: iso(f.startDate), endDate: iso(f.endDate) })),
      series: series.map((s) => ({ id: s.id, name: s.name, mode: s.mode, isDefault: s.isDefault })),
    };
  });
}

export type SalesListFilter = { companyId: number; branchId?: number; fiscalYear?: string; status?: string; search?: string; limit?: number; customerGLId?: number; tx?: any };
export async function listSalesInvoices(f: SalesListFilter) {
  const I = S.salesInvoice, G = S.generalLedger;
  const where: any[] = [eq(I.companyId, f.companyId)];
  if (f.branchId) where.push(eq(I.branchId, f.branchId));
  if (f.fiscalYear) where.push(eq(I.fiscalYear, f.fiscalYear));
  if (f.customerGLId) where.push(eq(I.customerGLId, f.customerGLId));
  if (f.status) {
    const states: InvoiceState[] = ["DRAFT", "POSTED", "REVERSED", "REVERSAL"];
    if (!states.includes(f.status as InvoiceState)) throw new HttpError(400, `Unknown invoice status ${f.status}.`, "status");
    const isReversed = reversedSql(I.id);
    where.push(f.status === "REVERSAL" ? sql`${I.reversalOfId} is not null`
      : f.status === "DRAFT" ? sql`${I.reversalOfId} is null and not ${I.isPosted}`
      : f.status === "POSTED" ? sql`${I.reversalOfId} is null and ${I.isPosted} and not ${isReversed}`
      : sql`${I.reversalOfId} is null and ${I.isPosted} and ${isReversed}`);
  }
  if (f.search?.trim()) {
    const s = like(f.search.trim());
    where.push(or(ilike(I.invoiceNumber, s), ilike(G.name, s), ilike(G.code, s)));
  }
  return inTx(f.tx, async (tx) => {
    const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(I).innerJoin(G, eq(G.id, I.customerGLId)).where(and(...where));
    const rows = await tx.select({ id: I.id, branchId: I.branchId, invoiceNumber: I.invoiceNumber, invoiceDate: I.invoiceDate, fiscalYear: I.fiscalYear, invoiceType: I.invoiceType, salesType: I.salesType,
      customerGLId: I.customerGLId, customerCode: G.code, customerName: G.name, dueDate: I.dueDate, isPosted: I.isPosted,
      reversalOfId: I.reversalOfId, reversed: reversedSql(I.id), basicAmount: I.basicAmount, termAmount: I.termAmount, totalAmount: I.totalAmount })
      .from(I).innerJoin(G, eq(G.id, I.customerGLId)).where(and(...where)).orderBy(desc(I.invoiceDate), desc(I.id)).limit(Math.max(1, Math.min(f.limit ?? 100, 500)));
    return { total: count, rows: rows.map(({ reversed, ...r }: any) => ({ ...r, invoiceDate: iso(r.invoiceDate), dueDate: iso(r.dueDate), state: stateOf(r.isPosted, r.reversalOfId, reversed) })) };
  });
}

export function getSalesInvoice(id: number, companyId: number) {
  return inTx(undefined, async (tx) => {
    const I = S.salesInvoice;
    const [invoice] = await tx.select().from(I).where(and(eq(I.id, id), eq(I.companyId, companyId)));
    if (!invoice) throw new HttpError(404, "Sales invoice not found.");
    const [customer, sub, agent, voucher, reversedBy, reversalOf, lines, terms] = await Promise.all([
      tx.select({ code: S.generalLedger.code, name: S.generalLedger.name }).from(S.generalLedger).where(eq(S.generalLedger.id, invoice.customerGLId)),
      invoice.subLedgerId ? tx.select({ code: S.subLedger.code, name: S.subLedger.name }).from(S.subLedger).where(eq(S.subLedger.id, invoice.subLedgerId)) : Promise.resolve([]),
      invoice.agentId ? tx.select({ code: S.agent.code, name: S.agent.name }).from(S.agent).where(eq(S.agent.id, invoice.agentId)) : Promise.resolve([]),
      invoice.journalVoucherId ? tx.select({ id: S.journalVoucher.id, voucherNumber: S.journalVoucher.voucherNumber, voucherDate: S.journalVoucher.voucherDate }).from(S.journalVoucher).where(eq(S.journalVoucher.id, invoice.journalVoucherId)) : Promise.resolve([]),
      tx.select({ id: I.id, invoiceNumber: I.invoiceNumber }).from(I).where(and(eq(I.reversalOfId, id), eq(I.isPosted, true))),
      invoice.reversalOfId ? tx.select({ id: I.id, invoiceNumber: I.invoiceNumber }).from(I).where(eq(I.id, invoice.reversalOfId)) : Promise.resolve([]),
      tx.select().from(S.salesInvoiceLine).where(eq(S.salesInvoiceLine.salesInvoiceId, id)).orderBy(asc(S.salesInvoiceLine.lineNumber)),
      tx.select({ term: S.salesDocumentTerm, termName: S.salesTerm.name, termCode: S.salesTerm.code }).from(S.salesDocumentTerm)
        .leftJoin(S.salesTerm, eq(S.salesTerm.id, S.salesDocumentTerm.termId)).where(and(eq(S.salesDocumentTerm.documentType, "SALES_INVOICE"), eq(S.salesDocumentTerm.documentId, id))).orderBy(asc(S.salesDocumentTerm.sequence), asc(S.salesDocumentTerm.id)),
    ]);
    const productIds = [...new Set(lines.map((l: any) => l.productId))];
    const unitIds = [...new Set(lines.flatMap((l: any) => [l.unitId, l.altUnitId].filter(Boolean)))];
    const [products, units] = await Promise.all([
      productIds.length ? tx.select({ id: S.product.id, code: S.product.code, description: S.product.description, type: S.product.type }).from(S.product).where(inArray(S.product.id, productIds)) : Promise.resolve([]),
      unitIds.length ? tx.select({ id: S.productUnit.id, code: S.productUnit.code }).from(S.productUnit).where(inArray(S.productUnit.id, unitIds)) : Promise.resolve([]),
    ]);
    const productBy = new Map(products.map((p: any) => [p.id, p]));
    const unitBy = new Map(units.map((u: any) => [u.id, u.code]));
    const lineNoById = new Map(lines.map((l: any) => [l.id, l.lineNumber]));
    const reversed = reversedBy.length > 0;
    return {
      id: invoice.id, companyId: invoice.companyId, branchId: invoice.branchId, invoiceNumber: invoice.invoiceNumber, numberSeriesId: invoice.numberSeriesId,
      invoiceDate: iso(invoice.invoiceDate), fiscalYear: invoice.fiscalYear, invoiceType: invoice.invoiceType, salesType: invoice.salesType, customerGLId: invoice.customerGLId, customerCode: customer[0]?.code ?? "", customerName: customer[0]?.name ?? "",
      subLedgerId: invoice.subLedgerId, subLedgerCode: sub[0]?.code ?? null, subLedgerName: sub[0]?.name ?? null, agentId: invoice.agentId, agentCode: agent[0]?.code ?? null, agentName: agent[0]?.name ?? null,
      exportDetail: invoice.invoiceType === "EXPORT" ? Object.fromEntries(EXPORT_COLUMNS.map((k) => { const v = (invoice as any)[k]; return [k, v instanceof Date ? iso(v) : v ?? null]; })) : null,
      salesChallanId: invoice.salesChallanId, dueDays: invoice.dueDays, dueDate: iso(invoice.dueDate), remarks: invoice.remarks, isPosted: invoice.isPosted, postedAt: invoice.postedAt,
      reversalOfId: invoice.reversalOfId, reversalOf: reversalOf[0] ?? null, reversedBy: reversedBy[0] ?? null, state: stateOf(invoice.isPosted, invoice.reversalOfId, reversed),
      journalVoucher: voucher[0] ? { ...voucher[0], voucherDate: iso(voucher[0].voucherDate) } : null,
      basicAmount: String(invoice.basicAmount), termAmount: String(invoice.termAmount), totalAmount: String(invoice.totalAmount),
      lines: lines.map((l: any) => ({ ...l, product: productBy.get(l.productId), unitCode: unitBy.get(l.unitId) ?? "", altUnitCode: l.altUnitId ? unitBy.get(l.altUnitId) ?? "" : null, basicAmount: String(l.basicAmount), lineNumber: l.lineNumber })),
      terms: terms.map(({ term, termName, termCode }: any) => ({ ...term, termName, termCode, lineNumber: term.documentLineId ? lineNoById.get(term.documentLineId) ?? null : null,
        rate: term.rate === null ? null : String(term.rate), inputAmount: term.inputAmount === null ? null : String(term.inputAmount), baseAmount: String(term.baseAmount), calculatedAmount: String(term.calculatedAmount), finalAmount: String(term.finalAmount) })),
    };
  });
}

export async function saveSalesInvoice(input: SaveInput, actor: Actor, opts: WriteOpts = {}) {
  if (!Array.isArray(input.lines) || !input.lines.length || input.lines.length > 500) throw new HttpError(400, "Enter at least one sales line (up to 500).", "lines");
  const invoiceDate = parseDate(input.invoiceDate, "invoiceDate");
  const dueDays = input.dueDays === undefined ? 0 : Number(input.dueDays);
  if (!Number.isInteger(dueDays) || dueDays < 0 || dueDays > 3650) throw new HttpError(400, "Due days must be a whole number from 0 to 3650.", "dueDays");
  const dueDate = input.dueDate ? optDate(input.dueDate, "dueDate") : (dueDays ? addDays(invoiceDate, dueDays) : null);
  assertDateOrder(invoiceDate, dueDate, "Due date cannot be before the invoice date.", "dueDate");
  const invoiceType = input.invoiceType ?? "LOCAL";
  if (invoiceType !== "LOCAL" && invoiceType !== "EXPORT") throw new HttpError(400, "Invoice type must be Local or Export.", "invoiceType");
  const salesType = input.salesType ?? "GOODS_SALES";
  if (salesType !== "GOODS_SALES" && salesType !== "SERVICE_SALES") throw new HttpError(400, "Sales type must be Goods sales or Service sales.", "salesType");
  const remarks = input.remarks?.trim() || null;
  if (remarks && remarks.length > 1024) throw new HttpError(400, "Remarks can be up to 1024 characters.", "remarks");
  return inActorTx({ ...actor, reason: opts.reason }, opts.tx, async (tx) => {
    let existing: Awaited<ReturnType<typeof lockInvoice>> | null = null;
    if (input.id) {
      existing = await lockInvoice(tx, input.id);
      if (existing.companyId !== input.companyId) throw new HttpError(404, "Sales invoice not found in this company.");
      if (existing.isPosted || existing.reversalOfId) throw new HttpError(409, "Posted invoices cannot be edited. Reverse this invoice and create a corrected draft instead.");
      await guardPeriod(tx, existing.companyId, [existing.invoiceDate, invoiceDate], opts.lockOverride);
    } else await guardPeriod(tx, input.companyId, [invoiceDate], opts.lockOverride);
    await assertBranch(tx, input.companyId, input.branchId);
    const customerGL = Number(input.customerGLId);
    if (!Number.isInteger(customerGL) || customerGL <= 0) throw new HttpError(400, "Choose a customer ledger.", "customerGLId");
    const subLedgerId = input.subLedgerId ? Number(input.subLedgerId) : null;
    const gl = await assertCustomerLedger(tx, input.companyId, customerGL, subLedgerId);
    const agentId = input.agentId ? Number(input.agentId) : null;
    await assertAgent(tx, input.companyId, agentId);
    const fy = await resolveFiscalYear(tx, input.companyId, invoiceDate, input.fiscalYear);
    // export block: stored only on an EXPORT invoice. In a foreign currency each line is typed with a foreignRate and priced in NPR.
    const hasExportData = !!input.exportDetail && Object.values(input.exportDetail).some((v) => v !== null && v !== undefined && String(v).trim() !== "");
    if (invoiceType === "LOCAL" && hasExportData) throw new HttpError(400, "Export details belong on an EXPORT invoice.", "exportDetail");
    const ex = invoiceType === "EXPORT" ? cleanExport(input.exportDetail) : { cols: { ...NO_EXPORT }, currency: null, rate: null as bigint | null };
    const lineInputs = input.lines.map((l, i) => {
      if (ex.rate === null) return { ...l, foreignRate: null };
      const fr = l.foreignRate === null || l.foreignRate === undefined || String(l.foreignRate).trim() === "" ? null : toMicro(l.foreignRate);
      if (fr === null || fr < ZERO) throw new HttpError(400, `Line ${i + 1}: enter the rate in ${ex.currency}.`, "lines");
      return { ...l, foreignRate: fr, rate: fmt(mul(fr, ex.rate)) };
    });
    const prepared = await resolveLines(tx, input.companyId, lineInputs, { allowZeroQty: false });
    if (prepared.some((l) => l.productType === "FIXED_ASSET" || l.productType === "BUNDLE")) throw new HttpError(400, "Direct sales invoices support stock, non-stock and service items only.", "lines");
    assertLinesMatchSalesType(salesType, prepared);
    const salesChallanId = input.salesChallanId ? Number(input.salesChallanId) : null;
    await assertChallanBilling(tx, { companyId: input.companyId, customerGLId: customerGL, invoiceId: existing?.id ?? 0, salesChallanId,
      lines: prepared.map((l, i) => ({ lineNumber: l.lineNumber, productId: l.productId, qty: fmt(l.qty), challanLineId: input.lines[i].challanLineId ? Number(input.lines[i].challanLineId) : null })) });
    const numbering = await numberForSave(tx, {
      companyId: input.companyId, userId: actor.userId, documentType: "SALES_INVOICE", seriesId: input.numberSeriesId,
      typed: input.invoiceNumber, branchId: input.branchId, fiscalYear: fy.code,
      existing: existing ? { number: existing.invoiceNumber, numberSeriesId: existing.numberSeriesId } : null,
    });
    let id = existing?.id ?? 0;
    const values = {
      companyId: input.companyId, branchId: input.branchId, documentType: "SALES_INVOICE" as const,
      invoiceNumber: numbering.number, numberSeriesId: numbering.seriesId, invoiceDate, fiscalYear: fy.code, invoiceType, salesType, ...ex.cols,
      customerGLId: customerGL, subLedgerId, agentId, dueDays, dueDate, remarks, salesChallanId, ...ex.cols,
    };
    if (existing) {
      await tx.update(S.salesInvoice).set({ ...values, updatedAt: new Date() }).where(eq(S.salesInvoice.id, existing.id));
      await tx.delete(S.salesInvoiceLine).where(eq(S.salesInvoiceLine.salesInvoiceId, existing.id));
    } else {
      const [created] = await tx.insert(S.salesInvoice).values({ ...values, createdBy: actor.userId }).returning({ id: S.salesInvoice.id });
      id = created.id;
    }
    const lineIdByNumber = new Map<number, number>();
    let foreignTotal = ZERO;
    for (const [i, line] of prepared.entries()) {
      const fr = lineInputs[i].foreignRate as bigint | null;
      if (fr !== null) foreignTotal += roundTo(mul(line.qty, fr), 2);
      const [created] = await tx.insert(S.salesInvoiceLine).values({
        salesInvoiceId: id, lineNumber: line.lineNumber, productId: line.productId, altQty: line.altQty === null ? null : fmt(line.altQty),
        altUnitId: line.altUnitId, qty: fmt(line.qty), unitId: line.unitId, rate: fmt(line.rate), basicAmount: fmt(line.basicAmount),
        foreignRate: fr === null ? null : fmt(fr), foreignAmount: fr === null ? null : fmt(roundTo(mul(line.qty, fr), 2)),
        locationId: input.lines[i].locationId ?? null, batchNo: input.lines[i].batchNo?.trim() || null, expiryDate: optDate(input.lines[i].expiryDate, "expiryDate"),
        challanLineId: input.lines[i].challanLineId ? Number(input.lines[i].challanLineId) : null,
      }).returning({ id: S.salesInvoiceLine.id, lineNumber: S.salesInvoiceLine.lineNumber });
      lineIdByNumber.set(created.lineNumber, created.id);
    }
    await saveSalesTerms(tx, { companyId: input.companyId, docId: id }, input.terms ?? [], lineIdByNumber);
    if (ex.rate !== null) await tx.update(S.salesInvoice).set({ exportForeignTotal: fmt(foreignTotal) }).where(eq(S.salesInvoice.id, id));
    const totals = await recalcSalesTerms(tx, id);
    if (totals.total < ZERO) throw new HttpError(400, "Sales invoice total cannot be negative.", "terms");
    await tx.update(S.salesInvoice).set({ basicAmount: fmt(totals.itemTotal), termAmount: fmt(totals.termNet), totalAmount: fmt(totals.total), updatedAt: new Date() }).where(eq(S.salesInvoice.id, id));
    return { id, invoiceNumber: numbering.number, fiscalYear: fy.code, customerGLId: gl.id, basicAmount: fmt(totals.itemTotal, 2), termAmount: fmt(totals.termNet, 2), totalAmount: fmt(totals.total, 2), dueDate: iso(dueDate) };
  });
}

export function postSalesInvoice(id: number, actor: Actor, opts: WriteOpts = {}) {
  return inActorTx({ ...actor, reason: opts.reason }, opts.tx, async (tx) => {
    const invoice = await lockInvoice(tx, id);
    if (invoice.isPosted) throw new HttpError(409, "Sales invoice is already posted.");
    if (invoice.reversalOfId) throw new HttpError(409, "A reversal invoice cannot be posted again.");
    await guardPeriod(tx, invoice.companyId, [invoice.invoiceDate], opts.lockOverride);
    await resolveFiscalYear(tx, invoice.companyId, invoice.invoiceDate, invoice.fiscalYear);
    await assertCustomerLedger(tx, invoice.companyId, invoice.customerGLId, invoice.subLedgerId);
    await assertAgent(tx, invoice.companyId, invoice.agentId);
    const lines = await tx.select({ line: S.salesInvoiceLine, code: S.product.code, type: S.product.type, isActive: S.product.isActive }).from(S.salesInvoiceLine)
      .innerJoin(S.product, eq(S.product.id, S.salesInvoiceLine.productId)).where(eq(S.salesInvoiceLine.salesInvoiceId, id)).orderBy(asc(S.salesInvoiceLine.lineNumber));
    if (!lines.length) throw new HttpError(409, "Add at least one sales line before posting.");
    const totals = await recalcSalesTerms(tx, id);
    if (totals.total <= ZERO) throw new HttpError(409, "A posted sales invoice must have a positive total.");
    await assertMandatorySalesTerms(tx, invoice.companyId, id);
    await assertChallanBilling(tx, { companyId: invoice.companyId, customerGLId: invoice.customerGLId, invoiceId: id, salesChallanId: invoice.salesChallanId,
      lines: lines.map(({ line }) => ({ lineNumber: line.lineNumber, productId: line.productId, qty: line.qty, challanLineId: line.challanLineId })) });
    // Lines that bill a challan: that stock already left on the challan, so only the other lines take stock out here.
    const ownStock = lines.filter((l) => !l.line.challanLineId);
    // stock products: batch / expiry where the product tracks them, and the stock must cover what the invoice takes out
    for (const { line, type } of ownStock) {
      if (type !== "STOCK") continue;
      const [sd] = await tx.select({ tracksBatch: S.stockDetail.tracksBatch, tracksExpiry: S.stockDetail.tracksExpiry }).from(S.stockDetail).where(eq(S.stockDetail.productId, line.productId));
      if (sd?.tracksBatch && !line.batchNo) throw new HttpError(409, `Line ${line.lineNumber}: this product is batch-tracked; choose the batch it is sold from.`, "lines");
      if (sd?.tracksExpiry && !line.expiryDate) throw new HttpError(409, `Line ${line.lineNumber}: this product expires; enter the expiry date of the batch.`, "lines");
    }
    await assertStockCovers(tx, { companyId: invoice.companyId, branchId: invoice.branchId }, ownStock.map((l) => l.line));
    const rows: JvRow[] = [];
    for (const { line, code, type, isActive } of lines) {
      if (!isActive) throw new HttpError(409, `Product ${code} is inactive and cannot be posted.`);
      if (!line.qty || toMicro(line.qty) <= ZERO) throw new HttpError(409, `Sales line ${line.lineNumber} needs a positive quantity.`);
      const amount = toMicro(line.basicAmount);
      if (amount !== ZERO) rows.push({ generalLedgerId: await salesLedgerOf(tx, invoice.companyId, line.productId, type, code), debit: ZERO, credit: amount, narration: `Sales ${invoice.invoiceNumber}`, agentId: invoice.agentId });
    }
    const termRows = await tx.select({ row: S.salesDocumentTerm, code: S.salesTerm.code, name: S.salesTerm.name, masterGL: S.salesTerm.generalLedgerId }).from(S.salesDocumentTerm)
      .innerJoin(S.salesTerm, eq(S.salesTerm.id, S.salesDocumentTerm.termId))
      .where(and(eq(S.salesDocumentTerm.documentType, "SALES_INVOICE"), eq(S.salesDocumentTerm.documentId, id)));
    for (const { row, code, name, masterGL } of termRows) {
      const amount = toMicro(row.finalAmount);
      if (amount === ZERO) continue;
      // The term's ledger as it is NOW (a draft saved before the master was corrected must not post to the old one); the document's copy follows.
      const glId = masterGL ?? row.generalLedgerId;
      if (!glId) throw new HttpError(409, `Term ${code} (${name}) has no ledger, so it cannot be posted.`);
      if (row.generalLedgerId !== glId) await tx.update(S.salesDocumentTerm).set({ generalLedgerId: glId }).where(eq(S.salesDocumentTerm.id, row.id));
      const [ledger] = await tx.select({ isActive: S.generalLedger.isActive, companyId: S.generalLedger.companyId }).from(S.generalLedger).where(eq(S.generalLedger.id, glId));
      if (!ledger || ledger.companyId !== invoice.companyId || !ledger.isActive) throw new HttpError(409, `Term ${code} (${name}) has no active ledger in this company.`);
      rows.push(row.nature === "ADDITIVE"
        ? { generalLedgerId: glId, debit: ZERO, credit: amount, narration: `${name} ${invoice.invoiceNumber}` }
        : { generalLedgerId: glId, debit: amount, credit: ZERO, narration: `${name} ${invoice.invoiceNumber}` });
    }
    rows.push({ generalLedgerId: invoice.customerGLId, subLedgerId: invoice.subLedgerId, debit: totals.total, credit: ZERO, narration: `Sales invoice ${invoice.invoiceNumber}`, agentId: invoice.agentId });
    const journalRows = mergeRows(rows);
    await assertGlEntryAllowed(tx, invoice.companyId, journalRows.map((row) => row.generalLedgerId), "SALES_INVOICE");
    const debit = journalRows.reduce((sum, row) => sum + row.debit, ZERO);
    const credit = journalRows.reduce((sum, row) => sum + row.credit, ZERO);
    if (debit !== credit) throw new HttpError(500, `Sales journal does not balance (Dr ${fmt(debit, 2)} / Cr ${fmt(credit, 2)}). Nothing was posted.`);
    if (journalRows.length < 2) throw new HttpError(409, "The invoice does not produce a complete journal entry.");
    const journalVoucherId = await writeVoucher(tx, {
      companyId: invoice.companyId, branchId: invoice.branchId, voucherNumber: voucherNumber(invoice), voucherDate: invoice.invoiceDate,
      fiscalYear: invoice.fiscalYear, remarks: `Sales invoice ${invoice.invoiceNumber}`, reversalOfId: null,
    }, journalRows, actor);
    await tx.update(S.salesInvoice).set({ isPosted: true, postedAt: new Date(), postedBy: actor.userId, journalVoucherId, updatedAt: new Date() }).where(eq(S.salesInvoice.id, id));
    await recordMovements(tx, { companyId: invoice.companyId, branchId: invoice.branchId, date: invoice.invoiceDate, source: "SALES_INVOICE", sourceId: id, direction: "OUT" }, ownStock.map((l) => l.line));
    return { id, invoiceNumber: invoice.invoiceNumber, journalVoucherId, totalAmount: fmt(totals.total, 2) };
  });
}

export function deleteDraftSalesInvoice(id: number, companyId: number, actor: Actor, opts: WriteOpts = {}) {
  return inActorTx({ ...actor, reason: opts.reason }, opts.tx, async (tx) => {
    const invoice = await lockInvoice(tx, id);
    if (invoice.companyId !== companyId) throw new HttpError(404, "Sales invoice not found in this company.");
    if (invoice.isPosted || invoice.reversalOfId) throw new HttpError(409, "Only a draft sales invoice can be deleted. Reverse a posted invoice instead.");
    await guardPeriod(tx, invoice.companyId, [invoice.invoiceDate], opts.lockOverride);
    await tx.delete(S.salesDocumentTerm).where(and(eq(S.salesDocumentTerm.documentType, "SALES_INVOICE"), eq(S.salesDocumentTerm.documentId, id)));
    await tx.delete(S.salesInvoice).where(eq(S.salesInvoice.id, id));
    return { id, deleted: true };
  });
}

export function reverseSalesInvoice(id: number, actor: Actor, opts: WriteOpts & { date?: string | Date } = {}) {
  const reason = opts.reason?.trim();
  if (!reason || reason.length < 3) throw new HttpError(400, "Give a reason (at least 3 characters) for reversing this invoice.", "reason");
  return inActorTx({ ...actor, reason }, opts.tx, async (tx) => {
    const original = await lockInvoice(tx, id);
    if (!original.isPosted || original.reversalOfId) throw new HttpError(409, "Only an unreversed, posted invoice can be reversed.");
    const [already] = await tx.select({ id: S.salesInvoice.id }).from(S.salesInvoice).where(and(eq(S.salesInvoice.reversalOfId, id), eq(S.salesInvoice.isPosted, true)));
    if (already) throw new HttpError(409, "This invoice has already been reversed.");
    const date = parseDate(opts.date ?? today(), "date");
    await guardPeriod(tx, original.companyId, [date], opts.lockOverride);
    const fy = await resolveFiscalYear(tx, original.companyId, date, null);
    const originalLines = await tx.select().from(S.salesInvoiceLine).where(eq(S.salesInvoiceLine.salesInvoiceId, id)).orderBy(asc(S.salesInvoiceLine.lineNumber));
    const originalTerms = await tx.select().from(S.salesDocumentTerm).where(and(eq(S.salesDocumentTerm.documentType, "SALES_INVOICE"), eq(S.salesDocumentTerm.documentId, id))).orderBy(asc(S.salesDocumentTerm.id));
    const oldVoucher = original.journalVoucherId ? (await tx.select().from(S.journalVoucher).where(eq(S.journalVoucher.id, original.journalVoucherId)))[0] : null;
    if (!oldVoucher) throw new HttpError(409, "The original invoice is missing its journal voucher and cannot be reversed.");
    const oldVoucherLines = await tx.select().from(S.journalVoucherLine).where(eq(S.journalVoucherLine.journalVoucherId, oldVoucher.id)).orderBy(asc(S.journalVoucherLine.lineNumber));
    if (!oldVoucherLines.length) throw new HttpError(409, "The original journal voucher has no lines and cannot be reversed.");
    await assertGlEntryAllowed(tx, original.companyId, oldVoucherLines.map((row) => row.generalLedgerId), "SALES_INVOICE");
    const swapped: JvRow[] = oldVoucherLines.map((row) => ({
      generalLedgerId: row.generalLedgerId, subLedgerId: row.subLedgerId, debit: toMicro(row.credit), credit: toMicro(row.debit),
      narration: `Reversal: ${row.narration ?? ""}`.slice(0, 500), agentId: row.agentId,
    }));
    const reverseVoucherNumber = `R-${oldVoucher.voucherNumber}`.length <= 30 ? `R-${oldVoucher.voucherNumber}` : `RSI-${oldVoucher.id}`;
    const journalVoucherId = await writeVoucher(tx, {
      companyId: original.companyId, branchId: original.branchId, voucherNumber: reverseVoucherNumber, voucherDate: date,
      fiscalYear: fy.code, remarks: `Reversal of sales invoice ${original.invoiceNumber}: ${reason}`.slice(0, 1024), reversalOfId: oldVoucher.id,
    }, swapped, actor);
    let invoiceNumber = `R-${original.invoiceNumber}`.slice(0, 30);
    let suffix = 1;
    while ((await tx.select({ id: S.salesInvoice.id }).from(S.salesInvoice).where(and(eq(S.salesInvoice.branchId, original.branchId), eq(S.salesInvoice.fiscalYear, fy.code), eq(S.salesInvoice.invoiceNumber, invoiceNumber)))).length) {
      invoiceNumber = `R${++suffix}-${original.invoiceNumber}`.slice(0, 30);
    }
    const [reversal] = await tx.insert(S.salesInvoice).values({
      companyId: original.companyId, branchId: original.branchId, documentType: "SALES_INVOICE", invoiceNumber, numberSeriesId: null,
      invoiceDate: date, fiscalYear: fy.code, invoiceType: original.invoiceType, salesType: original.salesType, ...Object.fromEntries(EXPORT_COLUMNS.map((k) => [k, original[k]])), customerGLId: original.customerGLId, subLedgerId: original.subLedgerId, agentId: original.agentId,
      dueDays: 0, dueDate: null, basicAmount: original.basicAmount, termAmount: original.termAmount, totalAmount: original.totalAmount,
      remarks: `Reversal of ${original.invoiceNumber}: ${reason}`.slice(0, 1024), reversalOfId: original.id, journalVoucherId,
      isPosted: true, postedAt: new Date(), postedBy: actor.userId, createdBy: actor.userId,
    }).returning({ id: S.salesInvoice.id });
    const newLineByOld = new Map<number, number>();
    for (const line of originalLines) {
      const [created] = await tx.insert(S.salesInvoiceLine).values({
        salesInvoiceId: reversal.id, lineNumber: line.lineNumber, productId: line.productId, altQty: line.altQty, altUnitId: line.altUnitId,
        qty: line.qty, unitId: line.unitId, rate: line.rate, basicAmount: line.basicAmount, foreignRate: line.foreignRate, foreignAmount: line.foreignAmount,
        locationId: line.locationId, batchNo: line.batchNo, expiryDate: line.expiryDate,
      }).returning({ id: S.salesInvoiceLine.id });
      newLineByOld.set(line.id, created.id);
    }
    // the goods the invoice took out of stock come back
    await reverseMovements(tx, { source: "SALES_INVOICE", originalSourceId: original.id, newSourceId: reversal.id, date }, newLineByOld);
    for (const term of originalTerms) {
      await tx.insert(S.salesDocumentTerm).values({
        companyId: original.companyId, documentType: "SALES_INVOICE", documentId: reversal.id,
        documentLineId: term.documentLineId ? newLineByOld.get(term.documentLineId) ?? null : null, termId: term.termId,
        sequence: term.sequence, nature: term.nature, calcBase: term.calcBase, generalLedgerId: term.generalLedgerId,
        calcType: term.calcType, rate: term.rate, inputAmount: term.inputAmount, baseAmount: term.baseAmount,
        calculatedAmount: term.calculatedAmount, isOverridden: term.isOverridden, finalAmount: term.finalAmount,
      });
    }
    return { id: reversal.id, invoiceNumber, journalVoucherId, reversalOfId: original.id, date: iso(date), reason };
  });
}
