import { describe, expect, it } from "vitest";
import { buildCashFlow } from "../src/lib/cashFlow";

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
});
