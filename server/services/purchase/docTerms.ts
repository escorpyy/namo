import { and, asc, eq, inArray } from "drizzle-orm";
import * as S from "../../db/schema";
import { HttpError } from "../../routes/_util";
import { type Tx } from "./common";
import { allocate } from "./landed";
import { type Micro, ZERO, fmt, toMicro } from "./money";
import { priceTerms, type EngineTerm } from "./terms";

export type DocType = "PURCHASE_ORDER" | "PURCHASE_BILL";

// What a user enters for one term on a document. Nature, base, sequence, ledger and distribution come from the
// term master and cannot be changed per document; the user chooses where it applies and the value.
export type TermInput = {
  termId: number;
  lineNumber?: number | null; // required for productwise terms (they price one line), forbidden otherwise
  calcType?: "PERCENT" | "AMOUNT"; // default: the master's
  rate?: string | number | null; // PERCENT; default: the master's default value
  inputAmount?: string | number | null; // AMOUNT; default: the master's default value
  isOverridden?: boolean;
  overrideAmount?: string | number | null; // the amount that stands when isOverridden
};

const isNil = (v: unknown) => v === null || v === undefined || v === "";

// Replaces ALL terms of a document with the given ones (a draft is saved as a whole). Rows are stored with zero amounts;
// recalcTerms() then prices them. Allocations of the removed terms disappear with them (cascade).
export async function saveTerms(
  tx: Tx,
  ctx: { companyId: number; docType: DocType; docId: number; isAdditionalBill?: boolean },
  inputs: TermInput[],
  lineIdByNumber: Map<number, number>,
) {
  await tx.delete(S.purchaseDocumentTerm).where(and(eq(S.purchaseDocumentTerm.documentType, ctx.docType), eq(S.purchaseDocumentTerm.documentId, ctx.docId)));
  if (inputs.length === 0) return;

  const ids = [...new Set(inputs.map((t) => t.termId))];
  const masters = await tx.select().from(S.purchaseTerm).where(and(eq(S.purchaseTerm.companyId, ctx.companyId), inArray(S.purchaseTerm.id, ids)));
  const by = new Map(masters.map((m) => [m.id, m]));
  const seen = new Set<string>();

  for (const t of inputs) {
    const m = by.get(t.termId);
    if (!m) throw new HttpError(400, `Term ${t.termId} not found in this company.`, "terms");
    const label = `Term ${m.code}`;
    if (!m.isActive) throw new HttpError(409, `${label} is not active.`, "terms");

    const lineNumber = isNil(t.lineNumber) ? null : Number(t.lineNumber);
    if (m.isProductwise && lineNumber === null) throw new HttpError(400, `${label} is productwise: say which line it applies to.`, "terms");
    if (!m.isProductwise && lineNumber !== null) throw new HttpError(400, `${label} applies to the whole document, not to a single line.`, "terms");
    let lineId: number | null = null;
    if (lineNumber !== null) {
      lineId = lineIdByNumber.get(lineNumber) ?? null;
      if (lineId === null) throw new HttpError(400, `${label}: there is no line ${lineNumber}.`, "terms");
    }
    const dupKey = `${m.id}:${lineNumber ?? ""}`;
    if (seen.has(dupKey)) throw new HttpError(400, `${label} is entered twice${lineNumber !== null ? ` on line ${lineNumber}` : ""}.`, "terms");
    seen.add(dupKey);

    if (m.category === "ADDITIONAL") {
      if (ctx.docType === "PURCHASE_ORDER") throw new HttpError(400, `${label} is an additional charge; it belongs on an additional purchase bill, not on an order.`, "terms");
      if (!ctx.isAdditionalBill) throw new HttpError(400, `${label} is an additional charge; it can only be entered on an additional purchase bill.`, "terms");
    }

    const calcType = t.calcType ?? m.defaultCalcType;
    const fallback = calcType === m.defaultCalcType ? m.defaultValue : null;
    let rate: string | null = null;
    let inputAmount: string | null = null;
    if (calcType === "PERCENT") {
      const v = isNil(t.rate) ? fallback : t.rate;
      if (isNil(v)) throw new HttpError(400, `${label}: a percentage needs a rate.`, "terms");
      const r = toMicro(v as string);
      if (r < ZERO || r > toMicro("99999.9999")) throw new HttpError(400, `${label}: rate must be between 0 and 99999.9999.`, "terms");
      rate = fmt(r, 4);
    } else {
      const v = isNil(t.inputAmount) ? fallback : t.inputAmount;
      if (isNil(v)) throw new HttpError(400, `${label}: an amount term needs an amount.`, "terms");
      const a = toMicro(v as string);
      if (a < ZERO) throw new HttpError(400, `${label}: amount cannot be negative.`, "terms");
      inputAmount = fmt(a);
    }
    const isOverridden = !!t.isOverridden;
    let finalAmount = "0";
    if (isOverridden) {
      if (isNil(t.overrideAmount)) throw new HttpError(400, `${label}: an overridden term needs the amount to use.`, "terms");
      const o = toMicro(t.overrideAmount as string);
      if (o < ZERO) throw new HttpError(400, `${label}: override cannot be negative.`, "terms");
      finalAmount = fmt(o);
    }

    await tx.insert(S.purchaseDocumentTerm).values({
      companyId: ctx.companyId, documentType: ctx.docType, documentId: ctx.docId, documentLineId: lineId, termId: m.id,
      sequence: m.sequence, nature: m.nature, calcBase: m.calcBase, generalLedgerId: m.generalLedgerId,
      distributeToLines: m.distributeToLines, allocationBasis: m.allocationBasis, calcType, rate, inputAmount,
      isOverridden, finalAmount,
    });
  }
}

