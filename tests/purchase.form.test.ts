import { describe, expect, it } from "vitest";
import { addDaysIso, blankLine, blankTerm, copyBillForm, pickableTerms } from "../src/lib/purchaseForm";

// Copying a bill keeps what is worth re-using and drops everything that identifies the original or links it to other documents.
describe("copyBillForm", () => {
  const source = {
    invoiceDate: "2025-08-01", vendorInvoiceNo: "INV-77", vendorInvoiceDate: "2025-07-30", dueDays: "30", dueDate: "2025-08-31", remarks: "keep me",
    vendorGLId: "5", purchaseType: "GOODS_PURCHASE_OTHERS", importCostForBillId: "12",
    purchaseChallanId: "3", purchaseOrderId: "4", challanNo: "CH-1", orderNo: "PO-1",
    lines: [blankLine({ productId: "9", qty: "10", rate: "100", batchNo: "B1", purchaseOrderLineId: "41", challanLineId: "31", link: "Order line 1 · Challan line 1" })],
    terms: [blankTerm({ termId: "2", calcType: "AMOUNT", inputAmount: "50", finalAmount: "50.00" })],
    imp: { customsDeclarationNo: "CUS-9", customsDeclarationDate: "2025-07-29", lcNo: "LC-1", customsOffice: "Birgunj" },
  };
  const copy = copyBillForm(source, "2025-11-07");
  it("starts today, with no vendor invoice no., due date, links or declaration no.", () => {
    expect(copy).toMatchObject({ invoiceDate: "2025-11-07", vendorInvoiceNo: "", vendorInvoiceDate: "", dueDate: "", purchaseChallanId: "", purchaseOrderId: "", challanNo: "", orderNo: "" });
    expect(copy.lines[0]).toMatchObject({ purchaseOrderLineId: "", challanLineId: "", link: "" });
    expect(copy.imp).toMatchObject({ customsDeclarationNo: "", customsDeclarationDate: "" });
  });
  it("keeps the vendor, lines, charges, terms of payment and other import details", () => {
    expect(copy).toMatchObject({ vendorGLId: "5", purchaseType: "GOODS_PURCHASE_OTHERS", importCostForBillId: "12", dueDays: "30", remarks: "keep me" });
    expect(copy.lines[0]).toMatchObject({ productId: "9", qty: "10", rate: "100", batchNo: "B1" });
    expect(copy.terms[0]).toMatchObject({ termId: "2", calcType: "AMOUNT", inputAmount: "50", finalAmount: "" });
    expect(copy.imp).toMatchObject({ lcNo: "LC-1", customsOffice: "Birgunj" });
  });
  it("gives every row a new key and leaves the original untouched", () => {
    expect(copy.lines[0].key).not.toBe(source.lines[0].key);
    expect(copy.terms[0].key).not.toBe(source.terms[0].key);
    expect(source.vendorInvoiceNo).toBe("INV-77");
    expect(source.lines[0].challanLineId).toBe("31");
    expect(source.imp.customsDeclarationNo).toBe("CUS-9");
  });
});

// A purchase bill's term picker hides ADDITIONAL terms only. Round Off (ROUNDED) and the ordinary GENERAL terms must stay selectable.
describe("pickableTerms", () => {
  const terms = [
    { code: "DISC", category: "GENERAL", isProductwise: true },
    { code: "VAT", category: "GENERAL", isProductwise: false },
    { code: "ROUND", category: "ROUNDED", isProductwise: false },
    { code: "CUSTOMS", category: "ADDITIONAL", isProductwise: false },
  ];
  const codes = (r: { code: string }[]) => r.map((t) => t.code);
  it("a bill (exclude ADDITIONAL) keeps GENERAL and ROUNDED terms and hides the additional charge", () => {
    expect(codes(pickableTerms(terms, { excludeCategory: "ADDITIONAL" }))).toEqual(["DISC", "VAT", "ROUND"]);
  });
  it("still filters by one category and by line-wise or document-wise", () => {
    expect(codes(pickableTerms(terms, { category: "ADDITIONAL" }))).toEqual(["CUSTOMS"]);
    expect(codes(pickableTerms(terms, { excludeCategory: "ADDITIONAL", productwiseOnly: true }))).toEqual(["DISC"]);
    expect(codes(pickableTerms(terms, { excludeCategory: "ADDITIONAL", productwiseOnly: false }))).toEqual(["VAT", "ROUND"]);
    expect(codes(pickableTerms(terms, {}))).toEqual(["DISC", "VAT", "ROUND", "CUSTOMS"]);
  });
});

// The due date on a bill follows its invoice date and due days: whole calendar days, month and year ends included, never a timezone slip.
describe("addDaysIso", () => {
  it("adds whole days across month, year and leap-day ends", () => {
    expect(addDaysIso("2025-10-14", 30)).toBe("2025-11-13");
    expect(addDaysIso("2025-12-20", 15)).toBe("2026-01-04");
    expect(addDaysIso("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDaysIso("2027-02-28", 1)).toBe("2027-03-01");
    expect(addDaysIso("2025-10-14", 0)).toBe("2025-10-14");
  });
  it("answers an empty string when the start or the days are not usable", () => {
    expect(addDaysIso("", 5)).toBe("");
    expect(addDaysIso("2025-13-40", 5)).toBe("");
    expect(addDaysIso("?2025", 5)).toBe("");
    expect(addDaysIso("2025-10-14", -1)).toBe("");
    expect(addDaysIso("2025-10-14", 1.5)).toBe("");
  });
});
