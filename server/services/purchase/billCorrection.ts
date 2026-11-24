import { and, asc, eq } from "drizzle-orm";
import * as S from "../../db/schema";
import { HttpError } from "../../routes/_util";
import { type Actor, type Opts, type Tx, inActorTx, today } from "./common";
import { type BillLineInput, type LockOpts, type PurchaseBillInput, reversePurchaseBill, savePurchaseBill } from "./purchaseBill";
import type { TermInput } from "./docTerms";

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

// A bill's header, lines, terms and import detail as the input that would save it again: the starting point for a corrected bill.
export async function billInputFromBill(tx: Tx, companyId: number, billId: number): Promise<PurchaseBillInput> {
  const B = S.purchaseBill;
  const [b] = await tx.select().from(B).where(and(eq(B.id, billId), eq(B.companyId, companyId)));
  if (!b) throw new HttpError(404, "Purchase bill not found.");
  if (b.reversalOfId || b.returnOfBillId || b.mainBillId || b.importCostForBillId) throw new HttpError(409, "Only a main purchase bill can be corrected this way.");
  const lines = await tx.select().from(S.purchaseBillLine).where(eq(S.purchaseBillLine.purchaseBillId, billId)).orderBy(asc(S.purchaseBillLine.lineNumber));
  const terms = await tx.select().from(S.purchaseDocumentTerm).where(and(eq(S.purchaseDocumentTerm.documentType, "PURCHASE_BILL"), eq(S.purchaseDocumentTerm.documentId, billId))).orderBy(asc(S.purchaseDocumentTerm.sequence), asc(S.purchaseDocumentTerm.id));
  const [d] = await tx.select().from(S.purchaseBillImportDetail).where(eq(S.purchaseBillImportDetail.purchaseBillId, billId));
  const lineNo = new Map(lines.map((l) => [l.id, l.lineNumber]));
  const isImport = b.invoiceType === "IMPORT";
  const foreign = isImport && d?.currencyCode && d.currencyCode !== "NPR";
  return {
    companyId: b.companyId, branchId: b.branchId, invoiceDate: day(b.invoiceDate)!, invoiceType: b.invoiceType, purchaseType: b.purchaseType,
    vendorGLId: b.vendorGLId, subLedgerId: b.subLedgerId, agentId: b.agentId, vendorInvoiceNo: b.vendorInvoiceNo, vendorInvoiceDate: day(b.vendorInvoiceDate),
    purchaseChallanId: b.purchaseChallanId, purchaseOrderId: b.purchaseOrderId, dueDays: b.dueDays, remarks: b.remarks, tdsApplicable: b.tdsApplicable,
    lines: lines.map((l): BillLineInput => ({
      productId: l.productId, qty: l.qty, unitId: l.unitId, rate: l.rate, altQty: l.altQty, altUnitId: l.altUnitId, challanLineId: l.challanLineId, purchaseOrderLineId: l.purchaseOrderLineId,
      locationId: l.locationId, batchNo: l.batchNo, manufactureDate: day(l.manufactureDate), expiryDate: day(l.expiryDate), foreignRate: foreign ? l.foreignRate : null,
    })),
    terms: terms.map((t): TermInput => ({
      termId: t.termId, lineNumber: t.documentLineId ? lineNo.get(t.documentLineId) ?? null : null, calcType: t.calcType, rate: t.rate, inputAmount: t.inputAmount,
      isOverridden: t.isOverridden, overrideAmount: t.isOverridden ? t.finalAmount : null,
    })),
    importDetail: isImport && d ? {
      customsDeclarationNo: d.customsDeclarationNo ?? undefined, customsDeclarationDate: day(d.customsDeclarationDate) ?? undefined, customsOffice: d.customsOffice ?? undefined, countryOfOrigin: d.countryOfOrigin ?? undefined,
      lcNo: d.lcNo ?? undefined, lcDate: day(d.lcDate) ?? undefined, lcBankName: d.lcBankName ?? undefined, transportMode: d.transportMode ?? undefined, blAwbNo: d.blAwbNo ?? undefined, blAwbDate: day(d.blAwbDate) ?? undefined,
      transporterName: d.transporterName ?? undefined, vehicleNo: d.vehicleNo ?? undefined, lrNo: d.lrNo ?? undefined, lrDate: day(d.lrDate) ?? undefined, importPermitNo: d.importPermitNo ?? undefined, importPermitDate: day(d.importPermitDate) ?? undefined,
      currencyCode: d.currencyCode ?? undefined, exchangeRate: d.exchangeRate ?? undefined, foreignInvoiceAmount: d.foreignInvoiceAmount ?? undefined,
    } : null,
  };
}

// CORRECT A POSTED BILL: reverse it and, in the same transaction, save a draft copy dated the day of the reversal. The draft carries every line,
// term and header field of the original (the vendor invoice number is free again once the bill is reversed), so the person only changes what was wrong
// and posts it. If the reversal is refused (linked bills, an applied assessment, a locked period) nothing is changed and no draft is made.
export function reverseAndCopyPurchaseBill(id: number, companyId: number, actor: Actor, opts: Opts & LockOpts & { date?: string | Date; reason?: string } = {}) {
  return inActorTx({ ...actor, reason: opts.reason }, opts.tx, async (tx) => {
    const input = await billInputFromBill(tx, companyId, id);
    const date = opts.date ?? today();
    const reversal = await reversePurchaseBill(id, actor, { tx, date, reason: opts.reason, lockOverride: opts.lockOverride });
    const draft = await savePurchaseBill({ ...input, invoiceDate: date }, actor, { tx, lockOverride: opts.lockOverride });
    return { reversal, draft };
  });
}
