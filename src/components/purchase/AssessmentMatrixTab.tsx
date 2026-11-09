import type { Matrix } from "../../lib/assessmentTabs";
import { NatureChip, fmtC, natureClass, signedC } from "./AssessmentBits";
import { money } from "./Bits";

// "Full matrix" tab: every product against every charge, read-only, for a last look. Charges that go into stock value get a column each
// (green for additions, pink for deductions); charges that are posted but stay out of landed cost sit in a greyed group at the end.

export function MatrixTab({ matrix, ready }: { matrix: Matrix; ready: boolean }) {
  const { stockTerms, otherTerms, rows, totals, hasLinked } = matrix;
  const th = "px-2.5 py-2 text-right whitespace-nowrap";
  const stick = "sticky left-0 z-[1] bg-white";
  if (!rows.length) return <p className="p-4 text-slate-500">{ready ? "This goods bill has no product lines." : "Working out the matrix…"}</p>;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="lg-scroll lg-grid min-h-0 flex-1 overflow-auto" data-scroll tabIndex={0}>
        <table className="w-full min-w-[640px] text-[12.5px]">
          <thead className="lg-th sticky top-0 z-10">
            <tr>
              <th className={`${stick} px-2.5 py-2 text-left`}>Product</th>
              <th className={th}>Qty</th>
              <th className={th}>Goods value</th>
              {stockTerms.map((t) => <th key={t.formKey} className="px-1.5 py-1.5 text-right" title={`${t.name} · ${t.nature === "DEDUCTIVE" ? "deduction" : "addition"}`}><NatureChip nature={t.nature}>{t.code}</NatureChip></th>)}
              {hasLinked && <th className={th} title="Invoiced service costs and earlier bill costs">Linked costs</th>}
              <th className={th}>Landed value</th>
              <th className={th}>Landed unit cost</th>
              {otherTerms.map((t) => <th key={t.formKey} className="bg-slate-100 px-2 py-2 text-right text-slate-500" title="Posted to the ledgers, not part of landed cost">{t.code}<span className="block text-[10px] font-normal">not in stock</span></th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 hover:bg-cobalt-50/30">
                <td className={`${stick} px-2.5 py-2`}><span className="mr-2 text-slate-400">{r.lineNumber}</span><span className="font-medium text-ink">{r.label}</span></td>
                <td className="px-2.5 py-2 text-right tabular-nums">{r.qty}</td>
                <td className="px-2.5 py-2 text-right tabular-nums">{fmtC(r.goods)}</td>
                {stockTerms.map((t) => {
                  const v = r.cells.get(t.termId) ?? 0;
                  return <td key={t.formKey} className={`px-2.5 py-2 text-right tabular-nums ${v === 0 ? "text-slate-400" : natureClass(t.nature)}`}>{signedC(v)}</td>;
                })}
                {hasLinked && <td className="px-2.5 py-2 text-right tabular-nums">{fmtC(r.linked)}</td>}
                <td className="px-2.5 py-2 text-right font-semibold tabular-nums text-ink">{fmtC(r.landed)}</td>
                <td className="px-2.5 py-2 text-right tabular-nums">{money(r.rate)}</td>
                {otherTerms.map((t) => <td key={t.formKey} className="bg-slate-50 px-2 py-2 text-right text-slate-400">—</td>)}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
              <td className={`${stick} bg-slate-50 px-2.5 py-2`}>Total</td><td />
              <td className="px-2.5 py-2 text-right tabular-nums">{fmtC(totals.goods)}</td>
              {stockTerms.map((t) => {
                const v = totals.cells.get(t.termId) ?? 0;
                return <td key={t.formKey} className={`px-2.5 py-2 text-right tabular-nums ${v === 0 ? "" : natureClass(t.nature)}`}>{signedC(v)}</td>;
              })}
              {hasLinked && <td className="px-2.5 py-2 text-right tabular-nums">{fmtC(totals.linked)}</td>}
              <td className="px-2.5 py-2 text-right tabular-nums">{fmtC(totals.landed)}</td><td />
              {otherTerms.map((t) => (
                <td key={t.formKey} className="bg-slate-100 px-2 py-2 text-right tabular-nums text-slate-600">{t.nature === "DEDUCTIVE" ? "−" : "+"}{fmtC(t.amount)}</td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="border-t border-slate-100 px-4 py-2 text-[11.5px] text-slate-500">
        Goods + charges{hasLinked ? " + linked costs" : ""} = landed value.
        {otherTerms.length > 0 && " Greyed columns are posted to the ledgers but kept out of landed cost."}
        {" "}Read-only: change amounts on the Charge terms or Product-wise tab.
      </p>
    </div>
  );
}