export type Totals = { itemTotal: Micro; termNet: Micro; total: Micro };

// Prices every term of the document from its CURRENT lines, stores the results, and rebuilds the line allocations
// (landed-cost splits). Call it after any change to lines or terms. Returns the document totals.
export async function recalcTerms(tx: Tx, docType: DocType, docId: number): Promise<Totals> {
  const lines =
    docType === "PURCHASE_ORDER"
      ? await tx.select({ id: S.purchaseOrderLine.id, qty: S.purchaseOrderLine.qty, basic: S.purchaseOrderLine.basicAmount }).from(S.purchaseOrderLine).where(eq(S.purchaseOrderLine.purchaseOrderId, docId)).orderBy(asc(S.purchaseOrderLine.lineNumber))
      : await tx.select({ id: S.purchaseBillLine.id, qty: S.purchaseBillLine.qty, basic: S.purchaseBillLine.basicAmount }).from(S.purchaseBillLine).where(eq(S.purchaseBillLine.purchaseBillId, docId)).orderBy(asc(S.purchaseBillLine.lineNumber));

  const rows = await tx.select().from(S.purchaseDocumentTerm).where(and(eq(S.purchaseDocumentTerm.documentType, docType), eq(S.purchaseDocumentTerm.documentId, docId))).orderBy(asc(S.purchaseDocumentTerm.id));
  const masterIds = [...new Set(rows.map((r) => r.termId))];
  const masters = masterIds.length ? await tx.select({ id: S.purchaseTerm.id, baseTermId: S.purchaseTerm.baseTermId }).from(S.purchaseTerm).where(inArray(S.purchaseTerm.id, masterIds)) : [];
  const baseOf = new Map(masters.map((m) => [m.id, m.baseTermId]));

  const engineTerms: EngineTerm[] = rows.map((r) => ({
    key: r.id, termId: r.termId, sequence: r.sequence, nature: r.nature, calcBase: r.calcBase, baseTermId: baseOf.get(r.termId) ?? null,
    calcType: r.calcType, rate: isNil(r.rate) ? null : toMicro(r.rate), inputAmount: isNil(r.inputAmount) ? null : toMicro(r.inputAmount),
    isOverridden: r.isOverridden, overrideAmount: r.isOverridden ? toMicro(r.finalAmount) : null, lineKey: r.documentLineId,
  }));
  const out = priceTerms(lines.map((l) => ({ key: l.id, basicAmount: toMicro(l.basic) })), engineTerms);

  for (const r of rows) {
    const x = out.results.get(r.id)!;
    await tx.update(S.purchaseDocumentTerm).set({ baseAmount: fmt(x.baseAmount), calculatedAmount: fmt(x.calculatedAmount), finalAmount: fmt(x.finalAmount), updatedAt: new Date() }).where(eq(S.purchaseDocumentTerm.id, r.id));
  }

  // Allocations: wipe and rebuild for every term of this document.
  if (rows.length) await tx.delete(S.purchaseDocumentTermAllocation).where(inArray(S.purchaseDocumentTermAllocation.documentTermId, rows.map((r) => r.id)));
  const dist = rows.filter((r) => r.distributeToLines && r.documentLineId === null);
  if (dist.length) {
    // An additional bill's charges go onto the lines of the MAIN bill; everything else onto the document's own lines.
    let targets = lines.map((l) => ({ id: l.id, qty: toMicro(l.qty), basic: toMicro(l.basic) }));
    if (docType === "PURCHASE_BILL") {
      const [bill] = await tx.select({ mainBillId: S.purchaseBill.mainBillId }).from(S.purchaseBill).where(eq(S.purchaseBill.id, docId));
      if (bill?.mainBillId) {
        const ml = await tx.select({ id: S.purchaseBillLine.id, qty: S.purchaseBillLine.qty, basic: S.purchaseBillLine.basicAmount }).from(S.purchaseBillLine).where(eq(S.purchaseBillLine.purchaseBillId, bill.mainBillId)).orderBy(asc(S.purchaseBillLine.lineNumber));
        targets = ml.map((l) => ({ id: l.id, qty: toMicro(l.qty), basic: toMicro(l.basic) }));
      }
    }
    for (const r of dist) {
      const amount = out.results.get(r.id)!.finalAmount;
      if (amount === ZERO) continue;
      if (targets.length === 0) throw new HttpError(400, "A term that distributes over lines needs lines to distribute over.", "terms");
      const w = targets.map((t) => (r.allocationBasis === "QUANTITY" ? t.qty : t.basic));
      const parts = allocate(amount, w);
      for (let i = 0; i < targets.length; i++) {
        if (parts[i] === ZERO) continue;
        await tx.insert(S.purchaseDocumentTermAllocation).values({ documentTermId: r.id, documentLineId: targets[i].id, allocatedAmount: fmt(parts[i]) });
      }
    }
  }
  return { itemTotal: out.itemTotal, termNet: out.termNet, total: out.total };
}

// Mandatory terms (e.g. VAT) must be on the document before it is approved / posted.
// Additional charges are not mandatory on a main document, and an additional bill carries only what it carries.
export async function assertMandatoryTerms(tx: Tx, companyId: number, docType: DocType, docId: number) {
  const mandatory = await tx.select({ id: S.purchaseTerm.id, code: S.purchaseTerm.code }).from(S.purchaseTerm).where(and(eq(S.purchaseTerm.companyId, companyId), eq(S.purchaseTerm.isMandatory, true), eq(S.purchaseTerm.isActive, true)));
  if (!mandatory.length) return;
  const have = new Set((await tx.select({ termId: S.purchaseDocumentTerm.termId }).from(S.purchaseDocumentTerm).where(and(eq(S.purchaseDocumentTerm.documentType, docType), eq(S.purchaseDocumentTerm.documentId, docId)))).map((r) => r.termId));
  const missing = mandatory.filter((m) => !have.has(m.id)).map((m) => m.code);
  if (missing.length) throw new HttpError(409, `Mandatory term${missing.length > 1 ? "s" : ""} missing: ${missing.join(", ")}.`, "terms");
}
