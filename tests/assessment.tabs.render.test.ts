import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LedgerTab } from "../src/components/purchase/AssessmentLedgerTab";
import { MatrixTab } from "../src/components/purchase/AssessmentMatrixTab";
import { ProductsTab } from "../src/components/purchase/AssessmentProductsTab";
import { allocationsByTerm, buildMatrix, ledgerCheck, type LedgerCheckTerm, type PreviewLineLike } from "../src/lib/assessmentTabs";

// The tabs rendered to static HTML with a small worked assessment: duty +150 and a rebate -20 (both in stock value, split 90/60 and 10/10)
// and import VAT 130 (posted, not in stock value). Checks the colours, signs, totals and ledger postings the owner asked for.

const lines: PreviewLineLike[] = [
  { id: 11, lineNumber: 1, productCode: "RICE", quantity: "10", goodsValue: "600.00", capitalizedSources: "30.00", existingPurchaseTermCosts: "0.00", capitalizedAssessments: "80.00", landedValue: "710.00", landedRate: "71.000000" },
  { id: 12, lineNumber: 2, productCode: "OIL", quantity: "5", goodsValue: "400.00", capitalizedSources: "20.00", existingPurchaseTermCosts: "0.00", capitalizedAssessments: "50.00", landedValue: "470.00", landedRate: "94.000000" },
];
const preview = {
  termResults: [{ termId: 1, key: 501 }, { termId: 2, key: 502 }, { termId: 3, key: 503 }],
  termAllocations: [
    { termKey: 501, lines: [{ lineId: 11, amount: "90.00" }, { lineId: 12, amount: "60.00" }] },
    { termKey: 502, lines: [{ lineId: 11, amount: "-10.00" }, { lineId: 12, amount: "-10.00" }] },
  ],
};
const base = { basis: "VALUE" as const, mode: "AUTO" as const, ownLedgerId: 1 as number | null, againstLedgerId: 9 as number | null, againstSubLedgerId: null };
const terms: LedgerCheckTerm[] = [
  { ...base, formKey: "a", termId: "1", code: "DUTY", name: "Customs duty", nature: "ADDITIVE", capitalizable: true, amount: 15000 },
  { ...base, formKey: "b", termId: "2", code: "REB", name: "Rebate", nature: "DEDUCTIVE", capitalizable: true, amount: 2000, ownLedgerId: 2 },
  { ...base, formKey: "c", termId: "3", code: "VAT", name: "Import VAT", nature: "ADDITIVE", capitalizable: false, amount: 13000, ownLedgerId: 3 },
];
const alloc = allocationsByTerm(preview);
const noop = () => {};

describe("tab rendering", () => {
  it("matrix: additions green with +, deductions pink/red with −, non-stock charge greyed with its total, totals tie", () => {
    const html = renderToStaticMarkup(createElement(MatrixTab, { matrix: buildMatrix(lines, terms, alloc), ready: true }));
    expect(html).toContain("bg-green-100 text-green-800");
    expect(html).toContain("bg-pink-100 text-red-700");
    expect(html).toContain("+90.00");
    expect(html).toContain("−10.00");
    expect(html).toContain("not in stock");
    expect(html).toContain("+130.00"); // VAT total in the greyed group's footer
    expect(html).toContain("1,180.00"); // goods 1,000 + linked 50 + charges 130
  });

  it("product-wise: columns, net terms per product with colour, totals, and a hint to open a product", () => {
    const html = renderToStaticMarkup(createElement(ProductsTab, {
      lines, terms, alloc, editing: true, ready: true, hasLinked: true, splitSummary: "product value for every charge",
      onChangeSplit: noop, onEditAmount: noop, onResetAuto: noop,
    }));
    for (const h of ["Product", "Qty", "Goods value", "Terms", "Landed value", "Landed unit cost", "Linked costs"]) expect(html).toContain(h);
    expect(html).toContain("+80.00");
    expect(html).toContain("+130.00"); // total of the Terms column
    expect(html).toContain("Enter opens its charges");
    expect(html).toContain("product value for every charge");
    expect(html).not.toContain('role="dialog"'); // closed until a product is opened
  });

  it("product-wise: a manual charge that does not tie is flagged and offers a way back to auto", () => {
    const manual = terms.map((t) => (t.termId === "1" ? { ...t, mode: "MANUAL" as const, manual: { "11": "90.00", "12": "55.00" }, gap: 500 } : t));
    const html = renderToStaticMarkup(createElement(ProductsTab, {
      lines, terms: manual, alloc, editing: true, ready: true, hasLinked: false, splitSummary: "set per charge", onChangeSplit: noop, onEditAmount: noop, onResetAuto: noop,
    }));
    expect(html).toContain("short 5.00");
    expect(html).toContain("Manual");
    expect(html).toContain("auto</button>");
  });

  it("ledger check: folded by default, shows Dr and Cr totals that agree, the checks, and the not-in-stock note", () => {
    const ledgers = [
      { id: 1, code: "DUTYEXP", name: "Duty ledger", requiresSubLedger: false }, { id: 2, code: "REBATE", name: "Rebate ledger", requiresSubLedger: false },
      { id: 3, code: "VATIN", name: "Import VAT", requiresSubLedger: false }, { id: 9, code: "CUSTOMS", name: "Customs payable", requiresSubLedger: false },
    ];
    const totals = { goods: 100000, services: 5000, earlier: 0, assessed: 13000, landed: 118000, lineLanded: 118000, lineAssessed: 13000 };
    const result = ledgerCheck(terms, ledgers, alloc, totals);
    const html = renderToStaticMarkup(createElement(LedgerTab, { result, ready: true, voucherNumber: "CA-2082-0001" }));
    expect(html).toContain("DUTYEXP — Duty ledger");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("against CUSTOMS"); // the charge-wise detail is folded away
    expect(html).toContain("CA-2082-0001");
    expect(html).toContain("Voucher debits equal credits");
    expect(html).toContain("is posted but kept out of landed cost");
    expect(html).not.toContain("difference");
  });

  it("ledger check: a missing against ledger is reported as a failed check", () => {
    const result = ledgerCheck([{ ...terms[0], againstLedgerId: null }], [{ id: 1, code: "DUTYEXP", name: "Duty ledger", requiresSubLedger: false }], alloc, null);
    const html = renderToStaticMarkup(createElement(LedgerTab, { result, ready: true }));
    expect(html).toContain("Every charge has both ledgers");
    expect(html).toContain("Ledger missing: DUTY");
    expect(html).toContain('aria-label="failed"');
  });
});
