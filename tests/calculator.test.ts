import { describe, expect, it } from "vitest";
import { evaluateCalculatorExpression, formatCalculatorValue } from "../src/lib/calculator";

describe("calculator arithmetic", () => {
  it("respects arithmetic precedence, parentheses, unary signs and common calculator symbols", () => {
    expect(evaluateCalculatorExpression("8 + 2 * 3")).toBe(14);
    expect(evaluateCalculatorExpression("(8 + 2) * 3")).toBe(30);
    expect(evaluateCalculatorExpression("−(8 − 10) ÷ 2")).toBe(1);
    expect(evaluateCalculatorExpression("1.5 × 4")).toBe(6);
  });

  it("supports decimals and postfix percentages", () => {
    expect(evaluateCalculatorExpression(".5 + 5.")).toBe(5.5);
    expect(evaluateCalculatorExpression("250 * 8%")).toBe(20);
  });

  it("rejects incomplete, invalid, non-finite, oversized, and executable input", () => {
    for (const expression of ["", "2 +", "(2 + 3", "2 / 0", "1..2", "2(3)", "alert(1)", "1e9", "9".repeat(257)]) {
      expect(evaluateCalculatorExpression(expression), expression).toBeNull();
    }
  });

  it("formats floating point output without common binary precision noise", () => {
    expect(formatCalculatorValue(0.1 + 0.2)).toBe("0.3");
    expect(formatCalculatorValue(125)).toBe("125");
  });
});
