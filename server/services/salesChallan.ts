import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import * as S from "../db/schema";
import { HttpError } from "../routes/_util";
import { numberForSave } from "./numberSeries";
import { type Actor, type Opts, type Tx, assertBranch, inActorTx, inTx, optDate, parseDate, resolveFiscalYear } from "./purchase/common";
import { resolveLines, type LineInput } from "./purchase/lines";
import { ZERO, fmt, toMicro, type Micro } from "./purchase/money";
import { assertStockCovers, recordMovements } from "./stockLedger";
import { assertMandatory, entryControlsOf, ruleOutcome } from "./entryControl";

// SALES CHALLAN (delivery note). Posts nothing to the ledger; the accounting happens when an invoice bills it.
//   draft ──confirm──▶ confirmed (goods are out; the challan is now immutable)
// Confirming checks the stock covers the goods, then takes it out (one StockMovement OUT per stock line).

export type SalesChallanLineInput = LineInput & { locationId?: number | null; batchNo?: string | null; expiryDate?: string | Date | null };
export type SalesChallanInput = {
  id?: number; companyId: number; branchId: number; challanNumber?: string; challanDate: string | Date; fiscalYear?: string;
  numberSeriesId?: number | null; customerGLId: number; subLedgerId?: number | null; agentId?: number | null;
  transporterName?: string | null; vehicleNo?: string | null; lrNo?: string | null; lrDate?: string | Date | null; remarks?: string | null;
  lines: SalesChallanLineInput[];
};

const iso = (d: Date | null | undefined) => d ? new Date(d).toISOString().slice(0, 10) : null;
const like = (s: string) => `%${s.replace(/[\\%_]/g, "\\$&")}%`;

async function lockChallan(tx: Tx, id: number) {
  const [c] = await tx.select().from(S.salesChallan).where(eq(S.salesChallan.id, id)).for("update");
  if (!c) throw new HttpError(404, "Sales challan not found.");
  return c;
}

// Quantity of each challan line already billed by invoices that still stand (drafts reserve it; reversal invoices and reversed invoices do not count).
export async function billedBySalesChallanLine(tx: Tx, lineIds: number[], excludeInvoiceId = 0): Promise<Map<number, Micro>> {
  const out = new Map<number, Micro>();
  if (!lineIds.length) return out;
  const rows = (await tx.execute(sql`
    select il."challanLineId" as id, coalesce(sum(il.qty), 0)::text as q
      from "SalesInvoiceLine" il join "SalesInvoice" i on i.id = il."salesInvoiceId"
     where il."challanLineId" in (${sql.join(lineIds.map((x) => sql`${x}`), sql`, `)})
       and i."reversalOfId" is null
       and not exists (select 1 from "SalesInvoice" r where r."reversalOfId" = i.id and r."isPosted")
       and i.id <> ${excludeInvoiceId}
     group by 1`)) as any[];
  for (const r of rows) out.set(Number(r.id), toMicro(r.q));
  return out;
}

