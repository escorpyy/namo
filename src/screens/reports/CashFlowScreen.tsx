import { useEffect, useMemo, useState, type MutableRefObject } from "react";
import { Printer, RefreshCw } from "lucide-react";
import { financialReportsApi, type FinancialReportResult } from "../../api";
import { adToBs } from "../../lib/nepaliDate";
import { buildCashFlow, type CashLine } from "../../lib/cashFlow";
import { signed } from "../../components/reports/HierarchicalStatement";
import type { StatusInfo } from "../../types";

// Statement of Cash Flows (indirect). Section lines are your own account group names; see src/lib/cashFlow.ts for how groups map to sections.
export default function CashFlowScreen(p: {
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
  useEffect(() => { p.setStatus({ mode: "view", count: bs?.rows.length ?? 0, shown: bs?.rows.length ?? 0, message: error || (loading ? "Running report…" : bs ? "Report ready" : "Choose a period"), kind: error ? "err" : "info", hints: ["Posted transactions only", "Indirect method", "Cash ledgers are those flagged Cash or bank"] }); }, [bs, loading, error]);

  const cf = useMemo(() => (bs && pl ? buildCashFlow(bs.rows, pl.rows, Number(bs.totals.currentResult), Number(pl.totals.currentResult)) : null), [bs, pl]);
  const noCash = !!bs && !bs.rows.some((r) => r.isCashOrBank && r.accountType === "ASSET");

  const Head = ({ children }: { children: string }) => <tr className="bg-slate-100 font-semibold uppercase tracking-wide text-slate-700"><td colSpan={2} className="border-t px-4 py-2">{children}</td></tr>;
  const Line = ({ l, level = 1 }: { l: CashLine; level?: number }) => <tr className="border-t hover:bg-blue-50"><td className="py-1.5 pr-3" style={{ paddingLeft: 16 + level * 20 }}>{l.label}</td><td className="px-3 py-1.5 text-right tabular-nums">{signed(l.amount)}</td></tr>;
  const Total = ({ label, v, strong }: { label: string; v: number; strong?: boolean }) => <tr className={`border-t ${strong ? "border-t-2 bg-blue-100 font-bold" : "bg-slate-50 font-semibold"}`}><td className="px-4 py-1.5">{label}</td><td className="px-3 py-1.5 text-right tabular-nums">{signed(v)}</td></tr>;

  return <main className="flex-1 min-w-0 flex flex-col bg-slate-50">
    <div className="border-b bg-white px-5 py-3 flex flex-wrap items-center gap-3">
      <div><div className="text-[11px] font-semibold uppercase tracking-wide text-blue-700">NFRS for SMEs</div><h1 className="text-lg font-semibold text-slate-800">Statement of Cash Flows</h1><p className="text-xs text-slate-500">{p.fyCode} · indirect method · lines follow your account groups</p></div>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <label className="text-xs text-slate-600">From <input className="input h-8 ml-1" type="date" value={from} min={p.fyStart} max={p.fyEnd} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="text-xs text-slate-600">To <input className="input h-8 ml-1" type="date" value={to} min={p.fyStart} max={p.fyEnd} onChange={(e) => setTo(e.target.value)} /></label>
        <button className="btn btn-primary h-8" onClick={load}><RefreshCw size={14} /> Refresh</button>
        {cf && <button className="btn h-8" onClick={() => { document.body.classList.add("printing-fs"); window.addEventListener("afterprint", () => document.body.classList.remove("printing-fs"), { once: true }); window.print(); }}><Printer size={14} /> Print</button>}
      </div>
    </div>
    {error && <div className="mx-5 mt-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
    {noCash && <div className="mx-5 mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">No ledger is flagged Cash or bank, so cash and cash equivalents show as zero. Flag your cash and bank ledgers in the General Ledger master.</div>}
    <div className="p-5 overflow-auto"><div className="fs-print min-w-[720px] rounded border bg-white shadow-sm">
      <div className="border-b px-4 py-4 text-center">{p.companyName && <div className="text-base font-bold text-slate-900">{p.companyName}</div>}<div className="font-semibold text-slate-800">Statement of Cash Flows</div><div className="text-xs font-medium uppercase text-slate-600">For the period {date(from)} to {date(to)}</div><div className="text-xs text-slate-500">Figures in NPR · {p.fyCode}</div></div>
      {cf && <table className="w-full text-sm"><thead><tr className="bg-slate-700 text-left text-xs text-white"><th className="px-4 py-2">Particulars</th><th className="px-3 py-2 text-right">{p.fyCode}</th></tr></thead><tbody>
        <Head>Cash flows from operating activities</Head>
        <Line l={{ label: "Profit / (loss) for the period", amount: cf.profit }} />
        {cf.adjustments.map((l) => <Line key={l.label} l={l} />)}
        {cf.workingCapital.map((l) => <Line key={l.label} l={l} />)}
        <Total label="Net cash from / (used in) operating activities" v={cf.operating} />
        <Head>Cash flows from investing activities</Head>
        {cf.investingLines.map((l) => <Line key={l.label} l={l} />)}
        <Total label="Net cash from / (used in) investing activities" v={cf.investing} />
        <Head>Cash flows from financing activities</Head>
        {cf.financingLines.map((l) => <Line key={l.label} l={l} />)}
        <Total label="Net cash from / (used in) financing activities" v={cf.financing} />
        <Total label="Net increase / (decrease) in cash and cash equivalents" v={cf.netChange} strong />
        <Line l={{ label: "Cash and cash equivalents at the beginning of the period", amount: cf.openingCash }} level={0} />
        <Total label="Cash and cash equivalents at the end of the period" v={cf.openingCash + cf.netChange} strong />
        {Math.abs(cf.difference) >= 0.005 && <tr className="border-t bg-rose-50 text-rose-700"><td className="px-4 py-1.5">Difference to cash and bank ledgers (check classification)</td><td className="px-3 py-1.5 text-right tabular-nums">{signed(cf.difference)}</td></tr>}
      </tbody></table>}
      {loading && <div className="p-3 text-center text-xs text-slate-500">Loading…</div>}
      {cf && <div className="border-t px-4 py-4 text-xs text-slate-600"><div className="font-medium uppercase">The accompanying notes are an integral part of these financial statements.</div><div className="mt-8 grid grid-cols-3 gap-6 text-center">{["Accounts Head", "Director", "Chairperson"].map((t) => <div key={t}><div className="border-t border-slate-400 pt-1">{t}</div></div>)}</div><div className="mt-6 text-center"><div className="mx-auto w-64 border-t border-slate-400 pt-1">Auditor (Chartered Accountants / Registered Auditor)</div></div></div>}
    </div></div>
  </main>;
}
