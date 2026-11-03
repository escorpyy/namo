import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db";
import * as S from "../../db/schema";
import { HttpError } from "../../routes/_util";
import { calculateImportCosting, type ImportAssessmentTermInput, type ImportCostLineInput, type ImportCostSourceInput } from "../../../shared/import-costing";
import { fmt, toMicro, type EngineTerm, type Micro, ZERO } from "../../../shared/purchase-calculation";
import { guardPeriod, type LockOverride } from "../periodLock";
import { type Actor, type Opts, type Tx, assertBranch, inActorTx, inTx, parseDate, resolveFiscalYear } from "./common";
import { importCostBasis } from "./importCostBasis";
import { recomputeLanded } from "./purchaseBill";

type Basis = "VALUE" | "QUANTITY";
type TermInput = { termId: number; calcType?: "PERCENT" | "AMOUNT"; rate?: string | number | null; inputAmount?: string | number | null; isOverridden?: boolean; overrideAmount?: string | number | null; allocationBasis: Basis; capitalizable: boolean };
export type AssessmentInput = { id?: number; companyId: number; branchId: number; fiscalYear?: string; importBillId: number; assessmentDate: string | Date; referenceNo?: string | null; remarks?: string | null; terms: TermInput[] };
type AssessmentOpts = Opts & { lockOverride?: LockOverride | null };

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

async function importBill(tx: Tx, companyId: number, branchId: number, billId: number, lock = false) {
  let query = tx.select().from(S.purchaseBill).where(and(eq(S.purchaseBill.id, billId), eq(S.purchaseBill.companyId, companyId)));
  if (lock) query = query.for("update") as typeof query;
  const [bill] = await query;
  if (!bill) throw new HttpError(404, "Import goods bill not found in this company.", "importBillId");
  if (bill.branchId !== branchId) throw new HttpError(400, "Assessment and import goods bill must be in the same branch.", "importBillId");
  if (bill.invoiceType !== "IMPORT" || !bill.purchaseType.startsWith("GOODS_PURCHASE_") || bill.mainBillId || bill.reversalOfId) {
    throw new HttpError(400, "An assessment must be linked to a main import goods bill.", "importBillId");
  }
  const [reversal] = await tx.select({ id: S.purchaseBill.id }).from(S.purchaseBill).where(and(eq(S.purchaseBill.reversalOfId, bill.id), eq(S.purchaseBill.isPosted, true))).limit(1);
  if (!bill.isPosted || reversal) throw new HttpError(409, "The import goods bill must be posted and active before assessment.", "importBillId");
  return bill;
}

async function resolveTerms(tx: Tx, companyId: number, input: TermInput[]) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 100) throw new HttpError(400, "Add between 1 and 100 assessed charge terms.", "terms");
  const ids = input.map((t) => t?.termId);
  if (ids.some((id) => !Number.isInteger(id) || id <= 0) || new Set(ids).size !== ids.length) throw new HttpError(400, "Each assessed charge must use a distinct valid term.", "terms");
  const masters = await tx.select().from(S.purchaseTerm).where(and(eq(S.purchaseTerm.companyId, companyId), inArray(S.purchaseTerm.id, ids)));
  if (masters.length !== ids.length) throw new HttpError(400, "One or more charge terms do not belong to this company.", "terms");
  const byId = new Map(masters.map((m) => [m.id, m]));
  return input.map((value) => {
    const master = byId.get(value.termId)!;
    if (!master.isActive) throw new HttpError(409, `Charge term ${master.code} is inactive.`, "terms");
    if (master.category !== "ADDITIONAL") throw new HttpError(400, `Charge term ${master.code} is not in the additional assessed-charge category.`, "terms");
    if (master.isProductwise) throw new HttpError(400, `Charge term ${master.code} must be a header-level term.`, "terms");
    if (!basisOk(value.allocationBasis)) throw new HttpError(400, `Charge term ${master.code} needs VALUE or QUANTITY allocation.`, "terms");
    if (typeof value.capitalizable !== "boolean") throw new HttpError(400, `Charge term ${master.code} must explicitly say whether it is capitalizable.`, "terms");
    const calcType = value.calcType ?? master.defaultCalcType;
    if (calcType !== "PERCENT" && calcType !== "AMOUNT") throw new HttpError(400, `Charge term ${master.code} has an invalid calculation type.`, "terms");
    const rate = calcType === "PERCENT" ? amountText(value.rate ?? master.defaultValue, `${master.code} rate`) : null;
    const inputAmount = calcType === "AMOUNT" ? amountText(value.inputAmount ?? master.defaultValue, `${master.code} amount`) : null;
    const isOverridden = value.isOverridden === true;
    const overrideAmount = isOverridden ? amountText(value.overrideAmount, `${master.code} override`) : null;
    const baseTermId = master.calcBase === "SINGLE_TERM" ? master.baseTermId : null;
    if (master.calcBase === "SINGLE_TERM" && !baseTermId) throw new HttpError(400, `Charge term ${master.code} has no single-term base configured.`, "terms");
    return { termId: master.id, code: master.code, name: master.name, nature: master.nature, calcBase: master.calcBase, baseTermId, sequence: master.sequence, calcType, rate, inputAmount, isOverridden, overrideAmount, allocationBasis: value.allocationBasis, capitalizable: value.capitalizable };
  });
}