export function saveSalesChallan(input: SalesChallanInput, actor: Actor, opts: Opts = {}) {
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
    await assertMandatory(tx, input.companyId, "SALES_CHALLAN", { agent: input.agentId, remarks: input.remarks }, { agent: "agentId" });
    const [gl] = await tx.select().from(S.generalLedger).where(and(eq(S.generalLedger.id, input.customerGLId), eq(S.generalLedger.companyId, input.companyId)));
    if (!gl) throw new HttpError(404, "Customer ledger not found in this company.", "customerGLId");
    if (!gl.isActive) throw new HttpError(409, `Ledger ${gl.code} is not active.`, "customerGLId");
    if (!(["CUSTOMER", "BOTH"].includes(gl.glType))) throw new HttpError(400, `Ledger ${gl.code} is not marked as a customer ledger.`, "customerGLId");
    if (input.subLedgerId) {
      const [sub] = await tx.select().from(S.subLedger).where(and(eq(S.subLedger.id, input.subLedgerId), eq(S.subLedger.generalLedgerId, gl.id)));
      if (!sub || !sub.isActive) throw new HttpError(400, "That sub-ledger does not belong to the customer ledger or is inactive.", "subLedgerId");
    } else if (gl.requiresSubLedger) throw new HttpError(400, `Ledger ${gl.code} needs a sub-ledger.`, "subLedgerId");
    if (input.agentId) {
      const [a] = await tx.select({ isActive: S.agent.isActive }).from(S.agent).where(and(eq(S.agent.id, input.agentId), eq(S.agent.companyId, input.companyId)));
      if (!a) throw new HttpError(400, "Salesperson not found in this company.", "agentId");
      if (!a.isActive) throw new HttpError(409, "Salesperson is not active.", "agentId");
    }
    const fy = await resolveFiscalYear(tx, input.companyId, challanDate, input.fiscalYear ?? null);
    const lines = await resolveLines(tx, input.companyId, input.lines);
    if (lines.some((l) => l.productType !== "STOCK")) throw new HttpError(400, "A challan carries stock items only.", "lines");

    const numbered = await numberForSave(tx, { companyId: input.companyId, userId: actor.userId, documentType: "SALES_CHALLAN", seriesId: input.numberSeriesId, typed: input.challanNumber, branchId: input.branchId, fiscalYear: fy.code, existing: existing ? { number: existing.challanNumber, numberSeriesId: existing.numberSeriesId } : null });
    const header = {
      companyId: input.companyId, branchId: input.branchId, challanNumber: numbered.number, numberSeriesId: numbered.seriesId, challanDate, fiscalYear: fy.code,
      customerGLId: gl.id, subLedgerId: input.subLedgerId ?? null, agentId: input.agentId ?? null,
      transporterName: input.transporterName?.trim() || null, vehicleNo: input.vehicleNo?.trim() || null, lrNo: input.lrNo?.trim() || null, lrDate: optDate(input.lrDate, "lrDate"),
      remarks: input.remarks?.trim() || null, updatedAt: new Date(),
    };
    let id: number;
    if (existing) {
      id = existing.id;
      await tx.delete(S.salesChallanLine).where(eq(S.salesChallanLine.salesChallanId, id));
      await tx.update(S.salesChallan).set(header).where(eq(S.salesChallan.id, id));
    } else {
      [{ id }] = await tx.insert(S.salesChallan).values({ ...header, createdBy: actor.userId }).returning({ id: S.salesChallan.id });
    }
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i], src = input.lines[i];
      await tx.insert(S.salesChallanLine).values({
        salesChallanId: id, lineNumber: l.lineNumber, productId: l.productId, altQty: l.altQty === null ? null : fmt(l.altQty), altUnitId: l.altUnitId,
        qty: fmt(l.qty), unitId: l.unitId, rate: fmt(l.rate), basicAmount: fmt(l.basicAmount, 2),
        locationId: src.locationId ?? null, batchNo: src.batchNo?.trim() || null, expiryDate: optDate(src.expiryDate, "expiryDate"),
      });
    }
    return { id, challanNumber: numbered.number, fiscalYear: fy.code };
  });
}

// Confirm = the goods have really left. Batch / expiry present where tracked, stock must cover, then stock goes out.
export function confirmSalesChallan(id: number, actor: Actor, opts: Opts = {}) {
  return inActorTx(actor, opts.tx, async (tx) => {
    const c = await lockChallan(tx, id);
    if (c.isConfirmed) throw new HttpError(409, "Challan is already confirmed.");
    await resolveFiscalYear(tx, c.companyId, c.challanDate, c.fiscalYear);
    const lines = await tx.select().from(S.salesChallanLine).where(eq(S.salesChallanLine.salesChallanId, id)).orderBy(asc(S.salesChallanLine.lineNumber));
    if (!lines.length) throw new HttpError(409, "A challan without lines cannot be confirmed.");
    for (const l of lines) {
      const [sd] = await tx.select({ tracksBatch: S.stockDetail.tracksBatch, tracksExpiry: S.stockDetail.tracksExpiry }).from(S.stockDetail).where(eq(S.stockDetail.productId, l.productId));
      if (sd?.tracksBatch && !l.batchNo) throw new HttpError(409, `Line ${l.lineNumber}: this product is batch-tracked; choose the batch it is taken from.`);
      if (sd?.tracksExpiry && !l.expiryDate) throw new HttpError(409, `Line ${l.lineNumber}: this product expires; enter the expiry date of the batch.`);
    }
    // Entry Control: Block (the default) refuses, Warn asks once, Ignore lets the stock go negative.
    const stockRule = (await entryControlsOf(tx, c.companyId)).SALES_CHALLAN.zeroStock.rule;
    await assertStockCovers(tx, { companyId: c.companyId, branchId: c.branchId }, lines, (message) => ruleOutcome(stockRule, opts.acknowledge, message, "lines"));
    await tx.update(S.salesChallan).set({ isConfirmed: true, confirmedAt: new Date(), confirmedBy: actor.userId, updatedAt: new Date() }).where(eq(S.salesChallan.id, id));
    await recordMovements(tx, { companyId: c.companyId, branchId: c.branchId, date: c.challanDate, source: "SALES_CHALLAN", sourceId: id, direction: "OUT" }, lines);
    return { id, isConfirmed: true as const };
  });
}

