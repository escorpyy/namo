import { and, asc, eq, inArray } from "drizzle-orm";
import * as S from "../db/schema";
import { HttpError } from "../routes/_util";
import { priceTerms, type EngineTerm } from "../../shared/purchase-calculation";
import { type Tx } from "./purchase/common";
import { type Micro, ZERO, fmt, toMicro } from "./purchase/money";

export type SalesTermInput = {
  termId: number;
  lineNumber?: number | null;
  calcType?: "PERCENT" | "AMOUNT";
  rate?: string | number | null;
  inputAmount?: string | number | null;
  isOverridden?: boolean;
  overrideAmount?: string | number | null;
};
const isNil = (v: unknown) => v === null || v === undefined || v === "";

export async function saveSalesTerms(tx: Tx, ctx: { companyId: number; docId: number }, inputs: SalesTermInput[], lineIdByNumber: Map<number, number>) {
  await tx.delete(S.salesDocumentTerm).where(and(eq(S.salesDocumentTerm.documentType, "SALES_INVOICE"), eq(S.salesDocumentTerm.documentId, ctx.docId)));
  if (!inputs.length) return;
  const ids = [...new Set(inputs.map((t) => t.termId))];
  const masters = await tx.select().from(S.salesTerm).where(and(eq(S.salesTerm.companyId, ctx.companyId), inArray(S.salesTerm.id, ids)));
  const by = new Map(masters.map((m) => [m.id, m]));
  const seen = new Set<string>();
  for (const t of inputs) {
    const m = by.get(t.termId);
    if (!m) throw new HttpError(400, `Term ${t.termId} not found in this company.`, "terms");
    const label = `Term ${m.code}`;
    if (!m.isActive) throw new HttpError(409, `${label} is not active.`, "terms");
    if (m.category === "COSTING") throw new HttpError(400, `${label} is a costing term and is not supported on direct sales invoices.`, "terms");
    const lineNumber = isNil(t.lineNumber) ? null : Number(t.lineNumber);
    if (m.isProductwise && lineNumber === null) throw new HttpError(400, `${label} is productwise: say which line it applies to.`, "terms");
    if (!m.isProductwise && lineNumber !== null) throw new HttpError(400, `${label} applies to the whole document, not to a single line.`, "terms");
    const lineId = lineNumber === null ? null : (lineIdByNumber.get(lineNumber) ?? null);
    if (lineNumber !== null && lineId === null) throw new HttpError(400, `${label}: there is no line ${lineNumber}.`, "terms");
    const key = `${m.id}:${lineNumber ?? ""}`;
    if (seen.has(key)) throw new HttpError(400, `${label} is entered twice${lineNumber !== null ? ` on line ${lineNumber}` : ""}.`, "terms");
    seen.add(key);
    const rounded = m.category === "ROUNDED";
    const calcType = rounded ? "AMOUNT" : (t.calcType ?? m.defaultCalcType);
    const fallback = calcType === m.defaultCalcType ? m.defaultValue : null;
    let rate: string | null = null;
    let inputAmount: string | null = null;
    if (rounded) inputAmount = fmt(ZERO);
    else if (calcType === "PERCENT") {
      const v = isNil(t.rate) ? fallback : t.rate;
      if (isNil(v)) throw new HttpError(400, `${label}: a percentage needs a rate.`, "terms");
      const r = toMicro(v as string);
      if (r < ZERO || r > toMicro("99999.9999")) throw new HttpError(400, `${label}: rate must be between 0 and 99999.9999.`, "terms");
      rate = fmt(r, 4);
    } else {
      const v = isNil(t.inputAmount) ? fallback : t.inputAmount;
      if (isNil(v)) throw new HttpError(400, `${label}: an amount term needs an amount.`, "terms");
      const amount = toMicro(v as string);
      if (amount < ZERO) throw new HttpError(400, `${label}: amount cannot be negative.`, "terms");
      inputAmount = fmt(amount);
    }
    const isOverridden = rounded ? false : !!t.isOverridden;
    if (!m.isEditable) {
      const used = calcType === "PERCENT" ? rate : inputAmount;
      if (isOverridden || (!rounded && (calcType !== m.defaultCalcType || used === null || toMicro(used) !== toMicro(m.defaultValue)))) {
        throw new HttpError(409, `${label} is fixed by its master: its type and value cannot be changed on a document.`, "terms");
      }
    }
    let finalAmount = "0";
    if (isOverridden) {
      if (isNil(t.overrideAmount)) throw new HttpError(400, `${label}: an overridden term needs the amount to use.`, "terms");
      const override = toMicro(t.overrideAmount as string);
      if (override < ZERO) throw new HttpError(400, `${label}: override cannot be negative.`, "terms");
      finalAmount = fmt(override);
    }
    await tx.insert(S.salesDocumentTerm).values({
      companyId: ctx.companyId, documentType: "SALES_INVOICE", documentId: ctx.docId, documentLineId: lineId, termId: m.id,
      sequence: m.sequence, nature: m.nature, calcBase: m.calcBase, generalLedgerId: m.generalLedgerId,
      calcType, rate, inputAmount, isOverridden, finalAmount,
    });
  }
}

