import { describe, expect, it } from "vitest";
import { toMicro, fmt, type EngineTerm } from "../shared/purchase-calculation";
import { calculateImportCosting, type ImportAssessmentTermInput } from "../shared/import-costing";

const M = toMicro;
const term = (overrides: Partial<EngineTerm> & Pick<EngineTerm, "key" | "termId" | "sequence">): EngineTerm => ({
  nature: "ADDITIVE", calcBase: "ITEM_VALUE", calcType: "PERCENT", rate: M("0"), isOverridden: false, ...overrides,
});
const priced = (t: EngineTerm, allocationBasis: "VALUE" | "QUANTITY", capitalizable: boolean): ImportAssessmentTermInput => ({ term: t, allocationBasis, capitalizable });

const exampleLines = [
  { key: 1, lineNumber: 1, quantity: "1", goodsValue: "6000" },
  { key: 2, lineNumber: 2, quantity: "2", goodsValue: "4000" },
];

describe("import cost assessment calculation", () => {
  it("builds CIF from goods, insurance and freight, then calculates duty without capitalizing recoverable tax", () => {
    const out = calculateImportCosting(
      exampleLines,
      [
        { key: "insurance", label: "Domestic insurance", capitalizedAmount: "2000", customsValueAmount: "2000", allocationBasis: "VALUE" },
        { key: "freight", label: "Foreign transport", capitalizedAmount: "3000", customsValueAmount: "3000", allocationBasis: "QUANTITY" },
      ],
      [
        priced(term({ key: 1, termId: 1, sequence: 10, rate: M("10") }), "VALUE", true),
        // Illustrates an assessed tax that affects the payable/assessment total but is recoverable, so not inventory cost.
        priced(term({ key: 2, termId: 2, sequence: 20, rate: M("13") }), "VALUE", false),
      ],
    );

    expect(fmt(out.goodsValue, 2)).toBe("10000.00");
    expect(fmt(out.customsValueFromSources, 2)).toBe("5000.00");
    expect(fmt(out.cifValue, 2)).toBe("15000.00");
    expect(fmt(out.assessedNet, 2)).toBe("3450.00");
    expect(fmt(out.capitalizedAssessments, 2)).toBe("1500.00");
    expect(fmt(out.invoicedCapitalizedCosts, 2)).toBe("5000.00");
    expect(fmt(out.totalLandedValue, 2)).toBe("16500.00");
    expect(fmt(out.lines.get(1)!.customsValue, 2)).toBe("8200.00");
    expect(fmt(out.lines.get(2)!.customsValue, 2)).toBe("6800.00");
    expect(fmt(out.lines.get(1)!.landedValue, 2)).toBe("9100.00");
    expect(fmt(out.lines.get(2)!.landedValue, 2)).toBe("7400.00");
    expect(fmt(out.lines.get(2)!.landedRate, 2)).toBe("3700.00");
    expect(out.termAllocations.has(2)).toBe(false);
  });

  it("supports a customs base distinct from capitalized cost and puts all rounding remainder on a deterministic line", () => {
    const out = calculateImportCosting(
      [
        { key: 1, lineNumber: 1, quantity: "1", goodsValue: "1" },
        { key: 2, lineNumber: 2, quantity: "1", goodsValue: "1" },
        { key: 3, lineNumber: 3, quantity: "1", goodsValue: "1" },
      ],
      [{ key: "insurance", label: "Insurance", capitalizedAmount: "0.05", customsValueAmount: "0.10", allocationBasis: "VALUE" }],
      [],
    );
    expect(fmt(out.cifValue, 2)).toBe("3.10");
    expect(fmt(out.totalLandedValue, 2)).toBe("3.05");
    expect([1, 2, 3].map((key) => fmt(out.sourceAllocations.get("insurance")!.get(key)!, 2))).toEqual(["0.02", "0.02", "0.01"]);
  });

  it("rounds input currency to paisa before totals and shares are accumulated", () => {
    const out = calculateImportCosting(
      [{ key: 1, lineNumber: 1, quantity: "1", goodsValue: "1.005" }],
      [{ key: "fee", label: "Fee", capitalizedAmount: "0.015", customsValueAmount: "0.015", allocationBasis: "VALUE" }],
      [],
    );
    expect(fmt(out.goodsValue, 2)).toBe("1.01");
    expect(fmt(out.cifValue, 2)).toBe("1.03");
    expect(fmt(out.invoicedCapitalizedCosts, 2)).toBe("0.02");
    expect(fmt(out.lines.get(1)!.landedValue, 2)).toBe("1.03");
  });

  it("includes exact existing per-line purchase-term allocations in landed value but not CIF", () => {
    const out = calculateImportCosting([
      { key: 1, lineNumber: 1, quantity: "1", goodsValue: "100", existingPurchaseTermCosts: "60" },
      { key: 2, lineNumber: 2, quantity: "1", goodsValue: "100", existingPurchaseTermCosts: "-10" },
    ], [], []);
    expect(fmt(out.cifValue, 2)).toBe("200.00");
    expect(fmt(out.existingPurchaseTermCosts, 2)).toBe("50.00");
    expect(fmt(out.lines.get(1)!.landedValue, 2)).toBe("160.00");
    expect(fmt(out.lines.get(2)!.landedValue, 2)).toBe("90.00");
    expect(fmt(out.totalLandedValue, 2)).toBe("250.00");
  });

  it("rejects negative source costs, missing lines, and deductions that would make a product cost negative", () => {
    expect(() => calculateImportCosting([], [], [])).toThrow(/at least one goods line/);
    expect(() => calculateImportCosting(exampleLines, [{ key: "x", label: "x", capitalizedAmount: "-1", customsValueAmount: "0", allocationBasis: "VALUE" }], [])).toThrow(/cannot be negative/);
    expect(() => calculateImportCosting(
      [{ key: 1, lineNumber: 1, quantity: "0", goodsValue: "0" }],
      [{ key: "freight", label: "Freight", capitalizedAmount: "10", customsValueAmount: "10", allocationBasis: "QUANTITY" }],
      [],
    )).toThrow(/all zero/);
    expect(() => calculateImportCosting(
      [{ key: 1, lineNumber: 1, quantity: "1", goodsValue: "10" }],
      [],
      [priced(term({ key: 1, termId: 1, sequence: 10, nature: "DEDUCTIVE", calcType: "AMOUNT", inputAmount: M("11") }), "VALUE", true)],
    )).toThrow(/deductible costs exceed/);
  });
  it("a charge split by hand uses the typed product-wise amounts and reports what they miss; the header follows the lines", () => {
    // Duty 10% of 10,000 = 1,000. Automatic by value would be 600 / 400; the user decides 700 / 300.
    const run = (manual: Map<number, bigint>) => calculateImportCosting(exampleLines, [],
      [{ ...priced(term({ key: 1, termId: 1, sequence: 10, rate: M("10") }), "VALUE", true), manualAmounts: manual }]);

    const tied = run(new Map([[1, M("700")], [2, M("300")]]));
    expect(fmt(tied.manualDifference.get(1)!, 2)).toBe("0.00");
    expect(fmt(tied.lines.get(1)!.capitalizedAssessments, 2)).toBe("700.00");
    expect(fmt(tied.lines.get(2)!.capitalizedAssessments, 2)).toBe("300.00");
    expect(fmt(tied.totalLandedValue, 2)).toBe("11000.00");

    // 100 short: the engine still computes with what was typed and says how far off it is.
    const short = run(new Map([[1, M("650")], [2, M("250")]]));
    expect(fmt(short.manualDifference.get(1)!, 2)).toBe("100.00");
    expect(fmt(short.capitalizedAssessments, 2)).toBe("900.00");
    expect(fmt(short.totalLandedValue, 2)).toBe("10900.00");

    // A line left out counts as zero.
    expect(fmt(run(new Map([[1, M("1000")]])).lines.get(2)!.capitalizedAssessments, 2)).toBe("0.00");
  });

  it("a manual split refuses an unknown line and a negative amount; an automatic charge has no difference entry", () => {
    const withManual = (manual: Map<number, bigint>) => () => calculateImportCosting(exampleLines, [],
      [{ ...priced(term({ key: 1, termId: 1, sequence: 10, rate: M("10") }), "VALUE", true), manualAmounts: manual }]);
    expect(withManual(new Map([[99, M("10")]]))).toThrow(/not on this bill/i);
    expect(withManual(new Map([[1, M("-5")]]))).toThrow(/cannot be negative/i);
    const auto = calculateImportCosting(exampleLines, [], [priced(term({ key: 1, termId: 1, sequence: 10, rate: M("10") }), "VALUE", true)]);
    expect(auto.manualDifference.size).toBe(0);
    expect(fmt(auto.lines.get(1)!.capitalizedAssessments, 2)).toBe("600.00");
  });
});
