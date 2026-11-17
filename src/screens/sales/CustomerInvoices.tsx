import { useEffect, useMemo, useState } from "react";
import { salesInvoiceApi, type SalesInvoiceRow } from "../../api";
import { Pill, money } from "../../components/purchase/Bits";
import { adToBs } from "../../lib/nepaliDate";
import { STATE_TONE } from "./SalesInvoiceScreen";

// The last invoices of the customer on the invoice being entered (shown in the customer panel). Clicking one opens it in its own tab.
export default function CustomerInvoices({ companyId, branchId, customerGLId, docId, calendar, onOpen }: {
  companyId: number; branchId: number; customerGLId: number; docId?: number; calendar: "BS" | "AD"; onOpen?: (id: number) => void;
}) {
  const [rows, setRows] = useState<SalesInvoiceRow[] | null>(null);
  useEffect(() => {
    let live = true;
    setRows(null);
    salesInvoiceApi.list({ companyId, branchId, fiscalYear: "", customerGLId, limit: 8 }).then((r) => { if (live) setRows(r.rows); }).catch(() => { if (live) setRows([]); });
    return () => { live = false; };
  }, [companyId, branchId, customerGLId, docId]);
  const others = useMemo(() => (rows ?? []).filter((r) => r.id !== docId).slice(0, 6), [rows, docId]);
  const date = (v: string) => (calendar === "BS" ? adToBs(v.slice(0, 10)) ?? v.slice(0, 10) : v.slice(0, 10));
  return (
    <div>
      <h3 className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Recent invoices</h3>
      {rows === null ? <p className="px-4 py-2 text-[12.5px] text-slate-500">Loading…</p>
        : others.length === 0 ? <p className="px-4 py-2 text-[12.5px] text-slate-500">No earlier invoices to this customer.</p>
        : (
          <ul>
            {others.map((r) => (
              <li key={r.id}>
                <button type="button" tabIndex={-1} onClick={() => onOpen?.(r.id)} title={`Open ${r.invoiceNumber} in a new tab`} className="block w-full space-y-0.5 border-b border-slate-100 px-4 py-2 text-left hover:bg-slate-50">
                  <span className="flex items-baseline justify-between gap-2"><span className="font-mono text-[12px] font-semibold text-cobalt-800">{r.invoiceNumber}</span><span className="tabular-nums text-[12px] text-slate-500">{date(r.invoiceDate)}</span></span>
                  <span className="flex items-center justify-between gap-2"><Pill text={r.state} tone={STATE_TONE[r.state]} /><span className="tabular-nums text-[12.5px] font-medium text-ink">{money(r.totalAmount)}</span></span>
                </button>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}