export type SalesTotals = { itemTotal: Micro; termNet: Micro; total: Micro };
export async function recalcSalesTerms(tx: Tx, docId: number): Promise<SalesTotals> {
  const lines = await tx.select({ id: S.salesInvoiceLine.id, basic: S.salesInvoiceLine.basicAmount })
    .from(S.salesInvoiceLine).where(eq(S.salesInvoiceLine.salesInvoiceId, docId)).orderBy(asc(S.salesInvoiceLine.lineNumber));
  const rows = await tx.select().from(S.salesDocumentTerm)
    .where(and(eq(S.salesDocumentTerm.documentType, "SALES_INVOICE"), eq(S.salesDocumentTerm.documentId, docId))).orderBy(asc(S.salesDocumentTerm.id));
  const ids = [...new Set(rows.map((r) => r.termId))];
  const masters = ids.length ? await tx.select({ id: S.salesTerm.id, baseTermId: S.salesTerm.baseTermId, category: S.salesTerm.category, roundingMethod: S.salesTerm.roundingMethod })
    .from(S.salesTerm).where(inArray(S.salesTerm.id, ids)) : [];
  const byId = new Map(masters.map((m) => [m.id, m]));
  const engineTerms: EngineTerm[] = rows.map((r) => {
    const m = byId.get(r.termId);
    if (!m) throw new HttpError(409, `Sales term ${r.termId} is no longer available.`);
    return {
      key: r.id, termId: r.termId, sequence: r.sequence, nature: r.nature, calcBase: r.calcBase, baseTermId: m.baseTermId,
      calcType: r.calcType, rate: isNil(r.rate) ? null : toMicro(r.rate), inputAmount: isNil(r.inputAmount) ? null : toMicro(r.inputAmount),
      isOverridden: r.isOverridden, overrideAmount: r.isOverridden ? toMicro(r.finalAmount) : null, lineKey: r.documentLineId,
      rounded: m.category === "ROUNDED", roundingMethod: m.roundingMethod,
    };
  });
  const result = priceTerms(lines.map((l) => ({ key: l.id, basicAmount: toMicro(l.basic) })), engineTerms);
  for (const row of rows) {
    const priced = result.results.get(row.id)!;
    await tx.update(S.salesDocumentTerm).set({
      baseAmount: fmt(priced.baseAmount), calculatedAmount: fmt(priced.calculatedAmount), finalAmount: fmt(priced.finalAmount),
      nature: priced.nature, updatedAt: new Date(),
    }).where(eq(S.salesDocumentTerm.id, row.id));
  }
  return { itemTotal: result.itemTotal, termNet: result.termNet, total: result.total };
}

export async function assertMandatorySalesTerms(tx: Tx, companyId: number, docId: number) {
  const mandatory = await tx.select({ id: S.salesTerm.id, code: S.salesTerm.code }).from(S.salesTerm)
    .where(and(eq(S.salesTerm.companyId, companyId), eq(S.salesTerm.isMandatory, true), eq(S.salesTerm.isActive, true), inArray(S.salesTerm.category, ["GENERAL", "ROUNDED"])));
  if (!mandatory.length) return;
  const have = new Set((await tx.select({ termId: S.salesDocumentTerm.termId }).from(S.salesDocumentTerm)
    .where(and(eq(S.salesDocumentTerm.documentType, "SALES_INVOICE"), eq(S.salesDocumentTerm.documentId, docId)))).map((r) => r.termId));
  const missing = mandatory.filter((m) => !have.has(m.id)).map((m) => m.code);
  if (missing.length) throw new HttpError(409, `Mandatory term${missing.length > 1 ? "s" : ""} missing: ${missing.join(", ")}.`, "terms");
}
