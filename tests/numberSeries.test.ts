import { describe, expect, it } from "vitest";
import { exampleNumbers, formatNumber, numbersLeft, parseNumber, seriesProblems, stepNumber } from "../shared/numberSeries";

const base = { name: "Cash", prefix: "CV-", suffix: "", padding: 3, startNumber: 1, endNumber: null, increment: 1, mode: "AUTOMATIC" as const };

describe("number series format", () => {
  it("makes CV-001 style numbers and grows past the padding", () => {
    expect(formatNumber(base, 1)).toBe("CV-001");
    expect(formatNumber(base, 999)).toBe("CV-999");
    expect(formatNumber(base, 1000)).toBe("CV-1000");
  });
  it("fills {FY} and {BRANCH} in prefix and suffix", () => {
    const f = { prefix: "{BRANCH}/", suffix: "/{FY}", padding: 2 };
    expect(formatNumber(f, 7, { fiscalYear: "2082/083", branch: "KTM" })).toBe("KTM/07/2082-083");
  });
  it("reads the counter back out of a number, or says it does not follow the series", () => {
    expect(parseNumber(base, "CV-012")).toBe(12);
    expect(parseNumber(base, "BV-012")).toBeNull();
    expect(parseNumber(base, "CV-")).toBeNull();
    expect(parseNumber(base, "CV-1A")).toBeNull();
  });
  it("steps from the start by the increment and stops after the end", () => {
    const f = { startNumber: 10, endNumber: 20, increment: 5 };
    expect(stepNumber(f, null)).toBe(10);
    expect(stepNumber(f, 10)).toBe(15);
    expect(stepNumber(f, 20)).toBeNull();
    expect(numbersLeft(f, 10)).toBe(2);
    expect(numbersLeft({ endNumber: null, increment: 1 }, 5)).toBeNull();
  });
  it("shows examples and stops at the end number", () => {
    expect(exampleNumbers({ ...base, startNumber: 5, increment: 5, endNumber: 10 })).toEqual(["CV-005", "CV-010"]);
  });
  it("accepts a good series and explains each bad one", () => {
    expect(seriesProblems(base)).toEqual([]);
    expect(seriesProblems({ ...base, name: " " })[0]).toMatch(/name/);
    expect(seriesProblems({ ...base, prefix: "A B" })[0]).toMatch(/Prefix/);
    expect(seriesProblems({ ...base, suffix: "{X}" })[0]).toMatch(/Suffix/);
    expect(seriesProblems({ ...base, padding: 0 })[0]).toMatch(/Padding/);
    expect(seriesProblems({ ...base, increment: 0 })[0]).toMatch(/Increase/);
    expect(seriesProblems({ ...base, startNumber: 10, endNumber: 5 })[0]).toMatch(/End number/);
    expect(seriesProblems({ ...base, prefix: "X".repeat(20), suffix: "Y".repeat(20) })[0]).toMatch(/characters/);
  });
  it("a manual series needs only a name and a clean prefix", () => {
    expect(seriesProblems({ ...base, mode: "MANUAL", padding: 0, increment: 0 })).toEqual([]);
  });
});
