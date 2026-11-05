import { useMemo } from "react";
import { Plus, X } from "lucide-react";
import type { PLookups } from "../../api";
import { blankLine, blankTerm, derivedQty, isBlankLine, isBlankTerm, lineAmount, trimDec, type LineKind, type LineRow, type Product, type Term, type TermRow } from "../../lib/purchaseForm";
import { fmtPaise, toPaise } from "../../lib/money";
import { MasterReferencePicker, type ReferenceOption } from "../MasterReferencePicker";
import { DateInput } from "../DateInput";
import { focusStep, money } from "./Bits";
import type { PreviewTermResult } from "../../../shared/purchase-preview";

type Errs = Record<string, string | undefined>;
const decOnly = (re: RegExp, set: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => { if (re.test(e.target.value)) set(e.target.value); };
const QTY = /^\d{0,12}(\.\d{0,6})?$/, RATE = /^\d{0,12}(\.\d{0,6})?$/, INT = /^\d{0,9}$/;

type ColKey = "n" | "p" | "aq" | "au" | "q" | "u" | "r" | "amt" | "terms" | "net" | "xd" | "lc" | "b" | "mf" | "ex" | "link" | "rm";
const COL_SIZE: Record<ColKey, string> = {
  n: "36px", p: "minmax(230px,1.6fr)", aq: "84px", au: "100px", q: "96px", u: "72px", r: "100px", amt: "124px",
  terms: "112px", net: "124px",
  xd: "140px", lc: "130px", b: "130px", mf: "150px", ex: "150px", link: "minmax(140px,1fr)", rm: "32px",
};
const COL_HEAD: Record<ColKey, string> = {
  n: "#", p: "Product", aq: "Alt Qty", au: "Alt Unit", q: "Quantity", u: "Unit", r: "Rate", amt: "Amount",
  terms: "Term Amount", net: "Net Amount",
  xd: "Expected", lc: "Location", b: "Batch", mf: "Mfg Date", ex: "Expiry", link: "Linked to", rm: "",
};
const RIGHT_HEAD = new Set(["Alt Qty", "Quantity", "Rate", "Amount", "Term Amount", "Net Amount"]);
const lineNet = (basic: string, terms: string) => {
  const signedTerms = terms.startsWith("-") ? -toPaise(terms.slice(1)) : toPaise(terms);
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format((toPaise(basic || "0") + signedTerms) / 100);
};

function lineColumns(kind: LineKind, showAlt: boolean, showLoc: boolean, showBatch: boolean, showExpiry: boolean, showLink: boolean, showTerms: boolean): ColKey[] {
  const cols: ColKey[] = ["n", "p"];
  if (showAlt) cols.push("aq", "au");
  cols.push("q", "u", "r", "amt");
  if (showTerms) cols.push("terms", "net");
  if (kind === "order") cols.push("xd");
  if (kind !== "order") {
    if (showLoc) cols.push("lc");
    if (showBatch) cols.push("b");
    if (showExpiry) cols.push("mf", "ex");
    if (showLink) cols.push("link");
  }
  cols.push("rm");
  return cols;
}

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
  contextKey: string;
  lockProducts?: boolean; // lines that came from a challan / order keep their product
  rateLabel?: string;
  onOpenTerms?: (index: number) => void;
  termSummary?: (index: number) => { amount: string; count: number };
}

