import { describe, expect, it } from "vitest";
import { closingLines } from "../server/services/yearEndCloseMath";

describe("year-end P&L close math", () => {
  it("clears revenue and expense balances and transfers net profit as a credit", () => {
    const result = closingLines([
      { generalLedgerId: 10, closing: "-100.00" },
      { generalLedgerId: 20, closing: "60.00" },
    ], 99, "2082/083");
    expect(result.netResult).toBe("40.00");
    expect(result.lines).toEqual([
      { generalLedgerId: 10, debit: "100.00", credit: "0.00", narration: "Year-end close 2082/083" },
      { generalLedgerId: 20, debit: "0.00", credit: "60.00", narration: "Year-end close 2082/083" },
      { generalLedgerId: 99, debit: "0.00", credit: "40.00", narration: "Transfer net profit for 2082/083" },
    ]);
    const debit = result.lines.reduce((s, line) => s + Number(line.debit), 0);
    const credit = result.lines.reduce((s, line) => s + Number(line.credit), 0);
    expect(debit).toBe(credit);
  });

  it("transfers a net loss as a debit to the mapped clearing ledger", () => {
    const result = closingLines([
      { generalLedgerId: 10, closing: "-40.00" },
      { generalLedgerId: 20, closing: "100.00" },
    ], 99, "2082/083");
    expect(result.netResult).toBe("-60.00");
    expect(result.lines.at(-1)).toEqual({ generalLedgerId: 99, debit: "60.00", credit: "0.00", narration: "Transfer net loss for 2082/083" });
    expect(result.lines.reduce((s, line) => s + Number(line.debit), 0)).toBe(result.lines.reduce((s, line) => s + Number(line.credit), 0));
  });

  it("does not create a zero-value voucher for a zero P&L balance", () => {
    expect(closingLines([{ generalLedgerId: 10, closing: "0.00" }], 99, "2082/083")).toEqual({ netResult: "0.00", lines: [] });
  });

  it("refuses fractional cents rather than silently rounding a ledger balance", () => {
    expect(() => closingLines([{ generalLedgerId: 10, closing: "12.345" }], 99, "2082/083")).toThrow(/fractional cents/);
  });
});
