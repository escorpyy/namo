import { Fragment, useCallback, useEffect, useState, type MutableRefObject } from "react";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { cashBankApi, type AgeBucketKey, type AgeingReport, type OpenDocument, type SettleKind } from "../../api";
import { DocHeader, groupIN } from "../../components/purchase/Bits";
import { adToBs } from "../../lib/nepaliDate";
import type { StatusInfo } from "../../types";

// Outstanding and ageing: what each customer owes (unpaid invoices) or each vendor is owed (unpaid bills), by how late it is.
// Click a party to see its bills. Age counts from the due date (invoices) or the bill date (bills). Read-only; nothing here changes data.
const COLS: { key: AgeBucketKey; label: string }[] = [
  { key: "current", label: "Not due" }, { key: "d1_30", label: "1–30 days" }, { key: "d31_60", label: "31–60" }, { key: "d61_90", label: "61–90" }, { key: "d90", label: "Over 90" },
];
const HINTS = ["Click a party to see its unpaid bills", "Ageing date: report age as on that day"];
const isZero = (v: string) => Number(v) === 0;
const n = (v: string) => (isZero(v) ? <span className="text-slate-300">–</span> : groupIN(v));

export default function AgeingScreen(p: {
  companyId: number; branchName: string; fyCode: string; calendar: "BS" | "AD"; setStatus: (s: StatusInfo) => void; dirtyRef: MutableRefObject<boolean>;
}) {
  const [kind, setKind] = useState<SettleKind>("SALES_INVOICE");
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<AgeingReport | null>(null);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [bills, setBills] = useState<OpenDocument[] | null>(null);
  const sales = kind === "SALES_INVOICE";
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(asOf);

  const load = useCallback(() => {
    if (!valid) return;
    setErr(""); setData(null); setOpen(null);
    cashBankApi.ageing({ companyId: p.companyId, kind, asOf }).then(setData).catch((e) => setErr(e.message ?? "Could not load the report."));
  }, [p.companyId, kind, asOf, valid]);
  useEffect(load, [load]);
  useEffect(() => { p.dirtyRef.current = false; }, [p.dirtyRef]);
  useEffect(() => p.setStatus({ mode: "view", count: data?.rows.length ?? 0, shown: data?.rows.length ?? 0, message: err || (data ? "Ready" : "Loading…"), kind: err ? "err" : "info", hints: HINTS }), [data, err, p.setStatus]);

  const toggle = (gl: number) => {
    if (open === gl) { setOpen(null); return; }
    setOpen(gl); setBills(null);
    cashBankApi.openDocuments({ companyId: p.companyId, kind, generalLedgerId: gl }).then((r) => setBills(r.rows)).catch(() => setBills([]));
  };
  const date = (v: string) => (p.calendar === "BS" ? adToBs(v) ?? v : v);
  const th = "px-3 py-2 text-right text-[12px] font-semibold text-slate-600";

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <DocHeader title={sales ? "Customer outstanding & ageing" : "Vendor outstanding & ageing"} branchName={p.branchName} fyCode={p.fyCode} />
      <div className="flex shrink-0 flex-wrap items-end gap-x-4 gap-y-2 border-b border-slate-200 bg-slate-50 px-5 py-2.5">
        <div role="tablist" aria-label="Report for" className="flex">
          {([["SALES_INVOICE", "Customers"], ["PURCHASE_BILL", "Vendors"]] as const).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={kind === k} onClick={() => setKind(k)} className={`btn ${kind === k ? "btn-primary" : ""}`}>{label}</button>
          ))}
        </div>
        <label className="text-[12px] font-medium text-slate-600">Ageing date (AD)
          <input value={asOf} onChange={(e) => setAsOf(e.target.value)} placeholder="YYYY-MM-DD" aria-invalid={!valid}
            className={`ml-2 w-[120px] border px-2 py-1 text-[13px] tabular-nums ${valid ? "border-slate-300" : "border-rose-400 bg-rose-50"}`} />
          {valid && p.calendar === "BS" && <span className="ml-2 text-slate-500">{adToBs(asOf)}</span>}
        </label>
        <button type="button" className="btn" onClick={load}><RefreshCw size={13} /> Refresh</button>
        <span className="text-[12px] text-slate-500">Age is counted from the {sales ? "due date" : "bill date"}. Payments received / made are counted as of today.</span>
      </div>
      <div className="lg-scroll min-h-0 flex-1 overflow-auto px-5 py-3">
        {err ? <p role="alert" className="text-rose-700">{err}</p> : !data ? <p className="text-slate-500">Loading…</p> : data.rows.length === 0
          ? <p className="text-slate-500">Nothing is outstanding. {sales ? "Every posted invoice is settled." : "Every posted bill is settled."}</p>
          : (
            <table className="w-full min-w-[920px] border-collapse text-[13px]">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-slate-300">
                  <th className="px-3 py-2 text-left text-[12px] font-semibold text-slate-600">{sales ? "Customer" : "Vendor"}</th>
                  <th className={th}>Bills</th>
                  {COLS.map((c) => <th key={c.key} className={th}>{c.label}</th>)}
                  <th className={th}>Outstanding</th><th className={th}>Advance</th><th className={th}>Net</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <Fragment key={r.generalLedgerId}>
                    <tr className="cursor-pointer border-b border-slate-100 hover:bg-slate-50" onClick={() => toggle(r.generalLedgerId)} aria-expanded={open === r.generalLedgerId}>
                      <td className="px-3 py-2"><span className="inline-flex items-center gap-1.5">{open === r.generalLedgerId ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<span className="font-mono text-[12px] text-slate-500">{r.code}</span> {r.name}</span></td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.bills}</td>
                      {COLS.map((c) => <td key={c.key} className={`px-3 py-2 text-right tabular-nums ${c.key === "d90" && !isZero(r[c.key]) ? "font-medium text-rose-700" : ""}`}>{n(r[c.key])}</td>)}
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">{groupIN(r.total)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{n(r.advance)}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">{groupIN(r.net)}</td>
                    </tr>
                    {open === r.generalLedgerId && (
                      <tr className="border-b border-slate-200 bg-slate-50/70"><td colSpan={COLS.length + 5} className="px-8 py-2">
                        {bills === null ? <span className="text-slate-500">Loading…</span> : bills.length === 0 ? <span className="text-slate-500">No unpaid bills.</span> : (
                          <table className="w-full text-[12.5px]"><thead><tr className="text-slate-500"><th className="py-1 text-left font-medium">{sales ? "Invoice" : "Bill"}</th><th className="text-left font-medium">Date</th><th className="text-left font-medium">Due</th><th className="text-right font-medium">Total</th><th className="text-right font-medium">Settled</th><th className="text-right font-medium">Outstanding</th><th className="text-right font-medium">Days late</th></tr></thead>
                            <tbody>{bills.map((b) => (
                              <tr key={b.id} className="border-t border-slate-200"><td className="py-1 font-mono font-semibold text-cobalt-800">{b.number}</td><td className="tabular-nums">{date(b.date)}</td><td className="tabular-nums">{b.dueDate ? date(b.dueDate) : "—"}</td>
                                <td className="text-right tabular-nums">{groupIN(b.total)}</td><td className="text-right tabular-nums">{n(b.settled)}</td><td className="text-right font-medium tabular-nums">{groupIN(b.outstanding)}</td><td className="text-right tabular-nums">{b.overdueDays || "–"}</td></tr>
                            ))}</tbody></table>
                        )}
                      </td></tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-400 font-semibold">
                  <td className="px-3 py-2">Total</td><td className="px-3 py-2 text-right tabular-nums">{data.totals.bills}</td>
                  {COLS.map((c) => <td key={c.key} className="px-3 py-2 text-right tabular-nums">{n(data.totals[c.key])}</td>)}
                  <td className="px-3 py-2 text-right tabular-nums">{groupIN(data.totals.total)}</td><td className="px-3 py-2 text-right tabular-nums text-emerald-700">{n(data.totals.advance)}</td><td className="px-3 py-2 text-right tabular-nums">{groupIN(data.totals.net)}</td>
                </tr>
              </tfoot>
            </table>
          )}
      </div>
    </section>
  );
}
