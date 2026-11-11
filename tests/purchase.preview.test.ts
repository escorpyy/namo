import { describe, expect, it } from "vitest";
import { fmt, lineBasicAmount, toMicro } from "../shared/purchase-calculation";
import { previewPurchase, type PreviewTermMaster } from "../shared/purchase-preview";
import { blankLine, lineAmount, termFromDoc } from "../src/lib/purchaseForm";

const master = (overrides: Partial<PreviewTermMaster> & Pick<PreviewTermMaster, "id" | "sequence">): PreviewTermMaster => ({
  nature: "ADDITIVE", isProductwise: false, calcBase: "ITEM_VALUE", ...overrides,
});

describe("live purchase invoice preview", () => {
  it("preserves the saved nature for historical term display", () => {
    expect(termFromDoc({ termId: 4, nature: "DEDUCTIVE", finalAmount: "12.50" }).nature).toBe("DEDUCTIVE");
  });

  it("uses the same paisa rounding for line amounts as the persisted calculation engine", () => {
    const line = blankLine({ qty: "1.005", rate: "10" });
    expect(lineAmount(line, undefined)).toBe("10.05");
    expect(fmt(lineBasicAmount(toMicro("1.005"), toMicro("10")), 2)).toBe("10.05");
  });

  it("reconciles basic, discount, freight, running-total VAT, term net, and invoice net", () => {
    const masters = new Map<number, PreviewTermMaster>([
      [1, master({ id: 1, sequence: 10, nature: "DEDUCTIVE" })],
      [2, master({ id: 2, sequence: 20 })],
      [3, master({ id: 3, sequence: 30, calcBase: "RUNNING_TOTAL" })],
    ]);
    const preview = previewPurchase(
      [{ lineNumber: 1, basicAmount: "1000.00" }, { lineNumber: 2, basicAmount: "1000.00" }],
      [
        { rowKey: "vat", termId: 3, calcType: "PERCENT", rate: "13", isOverridden: false },
        { rowKey: "discount", termId: 1, calcType: "PERCENT", rate: "10", isOverridden: false },
        { rowKey: "freight", termId: 2, calcType: "AMOUNT", inputAmount: "100", isOverridden: false },
      ],
      masters,
    );
    expect(preview.status).toBe("ready");
    expect(preview.basicAmount).toBe("2000.00");
    expect(preview.additions).toBe("347.00");
    expect(preview.deductions).toBe("200.00");
    expect(preview.termAmount).toBe("147.00");
    expect(preview.netAmount).toBe("2147.00");
    expect(preview.terms.get("vat")).toMatchObject({ baseAmount: "1900.00", calculatedAmount: "247.00", finalAmount: "247.00" });
    expect(preview.terms.get("discount")?.signedAmount).toBe("-200.00");
  });

  it("supports single-term bases, line-level scope, and overridden amounts", () => {
    const masters = new Map<number, PreviewTermMaster>([
      [1, master({ id: 1, sequence: 10, nature: "DEDUCTIVE", isProductwise: true })],
      [2, master({ id: 2, sequence: 20, calcBase: "SINGLE_TERM", baseTermId: 1 })],
    ]);
    const preview = previewPurchase(
      [{ lineNumber: 1, basicAmount: "1000.00" }, { lineNumber: 2, basicAmount: "500.00" }],
      [
        { rowKey: "discount-line-1", termId: 1, lineNumber: "1", calcType: "PERCENT", rate: "10", isOverridden: true, overrideAmount: "80" },
        { rowKey: "vat-on-discount", termId: 2, calcType: "PERCENT", rate: "13", isOverridden: false },
      ],
      masters,
    );
    expect(preview.status).toBe("ready");
    expect(preview.terms.get("discount-line-1")).toMatchObject({ baseAmount: "1000.00", calculatedAmount: "100.00", finalAmount: "80.00", signedAmount: "-80.00" });
    expect(preview.terms.get("vat-on-discount")).toMatchObject({ baseAmount: "80.00", finalAmount: "10.40" });
    expect(preview.netAmount).toBe("1430.40");
  });

  it("withholds term and net totals when any entered line or term is incomplete", () => {
    const masters = new Map<number, PreviewTermMaster>([[1, master({ id: 1, sequence: 10 })]]);
    const incompleteLine = previewPurchase([{ lineNumber: 1, basicAmount: "50.00" }], [], masters, true);
    expect(incompleteLine.status).toBe("incomplete");
    expect(incompleteLine.basicAmount).toBe("50.00");
    expect(incompleteLine.termAmount).toBeNull();
    expect(incompleteLine.netAmount).toBeNull();

    const incompleteTerm = previewPurchase([{ lineNumber: 1, basicAmount: "50.00" }], [
      { rowKey: "vat", termId: 1, calcType: "PERCENT", rate: "", isOverridden: false },
    ], masters);
    expect(incompleteTerm.status).toBe("incomplete");
    expect(incompleteTerm.netAmount).toBeNull();
  });
  it("prices a rounding term on its own, with no rate or amount entered, and reports the sign it came to", () => {
    const masters = new Map<number, PreviewTermMaster>([
      [1, master({ id: 1, sequence: 30, calcBase: "RUNNING_TOTAL" })],
      [2, master({ id: 2, sequence: 900, calcBase: "RUNNING_TOTAL", category: "ROUNDED" })],
    ]);
    const preview = previewPurchase(
      [{ lineNumber: 1, basicAmount: "1005.55" }],
      [
        { rowKey: "vat", termId: 1, calcType: "PERCENT", rate: "13", isOverridden: false },
        { rowKey: "round", termId: 2, calcType: "AMOUNT", inputAmount: "", isOverridden: false },
      ],
      masters,
    );
    expect(preview.status).toBe("ready");
    expect(preview.netAmount).toBe("1136.00");
    expect(preview.terms.get("round")).toMatchObject({ baseAmount: "1136.27", finalAmount: "0.27", signedAmount: "-0.27", nature: "DEDUCTIVE" });
    expect(preview.deductions).toBe("0.27");
  });
});
