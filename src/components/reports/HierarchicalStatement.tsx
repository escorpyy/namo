import type { ReactNode } from "react";
import type { FinancialReportRow } from "../../api";

// P&L and Statement of Financial Position laid out like the NFRS for SMEs model statements (sections, totals, notes column, comparatives),
// but the lines inside each section follow THIS company's chart of accounts: Account Group -> Sub Group -> Ledger, with the names the user gave them.

type Row = FinancialReportRow;
export type ResultInfo = { id?: number; name: string; amount: number };

const amt = (v: string | number) => Number(v || 0);
const money = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const signed = (v: number) => (Math.abs(v) < 0.005 ? "-" : v > 0 ? money(v) : `(${money(-v)})`);

// Note numbers follow the model statements (5 revenue ... 21 payables). Looked up on the group name first, then the ledger name.
export const noteFor = (name: string) => {
  const n = name.toLowerCase();
  if (n.includes("other income") || n.includes("indirect income")) return "6";
  if (n.includes("revenue") || n.includes("sale") || n.includes("direct income")) return "5";
  if (n.includes("interest") && /received|income|earned/.test(n)) return "6";
  if (n.includes("finance") || n.includes("interest")) return "7";
  if (/\btax\b/.test(n)) return "9";
  if (n.includes("cash") || n.includes("bank")) return "11";
  if (n.includes("receivable") || n.includes("debtor")) return "12";
  if (n.includes("inventor") || n.includes("stock")) return "13";
  if (n.includes("property") || n.includes("equipment") || n.includes("fixed asset") || n.includes("depreciation")) return "16";
  if (n.includes("payable") || n.includes("creditor")) return "21";
  return "";
};

const isTax = (r: Row) => /\btax\b|income tax|deferred tax/i.test(r.name) && r.accountType === "EXPENSE";
const isOci = (r: Row) => /other comprehensive|\boci\b|revaluation/i.test(r.name) && (r.accountType === "REVENUE" || r.accountType === "EXPENSE");
const isDirect = (r: Row) => /^direct\b|cost of (sales|goods)|^trading\b/i.test(r.accountGroupName);
const isNonCurrentGroup = (name: string) => /non.?current|fixed|long.?term|capital|reserve/i.test(name);

type Sub = { key: number; name: string; code: string; ledgers: Row[] };
type Group = { id: number; code: string; name: string; subs: Sub[] };

function buildGroups(rows: Row[], sortGroups?: (a: Group, b: Group) => number): Group[] {
  const groups = new Map<number, Group>();
  for (const r of rows) {
    let g = groups.get(r.accountGroupId);
    if (!g) { g = { id: r.accountGroupId, code: r.accountGroupCode, name: r.accountGroupName, subs: [] }; groups.set(r.accountGroupId, g); }
    const key = r.accountSubGroupId ?? 0;
    let s = g.subs.find((x) => x.key === key);
    if (!s) { s = { key, name: r.accountSubGroupName ?? "", code: r.accountSubGroupCode ?? "", ledgers: [] }; g.subs.push(s); }
    s.ledgers.push(r);
  }
  const out = [...groups.values()];
  for (const g of out) g.subs.sort((a, b) => (a.key === 0 ? -1 : b.key === 0 ? 1 : a.code.localeCompare(b.code)));
  return out.sort(sortGroups ?? ((a, b) => a.code.localeCompare(b.code)));
}

