import { describe, expect, it } from "vitest";
import { buildCashFlow, withPrior } from "../src/lib/cashFlow";

let id = 0;
const row = (accountType: string, gc: string, group: string, name: string, opening: number, closing: number, o: any = {}) =>
  ({ generalLedgerId: ++id, code: String(id), name, accountGroupId: Number(gc.slice(2)), accountGroupCode: gc, accountGroupName: group, accountType, accountSubGroupId: null, accountSubGroupCode: null, accountSubGroupName: null,
     isCashOrBank: !!o.cash, opening: String(opening), debit: String(o.dr ?? 0), credit: String(o.cr ?? 0), closing: String(closing), net: "0", closingDebit: "0", closingCredit: "0" }) as any;

describe("cash flow (indirect)", () => {
  it("reconciles to the movement of cash and bank", () => {
    // Opening: cash 1000 = capital 1000. In the year: sales 500 cash+200 on credit, expenses 300 cash (incl. depreciation 100 non-cash), buy equipment 400 cash,
    // borrow loan 600, owner draws 50, pay 0 to creditors but buy goods on credit 80 (stock).
    const bs = [
      row("ASSET", "AG01", "Current Assets", "Cash", 1000, 1000 + 500 - 200 - 400 + 600 - 50, { cash: true }),
      row("ASSET", "AG01", "Current Assets", "Trade Debtors", 0, 200),
      row("ASSET", "AG01", "Current Assets", "Stock", 0, 80),
      row("ASSET", "AG02", "Fixed Assets", "Equipment", 0, 300),
      row("LIABILITY", "AG03", "Current Liabilities", "Trade Creditors", 0, -80),
      row("LIABILITY", "AG04", "Non-current Liabilities", "Bank Loan", 0, -600),
      row("EQUITY", "AG05", "Capital", "Owner Capital", -1000, -1000 + 50),
    ];
    const pl = [row("REVENUE", "AG06", "Direct Income", "Sales", 0, -700, { cr: 700 }), row("EXPENSE", "AG07", "Indirect Expenses", "Rent", 0, 200, { dr: 200 }), row("EXPENSE", "AG07", "Indirect Expenses", "Depreciation", 0, 100, { dr: 100 })];
    const cf = buildCashFlow(bs, pl, 400, 400);
    expect(cf.profit).toBe(400);
    expect(cf.operating).toBe(400 + 100 - 200 - 80 + 80);
    expect(cf.investing).toBe(-400);
    expect(cf.financing).toBe(600 - 50);
    expect(cf.openingCash).toBe(1000);
    expect(cf.closingCash).toBe(1450);
    expect(Math.abs(cf.difference)).toBeLessThan(0.005);
  });

  it("takes depreciation off the fixed asset group even when an investment group has the earlier code", () => {
    const pl = [row("EXPENSE", "AG07", "Indirect Expenses", "Depreciation Expense", 0, 100, { dr: 100 })];
    const investment = row("ASSET", "AG01", "Non-current Assets", "Long-term Investments", 0, 250);
    const cash = row("ASSET", "AG00", "Current Assets", "Cash", 1000, 750, { cash: true });
    const equipment = (closing: number) => row("ASSET", "AG02", "Fixed Assets", "Equipment", 500, closing);
    const capital = row("EQUITY", "AG05", "Capital", "Owner Capital", -1500, -1500);
    const expected = [{ label: "Net (acquisition) / disposal of Non-current Assets", amount: -250 }];
    // Through an accumulated depreciation ledger, and written off the asset directly: nothing was bought or sold either way.
    for (const fixed of [[equipment(500), row("ASSET", "AG02", "Fixed Assets", "Accumulated Depreciation", 0, -100)], [equipment(400)]]) {
      const cf = buildCashFlow([cash, investment, ...fixed, capital], pl, -100, -100);
      expect(cf.investingLines).toEqual(expected);
      expect(Math.abs(cf.difference)).toBeLessThan(0.005);
    }
  });

  it("puts both years side by side, with nil where a line is missing", () => {
    expect(withPrior([{ label: "A", amount: 1 }, { label: "B", amount: 2 }], [{ label: "B", amount: 3 }, { label: "C", amount: 4 }]))
      .toEqual([{ label: "A", amount: 1, prior: 0 }, { label: "B", amount: 2, prior: 3 }, { label: "C", amount: 0, prior: 4 }]);
  });
});
