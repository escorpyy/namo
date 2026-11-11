import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db";
import * as S from "../../db/schema";
import { HttpError } from "../../routes/_util";
import { calculateImportCosting, type ImportAssessmentTermInput, type ImportCostLineInput, type ImportCostSourceInput } from "../../../shared/import-costing";
import { fmt, roundTo, toMicro, type EngineTerm, type Micro, ZERO } from "../../../shared/purchase-calculation";
import { guardPeriod, type LockOverride } from "../periodLock";
import { type Actor, type Opts, type Tx, assertBranch, inActorTx, inTx, parseDate, resolveFiscalYear, today } from "./common";
import { importCostBasis } from "./importCostBasis";
import { type JvRow, mergeRows, recomputeLanded, writeVoucher } from "./purchaseBill";

type Basis = "VALUE" | "QUANTITY";
// capitalizable defaults to the term master's "affects stock value"; againstLedgerId to the master's default against ledger.
type TermInput = { termId: number; calcType?: "PERCENT" | "AMOUNT"; rate?: string | number | null; inputAmount?: string | number | null; isOverridden?: boolean; overrideAmount?: string | number | null; allocationBasis: Basis; capitalizable?: boolean; againstLedgerId?: number | null; againstSubLedgerId?: number | null;
  // MANUAL: the user types the amount for each product line instead of the automatic split; they must add up to the charge.
  allocationMode?: "AUTO" | "MANUAL"; manualAmounts?: { purchaseBillLineId: number; amount: string | number }[] };
export type AssessmentInput = { id?: number; companyId: number; branchId: number; fiscalYear?: string; importBillId: number; assessmentDate: string | Date; referenceNo?: string | null; remarks?: string | null; terms: TermInput[] };
type AssessmentOpts = Opts & { lockOverride?: LockOverride | null; date?: string | Date };

const amountText = (value: unknown, field: string, nullable = false) => {
  if ((value === undefined || value === null || value === "") && nullable) return null;
  try {
    const result = toMicro(String(value));
    if (result < ZERO) throw new Error("negative");
    return fmt(result, 6);
  } catch {
    throw new HttpError(400, `${field} must be a non-negative amount.`, field);
  }
};
const basisOk = (basis: unknown): basis is Basis => basis === "VALUE" || basis === "QUANTITY";
const stateOf = (doc: { isPosted: boolean; reversedAt: Date | null }) => doc.reversedAt ? "REVERSED" : doc.isPosted ? "APPLIED" : "DRAFT";
const resultAmount = (value: Micro) => fmt(value, 2);
const voucherNumberFor = (d: { id: number; fiscalYear: string; assessmentNumber: string }) => {
  const n = `CA-${d.fiscalYear}-${d.assessmentNumber}`;
  return n.length <= 30 ? n : `CA-${d.id}`;
};

async function importBill(tx: Tx, companyId: number, branchId: number, billId: number, lock = false) {
  let query = tx.select().from(S.purchaseBill).where(and(eq(S.purchaseBill.id, billId), eq(S.purchaseBill.companyId, companyId)));
  if (lock) query = query.for("update") as typeof query;
  const [bill] = await query;
  if (!bill) throw new HttpError(404, "Goods bill not found in this company.", "importBillId");
  if (bill.branchId !== branchId) throw new HttpError(400, "Assessment and goods bill must be in the same branch.", "importBillId");
  if (!bill.purchaseType.startsWith("GOODS_PURCHASE_") || bill.mainBillId || bill.reversalOfId) {
    throw new HttpError(400, "An assessment must be linked to a main goods bill (local or import).", "importBillId");
  }
  const [reversal] = await tx.select({ id: S.purchaseBill.id }).from(S.purchaseBill).where(and(eq(S.purchaseBill.reversalOfId, bill.id), eq(S.purchaseBill.isPosted, true))).limit(1);
  if (!bill.isPosted || reversal) throw new HttpError(409, "The goods bill must be posted and active before assessment.", "importBillId");
  return bill;
}

// The other side of an assessed charge: any active ledger of the company (Cash A/c, Bank, Customs Payable, an agent's account).
async function checkAgainstLedger(tx: Tx, companyId: number, code: string, ledgerId: number, subLedgerId: number | null) {
  const [gl] = await tx.select().from(S.generalLedger).where(and(eq(S.generalLedger.id, ledgerId), eq(S.generalLedger.companyId, companyId)));
  if (!gl) throw new HttpError(400, `Charge ${code}: the against ledger was not found in this company.`, "terms");
  if (!gl.isActive) throw new HttpError(409, `Charge ${code}: ledger ${gl.code} is not active.`, "terms");
  if (subLedgerId) {
    const [sl] = await tx.select().from(S.subLedger).where(eq(S.subLedger.id, subLedgerId));
    if (!sl || sl.generalLedgerId !== ledgerId) throw new HttpError(400, `Charge ${code}: that sub-ledger does not belong to the against ledger.`, "terms");
  }
  return gl;
}

