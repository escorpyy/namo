import { Fragment, useEffect, useState } from "react";
import { Download, Play, RotateCw } from "lucide-react";
import { statementTemplatesApi, type StatementEngineLineResult, type StatementTemplateReport, type StatementTemplateReportQuery } from "../../api";

type Props = { companyId: number; templateId: number; branchId: number; branchName: string; fyCode: string; fyStart: string; fyEnd: string };
const money = (value: string | number | null | undefined) => value == null ? "—" : Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const lineVisible = (row: StatementEngineLineResult): boolean => row.visible || row.children.some(lineVisible);
function StatementRows({ rows, depth = 0 }: { rows: StatementEngineLineResult[]; depth?: number }) {
  return <>
    {rows.filter(lineVisible).map((row) => <Fragment key={row.id}>
      <tr className={`${row.lineType === "HEADING" ? "bg-slate-50 font-semibold text-slate-700" : "border-t text-slate-800"}`}>
        <td className="px-3 py-2" style={{ paddingLeft: `${12 + depth * 20}px` }}>
          {row.code}<span className="ml-2 font-normal">{row.label}</span>
          {row.role && <span className="ml-2 rounded border px-1.5 py-0.5 text-[9px] font-normal uppercase text-slate-500">{row.role.replaceAll("_", " ")}</span>}
        </td>
        <td className="px-3 py-2 text-right tabular-nums">{money(row.amount)}</td>
      </tr>
      {row.children.length > 0 && <StatementRows rows={row.children} depth={depth + 1} />}
    </Fragment>)}
  </>;
}

