import { useEffect, useMemo, useState, type MutableRefObject } from "react";
import { Download, RefreshCw, Search } from "lucide-react";
import { financialReportsApi, type FinancialReportKind, type FinancialReportResult, type FinancialReportRow } from "../../api";
import type { StatusInfo } from "../../types";

const titles: Record<FinancialReportKind, string> = { "trial-balance": "Trial Balance", "profit-loss": "Profit & Loss", "balance-sheet": "Balance Sheet" };
const money = (v: string | number) => Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = (v: string) => Number(v) >= 0 ? money(v) : `(${money(String(-Number(v)))})`;

export default function FinancialStatementScreen(p: { kind: FinancialReportKind; companyId: number; branchId: number; fyCode: string; fyStart: string; fyEnd: string; setStatus: (s: StatusInfo) => void; dirtyRef: MutableRefObject<boolean>; reportFamily?: string }) {
  const [from, setFrom] = useState(p.fyStart), [to, setTo] = useState(p.fyEnd);
  const [result, setResult] = useState<FinancialReportResult | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const load = () => {
    if (!from || !to || from > to || from < p.fyStart || to > p.fyEnd) { setError(`Choose dates within fiscal year ${p.fyCode} (${p.fyStart} to ${p.fyEnd}).`); return; }
    setLoading(true); setError("");
    financialReportsApi.get(p.kind, { companyId: p.companyId, branchId: p.branchId, fiscalYear: p.fyCode, from, to }).then(setResult).catch((e: Error) => setError(e.message)).finally(() => setLoading(false));
  };
  useEffect(() => { p.dirtyRef.current = false; load(); }, [p.companyId, p.branchId, p.fyCode, p.kind]);
  useEffect(() => { p.setStatus({ mode: "view", count: result?.rows.length ?? 0, shown: result?.rows.length ?? 0, message: error || (loading ? "Running financial report…" : result ? "Report ready" : "Choose a period"), kind: error ? "err" : "info", hints: ["Posted transactions only", "Click Refresh after changing dates"] }); }, [result, loading, error, p.setStatus]);
  const groups = useMemo(() => {
    const out: { key: string; label: string; rows: FinancialReportRow[] }[] = [];
    const term = search.trim().toLowerCase();
    for (const row of result?.rows ?? []) {
      if (term && !`${row.code} ${row.name} ${row.accountGroupName} ${row.accountSubGroupName ?? ""}`.toLowerCase().includes(term)) continue;
      const key = `${row.accountGroupId}:${row.accountSubGroupId ?? "none"}`;
      let group = out.find((x) => x.key === key);
      if (!group) { group = { key, label: `${row.accountGroupCode} — ${row.accountGroupName}${row.accountSubGroupName ? ` / ${row.accountSubGroupCode} — ${row.accountSubGroupName}` : ""}`, rows: [] }; out.push(group); }
      group.rows.push(row);
    }
    return out;
  }, [result, search]);
  const exportCsv = () => {
    if (!result) return;
    const lines = [["Account Group", "Sub Group", "Ledger", "Opening", "Debit", "Credit", "Closing"], ...result.rows.map((r) => [r.accountGroupName, r.accountSubGroupName ?? "", `${r.code} — ${r.name}`, r.opening, r.debit, r.credit, r.closing])];
    const csv = lines.map((line) => line.map((x) => `"${String(x).replaceAll('"', '""')}"`).join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = `${p.kind}-${from}-${to}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  const total = result?.totals;
  return <main className="flex-1 min-w-0 flex flex-col bg-slate-50">
    <div className="border-b bg-white px-5 py-3 flex flex-wrap items-center gap-3"><div><div className="text-[11px] font-semibold uppercase tracking-wide text-blue-700">{p.reportFamily ?? "Financial Statements"}</div><h1 className="text-lg font-semibold text-slate-800">{titles[p.kind]}</h1><p className="text-xs text-slate-500">{p.fyCode} · Posted entries · {from} to {to}</p></div><div className="ml-auto flex flex-wrap items-center gap-2"><label className="relative text-xs text-slate-600"><Search size={14} className="absolute left-2 top-2 text-slate-400" /><input className="input h-8 w-48 pl-7" placeholder="Search ledger or group" value={search} onChange={(e) => setSearch(e.target.value)} /></label><label className="text-xs text-slate-600">From <input className="input h-8 ml-1" type="date" value={from} min={p.fyStart} max={p.fyEnd} onChange={(e) => setFrom(e.target.value)} /></label><label className="text-xs text-slate-600">To <input className="input h-8 ml-1" type="date" value={to} min={p.fyStart} max={p.fyEnd} onChange={(e) => setTo(e.target.value)} /></label><button className="btn btn-primary h-8" onClick={load}><RefreshCw size={14} /> Refresh</button>{result && <button className="btn h-8" onClick={exportCsv}><Download size={14} /> CSV</button>}</div></div>
    {error && <div className="mx-5 mt-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
    <div className="p-5 overflow-auto"><div className="min-w-[850px] rounded border bg-white shadow-sm"><table className="w-full text-sm"><thead><tr className="bg-slate-100 text-left"><th className="px-3 py-2">Particulars</th><th className="px-3 py-2 text-right">Opening</th><th className="px-3 py-2 text-right">Debit</th><th className="px-3 py-2 text-right">Credit</th><th className="px-3 py-2 text-right">Closing</th></tr></thead><tbody>{groups.flatMap((g) => [<tr key={`${g.key}-h`} className="bg-slate-50 font-semibold text-slate-700"><td className="px-3 py-2" colSpan={5}>{g.label}</td></tr>, ...g.rows.map((r) => <tr key={r.generalLedgerId} className="border-t"><td className="px-6 py-1.5">{r.code} — {r.name}</td><td className="px-3 py-1.5 text-right tabular-nums">{signed(r.opening)}</td><td className="px-3 py-1.5 text-right tabular-nums">{money(r.debit)}</td><td className="px-3 py-1.5 text-right tabular-nums">{money(r.credit)}</td><td className="px-3 py-1.5 text-right tabular-nums">{signed(r.closing)}</td></tr>)])}</tbody><tfoot><tr className="border-t-2 font-semibold"><td className="px-3 py-2">Total</td><td className="px-3 py-2 text-right">{money(total?.opening ?? 0)}</td><td className="px-3 py-2 text-right">{money(total?.debit ?? 0)}</td><td className="px-3 py-2 text-right">{money(total?.credit ?? 0)}</td><td className="px-3 py-2 text-right">{signed(String(total?.closing ?? 0))}</td></tr>{p.kind === "balance-sheet" && <tr><td className="px-3 py-2" colSpan={4}>Current period result included in equity</td><td className="px-3 py-2 text-right">{signed(total?.currentResult ?? "0")}</td></tr>}</tfoot></table>{loading && <div className="p-3 text-center text-xs text-slate-500">Loading…</div>}{!loading && result && !result.rows.length && <div className="p-8 text-center text-slate-500">No posted ledger activity or opening balances for this period.</div>}</div></div>
  </main>;
}
