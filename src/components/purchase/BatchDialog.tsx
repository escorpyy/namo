import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DateInput } from "../DateInput";

// The batch details of one bill line, in their own dialog: batch no, manufacture date and expiry date (whichever the product tracks).
// The grid shows a single "Batch" cell, Yes when something is filled here and No when not. More batch fields can be added to this dialog later.

export interface BatchValues { batchNo: string; manufactureDate: string; expiryDate: string }

/** A line has batch details when any of the batch fields is filled. */
export const hasBatch = (l: BatchValues) => !!(l.batchNo.trim() || l.manufactureDate || l.expiryDate);

export function BatchDialog({ title, product, tracksBatch, tracksExpiry, value, calendar, readOnly, onApply, onClose }: {
  title: string; product: string; tracksBatch: boolean; tracksExpiry: boolean; value: BatchValues; calendar: "BS" | "AD"; readOnly: boolean;
  onApply: (v: BatchValues) => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState<BatchValues>(value);
  const [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const set = (p: Partial<BatchValues>) => { setDraft((d) => ({ ...d, ...p })); setError(""); };

  useEffect(() => { root.current?.querySelector<HTMLElement>("input:not(:disabled)")?.focus(); }, []);

  const apply = () => {
    if (readOnly) { onClose(); return; }
    if (tracksBatch && !draft.batchNo.trim()) { setError("This product is batch-tracked; enter the batch number."); return; }
    if (draft.manufactureDate && draft.expiryDate && draft.expiryDate < draft.manufactureDate) { setError("Expiry date cannot be before the manufacture date."); return; }
    onApply({ batchNo: draft.batchNo.trim(), manufactureDate: draft.manufactureDate, expiryDate: draft.expiryDate });
  };

  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-3" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={root} role="dialog" aria-modal="true" aria-label={title} className="flex w-[min(440px,96vw)] flex-col border border-slate-500 bg-white shadow-xl"
        onKeyDown={(e) => {
          e.stopPropagation(); // the screen behind must not see these keys
          if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); apply(); return; }
          if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") { e.preventDefault(); apply(); return; }
          if (e.key === "Tab") {
            const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled)')).filter((i) => i.getClientRects().length > 0);
            const first = items[0], last = items[items.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
          }
        }}>
        <div className="border-b border-slate-300 bg-slate-100 px-3 py-2">
          <h2 className="text-[14px] font-semibold text-slate-800">{title}</h2>
          <p className="text-[11px] text-slate-600">{product}</p>
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-3 p-3">
          {tracksBatch && (
            <label className="col-span-2 block text-[12px] font-medium text-slate-700">Batch no <span className="text-rose-600">*</span>
              <input disabled={readOnly} maxLength={50} autoComplete="off" value={draft.batchNo} onChange={(e) => set({ batchNo: e.target.value })} onFocus={(e) => e.currentTarget.select()} className={`fld mt-1 h-8 ${readOnly ? "bg-slate-100 text-slate-600" : ""}`} />
            </label>
          )}
          {tracksExpiry && (
            <>
              <div className="text-[12px] font-medium text-slate-700">Mfg date
                <div className="mt-1"><DateInput fieldName="BD.mf" value={draft.manufactureDate} onChange={(v) => set({ manufactureDate: v })} calendar={calendar} hasError={false} onBlurField={() => {}} disabled={readOnly} /></div>
              </div>
              <div className="text-[12px] font-medium text-slate-700">Expiry date
                <div className="mt-1"><DateInput fieldName="BD.ex" value={draft.expiryDate} onChange={(v) => set({ expiryDate: v })} calendar={calendar} hasError={false} onBlurField={() => {}} disabled={readOnly} /></div>
              </div>
            </>
          )}
          {error && <p className="col-span-2 text-[12px] text-rose-700" role="alert">{error}</p>}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-300 bg-slate-50 px-3 py-2">
          <button type="button" className="btn" onClick={onClose}>{readOnly ? "Close" : "Cancel"} <span className="kbd">Esc</span></button>
          {!readOnly && <button type="button" className="btn btn-primary" onClick={apply}>OK <span className="kbd">Enter</span></button>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
