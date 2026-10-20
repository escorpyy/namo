import { describe, expect, it } from "vitest";
import { mulRound2, parseDec, toCents } from "../shared/decimal";

describe("parseDec", () => {
  it("parses integers and decimals into exact bigint + scale", () => {
    expect(parseDec("12")).toEqual({ n: 12n, scale: 0 });
    expect(parseDec("12.50")).toEqual({ n: 1250n, scale: 2 });
    expect(parseDec(" 0.000001 ")).toEqual({ n: 1n, scale: 6 });
  });
  it("rejects negatives, junk, too many digits and too many decimals", () => {
    for (const bad of ["-1", "abc", "", "1.", ".5", "1,5", "1e3", "1234567890123", "1.1234567"]) {
      expect(parseDec(bad), bad).toBeNull();
    }
  });
});

describe("mulRound2 (exact, half-up, 2 decimals)", () => {
  it("avoids float errors", () => {
    expect(0.1 * 0.2).not.toBe(0.02); // the float problem this module exists to avoid
    expect(mulRound2("0.1", "0.2")).toBe("0.02");
    expect(mulRound2("19.99", "3")).toBe("59.97");
  });
  it("rounds half up at the third decimal", () => {
    expect(mulRound2("1.005", "1")).toBe("1.01");
    expect(mulRound2("1.004", "1")).toBe("1.00");
    expect(mulRound2("2.675", "1")).toBe("2.68");
  });
  it("handles qty x rate with up to 6 decimals each", () => {
    expect(mulRound2("2000", "110")).toBe("220000.00");
    expect(mulRound2("500", "180")).toBe("90000.00");
    expect(mulRound2("0.333333", "3")).toBe("1.00");
  });
  it("returns 0.00 for invalid input", () => {
    expect(mulRound2("x", "2")).toBe("0.00");
    expect(mulRound2("2", "-1")).toBe("0.00");
  });
});

describe("toCents", () => {
  it("converts to paisa", () => {
    expect(toCents("1234.56")).toBe(123456n);
    expect(toCents("10")).toBe(1000n);
    expect(toCents("0.5")).toBe(50n);
    expect(toCents("bad")).toBe(0n);
  });
  // CHARACTERIZATION (not an endorsement): toCents TRUNCATES extra decimals whereas mulRound2 ROUNDS.
  // If any money path mixes them, amounts can differ by 1 paisa. Tracked in PROJECT_TRACKER (ERP-011).
  it("truncates beyond 2 decimals", () => {
    expect(toCents("1.239")).toBe(123n);
  });
});
