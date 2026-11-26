import { useEffect, useMemo, useState, type MutableRefObject } from "react";
import { Download, Printer, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { financialReportsApi, yearEndCloseApi, type FinancialReportKind, type FinancialReportResult, type FinancialReportRow, type YearEndClosePreview } from "../../api";
import type { StatusInfo } from "../../types";
import { adToBs } from "../../lib/nepaliDate";
import { HierarchicalStatement } from "../../components/reports/HierarchicalStatement";

const titles: Record<FinancialReportKind, string> = {
  "trial-balance": "Trial Balance",
  "profit-loss": "Statement of Profit or Loss and Comprehensive Income",
  "balance-sheet": "Statement of Financial Position",
};
const amount = (v: string | number) => Number(v || 0);
const money = (v: string | number) => Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = (v: string | number) => Number(v) >= 0 ? money(v) : `(${money(-Number(v))})`;
const splitBalance = (v: string | number) => ({ debit: Math.max(amount(v), 0), credit: Math.max(-amount(v), 0) });
type TrialBalanceSubGroup = { id: number; code: string; name: string; rows: FinancialReportRow[] };
type TrialBalanceGroup = { id: number; code: string; name: string; accountType: FinancialReportRow["accountType"]; rows: FinancialReportRow[]; subGroups: Map<number, TrialBalanceSubGroup> };

function TrialBalanceAmounts({ rows }: { rows: FinancialReportRow[] }) {
  const opening = rows.reduce((sum, r) => { const side = splitBalance(r.opening); return { debit: sum.debit + side.debit, credit: sum.credit + side.credit }; }, { debit: 0, credit: 0 });
  const closing = rows.reduce((sum, r) => { const side = splitBalance(r.closing); return { debit: sum.debit + side.debit, credit: sum.credit + side.credit }; }, { debit: 0, credit: 0 });
  const debit = rows.reduce((sum, r) => sum + amount(r.debit), 0), credit = rows.reduce((sum, r) => sum + amount(r.credit), 0);
  return <>
    <td className="px-3 py-1.5 text-right tabular-nums">{money(opening.debit)}</td><td className="px-3 py-1.5 text-right tabular-nums">{money(opening.credit)}</td>
    <td className="px-3 py-1.5 text-right tabular-nums">{money(debit)}</td><td className="px-3 py-1.5 text-right tabular-nums">{money(credit)}</td>
    <td className="px-3 py-1.5 text-right tabular-nums">{money(closing.debit)}</td><td className="px-3 py-1.5 text-right tabular-nums">{money(closing.credit)}</td>
  </>;
}

function TrialBalance({ result, rows }: { result: FinancialReportResult; rows: FinancialReportRow[] }) {
  const groups = new Map<number, TrialBalanceGroup>();
  for (const row of rows) {
    let group = groups.get(row.accountGroupId);
    if (!group) { group = { id: row.accountGroupId, code: row.accountGroupCode, name: row.accountGroupName, accountType: row.accountType, rows: [], subGroups: new Map() }; groups.set(group.id, group); }
    if (row.accountSubGroupId == null) group.rows.push(row);
    else {
      let subGroup = group.subGroups.get(row.accountSubGroupId);
      if (!subGroup) { subGroup = { id: row.accountSubGroupId, code: row.accountSubGroupCode ?? "", name: row.accountSubGroupName ?? "", rows: [] }; group.subGroups.set(subGroup.id, subGroup); }
      subGroup.rows.push(row);
    }
  }
  const orderedGroups = [...groups.values()].sort((a, b) => a.code.localeCompare(b.code));
  const typeLabels: Record<FinancialReportRow["accountType"], string> = { ASSET: "ASSETS", LIABILITY: "LIABILITIES", EQUITY: "EQUITY", REVENUE: "REVENUE", EXPENSE: "EXPENSES" };
  const typeOrder: FinancialReportRow["accountType"][] = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"];
  let serialNumber = 0;
  const ledgerRows = (items: FinancialReportRow[], level: number) => items.slice().sort((a, b) => a.code.localeCompare(b.code)).map((r) => {
    serialNumber += 1;
    return <tr key={r.generalLedgerId} className="border-t hover:bg-blue-50">
      <td className="px-2 py-1.5 text-slate-500">{serialNumber}</td><td className="px-3 py-1.5 font-medium text-slate-800" style={{ paddingLeft: 12 + level * 20 }}>{r.code} — {r.name}</td>
      <TrialBalanceAmounts rows={[r]} />
    </tr>;
  });
  const tableRows = typeOrder.flatMap((type) => {
    const typeGroups = orderedGroups.filter((group) => group.accountType === type);
    if (!typeGroups.length) return [];
    const typeRows = typeGroups.flatMap((group) => [...group.rows, ...[...group.subGroups.values()].flatMap((subGroup) => subGroup.rows)]);
    return [
      <tr key={`type-${type}`} className="border-t bg-slate-200 font-bold uppercase tracking-wide text-slate-700"><td colSpan={2} className="px-3 py-2">{typeLabels[type]}</td><TrialBalanceAmounts rows={typeRows} /></tr>,
      ...typeGroups.flatMap((group) => {
        const subGroups = [...group.subGroups.values()].sort((a, b) => a.code.localeCompare(b.code));
        const allRows = [...group.rows, ...subGroups.flatMap((subGroup) => subGroup.rows)];
        return [
          <tr key={`group-${group.id}`} className="border-t bg-slate-100 font-semibold text-slate-700"><td colSpan={2} className="px-3 py-2" style={{ paddingLeft: 28 }}>{group.code} — {group.name}</td><TrialBalanceAmounts rows={allRows} /></tr>,
          ...ledgerRows(group.rows, 2),
          ...subGroups.flatMap((subGroup) => [
            <tr key={`subgroup-${group.id}-${subGroup.id}`} className="border-t bg-slate-50 font-medium text-slate-700"><td colSpan={2} className="px-3 py-1.5" style={{ paddingLeft: 48 }}>{subGroup.code ? `${subGroup.code} — ` : ""}{subGroup.name}</td><TrialBalanceAmounts rows={subGroup.rows} /></tr>,
            ...ledgerRows(subGroup.rows, 3),
          ]),
        ];
      }),
    ];
  });
  return <table className="w-full min-w-[1120px] text-xs">
    <thead><tr className="bg-slate-700 text-left text-white">
      <th className="px-2 py-2">SN</th><th className="px-3 py-2">Particulars</th>
      <th className="px-3 py-2 text-right">Opening Dr.</th><th className="px-3 py-2 text-right">Opening Cr.</th><th className="px-3 py-2 text-right">During Dr.</th><th className="px-3 py-2 text-right">During Cr.</th><th className="px-3 py-2 text-right">Closing Dr.</th><th className="px-3 py-2 text-right">Closing Cr.</th>
    </tr></thead>
    <tbody>{tableRows}</tbody>
    <tfoot><tr className="border-t-2 bg-slate-100 font-semibold"><td colSpan={2} className="px-3 py-2">Total</td><TrialBalanceAmounts rows={result.rows} /></tr></tfoot>
  </table>;
}

export default function FinancialStatementScreen(p: { companyName?: string; calendar?: "BS" | "AD"; kind: FinancialReportKind; companyId: number; branchId: number; userId: number; fyCode: string; fyStart: string; fyEnd: string; previousFy?: { code: string; startDate: string; endDate: string }; setStatus: (s: StatusInfo) => void; dirtyRef: MutableRefObject<boolean>; reportFamily?: string }) {
  const [from, setFrom] = useState(p.fyStart), [to, setTo] = useState(p.fyEnd);
  const [result, setResult] = useState<FinancialReportResult | null>(null), [previous, setPrevious] = useState<FinancialReportResult | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [closePreview, setClosePreview] = useState<YearEndClosePreview | null>(null), [closeError, setCloseError] = useState(""), [closeBusy, setCloseBusy] = useState(false), [closeStatus, setCloseStatus] = useState<{ isClosed: boolean; close: { id: number } | null } | null>(null);
  const load = () => {
    if (!from || !to || from > to || from < p.fyStart || to > p.fyEnd) { setError(`Choose dates within fiscal year ${p.fyCode} (${p.fyStart} to ${p.fyEnd}).`); return; }
    setLoading(true); setError("");
    const current = financialReportsApi.get(p.kind, { companyId: p.companyId, branchId: p.branchId, fiscalYear: p.fyCode, from, to });
    const prior = p.previousFy && p.kind !== "trial-balance" ? financialReportsApi.get(p.kind, { companyId: p.companyId, branchId: p.branchId, fiscalYear: p.previousFy.code, from: p.previousFy.startDate, to: p.previousFy.endDate }) : Promise.resolve(null);
    Promise.all([current, prior]).then(([now, old]) => { setResult(now); setPrevious(old); }).catch((e: Error) => setError(e.message)).finally(() => setLoading(false));
  };
  useEffect(() => { p.dirtyRef.current = false; load(); }, [p.companyId, p.branchId, p.fyCode, p.kind]);
  useEffect(() => { if (p.kind !== "profit-loss" || p.fyCode === "-") return; yearEndCloseApi.status(p.companyId, p.fyCode).then(setCloseStatus).catch((e: Error) => setCloseError(e.message)); }, [p.companyId, p.fyCode, p.kind]);
  useEffect(() => { p.setStatus({ mode: "view", count: result?.rows.length ?? 0, shown: result?.rows.length ?? 0, message: error || (loading ? "Running report…" : result ? "Report ready" : "Choose a period"), kind: error ? "err" : "info", hints: ["Posted transactions only", "Search accounts like a ledger report", "CSV export available"] }); }, [result, loading, error, p.setStatus]);
  const rows = useMemo(() => { const term = search.trim().toLowerCase(); return (result?.rows ?? []).filter((r) => !term || `${r.code} ${r.name} ${r.accountGroupName} ${r.accountSubGroupName ?? ""}`.toLowerCase().includes(term)); }, [result, search]);
  const comparative = useMemo(() => new Map((previous?.rows ?? []).map((r) => [r.generalLedgerId, r])), [previous]);
  const exportCsv = () => { if (!result) return; const lines = [["Particulars", "Type", "Opening", "Debit", "Credit", "Closing"], ...rows.map((r) => [r.name, r.accountType, r.opening, r.debit, r.credit, r.closing])]; const csv = lines.map((line) => line.map((x) => `"${String(x).replaceAll('"', '""')}"`).join(",")).join("\n"); const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = `${p.kind}-${from}-${to}.csv`; a.click(); URL.revokeObjectURL(a.href); };
  const stmtDate = (ad: string) => (p.calendar === "BS" ? `${adToBs(ad) ?? ad} BS` : ad);
  const fullYear = from === p.fyStart && to === p.fyEnd;
  const reviewClose = async () => { setCloseBusy(true); setCloseError(""); try { setClosePreview(await yearEndCloseApi.preview(p.companyId, p.fyCode)); } catch (e) { setCloseError((e as Error).message); } finally { setCloseBusy(false); } };
  const postClose = async () => { if (!window.confirm(`Post the year-end close for ${p.fyCode}? This creates posted closing journal vouchers for all active branches and closes the fiscal year.`)) return; setCloseBusy(true); setCloseError(""); try { await yearEndCloseApi.close(p.companyId, p.fyCode, p.userId); setCloseStatus(await yearEndCloseApi.status(p.companyId, p.fyCode)); setClosePreview(null); load(); } catch (e) { setCloseError((e as Error).message); } finally { setCloseBusy(false); } };
  const reopenClose = async () => { const reason = window.prompt(`Reason for reopening fiscal year ${p.fyCode}:`); if (!reason?.trim()) return; setCloseBusy(true); setCloseError(""); try { await yearEndCloseApi.reopen(p.companyId, p.fyCode, p.userId, reason.trim()); setCloseStatus(await yearEndCloseApi.status(p.companyId, p.fyCode)); load(); } catch (e) { setCloseError((e as Error).message); } finally { setCloseBusy(false); } };
  return <main className="flex-1 min-w-0 flex flex-col bg-slate-50"><div className="border-b bg-white px-5 py-3 flex flex-wrap items-center gap-3"><div><div className="text-[11px] font-semibold uppercase tracking-wide text-blue-700">{p.reportFamily ?? "Financial Statements"}</div><h1 className="text-lg font-semibold text-slate-800">{titles[p.kind]}</h1><p className="text-xs text-slate-500">{p.fyCode} · {p.kind === "trial-balance" ? "Opening / movement / adjustment / closing" : "Current year · comparative / restated"}</p></div><div className="ml-auto flex flex-wrap items-center gap-2"><label className="relative text-xs text-slate-600"><Search size={14} className="absolute left-2 top-2 text-slate-400" /><input className="input h-8 w-48 pl-7" placeholder="Search ledger or group" value={search} onChange={(e) => setSearch(e.target.value)} /></label><label className="text-xs text-slate-600">From <input className="input h-8 ml-1" type="date" value={from} min={p.fyStart} max={p.fyEnd} onChange={(e) => setFrom(e.target.value)} /></label><label className="text-xs text-slate-600">To <input className="input h-8 ml-1" type="date" value={to} min={p.fyStart} max={p.fyEnd} onChange={(e) => setTo(e.target.value)} /></label><button className="btn btn-primary h-8" onClick={load}><RefreshCw size={14} /> Refresh</button>{result && p.kind !== "trial-balance" && <button className="btn h-8" onClick={() => { document.body.classList.add("printing-fs"); window.addEventListener("afterprint", () => document.body.classList.remove("printing-fs"), { once: true }); window.print(); }}><Printer size={14} /> Print</button>}{result && <button className="btn h-8" onClick={exportCsv}><Download size={14} /> CSV</button>}</div></div>{error && <div className="mx-5 mt-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}{p.kind === "profit-loss" && <section className="mx-5 mt-4 rounded border border-blue-200 bg-white p-4"><div className="flex flex-wrap items-center gap-3"><div className="mr-auto"><div className="flex items-center gap-2 font-semibold text-slate-800"><ShieldCheck size={16} className="text-blue-700" /> Year-end P&amp;L close</div><p className="mt-1 text-xs text-slate-600">Explicit company-wide close for all active branches. Preview and report refresh never post entries.</p>{closeStatus?.isClosed && <p className="mt-1 text-xs font-semibold text-emerald-700">Fiscal year {p.fyCode} is closed.</p>}</div>{closeStatus?.close ? <button className="btn h-8" disabled={closeBusy} onClick={reopenClose}>Reopen with reason</button> : <button className="btn btn-primary h-8" disabled={closeBusy || !fullYear} title={!fullYear ? "Select the complete fiscal year to preview its close." : ""} onClick={reviewClose}>{closeBusy ? "Working…" : "Review year-end close"}</button>}</div>{!fullYear && <p className="mt-2 text-xs text-amber-700">Select {p.fyStart} through {p.fyEnd} to review the close.</p>}{closeError && <p className="mt-2 rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">{closeError}</p>}{closePreview && <div className="mt-4 border-t pt-3"><div className="flex flex-wrap justify-between gap-2"><div><div className="font-medium text-slate-800">Preview · {closePreview.fiscalYear}</div><div className="text-xs text-slate-600">Mapped clearing ledger: {closePreview.ledger.code} — {closePreview.ledger.name} · {closePreview.from} to {closePreview.to}</div></div><div className="text-right"><div className="text-xs text-slate-500">Net result · all active branches</div><div className="text-lg font-bold tabular-nums">{signed(closePreview.netResult)}</div></div></div><div className="mt-3 overflow-auto"><table className="w-full text-xs"><thead className="bg-slate-100 text-left"><tr><th className="px-2 py-1.5">Branch</th><th className="px-2 py-1.5 text-right">Net profit / (loss)</th><th className="px-2 py-1.5 text-right">Closing lines</th></tr></thead><tbody>{closePreview.branches.map((b) => <tr className="border-t" key={b.branchId}><td className="px-2 py-1.5">{b.branchCode} — {b.branchName}</td><td className="px-2 py-1.5 text-right tabular-nums">{signed(b.netResult)}</td><td className="px-2 py-1.5 text-right">{b.lineCount}</td></tr>)}</tbody></table></div>{closePreview.existingClose || closePreview.fiscalYearClosed ? <p className="mt-3 text-sm font-medium text-amber-700">This fiscal year is already closed; duplicate posting is disabled.</p> : <div className="mt-3 flex items-center justify-between gap-3"><p className="text-xs text-slate-500">Posting creates balanced branch closing journals and locks this fiscal year. The saved P&amp;L report will continue to show its original result.</p><button className="btn btn-primary h-8 shrink-0" disabled={closeBusy} onClick={postClose}>{closeBusy ? "Posting…" : "Confirm and post close"}</button></div>}</div>}</section>}{result?.stockOpeningMismatches?.length ? <div className="mx-5 mt-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"><div className="font-medium">Stock opening does not match the stock ledger, so stock on this statement is off by the difference.</div><ul className="mt-1 list-disc pl-5 text-xs">{result.stockOpeningMismatches.map((m) => <li key={`${m.branch}:${m.ledger}`}>{m.ledger}: Stock Opening {m.stock} vs ledger opening balance {m.ledgerBalance}</li>)}</ul><div className="mt-1 text-xs">Correct the opening stock or the ledger's opening balance so both are last year's closing stock.</div></div> : null}<div className="p-5 overflow-auto"><div className="fs-print min-w-[920px] rounded border bg-white shadow-sm"><div className="border-b px-4 py-4 text-center">{p.companyName && <div className="text-base font-bold text-slate-900">{p.companyName}</div>}<div className="font-semibold text-slate-800">{titles[p.kind]}</div>{p.kind !== "trial-balance" && <div className="text-xs font-medium uppercase text-slate-600">{p.kind === "balance-sheet" ? `As at ${stmtDate(to)}` : `For the period ${stmtDate(from)} to ${stmtDate(to)}`}</div>}<div className="text-xs text-slate-500">Figures in NPR · {p.fyCode}{p.previousFy && p.kind !== "trial-balance" ? ` compared with ${p.previousFy.code}` : ""}</div></div><table className="w-full">{result && p.kind !== "trial-balance" && <thead><tr className="bg-slate-700 text-left text-xs text-white"><th className="px-4 py-2">Particulars</th><th className="px-2 py-2 text-center">Notes</th><th className="px-3 py-2 text-right">{p.fyCode}</th><th className="px-3 py-2 text-right">{p.previousFy?.code ?? "Comparative"}</th></tr></thead>}{result && (p.kind === "trial-balance" ? <TrialBalance result={result} rows={rows} /> : <tbody><HierarchicalStatement rows={rows} comparative={comparative} kind={p.kind} result={{ id: result?.resultLedger?.id, name: result?.resultLedger?.name ?? "Profit and Loss Account", amount: Number(result?.totals.currentResult ?? 0) }} priorResult={Number(previous?.totals.currentResult ?? 0)} /></tbody>)}</table>{result && p.kind !== "trial-balance" && <div className="border-t px-4 py-4 text-xs text-slate-600"><div className="font-medium uppercase">The accompanying notes are an integral part of these financial statements.</div><div className="mt-8 grid grid-cols-3 gap-6 text-center">{["Accounts Head", "Director", "Chairperson"].map((t) => <div key={t}><div className="border-t border-slate-400 pt-1">{t}</div></div>)}</div><div className="mt-6 text-center"><div className="mx-auto w-64 border-t border-slate-400 pt-1">Auditor (Chartered Accountants / Registered Auditor)</div></div></div>}{loading && <div className="p-3 text-center text-xs text-slate-500">Loading…</div>}{!loading && result && !rows.length && <div className="p-8 text-center text-slate-500">No matching posted ledger activity or opening balances.</div>}</div></div></main>;
}