async function resolveTerms(tx: Tx, companyId: number, input: TermInput[]) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 100) throw new HttpError(400, "Add between 1 and 100 assessed charge terms.", "terms");
  const ids = input.map((t) => t?.termId);
  if (ids.some((id) => !Number.isInteger(id) || id <= 0) || new Set(ids).size !== ids.length) throw new HttpError(400, "Each assessed charge must use a distinct valid term.", "terms");
  const masters = await tx.select().from(S.purchaseTerm).where(and(eq(S.purchaseTerm.companyId, companyId), inArray(S.purchaseTerm.id, ids)));
  if (masters.length !== ids.length) throw new HttpError(400, "One or more charge terms do not belong to this company.", "terms");
  const byId = new Map(masters.map((m) => [m.id, m]));
  const out = [];
  for (const value of input) {
    const master = byId.get(value.termId)!;
    if (!master.isActive) throw new HttpError(409, `Charge term ${master.code} is inactive.`, "terms");
    if (master.category !== "COSTING") throw new HttpError(400, `Charge term ${master.code} is not in the Costing category.`, "terms");
    if (master.isProductwise) throw new HttpError(400, `Charge term ${master.code} must be a header-level term.`, "terms");
    if (!basisOk(value.allocationBasis)) throw new HttpError(400, `Charge term ${master.code} needs VALUE or QUANTITY allocation.`, "terms");
    const capitalizable = value.capitalizable ?? master.affectsStockValue;
    if (typeof capitalizable !== "boolean") throw new HttpError(400, `Charge term ${master.code}: affects-stock-value must be true or false.`, "terms");
    const calcType = value.calcType ?? master.defaultCalcType;
    if (calcType !== "PERCENT" && calcType !== "AMOUNT") throw new HttpError(400, `Charge term ${master.code} has an invalid calculation type.`, "terms");
    const rate = calcType === "PERCENT" ? amountText(value.rate ?? master.defaultValue, `${master.code} rate`) : null;
    const inputAmount = calcType === "AMOUNT" ? amountText(value.inputAmount ?? master.defaultValue, `${master.code} amount`) : null;
    const isOverridden = value.isOverridden === true;
    const overrideAmount = isOverridden ? amountText(value.overrideAmount, `${master.code} override`) : null;
    // A term the master marks as not editable keeps the master's type and value, and cannot take an own amount.
    if (!master.isEditable) {
      const used = calcType === "PERCENT" ? rate : inputAmount;
      if (isOverridden || calcType !== master.defaultCalcType || used === null || toMicro(used) !== toMicro(master.defaultValue)) {
        throw new HttpError(409, `Charge ${master.code} is fixed by its master: its type and value cannot be changed here.`, "terms");
      }
    }
    const baseTermId = master.calcBase === "SINGLE_TERM" ? master.baseTermId : null;
    if (master.calcBase === "SINGLE_TERM" && !baseTermId) throw new HttpError(400, `Charge term ${master.code} has no single-term base configured.`, "terms");

    const allocationMode = value.allocationMode ?? "AUTO";
    if (allocationMode !== "AUTO" && allocationMode !== "MANUAL") throw new HttpError(400, `Charge ${master.code}: allocation mode must be AUTO or MANUAL.`, "terms");
    if (allocationMode === "MANUAL" && !capitalizable) throw new HttpError(400, `Charge ${master.code} does not affect stock value, so there is nothing to split product-wise.`, "terms");
    const manual: { purchaseBillLineId: number; amount: string }[] = [];
    if (allocationMode === "MANUAL") {
      const entered = value.manualAmounts ?? [];
      if (!Array.isArray(entered) || entered.length > 500) throw new HttpError(400, `Charge ${master.code}: the product-wise amounts must be a list.`, "terms");
      const seenLines = new Set<number>();
      for (const e of entered) {
        if (!Number.isInteger(e?.purchaseBillLineId) || e.purchaseBillLineId <= 0 || seenLines.has(e.purchaseBillLineId)) throw new HttpError(400, `Charge ${master.code}: each product line may be given an amount once.`, "terms");
        seenLines.add(e.purchaseBillLineId);
        const amount = toMicro(amountText(e.amount, `${master.code} product-wise amount`)!);
        manual.push({ purchaseBillLineId: e.purchaseBillLineId, amount: fmt(roundTo(amount, 2), 2) });
      }
    }

    // Against ledger: what the user chose, else the master's default. It may stay empty while drafting; applying needs it.
    const againstLedgerId = value.againstLedgerId ?? master.defaultAgainstLedgerId ?? null;
    const againstSubLedgerId = againstLedgerId ? (value.againstSubLedgerId ?? null) : null;
    if (!againstLedgerId && value.againstSubLedgerId) throw new HttpError(400, `Charge ${master.code}: a sub-ledger needs its against ledger.`, "terms");
    if (againstLedgerId) {
      if (againstLedgerId === master.generalLedgerId) throw new HttpError(400, `Charge ${master.code}: the against ledger must differ from the term's own ledger.`, "terms");
      await checkAgainstLedger(tx, companyId, master.code, againstLedgerId, againstSubLedgerId);
    }
    out.push({ termId: master.id, code: master.code, name: master.name, nature: master.nature, calcBase: master.calcBase, baseTermId, sequence: master.sequence, calcType, rate, inputAmount, isOverridden, overrideAmount, allocationBasis: value.allocationBasis, capitalizable,
      generalLedgerId: master.generalLedgerId ?? null, againstLedgerId, againstSubLedgerId, allocationMode: allocationMode as "AUTO" | "MANUAL", manual });
  }
  return out;
}

type ResolvedTerm = Awaited<ReturnType<typeof resolveTerms>>[number];
// The user's product-wise amounts are not a column of the term row; they live as allocation rows while the assessment is a draft.
const columnsOf = ({ manual: _manual, ...columns }: ResolvedTerm) => columns;
const manualFromResolved = (terms: ResolvedTerm[]) => new Map(terms.filter((t) => t.allocationMode === "MANUAL").map((t) => [t.termId, new Map(t.manual.map((m) => [m.purchaseBillLineId, toMicro(m.amount)] as [number, Micro]))] as [number, Map<number, Micro>]));
const manualFromRows = (rows: { assessmentTermId: number; purchaseBillLineId: number; allocatedAmount: string }[]) => {
  const out = new Map<number, Map<number, Micro>>();
  for (const r of rows) {
    const perLine = out.get(r.assessmentTermId) ?? new Map<number, Micro>();
    perLine.set(r.purchaseBillLineId, toMicro(r.allocatedAmount));
    out.set(r.assessmentTermId, perLine);
  }
  return out;
};

