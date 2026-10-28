import { useMemo } from "react";
import { Plus, X } from "lucide-react";
import type { PLookups } from "../../api";
import { blankLine, blankTerm, derivedQty, isBlankLine, isBlankTerm, lineAmount, trimDec, type LineKind, type LineRow, type Product, type Term, type TermRow } from "../../lib/purchaseForm";
import { fmtPaise, toPaise } from "../../lib/money";
import { Combobox, type ComboOption } from "../Combobox";
import { DateInput } from "../DateInput";
import { focusStep, money } from "./Bits";

type Errs = Record<string, string | undefined>;
const decOnly = (re: RegExp, set: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => { if (re.test(e.target.value)) set(e.target.value); };
const QTY = /^\d{0,12}(\.\d{0,6})?$/, RATE = /^\d{0,12}(\.\d{0,6})?$/, INT = /^\d{0,9}$/;

const COLS: Record<LineKind, string> = {
  order: "36px minmax(220px,1.6fr) 88px 92px 92px 72px 100px 120px 140px 32px",
  challan: "36px minmax(230px,1.6fr) 84px 100px 96px 72px 100px 124px 130px 130px 150px 150px minmax(140px,1fr) 32px",
  bill: "36px minmax(230px,1.6fr) 84px 100px 96px 72px 100px 124px 130px 130px 150px 150px minmax(140px,1fr) 32px",
};
const HEAD: Record<LineKind, string[]> = {
  order: ["#", "Product", "Alt Qty", "Alt Unit", "Quantity", "Unit", "Rate", "Amount", "Expected", ""],
  challan: ["#", "Product", "Alt Qty", "Alt Unit", "Quantity", "Unit", "Rate", "Amount", "Location", "Batch", "Mfg Date", "Expiry", "Linked to", ""],
  bill: ["#", "Product", "Alt Qty", "Alt Unit", "Quantity", "Unit", "Rate", "Amount", "Location", "Batch", "Mfg Date", "Expiry", "Linked to", ""],
};

interface Props {
  kind: LineKind;
  lines: LineRow[];
  onChange: (l: LineRow[]) => void;
  lookups: PLookups;
  products: Map<string, Product>;
  readOnly: boolean;
  errors: Errs;
  calendar: "BS" | "AD";
  clearError: (...k: string[]) => void;
  lockProducts?: boolean; // lines that came from a challan / order keep their product
  rateLabel?: string;
}

export function LinesGrid({ kind, lines, onChange, lookups, products, readOnly, errors, calendar, clearError, lockProducts }: Props) {
  const unitCode = useMemo(() => new Map(lookups.units.map((u) => [u.id, u.code])), [lookups.units]);
  const productOpts = useMemo<ComboOption[]>(() => lookups.products.filter((p) => p.isActive || lines.some((l) => l.productId === String(p.id))).map((p) => ({ value: String(p.id), label: `${p.code} — ${p.description}`, badge: p.type === "STOCK" ? undefined : p.type.replace("_", " ").toLowerCase() })), [lookups.products, lines]);
  const locOpts = useMemo<ComboOption[]>(() => lookups.locations.filter((l) => l.isActive).map((l) => ({ value: String(l.id), label: `${l.code} — ${l.name}` })), [lookups.locations]);

  const patch = (i: number, p: Partial<LineRow>) => { onChange(lines.map((l, k) => (k === i ? { ...l, ...p } : l))); clearError(...Object.keys(errors).filter((k) => k.startsWith(`L.${i}.`)), "lines"); };
  const pick = (i: number, id: string) => {
    const p = products.get(id), l = lines[i];
    patch(i, {
      productId: id, altUnitId: "", altQty: "", unitId: "", batchNo: p?.tracksBatch ? l.batchNo : "", expiryDate: p?.tracksExpiry ? l.expiryDate : "", manufactureDate: p?.tracksExpiry ? l.manufactureDate : "",
      locationId: p?.type === "STOCK" ? l.locationId || (p.defaultLocationId ? String(p.defaultLocationId) : "") : "",
    });
  };
  const cells = (root: Element | null) => Array.from(root?.querySelectorAll<HTMLElement>('[data-field^="L."]') ?? []).filter((el) => !(el as HTMLInputElement).disabled);
  const addRow = (focus = true) => {
    onChange([...lines, blankLine()]);
    if (focus) setTimeout(() => document.querySelector<HTMLElement>(`[data-field="L.${lines.length}.p"]`)?.focus(), 40);
  };
  const remove = (i: number) => { const n = lines.filter((_, k) => k !== i); onChange(n.length ? n : [blankLine()]); };

  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement, f = el.getAttribute("data-field") ?? "";
    const m = /^L\.(\d+)\.(\w+)$/.exec(f);
    if (!m) return;
    const i = Number(m[1]), col = m[2];
    if (e.key === "Enter" && el.getAttribute("role") !== "combobox") {
      const all = cells(e.currentTarget), at = all.indexOf(el);
      if (!e.shiftKey && at === all.length - 1 && !readOnly && !isBlankLine(lines[lines.length - 1])) { e.preventDefault(); e.stopPropagation(); addRow(); return; }
      if (e.shiftKey) { e.preventDefault(); e.stopPropagation(); if (at > 0) all[at - 1].focus(); else focusStep(el, -1); }
      else if (at < all.length - 1) { e.preventDefault(); e.stopPropagation(); all[at + 1].focus(); }
    } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && el.getAttribute("role") !== "combobox") {
      e.preventDefault();
      const dir = e.key === "ArrowDown" ? 1 : -1;
      for (let k = i + dir; k >= 0 && k < lines.length; k += dir) { const t = e.currentTarget.querySelector<HTMLInputElement>(`[data-field="L.${k}.${col}"]`); if (t && !t.disabled) { t.focus(); break; } }
    } else if (e.key === "Delete" && e.shiftKey && !readOnly) { e.preventDefault(); e.stopPropagation(); remove(i); }
  };
  const afterCombo = (el: HTMLInputElement, dir: 1 | -1 = 1) => {
    const all = cells(el.closest("[data-grid=lines]")), at = all.indexOf(el), next = all[at + dir];
    if (next) { next.focus(); next.scrollIntoView({ block: "nearest", inline: "nearest" }); }
    else focusStep(el, dir);
  };

  const total = lines.reduce((a, l) => a + toPaise(lineAmount(l, products.get(l.productId)) || "0"), 0);
  const live = lines.filter((l) => !isBlankLine(l)).length;

  return (
    <div className="border border-slate-400 bg-white/60">
      <div className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-blue-700" data-grid="lines" onKeyDown={onKey} tabIndex={0} aria-label={`${kind} line items; scroll horizontally to see all columns`}>
        <div className="min-w-max">
          <div style={{ gridTemplateColumns: COLS[kind] }} className="grid gap-x-1 px-2 py-1 text-[11px] font-semibold text-slate-600 border-b border-slate-300 bg-slate-100">
            {HEAD[kind].map((h, i) => <span key={i} className={["Alt Qty", "Quantity", "Rate", "Amount"].includes(h) ? "text-right pr-2" : ""}>{h}</span>)}
          </div>
          {lines.map((l, i) => {
            const p = products.get(l.productId);
            const useAlt = !!(l.altQty && l.altUnitId);
            const off = readOnly;
            const bad = (c: string) => !!errors[`L.${i}.${c}`];
            const cls = (c: string, extra = "") => `fld h-8 ${extra} ${bad(c) ? "fld-err" : ""} ${off ? "bg-slate-100 text-slate-600" : ""}`;
            const altOpts: ComboOption[] = p ? p.alternateUnits.map((a) => ({ value: String(a.unitId), label: unitCode.get(a.unitId) ?? String(a.unitId) })) : [];
            const unitOpts: ComboOption[] = lookups.units.map((u) => ({ value: String(u.id), label: u.code }));
            const errMsgs = Object.entries(errors).filter(([k, v]) => k.startsWith(`L.${i}.`) && v).map(([, v]) => v!);
            const qtyShown = useAlt ? derivedQty(l, p) : l.qty;
            const tracked = kind !== "order";
            return (
              <div key={l.key} className={`border-b border-slate-200 ${errMsgs.length ? "bg-red-50" : ""}`}>
                <div style={{ gridTemplateColumns: COLS[kind] }} className="grid gap-x-1 px-2 py-1 items-center">
                  <span className="text-slate-500 tabular-nums">{i + 1}</span>
                  <Combobox fieldName={`L.${i}.p`} placeholder="Product…" value={l.productId} hasError={bad("p")} options={productOpts} disabled={off || (lockProducts && !!l.link)} onChange={(v) => pick(i, v)} onCommit={afterCombo} />
                  <input data-field={`L.${i}.aq`} disabled={off || !p || altOpts.length === 0} inputMode="decimal" autoComplete="off" value={l.altQty} placeholder={altOpts.length ? "" : "—"} onChange={decOnly(QTY, (v) => patch(i, { altQty: v }))} onFocus={(e) => e.currentTarget.select()} className={cls("aq", "text-right tabular-nums")} aria-label="Alternate quantity" />
                  <Combobox fieldName={`L.${i}.au`} placeholder={altOpts.length ? "Unit" : "—"} value={l.altUnitId} hasError={bad("au")} options={altOpts} disabled={off || !p || altOpts.length === 0} onChange={(v) => patch(i, { altUnitId: v })} onCommit={afterCombo} />
                  <input data-field={`L.${i}.q`} disabled={off || !p || useAlt} inputMode="decimal" autoComplete="off" value={useAlt ? trimDec(qtyShown) : l.qty} onChange={decOnly(QTY, (v) => patch(i, { qty: v }))} onFocus={(e) => e.currentTarget.select()} className={cls("q", `text-right tabular-nums ${useAlt ? "bg-slate-100" : ""}`)} aria-label="Quantity" />
                  {p && !p.baseUnitId
                    ? <Combobox fieldName={`L.${i}.u`} placeholder="Unit" value={l.unitId} hasError={bad("u")} options={unitOpts} disabled={off} onChange={(v) => patch(i, { unitId: v })} onCommit={afterCombo} />
                    : <span className="text-[12px] text-slate-600 pl-1">{p?.baseUnitId ? unitCode.get(p.baseUnitId) : ""}</span>}
                  <input data-field={`L.${i}.r`} disabled={off || !p} inputMode="decimal" autoComplete="off" value={l.rate} placeholder="0.00" onChange={decOnly(RATE, (v) => patch(i, { rate: v }))} onFocus={(e) => e.currentTarget.select()} className={cls("r", "text-right tabular-nums")} aria-label="Rate" />
                  <span className="text-right pr-2 tabular-nums font-medium">{money(lineAmount(l, p))}</span>
                  {kind === "order" && (off
                    ? <input disabled className="fld h-8 bg-slate-100 text-slate-600" value={l.expectedDate} aria-label="Expected date" />
                    : <DateInput fieldName={`L.${i}.xd`} value={l.expectedDate} onChange={(v) => patch(i, { expectedDate: v })} calendar={calendar} hasError={bad("xd")} onBlurField={() => {}} compact />)}
                  {tracked && (
                    <>
                      <Combobox fieldName={`L.${i}.lc`} placeholder={p?.type === "STOCK" ? "Location" : "—"} value={l.locationId} hasError={bad("lc")} options={locOpts} disabled={off || p?.type !== "STOCK"} onChange={(v) => patch(i, { locationId: v })} onCommit={afterCombo} />
                      <input data-field={`L.${i}.b`} disabled={off || !p?.tracksBatch} maxLength={50} placeholder={p?.tracksBatch ? "Batch" : "—"} value={l.batchNo} onChange={(e) => patch(i, { batchNo: e.target.value })} onFocus={(e) => e.currentTarget.select()} className={cls("b", !p?.tracksBatch ? "bg-slate-100" : "")} aria-label="Batch no" />
                      <DateInput fieldName={`L.${i}.mf`} value={l.manufactureDate} onChange={(v) => patch(i, { manufactureDate: v })} calendar={calendar} hasError={bad("mf")} onBlurField={() => {}} compact disabled={off || !p?.tracksExpiry} />
                      <DateInput fieldName={`L.${i}.ex`} value={l.expiryDate} onChange={(v) => patch(i, { expiryDate: v })} calendar={calendar} hasError={bad("ex")} onBlurField={() => {}} compact disabled={off || !p?.tracksExpiry} />
                      <span className="text-[11px] text-slate-600 break-words leading-tight" title={l.link}>{l.link || "—"}</span>
                    </>
                  )}
                  <button type="button" tabIndex={-1} disabled={off} onClick={() => remove(i)} title="Remove line (Shift+Delete)" aria-label="Remove line" className="h-8 grid place-items-center text-slate-500 hover:text-red-700 disabled:opacity-30"><X size={14} /></button>
                </div>
                {errMsgs.length > 0 && <p className="px-3 pb-1 text-[12px] text-red-700">{errMsgs[0]}</p>}
              </div>
            );
          })}
        </div>
      </div>
      {errors.lines && <p className="px-3 py-1 text-[12px] text-red-700">{errors.lines}</p>}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1.5 bg-slate-50 border-t border-slate-300">
        {!readOnly && <button type="button" className="btn h-7" onClick={() => addRow()}><Plus size={13} /> Add line</button>}
        <span className="flex-1" />
        <span className="text-[12px]">Lines <b className="tabular-nums">{live}</b></span>
        <span className="text-[12px]">Basic Amount <b className="tabular-nums ml-1">{fmtPaise(total)}</b></span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
const TCOLS = "36px minmax(220px,1.5fr) 84px 120px 120px 92px 120px 120px 32px";

interface TProps {
  terms: TermRow[];
  onChange: (t: TermRow[]) => void;
  lookups: PLookups;
  masters: Map<string, Term>;
  lineCount: number;
  readOnly: boolean;
  errors: Errs;
  clearError: (...k: string[]) => void;
  category?: "GENERAL" | "ADDITIONAL";
}

// Billing terms: discount, VAT, freight ... Percent of the basic amount (or of earlier terms) or a fixed amount. The server does the arithmetic;
// "Computed" shows what it worked out the last time the document was saved.
export function TermsGrid({ terms, onChange, lookups, masters, lineCount, readOnly, errors, clearError, category }: TProps) {
  const opts = useMemo<ComboOption[]>(() => lookups.terms.filter((t) => (!category || t.category === category) && (t.isActive || terms.some((r) => r.termId === String(t.id)))).map((t) => ({ value: String(t.id), label: `${t.code} — ${t.name}`, badge: t.nature === "DEDUCTIVE" ? "less" : undefined })), [lookups.terms, terms, category]);
  const patch = (i: number, p: Partial<TermRow>) => { onChange(terms.map((t, k) => (k === i ? { ...t, ...p } : t))); clearError(...Object.keys(errors).filter((k) => k.startsWith(`T.${i}.`))); };
  const pick = (i: number, id: string) => {
    const m = masters.get(id);
    patch(i, m ? { termId: id, calcType: m.defaultCalcType, rate: m.defaultCalcType === "PERCENT" ? trimDec(m.defaultValue) : "", inputAmount: m.defaultCalcType === "AMOUNT" ? trimDec(m.defaultValue) : "", lineNumber: m.isProductwise ? "1" : "", finalAmount: "" } : { termId: id });
  };
  const remove = (i: number) => onChange(terms.filter((_, k) => k !== i));
  const add = () => { onChange([...terms, blankTerm()]); setTimeout(() => document.querySelector<HTMLElement>(`[data-field="T.${terms.length}.t"]`)?.focus(), 40); };
  const cellsOf = (root: Element | null) => Array.from(root?.querySelectorAll<HTMLElement>('[data-field^="T."]') ?? []).filter((el) => !(el as HTMLInputElement).disabled);
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement, m = /^T\.(\d+)\./.exec(el.getAttribute("data-field") ?? "");
    if (!m) return;
    if (e.key === "Delete" && e.shiftKey && !readOnly) { e.preventDefault(); e.stopPropagation(); remove(Number(m[1])); }
    else if (e.key === "Enter" && el.getAttribute("role") !== "combobox" && (el.tagName === "INPUT" || el.tagName === "SELECT")) {
      const all = cellsOf(e.currentTarget), at = all.indexOf(el);
      e.preventDefault(); e.stopPropagation();
      if (e.shiftKey) { if (at > 0) all[at - 1].focus(); else focusStep(el, -1); }
      else if (at === all.length - 1 && !readOnly && !isBlankTerm(terms[terms.length - 1])) add();
      else if (at < all.length - 1) all[at + 1].focus();
      else focusStep(el, 1);
    }
  };
  const afterCombo = (el: HTMLInputElement, dir: 1 | -1 = 1) => {
    const all = cellsOf(el.closest("[data-grid=terms]")), at = all.indexOf(el), next = all[at + dir];
    if (next) { next.focus(); next.scrollIntoView({ block: "nearest", inline: "nearest" }); }
    else focusStep(el, dir);
  };

  return (
    <div className="border border-slate-400 bg-white/60">
      <div className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-blue-700" data-grid="terms" onKeyDown={onKey} tabIndex={0} aria-label="Billing terms; scroll horizontally to see all columns">
        <div className="min-w-max">
          <div style={{ gridTemplateColumns: TCOLS }} className="grid gap-x-1 px-2 py-1 text-[11px] font-semibold text-slate-600 border-b border-slate-300 bg-slate-100">
            <span>#</span><span>Term</span><span>Line</span><span>Calculated as</span><span className="text-right pr-2">Rate % / Amount</span><span>Override</span><span className="text-right pr-2">Use amount</span><span className="text-right pr-2">Computed</span><span />
          </div>
          {terms.length === 0 && <p className="px-3 py-2 text-[12px] text-slate-500">No billing terms. {!readOnly && "Add a discount, VAT, freight … if the document has any."}</p>}
          {terms.map((t, i) => {
            const m = masters.get(t.termId);
            const off = readOnly;
            const bad = (c: string) => !!errors[`T.${i}.${c}`];
            const cls = (c: string, extra = "") => `fld h-8 ${extra} ${bad(c) ? "fld-err" : ""} ${off ? "bg-slate-100 text-slate-600" : ""}`;
            const msg = Object.entries(errors).find(([k, v]) => k.startsWith(`T.${i}.`) && v)?.[1];
            return (
              <div key={t.key} className={`border-b border-slate-200 ${msg ? "bg-red-50" : ""}`}>
                <div style={{ gridTemplateColumns: TCOLS }} className="grid gap-x-1 px-2 py-1 items-center">
                  <span className="text-slate-500 tabular-nums">{i + 1}</span>
                  <Combobox fieldName={`T.${i}.t`} placeholder="Term…" value={t.termId} hasError={bad("t")} options={opts} disabled={off} onChange={(v) => pick(i, v)} onCommit={afterCombo} />
                  <input data-field={`T.${i}.l`} disabled={off || !m?.isProductwise} inputMode="numeric" value={t.lineNumber} placeholder={m?.isProductwise ? "Line" : "—"} onChange={decOnly(INT, (v) => patch(i, { lineNumber: v }))} onFocus={(e) => e.currentTarget.select()} className={cls("l", "text-right tabular-nums")} aria-label={`Line number (1-${lineCount})`} />
                  <select data-field={`T.${i}.c`} disabled={off || !m} value={t.calcType} onChange={(e) => patch(i, { calcType: e.target.value as TermRow["calcType"] })} className={cls("c")} aria-label="Calculated as">
                    <option value="PERCENT">Percent (%)</option><option value="AMOUNT">Fixed amount</option>
                  </select>
                  <input data-field={`T.${i}.v`} disabled={off || !m} inputMode="decimal" autoComplete="off" placeholder={t.calcType === "PERCENT" ? "0.00 %" : "0.00"}
                    value={t.calcType === "PERCENT" ? t.rate : t.inputAmount} onChange={decOnly(RATE, (v) => patch(i, t.calcType === "PERCENT" ? { rate: v } : { inputAmount: v }))} onFocus={(e) => e.currentTarget.select()} className={cls("v", "text-right tabular-nums")} aria-label="Rate or amount" />
                  <label className="flex items-center gap-1 text-[12px]"><input data-field={`T.${i}.ov`} type="checkbox" disabled={off || !m} checked={t.isOverridden} onChange={(e) => patch(i, { isOverridden: e.target.checked, overrideAmount: e.target.checked ? t.overrideAmount : "" })} /> use own</label>
                  <input data-field={`T.${i}.o`} disabled={off || !t.isOverridden} inputMode="decimal" autoComplete="off" placeholder="0.00" value={t.overrideAmount} onChange={decOnly(RATE, (v) => patch(i, { overrideAmount: v }))} onFocus={(e) => e.currentTarget.select()} className={cls("o", "text-right tabular-nums")} aria-label="Amount to use instead" />
                  <span className="text-right pr-2 tabular-nums text-slate-700" title="Worked out by the server when the document was last saved">{t.finalAmount ? `${m?.nature === "DEDUCTIVE" ? "− " : ""}${money(t.finalAmount)}` : ""}</span>
                  <button type="button" tabIndex={-1} disabled={off} onClick={() => remove(i)} title="Remove term (Shift+Delete)" aria-label="Remove term" className="h-8 grid place-items-center text-slate-500 hover:text-red-700 disabled:opacity-30"><X size={14} /></button>
                </div>
                {msg && <p className="px-3 pb-1 text-[12px] text-red-700">{msg}</p>}
              </div>
            );
          })}
        </div>
      </div>
      {!readOnly && <div className="px-2 py-1.5 bg-slate-50 border-t border-slate-300"><button type="button" className="btn h-7" onClick={add}><Plus size={13} /> Add term</button></div>}
    </div>
  );
}
