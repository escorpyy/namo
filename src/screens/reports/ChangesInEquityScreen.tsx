import { useEffect, useMemo, useState, type MutableRefObject } from "react";
import { Printer, RefreshCw } from "lucide-react";
import { financialReportsApi, type FinancialReportResult, type FinancialReportRow } from "../../api";
import { adToBs } from "../../lib/nepaliDate";
import { signed } from "../../components/reports/HierarchicalStatement";
import type { StatusInfo } from "../../types";

// Statement of Changes in Equity (NFRS for SMEs): one column per EQUITY account group of this company (Share Capital, Reserves & Surplus, ...),
// rows Opening, Profit for the period, Other movements, Closing. Closing equals the Statement of Financial Position's equity.
const n = (v: string | number | undefined) => Number(v || 0);

export default function ChangesInEquityScreen(p: {
  companyName?: string; companyId: number; branchId: number; fyCode: string; fyStart: string; fyEnd: string; calendar: "BS" | "AD";
  setStatus: (s: StatusInfo) => void; dirtyRef: MutableRefObject<boolean>;
}) {
  const [from, setFrom] = useState(p.fyStart), [to, setTo] = useState(p.fyEnd);
  const [bs, setBs] = useState<FinancialReportResult | null>(null), [pl, setPl] = useState<FinancialReportResult | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState("");
  const date = (ad: string) => (p.calendar === "BS" ? `${adToBs(ad) ?? ad} BS` : ad);

  const load = () => {
    if (!from || !to || from > to || from < p.fyStart || to > p.fyEnd) { setError(`Choose dates within fiscal year ${p.fyCode} (${p.fyStart} to ${p.fyEnd}).`); return; }
    setLoading(true); setError("");
    const q = { companyId: p.companyId, branchId: p.branchId, fiscalYear: p.fyCode, from, to };
    Promise.all([financialReportsApi.get("balance-sheet", q), financialReportsApi.get("profit-loss", q)])
      .then(([b, l]) => { setBs(b); setPl(l); }).catch((e: Error) => setError(e.message)).finally(() => setLoading(false));
  };
  useEffect(() => { p.dirtyRef.current = false; load(); }, [p.companyId, p.branchId, p.fyCode]);
  useEffect(() => { p.setStatus({ mode: "view", count: bs?.rows.length ?? 0, shown: bs?.rows.length ?? 0, message: error || (loading ? "Running report…" : bs ? "Report ready" : "Choose a period"), kind: error ? "err" : "info", hints: ["Posted transactions only", "Columns are your equity account groups"] }); }, [bs, loading, error]);

  const model = useMemo(() => {
    if (!bs || !pl) return null;
    const equity = bs.rows.filter((r) => r.accountType === "EQUITY");
    const profit = n(pl.totals.currentResult), bsResult = n(bs.totals.currentResult);
    const resId = bs.resultLedger?.id;
    const inEquity = equity.some((r) => r.generalLedgerId === resId);
    type Col = { key: string; name: string; opening: number; profit: number; closing: number };
    const cols = new Map<string, Col>();
    const order: string[] = [];
    for (const r of equity.slice().sort((a, b) => a.accountGroupCode.localeCompare(b.accountGroupCode))) {
      const key = `g${r.accountGroupId}`;
      if (!cols.has(key)) { cols.set(key, { key, name: r.accountGroupName, opening: 0, profit: 0, closing: 0 }); order.push(key); }
      const c = cols.get(key)!;
      c.opening += -n(r.opening); c.closing += -n(r.closing);
      if (r.generalLedgerId === resId) { c.profit += profit; c.closing += bsResult; }
    }
    // The result ledger is not an equity ledger: the period profit has no column of its own to join, so it gets one.
    if (!inEquity && (Math.abs(profit) >= 0.005 || Math.abs(bsResult) >= 0.005)) {
      cols.set("result", { key: "result", name: bs.resultLedger?.name ?? "Profit and Loss Account", opening: 0, profit, closing: bsResult });
      order.push("result");
    }
    const list = order.map((k) => cols.get(k)!);
    const total = list.reduce((a, c) => ({ opening: a.opening + c.opening, profit: a.profit + c.profit, closing: a.closing + c.closing }), { opening: 0, profit: 0, closing: 0 });
    return { list, total };
  }, [bs, pl]);

  const other = (c: { opening: number; profit: number; closing: number }) => c.closing - c.opening - c.profit;
  const lines: { label: string; get: (c: { opening: number; profit: number; closing: number }) => number; strong?: boolean }[] = [
    { label: "Balance at the beginning of the period", get: (c) => c.opening, strong: true },
    { label: "Profit / (loss) for the period", get: (c) => c.profit },
    { label: "Other movements (capital introduced, dividends, transfers, revaluation)", get: other },
    { label: "Balance at the end of the period", get: (c) => c.closing, strong: true },
  ];

  return <main className="flex-1 min-w-0 flex flex-col bg-slate-50">
    <div className="border-b bg-white px-5 py-3 flex flex-wrap items-center gap-3">
      <div><div className="text-[11px] font-semibold uppercase tracking-wide text-blue-700">NFRS for SMEs</div><h1 className="text-lg font-semibold text-slate-800">Statement of Changes in Equity</h1><p className="text-xs text-slate-500">{p.fyCode} · columns follow your equity account groups</p></div>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <label className="text-xs text-slate-600">From <input className="input h-8 ml-1" type="date" value={from} min={p.fyStart} max={p.fyEnd} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="text-xs text-slate-600">To <input className="input h-8 ml-1" type="date" value={to} min={p.fyStart} max={p.fyEnd} onChange={(e) => setTo(e.target.value)} /></label>
        <button className="btn btn-primary h-8" onClick={load}><RefreshCw size={14} /> Refresh</button>
        {model && <button className="btn h-8" onClick={() => { document.body.classList.add("printing-fs"); window.addEventListener("afterprint", () => document.body.classList.remove("printing-fs"), { once: true }); window.print(); }}><Printer size={14} /> Print</button>}
      </div>
    </div>
    {error && <div className="mx-5 mt-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
    <div className="p-5 overflow-auto"><div className="fs-print min-w-[760px] rounded border bg-white shadow-sm">
      <div className="border-b px-4 py-4 text-center">{p.companyName && <div className="text-base font-bold text-slate-900">{p.companyName}</div>}<div className="font-semibold text-slate-800">Statement of Changes in Equity</div><div className="text-xs font-medium uppercase text-slate-600">For the period {date(from)} to {date(to)}</div><div className="text-xs text-slate-500">Figures in NPR · {p.fyCode}</div></div>
      {model && <table className="w-full text-sm">
        <thead><tr className="bg-slate-700 text-left text-xs text-white"><th className="px-4 py-2">Particulars</th>{model.list.map((c) => <th key={c.key} className="px-3 py-2 text-right">{c.name}</th>)}<th className="px-3 py-2 text-right">Total</th></tr></thead>
        <tbody>{lines.map((l) => <tr key={l.label} className={`border-t ${l.strong ? "bg-slate-50 font-semibold" : ""}`}><td className="px-4 py-2">{l.label}</td>{model.list.map((c) => <td key={c.key} className="px-3 py-2 text-right tabular-nums">{signed(l.get(c))}</td>)}<td className="px-3 py-2 text-right tabular-nums">{signed(l.get(model.total))}</td></tr>)}</tbody>
      </table>}
      {model && !model.list.length && <div className="p-8 text-center text-slate-500">No equity ledgers or period result.</div>}
      {loading && <div className="p-3 text-center text-xs text-slate-500">Loading…</div>}
      {model && <div className="border-t px-4 py-4 text-xs text-slate-600"><div className="font-medium uppercase">The accompanying notes are an integral part of these financial statements.</div><div className="mt-8 grid grid-cols-3 gap-6 text-center">{["Accounts Head", "Director", "Chairperson"].map((t) => <div key={t}><div className="border-t border-slate-400 pt-1">{t}</div></div>)}</div><div className="mt-6 text-center"><div className="mx-auto w-64 border-t border-slate-400 pt-1">Auditor (Chartered Accountants / Registered Auditor)</div></div></div>}
    </div></div>
  </main>;
}
