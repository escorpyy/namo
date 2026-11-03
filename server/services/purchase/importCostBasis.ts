import { and, asc, eq, sql } from "drizzle-orm";
import * as S from "../../db/schema";
import { type Tx } from "./common";
import { allocate } from "./landed";
import { ZERO, toMicro, type Micro } from "./money";

export interface ImportBasisLine {
  id: number;
  lineNumber: number;
  qty: Micro;
  goodsValue: Micro;
  customsValue: Micro;
  sourceCost: Micro;
  cifSourceCost: Micro;
  landedOnlyCost: Micro;
}

export interface ImportBasisSource {
  id: number;
  invoiceNumber: string;
  vendorInvoiceNo: string | null;
  basicAmount: Micro;
  allocationBasis: "VALUE" | "QUANTITY";
  treatment: "CIF" | "LANDED_ONLY";
}

/**
 * Load the posted, unreversed service purchase invoices linked to an import goods bill and allocate
 * their tax-exclusive basic amounts to the goods lines. This affects CIF/landed valuation only;
 * each linked service bill keeps its own ordinary periodic-inventory journal posting.
 */
export async function importCostBasis(tx: Tx, goodsBillId: number) {
  const lines = await tx.select({
    id: S.purchaseBillLine.id,
    lineNumber: S.purchaseBillLine.lineNumber,
    qty: S.purchaseBillLine.qty,
    basicAmount: S.purchaseBillLine.basicAmount,
  }).from(S.purchaseBillLine).where(eq(S.purchaseBillLine.purchaseBillId, goodsBillId)).orderBy(asc(S.purchaseBillLine.lineNumber));

  const active = sql`not exists (
    select 1 from "PurchaseBill" r
     where r."reversalOfId" = ${S.purchaseBill.id} and r."isPosted"
  )`;
  const sourceRows = await tx.select({
    id: S.purchaseBill.id,
    invoiceNumber: S.purchaseBill.invoiceNumber,
    vendorInvoiceNo: S.purchaseBill.vendorInvoiceNo,
    basicAmount: S.purchaseBill.basicAmount,
    allocationBasis: S.purchaseBill.importCostAllocationBasis,
    treatment: S.purchaseBill.importCostTreatment,
  }).from(S.purchaseBill).where(and(
    eq(S.purchaseBill.importCostForBillId, goodsBillId),
    eq(S.purchaseBill.isPosted, true),
    sql`${S.purchaseBill.reversalOfId} is null`,
    active,
  )).orderBy(asc(S.purchaseBill.invoiceDate), asc(S.purchaseBill.id));

  const basisLines = lines.map((line) => ({
    id: line.id,
    lineNumber: line.lineNumber,
    qty: toMicro(line.qty),
    goodsValue: toMicro(line.basicAmount),
    customsValue: toMicro(line.basicAmount),
    sourceCost: ZERO as Micro,
    cifSourceCost: ZERO as Micro,
    landedOnlyCost: ZERO as Micro,
  }));
  const sources: ImportBasisSource[] = sourceRows.map((source) => ({
    ...source,
    basicAmount: toMicro(source.basicAmount),
    allocationBasis: source.allocationBasis,
    // The database CHECK constraint limits this varchar to the two treatment values.
    treatment: source.treatment as ImportBasisSource["treatment"],
  }));

  for (const source of sources) {
    const weights = basisLines.map((line) => source.allocationBasis === "QUANTITY" ? line.qty : line.goodsValue);
    const split = allocate(source.basicAmount, weights);
    for (let i = 0; i < basisLines.length; i++) {
      basisLines[i].sourceCost += split[i];
      if (source.treatment === "CIF") {
        basisLines[i].customsValue += split[i];
        basisLines[i].cifSourceCost += split[i];
      } else {
        basisLines[i].landedOnlyCost += split[i];
      }
    }
  }

  return {
    lines: basisLines,
    sources,
    goodsValue: basisLines.reduce((sum, line) => sum + line.goodsValue, ZERO as Micro),
    cifValue: basisLines.reduce((sum, line) => sum + line.customsValue, ZERO as Micro),
    landedValue: basisLines.reduce((sum, line) => sum + line.goodsValue + line.sourceCost, ZERO as Micro),
    cifSourceCost: basisLines.reduce((sum, line) => sum + line.cifSourceCost, ZERO as Micro),
    landedOnlyCost: basisLines.reduce((sum, line) => sum + line.landedOnlyCost, ZERO as Micro),
    linkedCost: sources.reduce((sum, source) => sum + source.basicAmount, ZERO as Micro),
  };
}
