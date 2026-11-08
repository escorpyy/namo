import { describe, expect, it } from "vitest";
import { allocationCsv, chargeMix, costBuildUp, openAssessmentsFor, productImpact, readiness, toCsv } from "../src/lib/assessmentInsights";

const preview = {
  goodsValue: "1000.00", invoicedCapitalizedCosts: "50.00", existingPurchaseTermCosts: "0.00", capitalizedAssessments: "200.00", totalLandedValue: "1250.00",
  lines: [
    { key: 1, lineNumber: 1, productCode: "RICE", quantity: "10", goodsValue: "600.00", landedValue: "690.00", landedRate: "69.00" },
    { key: 2, lineNumber: 2, productCode: "OIL", quantity: "5", goodsValue: "400.00", landedValue: "560.00", landedRate: "112.00" },
    { key: 3, lineNumber: 3, productCode: "FREE", quantity: "1", goodsValue: "0.00", landedValue: "0.00", landedRate: "0.00" },
  ],
};

describe("cost build-up", () => {
  it("splits the landed total into goods, services, earlier costs and assessed charges, with the uplift over goods", () => {
    const b = costBuildUp(preview)!;
    expect(b.total).toBe(1250);
    expect(b.upliftPct).toBe(25);
    expect(b.segments.map((s) => [s.key, s.amount])).toEqual([["goods", 1000], ["services", 50], ["earlier", 0], ["assessed", 200]]);
    expect(b.segments.reduce((a, s) => a + s.amount, 0)).toBe(b.total);
    expect(b.segments.reduce((a, s) => a + s.share, 0)).toBeCloseTo(1, 6);
  });
  it("keeps a deductive segment negative with no bar share, and has no uplift without goods value", () => {
    const b = costBuildUp({ ...preview, capitalizedAssessments: "-100.00", totalLandedValue: "950.00" })!;
    expect(b.segments[3]).toMatchObject({ amount: -100, share: 0 });
    expect(costBuildUp({ goodsValue: "0", totalLandedValue: "0" })!.upliftPct).toBeNull();
  });
  it("is null until a preview exists", () => {
    expect(costBuildUp(null)).toBeNull();
    expect(costBuildUp({})).toBeNull();
  });
});

describe("product impact", () => {
  it("ranks products by how much dearer they became, zero-value lines last", () => {
    const rows = productImpact(preview.lines);
    expect(rows.map((r) => [r.label, r.upliftPct])).toEqual([["2. OIL", 40], ["1. RICE", 15], ["3. FREE", null]]);
    expect(rows[0]).toMatchObject({ goods: 400, landed: 560, landedRate: "112.00" });
  });
  it("copes with no lines", () => { expect(productImpact(undefined)).toEqual([]); });
});

describe("charge mix", () => {
  it("shares by size, biggest first, and keeps the stock / expensed flag", () => {
    const rows = chargeMix([{ key: "a", label: "Freight", amount: 100, inStock: true }, { key: "b", label: "Customs", amount: 300, inStock: true }, { key: "c", label: "Rebate", amount: -100, inStock: false }]);
    expect(rows.map((r) => r.label)).toEqual(["Customs", "Freight", "Rebate"]);
    expect(rows.map((r) => r.share)).toEqual([0.6, 0.2, 0.2]);
    expect(rows[2].inStock).toBe(false);
  });
  it("gives zero shares when every charge is zero", () => {
    expect(chargeMix([{ key: "a", label: "Freight", amount: 0, inStock: true }])[0].share).toBe(0);
  });
});

describe("readiness", () => {
  const ok = { hasBill: true, hasDate: true, previewOk: true, previewPending: false, charges: [{ index: 0, hasTerm: true, hasLedger: true, hasValue: true, label: "Freight" }] };
  it("passes when everything is in place", () => { expect(readiness(ok).every((c) => c.ok)).toBe(true); });
  it("names the charges missing a ledger or an amount and where to jump", () => {
    const checks = readiness({ ...ok, charges: [ok.charges[0], { index: 1, hasTerm: true, hasLedger: false, hasValue: false, label: "Customs" }] });
    const by = Object.fromEntries(checks.map((c) => [c.id, c]));
    expect(by.ledgers).toMatchObject({ ok: false, detail: "Customs", focus: "terms.1.againstLedgerId" });
    expect(by.values).toMatchObject({ ok: false, detail: "Customs", focus: "terms.1.amount" });
  });
  it("fails the splits check with the gap, and the preview check while updating", () => {
    const checks = readiness({ ...ok, previewPending: true, charges: [{ ...ok.charges[0], manualGap: 12.5 }] });
    const by = Object.fromEntries(checks.map((c) => [c.id, c]));
    expect(by.splits).toMatchObject({ ok: false, detail: "Freight (gap 12.50)" });
    expect(by.preview.ok).toBe(false);
  });
  it("needs a bill, a date and a charge", () => {
    const by = Object.fromEntries(readiness({ hasBill: false, hasDate: false, previewOk: false, previewPending: false, charges: [{ index: 0, hasTerm: false, hasLedger: false, hasValue: false, label: "" }] }).map((c) => [c.id, c.ok]));
    expect(by).toMatchObject({ bill: false, date: false, charges: false, values: false, ledgers: false, preview: false });
  });
});

describe("open assessments of a bill", () => {
  const rows = [
    { id: 1, importBillId: 9, state: "APPLIED" }, { id: 2, importBillId: 9, state: "REVERSED" }, { id: 3, importBillId: 9, state: "DRAFT" }, { id: 4, importBillId: 8, state: "DRAFT" },
  ];
  it("finds the draft and applied ones for that bill only, leaving out the open document itself", () => {
    expect(openAssessmentsFor(rows, 9).map((r) => r.id)).toEqual([1, 3]);
    expect(openAssessmentsFor(rows, 9, 3).map((r) => r.id)).toEqual([1]);
    expect(openAssessmentsFor(rows, null)).toEqual([]);
  });
});

describe("csv", () => {
  it("quotes commas, quotes and newlines", () => {
    expect(toCsv([["a,b", 'say "hi"', "x\ny", 3]])).toBe('"a,b","say ""hi""","x\ny",3');
  });
  it("neutralises text that a spreadsheet would run as a formula, but not real numbers", () => {
    expect(toCsv([["=SUM(A1)", "+1", "-5", "-5.50", "@x", "ok"]])).toBe("'=SUM(A1),'+1,-5,-5.50,'@x,ok");
  });
  it("writes the allocation grid with a total row and the uplift", () => {
    const lines = preview.lines.slice(0, 2).map((l) => ({ ...l, customsValue: l.goodsValue, capitalizedSources: "0.00", existingPurchaseTermCosts: "0.00", capitalizedAssessments: "0.00" }));
    const rows = allocationCsv(lines).split("\r\n");
    expect(rows[0]).toBe("Line,Product,Qty,Goods value,Customs value,Invoiced services,Bill terms,Assessed costs,Landed value,Landed unit cost,Uplift %");
    expect(rows[1]).toBe("1,RICE,10,600.00,600.00,0.00,0.00,0.00,690.00,69.00,15");
    expect(rows[3]).toBe(",Total,,1000,1000,0,0,0,1250,,25");
  });
});
