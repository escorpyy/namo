import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DateInput } from "../DateInput";
import { isValidAd } from "../../lib/nepaliDate";

// The batch details of one bill line, in their own dialog: batch no, manufacture date and expiry date (whichever the product tracks).
// The grid shows a single "Batch" cell, Yes when something is filled here and No when not. More batch fields can be added to this dialog later.

export interface BatchValues { batchNo: string; manufactureDate: string; expiryDate: string }
type BatchField = "batchNo" | "manufactureDate" | "expiryDate";

/** A line has batch details when any of the batch fields is filled. */
export const hasBatch = (l: BatchValues) => !!(l.batchNo.trim() || l.manufactureDate || l.expiryDate);

export function BatchDialog({ title, product, tracksBatch, tracksExpiry, value, calendar, readOnly, onApply, onClose }: {
  title: string; product: string; tracksBatch: boolean; tracksExpiry: boolean; value: BatchValues; calendar: "BS" | "AD"; readOnly: boolean;
  onApply: (v: BatchValues) => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState<BatchValues>(value);
  const [error, setError] = useState("");
  const [errorField, setErrorField] = useState<BatchField | null>(null);
  const [editingField, setEditingField] = useState<BatchField | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const fields: BatchField[] = [
    ...(tracksBatch ? ["batchNo" as const] : []),
    ...(tracksExpiry ? ["manufactureDate" as const, "expiryDate" as const] : []),
  ];
  const set = (p: Partial<BatchValues>) => { setDraft((d) => ({ ...d, ...p })); setError(""); setErrorField(null); };
  const controlFor = (field: BatchField) => root.current?.querySelector<HTMLElement>(
    field === "batchNo" ? '[data-batch-field="batchNo"]' : `[data-field="BD.${field === "manufactureDate" ? "mf" : "ex"}"]`,
  ) ?? null;
  const fieldFor = (target: HTMLElement): BatchField | null => {
    if (target.dataset.batchField === "batchNo") return "batchNo";
    if (target.dataset.field === "BD.mf") return "manufactureDate";
    if (target.dataset.field === "BD.ex") return "expiryDate";
    return null;
  };
  const focusField = (field: BatchField) => window.requestAnimationFrame(() => controlFor(field)?.focus());
  const fieldError = (field: BatchField): string => {
    if (field === "batchNo" && tracksBatch && !draft.batchNo.trim()) return "This product is batch-tracked; enter the batch number.";
    if (field === "manufactureDate" && draft.manufactureDate && (draft.manufactureDate.startsWith("?") || !isValidAd(draft.manufactureDate))) return "Enter a valid manufacture date.";
    if (field === "expiryDate") {
      if (tracksExpiry && !draft.expiryDate) return "This product expires; enter the expiry date.";
      if (draft.expiryDate && (draft.expiryDate.startsWith("?") || !isValidAd(draft.expiryDate))) return "Enter a valid expiry date.";
      if (draft.manufactureDate && draft.expiryDate && draft.expiryDate < draft.manufactureDate) return "Expiry date cannot be before the manufacture date.";
    }
    return "";
  };
  const showFieldError = (field: BatchField, message: string) => {
    setError(message); setErrorField(field); focusField(field);
  };

  const focusableItems = () => Array.from(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])') ?? [])
    .filter((item) => item.getClientRects().length > 0);
  useEffect(() => {
    const initial = fields.map(controlFor).find((item) => item && !item.hasAttribute("disabled")) ?? null;
    (initial ?? root.current?.querySelector<HTMLElement>("button:not(:disabled)"))?.focus();
  }, []);

  const apply = () => {
    if (readOnly) { onClose(); return; }
    for (const field of fields) {
      const message = fieldError(field);
      if (message) { showFieldError(field, message); return; }
    }
    onApply({ batchNo: draft.batchNo.trim(), manufactureDate: draft.manufactureDate, expiryDate: draft.expiryDate });
  };

  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-3" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={root} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className="flex w-[min(440px,96vw)] flex-col border border-slate-500 bg-white shadow-xl"
        onKeyDown={(e) => {
          e.stopPropagation(); // the screen behind must not see these keys
          if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); apply(); return; }
          const field = fieldFor(e.target as HTMLElement);
          if (e.key === "Enter" && field && !readOnly) {
            e.preventDefault();
            const index = fields.indexOf(field);
            if (e.shiftKey) {
              const message = fieldError(field);
              if (message) { showFieldError(field, message); return; }
              if (index > 0) {
                setError(""); setErrorField(null); setEditingField(null);
                focusField(fields[index - 1]);
              }
              return;
            }
            if (editingField !== field) { setError(""); setErrorField(null); setEditingField(field); return; }
            const message = fieldError(field);
            if (message) { showFieldError(field, message); return; }
            setError(""); setErrorField(null); setEditingField(null);
            const next = fields[index + 1];
            if (next) focusField(next);
            else root.current?.querySelector<HTMLElement>("[data-batch-apply]")?.focus();
            return;
          }
          if (e.key === "Tab") {
            const items = focusableItems();
            if (!items.length) { e.preventDefault(); root.current?.focus(); return; }
            const index = items.indexOf(document.activeElement as HTMLElement);
            const next = index < 0 ? (e.shiftKey ? items.length - 1 : 0) : (index + (e.shiftKey ? -1 : 1) + items.length) % items.length;
            e.preventDefault(); items[next].focus();
          }
        }}>
        <div className="border-b border-slate-300 bg-slate-100 px-3 py-2">
          <h2 className="text-[14px] font-semibold text-slate-800">{title}</h2>
          <p className="text-[11px] text-slate-600">{product}</p>
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-3 p-3">
          {tracksBatch && (
            <label className="col-span-2 block text-[12px] font-medium text-slate-700">Batch no <span className="text-rose-600">*</span>
              <input data-batch-field="batchNo" disabled={readOnly} readOnly={editingField !== "batchNo"} aria-invalid={errorField === "batchNo" || undefined} maxLength={50} autoComplete="off" value={draft.batchNo} onChange={(e) => set({ batchNo: e.target.value })} onFocus={(e) => e.currentTarget.select()} className={`fld mt-1 h-8 ${errorField === "batchNo" ? "fld-err" : ""} ${readOnly ? "bg-slate-100 text-slate-600" : editingField !== "batchNo" ? "bg-slate-50" : ""}`} />
            </label>
          )}
          {tracksExpiry && (
            <>
              <div className="text-[12px] font-medium text-slate-700">Mfg date
                <div className="mt-1"><DateInput fieldName="BD.mf" value={draft.manufactureDate} onChange={(v) => set({ manufactureDate: v })} calendar={calendar} hasError={errorField === "manufactureDate"} onBlurField={() => {}} disabled={readOnly} readOnly={editingField !== "manufactureDate"} /></div>
              </div>
              <div className="text-[12px] font-medium text-slate-700">Expiry date
                <div className="mt-1"><DateInput fieldName="BD.ex" value={draft.expiryDate} onChange={(v) => set({ expiryDate: v })} calendar={calendar} hasError={errorField === "expiryDate"} onBlurField={() => {}} disabled={readOnly} readOnly={editingField !== "expiryDate"} /></div>
              </div>
            </>
          )}
          {error && <p className="col-span-2 text-[12px] text-rose-700" role="alert">{error}</p>}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-300 bg-slate-50 px-3 py-2">
          <button type="button" data-cancel-batch className="btn" onClick={onClose}>{readOnly ? "Close" : "Cancel"} <span className="kbd">Esc</span></button>
          {!readOnly && <button type="button" data-batch-apply className="btn btn-primary" onClick={apply}>OK <span className="kbd">Enter</span></button>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