async function calculate(tx: Tx, targetBillId: number, terms: any[]) {
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
  const productRows = await tx.select({ id: S.purchaseBillLine.id, productId: S.purchaseBillLine.productId, productCode: S.product.code, description: S.product.description, qty: S.purchaseBillLine.qty }).from(S.purchaseBillLine)
    .leftJoin(S.product, eq(S.product.id, S.purchaseBillLine.productId)).where(eq(S.purchaseBillLine.purchaseBillId, targetBillId));
  const productByLine = new Map(productRows.map((l) => [l.id, l]));
  const lines: ImportCostLineInput[] = basis.lines.map((line) => ({ key: line.id, lineNumber: line.lineNumber, quantity: fmt(line.qty), goodsValue: fmt(line.goodsValue, 2), existingPurchaseTermCosts: fmt(priorTermByLine.get(line.id) ?? ZERO, 2) }));
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
    return { term: engine, allocationBasis: row.allocationBasis as Basis, capitalizable: !!row.capitalizable } satisfies ImportAssessmentTermInput;
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
    return { termId: row.term.termId, key: row.term.key, baseAmount: resultAmount(r.baseAmount), calculatedAmount: resultAmount(r.calculatedAmount), finalAmount: resultAmount(r.finalAmount), nature: row.term.nature };
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
    return { preview: previewBody(await calculate(tx, input.importBillId, terms)) };
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
  const rows = await db.select({ id: S.purchaseBill.id, invoiceNumber: S.purchaseBill.invoiceNumber, invoiceDate: S.purchaseBill.invoiceDate, basicAmount: S.purchaseBill.basicAmount })
    .from(S.purchaseBill).where(and(eq(S.purchaseBill.companyId, filter.companyId), eq(S.purchaseBill.branchId, filter.branchId), eq(S.purchaseBill.fiscalYear, filter.fiscalYear), eq(S.purchaseBill.invoiceType, "IMPORT"),
      eq(S.purchaseBill.isPosted, true), sql`${S.purchaseBill.purchaseType} IN ('GOODS_PURCHASE_OTHERS','GOODS_PURCHASE_CAPITAL')`, sql`${S.purchaseBill.mainBillId} IS NULL`, sql`${S.purchaseBill.reversalOfId} IS NULL`,
      sql`NOT EXISTS (SELECT 1 FROM "PurchaseBill" r WHERE r."reversalOfId" = "PurchaseBill"."id" AND r."isPosted")`,
      sql`NOT EXISTS (SELECT 1 FROM "PurchaseImportAssessment" a WHERE a."importBillId" = "PurchaseBill"."id" AND a."reversedAt" IS NULL)`))
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
    const [existing] = await tx.select({ id: S.purchaseImportAssessment.id }).from(S.purchaseImportAssessment).where(and(eq(S.purchaseImportAssessment.importBillId, bill.id), sql`${S.purchaseImportAssessment.reversedAt} IS NULL`)).limit(1);
    if (existing) throw new HttpError(409, "This import bill already has an assessment. Open or reverse it before creating another.", "importBillId");
    const terms = await resolveTerms(tx, input.companyId, input.terms);
    const calc = await calculate(tx, bill.id, terms);
    const number = await nextAssessmentNumber(tx, input.branchId, fy.code);
    const [doc] = await tx.insert(S.purchaseImportAssessment).values({ companyId: input.companyId, branchId: input.branchId, importBillId: bill.id,
      assessmentNumber: number, assessmentDate, fiscalYear: fy.code, referenceNo: input.referenceNo?.trim() || null, remarks: input.remarks?.trim() || null,
      goodsValue: calc.preview.goodsValue, customsValueFromSources: calc.preview.customsValueFromSources, cifValue: calc.preview.cifValue,
      invoicedCapitalizedCosts: calc.preview.invoicedCapitalizedCosts, assessedNet: calc.preview.assessedNet, capitalizedAssessments: calc.preview.capitalizedAssessments,
      totalLandedValue: calc.preview.totalLandedValue, createdBy: actor.userId, updatedAt: new Date() }).returning();
    const snapshotRows = terms.map((t) => ({ companyId: input.companyId, assessmentId: doc.id, ...t, baseAmount: "0", calculatedAmount: "0", finalAmount: "0" }));
    await tx.insert(S.purchaseImportAssessmentTerm).values(snapshotRows);
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
    const calc = await calculate(tx, bill.id, terms);
    await tx.delete(S.purchaseImportAssessmentTerm).where(eq(S.purchaseImportAssessmentTerm.assessmentId, old.id));
    await tx.insert(S.purchaseImportAssessmentTerm).values(terms.map((t) => ({ companyId, assessmentId: old.id, ...t, baseAmount: "0", calculatedAmount: "0", finalAmount: "0" })));
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
      const calculation = await calculate(tx, doc.doc.importBillId, terms);
      preview = previewBody(calculation);
    }
    return { document: { ...doc.doc, state: stateOf(doc.doc), invoiceNumber: doc.invoiceNumber, importInvoiceDate: doc.importInvoiceDate, terms, allocations, preview, lineSnapshots: lineSnapshots.map((r) => r.snapshot) } };
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
    const [existing] = await tx.select({ id: S.purchaseImportAssessment.id }).from(S.purchaseImportAssessment)
      .where(and(eq(S.purchaseImportAssessment.importBillId, bill.id), sql`${S.purchaseImportAssessment.reversedAt} IS NULL`, sql`${S.purchaseImportAssessment.id} <> ${id}`)).limit(1);
    if (existing) throw new HttpError(409, "Another draft or applied assessment already exists for this import bill.");
    const terms = await tx.select().from(S.purchaseImportAssessmentTerm).where(eq(S.purchaseImportAssessmentTerm.assessmentId, id)).orderBy(asc(S.purchaseImportAssessmentTerm.sequence), asc(S.purchaseImportAssessmentTerm.id));
    const calc = await calculate(tx, bill.id, terms);
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
    await tx.update(S.purchaseImportAssessment).set({ isPosted: true, appliedAt: new Date(), appliedBy: actor.userId, goodsValue: calc.preview.goodsValue, customsValueFromSources: calc.preview.customsValueFromSources,
      cifValue: calc.preview.cifValue, invoicedCapitalizedCosts: calc.preview.invoicedCapitalizedCosts, assessedNet: calc.preview.assessedNet, capitalizedAssessments: calc.preview.capitalizedAssessments,
      totalLandedValue: calc.preview.totalLandedValue, updatedAt: new Date() }).where(eq(S.purchaseImportAssessment.id, id));
    const targetLines = await tx.select({ id: S.purchaseBillLine.id }).from(S.purchaseBillLine).where(eq(S.purchaseBillLine.purchaseBillId, bill.id));
    await recomputeLanded(tx, targetLines.map((l) => l.id));
    return { id, assessmentNumber: doc.assessmentNumber };
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
    await tx.update(S.purchaseImportAssessment).set({ reversedAt: new Date(), reversedBy: actor.userId, reversalReason: reason, updatedAt: new Date() }).where(eq(S.purchaseImportAssessment.id, id));
    const targetLines = await tx.select({ id: S.purchaseBillLine.id }).from(S.purchaseBillLine).where(eq(S.purchaseBillLine.purchaseBillId, doc.importBillId));
    await recomputeLanded(tx, targetLines.map((l) => l.id));
    return { id, assessmentNumber: doc.assessmentNumber };
  });
}