async function insertTerms(tx: Tx, companyId: number, assessmentId: number, billId: number, terms: ResolvedTerm[]) {
  const inserted = await tx.insert(S.purchaseImportAssessmentTerm).values(terms.map((t) => ({ companyId, assessmentId, ...columnsOf(t), baseAmount: "0", calculatedAmount: "0", finalAmount: "0" }))).returning({ id: S.purchaseImportAssessmentTerm.id, termId: S.purchaseImportAssessmentTerm.termId });
  const idByTerm = new Map(inserted.map((r) => [r.termId, r.id]));
  const values: { companyId: number; assessmentId: number; assessmentTermId: number; purchaseBillLineId: number; allocatedAmount: string }[] = [];
  const lineIds = new Set((await tx.select({ id: S.purchaseBillLine.id }).from(S.purchaseBillLine).where(eq(S.purchaseBillLine.purchaseBillId, billId))).map((l) => l.id));
  for (const t of terms) for (const m of t.manual) {
    if (!lineIds.has(m.purchaseBillLineId)) throw new HttpError(400, `Charge ${t.code}: a product-wise amount points to a line that is not on this bill.`, "terms");
    values.push({ companyId, assessmentId, assessmentTermId: idByTerm.get(t.termId)!, purchaseBillLineId: m.purchaseBillLineId, allocatedAmount: m.amount });
  }
  if (values.length) await tx.insert(S.purchaseImportAssessmentAllocation).values(values);
}

async function calculate(tx: Tx, targetBillId: number, terms: any[], manualByKey: Map<number, Map<number, Micro>> = new Map()) {
  const bill = await tx.select().from(S.purchaseBill).where(eq(S.purchaseBill.id, targetBillId)).limit(1).then((r) => r[0]);
  if (!bill) throw new HttpError(404, "Import goods bill not found.", "importBillId");
  const basis = await importCostBasis(tx, targetBillId);
  if (!basis.lines.length) throw new HttpError(409, "Import goods bill has no product lines to assess.", "importBillId");
  const priorTermRows = await tx.execute(sql`
    select a."documentLineId" as id,
           sum(case when t.nature = 'ADDITIVE' then a."allocatedAmount" else -a."allocatedAmount" end)::text as amt
      from "PurchaseDocumentTermAllocation" a
      join "PurchaseDocumentTerm" t on t.id = a."documentTermId" and t."documentType" = 'PURCHASE_BILL'
      join "PurchaseBill" b on b.id = t."documentId"
      join "PurchaseBillLine" l on l.id = a."documentLineId"
     where l."purchaseBillId" = ${targetBillId}
       and (b."isPosted" or l."purchaseBillId" = b.id)
       and not exists (select 1 from "PurchaseBill" r where r."reversalOfId" = b.id and r."isPosted")
     group by a."documentLineId"`) as any[];
  const priorTermByLine = new Map(priorTermRows.map((row) => [Number(row.id), toMicro(row.amt)]));
  // A goods bill can carry several assessments (a late or supplementary charge is a new assessment). The ones already APPLIED and not reversed
  // stand on the lines as signed allocations, so a new assessment's landed value must include them. Drafts are not counted (their rows are only
  // typed product-wise amounts), and neither are reversed ones. This feeds the same "already posted to the lines" input as the bill's own terms.
  const priorAssessmentRows = await tx.execute(sql`
    select a."purchaseBillLineId" as id, sum(a."allocatedAmount")::text as amt
      from "PurchaseImportAssessmentAllocation" a
      join "PurchaseImportAssessment" d on d.id = a."assessmentId"
     where d."importBillId" = ${targetBillId} and d."isPosted" and d."reversedAt" is null
     group by a."purchaseBillLineId"`) as any[];
  const priorAssessmentByLine = new Map(priorAssessmentRows.map((row) => [Number(row.id), toMicro(row.amt)]));
  const productRows = await tx.select({ id: S.purchaseBillLine.id, productId: S.purchaseBillLine.productId, productCode: S.product.code, description: S.product.description, qty: S.purchaseBillLine.qty }).from(S.purchaseBillLine)
    .leftJoin(S.product, eq(S.product.id, S.purchaseBillLine.productId)).where(eq(S.purchaseBillLine.purchaseBillId, targetBillId));
  const productByLine = new Map(productRows.map((l) => [l.id, l]));
  const lines: ImportCostLineInput[] = basis.lines.map((line) => ({ key: line.id, lineNumber: line.lineNumber, quantity: fmt(line.qty), goodsValue: fmt(line.goodsValue, 2), existingPurchaseTermCosts: fmt((priorTermByLine.get(line.id) ?? ZERO) + (priorAssessmentByLine.get(line.id) ?? ZERO), 2) }));
  const sources: ImportCostSourceInput[] = basis.sources.map((source) => ({
    key: String(source.id), label: source.invoiceNumber,
    capitalizedAmount: fmt(source.basicAmount, 2), customsValueAmount: source.treatment === "CIF" ? fmt(source.basicAmount, 2) : "0",
    allocationBasis: source.allocationBasis,
  }));
  const normalizedTerms = terms.map((row) => {
    const key = Number(row.id ?? row.termId);
    const engine: EngineTerm = {
      key, termId: Number(row.termId), sequence: Number(row.sequence), nature: row.nature,
      calcBase: row.calcBase, baseTermId: row.baseTermId ?? null, calcType: row.calcType,
      rate: row.rate == null ? null : toMicro(String(row.rate)), inputAmount: row.inputAmount == null ? null : toMicro(String(row.inputAmount)),
      isOverridden: !!row.isOverridden, overrideAmount: row.overrideAmount == null ? null : toMicro(String(row.overrideAmount)),
    };
    const manualAmounts = row.allocationMode === "MANUAL" ? (manualByKey.get(key) ?? new Map<number, Micro>()) : undefined;
    return { term: engine, allocationBasis: row.allocationBasis as Basis, capitalizable: !!row.capitalizable, manualAmounts } satisfies ImportAssessmentTermInput;
  });
  let result;
  try { result = calculateImportCosting(lines, sources, normalizedTerms); }
  catch (error) { throw new HttpError(400, error instanceof Error ? error.message : "Could not calculate import assessment.", "terms"); }
  const lineDtos = basis.lines.map((line) => {
    const r = result.lines.get(line.id)!; const meta = productByLine.get(line.id);
    return { id: line.id, key: line.id, lineNumber: line.lineNumber, productId: meta?.productId ?? null, productCode: meta?.productCode ?? "", description: meta?.description ?? "", quantity: fmt(line.qty), goodsValue: resultAmount(r.goodsValue), customsValue: resultAmount(r.customsValue), capitalizedSources: resultAmount(r.capitalizedSources), existingPurchaseTermCosts: resultAmount(r.existingPurchaseTermCosts), capitalizedAssessments: resultAmount(r.capitalizedAssessments), landedValue: resultAmount(r.landedValue), landedRate: fmt(r.landedRate, 6) };
  });
  const termDtos = normalizedTerms.map((row) => {
    const r = result.termResults.get(row.term.key)!;
    const difference = result.manualDifference.get(row.term.key);
    return { termId: row.term.termId, key: row.term.key, baseAmount: resultAmount(r.baseAmount), calculatedAmount: resultAmount(r.calculatedAmount), finalAmount: resultAmount(r.finalAmount), nature: row.term.nature,
      allocationMode: row.manualAmounts ? "MANUAL" : "AUTO", manualDifference: difference === undefined ? null : resultAmount(difference) };
  });
  const preview = {
    goodsValue: resultAmount(result.goodsValue), customsValueFromSources: resultAmount(result.customsValueFromSources), cifValue: resultAmount(result.cifValue),
    invoicedCapitalizedCosts: resultAmount(result.invoicedCapitalizedCosts), existingPurchaseTermCosts: resultAmount(result.existingPurchaseTermCosts), assessedNet: resultAmount(result.assessedNet), capitalizedAssessments: resultAmount(result.capitalizedAssessments), totalLandedValue: resultAmount(result.totalLandedValue),
    lines: lineDtos, terms: termDtos, termResults: termDtos,
    sourceAllocations: [...result.sourceAllocations.entries()].map(([sourceKey, amounts]) => ({ sourceKey, lines: [...amounts.entries()].map(([lineId, amount]) => ({ lineId, amount: resultAmount(amount) })) })),
    termAllocations: [...result.termAllocations.entries()].map(([termKey, amounts]) => ({ termKey, lines: [...amounts.entries()].map(([lineId, amount]) => ({ lineId, amount: fmt(amount, 2) })) })),
    _result: result,
  };
  return { bill, basis, result, preview, normalizedTerms, lineDtos };
}

