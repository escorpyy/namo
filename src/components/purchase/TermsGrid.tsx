import { useMemo } from "react";
import { Plus, X } from "lucide-react";
import type { PLookups } from "../../api";
import { blankTerm, isBlankTerm, pickableTerms, type Term, type TermRow } from "../../lib/purchaseForm";
import { fillDownRows } from "../../lib/tableKinds";
import { useGridRows } from "../table/useGridRows";
import { MasterReferencePicker, type ReferenceOption } from "../MasterReferencePicker";
import { focusStep, money } from "./Bits";
import type { PreviewTermResult } from "../../../shared/purchase-preview";

type Errs = Record<string, string | undefined>;
const decOnly = (re: RegExp, set: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => { if (re.test(e.target.value)) set(e.target.value); };
const RATE = /^\d{0,12}(\.\d{0,6})?$/, INT = /^\d{0,9}$/;

// ---------------------------------------------------------------------------------------------------------------------------
const TCOLS = "34px minmax(210px,1.5fr) 72px 112px 112px 88px 112px 112px 30px";
// Ctrl+D on a term: what is copied from the term above (never its key; the saved amount is cleared because it no longer matches).
const TERM_FILL: (keyof TermRow)[] = ["termId", "nature", "lineNumber", "calcType", "rate", "inputAmount", "isOverridden", "overrideAmount"];

interface TProps {
  terms: TermRow[];
  onChange: (t: TermRow[]) => void;
  lookups: PLookups;
  masters: Map<string, Term>;
  lineCount: number;
  readOnly: boolean;
  errors: Errs;
  clearError: (...k: string[]) => void;
  contextKey: string;
  calculationPreview?: Map<string, PreviewTermResult>;
  previewError?: string;
  category?: "GENERAL" | "COSTING";
  excludeCategory?: "COSTING";
  productwiseOnly?: boolean;
  fixedLineNumber?: number;
}

// Billing terms: discount, VAT, freight ... The active preview is calculated by the same shared exact engine as the server.
export function TermsGrid({ terms, onChange, lookups, masters, lineCount, readOnly, errors, clearError, contextKey, calculationPreview, previewError, category, excludeCategory, productwiseOnly, fixedLineNumber }: TProps) {
  const opts = useMemo<ReferenceOption[]>(() => pickableTerms(lookups.terms, { category, excludeCategory, productwiseOnly }).map((t) => ({ value: String(t.id), label: `${t.code} — ${t.name}`, code: t.code, name: t.name, detail: `${t.category} · ${t.nature} · ${t.calcBase.replaceAll("_", " ")} · seq ${t.sequence}`, searchText: `${t.sequence} ${t.isProductwise ? "productwise" : "document"}`, isActive: t.isActive, badge: t.nature === "DEDUCTIVE" ? "less" : undefined })), [lookups.terms, category, excludeCategory, productwiseOnly]);
  const patch = (i: number, p: Partial<TermRow>) => { onChange(terms.map((t, k) => (k === i ? { ...t, ...p } : t))); clearError(...Object.keys(errors).filter((k) => k.startsWith(`T.${i}.`))); };
  const pick = (i: number, id: string) => {
    const m = masters.get(id);
    // A rounding term is worked out from the document total: it has no rate or amount to enter (the server treats it as AMOUNT).
    const rounded = m?.category === "ROUNDED", calcType = rounded ? "AMOUNT" : m?.defaultCalcType;
    patch(i, m ? { termId: id, nature: m.nature, calcType: calcType!, rate: !rounded && calcType === "PERCENT" ? (m.defaultValue ?? "") : "", inputAmount: !rounded && calcType === "AMOUNT" ? (m.defaultValue ?? "") : "", isOverridden: false, overrideAmount: "", lineNumber: m.isProductwise ? String(fixedLineNumber ?? 1) : "", finalAmount: "" } : { termId: id, nature: undefined });
  };
  const remove = (i: number, fromRowMode = false) => {
    const nextTerms = terms.filter((_, k) => k !== i);
    onChange(nextTerms);
    if (fromRowMode) return;
    requestAnimationFrame(() => {
      const next = document.querySelector<HTMLElement>(`[data-field="T.${Math.min(i, nextTerms.length - 1)}.t"]:not(:disabled)`)
        ?? document.querySelector<HTMLElement>('[data-nav="add-term"]:not(:disabled)');
      next?.focus();
    });
  };
  const add = () => { onChange([...terms, blankTerm()]); setTimeout(() => document.querySelector<HTMLElement>(`[data-field="T.${terms.length}.t"]`)?.focus(), 40); };
  const fillTerms = (next: TermRow[] | null, i: number) => { if (!next) return; onChange(next.map((t, k) => (k === i ? { ...t, finalAmount: "" } : t))); clearError(...Object.keys(errors).filter((k) => k.startsWith(`T.${i}.`))); };
  const gridRows = useGridRows({
    count: terms.length, readOnly,
    firstCell: (grid, r) => grid.querySelector<HTMLElement>(`[data-field="T.${r}.t"]:not(:disabled)`),
    cellOf: (el) => { const m = /^T\.(\d+)\.(\w+)$/.exec(el.getAttribute("data-field") ?? ""); return m ? { row: Number(m[1]), col: m[2] } : null; },
    onRemove: remove,
    cellSelector: '[data-field^="T."]', fieldOf: (r, c) => `T.${r}.${c}`, endOfRow: "continue",
    onAddRow: add, lastRowBlank: () => isBlankTerm(terms[terms.length - 1]), leave: (el, dir) => focusStep(el, dir),
    onFillRow: (r) => fillTerms(fillDownRows(terms, [r], TERM_FILL), r),
    onFillCell: (r, col) => {
      const above = terms[r - 1];
      if (!above) return;
      if (col === "t") { if (above.termId) pick(r, above.termId); return; }
      const one: Partial<TermRow> | undefined = col === "l" ? { lineNumber: above.lineNumber } : col === "c" ? { calcType: above.calcType }
        : col === "v" ? (terms[r].calcType === "PERCENT" ? { rate: above.calcType === "PERCENT" ? above.rate : above.inputAmount } : { inputAmount: above.calcType === "PERCENT" ? above.rate : above.inputAmount })
        : col === "ov" ? { isOverridden: above.isOverridden } : col === "o" ? { overrideAmount: above.overrideAmount } : undefined;
      if (one) patch(r, { ...one, finalAmount: "" });
    },
  });
  const rowSel = gridRows.rowSel;
  const afterCombo = gridRows.afterCombo;

  return (
    <div className="lg-card lg-grid">
      <div className="lg-scroll overflow-x-auto focus-visible:outline-2 focus-visible:outline-cobalt-700" data-grid="terms" {...gridRows.gridProps} onKeyDown={gridRows.handleKey} aria-label="Billing terms; scroll horizontally to see all columns">
        <div className="min-w-max">
          <div style={{ gridTemplateColumns: TCOLS }} className="lg-th xl-head">
            <span className="xl-rowhead">#</span><span>Term</span><span className="text-right">Line</span><span>Calc</span><span className="text-right">Value</span><span className="text-center">Override</span><span className="text-right">Own amount</span><span className="text-right">Result</span><span></span>
          </div>
          {terms.map((t, i) => {
            const m = masters.get(t.termId);
            const off = readOnly;
            const auto = m?.category === "ROUNDED"; // Round Off: amount and sign are worked out from the document total
            const noOwn = m?.category === "ROUNDED" || m?.isEditable === false; // Round Off is automatic; a term the master marks not editable cannot take an own amount
            const bad = (c: string) => !!errors[`T.${i}.${c}`];
            const cls = (c: string, extra = "") => `fld h-8 ${extra} ${bad(c) ? "fld-err" : ""} ${off ? "bg-slate-100 text-slate-600" : ""}`;
            const msg = Object.entries(errors).find(([k, v]) => k.startsWith(`T.${i}.`) && v)?.[1];
            return (
              <div key={t.key} data-row={i} className={`border-b border-slate-100 transition-colors ${rowSel === i ? "bg-cobalt-50 ring-2 ring-inset ring-cobalt-700" : msg ? "bg-rose-50" : "hover:bg-slate-50/80"}`}>
                <div style={{ gridTemplateColumns: TCOLS }} data-selected={rowSel === i} className="xl-row">
                  <button type="button" className="xl-rowhead" {...gridRows.rowHeadProps(i)}>{i + 1}</button>
                  <MasterReferencePicker fieldName={`T.${i}.t`} label="Term" required scopeKey="terms" createMaster={{ key: "terms" }} contextKey={contextKey} placeholder="Choose term…" value={t.termId} hasError={bad("t")} options={opts} disabled={off} onChange={(v) => pick(i, v)} onCommit={afterCombo} />
                  <input data-field={`T.${i}.l`} disabled={off || fixedLineNumber !== undefined} inputMode="numeric" value={fixedLineNumber === undefined ? t.lineNumber : String(fixedLineNumber)} placeholder={m?.isProductwise ? "Line" : "—"} onChange={decOnly(INT, (v) => patch(i, { lineNumber: v }))} onFocus={(e) => e.currentTarget.select()} className={cls("l", "text-right tabular-nums")} aria-label={fixedLineNumber === undefined ? `Line number (1-${lineCount})` : `Line ${fixedLineNumber}`} />
                  <select data-field={`T.${i}.c`} disabled={off || !m || auto} value={t.calcType} onChange={(e) => patch(i, { calcType: e.target.value as TermRow["calcType"] })} className={cls("c")} aria-label="Calculated as">
                    <option value="PERCENT">Percent</option><option value="AMOUNT">Amount</option>
                  </select>
                  <input data-field={`T.${i}.v`} disabled={off || !m || auto} title={auto ? "Worked out automatically" : undefined} inputMode="decimal" autoComplete="off" placeholder={auto ? "Auto" : t.calcType === "PERCENT" ? "0.00 %" : "0.00"}
                    value={t.calcType === "PERCENT" ? t.rate : t.inputAmount} onChange={decOnly(RATE, (v) => patch(i, t.calcType === "PERCENT" ? { rate: v } : { inputAmount: v }))} onFocus={(e) => e.currentTarget.select()} className={cls("v", "text-right tabular-nums")} aria-label="Value" />
                  <label className="flex items-center justify-center gap-1 px-2 text-[12px]"><input data-field={`T.${i}.ov`} type="checkbox" disabled={off || !m || noOwn} checked={t.isOverridden && !noOwn} onChange={(e) => patch(i, { isOverridden: e.target.checked, overrideAmount: e.target.checked ? t.overrideAmount : "" })} /> use own</label>
                  <input data-field={`T.${i}.o`} disabled={off || !t.isOverridden} inputMode="decimal" autoComplete="off" placeholder="0.00" value={t.overrideAmount} onChange={decOnly(RATE, (v) => patch(i, { overrideAmount: v }))} onFocus={(e) => e.currentTarget.select()} className={cls("o", "text-right tabular-nums")} aria-label="Amount to use instead" />
                  {(() => {
                    const live = calculationPreview !== undefined;
                    const result = calculationPreview?.get(t.key);
                    const amount = live ? result?.finalAmount : t.finalAmount;
                    const nature = live ? result?.nature : t.nature ?? m?.nature;
                    const formula = result
                      ? `${auto ? `Live: ${money(result.baseAmount)} rounded ${m?.roundingMethod === "UP" ? "up" : m?.roundingMethod === "DOWN" ? "down" : "to the nearest rupee"} = ${money(result.calculatedAmount)}` : t.calcType === "PERCENT" ? `Live: base ${money(result.baseAmount)} × ${t.rate || "0"}% = ${money(result.calculatedAmount)}` : `Live: fixed amount ${money(t.inputAmount || "0")} = ${money(result.calculatedAmount)}`}${t.isOverridden && !noOwn ? `; using override ${money(t.overrideAmount)}` : ""}.`
                      : live ? (previewError || "Complete the bill inputs to calculate this term.") : "Calculated when the bill was last saved.";
                    const shown = amount !== undefined && amount !== "" ? `${nature === "DEDUCTIVE" ? "− " : "+ "}${money(amount)}` : "—";
                    return <span className="text-right tabular-nums text-slate-700" title={formula} aria-label={`${m?.name ?? "Billing term"}: ${shown}. ${formula}`}>{shown}</span>;
                  })()}
                  <button type="button" data-nav="remove-term" disabled={off} onClick={() => remove(i)} title="Remove term (Delete when the row is selected)" aria-label="Remove term" className="h-8 w-8 grid place-items-center rounded-md text-slate-400 hover:bg-rose-50 hover:text-rose-700 focus-visible:outline-2 focus-visible:outline-cobalt-700 disabled:opacity-30"><X size={14} /></button>
                </div>
                {msg && <p className="border-b border-slate-200 px-3 py-1 text-[12px] text-rose-700">{msg}</p>}
              </div>
            );
          })}
        </div>
      </div>
      {!readOnly && <div className="border-t border-slate-200 bg-slate-50 px-3 py-2.5"><button type="button" data-nav="add-term" className="btn" onClick={add}><Plus size={13} /> Add term</button></div>}
    </div>
  );
}
