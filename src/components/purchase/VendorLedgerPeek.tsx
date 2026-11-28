import { useEffect, useState } from "react";
import { accountPeekApi, type AccountPeek } from "../../api";
import { isIsoDate } from "../../../shared/cashBankVoucher";
import { adToBs } from "../../lib/nepaliDate";
import { netOfBalance, netText } from "../../lib/peek";
import { groupIN } from "./Bits";

interface VendorLedgerPeekProps {
  companyId: number;
  branchId: number;
  branchName: string;
  fiscalYear: string;
  date: string;
  vendorGLId: string;
  subLedgerId: string;
  calendar: "BS" | "AD";
}

export function VendorLedgerPeek({ companyId, branchId, branchName, fiscalYear, date, vendorGLId, subLedgerId, calendar }: VendorLedgerPeekProps) {
  const dateOk = isIsoDate(date);
  const key = vendorGLId && dateOk && fiscalYear
    ? [companyId, branchId, fiscalYear, date, vendorGLId, subLedgerId].join("|")
    : "";
  const [result, setResult] = useState<{ key: string; data?: AccountPeek; error?: string }>({ key: "" });

  useEffect(() => {
    if (!key) return;
    let live = true;
    accountPeekApi.get({
      companyId,
      branchId,
      fiscalYear,
      date,
      generalLedgerId: Number(vendorGLId),
      subLedgerId: subLedgerId ? Number(subLedgerId) : null,
      limit: 8,
    }).then((data) => { if (live) setResult({ key, data }); })
      .catch((error: Error) => { if (live) setResult({ key, error: error.message }); });
    return () => { live = false; };
  }, [key, companyId, branchId, fiscalYear, date, vendorGLId, subLedgerId]);

  const dateText = (value: string) => calendar === "BS" ? adToBs(value) ?? value : value;
  const current = result.key === key ? result : null;
  const amountText = (debit: string, credit: string) => debit !== "0.00"
    ? `${groupIN(debit)} Dr`
    : credit !== "0.00" ? `${groupIN(credit)} Cr` : "0.00";

  if (!vendorGLId) return <p className="px-3 py-4 text-[12px] leading-relaxed text-slate-500">Choose a vendor to peek at its ledger.</p>;
  if (!dateOk) return <p className="px-3 py-4 text-[12px] leading-relaxed text-slate-500">Enter a valid invoice date to see the vendor balance.</p>;
  if (!current) return <p className="px-3 py-4 text-[12px] text-slate-500">Loading vendor ledger…</p>;
  if (current.error || !current.data) return <p role="alert" className="px-3 py-4 text-[12px] leading-relaxed text-rose-700">{current.error ?? "Could not load the vendor ledger."}</p>;

  const data = current.data;
  const balance = netText(netOfBalance(data.balance));
  return (
    <div className="min-w-0">
      <div className="border-b border-slate-100 px-3 py-2.5">
        <div className="font-mono text-[11px] text-slate-500">{data.ledger.code}</div>
        <div className="break-words text-[13px] font-semibold leading-snug text-ink">{data.ledger.name}</div>
        {data.subLedger && <div className="mt-1 break-words text-[12px] text-slate-600">{data.subLedger.code} — {data.subLedger.name}</div>}
      </div>
      <div className="border-b border-slate-100 px-3 py-2.5">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Balance as of {dateText(date)}</div>
        <div className="mt-0.5 break-words text-[16px] font-semibold tabular-nums text-ink">{balance}</div>
        <p className="mt-1 text-[10.5px] leading-snug text-slate-500">{branchName} · {fiscalYear}</p>
      </div>
      <div>
        <h3 className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Recent posted entries</h3>
        {data.recent.length === 0 ? <p className="px-3 py-2 text-[12px] text-slate-500">No posted entries before this date.</p> : (
          <ul>
            {data.recent.map((entry, index) => (
              <li key={`${entry.kind}:${entry.voucherId}:${index}`} className="space-y-0.5 border-b border-slate-100 px-3 py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate font-mono text-[11.5px] font-semibold text-cobalt-800" title={entry.voucherNumber}>{entry.voucherNumber}</span>
                  <span className="shrink-0 text-[10.5px] tabular-nums text-slate-500">{dateText(entry.voucherDate)}</span>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-[11px] text-slate-600" title={entry.narration ?? undefined}>{entry.narration || (entry.kind === "JOURNAL" ? "Journal voucher" : "Cash / Bank voucher")}</span>
                  <span className="shrink-0 text-[11.5px] font-medium tabular-nums text-ink">{amountText(entry.debit, entry.credit)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
