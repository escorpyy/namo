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
  isAdditional: boolean;
  hasLines: boolean;
  hasTerms: boolean;
}

const safeMoney = (value: unknown) => money(value == null ? "0" : String(value)) || "0.00";

export function PurchaseInvoiceTotals({ preview, savedDoc, readOnly, isAdditional, hasLines, hasTerms }: Props) {
  const showSaved = readOnly && !!savedDoc;
  const awaitingAdditionalTerm = !showSaved && isAdditional && !hasTerms;
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
    { label: "Additions", value: showSaved ? savedAdditions : awaitingAdditionalTerm || preview.additions === null ? "—" : money(preview.additions) },
    { label: "Deductions", value: showSaved ? savedDeductions : awaitingAdditionalTerm || preview.deductions === null ? "—" : money(preview.deductions) },
    { label: "Net terms", value: showSaved ? safeMoney(savedDoc?.termAmount) : awaitingAdditionalTerm || preview.termAmount === null ? "—" : money(preview.termAmount) },
    { label: "Net amount", value: showSaved ? safeMoney(savedDoc?.totalAmount) : awaitingAdditionalTerm || preview.netAmount === null ? "—" : money(preview.netAmount), total: true },
  ];
  const calculationAlert = savedBreakdownMismatch || (!showSaved && preview.status === "error");

  const message = showSaved
    ? savedBreakdownMismatch ? "Saved term detail does not reconcile to the stored net-terms total. Review this bill before relying on the breakdown." : "Saved bill totals · additions and deductions are itemized from the saved terms."
    : !hasLines && !isAdditional ? "Add invoice lines to begin the live calculation."
    : awaitingAdditionalTerm ? "Add an additional-charge term to calculate this bill."
        : preview.status === "ready" ? "Live preview · follows the same calculation rules used when saving the bill."
          : preview.message ?? "Complete the bill inputs to calculate totals.";

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
