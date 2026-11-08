import { fmt, toMicro, ZERO } from "../../../shared/purchase-calculation";
import type { PurchasePreview } from "../../../shared/purchase-preview";
import { money } from "./Bits";

interface SavedDocTotals {
  basicAmount?: unknown;
  termAmount?: unknown;
  totalAmount?: unknown;
  terms?: { nature?: string; finalAmount?: unknown }[];
}

interface Props {
  preview: PurchasePreview;
  savedDoc?: SavedDocTotals | null;
  readOnly: boolean;
  hasLines: boolean;
  /** One centred line for the fixed footer of the bill entry screen; the explanation moves into a tooltip and only a problem is spelled out. */
  compact?: boolean;
}

const safeMoney = (value: unknown) => money(value == null ? "0" : String(value)) || "0.00";
const signedMoney = (value: unknown) => {
  const text = value == null ? "0" : String(value);
  return text.startsWith("-") ? `− ${money(text.slice(1))}` : money(text);
};

export function PurchaseInvoiceTotals({ preview, savedDoc, readOnly, hasLines, compact }: Props) {
  const showSaved = readOnly && !!savedDoc;
  let savedAdditions = "0.00";
  let savedDeductions = "0.00";
  let savedBreakdownMismatch = false;
  if (showSaved && savedDoc) {
    try {
      let additions = ZERO, deductions = ZERO;
      for (const term of savedDoc.terms ?? []) {
        const amount = toMicro(term.finalAmount == null ? "0" : String(term.finalAmount));
        if (term.nature === "DEDUCTIVE") deductions += amount;
        else additions += amount;
      }
      savedAdditions = fmt(additions, 2);
      savedDeductions = fmt(deductions, 2);
      savedBreakdownMismatch = additions - deductions !== toMicro(String(savedDoc.termAmount ?? "0"));
    } catch {
      // Keep the persisted document totals authoritative if a legacy record has malformed term detail.
    }
  }

  const entries = [
    { label: "Basic amount", value: showSaved ? safeMoney(savedDoc?.basicAmount) : money(preview.basicAmount) },
    { label: "Additions", value: showSaved ? savedAdditions : preview.additions === null ? "—" : money(preview.additions) },
    { label: "Deductions", value: showSaved ? savedDeductions : preview.deductions === null ? "—" : money(preview.deductions) },
    { label: "Net terms", value: showSaved ? signedMoney(savedDoc?.termAmount) : preview.termAmount === null ? "—" : signedMoney(preview.termAmount) },
    { label: "Net amount", value: showSaved ? signedMoney(savedDoc?.totalAmount) : preview.netAmount === null ? "—" : signedMoney(preview.netAmount), total: true },
  ];
  const calculationAlert = savedBreakdownMismatch || (!showSaved && preview.status === "error");

  const message = showSaved
    ? savedBreakdownMismatch ? "Saved term detail does not reconcile to the stored net-terms total. Review this bill before relying on the breakdown." : "Saved bill totals · additions and deductions are itemized from the saved terms."
    : !hasLines ? "Add invoice lines to begin the live calculation."
      : preview.status === "ready" ? "Live preview · follows the same calculation rules used when saving the bill."
        : preview.message ?? "Complete the bill inputs to calculate totals.";

  if (compact) {
    return (
      <section aria-label="Purchase invoice totals" title={message} className="flex flex-wrap items-baseline justify-center gap-x-5 gap-y-0.5 px-3">
        {entries.map((entry) => (
          <div key={entry.label} className="flex min-w-0 items-baseline gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-600">{entry.label}</span>
            <span aria-live={entry.total ? "polite" : undefined} aria-atomic={entry.total ? true : undefined}
              className={`tabular-nums font-semibold ${entry.total ? "rounded-sm bg-blue-50 px-2 text-[15px] text-blue-950" : "text-[13px] text-slate-900"}`}>{entry.value}</span>
          </div>
        ))}
        {(calculationAlert || (!showSaved && hasLines && preview.status !== "ready")) && (
          <span role={calculationAlert ? "alert" : "status"} className={`max-w-[34ch] truncate text-[11px] ${calculationAlert ? "text-amber-800" : "text-slate-500"}`}>{message}</span>
        )}
      </section>
    );
  }

  return (
    <section aria-label="Purchase invoice totals" className="sticky top-0 z-20 border border-slate-400 bg-white shadow-sm">
      <div className="grid grid-cols-2 divide-x divide-y divide-slate-200 sm:grid-cols-3 lg:grid-cols-5 lg:divide-y-0">
        {entries.map((entry) => (
          <div key={entry.label} className={`min-w-0 px-2.5 py-1.5 ${entry.total ? "col-span-2 bg-blue-50 sm:col-span-1" : ""}`}>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-600">{entry.label}</div>
            <div aria-live={entry.total ? "polite" : undefined} aria-atomic={entry.total ? true : undefined} className={`truncate text-right font-semibold tabular-nums ${entry.total ? "text-base text-blue-950" : "text-sm text-slate-900"}`} title={entry.value}>{entry.value}</div>
          </div>
        ))}
      </div>
      <p role={calculationAlert ? "alert" : "status"} className={`border-t border-slate-200 px-2.5 py-1 text-[11px] ${calculationAlert ? "bg-amber-50 text-amber-900" : "text-slate-600"}`}>
        {message} {!showSaved && preview.status === "ready" && hasLines && "Net amount = basic amount + additions − deductions."}
      </p>
    </section>
  );
}