export function HierarchicalStatement({ rows, comparative, kind, result, priorResult }: {
  rows: Row[]; comparative: Map<number, Row>; kind: "profit-loss" | "balance-sheet"; result?: ResultInfo; priorResult?: number;
}) {
  const pl = kind === "profit-loss";
  // Natural-sign amount of a ledger: income and liabilities/equity positive when credit, assets and expenses positive when debit.
  const natural = (r: Row | undefined) => {
    if (!r) return 0;
    if (pl) return r.accountType === "REVENUE" ? amt(r.credit) - amt(r.debit) : amt(r.debit) - amt(r.credit);
    return r.accountType === "ASSET" ? amt(r.closing) : -amt(r.closing);
  };
  const adjNow = new Map<number, number>(), adjPrev = new Map<number, number>(); // period result folded into the Profit and Loss equity ledger
  const now = (r: Row) => adjNow.get(r.generalLedgerId) ?? natural(r);
  const prev = (r: Row) => adjPrev.get(r.generalLedgerId) ?? natural(comparative.get(r.generalLedgerId));
  const live = (r: Row) => Math.abs(now(r)) >= 0.005 || Math.abs(prev(r)) >= 0.005;
  const sumOf = (list: Row[], f: (r: Row) => number) => list.reduce((s, r) => s + f(r), 0);
  const tot = (list: Row[]) => sumOf(list, now);
  const totPrev = (list: Row[]) => sumOf(list, prev);

  const Line = ({ label, note, a, b, level = 0, tone = "" }: { label: ReactNode; note?: string; a: number; b: number; level?: number; tone?: string }) => (
    <tr className={`border-t hover:bg-blue-50 ${tone}`}>
      <td className="py-1.5 pr-3 text-slate-800" style={{ paddingLeft: 16 + level * 20 }}>{label}</td>
      <td className="px-2 py-1.5 text-center text-slate-500">{note ?? ""}</td>
      <td className="px-3 py-1.5 text-right tabular-nums">{signed(a)}</td>
      <td className="px-3 py-1.5 text-right tabular-nums">{signed(b)}</td>
    </tr>
  );
  const Section = ({ children }: { children: ReactNode }) => <tr className="bg-slate-100 font-semibold uppercase tracking-wide text-slate-700"><td colSpan={4} className="border-t px-4 py-2">{children}</td></tr>;
  const Total = ({ label, a, b, strong }: { label: string; a: number; b: number; strong?: boolean }) => <Line label={label} a={a} b={b} tone={strong ? "border-t-2 bg-blue-100 font-bold" : "bg-slate-50 font-semibold"} />;

  // Account Group -> Sub Group -> Ledger, in the application's own order and names.
  const tree = (list: Row[], sortGroups?: (a: Group, b: Group) => number, baseLevel = 0): ReactNode[] =>
    buildGroups(list.filter(live), sortGroups).flatMap((g) => {
      const all = g.subs.flatMap((s) => s.ledgers);
      return [
        <Line key={`g${g.id}`} label={g.name} note={noteFor(g.name)} a={tot(all)} b={totPrev(all)} level={baseLevel} tone="font-semibold" />,
        ...g.subs.flatMap((s) => [
          ...(s.name ? [<Line key={`s${g.id}-${s.key}`} label={s.name} a={tot(s.ledgers)} b={totPrev(s.ledgers)} level={baseLevel + 1} tone="font-medium text-slate-700" />] : []),
          ...s.ledgers.map((r) => <Line key={r.generalLedgerId} label={r.name} note={noteFor(r.name)} a={now(r)} b={prev(r)} level={baseLevel + (s.name ? 2 : 1)} />),
        ]),
      ];
    });

  if (pl) {
    const tax = rows.filter(isTax);
    const oci = rows.filter(isOci);
    const rest = rows.filter((r) => !isTax(r) && !isOci(r));
    const revenue = rest.filter((r) => r.accountType === "REVENUE");
    const expense = rest.filter((r) => r.accountType === "EXPENSE");
    const directIncome = revenue.filter(isDirect), directExpense = expense.filter(isDirect);
    const trading = directIncome.length + directExpense.length > 0;
    const sales = trading ? directIncome : revenue;
    const otherIncome = trading ? revenue.filter((r) => !isDirect(r)) : [];
    const costOfSales = directExpense;
    const operating = trading ? expense.filter((r) => !isDirect(r)) : expense;
    const gross = tot(sales) - tot(costOfSales), grossP = totPrev(sales) - totPrev(costOfSales);
    const pbt = gross + tot(otherIncome) - tot(operating), pbtP = grossP + totPrev(otherIncome) - totPrev(operating);
    const profit = pbt - tot(tax), profitP = pbtP - totPrev(tax);
    return <>
      <Section>Revenue</Section>
      {tree(sales)}
      <Total label="Total revenue" a={tot(sales)} b={totPrev(sales)} />
      {trading && <>
        <Section>Cost of sales</Section>
        {tree(costOfSales)}
        <Total label="Total cost of sales" a={tot(costOfSales)} b={totPrev(costOfSales)} />
        <Total label="Gross profit" a={gross} b={grossP} strong />
      </>}
      {otherIncome.some(live) && <><Section>Other income</Section>{tree(otherIncome)}<Total label="Total other income" a={tot(otherIncome)} b={totPrev(otherIncome)} /></>}
      <Section>Expenses</Section>
      {tree(operating)}
      <Total label="Total expenses" a={tot(operating)} b={totPrev(operating)} />
      <Total label="Profit / (loss) before tax" a={pbt} b={pbtP} strong />
      <Line label="Income tax expense" note="9" a={tot(tax)} b={totPrev(tax)} />
      <Total label="Profit / (loss) for the year" a={profit} b={profitP} strong />
      <Section>Other comprehensive income</Section>
      {oci.filter(live).map((r) => <Line key={r.generalLedgerId} label={r.name} a={now(r)} b={prev(r)} level={1} />)}
      <Total label="Total other comprehensive income" a={tot(oci)} b={totPrev(oci)} />
      <Total label="Total comprehensive income for the year" a={profit + tot(oci)} b={profitP + totPrev(oci)} strong />
    </>;
  }

  // Statement of Financial Position
  const assets = rows.filter((r) => r.accountType === "ASSET");
  const liabilities = rows.filter((r) => r.accountType === "LIABILITY");
  const equity = rows.filter((r) => r.accountType === "EQUITY");
  // Non-current groups first, as in the model statement; otherwise the application's group order.
  const model = (a: Group, b: Group) => Number(isNonCurrentGroup(b.name)) - Number(isNonCurrentGroup(a.name)) || a.code.localeCompare(b.code);
  // The period result sits under the GL Setup Profit and Loss ledger's name. If that ledger is an equity row the result is added into it; otherwise a profit
  // shows as its own line on the equity side and a loss on the assets side.
  const resName = result?.name ?? "Profit and Loss Account", resNow = result?.amount ?? 0, resPrior = priorResult ?? 0;
  const plRow = equity.find((r) => r.generalLedgerId === result?.id);
  const separate = !plRow;
  const lossNow = separate ? Math.max(-resNow, 0) : 0, lossPrior = separate ? Math.max(-resPrior, 0) : 0;
  const profitNow = separate ? Math.max(resNow, 0) : 0, profitPrior = separate ? Math.max(resPrior, 0) : 0;
  if (plRow) { adjNow.set(plRow.generalLedgerId, natural(plRow) + resNow); adjPrev.set(plRow.generalLedgerId, natural(comparative.get(plRow.generalLedgerId)) + resPrior); }
  const equityNow = tot(equity) + profitNow, equityPrior = totPrev(equity) + profitPrior;
  const assetNow = tot(assets) + lossNow, assetPrior = totPrev(assets) + lossPrior;
  const liabNow = tot(liabilities), liabPrior = totPrev(liabilities);
  const equityTree = tree(equity, model);
  const diffNow = assetNow - liabNow - equityNow, diffPrior = assetPrior - liabPrior - equityPrior;
  return <>
    <Section>Assets</Section>
    {tree(assets, model)}
    {lossNow > 0 || lossPrior > 0 ? <Line label={`${resName} (loss for the period)`} a={lossNow} b={lossPrior} level={1} /> : null}
    <Total label="Total assets" a={assetNow} b={assetPrior} strong />
    <Section>Liabilities</Section>
    {tree(liabilities, model)}
    <Total label="Total liabilities" a={liabNow} b={liabPrior} />
    <Section>Equity</Section>
    {equityTree}
    {profitNow > 0 || profitPrior > 0 ? <Line label={`${resName} (profit for the period)`} a={profitNow} b={profitPrior} level={1} /> : null}
    <Total label="Total equity" a={equityNow} b={equityPrior} />
    <Total label="Total liabilities and equity" a={liabNow + equityNow} b={liabPrior + equityPrior} strong />
    {(Math.abs(diffNow) >= 0.005 || Math.abs(diffPrior) >= 0.005) && <tr className="border-t bg-rose-50 text-rose-700"><td className="px-4 py-1.5">Difference (assets less liabilities and equity)</td><td /><td className="px-3 py-1.5 text-right tabular-nums">{signed(diffNow)}</td><td className="px-3 py-1.5 text-right tabular-nums">{signed(diffPrior)}</td></tr>}
  </>;
}
