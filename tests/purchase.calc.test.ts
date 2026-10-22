import { describe, expect, it } from "vitest";
import { fmt, mul, div, percentOf, roundTo, toMicro, ONE } from "../server/services/purchase/money";
import { priceTerms, type EngineTerm } from "../server/services/purchase/terms";
import { allocate, landed } from "../server/services/purchase/landed";

const M = toMicro;
const t = (o: Partial<EngineTerm> & Pick<EngineTerm, "key" | "termId" | "sequence">): EngineTerm => ({
  nature: "ADDITIVE", calcBase: "ITEM_VALUE", calcType: "PERCENT", isOverridden: false, ...o,
});

describe("money (exact fixed point)", () => {
  it("parses and prints without floats", () => {
    expect(toMicro("1234.5")).toBe(1_234_500_000n);
    expect(fmt(toMicro("1234.5"))).toBe("1234.500000");
    expect(fmt(toMicro("0.1") + toMicro("0.2"), 2)).toBe("0.30"); // 0.1 + 0.2 is exactly 0.3
    expect(fmt(toMicro("-5.5"), 2)).toBe("-5.50");
    expect(toMicro(null)).toBe(0n);
    expect(() => toMicro("abc")).toThrow(/not a valid number/);
    expect(() => toMicro("1e5")).toThrow();
  });
  it("rounds half away from zero", () => {
    expect(fmt(roundTo(M("2.345"), 2), 2)).toBe("2.35");
    expect(fmt(roundTo(M("2.344999"), 2), 2)).toBe("2.34");
    expect(fmt(roundTo(M("-2.345"), 2), 2)).toBe("-2.35");
    expect(toMicro("0.0000005")).toBe(1n); // 7th digit rounds up
  });
  it("multiplies, divides and takes percentages exactly", () => {
    expect(mul(M("10"), M("100"))).toBe(M("1000"));
    expect(mul(M("0.333333"), M("3"))).toBe(M("0.999999"));
    expect(div(M("1050"), M("10"))).toBe(M("105"));
    expect(fmt(div(M("1"), M("3")))).toBe("0.333333");
    expect(fmt(percentOf(M("1900"), M("13")), 2)).toBe("247.00");
    expect(fmt(percentOf(M("33.33"), M("13")), 2)).toBe("4.33"); // 4.3329
    expect(() => div(ONE, 0n)).toThrow(/zero/);
  });
});

describe("billing-terms engine", () => {
  const lines = [{ key: 1, basicAmount: M("1000") }, { key: 2, basicAmount: M("1000") }];

  it("worked example: discount, freight, then VAT on the running total", () => {
    const out = priceTerms(lines, [
      t({ key: 30, termId: 3, sequence: 30, calcBase: "RUNNING_TOTAL", rate: M("13") }), // VAT
      t({ key: 10, termId: 1, sequence: 10, nature: "DEDUCTIVE", rate: M("10") }), // discount 10% of items
      t({ key: 20, termId: 2, sequence: 20, calcType: "AMOUNT", inputAmount: M("100") }), // freight
    ]);
    expect(fmt(out.results.get(10)!.finalAmount, 2)).toBe("200.00");
    expect(fmt(out.results.get(20)!.finalAmount, 2)).toBe("100.00");
    expect(fmt(out.results.get(30)!.baseAmount, 2)).toBe("1900.00"); // 2000 - 200 + 100
    expect(fmt(out.results.get(30)!.finalAmount, 2)).toBe("247.00");
    expect(fmt(out.itemTotal, 2)).toBe("2000.00");
    expect(fmt(out.termNet, 2)).toBe("147.00"); // -200 + 100 + 247
    expect(fmt(out.total, 2)).toBe("2147.00");
  });

  it("is independent of the order terms are given in (sequence decides)", () => {
    const a = [t({ key: 1, termId: 1, sequence: 10, nature: "DEDUCTIVE", rate: M("10") }), t({ key: 2, termId: 2, sequence: 20, calcBase: "RUNNING_TOTAL", rate: M("13") })];
    expect(priceTerms(lines, a).total).toBe(priceTerms(lines, [...a].reverse()).total);
  });

  it("SINGLE_TERM takes the result of one earlier term only", () => {
    const out = priceTerms(lines, [
      t({ key: 1, termId: 1, sequence: 10, calcType: "AMOUNT", inputAmount: M("100") }), // freight 100
      t({ key: 2, termId: 2, sequence: 20, calcType: "AMOUNT", inputAmount: M("50") }), // unrelated
      t({ key: 3, termId: 3, sequence: 30, calcBase: "SINGLE_TERM", baseTermId: 1, rate: M("13") }), // VAT on freight only
    ]);
    expect(fmt(out.results.get(3)!.baseAmount, 2)).toBe("100.00");
    expect(fmt(out.results.get(3)!.finalAmount, 2)).toBe("13.00");
  });

  it("SINGLE_TERM with a base that comes later is refused; a base that was never entered counts as zero", () => {
    expect(() => priceTerms(lines, [
      t({ key: 1, termId: 1, sequence: 10, calcBase: "SINGLE_TERM", baseTermId: 2, rate: M("5") }),
      t({ key: 2, termId: 2, sequence: 20, calcType: "AMOUNT", inputAmount: M("100") }),
    ])).toThrow(/comes after it/);
    const out = priceTerms(lines, [t({ key: 1, termId: 1, sequence: 10, calcBase: "SINGLE_TERM", baseTermId: 99, rate: M("5") })]);
    expect(out.results.get(1)!.finalAmount).toBe(0n);
  });

  it("line-level terms price on their own line and feed the header total", () => {
    const out = priceTerms(lines, [
      t({ key: 1, termId: 1, sequence: 10, nature: "DEDUCTIVE", rate: M("5"), lineKey: 1 }), // 5% off line 1 only
      t({ key: 2, termId: 2, sequence: 20, calcBase: "RUNNING_TOTAL", rate: M("10"), lineKey: 1 }), // on line 1 after discount
      t({ key: 3, termId: 3, sequence: 30, calcBase: "RUNNING_TOTAL", rate: M("10") }), // header: everything earlier
    ]);
    expect(fmt(out.results.get(1)!.finalAmount, 2)).toBe("50.00");
    expect(fmt(out.results.get(2)!.baseAmount, 2)).toBe("950.00");
    expect(fmt(out.results.get(2)!.finalAmount, 2)).toBe("95.00");
    // header running total = 2000 - 50 + 95 = 2045
    expect(fmt(out.results.get(3)!.baseAmount, 2)).toBe("2045.00");
    expect(fmt(out.total, 2)).toBe("2249.50"); // 2000 - 50 + 95 + 204.50
  });

  it("an override keeps the typed amount; calculation is still reported", () => {
    const out = priceTerms(lines, [t({ key: 1, termId: 1, sequence: 10, rate: M("13"), isOverridden: true, overrideAmount: M("250") })]);
    const r = out.results.get(1)!;
    expect(fmt(r.calculatedAmount, 2)).toBe("260.00");
    expect(fmt(r.finalAmount, 2)).toBe("250.00");
    expect(fmt(out.total, 2)).toBe("2250.00");
  });

  it("refuses bad inputs", () => {
    expect(() => priceTerms(lines, [t({ key: 1, termId: 1, sequence: 1 })])).toThrow(/no rate/);
    expect(() => priceTerms(lines, [t({ key: 1, termId: 1, sequence: 1, calcType: "AMOUNT" })])).toThrow(/none/);
    expect(() => priceTerms(lines, [t({ key: 1, termId: 1, sequence: 1, calcType: "AMOUNT", inputAmount: M("-5") })])).toThrow(/negative/);
    expect(() => priceTerms(lines, [t({ key: 1, termId: 1, sequence: 1, rate: M("5"), lineKey: 99 })])).toThrow(/not on this document/);
    expect(() => priceTerms(lines, [t({ key: 1, termId: 1, sequence: 1, rate: M("5"), isOverridden: true })])).toThrow(/no amount/);
  });
});

