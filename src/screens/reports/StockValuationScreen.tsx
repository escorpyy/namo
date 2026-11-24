import { Fragment, useCallback, useEffect, useState, type MutableRefObject } from "react";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { stockApi, type StockValuationRow } from "../../api";
import { DocHeader, groupIN } from "../../components/purchase/Bits";
import { adToBs } from "../../lib/nepaliDate";
import type { StatusInfo } from "../../types";

// Stock valuation: closing stock value = balance quantity x costing rate, per product, by that product's own valuation method.
// Closing value feeds the period-end figure: COGS = opening stock + purchases + direct costs - closing stock. Read-only.
const METHOD: Record<StockValuationRow["method"], string> = { FIFO: "FIFO", WEIGHTED_AVERAGE: "Weighted avg", STANDARD_COST: "Standard" };
const HINTS = ["Click a product to see stock by location and batch", "Date: value the stock as on that day"];
const q = (v: string) => groupIN(String(Number(v)));

export default function StockValuationScreen(p: {
  companyId: number; branchId: number; branchName: string; fyCode: string; calendar: "BS" | "AD"; setStatus: (s: StatusInfo) => void; dirtyRef: MutableRefObject<boolean>;
}) {
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<{ rows: StockValuationRow[]; totalValue: string } | null>(null);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(asOf);

  const load = useCallback(() => {
    if (!valid) return;
    setErr(""); setData(null); setOpen(null);
    stockApi.valuation({ companyId: p.companyId, branchId: p.branchId, asOf }).then(setData).catch((e) => setErr(e.message ?? "Could not load the report."));
  }, [p.companyId, p.branchId, asOf, valid]);
  useEffect(load, [load]);
  useEffect(() => { p.dirtyRef.current = false; }, [p.dirtyRef]);
  useEffect(() => p.setStatus({ mode: "view", count: data?.rows.length ?? 0, shown: data?.rows.length ?? 0, message: err || (data ? "Ready" : "Loading…"), kind: err ? "err" : "info", hints: HINTS }), [data, err]); // eslint-disable-line react-hooks/exhaustive-deps

  const th = "px-3 py-2 text-right text-[12px] font-semibold text-slate-600";
  const warn = data?.rows.some((r) => r.missingCost || r.negative);
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <DocHeader title="Stock valuation" branchName={p.branchName} fyCode={p.fyCode} />
      <div className="flex shrink-0 flex-wrap items-end gap-x-4 gap-y-2 border-b border-slate-200 bg-slate-50 px-5 py-2.5">
        <label className="text-[12px] font-medium text-slate-600">Stock as on (AD)
          <input value={asOf} onChange={(e) => setAsOf(e.target.value)} placeholder="YYYY-MM-DD" aria-invalid={!valid}
            className={`ml-2 w-[120px] border px-2 py-1 text-[13px] tabular-nums ${valid ? "border-slate-300" : "border-rose-400 bg-rose-50"}`} />
          {valid && p.calendar === "BS" && <span className="ml-2 text-slate-500">{adToBs(asOf)}</span>}
        </label>
        <button type="button" className="btn" onClick={load}><RefreshCw size={13} /> Refresh</button>
        <span className="text-[12px] text-slate-500">Value = balance qty × rate. Rate comes from each product's valuation method; purchase cost includes landed cost.</span>
      </div>
      <div className="lg-scroll min-h-0 flex-1 overflow-auto px-5 py-3">
        {err ? <p role="alert" className="text-rose-700">{err}</p> : !data ? <p className="text-slate-500">Loading…</p> : data.rows.length === 0
          ? <p className="text-slate-500">No stock on hand as on this date.</p>
          : (
            <>
              {warn && <p role="status" className="mb-2 border border-amber-300 bg-amber-50 px-2 py-1 text-[12px] text-amber-800">Some products have no cost on a receipt (marked “?”) or a negative balance; their value may be understated.</p>}
              <table className="w-full min-w-[760px] border-collapse text-[13px]">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b border-slate-300">
                    <th className="px-3 py-2 text-left text-[12px] font-semibold text-slate-600">Product</th>
                    <th className="px-3 py-2 text-left text-[12px] font-semibold text-slate-600">Method</th>
                    <th className={th}>Qty</th><th className={th}>Rate</th><th className={th}>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <Fragment key={r.productId}>
                      <tr className="cursor-pointer border-b border-slate-100 hover:bg-slate-50" onClick={() => setOpen(open === r.productId ? null : r.productId)} aria-expanded={open === r.productId}>
                        <td className="px-3 py-2"><span className="inline-flex items-center gap-1.5">{open === r.productId ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<span className="font-mono text-[12px] text-slate-500">{r.code}</span> {r.description}</span></td>
                        <td className="px-3 py-2 text-slate-600">{METHOD[r.method]}{r.missingCost && <span title="A receipt has no cost" className="ml-1 text-amber-700">?</span>}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{q(r.qty)} <span className="text-slate-400">{r.unit}</span></td>
                        <td className="px-3 py-2 text-right tabular-nums">{groupIN(Number(r.rate).toFixed(2))}</td>
                        <td className="px-3 py-2 text-right font-medium tabular-nums">{groupIN(r.value)}</td>
                      </tr>
                      {open === r.productId && r.buckets.map((b, i) => (
                        <tr key={i} className="border-b border-slate-100 bg-slate-50 text-[12px] text-slate-600">
                          <td className="py-1.5 pl-10 pr-3">{b.locationName ?? "No location"}{b.batchNo ? ` · batch ${b.batchNo}` : ""}</td><td />
                          <td className="px-3 py-1.5 text-right tabular-nums">{q(b.qty)}</td><td />
                          <td className="px-3 py-1.5 text-right tabular-nums">{groupIN(b.value)}</td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-300 font-semibold"><td className="px-3 py-2" colSpan={4}>Closing stock value</td><td className="px-3 py-2 text-right tabular-nums">{groupIN(data.totalValue)}</td></tr>
                </tfoot>
              </table>
            </>
          )}
      </div>
    </section>
  );
}
