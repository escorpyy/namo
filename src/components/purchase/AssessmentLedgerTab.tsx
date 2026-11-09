import { Fragment, useState } from "react";
import { Check, ChevronDown, ChevronRight, Info, X } from "lucide-react";
import type { LedgerCheckResult } from "../../lib/assessmentTabs";
import { fmtC } from "./AssessmentBits";

// "Ledger check" tab: what applying this assessment posts, ledger by ledger (the details of each ledger stay folded until opened), and the
// tie-out checks that must all pass before Apply. For an applied assessment it also names the vouchers.

export function LedgerTab({ result, ready, voucherNumber, reversalVoucherNumber }: {
  result: LedgerCheckResult; ready: boolean; voucherNumber?: string | null; reversalVoucherNumber?: string | null;
}) {
  const [openRows, setOpenRows] = useState<Set<number>>(new Set());
  const toggle = (id: number) => setOpenRows((cur) => { const next = new Set(cur); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const diff = result.dr - result.cr;
  if (!result.rows.length) {
    return (
      <div className="min-h-0 flex-1 overflow-auto p-4 text-slate-600">
        {ready ? "No charge has an amount yet, so nothing would be posted." : "Working out the postings…"}
        <Checks result={result} />
      </div>
    );
  }
  return (
    <div className="lg-scroll min-h-0 flex-1 overflow-auto">
      {(voucherNumber || reversalVoucherNumber) && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 border-b border-slate-100 px-4 py-2.5 text-[12.5px] text-slate-600">
          {voucherNumber && <span>Journal voucher <b className="font-mono text-ink">{voucherNumber}</b></span>}
          {reversalVoucherNumber && <span>Reversal voucher <b className="font-mono text-ink">{reversalVoucherNumber}</b></span>}
        </div>
      )}
      <table className="w-full min-w-[560px] text-[12.5px]">
        <thead className="lg-th sticky top-0 z-10">
          <tr><th className="px-3 py-2 text-left">Ledger</th><th className="px-3 py-2 text-right">Debit</th><th className="px-3 py-2 text-right">Credit</th></tr>
        </thead>
        <tbody>
          {result.rows.map((r) => {
            const isOpen = openRows.has(r.ledgerId);
            return (
              <Fragment key={r.ledgerId}>
                <tr className="cursor-pointer border-t border-slate-100 hover:bg-cobalt-50/40" onClick={() => toggle(r.ledgerId)}>
                  <td className="px-3 py-2">
                    <button type="button" aria-expanded={isOpen} aria-label={`${isOpen ? "Hide" : "Show"} the charges behind ${r.label}`} className="mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded text-slate-500 hover:bg-slate-200"
                      onClick={(e) => { e.stopPropagation(); toggle(r.ledgerId); }}>
                      {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                    <span className="font-medium text-ink">{r.label}</span>
                    <span className="ml-2 text-[11px] text-slate-400">{r.lines.length} charge{r.lines.length === 1 ? "" : "s"}</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.dr ? fmtC(r.dr) : ""}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.cr ? fmtC(r.cr) : ""}</td>
                </tr>
                {isOpen && r.lines.map((l, i) => (
                  <tr key={i} className="bg-slate-50 text-slate-600">
                    <td className="py-1.5 pl-11 pr-3"><span className="font-medium">{l.termCode}</span> <span className="text-slate-500">{l.termName}</span> <span className="text-slate-400">· against {l.counter}</span></td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{l.dr ? fmtC(l.dr) : ""}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{l.cr ? fmtC(l.cr) : ""}</td>
                  </tr>
                ))}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
            <td className="px-3 py-2">Total{diff !== 0 && <span className="ml-3 font-semibold text-red-700" role="alert">difference {fmtC(diff)}</span>}</td>
            <td className="px-3 py-2 text-right tabular-nums">{fmtC(result.dr)}</td>
            <td className="px-3 py-2 text-right tabular-nums">{fmtC(result.cr)}</td>
          </tr>
        </tfoot>
      </table>
      <Checks result={result} />
    </div>
  );
}

function Checks({ result }: { result: LedgerCheckResult }) {
  return (
    <div className="px-4 py-4">
      <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-slate-500">Checks</h3>
      <ul className="space-y-1.5 text-[12.5px]">
        {result.checks.map((c) => (
          <li key={c.id} className="flex items-start gap-2">
            {c.ok ? <Check size={15} className="mt-0.5 shrink-0 text-green-700" aria-label="passed" /> : <X size={15} className="mt-0.5 shrink-0 text-red-700" aria-label="failed" />}
            <span className={c.ok ? "text-slate-700" : "font-medium text-red-700"}>{c.label}{c.detail ? <span className="ml-2 font-normal text-slate-500">{c.detail}</span> : null}</span>
          </li>
        ))}
        {result.notInStock !== 0 && (
          <li className="flex items-start gap-2 text-slate-600">
            <Info size={15} className="mt-0.5 shrink-0 text-slate-400" aria-hidden />
            <span>{result.notInStock > 0 ? "" : "−"}{fmtC(result.notInStock)} is posted but kept out of landed cost (charges that do not affect stock value).</span>
          </li>
        )}
      </ul>
    </div>
  );
}