describe("landed cost", () => {
  const sumOf = (xs: bigint[]) => xs.reduce((a, b) => a + b, 0n);

  it("splits by value and always adds back to the exact term amount", () => {
    expect(allocate(M("100"), [M("1000"), M("1000")]).map((x) => fmt(x, 2))).toEqual(["50.00", "50.00"]);
    const three = allocate(M("100"), [M("1"), M("1"), M("1")]);
    expect(three.map((x) => fmt(x, 2))).toEqual(["33.34", "33.33", "33.33"]); // leftover paisa to the first line
    expect(sumOf(three)).toBe(M("100"));
  });
  it("gives leftover paisa to the biggest remainders", () => {
    const out = allocate(M("0.05"), [M("3"), M("1"), M("1")]); // 5 paisa: shares 3,1,1 exactly
    expect(out.map((x) => fmt(x, 2))).toEqual(["0.03", "0.01", "0.01"]);
    const odd = allocate(M("1.00"), [M("2"), M("2"), M("3")]); // 28.57.. / 28.57.. / 42.86 paisa
    expect(sumOf(odd)).toBe(M("1.00"));
    expect(odd.map((x) => fmt(x, 2))).toEqual(["0.29", "0.28", "0.43"]);
  });
  it("is exact for any amount and weights (property check)", () => {
    for (let n = 1; n <= 7; n++) {
      for (const amt of ["0.01", "1", "99.99", "12345.67"]) {
        const w = Array.from({ length: n }, (_, i) => M(String(i * 3 + 1)));
        expect(sumOf(allocate(M(amt), w))).toBe(M(amt));
      }
    }
  });
  it("a zero-weight line gets nothing; all-zero or no lines is refused", () => {
    expect(allocate(M("90"), [M("1"), 0n, M("2")]).map((x) => fmt(x, 2))).toEqual(["30.00", "0.00", "60.00"]);
    expect(() => allocate(M("10"), [0n, 0n])).toThrow(/all zero/);
    expect(() => allocate(M("10"), [])).toThrow(/no lines/);
  });
  it("landed amount and rate", () => {
    const l = landed({ basicAmount: M("1000"), qty: M("10"), allocated: M("250") });
    expect(fmt(l.landedAmount, 2)).toBe("1250.00");
    expect(fmt(l.landedRate)).toBe("125.000000");
    expect(fmt(landed({ basicAmount: M("100"), qty: M("3"), allocated: 0n }).landedRate)).toBe("33.333333");
    expect(landed({ basicAmount: M("100"), qty: 0n, allocated: 0n }).landedRate).toBe(0n);
    expect(() => landed({ basicAmount: M("100"), qty: M("1"), allocated: M("-150") })).toThrow(/negative/);
  });
});