export function deleteSalesChallan(id: number, actor: Actor, opts: Opts = {}) {
  return inActorTx(actor, opts.tx, async (tx) => {
    const c = await lockChallan(tx, id);
    if (c.isConfirmed) throw new HttpError(409, "A confirmed challan cannot be deleted; it is a record of goods delivered.");
    await tx.delete(S.salesChallan).where(eq(S.salesChallan.id, id));
    return { id, deleted: true as const };
  });
}

export function listSalesChallans(f: { companyId: number; branchId?: number; fiscalYear?: string; status?: string; search?: string; customerGLId?: number; limit?: number }, opts: Opts = {}) {
  return inTx(opts.tx, async (tx) => {
    const w = [eq(S.salesChallan.companyId, f.companyId)];
    if (f.branchId) w.push(eq(S.salesChallan.branchId, f.branchId));
    if (f.fiscalYear) w.push(eq(S.salesChallan.fiscalYear, f.fiscalYear));
    if (f.customerGLId) w.push(eq(S.salesChallan.customerGLId, f.customerGLId));
    if (f.status === "CONFIRMED") w.push(eq(S.salesChallan.isConfirmed, true));
    if (f.status === "DRAFT") w.push(eq(S.salesChallan.isConfirmed, false));
    if (f.search?.trim()) w.push(or(ilike(S.salesChallan.challanNumber, like(f.search.trim())), ilike(S.generalLedger.name, like(f.search.trim())))!);
    const rows = await tx.select({
      id: S.salesChallan.id, challanNumber: S.salesChallan.challanNumber, challanDate: S.salesChallan.challanDate, fiscalYear: S.salesChallan.fiscalYear,
      customerGLId: S.salesChallan.customerGLId, customerName: S.generalLedger.name, isConfirmed: S.salesChallan.isConfirmed,
      totalAmount: sql<string>`coalesce((select sum(l."basicAmount") from "SalesChallanLine" l where l."salesChallanId" = ${S.salesChallan.id}), 0)`,
    }).from(S.salesChallan).innerJoin(S.generalLedger, eq(S.generalLedger.id, S.salesChallan.customerGLId))
      .where(and(...w)).orderBy(desc(S.salesChallan.challanDate), desc(S.salesChallan.id)).limit(Math.min(f.limit ?? 100, 500));
    return rows.map((r) => ({ ...r, challanDate: iso(r.challanDate), status: r.isConfirmed ? "CONFIRMED" : "DRAFT" }));
  });
}

// The challan with each line's billed / pending-to-bill quantity.
export function getSalesChallan(id: number, companyId: number, opts: Opts = {}) {
  return inTx(opts.tx, async (tx) => {
    const [c] = await tx.select().from(S.salesChallan).where(and(eq(S.salesChallan.id, id), eq(S.salesChallan.companyId, companyId)));
    if (!c) throw new HttpError(404, "Sales challan not found.");
    const [cust] = await tx.select({ name: S.generalLedger.name }).from(S.generalLedger).where(eq(S.generalLedger.id, c.customerGLId));
    const lines = await tx.select().from(S.salesChallanLine).where(eq(S.salesChallanLine.salesChallanId, id)).orderBy(asc(S.salesChallanLine.lineNumber));
    const billed = await billedBySalesChallanLine(tx, lines.map((l) => l.id));
    return {
      ...c, challanDate: iso(c.challanDate), lrDate: iso(c.lrDate), customerName: cust?.name ?? null,
      lines: lines.map((l) => {
        const b = billed.get(l.id) ?? ZERO, q = toMicro(l.qty);
        return { ...l, expiryDate: iso(l.expiryDate), billedQty: fmt(b), pendingQty: fmt(q > b ? q - b : ZERO) };
      }),
    };
  });
}