function previewBody(x: Awaited<ReturnType<typeof calculate>>) {
  const { _result, ...preview } = x.preview as any;
  return preview;
}

async function nextAssessmentNumber(tx: Tx, branchId: number, fiscalYear: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`PurchaseImportAssessment:${branchId}:${fiscalYear}`}))`);
  const raw = await tx.execute(sql`select coalesce(max("assessmentNumber"::bigint), 0)::text as n from "PurchaseImportAssessment" where "branchId" = ${branchId} and "fiscalYear" = ${fiscalYear} and "assessmentNumber" ~ '^[0-9]{1,15}$'`);
  const rows = raw as unknown as { n: string }[];
  return String(BigInt(rows[0]?.n ?? "0") + 1n).padStart(4, "0");
}

export async function previewImportAssessment(input: { companyId: number; branchId: number; importBillId: number; terms: TermInput[] }) {
  return inTx(undefined, async (tx) => {
    await importBill(tx, input.companyId, input.branchId, input.importBillId);
    const terms = input.terms.length ? await resolveTerms(tx, input.companyId, input.terms) : [];
    return { preview: previewBody(await calculate(tx, input.importBillId, terms, manualFromResolved(terms))) };
  });
}

export async function listImportAssessments(filter: { companyId: number; branchId: number; fiscalYear: string; status?: string; search?: string }) {
  const where = [eq(S.purchaseImportAssessment.companyId, filter.companyId), eq(S.purchaseImportAssessment.branchId, filter.branchId), eq(S.purchaseImportAssessment.fiscalYear, filter.fiscalYear)];
  if (filter.status === "DRAFT") where.push(eq(S.purchaseImportAssessment.isPosted, false));
  if (filter.status === "APPLIED") { where.push(eq(S.purchaseImportAssessment.isPosted, true)); where.push(sql`${S.purchaseImportAssessment.reversedAt} IS NULL`); }
  if (filter.status === "REVERSED") where.push(sql`${S.purchaseImportAssessment.reversedAt} IS NOT NULL`);
  if (filter.search?.trim()) { const term = `%${filter.search.trim().slice(0, 100)}%`; where.push(sql`(${S.purchaseImportAssessment.assessmentNumber} ILIKE ${term} OR ${S.purchaseImportAssessment.referenceNo} ILIKE ${term} OR ${S.purchaseBill.invoiceNumber} ILIKE ${term})`); }
  const rows = await db.select({ id: S.purchaseImportAssessment.id, assessmentNumber: S.purchaseImportAssessment.assessmentNumber, assessmentDate: S.purchaseImportAssessment.assessmentDate,
    isPosted: S.purchaseImportAssessment.isPosted, reversedAt: S.purchaseImportAssessment.reversedAt, importBillId: S.purchaseImportAssessment.importBillId,
    referenceNo: S.purchaseImportAssessment.referenceNo, assessedNet: S.purchaseImportAssessment.assessedNet, totalLandedValue: S.purchaseImportAssessment.totalLandedValue,
    invoiceNumber: S.purchaseBill.invoiceNumber }).from(S.purchaseImportAssessment).innerJoin(S.purchaseBill, eq(S.purchaseBill.id, S.purchaseImportAssessment.importBillId))
    .where(and(...where)).orderBy(desc(S.purchaseImportAssessment.assessmentDate), desc(S.purchaseImportAssessment.id));
  return { total: rows.length, rows: rows.map((r) => ({ ...r, state: stateOf(r) })) };
}

export async function eligibleImportBills(filter: { companyId: number; branchId: number; fiscalYear: string }) {
  const rows = await db.select({ id: S.purchaseBill.id, invoiceNumber: S.purchaseBill.invoiceNumber, invoiceDate: S.purchaseBill.invoiceDate, basicAmount: S.purchaseBill.basicAmount, invoiceType: S.purchaseBill.invoiceType })
    .from(S.purchaseBill).where(and(eq(S.purchaseBill.companyId, filter.companyId), eq(S.purchaseBill.branchId, filter.branchId), eq(S.purchaseBill.fiscalYear, filter.fiscalYear),
      eq(S.purchaseBill.isPosted, true), sql`${S.purchaseBill.purchaseType} IN ('GOODS_PURCHASE_OTHERS','GOODS_PURCHASE_CAPITAL')`, sql`${S.purchaseBill.mainBillId} IS NULL`, sql`${S.purchaseBill.reversalOfId} IS NULL`,
      sql`NOT EXISTS (SELECT 1 FROM "PurchaseBill" r WHERE r."reversalOfId" = "PurchaseBill"."id" AND r."isPosted")`))
    .orderBy(desc(S.purchaseBill.invoiceDate), desc(S.purchaseBill.id));
  const result = [];
  for (const b of rows) {
    const basis = await inTx(undefined, (tx) => importCostBasis(tx, b.id));
    const lineMeta = await db.select({ id: S.purchaseBillLine.id, productId: S.purchaseBillLine.productId, productCode: S.product.code, description: S.product.description })
      .from(S.purchaseBillLine).leftJoin(S.product, eq(S.product.id, S.purchaseBillLine.productId)).where(eq(S.purchaseBillLine.purchaseBillId, b.id));
    const byId = new Map(lineMeta.map((l) => [l.id, l]));
    result.push({ ...b, sources: basis.sources.map((s) => ({ ...s, basicAmount: fmt(s.basicAmount, 2) })), cifValue: fmt(basis.cifValue, 2), lines: basis.lines.map((l) => ({ id: l.id, lineNumber: l.lineNumber, productId: byId.get(l.id)?.productId, productCode: byId.get(l.id)?.productCode, description: byId.get(l.id)?.description, qty: fmt(l.qty), goodsValue: fmt(l.goodsValue, 2), customsValue: fmt(l.customsValue, 2) })) });
  }
  return { rows: result };
}

export async function createImportAssessment(input: AssessmentInput, actor: Actor, opts: AssessmentOpts = {}) {
  const assessmentDate = parseDate(input.assessmentDate, "assessmentDate");
  return inActorTx(actor, opts.tx, async (tx) => {
    await assertBranch(tx, input.companyId, input.branchId);
    await guardPeriod(tx, input.companyId, [assessmentDate], opts.lockOverride, "assessmentDate");
    const fy = await resolveFiscalYear(tx, input.companyId, assessmentDate, input.fiscalYear ?? null);
    const bill = await importBill(tx, input.companyId, input.branchId, input.importBillId, true);
    const terms = await resolveTerms(tx, input.companyId, input.terms);
    const calc = await calculate(tx, bill.id, terms, manualFromResolved(terms));
    const number = await nextAssessmentNumber(tx, input.branchId, fy.code);
    const [doc] = await tx.insert(S.purchaseImportAssessment).values({ companyId: input.companyId, branchId: input.branchId, importBillId: bill.id,
      assessmentNumber: number, assessmentDate, fiscalYear: fy.code, referenceNo: input.referenceNo?.trim() || null, remarks: input.remarks?.trim() || null,
      goodsValue: calc.preview.goodsValue, customsValueFromSources: calc.preview.customsValueFromSources, cifValue: calc.preview.cifValue,
      invoicedCapitalizedCosts: calc.preview.invoicedCapitalizedCosts, assessedNet: calc.preview.assessedNet, capitalizedAssessments: calc.preview.capitalizedAssessments,
      totalLandedValue: calc.preview.totalLandedValue, createdBy: actor.userId, updatedAt: new Date() }).returning();
    await insertTerms(tx, input.companyId, doc.id, bill.id, terms);
    return { id: doc.id, assessmentNumber: doc.assessmentNumber };
  });
}

export async function updateImportAssessment(id: number, companyId: number, input: Omit<AssessmentInput, "id" | "companyId">, actor: Actor, opts: AssessmentOpts = {}) {
  const assessmentDate = parseDate(input.assessmentDate, "assessmentDate");
  return inActorTx(actor, opts.tx, async (tx) => {
    const [old] = await tx.select().from(S.purchaseImportAssessment).where(and(eq(S.purchaseImportAssessment.id, id), eq(S.purchaseImportAssessment.companyId, companyId))).for("update");
    if (!old) throw new HttpError(404, "Import assessment not found.");
    if (old.isPosted || old.reversedAt) throw new HttpError(409, "Only a draft assessment can be edited.");
    const branchId = old.branchId;
    if (input.branchId !== branchId || (input.importBillId !== undefined && input.importBillId !== old.importBillId)) throw new HttpError(400, "An assessment cannot be moved to another branch or import bill.");
    await guardPeriod(tx, companyId, [assessmentDate, old.assessmentDate], opts.lockOverride, "assessmentDate");
    const fy = await resolveFiscalYear(tx, companyId, assessmentDate, input.fiscalYear ?? old.fiscalYear);
    const bill = await importBill(tx, companyId, branchId, old.importBillId, true);
    const terms = await resolveTerms(tx, companyId, input.terms);
    const calc = await calculate(tx, bill.id, terms, manualFromResolved(terms));
    await tx.delete(S.purchaseImportAssessmentTerm).where(eq(S.purchaseImportAssessmentTerm.assessmentId, old.id)); // its manual allocation rows go with it
    await insertTerms(tx, companyId, old.id, bill.id, terms);
    await tx.update(S.purchaseImportAssessment).set({ assessmentDate, fiscalYear: fy.code, referenceNo: input.referenceNo?.trim() || null, remarks: input.remarks?.trim() || null,
      goodsValue: calc.preview.goodsValue, customsValueFromSources: calc.preview.customsValueFromSources, cifValue: calc.preview.cifValue, invoicedCapitalizedCosts: calc.preview.invoicedCapitalizedCosts,
      assessedNet: calc.preview.assessedNet, capitalizedAssessments: calc.preview.capitalizedAssessments, totalLandedValue: calc.preview.totalLandedValue, updatedAt: new Date() }).where(eq(S.purchaseImportAssessment.id, old.id));
    return { id: old.id, assessmentNumber: old.assessmentNumber };
  });
}

export async function getImportAssessment(id: number, companyId: number) {
  return inTx(undefined, async (tx) => {
    const [doc] = await tx.select({ doc: S.purchaseImportAssessment, invoiceNumber: S.purchaseBill.invoiceNumber, importInvoiceDate: S.purchaseBill.invoiceDate })
      .from(S.purchaseImportAssessment).innerJoin(S.purchaseBill, eq(S.purchaseBill.id, S.purchaseImportAssessment.importBillId))
      .where(and(eq(S.purchaseImportAssessment.id, id), eq(S.purchaseImportAssessment.companyId, companyId))).limit(1);
    if (!doc) throw new HttpError(404, "Import assessment not found.");
    const terms = await tx.select().from(S.purchaseImportAssessmentTerm).where(eq(S.purchaseImportAssessmentTerm.assessmentId, id)).orderBy(asc(S.purchaseImportAssessmentTerm.sequence), asc(S.purchaseImportAssessmentTerm.id));
    const ledgerIds = [...new Set(terms.flatMap((t) => [t.generalLedgerId, t.againstLedgerId]).filter((x): x is number => !!x))];
    const ledgers = ledgerIds.length ? await tx.select({ id: S.generalLedger.id, code: S.generalLedger.code, name: S.generalLedger.name }).from(S.generalLedger).where(inArray(S.generalLedger.id, ledgerIds)) : [];
    const ledgerById = new Map(ledgers.map((l) => [l.id, l]));
    const termRows = terms.map((t) => ({ ...t,
      generalLedgerCode: ledgerById.get(t.generalLedgerId ?? -1)?.code ?? null, generalLedgerName: ledgerById.get(t.generalLedgerId ?? -1)?.name ?? null,
      againstLedgerCode: ledgerById.get(t.againstLedgerId ?? -1)?.code ?? null, againstLedgerName: ledgerById.get(t.againstLedgerId ?? -1)?.name ?? null }));
    const voucherIds = [doc.doc.journalVoucherId, doc.doc.reversalVoucherId].filter((x): x is number => !!x);
    const vouchers = voucherIds.length ? await tx.select({ id: S.journalVoucher.id, voucherNumber: S.journalVoucher.voucherNumber }).from(S.journalVoucher).where(inArray(S.journalVoucher.id, voucherIds)) : [];
    const voucherNo = (vid: number | null) => vouchers.find((v) => v.id === vid)?.voucherNumber ?? null;
    const allocations = await tx.select({ id: S.purchaseImportAssessmentAllocation.id, assessmentId: S.purchaseImportAssessmentAllocation.assessmentId, assessmentTermId: S.purchaseImportAssessmentAllocation.assessmentTermId,
      purchaseBillLineId: S.purchaseImportAssessmentAllocation.purchaseBillLineId, allocatedAmount: S.purchaseImportAssessmentAllocation.allocatedAmount, termId: S.purchaseImportAssessmentTerm.termId, termCode: S.purchaseImportAssessmentTerm.code, termName: S.purchaseImportAssessmentTerm.name,
      lineNumber: S.purchaseBillLine.lineNumber, productId: S.purchaseBillLine.productId, productCode: S.product.code, description: S.product.description })
      .from(S.purchaseImportAssessmentAllocation).innerJoin(S.purchaseImportAssessmentTerm, eq(S.purchaseImportAssessmentTerm.id, S.purchaseImportAssessmentAllocation.assessmentTermId))
      .innerJoin(S.purchaseBillLine, eq(S.purchaseBillLine.id, S.purchaseImportAssessmentAllocation.purchaseBillLineId)).leftJoin(S.product, eq(S.product.id, S.purchaseBillLine.productId))
      .where(eq(S.purchaseImportAssessmentAllocation.assessmentId, id)).orderBy(asc(S.purchaseBillLine.lineNumber), asc(S.purchaseImportAssessmentTerm.sequence));
    let lineSnapshots: any[] = [];
    if (doc.doc.isPosted) {
      lineSnapshots = await tx.select({ snapshot: S.purchaseImportAssessmentLine, lineNumber: S.purchaseBillLine.lineNumber, productId: S.purchaseBillLine.productId, productCode: S.product.code, description: S.product.description, qty: S.purchaseBillLine.qty })
        .from(S.purchaseImportAssessmentLine).innerJoin(S.purchaseBillLine, eq(S.purchaseBillLine.id, S.purchaseImportAssessmentLine.purchaseBillLineId)).leftJoin(S.product, eq(S.product.id, S.purchaseBillLine.productId))
        .where(eq(S.purchaseImportAssessmentLine.assessmentId, id)).orderBy(asc(S.purchaseBillLine.lineNumber));
    }
    let preview: any;
    if (doc.doc.isPosted) {
      preview = { goodsValue: doc.doc.goodsValue, customsValueFromSources: doc.doc.customsValueFromSources, cifValue: doc.doc.cifValue, invoicedCapitalizedCosts: doc.doc.invoicedCapitalizedCosts, assessedNet: doc.doc.assessedNet,
        capitalizedAssessments: doc.doc.capitalizedAssessments, totalLandedValue: doc.doc.totalLandedValue,
        existingPurchaseTermCosts: resultAmount(lineSnapshots.reduce((total, row) => total + toMicro(row.snapshot.existingPurchaseTermCosts), ZERO)),
        lines: lineSnapshots.map(({ snapshot, lineNumber, productId, productCode, description, qty }) => ({ id: snapshot.purchaseBillLineId, key: snapshot.purchaseBillLineId, lineNumber, productId, productCode, description, quantity: qty, goodsValue: snapshot.goodsValue, customsValue: snapshot.customsValue, capitalizedSources: snapshot.capitalizedSources, existingPurchaseTermCosts: snapshot.existingPurchaseTermCosts, capitalizedAssessments: snapshot.capitalizedAssessments, landedValue: snapshot.landedValue, landedRate: snapshot.landedRate })),
        terms: terms.map((t) => ({ termId: t.termId, baseAmount: t.baseAmount, calculatedAmount: t.calculatedAmount, finalAmount: t.finalAmount, nature: t.nature })), termResults: terms.map((t) => ({ termId: t.termId, baseAmount: t.baseAmount, calculatedAmount: t.calculatedAmount, finalAmount: t.finalAmount, nature: t.nature })) };
    } else {
      const calculation = await calculate(tx, doc.doc.importBillId, terms, manualFromRows(allocations));
      preview = previewBody(calculation);
    }
    return { document: { ...doc.doc, state: stateOf(doc.doc), invoiceNumber: doc.invoiceNumber, importInvoiceDate: doc.importInvoiceDate, voucherNumber: voucherNo(doc.doc.journalVoucherId), reversalVoucherNumber: voucherNo(doc.doc.reversalVoucherId), terms: termRows.map((t) => ({ ...t, manualAmounts: t.allocationMode === "MANUAL" ? allocations.filter((a) => a.assessmentTermId === t.id).map((a) => ({ purchaseBillLineId: a.purchaseBillLineId, amount: a.allocatedAmount })) : [] })), allocations, preview, lineSnapshots: lineSnapshots.map((r) => r.snapshot) } };
  });
}

export async function deleteImportAssessment(id: number, companyId: number, actor: Actor, opts: AssessmentOpts = {}) {
  return inActorTx(actor, opts.tx, async (tx) => {
    const [doc] = await tx.select().from(S.purchaseImportAssessment).where(and(eq(S.purchaseImportAssessment.id, id), eq(S.purchaseImportAssessment.companyId, companyId))).for("update");
    if (!doc) throw new HttpError(404, "Import assessment not found.");
    if (doc.isPosted || doc.reversedAt) throw new HttpError(409, "Only a draft assessment can be deleted.");
    await guardPeriod(tx, companyId, [doc.assessmentDate], opts.lockOverride, "assessmentDate");
    await tx.delete(S.purchaseImportAssessment).where(eq(S.purchaseImportAssessment.id, id));
    return { id };
  });
}

export async function applyImportAssessment(id: number, companyId: number, actor: Actor, opts: AssessmentOpts = {}) {
  return inActorTx(actor, opts.tx, async (tx) => {
    const [doc] = await tx.select().from(S.purchaseImportAssessment).where(and(eq(S.purchaseImportAssessment.id, id), eq(S.purchaseImportAssessment.companyId, companyId))).for("update");
    if (!doc) throw new HttpError(404, "Import assessment not found.");
    if (doc.isPosted || doc.reversedAt) throw new HttpError(409, "This assessment is not an unapplied draft.");
    await guardPeriod(tx, companyId, [doc.assessmentDate], opts.lockOverride, "assessmentDate");
    const bill = await importBill(tx, companyId, doc.branchId, doc.importBillId, true);
    const terms = await tx.select().from(S.purchaseImportAssessmentTerm).where(eq(S.purchaseImportAssessmentTerm.assessmentId, id)).orderBy(asc(S.purchaseImportAssessmentTerm.sequence), asc(S.purchaseImportAssessmentTerm.id));
    // Product-wise amounts typed by hand are stored as draft allocation rows: read them before the rows are rebuilt.
    const typed = await tx.select({ assessmentTermId: S.purchaseImportAssessmentAllocation.assessmentTermId, purchaseBillLineId: S.purchaseImportAssessmentAllocation.purchaseBillLineId, allocatedAmount: S.purchaseImportAssessmentAllocation.allocatedAmount })
      .from(S.purchaseImportAssessmentAllocation).where(eq(S.purchaseImportAssessmentAllocation.assessmentId, id));
    const calc = await calculate(tx, bill.id, terms, manualFromRows(typed));
    for (const t of terms) {
      const difference = calc.result.manualDifference.get(t.id);
      if (difference !== undefined && difference !== ZERO) {
        throw new HttpError(409, `Charge ${t.code} (${t.name}): the product-wise amounts are ${fmt(difference, 2)} away from the charge. Make them add up before applying.`, "terms");
      }
    }
    await tx.delete(S.purchaseImportAssessmentAllocation).where(eq(S.purchaseImportAssessmentAllocation.assessmentId, id));
    await tx.delete(S.purchaseImportAssessmentLine).where(eq(S.purchaseImportAssessmentLine.assessmentId, id));
    const termUpdates = terms.map((t) => {
      const r = calc.result.termResults.get(t.id)!;
      return tx.update(S.purchaseImportAssessmentTerm).set({ baseAmount: fmt(r.baseAmount, 2), calculatedAmount: fmt(r.calculatedAmount, 2), finalAmount: fmt(r.finalAmount, 2) }).where(eq(S.purchaseImportAssessmentTerm.id, t.id));
    });
    await Promise.all(termUpdates);
    const allocations = [...calc.result.termAllocations.entries()].flatMap(([termId, perLine]) => [...perLine.entries()].map(([lineId, value]) => ({ companyId, assessmentId: id, assessmentTermId: termId, purchaseBillLineId: lineId, allocatedAmount: fmt(value, 2) })));
    if (allocations.length) await tx.insert(S.purchaseImportAssessmentAllocation).values(allocations);
    const snapshots = calc.lineDtos.map((line) => ({ companyId, assessmentId: id, purchaseBillLineId: line.id, goodsValue: line.goodsValue, customsValue: line.customsValue, capitalizedSources: line.capitalizedSources, existingPurchaseTermCosts: line.existingPurchaseTermCosts, capitalizedAssessments: line.capitalizedAssessments, landedValue: line.landedValue, landedRate: line.landedRate }));
    if (snapshots.length) await tx.insert(S.purchaseImportAssessmentLine).values(snapshots);

    // What the assessment records is posted too: for every charge, Dr its own ledger / Cr its against ledger (swapped for a
    // deductive charge). Whether a charge also enters stock value (capitalizable) is a separate question, answered above.
    const voucherRows: JvRow[] = [];
    for (const t of terms) {
      const amount = calc.result.termResults.get(t.id)!.finalAmount;
      if (amount === ZERO) continue;
      const label = `${t.code} (${t.name})`;
      if (!t.generalLedgerId) throw new HttpError(409, `Charge ${label} has no ledger of its own; set one in the term master.`, "terms");
      if (!t.againstLedgerId) throw new HttpError(409, `Charge ${label}: choose the against ledger (where it is paid from, or who it is owed to).`, "terms");
      const against = await checkAgainstLedger(tx, companyId, t.code, t.againstLedgerId, t.againstSubLedgerId);
      if (against.requiresSubLedger && !t.againstSubLedgerId) throw new HttpError(400, `Charge ${label}: ledger ${against.code} needs a sub-ledger.`, "terms");
      const note = `${t.name} ${doc.assessmentNumber}`;
      const own = { generalLedgerId: t.generalLedgerId, narration: note };
      const other = { generalLedgerId: t.againstLedgerId, narration: `${note} (against)` };
      if (t.nature === "ADDITIVE") voucherRows.push({ ...own, debit: amount, credit: ZERO }, { ...other, debit: ZERO, credit: amount });
      else voucherRows.push({ ...other, debit: amount, credit: ZERO }, { ...own, debit: ZERO, credit: amount });
    }
    const journal = mergeRows(voucherRows);
    const dr = journal.reduce((a, r) => a + r.debit, ZERO), cr = journal.reduce((a, r) => a + r.credit, ZERO);
    if (dr !== cr) throw new HttpError(500, `Journal does not balance (Dr ${fmt(dr, 2)} / Cr ${fmt(cr, 2)}). Nothing was posted.`);
    const voucherId = journal.length
      ? await writeVoucher(tx, { companyId, branchId: doc.branchId, voucherNumber: voucherNumberFor(doc), voucherDate: doc.assessmentDate, fiscalYear: doc.fiscalYear, remarks: `Cost assessment ${doc.assessmentNumber}`, reversalOfId: null }, journal, actor)
      : null;

    await tx.update(S.purchaseImportAssessment).set({ isPosted: true, glPosted: voucherId !== null, journalVoucherId: voucherId, appliedAt: new Date(), appliedBy: actor.userId, goodsValue: calc.preview.goodsValue, customsValueFromSources: calc.preview.customsValueFromSources,
      cifValue: calc.preview.cifValue, invoicedCapitalizedCosts: calc.preview.invoicedCapitalizedCosts, assessedNet: calc.preview.assessedNet, capitalizedAssessments: calc.preview.capitalizedAssessments,
      totalLandedValue: calc.preview.totalLandedValue, updatedAt: new Date() }).where(eq(S.purchaseImportAssessment.id, id));
    const targetLines = await tx.select({ id: S.purchaseBillLine.id }).from(S.purchaseBillLine).where(eq(S.purchaseBillLine.purchaseBillId, bill.id));
    await recomputeLanded(tx, targetLines.map((l) => l.id));
    return { id, assessmentNumber: doc.assessmentNumber, journalVoucherId: voucherId, voucherNumber: voucherId ? voucherNumberFor(doc) : null };
  });
}

export async function reverseImportAssessment(id: number, companyId: number, actor: Actor & { reason: string }, opts: AssessmentOpts = {}) {
  const reason = actor.reason?.trim();
  if (!reason) throw new HttpError(400, "A reason is required to reverse an applied assessment.", "reason");
  return inActorTx({ ...actor, reason }, opts.tx, async (tx) => {
    const [doc] = await tx.select().from(S.purchaseImportAssessment).where(and(eq(S.purchaseImportAssessment.id, id), eq(S.purchaseImportAssessment.companyId, companyId))).for("update");
    if (!doc) throw new HttpError(404, "Import assessment not found.");
    if (!doc.isPosted || doc.reversedAt) throw new HttpError(409, "Only an active applied assessment can be reversed.");
    await guardPeriod(tx, companyId, [doc.assessmentDate], opts.lockOverride, "assessmentDate");
    await importBill(tx, companyId, doc.branchId, doc.importBillId, true);
    // An assessment that posted a voucher is undone by a mirror voucher (Dr and Cr swapped), dated in an open period.
    let reversalVoucherId: number | null = null;
    if (doc.glPosted && doc.journalVoucherId) {
      const date = opts.date ? parseDate(opts.date, "date") : today();
      if (date.getTime() < doc.assessmentDate.getTime()) throw new HttpError(400, "A reversal cannot be dated before the assessment it reverses.", "date");
      await guardPeriod(tx, companyId, [date], opts.lockOverride, "date");
      const fy = await resolveFiscalYear(tx, companyId, date, null);
      const [ojv] = await tx.select().from(S.journalVoucher).where(eq(S.journalVoucher.id, doc.journalVoucherId));
      const ojl = await tx.select().from(S.journalVoucherLine).where(eq(S.journalVoucherLine.journalVoucherId, ojv.id)).orderBy(asc(S.journalVoucherLine.lineNumber));
      const swapped: JvRow[] = ojl.map((l) => ({ generalLedgerId: l.generalLedgerId, debit: toMicro(l.credit), credit: toMicro(l.debit), narration: `Reversal: ${l.narration ?? ""}`.slice(0, 500), agentId: l.agentId }));
      const number = `R-${ojv.voucherNumber}`.length <= 30 ? `R-${ojv.voucherNumber}` : `R-${ojv.id}`;
      reversalVoucherId = await writeVoucher(tx, { companyId, branchId: doc.branchId, voucherNumber: number, voucherDate: date, fiscalYear: fy.code, remarks: `Reversal of cost assessment ${doc.assessmentNumber}: ${reason}`.slice(0, 1024), reversalOfId: ojv.id }, swapped, actor);
    }
    await tx.update(S.purchaseImportAssessment).set({ reversedAt: new Date(), reversedBy: actor.userId, reversalReason: reason, reversalVoucherId, updatedAt: new Date() }).where(eq(S.purchaseImportAssessment.id, id));
    const targetLines = await tx.select({ id: S.purchaseBillLine.id }).from(S.purchaseBillLine).where(eq(S.purchaseBillLine.purchaseBillId, doc.importBillId));
    await recomputeLanded(tx, targetLines.map((l) => l.id));
    return { id, assessmentNumber: doc.assessmentNumber };
  });
}
