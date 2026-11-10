import { useMemo, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import type { PLookups } from "../../api";
import { blankLine, blankTerm, derivedQty, isBlankLine, isBlankTerm, lineAmount, pickableTerms, trimDec, type LineKind, type LineRow, type Product, type Term, type TermRow } from "../../lib/purchaseForm";
import { fmtPaise, toPaise } from "../../lib/money";
import { fillDownRows } from "../../lib/tableKinds";
import { useGridRows } from "../table/useGridRows";
import { MasterReferencePicker, type ReferenceOption } from "../MasterReferencePicker";
import { DateInput } from "../DateInput";
import { BatchDialog, hasBatch } from "./BatchDialog";
import { focusStep, money } from "./Bits";
import type { PreviewTermResult } from "../../../shared/purchase-preview";

type Errs = Record<string, string | undefined>;
const decOnly = (re: RegExp, set: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => { if (re.test(e.target.value)) set(e.target.value); };
const QTY = /^\d{0,12}(\.\d{0,6})?$/, RATE = /^\d{0,12}(\.\d{0,6})?$/, INT = /^\d{0,9}$/;

type ColKey = "n" | "p" | "aq" | "au" | "q" | "u" | "r" | "amt" | "terms" | "net" | "xd" | "lc" | "b" | "mf" | "ex" | "link" | "rm";
const COL_SIZE: Record<ColKey, string> = {
  n: "24px", p: "minmax(150px,1.6fr)", aq: "64px", au: "84px", q: "78px", u: "44px", r: "84px", amt: "100px",
  terms: "92px", net: "104px",
  xd: "132px", lc: "120px", b: "112px", mf: "128px", ex: "128px", link: "minmax(130px,1fr)", rm: "30px",
};
const COL_HEAD: Record<ColKey, string> = {
  n: "#", p: "Product", aq: "Alt Qty", au: "Alt Unit", q: "Quantity", u: "Unit", r: "Rate", amt: "Amount",
  terms: "Term Amount", net: "Net Amount",
  xd: "Expected", lc: "Location", b: "Batch", mf: "Mfg Date", ex: "Expiry", link: "Linked to", rm: "",
};
// Excel's alignment: numbers and dates right, text left. (Headers follow their column.)
const CENTER_HEAD = new Set(["Batch"]); // a Yes / No cell is a boolean: centred
const RIGHT_HEAD = new Set(["Alt Qty", "Quantity", "Rate", "Amount", "Term Amount", "Net Amount", "Expected", "Mfg Date", "Expiry"]);
// Ctrl+D: which fields of a line are copied from the line above, and which field a cell column stands for. Never the key or the links to an order / challan.
const FILL_FIELDS: (keyof LineRow)[] = ["productId", "altQty", "altUnitId", "qty", "unitId", "rate", "locationId", "batchNo", "manufactureDate", "expiryDate", "expectedDate"];
const LOCKED_FILL_FIELDS: (keyof LineRow)[] = ["rate"]; // a line that came from an order / challan keeps its product, so only the price is copied
const FIELD_OF: Partial<Record<string, keyof LineRow>> = { p: "productId", aq: "altQty", au: "altUnitId", q: "qty", u: "unitId", r: "rate", xd: "expectedDate", lc: "locationId", b: "batchNo", mf: "manufactureDate", ex: "expiryDate" };
const lineNet = (basic: string, terms: string) => {
  const signedTerms = terms.startsWith("-") ? -toPaise(terms.slice(1)) : toPaise(terms);
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format((toPaise(basic || "0") + signedTerms) / 100);
};

function lineColumns(kind: LineKind, showAlt: boolean, showLoc: boolean, showBatch: boolean, showExpiry: boolean, showLink: boolean, showTerms: boolean): ColKey[] {
  const cols: ColKey[] = ["n", "p"];
  if (showAlt) cols.push("aq", "au");
  cols.push("q", "u", "r", "amt");
  if (kind === "bill") {
    // Purchase bill: terms, location, ONE batch column (Yes / No, opens a dialog), the link, and Net amount always last.
    if (showTerms) cols.push("terms");
    if (showLoc) cols.push("lc");
    if (showBatch || showExpiry) cols.push("b");
    if (showLink) cols.push("link");
    if (showTerms) cols.push("net");
    cols.push("rm");
    return cols;
  }
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
  fill?: boolean; // take the height of the parent and scroll the rows inside it (the fixed bill entry screen)
}

export function LinesGrid({ kind, lines, onChange, lookups, products, readOnly, errors, calendar, clearError, contextKey, lockProducts, onOpenTerms, termSummary, fill }: Props) {
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
      // an empty rate takes the product's purchase rate; a rate already typed stays
      rate: l.rate || (kind !== "challan" && p?.purchaseRate && Number(p.purchaseRate) > 0 ? String(Number(p.purchaseRate)) : ""),
      locationId: p?.type === "STOCK" ? l.locationId || (p.defaultLocationId ? String(p.defaultLocationId) : "") : "",
    });
  };
  const cells = (root: Element | null) => Array.from(root?.querySelectorAll<HTMLElement>('[data-field^="L."]') ?? []).filter((el) => !(el as HTMLInputElement).disabled && el.getClientRects().length > 0);
  const addRow = (focus = true) => {
    onChange([...lines, blankLine()]);
    if (focus) setTimeout(() => document.querySelector<HTMLElement>(`[data-field="L.${lines.length}.p"]`)?.focus(), 40);
  };
  // fromRowMode: Delete on the selected row (the grid keeps the focus); otherwise (Shift+Delete in a cell, the X button) focus goes to a neighbouring line.
  const remove = (i: number, fromRowMode = false) => {
    const n = lines.filter((_, k) => k !== i);
    onChange(n.length ? n : [blankLine()]);
    if (fromRowMode) return;
    requestAnimationFrame(() => {
      const next = document.querySelector<HTMLElement>(`[data-field="L.${Math.min(i, n.length - 1)}.p"]:not(:disabled)`)
        ?? document.querySelector<HTMLElement>('[data-nav="add-line"]:not(:disabled)');
      next?.focus();
    });
  };

  // Ctrl+D: the row (or the cell) above is copied into this one.
  const commitFill = (next: LineRow[] | null, i: number) => { if (!next) return; onChange(next); clearError(...Object.keys(errors).filter((k) => k.startsWith(`L.${i}.`)), "lines"); };
  const fillRow = (i: number) => {
    if (readOnly || i < 1) return;
    commitFill(fillDownRows(lines, [i], lockProducts && lines[i].link ? LOCKED_FILL_FIELDS : FILL_FIELDS), i);
  };
  const fillCell = (i: number, col: string) => {
    const f = FIELD_OF[col], above = lines[i - 1];
    if (readOnly || !f || !above || (f === "productId" && lockProducts && lines[i].link)) return;
    if (col === "b" && kind === "bill") { patch(i, { batchNo: above.batchNo, manufactureDate: above.manufactureDate, expiryDate: above.expiryDate }); return; } // the whole batch dialog
    if (f === "productId") { if (above.productId) pick(i, above.productId); return; } // choosing a product also resets what depends on it
    patch(i, { [f]: above[f] } as Partial<LineRow>);
  };

  const [batchFor, setBatchFor] = useState<number | null>(null); // purchase bill: the line whose batch dialog is open
  // The keyboard flow (row mode, Enter walking the cells, arrows, Delete, Ctrl+D) is the shared useGridRows hook, the same as every other grid.
  const rowOf = (el: Element) => { const m = /^L\.(\d+)\./.exec(el.getAttribute("data-field") ?? ""); return m ? Number(m[1]) : -1; };
  const gridRows = useGridRows({
    count: lines.length, readOnly,
    firstCell: (grid, r) => cells(grid).find((c) => rowOf(c) === r) ?? null,
    cellOf: (el) => { const m = /^L\.(\d+)\.(\w+)$/.exec(el.getAttribute("data-field") ?? ""); return m ? { row: Number(m[1]), col: m[2] } : null; },
    onRemove: remove, onFillRow: fillRow, onFillCell: fillCell,
    cellSelector: '[data-field^="L."]', fieldOf: (r, c) => `L.${r}.${c}`, endOfRow: "row",
    onAddRow: () => addRow(), lastRowBlank: () => isBlankLine(lines[lines.length - 1]), leave: (el, dir) => focusStep(el, dir),
    onCellEnter: (cell) => { if (cell.col === "b" && kind === "bill") { setBatchFor(cell.row); return true; } return false; },
  });
  const rowSel = gridRows.rowSel;
  const afterCombo = gridRows.afterCombo;

  // Enter on the empty Product cell of a blank row = leave the table, to the first field after it (skipping "Add line").
  // A blank last row (usually the one Enter just created) is dropped again; it is not a real line.
  const leaveTable = (el: HTMLElement, i: number) => {
    const addLine = el.closest("[data-grid=lines]")?.parentElement?.querySelector<HTMLElement>('[data-nav="add-line"]:not(:disabled)');
    if (!focusStep(addLine ?? el, 1)) return;
    if (i === lines.length - 1 && lines.length > 1) { onChange(lines.slice(0, -1)); clearError(...Object.keys(errors).filter((k) => k.startsWith(`L.${i}.`)), "lines"); }
  };
  // Runs before the picker's own Enter handler (capture phase), because the picker would otherwise open its dialog for a required empty field.
  const onKeyCapture = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Enter" || e.shiftKey || readOnly) return;
    const el = e.target as HTMLElement, m = /^L\.(\d+)\.p$/.exec(el.getAttribute("data-field") ?? "");
    if (!m || !isBlankLine(lines[Number(m[1])])) return;
    e.preventDefault(); e.stopPropagation();
    leaveTable(el, Number(m[1]));
  };


  const total = lines.reduce((a, l) => a + toPaise(lineAmount(l, products.get(l.productId)) || "0"), 0);
  const live = lines.filter((l) => !isBlankLine(l)).length;

  return (
    <div className={`lg-card lg-grid ${fill ? "flex min-h-0 flex-1 flex-col" : ""}`}>
      <div className={`${fill ? "min-h-0 flex-1 overflow-auto" : "overflow-x-auto"} lg-scroll outline-none`} data-grid="lines" data-nav="lines-grid" {...gridRows.gridProps} onKeyDown={gridRows.handleKey} onKeyDownCapture={onKeyCapture} aria-label={`${kind} line items`}>
        <div className="min-w-max">
          <div style={{ gridTemplateColumns: layout.template }} className="lg-th xl-head">
            {layout.heads.map((h, i) => <span key={i} className={i === 0 ? "xl-rowhead" : RIGHT_HEAD.has(h) ? "text-right" : kind === "bill" && CENTER_HEAD.has(h) ? "text-center" : ""}>{h}</span>)}
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
              <div key={l.key} data-row={i} className={`border-b border-slate-100 transition-colors ${rowSel === i ? "bg-cobalt-50 ring-2 ring-inset ring-cobalt-700" : errMsgs.length ? "bg-rose-50" : "hover:bg-slate-50/80"}`}>
                <div style={{ gridTemplateColumns: layout.template }} data-selected={rowSel === i} className="xl-row">
                  <button type="button" className="xl-rowhead" {...gridRows.rowHeadProps(i)}>{i + 1}</button>
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
                    : <span className="text-[12px] text-slate-600">{p?.baseUnitId ? unitCode.get(p.baseUnitId) : ""}</span>}
                  <input data-field={`L.${i}.r`} disabled={off || !p} inputMode="decimal" autoComplete="off" value={l.rate} placeholder="0.00" onChange={decOnly(RATE, (v) => patch(i, { rate: v }))} onFocus={(e) => e.currentTarget.select()} className={cls("r", "text-right tabular-nums")} aria-label="Rate" />
                  <span className="text-right tabular-nums font-medium">{money(lineAmount(l, p))}</span>
                  {kind === "bill" && onOpenTerms && (() => {
                    const summary = termSummary?.(i) ?? { amount: "0.00", count: 0 };
                    return <>
                      <button type="button" data-nav={`line-terms-${i}`} disabled={!l.productId}
                        onClick={() => onOpenTerms(i)} title={`Edit terms for line ${i + 1}${summary.count ? ` · ${summary.count} term${summary.count === 1 ? "" : "s"}` : ""}`}
                        className={`${kind === "bill" ? "h-7" : "h-8"} w-full px-1 text-right tabular-nums text-cobalt-700 underline decoration-cobalt-200 underline-offset-4 hover:bg-cobalt-50 disabled:text-slate-500 disabled:no-underline`}>
                        {summary.amount.startsWith("-") ? `− ${money(summary.amount.slice(1))}` : money(summary.amount || "0")}{summary.count > 0 && <span className="ml-1 text-[10px] text-slate-500 no-underline">({summary.count})</span>}
                      </button>
                    </>;
                  })()}
                  {kind === "order" && (off
                    ? <input disabled className="fld h-8 bg-slate-100 text-right text-slate-600" value={l.expectedDate} aria-label="Expected date" />
                    : <DateInput fieldName={`L.${i}.xd`} value={l.expectedDate} onChange={(v) => patch(i, { expectedDate: v })} calendar={calendar} hasError={bad("xd")} onBlurField={() => {}} compact />)}
                  {layout.showLoc && (
                    <MasterReferencePicker fieldName={`L.${i}.lc`} label="Location" required={p?.type === "STOCK"} scopeKey="locations" contextKey={contextKey} placeholder={p?.type === "STOCK" ? "Choose location" : "—"} value={l.locationId} hasError={bad("lc")} options={locOpts} disabled={off || p?.type !== "STOCK"} onChange={(v) => patch(i, { locationId: v })} onCommit={afterCombo} />
                  )}
                  {kind === "bill" && (layout.showBatch || layout.showExpiry) && (() => {
                    const tracked = !!(p?.tracksBatch || p?.tracksExpiry), yes = hasBatch(l);
                    return (
                      <button type="button" data-field={`L.${i}.b`} disabled={!tracked || (off && !yes)} onClick={() => setBatchFor(i)} aria-label={`Batch details: ${yes ? "yes" : "no"}`} title={tracked ? "Batch no, mfg and expiry (Enter)" : "This product has no batch"}
                        className={`${cls("b", "")} text-center ${!tracked ? "bg-slate-100 text-slate-400" : yes ? "font-medium text-emerald-700" : bad("b") ? "text-rose-700" : "text-slate-500"}`}>
                        {tracked ? (yes ? "Yes" : "No") : "—"}
                      </button>
                    );
                  })()}
                  {kind !== "bill" && layout.showBatch && (
                    <input data-field={`L.${i}.b`} disabled={off || !p?.tracksBatch} maxLength={50} placeholder={p?.tracksBatch ? "Batch" : "—"} value={l.batchNo} onChange={(e) => patch(i, { batchNo: e.target.value })} onFocus={(e) => e.currentTarget.select()} className={cls("b", !p?.tracksBatch ? "bg-slate-100" : "")} aria-label="Batch no" />
                  )}
                  {kind !== "bill" && layout.showExpiry && (
                    <>
                      <DateInput fieldName={`L.${i}.mf`} value={l.manufactureDate} onChange={(v) => patch(i, { manufactureDate: v })} calendar={calendar} hasError={bad("mf")} onBlurField={() => {}} compact disabled={off || !p?.tracksExpiry} />
                      <DateInput fieldName={`L.${i}.ex`} value={l.expiryDate} onChange={(v) => patch(i, { expiryDate: v })} calendar={calendar} hasError={bad("ex")} onBlurField={() => {}} compact disabled={off || !p?.tracksExpiry} />
                    </>
                  )}
                  {layout.showLink && <span className="break-words text-[11px] leading-tight text-slate-600" title={l.link}>{l.link || "—"}</span>}
                  {kind === "bill" && onOpenTerms && <span className="text-right tabular-nums font-medium">{lineNet(lineAmount(l, p), (termSummary?.(i) ?? { amount: "0.00" }).amount)}</span>}
                  <button type="button" data-nav="remove-line" disabled={off} onClick={() => remove(i)} title="Remove line (Delete when the row is selected)" aria-label="Remove line" className={`${kind === "bill" ? "h-7 w-7" : "h-8 w-8"} grid place-items-center rounded-md text-slate-400 hover:bg-rose-50 hover:text-rose-700 focus-visible:outline-2 focus-visible:outline-cobalt-700 disabled:opacity-30`}><X size={14} /></button>
                </div>
                {errMsgs.length > 0 && <p className="px-3 pb-1 text-[12px] text-rose-700">{errMsgs[0]}</p>}
              </div>
            );
          })}
        </div>
      </div>
      {batchFor !== null && lines[batchFor] && (() => {
        const l = lines[batchFor], p = products.get(l.productId);
        return <BatchDialog title={`Line ${batchFor + 1} batch`} product={p ? `${p.code} — ${p.description}` : ""} tracksBatch={!!p?.tracksBatch} tracksExpiry={!!p?.tracksExpiry} value={{ batchNo: l.batchNo, manufactureDate: l.manufactureDate, expiryDate: l.expiryDate }}
          calendar={calendar} readOnly={readOnly}
          onClose={() => { const i = batchFor; setBatchFor(null); requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-field="L.${i}.b"]`)?.focus()); }}
          onApply={(v) => { const i = batchFor; patch(i, v); setBatchFor(null); requestAnimationFrame(() => { const el = document.querySelector<HTMLElement>(`[data-field="L.${i}.b"]`); if (el) gridRows.stepFrom(el, 1); }); }} />;
      })()}
      {errors.lines && <p className="px-3 py-1.5 text-[12px] text-rose-700">{errors.lines}</p>}
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-200 bg-slate-50 px-3 py-2.5">
        {!readOnly && <button type="button" data-nav="add-line" className="btn" onClick={() => addRow()}><Plus size={13} /> Add line {kind === "bill" && <span className="kbd">F6</span>}</button>}
        <span className="flex-1" />
        <span className="text-[12.5px] text-slate-600">Lines <b className="font-semibold tabular-nums text-ink">{live}</b></span>
        <span className="text-[12.5px] text-slate-600">Basic amount <b className="ml-1 text-[14px] font-semibold tabular-nums text-ink">{fmtPaise(total)}</b></span>
      </div>
    </div>
  );
}

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
  category?: "GENERAL" | "ADDITIONAL";
  excludeCategory?: "ADDITIONAL";
  productwiseOnly?: boolean;
  fixedLineNumber?: number;
}

// Billing terms: discount, VAT, freight ... The active preview is calculated by the same shared exact engine as the server.
export function TermsGrid({ terms, onChange, lookups, masters, lineCount, readOnly, errors, clearError, contextKey, calculationPreview, previewError, category, excludeCategory, productwiseOnly, fixedLineNumber }: TProps) {
  const opts = useMemo<ReferenceOption[]>(() => pickableTerms(lookups.terms, { category, excludeCategory, productwiseOnly }).map((t) => ({ value: String(t.id), label: `${t.code} — ${t.name}`, code: t.code, name: t.name, detail: `${t.category} · ${t.nature} · ${t.calcBase.replaceAll("_", " ")} · seq ${t.sequence}`, searchText: `${t.sequence} ${t.isProductwise ? "productwise" : "document"}`, isActive: t.isActive, badge: t.nature === "DEDUCTIVE" ? "less" : undefined })), [lookups.terms, category, excludeCategory, productwiseOnly]);
  const patch = (i: number, p: Partial<TermRow>) => { onChange(terms.map((t, k) => (k === i ? { ...t, ...p } : t))); clearError(...Object.keys(errors).filter((k) => k.startsWith(`T.${i}.`))); };
  const pick = (i: number, id: string) => {
    const m = masters.get(id);
    patch(i, m ? { termId: id, nature: undefined, calcType: m.defaultCalcType, rate: m.defaultCalcType === "PERCENT" ? trimDec(m.defaultValue) : "", inputAmount: m.defaultCalcType === "AMOUNT" ? trimDec(m.defaultValue) : "", lineNumber: m.isProductwise ? String(fixedLineNumber ?? 1) : "", finalAmount: "" } : { termId: id, nature: undefined });
  };
  const remove = (i: number, fromRowMode = false) => {
    const nextTerms = terms.filter((_, k) => k !== i);
    onChange(nextTerms);
    if (fromRowMode) return; // Delete on the selected row: the grid keeps the focus
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
      if (col === "t") { if (above.termId) pick(r, above.termId); return; } // choosing a term also loads that term's defaults
      const one: Partial<TermRow> | undefined = col === "l" ? { lineNumber: above.lineNumber } : col === "c" ? { calcType: above.calcType }
        : col === "v" ? (terms[r].calcType === "PERCENT" ? { rate: above.calcType === "PERCENT" ? above.rate : above.inputAmount } : { inputAmount: above.calcType === "PERCENT" ? above.rate : above.inputAmount })
        : col === "ov" ? { isOverridden: above.isOverridden } : col === "o" ? { overrideAmount: above.overrideAmount } : undefined;
      if (one) patch(r, one);
    },
  });
  const afterCombo = gridRows.afterCombo;

  return (
    <div className="lg-card lg-grid">
      <div className="lg-scroll overflow-x-auto focus-visible:outline-2 focus-visible:outline-cobalt-700" data-grid="terms" {...gridRows.gridProps} onKeyDown={gridRows.handleKey} aria-label="Billing terms; scroll horizontally to see all columns">
        <div className="min-w-max">
          <div style={{ gridTemplateColumns: TCOLS }} className="lg-th xl-head">
            <span className="xl-rowhead">#</span><span>Term</span><span className="text-right">Line</span><span>Calculated as</span><span className="text-right">Rate % / Amount</span><span className="text-center">Override</span><span className="text-right">Use amount</span><span className="text-right">{calculationPreview === undefined ? "Saved amount" : "Live amount"}</span><span />
          </div>
          {terms.length === 0 && <p className="px-3 py-2 text-[12px] text-slate-500">No billing terms. {!readOnly && "Add a discount, VAT, freight … if the document has any."}</p>}
          {terms.map((t, i) => {
            const m = masters.get(t.termId);
            const off = readOnly;
            const bad = (c: string) => !!errors[`T.${i}.${c}`];
            const cls = (c: string, extra = "") => `fld h-8 ${extra} ${bad(c) ? "fld-err" : ""} ${off ? "bg-slate-100 text-slate-600" : ""}`;
            const msg = Object.entries(errors).find(([k, v]) => k.startsWith(`T.${i}.`) && v)?.[1];
            return (
              <div key={t.key} data-row={i} className={`transition-colors ${gridRows.rowSel === i ? "bg-cobalt-50 ring-2 ring-inset ring-cobalt-700" : msg ? "bg-rose-50" : "hover:bg-slate-50/80"}`}>
                <div style={{ gridTemplateColumns: TCOLS }} data-selected={gridRows.rowSel === i} className="xl-row">
                  <button type="button" className="xl-rowhead" {...gridRows.rowHeadProps(i)}>{i + 1}</button>
                  <MasterReferencePicker fieldName={`T.${i}.t`} label="Billing term" required scopeKey="purchase-terms" contextKey={contextKey} placeholder="Choose term…" value={t.termId} hasError={bad("t")} options={opts} disabled={off} onChange={(v) => pick(i, v)} onCommit={afterCombo} />
                  <input data-field={`T.${i}.l`} disabled={off || !m?.isProductwise || fixedLineNumber !== undefined} inputMode="numeric" value={fixedLineNumber === undefined ? t.lineNumber : String(fixedLineNumber)} placeholder={m?.isProductwise ? "Line" : "—"} onChange={decOnly(INT, (v) => patch(i, { lineNumber: v }))} onFocus={(e) => e.currentTarget.select()} className={cls("l", "text-right tabular-nums")} aria-label={fixedLineNumber === undefined ? `Line number (1-${lineCount})` : `Line ${fixedLineNumber}`} />
                  <select data-field={`T.${i}.c`} disabled={off || !m} value={t.calcType} onChange={(e) => patch(i, { calcType: e.target.value as TermRow["calcType"] })} className={cls("c")} aria-label="Calculated as">
                    <option value="PERCENT">Percent (%)</option><option value="AMOUNT">Fixed amount</option>
                  </select>
                  <input data-field={`T.${i}.v`} disabled={off || !m} inputMode="decimal" autoComplete="off" placeholder={t.calcType === "PERCENT" ? "0.00 %" : "0.00"}
                    value={t.calcType === "PERCENT" ? t.rate : t.inputAmount} onChange={decOnly(RATE, (v) => patch(i, t.calcType === "PERCENT" ? { rate: v } : { inputAmount: v }))} onFocus={(e) => e.currentTarget.select()} className={cls("v", "text-right tabular-nums")} aria-label="Rate or amount" />
                  <label className="flex items-center justify-center gap-1 px-2 text-[12px]"><input data-field={`T.${i}.ov`} type="checkbox" disabled={off || !m} checked={t.isOverridden} onChange={(e) => patch(i, { isOverridden: e.target.checked, overrideAmount: e.target.checked ? t.overrideAmount : "" })} /> use own</label>
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