export function StatementTemplateReport({ companyId, templateId, branchId, branchName, fyCode, fyStart, fyEnd }: Props) {
  const [statement, setStatement] = useState<"PL" | "BS">("PL");
  const [from, setFrom] = useState(fyStart);
  const [to, setTo] = useState(fyEnd);
  const [report, setReport] = useState<StatementTemplateReport | null>(null);
  const [unmapped, setUnmapped] = useState<StatementTemplateReport["unmapped"]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [unmappedBusy, setUnmappedBusy] = useState(false);

  useEffect(() => { setReport(null); setUnmapped([]); setError(""); }, [templateId, companyId, branchId, fyCode]);

  const query = (): StatementTemplateReportQuery => ({ companyId, templateId, statement, branchId, fiscalYear: fyCode, from, to });
  const run = async () => {
    if (!from || !to || from > to || from < fyStart || to > fyEnd) { setError(`Choose dates within ${fyCode} (${fyStart} to ${fyEnd}).`); return; }
    setBusy(true); setError(""); setReport(null); setUnmapped([]);
    try {
      const result = await statementTemplatesApi.report(query());
      setReport(result); setUnmapped(result.unmapped);
    } catch (e) { setError((e as Error).message || "Could not run the statement."); }
    finally { setBusy(false); }
  };
  const refreshUnmapped = async () => {
    setUnmappedBusy(true); setError("");
    try { const result = await statementTemplatesApi.unmapped(query()); setUnmapped(result.unmapped); }
    catch (e) { setError((e as Error).message || "Could not load unmapped ledgers."); }
    finally { setUnmappedBusy(false); }
  };
  const exportCsv = () => {
    if (!report) return;
    const rows: string[][] = [["Code", "Statement line", "Amount"]];
    const walk = (items: StatementEngineLineResult[]) => items.forEach((row) => { if (row.visible) rows.push([row.code, row.label, row.amount ?? ""]); walk(row.children); });
    walk(report.rows);
    if (unmapped.length) { rows.push(["", "Unmapped ledgers", ""]); unmapped.forEach((row) => rows.push([row.code, row.name, row.amount])); }
    const content = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
    link.download = `${statement.toLowerCase()}-${fyCode}-${to}.csv`; link.click(); URL.revokeObjectURL(link.href);
  };

  return <div className="space-y-3">
    <section className="rounded border bg-white p-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-medium text-slate-600">Statement<select className="fld mt-1 w-52" disabled={busy || unmappedBusy} value={statement} onChange={(e) => { setStatement(e.target.value as "PL" | "BS"); setReport(null); setUnmapped([]); setError(""); }}><option value="PL">Profit &amp; Loss</option><option value="BS">Balance Sheet</option></select></label>
        <label className="text-xs font-medium text-slate-600">From<input className="fld mt-1 w-40" type="date" disabled={busy || unmappedBusy} min={fyStart} max={fyEnd} value={from} onChange={(e) => { setFrom(e.target.value); setReport(null); setUnmapped([]); setError(""); }} /></label>
        <label className="text-xs font-medium text-slate-600">To<input className="fld mt-1 w-40" type="date" disabled={busy || unmappedBusy} min={fyStart} max={fyEnd} value={to} onChange={(e) => { setTo(e.target.value); setReport(null); setUnmapped([]); setError(""); }} /></label>
        <div className="mr-auto pb-1 text-xs text-slate-500">{branchName} · FY {fyCode}{statement === "BS" ? " · balance as at end date" : " · selected-period movement"}</div>
        <button type="button" className="btn btn-primary" disabled={busy || !templateId} onClick={() => void run()}><Play size={14} />{busy ? "Running…" : "Run statement"}</button>
        {report && <button type="button" className="btn" disabled={unmappedBusy} onClick={() => void refreshUnmapped()}><RotateCw size={14} />{unmappedBusy ? "Loading…" : "Refresh unmapped"}</button>}
        {report && <button type="button" className="btn" onClick={exportCsv}><Download size={14} />CSV</button>}
      </div>
      {error && <div role="alert" className="mt-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
    </section>

    {report && <>
      {report.warnings.length > 0 && <section className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950"><h3 className="font-semibold">Report warnings</h3><ul className="mt-1 list-disc space-y-1 pl-5 text-xs">{report.warnings.map((warning, index) => <li key={`${index}:${warning}`}>{warning}</li>)}</ul></section>}
      {report.stockOpeningMismatches?.length ? <section className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950"><h3 className="font-semibold">Stock-opening mismatches</h3><ul className="mt-1 list-disc pl-5 text-xs">{report.stockOpeningMismatches.map((row, index) => <li key={`${index}:${row.ledger}`}>{row.ledger}: stock opening {row.stock} vs ledger opening {row.ledgerBalance}</li>)}</ul></section> : null}
      <section className="overflow-hidden rounded border bg-white shadow-sm">
        <div className="border-b px-4 py-3 text-center"><div className="text-[10px] font-semibold uppercase tracking-wide text-blue-700">{report.template.name}</div><h2 className="mt-1 font-semibold text-slate-900">{statement === "PL" ? "Profit & Loss" : "Balance Sheet"}</h2><p className="text-xs text-slate-500">{report.periodMode === "AS_OF_END" ? `As at ${report.to}` : `For ${report.from} to ${report.to}`} · FY {report.fiscalYear}</p></div>
        <div className="overflow-auto"><table className="w-full min-w-[620px] text-xs"><thead><tr className="bg-slate-700 text-left text-white"><th className="px-3 py-2">Particulars</th><th className="px-3 py-2 text-right">Amount (NPR)</th></tr></thead><tbody><StatementRows rows={report.rows} /></tbody></table></div>
        {!report.rows.length && <div className="p-8 text-center text-sm text-slate-500">This template has no lines for the selected statement.</div>}
      </section>
      <section className="overflow-hidden rounded border bg-white">
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3"><div><h3 className="font-semibold text-slate-800">Unmapped ledgers</h3><p className="text-xs text-slate-500">Non-zero balances not claimed by a mapping selector.</p></div><span className="rounded bg-slate-100 px-2 py-1 text-xs tabular-nums">{unmapped.length}</span></div>
        {unmapped.length ? <div className="overflow-auto"><table className="w-full min-w-[560px] text-xs"><thead><tr className="bg-slate-50 text-left text-slate-600"><th className="px-3 py-2">Ledger</th><th className="px-3 py-2">Account type</th><th className="px-3 py-2 text-right">Amount</th></tr></thead><tbody>{unmapped.map((row) => <tr key={row.id} className="border-t"><td className="px-3 py-2">{row.code} — {row.name}</td><td className="px-3 py-2">{row.accountType}</td><td className="px-3 py-2 text-right tabular-nums">{money(row.amount)}</td></tr>)}</tbody></table></div> : <p className="p-4 text-center text-xs text-emerald-700">No non-zero unmapped balances for this report.</p>}
      </section>
    </>}
    {!report && !busy && !error && <div className="rounded border border-dashed bg-white p-10 text-center text-sm text-slate-500">Choose a statement and date range, then run the report to preview its lines and unmapped ledgers.</div>}
  </div>;
}
