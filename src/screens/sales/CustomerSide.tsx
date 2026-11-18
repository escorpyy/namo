import { useCallback, useEffect, useState } from "react";
import { cashBankApi, ApiError, type AdvanceApplied, type OpenAdvance } from "../../api";
import { useDialog } from "../../components/Dialog";
import { groupIN } from "../../components/purchase/Bits";
import { adToBs } from "../../lib/nepaliDate";
import { defaultDate } from "../../lib/purchaseForm";
import { formatPaise, parseAmount } from "../../../shared/cashBankVoucher";
import CustomerInvoices from "./CustomerInvoices";

// The extra block of the customer panel: advances the customer has paid (receipts not settled against invoices), a way to use them on THIS
// invoice when it is posted and still unpaid, the advances already used on it (with Undo), then the recent invoices.
type Doc = { id: number; invoiceNumber: string; state: string; fiscalYear: string } | null;
const OK = /^\d{0,12}(\.\d{0,2})?$/;

export default function CustomerSide(p: {
  companyId: number; branchId: number; userId: number; customerGLId: number; doc: Doc; fiscalYears?: { code: string; startDate: string; endDate: string }[];
  calendar: "BS" | "AD"; onOpen?: (id: number) => void;
}) {
  const dlg = useDialog();
  const [ver, setVer] = useState(0);
  const [advances, setAdvances] = useState<OpenAdvance[] | null>(null);
  const [applied, setApplied] = useState<AdvanceApplied[]>([]);
  const [outstanding, setOutstanding] = useState<bigint | null>(null);
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const posted = p.doc?.state === "POSTED";
  const docId = p.doc?.id;
  useEffect(() => {
    let live = true;
    const key = { companyId: p.companyId, kind: "SALES_INVOICE" as const };
    Promise.all([
      cashBankApi.advances({ ...key, generalLedgerId: p.customerGLId }),
      posted && docId ? cashBankApi.advanceApplications({ ...key, documentId: docId }) : Promise.resolve({ rows: [] as AdvanceApplied[] }),
      posted && docId ? cashBankApi.openDocuments({ ...key, generalLedgerId: p.customerGLId }) : Promise.resolve(null),
    ]).then(([a, ap, od]) => {
      if (!live) return;
      setAdvances(a.rows); setApplied(ap.rows);
      const mine = od?.rows.find((d) => d.id === docId);
      setOutstanding(mine ? (parseAmount(mine.outstanding) ?? 0n) : 0n);
      // suggestion: oldest advance first, up to what the invoice still owes
      let rest = mine ? (parseAmount(mine.outstanding) ?? 0n) : 0n;
      const next: Record<number, string> = {};
      for (const adv of a.rows) {
        const take = rest < (parseAmount(adv.available) ?? 0n) ? rest : (parseAmount(adv.available) ?? 0n);
        if (take > 0n) { next[adv.voucherId] = formatPaise(take); rest -= take; }
      }
      setAmounts(next);
    }).catch(() => { if (live) setAdvances([]); });
    return () => { live = false; };
  }, [p.companyId, p.customerGLId, docId, posted, ver]);
  const date = (v: string) => (p.calendar === "BS" ? adToBs(v) ?? v : v);
  const totalAvail = (advances ?? []).reduce((a, r) => a + (parseAmount(r.available) ?? 0n), 0n);
  const chosen = (advances ?? []).reduce((a, r) => a + (parseAmount(amounts[r.voucherId] ?? "") ?? 0n), 0n);
  const canApply = posted && !!docId && (outstanding ?? 0n) > 0n && totalAvail > 0n;

  const apply = async () => {
    if (!docId || busy) return;
    const items = (advances ?? []).filter((r) => (parseAmount(amounts[r.voucherId] ?? "") ?? 0n) > 0n).map((r) => ({ voucherId: r.voucherId, amount: amounts[r.voucherId] }));
    if (!items.length) { void dlg.error("Enter how much of an advance to use."); return; }
    const d = await dlg.prompt(<>Date of the adjustment (AD, YYYY-MM-DD). It must fall in an open period.</>, {
      title: "Apply advance", label: "Date", required: true, confirmLabel: "Apply", defaultValue: defaultDate(p.fiscalYears?.find((y) => y.code === p.doc?.fiscalYear) as any),
    });
    if (!d) return;
    setBusy(true);
    try { await cashBankApi.applyAdvances({ companyId: p.companyId, userId: p.userId, kind: "SALES_INVOICE", documentId: docId, date: d.trim(), items }); setVer((v) => v + 1); }
    catch (e) { void dlg.error((e as ApiError).message, { title: "Could not apply the advance" }); }
    finally { setBusy(false); }
  };
  const undo = async (a: AdvanceApplied) => {
    const reason = await dlg.prompt(<>Reason for undoing the <b className="tabular-nums">{groupIN(a.amount)}</b> taken from <b className="font-mono">{a.voucherNumber}</b>.</>, { title: "Undo adjustment", label: "Reason", required: true, confirmLabel: "Undo" });
    if (!reason) return;
    setBusy(true);
    try { await cashBankApi.undoAdvance(a.id, p.companyId, p.userId, reason.trim()); setVer((v) => v + 1); }
    catch (e) { void dlg.error((e as ApiError).message, { title: "Could not undo" }); }
    finally { setBusy(false); }
  };

  return (
    <div>
      {advances && advances.length > 0 && (
        <div data-testid="advances">
          <h3 className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Advances paid</h3>
          <p className="mx-4 mb-1 border border-emerald-300 bg-emerald-50 px-2 py-1 text-[12.5px] text-emerald-800" role="status">
            Advance available: <b className="tabular-nums">{groupIN(formatPaise(totalAvail))}</b>
          </p>
          <ul>
            {advances.map((r) => (
              <li key={r.voucherId} className="space-y-1 border-b border-slate-100 px-4 py-2 text-[12.5px]">
                <span className="flex items-baseline justify-between gap-2"><span className="font-mono text-[12px] font-semibold text-cobalt-800">{r.voucherNumber}</span><span className="tabular-nums text-[12px] text-slate-500">{date(r.date)}</span></span>
                <span className="flex items-center justify-between gap-2">
                  <span className="text-slate-600">Left <b className="tabular-nums text-ink">{groupIN(r.available)}</b></span>
                  {canApply && <input value={amounts[r.voucherId] ?? ""} inputMode="decimal" placeholder="0.00" aria-label={`Use from ${r.voucherNumber}`}
                    onChange={(e) => { if (OK.test(e.target.value)) setAmounts((m) => ({ ...m, [r.voucherId]: e.target.value })); }} className="w-[104px] border border-slate-300 px-1.5 py-0.5 text-right tabular-nums" />}
                </span>
              </li>
            ))}
          </ul>
          {canApply && (
            <div className="flex items-center justify-between gap-2 px-4 py-2">
              <span className="text-[12px] text-slate-600">Using <b className="tabular-nums">{groupIN(formatPaise(chosen))}</b> of <b className="tabular-nums">{groupIN(formatPaise(outstanding ?? 0n))}</b> due</span>
              <button type="button" className="btn btn-primary" disabled={busy || chosen === 0n || chosen > (outstanding ?? 0n)} onClick={() => void apply()}>Apply to {p.doc?.invoiceNumber}</button>
            </div>
          )}
        </div>
      )}
      {applied.length > 0 && (
        <div data-testid="advances-applied">
          <h3 className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Advances used on this invoice</h3>
          <ul>{applied.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2 text-[12.5px]">
              <span><span className="font-mono text-[12px] font-semibold text-cobalt-800">{a.voucherNumber}</span> <span className="tabular-nums text-slate-500">{date(a.date)}</span></span>
              <span className="flex items-center gap-2"><b className="tabular-nums text-ink">{groupIN(a.amount)}</b><button type="button" className="btn" disabled={busy} onClick={() => void undo(a)}>Undo</button></span>
            </li>
          ))}</ul>
        </div>
      )}
      <CustomerInvoices key={ver} companyId={p.companyId} branchId={p.branchId} customerGLId={p.customerGLId} docId={docId} calendar={p.calendar} onOpen={p.onOpen} />
    </div>
  );
}