export function LinesGrid({ kind, lines, onChange, lookups, products, readOnly, errors, calendar, clearError, contextKey, lockProducts, onOpenTerms, termSummary }: Props) {
  const unitCode = useMemo(() => new Map(lookups.units.map((u) => [u.id, u.code])), [lookups.units]);
  const productOpts = useMemo<ReferenceOption[]>(() => lookups.products.map((p) => ({ value: String(p.id), label: `${p.code} — ${p.description}`, code: p.code, name: p.description, detail: p.type.replaceAll("_", " "), searchText: `${p.type} ${p.tracksBatch ? "batch" : ""} ${p.tracksExpiry ? "expiry" : ""}`, isActive: p.isActive, badge: p.type === "STOCK" ? undefined : p.type.replace("_", " ").toLowerCase() })), [lookups.products]);
  const locOpts = useMemo<ReferenceOption[]>(() => lookups.locations.map((l) => ({ value: String(l.id), label: `${l.code} — ${l.name}`, code: l.code, name: l.name, isActive: l.isActive })), [lookups.locations]);
  // Only show extra columns when a line product actually needs them (keeps simple bills narrow).
  const layout = useMemo(() => {
    let showAlt = false, showLoc = false, showBatch = false, showExpiry = false, showLink = false;
    for (const row of lines) {
      const p = products.get(row.productId);
      if (!p) continue;
      if (p.alternateUnits?.length) showAlt = true;
      if (kind !== "order" && p.type === "STOCK") showLoc = true;
      if (kind !== "order" && p.tracksBatch) showBatch = true;
      if (kind !== "order" && p.tracksExpiry) showExpiry = true;
      if (kind !== "order" && row.link) showLink = true;
    }
    if (kind !== "order" && lines.some((row) => row.link)) showLink = true;
    const cols = lineColumns(kind, showAlt, showLoc, showBatch, showExpiry, showLink, kind === "bill" && !!onOpenTerms);
    return {
      cols,
      showAlt, showLoc, showBatch, showExpiry, showLink,
      template: cols.map((c) => COL_SIZE[c]).join(" "),
      heads: cols.map((c) => COL_HEAD[c]),
    };
  }, [kind, lines, products, onOpenTerms]);

  const patch = (i: number, p: Partial<LineRow>) => { onChange(lines.map((l, k) => (k === i ? { ...l, ...p } : l))); clearError(...Object.keys(errors).filter((k) => k.startsWith(`L.${i}.`)), "lines"); };
  const pick = (i: number, id: string) => {
    const p = products.get(id), l = lines[i];
    patch(i, {
      productId: id, altUnitId: "", altQty: "", unitId: "", batchNo: p?.tracksBatch ? l.batchNo : "", expiryDate: p?.tracksExpiry ? l.expiryDate : "", manufactureDate: p?.tracksExpiry ? l.manufactureDate : "",
      locationId: p?.type === "STOCK" ? l.locationId || (p.defaultLocationId ? String(p.defaultLocationId) : "") : "",
    });
  };
  const cells = (root: Element | null) => Array.from(root?.querySelectorAll<HTMLElement>('[data-field^="L."]') ?? []).filter((el) => !(el as HTMLInputElement).disabled && el.getClientRects().length > 0);
  const addRow = (focus = true) => {
    onChange([...lines, blankLine()]);
    if (focus) setTimeout(() => document.querySelector<HTMLElement>(`[data-field="L.${lines.length}.p"]`)?.focus(), 40);
  };
  const remove = (i: number) => {
    const n = lines.filter((_, k) => k !== i);
    onChange(n.length ? n : [blankLine()]);
    requestAnimationFrame(() => {
      const next = document.querySelector<HTMLElement>(`[data-field="L.${Math.min(i, n.length - 1)}.p"]:not(:disabled)`)
        ?? document.querySelector<HTMLElement>('[data-nav="add-line"]:not(:disabled)');
      next?.focus();
    });
  };

  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement, f = el.getAttribute("data-field") ?? "";
    const m = /^L\.(\d+)\.(\w+)$/.exec(f);
    if (!m) return;
    const i = Number(m[1]), col = m[2];
    if (e.key === "Enter" && el.getAttribute("role") !== "combobox") {
      const all = cells(e.currentTarget), at = all.indexOf(el);
      if (e.shiftKey) { e.preventDefault(); e.stopPropagation(); if (at > 0) { all[at - 1].focus(); all[at - 1].scrollIntoView({ block: "nearest", inline: "nearest" }); } else focusStep(el, -1); }
      else if (at < all.length - 1) { e.preventDefault(); e.stopPropagation(); all[at + 1].focus(); all[at + 1].scrollIntoView({ block: "nearest", inline: "nearest" }); }
      else if (!readOnly && !isBlankLine(lines[lines.length - 1])) { e.preventDefault(); e.stopPropagation(); addRow(); }
      else { e.preventDefault(); e.stopPropagation(); focusStep(el, 1); }
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
      <div className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-blue-700" data-grid="lines" onKeyDown={onKey} tabIndex={0} aria-label={`${kind} line items`}>
        <div className="min-w-max">
          <div style={{ gridTemplateColumns: layout.template }} className="grid gap-x-1 px-2 py-1 text-[11px] font-semibold text-slate-600 border-b border-slate-300 bg-slate-100">
            {layout.heads.map((h, i) => <span key={i} className={RIGHT_HEAD.has(h) ? "text-right pr-2" : ""}>{h}</span>)}
          </div>
          {lines.map((l, i) => {
            const p = products.get(l.productId);
            const useAlt = !!(l.altQty && l.altUnitId);
            const off = readOnly;
            const bad = (c: string) => !!errors[`L.${i}.${c}`];
            const cls = (c: string, extra = "") => `fld ${kind === "bill" ? "h-7" : "h-8"} ${extra} ${bad(c) ? "fld-err" : ""} ${off ? "bg-slate-100 text-slate-600" : ""}`;
            const altOpts: ReferenceOption[] = p ? p.alternateUnits.map((a) => ({ value: String(a.unitId), label: unitCode.get(a.unitId) ?? String(a.unitId), code: unitCode.get(a.unitId) ?? String(a.unitId), detail: `Alternate unit · factor ${a.conversionFactor}`, isActive: true })) : [];
            const unitOpts: ReferenceOption[] = lookups.units.map((u) => ({ value: String(u.id), label: `${u.code} — ${u.name}`, code: u.code, name: u.name, detail: `${u.decimalPlaces} decimal place${u.decimalPlaces === 1 ? "" : "s"}`, isActive: true }));
            const errMsgs = Object.entries(errors).filter(([k, v]) => k.startsWith(`L.${i}.`) && v).map(([, v]) => v!);
            const qtyShown = useAlt ? derivedQty(l, p) : l.qty;
            return (
              <div key={l.key} className={`border-b border-slate-200 ${errMsgs.length ? "bg-red-50" : ""}`}>
                <div style={{ gridTemplateColumns: layout.template }} className={`grid gap-x-1 px-2 ${kind === "bill" ? "py-0.5" : "py-1"} items-center`}>
                  <span className="text-slate-500 tabular-nums">{i + 1}</span>
                  <MasterReferencePicker fieldName={`L.${i}.p`} label="Product" required scopeKey="products" contextKey={contextKey} placeholder="Choose product…" value={l.productId} hasError={bad("p")} options={productOpts} disabled={off || (lockProducts && !!l.link)} onChange={(v) => pick(i, v)} onCommit={afterCombo} />
                  {layout.showAlt && (
                    <>
                      <input data-field={`L.${i}.aq`} disabled={off || !p || altOpts.length === 0} inputMode="decimal" autoComplete="off" value={l.altQty} placeholder={altOpts.length ? "" : "—"} onChange={decOnly(QTY, (v) => patch(i, { altQty: v }))} onFocus={(e) => e.currentTarget.select()} className={cls("aq", "text-right tabular-nums")} aria-label="Alternate quantity" />
                      <MasterReferencePicker fieldName={`L.${i}.au`} label="Alternate unit" scopeKey="product-units" contextKey={contextKey} placeholder={altOpts.length ? "Choose unit" : "—"} value={l.altUnitId} hasError={bad("au")} options={altOpts} disabled={off || !p || altOpts.length === 0} onChange={(v) => patch(i, { altUnitId: v })} onCommit={afterCombo} />
                    </>
                  )}
                  <input data-field={`L.${i}.q`} disabled={off || !p || useAlt} inputMode="decimal" autoComplete="off" value={useAlt ? trimDec(qtyShown) : l.qty} onChange={decOnly(QTY, (v) => patch(i, { qty: v }))} onFocus={(e) => e.currentTarget.select()} className={cls("q", `text-right tabular-nums ${useAlt ? "bg-slate-100" : ""}`)} aria-label="Quantity" />
                  {p && !p.baseUnitId
                    ? <MasterReferencePicker fieldName={`L.${i}.u`} label="Unit" required scopeKey="product-units" contextKey={contextKey} placeholder="Choose unit" value={l.unitId} hasError={bad("u")} options={unitOpts} disabled={off} onChange={(v) => patch(i, { unitId: v })} onCommit={afterCombo} />
                    : <span className="text-[12px] text-slate-600 pl-1">{p?.baseUnitId ? unitCode.get(p.baseUnitId) : ""}</span>}
                  <input data-field={`L.${i}.r`} disabled={off || !p} inputMode="decimal" autoComplete="off" value={l.rate} placeholder="0.00" onChange={decOnly(RATE, (v) => patch(i, { rate: v }))} onFocus={(e) => e.currentTarget.select()} className={cls("r", "text-right tabular-nums")} aria-label="Rate" />
                  <span className="text-right pr-2 tabular-nums font-medium">{money(lineAmount(l, p))}</span>
                  {kind === "bill" && onOpenTerms && (() => {
                    const summary = termSummary?.(i) ?? { amount: "0.00", count: 0 };
                    return <>
                      <button type="button" data-nav={`line-terms-${i}`} disabled={!l.productId}
                        onClick={() => onOpenTerms(i)} title={`Edit terms for line ${i + 1}${summary.count ? ` · ${summary.count} term${summary.count === 1 ? "" : "s"}` : ""}`}
                        className={`${kind === "bill" ? "h-7" : "h-8"} w-full px-1 text-right tabular-nums text-blue-700 underline underline-offset-2 hover:bg-blue-50 disabled:text-slate-500 disabled:no-underline`}>
                        {summary.amount.startsWith("-") ? `− ${money(summary.amount.slice(1))}` : money(summary.amount || "0")}{summary.count > 0 && <span className="ml-1 text-[10px] text-slate-500 no-underline">({summary.count})</span>}
                      </button>
                      <span className="text-right pr-2 tabular-nums font-medium">{lineNet(lineAmount(l, p), summary.amount)}</span>
                    </>;
                  })()}
                  {kind === "order" && (off
                    ? <input disabled className="fld h-8 bg-slate-100 text-slate-600" value={l.expectedDate} aria-label="Expected date" />
                    : <DateInput fieldName={`L.${i}.xd`} value={l.expectedDate} onChange={(v) => patch(i, { expectedDate: v })} calendar={calendar} hasError={bad("xd")} onBlurField={() => {}} compact />)}
                  {layout.showLoc && (
                    <MasterReferencePicker fieldName={`L.${i}.lc`} label="Location" required={p?.type === "STOCK"} scopeKey="locations" contextKey={contextKey} placeholder={p?.type === "STOCK" ? "Choose location" : "—"} value={l.locationId} hasError={bad("lc")} options={locOpts} disabled={off || p?.type !== "STOCK"} onChange={(v) => patch(i, { locationId: v })} onCommit={afterCombo} />
                  )}
                  {layout.showBatch && (
                    <input data-field={`L.${i}.b`} disabled={off || !p?.tracksBatch} maxLength={50} placeholder={p?.tracksBatch ? "Batch" : "—"} value={l.batchNo} onChange={(e) => patch(i, { batchNo: e.target.value })} onFocus={(e) => e.currentTarget.select()} className={cls("b", !p?.tracksBatch ? "bg-slate-100" : "")} aria-label="Batch no" />
                  )}
                  {layout.showExpiry && (
                    <>
                      <DateInput fieldName={`L.${i}.mf`} value={l.manufactureDate} onChange={(v) => patch(i, { manufactureDate: v })} calendar={calendar} hasError={bad("mf")} onBlurField={() => {}} compact disabled={off || !p?.tracksExpiry} />
                      <DateInput fieldName={`L.${i}.ex`} value={l.expiryDate} onChange={(v) => patch(i, { expiryDate: v })} calendar={calendar} hasError={bad("ex")} onBlurField={() => {}} compact disabled={off || !p?.tracksExpiry} />
                    </>
                  )}
                  {layout.showLink && <span className="text-[11px] text-slate-600 break-words leading-tight" title={l.link}>{l.link || "—"}</span>}
                  <button type="button" data-nav="remove-line" disabled={off} onClick={() => remove(i)} title="Remove line (Shift+Delete)" aria-label="Remove line" className={`${kind === "bill" ? "h-7 w-7" : "h-8 w-8"} grid place-items-center text-slate-500 hover:text-red-700 focus-visible:outline-2 focus-visible:outline-blue-700 disabled:opacity-30`}><X size={14} /></button>
                </div>
                {errMsgs.length > 0 && <p className="px-3 pb-1 text-[12px] text-red-700">{errMsgs[0]}</p>}
              </div>
            );
          })}
        </div>
      </div>
      {errors.lines && <p className="px-3 py-1 text-[12px] text-red-700">{errors.lines}</p>}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1.5 bg-slate-50 border-t border-slate-300">
        {!readOnly && <button type="button" data-nav="add-line" className="btn h-7" onClick={() => addRow()}><Plus size={13} /> Add line {kind === "bill" && <span className="kbd">F6</span>}</button>}
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
  contextKey: string;
  calculationPreview?: Map<string, PreviewTermResult>;
  previewError?: string;
  category?: "GENERAL" | "ADDITIONAL";
  productwiseOnly?: boolean;
  fixedLineNumber?: number;
}

// Billing terms: discount, VAT, freight ... The active preview is calculated by the same shared exact engine as the server.
export function TermsGrid({ terms, onChange, lookups, masters, lineCount, readOnly, errors, clearError, contextKey, calculationPreview, previewError, category, productwiseOnly, fixedLineNumber }: TProps) {
  const opts = useMemo<ReferenceOption[]>(() => lookups.terms.filter((t) => (!category || t.category === category) && (productwiseOnly === undefined || t.isProductwise === productwiseOnly)).map((t) => ({ value: String(t.id), label: `${t.code} — ${t.name}`, code: t.code, name: t.name, detail: `${t.category} · ${t.nature} · ${t.calcBase.replaceAll("_", " ")} · seq ${t.sequence}`, searchText: `${t.sequence} ${t.isProductwise ? "productwise" : "document"}`, isActive: t.isActive, badge: t.nature === "DEDUCTIVE" ? "less" : undefined })), [lookups.terms, category, productwiseOnly]);
  const patch = (i: number, p: Partial<TermRow>) => { onChange(terms.map((t, k) => (k === i ? { ...t, ...p } : t))); clearError(...Object.keys(errors).filter((k) => k.startsWith(`T.${i}.`))); };
  const pick = (i: number, id: string) => {
    const m = masters.get(id);
    patch(i, m ? { termId: id, nature: undefined, calcType: m.defaultCalcType, rate: m.defaultCalcType === "PERCENT" ? trimDec(m.defaultValue) : "", inputAmount: m.defaultCalcType === "AMOUNT" ? trimDec(m.defaultValue) : "", lineNumber: m.isProductwise ? String(fixedLineNumber ?? 1) : "", finalAmount: "" } : { termId: id, nature: undefined });
  };
  const remove = (i: number) => {
    const nextTerms = terms.filter((_, k) => k !== i);
    onChange(nextTerms);
    requestAnimationFrame(() => {
      const next = document.querySelector<HTMLElement>(`[data-field="T.${Math.min(i, nextTerms.length - 1)}.t"]:not(:disabled)`)
        ?? document.querySelector<HTMLElement>('[data-nav="add-term"]:not(:disabled)');
      next?.focus();
    });
  };
  const add = () => { onChange([...terms, blankTerm()]); setTimeout(() => document.querySelector<HTMLElement>(`[data-field="T.${terms.length}.t"]`)?.focus(), 40); };
  const cellsOf = (root: Element | null) => Array.from(root?.querySelectorAll<HTMLElement>('[data-field^="T."]') ?? []).filter((el) => !(el as HTMLInputElement).disabled && el.getClientRects().length > 0);
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement, m = /^T\.(\d+)\./.exec(el.getAttribute("data-field") ?? "");
    if (!m) return;
    if (e.key === "Delete" && e.shiftKey && !readOnly) { e.preventDefault(); e.stopPropagation(); remove(Number(m[1])); }
    else if (e.key === "Enter" && el.getAttribute("role") !== "combobox" && (el.tagName === "INPUT" || el.tagName === "SELECT")) {
      const all = cellsOf(e.currentTarget), at = all.indexOf(el);
      e.preventDefault(); e.stopPropagation();
      if (e.shiftKey) { if (at > 0) { all[at - 1].focus(); all[at - 1].scrollIntoView({ block: "nearest", inline: "nearest" }); } else focusStep(el, -1); }
      else if (at === all.length - 1 && !readOnly && !isBlankTerm(terms[terms.length - 1])) add();
      else if (at < all.length - 1) { all[at + 1].focus(); all[at + 1].scrollIntoView({ block: "nearest", inline: "nearest" }); }
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
            <span>#</span><span>Term</span><span>Line</span><span>Calculated as</span><span className="text-right pr-2">Rate % / Amount</span><span>Override</span><span className="text-right pr-2">Use amount</span><span className="text-right pr-2">{calculationPreview === undefined ? "Saved amount" : "Live amount"}</span><span />
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
                  <MasterReferencePicker fieldName={`T.${i}.t`} label="Billing term" required scopeKey="purchase-terms" contextKey={contextKey} placeholder="Choose term…" value={t.termId} hasError={bad("t")} options={opts} disabled={off} onChange={(v) => pick(i, v)} onCommit={afterCombo} />
                  <input data-field={`T.${i}.l`} disabled={off || !m?.isProductwise || fixedLineNumber !== undefined} inputMode="numeric" value={fixedLineNumber === undefined ? t.lineNumber : String(fixedLineNumber)} placeholder={m?.isProductwise ? "Line" : "—"} onChange={decOnly(INT, (v) => patch(i, { lineNumber: v }))} onFocus={(e) => e.currentTarget.select()} className={cls("l", "text-right tabular-nums")} aria-label={fixedLineNumber === undefined ? `Line number (1-${lineCount})` : `Line ${fixedLineNumber}`} />
                  <select data-field={`T.${i}.c`} disabled={off || !m} value={t.calcType} onChange={(e) => patch(i, { calcType: e.target.value as TermRow["calcType"] })} className={cls("c")} aria-label="Calculated as">
                    <option value="PERCENT">Percent (%)</option><option value="AMOUNT">Fixed amount</option>
                  </select>
                  <input data-field={`T.${i}.v`} disabled={off || !m} inputMode="decimal" autoComplete="off" placeholder={t.calcType === "PERCENT" ? "0.00 %" : "0.00"}
                    value={t.calcType === "PERCENT" ? t.rate : t.inputAmount} onChange={decOnly(RATE, (v) => patch(i, t.calcType === "PERCENT" ? { rate: v } : { inputAmount: v }))} onFocus={(e) => e.currentTarget.select()} className={cls("v", "text-right tabular-nums")} aria-label="Rate or amount" />
                  <label className="flex items-center gap-1 text-[12px]"><input data-field={`T.${i}.ov`} type="checkbox" disabled={off || !m} checked={t.isOverridden} onChange={(e) => patch(i, { isOverridden: e.target.checked, overrideAmount: e.target.checked ? t.overrideAmount : "" })} /> use own</label>
                  <input data-field={`T.${i}.o`} disabled={off || !t.isOverridden} inputMode="decimal" autoComplete="off" placeholder="0.00" value={t.overrideAmount} onChange={decOnly(RATE, (v) => patch(i, { overrideAmount: v }))} onFocus={(e) => e.currentTarget.select()} className={cls("o", "text-right tabular-nums")} aria-label="Amount to use instead" />
                  {(() => {
                    const live = calculationPreview !== undefined;
                    const result = calculationPreview?.get(t.key);
                    const amount = live ? result?.finalAmount : t.finalAmount;
                    const nature = live ? result?.nature : t.nature ?? m?.nature;
                    const formula = result
                      ? `${t.calcType === "PERCENT" ? `Live: base ${money(result.baseAmount)} × ${t.rate || "0"}% = ${money(result.calculatedAmount)}` : `Live: fixed amount ${money(t.inputAmount || "0")} = ${money(result.calculatedAmount)}`}${t.isOverridden ? `; using override ${money(t.overrideAmount)}` : ""}.`
                      : live ? (previewError || "Complete the bill inputs to calculate this term.") : "Calculated when the bill was last saved.";
                    const shown = amount !== undefined && amount !== "" ? `${nature === "DEDUCTIVE" ? "− " : "+ "}${money(amount)}` : "—";
                    return <span className="text-right pr-2 tabular-nums text-slate-700" title={formula} aria-label={`${m?.name ?? "Billing term"}: ${shown}. ${formula}`}>{shown}</span>;
                  })()}
        <button type="button" data-nav="remove-term" disabled={off} onClick={() => remove(i)} title="Remove term (Shift+Delete)" aria-label="Remove term" className="h-8 w-8 grid place-items-center text-slate-500 hover:text-red-700 focus-visible:outline-2 focus-visible:outline-blue-700 disabled:opacity-30"><X size={14} /></button>
                </div>
                {msg && <p className="px-3 pb-1 text-[12px] text-red-700">{msg}</p>}
              </div>
            );
          })}
        </div>
      </div>
      {!readOnly && <div className="px-2 py-1.5 bg-slate-50 border-t border-slate-300"><button type="button" data-nav="add-term" className="btn h-7" onClick={add}><Plus size={13} /> Add term</button></div>}
    </div>
  );
}
