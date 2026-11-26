import type { FinancialReportRow } from "../api";

// Statement of Cash Flows, indirect method, built from the Balance Sheet rows (opening/closing per ledger) and the P&L rows of the period.
// Every non-cash ledger falls in exactly one section, so the statement reconciles to the movement of the cash/bank ledgers (GL "Cash or bank" flag).
// The section a line lands in follows the company's own account group / ledger names; change the patterns below to change the policy.
export const INVESTING_GROUP = /non.?current|fixed|investment|long.?term|intangible|capital work|property|equipment/i;
export const FIXED_ASSET_GROUP = /fixed|property|plant|equipment/i;
export const FINANCING_LIABILITY = /loan|borrow|overdraft|debenture|finance lease|non.?current|long.?term/i;
export const NON_CASH_EXPENSE = /depreciation|amorti[sz]ation/i;

const n = (v: string | number | undefined | null) => Number(v || 0);
export type CashLine = { label: string; amount: number };
export type CashFlow = {
  profit: number; adjustments: CashLine[]; workingCapital: CashLine[]; operating: number;
  investingLines: CashLine[]; investing: number; financingLines: CashLine[]; financing: number;
  netChange: number; openingCash: number; closingCash: number; difference: number;
};

export function buildCashFlow(bsRows: FinancialReportRow[], plRows: FinancialReportRow[], bsResult: number, plResult: number): CashFlow {
  const profit = plRows.reduce((s, r) => s + n(r.credit) - n(r.debit), 0);
  const priorResult = -plRows.reduce((s, r) => s + n(r.opening), 0); // result earlier in the same fiscal year, already inside opening equity
  const byGroup = (rows: FinancialReportRow[]) => { const m = new Map<number, { code: string; name: string; v: number }>(); for (const r of rows) { const g = m.get(r.accountGroupId) ?? { code: r.accountGroupCode, name: r.accountGroupName, v: 0 }; g.v += n(r.closing) - n(r.opening); m.set(r.accountGroupId, g); } return [...m.values()].sort((a, b) => a.code.localeCompare(b.code)); };
  const cash = bsRows.filter((r) => r.isCashOrBank && r.accountType === "ASSET");
  const noncash = bsRows.filter((r) => !(r.isCashOrBank && r.accountType === "ASSET"));
  const assets = noncash.filter((r) => r.accountType === "ASSET");
  const liabs = noncash.filter((r) => r.accountType === "LIABILITY");
  const equity = noncash.filter((r) => r.accountType === "EQUITY");

  const depreciation = plRows.filter((r) => r.accountType === "EXPENSE" && NON_CASH_EXPENSE.test(r.name)).reduce((s, r) => s + n(r.debit) - n(r.credit), 0);
  const adjustments: CashLine[] = depreciation ? [{ label: "Depreciation and amortisation", amount: depreciation }] : [];

  const investingAssets = assets.filter((r) => INVESTING_GROUP.test(r.accountGroupName));
  const operatingAssets = assets.filter((r) => !INVESTING_GROUP.test(r.accountGroupName));
  const financingLiabs = liabs.filter((r) => FINANCING_LIABILITY.test(r.name) || FINANCING_LIABILITY.test(r.accountGroupName));
  const operatingLiabs = liabs.filter((r) => !financingLiabs.includes(r));

  // Debit balances are positive: a rise in an asset uses cash, a rise in a liability (credit, negative) supplies it.
  const workingCapital: CashLine[] = [
    ...byGroup(operatingAssets).map((g) => ({ label: `(Increase) / decrease in ${g.name}`, amount: -g.v })),
    ...byGroup(operatingLiabs).map((g) => ({ label: `Increase / (decrease) in ${g.name}`, amount: -g.v })),
  ].filter((l) => Math.abs(l.amount) >= 0.005);
  // Depreciation lowers fixed assets without using cash, so the add-back above is matched by taking it out of the movement of the group it belongs to:
  // first what each group's accumulated depreciation / amortisation ledgers moved by, then any rest (written off the asset directly, or removed on a disposal)
  // from the fixed-asset group. Account group codes play no part.
  const groups = byGroup(investingAssets).map((g) => ({ name: g.name, amount: -g.v }));
  let unallocated = depreciation;
  for (const g of groups) {
    const own = -investingAssets.filter((r) => r.accountGroupName === g.name && NON_CASH_EXPENSE.test(r.name)).reduce((s, r) => s + n(r.closing) - n(r.opening), 0);
    g.amount -= own; unallocated -= own;
  }
  if (Math.abs(unallocated) >= 0.005) {
    const target = groups.find((g) => FIXED_ASSET_GROUP.test(g.name));
    if (target) target.amount -= unallocated;
    else groups.push({ name: "fixed assets", amount: -unallocated });
  }
  const investingLines: CashLine[] = groups.map((g) => ({ label: `Net (acquisition) / disposal of ${g.name}`, amount: g.amount })).filter((l) => Math.abs(l.amount) >= 0.005);

  // Equity: everything except the period profit (capital introduced, drawings, dividends, transfers).
  const equityMove = -equity.reduce((s, r) => s + n(r.closing) - n(r.opening), 0) + (bsResult - priorResult) - profit;
  const financingLines: CashLine[] = [
    ...byGroup(financingLiabs).map((g) => ({ label: `Net proceeds / (repayment) of ${g.name}`, amount: -g.v })),
    { label: "Capital introduced / (drawings and dividends paid)", amount: equityMove },
  ].filter((l) => Math.abs(l.amount) >= 0.005);

  const sum = (l: CashLine[]) => l.reduce((s, x) => s + x.amount, 0);
  const operating = profit + sum(adjustments) + sum(workingCapital), investing = sum(investingLines), financing = sum(financingLines);
  const netChange = operating + investing + financing;
  const openingCash = cash.reduce((s, r) => s + n(r.opening), 0), closingCash = cash.reduce((s, r) => s + n(r.closing), 0);
  void plResult;
  return { profit, adjustments, workingCapital, operating, investingLines, investing, financingLines, financing, netChange, openingCash, closingCash, difference: closingCash - openingCash - netChange };
}

export type ComparativeLine = { label: string; amount: number; prior: number };
// Lines of both years side by side; a line that exists in only one year shows nil in the other.
export function withPrior(current: CashLine[], prior: CashLine[] = []): ComparativeLine[] {
  const before = new Map(prior.map((l) => [l.label, l.amount]));
  const labels = new Set(current.map((l) => l.label));
  return [
    ...current.map((l) => ({ ...l, prior: before.get(l.label) ?? 0 })),
    ...prior.filter((l) => !labels.has(l.label)).map((l) => ({ label: l.label, amount: 0, prior: l.amount })),
  ];
}
