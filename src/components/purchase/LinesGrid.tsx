import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { PLookups } from "../../api";
import { blankLine, dateOrderErr, derivedQty, isBlankLine, lineAmount, quantityPrecisionErr, trimDec, type LineKind, type LineRow, type Product } from "../../lib/purchaseForm";
import { toPaise } from "../../lib/money";
import { fillDownRows } from "../../lib/tableKinds";
import { useGridRows } from "../table/useGridRows";
import { MasterReferencePicker, type ReferenceOption } from "../MasterReferencePicker";
import { DateInput } from "../DateInput";
import { BatchDialog, hasBatch } from "./BatchDialog";
import { focusStep, money } from "./Bits";

type Errs = Record<string, string | undefined>;
const decOnly = (re: RegExp, set: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => { if (re.test(e.target.value)) set(e.target.value); };
const QTY = /^\d{0,12}(\.\d{0,6})?$/, RATE = /^\d{0,12}(\.\d{0,6})?$/;

type ColKey = "n" | "p" | "aq" | "au" | "q" | "u" | "r" | "amt" | "terms" | "net" | "more" | "xd" | "lc" | "b" | "mf" | "ex" | "link" | "rm";
const COL_SIZE: Record<ColKey, string> = {
  n: "24px", p: "minmax(150px,1.6fr)", aq: "64px", au: "84px", q: "78px", u: "44px", r: "84px", amt: "100px",
  terms: "92px", net: "104px", more: "190px",
  xd: "132px", lc: "120px", b: "112px", mf: "128px", ex: "128px", link: "minmax(130px,1fr)", rm: "30px",
};
const COL_HEAD: Record<ColKey, string> = {
  n: "#", p: "Product", aq: "Alt Qty", au: "Alt Unit", q: "Quantity", u: "Unit", r: "Rate", amt: "Amount",
  terms: "Term Amount", net: "Net Amount", more: "More",
  xd: "Expected", lc: "Location", b: "Batch", mf: "Mfg Date", ex: "Expiry", link: "Linked to", rm: "",
};
const CENTER_HEAD = new Set(["Batch"]);
const isRightHead = (h: string) => RIGHT_HEAD.has(h) || h.startsWith("Rate (") || h.startsWith("Amount (");
const RIGHT_HEAD = new Set(["Alt Qty", "Quantity", "Rate", "Amount", "Term Amount", "Net Amount", "Expected", "Mfg Date", "Expiry"]);
const FILL_FIELDS: (keyof LineRow)[] = ["productId", "altQty", "altUnitId", "qty", "unitId", "rate", "locationId", "batchNo", "manufactureDate", "expiryDate", "expectedDate"];
const LOCKED_FILL_FIELDS: (keyof LineRow)[] = ["rate"];
const FIELD_OF: Partial<Record<string, keyof LineRow>> = { p: "productId", aq: "altQty", au: "altUnitId", q: "qty", u: "unitId", r: "rate", xd: "expectedDate", lc: "locationId", b: "batchNo", mf: "manufactureDate", ex: "expiryDate" };
const lineNet = (basic: string, terms: string) => {
  const signedTerms = terms.startsWith("-") ? -toPaise(terms.slice(1)) : toPaise(terms);
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format((toPaise(basic || "0") + signedTerms) / 100);
};

function lineColumns(kind: LineKind, showAlt: boolean, showLoc: boolean, showBatch: boolean, showExpiry: boolean, showLink: boolean, showTerms: boolean, expanded = true): ColKey[] {
  const cols: ColKey[] = ["n", "p"];
  void showAlt; // the alternate qty and unit columns are always there (blank for a product without alternate units)
  cols.push("aq", "au", "q", "u", "r", "amt");
  if (kind === "sales") { // product, quantity, rate, amount, then the line's terms and net when the screen offers them, then where the stock comes from
    if (showTerms) cols.push("terms", "net");
    cols.push("more", "rm");
    return cols;
  }
  if (kind === "bill") {
    if (showTerms) cols.push("terms", "net"); // line terms, then the net amount, then "More" (location, batch, expiry) which is always shown
    if (expanded) { cols.push("more"); if (showLink) cols.push("link"); } // "More" and "Linked to" fold away behind the arrow at the right edge
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
  lockProducts?: boolean;
  /** purchase orders: a line delivery date cannot precede this header date */
  minimumExpectedDate?: string;
  rateLabel?: string;
  currency?: string; // export invoice in a foreign currency: the rate and amount are typed in it (no NPR rate is pre-filled)
  onOpenTerms?: (index: number, continueAfterApply?: () => void) => void;
  termSummary?: (index: number) => { amount: string; count: number };
  fill?: boolean;
  /** bill lines: start with the "More" and "Linked to" columns open when this browser has no saved choice (default: folded) */
  defaultMoreOpen?: boolean;
}

export function LinesGrid({ kind, lines, onChange, lookups, products, readOnly, errors, calendar, clearError, contextKey, lockProducts, minimumExpectedDate, onOpenTerms, termSummary, fill, currency, defaultMoreOpen }: Props) {
  const unitCode = useMemo(() => new Map(lookups.units.map((u) => [u.id, u.code])), [lookups.units]);
  const productOpts = useMemo<ReferenceOption[]>(() => lookups.products.map((p) => ({ value: String(p.id), label: `${p.code} — ${p.description}`, code: p.code, name: p.description, detail: p.type.replaceAll("_", " "), searchText: `${p.type} ${p.tracksBatch ? "batch" : ""} ${p.tracksExpiry ? "expiry" : ""}`, isActive: p.isActive, badge: p.type === "STOCK" ? undefined : p.type.replace("_", " ").toLowerCase() })), [lookups.products]);
  const locOpts = useMemo<ReferenceOption[]>(() => lookups.locations.map((l) => ({ value: String(l.id), label: `${l.code} — ${l.name}`, code: l.code, name: l.name, isActive: l.isActive })), [lookups.locations]);
  const hasTerms = (kind === "bill" || kind === "sales") && !!onOpenTerms; // a per-line "Term Amount" cell that opens the terms dialog
  const hasMore = kind === "bill" || kind === "sales"; // the "More" cell: location, batch, expiry
  const stockish = kind === "challan" || kind === "bill"; // order and sales lines have no location, batch or expiry columns
  // bill lines: the "More" and "Linked to" columns are folded away until the arrow at the right edge opens them (remembered in this browser)
  const [moreOpen, setMoreOpen] = useState(() => { try { const saved = localStorage.getItem("namo.bill.lines.more"); return saved === null ? !!defaultMoreOpen : saved === "1"; } catch { return !!defaultMoreOpen; } });
  const toggleMore = () => setMoreOpen((open) => { try { localStorage.setItem("namo.bill.lines.more", open ? "0" : "1"); } catch { /* storage is optional */ } return !open; });
  // a problem inside a folded column must be visible: open it
  useEffect(() => { if (kind === "bill" && !moreOpen && Object.keys(errors).some((k) => errors[k] && k.endsWith(".more"))) setMoreOpen(true); }, [errors]); // eslint-disable-line react-hooks/exhaustive-deps
  const layout = useMemo(() => {
    const showAlt = true;
    let showLoc = false, showBatch = false, showExpiry = false, showLink = false;
    for (const row of lines) {
      const p = products.get(row.productId);
      if (!p) continue;
      if (stockish && p.type === "STOCK") showLoc = true;
      if (stockish && p.tracksBatch) showBatch = true;
      if (stockish && p.tracksExpiry) showExpiry = true;
      if (stockish && row.link) showLink = true;
    }
    if (stockish && lines.some((row) => row.link)) showLink = true;
    const cols = lineColumns(kind, showAlt, showLoc, showBatch, showExpiry, showLink, hasTerms, kind === "sales" || moreOpen);
    return { cols, showAlt, showLoc, showBatch, showExpiry, showLink, template: cols.map((c) => COL_SIZE[c]).join(" "), heads: cols.map((c) => (currency && (c === "r" || c === "amt") ? `${COL_HEAD[c]} (${currency})` : kind === "bill" && c === "net" ? "Basic Amount" : COL_HEAD[c])) };
  }, [kind, lines, products, onOpenTerms, currency, moreOpen]);

  const patch = (i: number, p: Partial<LineRow>) => { onChange(lines.map((l, k) => (k === i ? { ...l, ...p } : l))); clearError(...Object.keys(errors).filter((k) => k.startsWith(`L.${i}.`)), "lines"); };
  const pick = (i: number, id: string) => {
    const p = products.get(id), l = lines[i];
    patch(i, {
      productId: id, altUnitId: "", altQty: "", unitId: "", batchNo: p?.tracksBatch ? l.batchNo : "", expiryDate: p?.tracksExpiry ? l.expiryDate : "", manufactureDate: p?.tracksExpiry ? l.manufactureDate : "",
      rate: l.rate || (kind === "sales" ? (currency ? "" : p?.salesRate && Number(p.salesRate) > 0 ? String(Number(p.salesRate)) : "") : kind !== "challan" && p?.purchaseRate && Number(p.purchaseRate) > 0 ? String(Number(p.purchaseRate)) : ""),
      locationId: p?.type === "STOCK" ? l.locationId || (p.defaultLocationId ? String(p.defaultLocationId) : "") : "",
    });
  };
  const cells = (root: Element | null) => Array.from(root?.querySelectorAll<HTMLElement>('[data-field^="L."]') ?? []).filter((el) => !(el as HTMLInputElement).disabled && el.getClientRects().length > 0);
  const addRow = (focus = true) => {
    onChange([...lines, blankLine()]);
    if (focus) setTimeout(() => document.querySelector<HTMLElement>(`[data-field="L.${lines.length}.p"]`)?.focus(), 40);
  };
  useEffect(() => {
    if (kind !== "bill" || readOnly) return;
    const onRequest = () => addRow();
    window.addEventListener("namo:bill-add-line", onRequest);
    return () => window.removeEventListener("namo:bill-add-line", onRequest);
  }, [kind, readOnly, lines]);
  const remove = (i: number, fromRowMode = false) => {
    const n = lines.filter((_, k) => k !== i);
    onChange(n.length ? n : [blankLine()]);
    if (fromRowMode) return;
    requestAnimationFrame(() => {
      const next = document.querySelector<HTMLElement>(`[data-field="L.${Math.min(i, n.length - 1)}.p"]:not(:disabled)`)
        ?? document.querySelector<HTMLElement>('[data-field^="L."]:not(:disabled)');
      next?.focus();
    });
  };

  const commitFill = (next: LineRow[] | null, i: number) => { if (!next) return; onChange(next); clearError(...Object.keys(errors).filter((k) => k.startsWith(`L.${i}.`)), "lines"); };
  const fillRow = (i: number) => {
    if (readOnly || i < 1) return;
    commitFill(fillDownRows(lines, [i], lockProducts && lines[i].link ? LOCKED_FILL_FIELDS : FILL_FIELDS), i);
  };
  const fillCell = (i: number, col: string) => {
    const f = FIELD_OF[col], above = lines[i - 1];
    if (readOnly || !f || !above || (f === "productId" && lockProducts && lines[i].link)) return;
    if (col === "more" && hasMore) { patch(i, { locationId: above.locationId, batchNo: above.batchNo, manufactureDate: above.manufactureDate, expiryDate: above.expiryDate }); return; }
    if (f === "productId") { if (above.productId) pick(i, above.productId); return; }
    patch(i, { [f]: above[f] } as Partial<LineRow>);
  };

  const [batchFor, setBatchFor] = useState<number | null>(null);
  const rowOf = (el: Element) => { const m = /^L\.(\d+)\./.exec(el.getAttribute("data-field") ?? ""); return m ? Number(m[1]) : -1; };
  const gridRows = useGridRows({
    count: lines.length, readOnly,
    firstCell: (grid, r) => cells(grid).find((c) => rowOf(c) === r) ?? null,
    cellOf: (el) => { const m = /^L\.(\d+)\.(\w+)$/.exec(el.getAttribute("data-field") ?? ""); return m ? { row: Number(m[1]), col: m[2] } : null; },
    onRemove: remove, onFillRow: fillRow, onFillCell: fillCell,
    cellSelector: '[data-field^="L."]', fieldOf: (r, c) => `L.${r}.${c}`, endOfRow: "row",
    onAddRow: () => addRow(), lastRowBlank: () => isBlankLine(lines[lines.length - 1]), leave: (el, dir) => focusStep(el, dir),
    onCellEnter: (cell, el) => {
      if (cell.col === "more" && hasMore) { setBatchFor(cell.row); return true; }
      if (cell.col === "terms" && hasTerms && onOpenTerms && lines[cell.row]?.productId) { onOpenTerms(cell.row, () => gridRows.stepFrom(el, 1)); return true; }
      return false;
    },
  });
  const rowSel = gridRows.rowSel;
  const afterCombo = gridRows.afterCombo;

  const leaveTable = (el: HTMLElement, i: number) => {
    const addLine = el.closest("[data-grid=lines]")?.parentElement?.querySelector<HTMLElement>('[data-nav="add-line"]:not(:disabled)');
    if (!focusStep(addLine ?? el, 1)) return;
    if (i === lines.length - 1 && lines.length > 1) { onChange(lines.slice(0, -1)); clearError(...Object.keys(errors).filter((k) => k.startsWith(`L.${i}.`)), "lines"); }
  };
  const onKeyCapture = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (kind === "bill" && e.key === "Tab" && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && !readOnly) {
      const action = (e.target as HTMLElement).closest<HTMLElement>('[data-nav="remove-line"]');
      const row = action?.closest<HTMLElement>("[data-row]");
      const index = Number(row?.dataset.row);
      if (row && index === lines.length - 1 && !isBlankLine(lines[index])) { e.preventDefault(); addRow(); }
      return;
    }
    if (e.key !== "Enter" || e.shiftKey || readOnly) return;
    const el = e.target as HTMLElement, m = /^L\.(\d+)\.p$/.exec(el.getAttribute("data-field") ?? "");
    if (!m || !isBlankLine(lines[Number(m[1])])) return;
    e.preventDefault(); e.stopPropagation();
    leaveTable(el, Number(m[1]));
  };

  const live = lines.filter((l) => !isBlankLine(l)).length;

  return (
    <div className={`lg-card lg-grid group relative ${fill ? "flex min-h-0 flex-col" : ""}`}>
      {kind === "bill" && (
        <button type="button" tabIndex={-1} onClick={toggleMore} aria-expanded={moreOpen} aria-label={moreOpen ? "Hide More and Linked to columns" : "Show More and Linked to columns"} title={moreOpen ? "Hide More / Linked to" : "Show More / Linked to"}
          className="absolute right-0 top-0 z-[60] grid h-8 w-6 place-items-center border-l border-slate-200 bg-slate-100/90 text-slate-600 opacity-0 transition-opacity hover:bg-cobalt-50 hover:text-cobalt-700 focus-visible:opacity-100 group-hover:opacity-100">
          {moreOpen ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      )}
      <div className={`${fill ? "min-h-0 overflow-auto [scrollbar-gutter:stable]" : "overflow-x-auto"} lg-scroll outline-none`} data-grid="lines" data-nav="lines-grid" {...gridRows.gridProps} onKeyDown={gridRows.handleKey} onKeyDownCapture={onKeyCapture} aria-label={`${kind} line items`}>
        <div className="min-w-max">
          <div style={{ gridTemplateColumns: layout.template }} className="lg-th xl-head">
            {layout.heads.map((h, i) => <span key={i} className={i === 0 ? "xl-rowhead" : isRightHead(h) ? "text-right" : kind === "bill" && CENTER_HEAD.has(h) ? "text-center" : ""}>{h}</span>)}
          </div>
          {lines.map((l, i) => {
            const p = products.get(l.productId);
            const useAlt = !!(l.altQty && l.altUnitId);
            const off = readOnly;
            const quantityUnitId = l.altQty ? Number(l.altUnitId) : p?.baseUnitId ?? (l.unitId ? Number(l.unitId) : 0);
            const quantityUnit = lookups.units.find((unit) => unit.id === quantityUnitId);
            const quantityPrecisionError = quantityPrecisionErr(l.altQty || l.qty, quantityUnit, l.altQty ? "Alternate quantity" : "Quantity");
            const expectedDateOrderError = kind === "order" ? dateOrderErr(minimumExpectedDate ?? "", l.expectedDate, "Expected date cannot be before the order date.") : undefined;
            const bad = (c: string) => !!errors[`L.${i}.${c}`] || (c === (l.altQty ? "aq" : "q") && !!quantityPrecisionError) || (c === "xd" && !!expectedDateOrderError);
            const cls = (c: string, extra = "") => `fld ${kind === "bill" ? "h-7" : "h-8"} ${extra} ${bad(c) ? "fld-err" : ""} ${off ? "bg-slate-100 text-slate-600" : ""}`;
            const altOpts: ReferenceOption[] = p ? p.alternateUnits.map((a) => ({ value: String(a.unitId), label: unitCode.get(a.unitId) ?? String(a.unitId), code: unitCode.get(a.unitId) ?? String(a.unitId), detail: `Alternate unit · factor ${a.conversionFactor}`, isActive: true })) : [];
            const altUnavailable = !p || altOpts.length === 0;
            const unitOpts: ReferenceOption[] = lookups.units.map((u) => ({ value: String(u.id), label: `${u.code} — ${u.name}`, code: u.code, name: u.name, detail: `${u.decimalPlaces} decimal place${u.decimalPlaces === 1 ? "" : "s"}`, isActive: true }));
            const errMsgs = Object.entries(errors).filter(([k, v]) => k.startsWith(`L.${i}.`) && v).map(([, v]) => v!);
            if (quantityPrecisionError && !errMsgs.includes(quantityPrecisionError)) errMsgs.push(quantityPrecisionError);
            const qtyShown = useAlt ? derivedQty(l, p) : l.qty;
            return (
              <div key={l.key} data-row={i} className={`border-b border-slate-100 transition-colors ${rowSel === i ? "bg-cobalt-50 ring-2 ring-inset ring-cobalt-700" : errMsgs.length ? "bg-rose-50" : "hover:bg-slate-50/80"}`}
                onMouseDown={(e) => {
                  const t = e.target as HTMLElement;
                  if (t.closest("input, button, [role=\"combobox\"], textarea, select, a")) return;
                  const row = e.currentTarget;
                  const first = row.querySelector<HTMLElement>('[data-field^="L."]:not(:disabled)');
                  if (first) { e.preventDefault(); first.focus(); }
                }}>
                <div style={{ gridTemplateColumns: layout.template }} data-selected={rowSel === i} className="xl-row">
                  <button type="button" className="xl-rowhead" {...gridRows.rowHeadProps(i)}>{i + 1}</button>
                  <MasterReferencePicker fieldName={`L.${i}.p`} label="Product" required scopeKey="products" createMaster={{ key: "products" }} contextKey={contextKey} placeholder="Choose product…" value={l.productId} hasError={bad("p")} options={productOpts} disabled={off || (lockProducts && !!l.link)} onChange={(v) => pick(i, v)} onCommit={afterCombo} />
                  {layout.showAlt && (<><input data-field={`L.${i}.aq`} disabled={off || altUnavailable} inputMode="decimal" autoComplete="off" value={l.altQty} placeholder="" onChange={decOnly(QTY, (v) => patch(i, { altQty: v }))} onFocus={(e) => e.currentTarget.select()} className={cls("aq", `text-right tabular-nums ${altUnavailable ? "!bg-slate-100 !text-slate-400 opacity-50" : ""}`)} aria-label="Alternate quantity" /><MasterReferencePicker fieldName={`L.${i}.au`} label="Alternate unit" scopeKey="product-units" createMaster={{ key: "product-units" }} contextKey={contextKey} placeholder={altOpts.length ? "Choose unit" : ""} value={l.altUnitId} hasError={bad("au")} options={altOpts} disabled={off || altUnavailable} className={altUnavailable ? "!bg-slate-100 !text-slate-400 opacity-50" : ""} onChange={(v) => patch(i, { altUnitId: v })} onCommit={afterCombo} /></>)}
                  <input data-field={`L.${i}.q`} disabled={off || !p || useAlt} inputMode="decimal" autoComplete="off" value={useAlt ? trimDec(qtyShown) : l.qty} onChange={decOnly(QTY, (v) => patch(i, { qty: v }))} onFocus={(e) => e.currentTarget.select()} className={cls("q", `text-right tabular-nums ${useAlt ? "bg-slate-100" : ""}`)} aria-label="Quantity" />
                  {p && !p.baseUnitId
                    ? <MasterReferencePicker fieldName={`L.${i}.u`} label="Unit" required scopeKey="product-units" createMaster={{ key: "product-units" }} contextKey={contextKey} placeholder="Choose unit" value={l.unitId} hasError={bad("u")} options={unitOpts} disabled={off} onChange={(v) => patch(i, { unitId: v })} onCommit={afterCombo} />
                    : <span data-readonly="true" className="text-[12px] text-slate-600" title="Base unit">{p?.baseUnitId ? unitCode.get(p.baseUnitId) : ""}</span>}
                  <input data-field={`L.${i}.r`} disabled={off || !p} inputMode="decimal" autoComplete="off" value={l.rate} placeholder="0.00" onChange={decOnly(RATE, (v) => patch(i, { rate: v }))} onFocus={(e) => e.currentTarget.select()} className={cls("r", "text-right tabular-nums")} aria-label="Rate" />
                  <span data-readonly="true" className="text-right tabular-nums font-medium text-slate-700" title="Calculated amount">{money(lineAmount(l, p))}</span>
                  {hasTerms && onOpenTerms && (() => {
                    const summary = termSummary?.(i) ?? { amount: "0.00", count: 0 };
                    return <button type="button" data-field={`L.${i}.terms`} data-nav={`line-terms-${i}`} disabled={!l.productId} onClick={(event) => { const trigger = event.currentTarget; onOpenTerms(i, () => gridRows.stepFrom(trigger, 1)); }} title={`Edit terms for line ${i + 1}${summary.count ? ` · ${summary.count} term${summary.count === 1 ? "" : "s"}` : ""}`} className={`${kind === "bill" ? "h-7" : "h-8"} w-full px-1 text-right tabular-nums text-cobalt-700 underline decoration-cobalt-200 underline-offset-4 hover:bg-cobalt-50 disabled:text-slate-500 disabled:no-underline focus-visible:outline-2 focus-visible:outline-cobalt-700`}>{summary.amount.startsWith("-") ? `− ${money(summary.amount.slice(1))}` : money(summary.amount || "0")}{summary.count > 0 && <span className="ml-1 text-[10px] text-slate-500 no-underline">({summary.count})</span>}</button>;
                  })()}
                  {hasTerms && <span data-readonly="true" className="text-right tabular-nums font-medium text-slate-700" title={kind === "bill" ? "Basic amount (line amount ± line terms)" : "Net amount (basic ± terms)"}>{lineNet(lineAmount(l, p), (termSummary?.(i) ?? { amount: "0.00" }).amount)}</span>}
                  {kind === "order" && (off
                    ? <input disabled className="fld h-8 bg-slate-100 text-right text-slate-600" value={l.expectedDate} aria-label="Expected date" />
                    : <DateInput fieldName={`L.${i}.xd`} value={l.expectedDate} onChange={(v) => patch(i, { expectedDate: v })} calendar={calendar} hasError={bad("xd")} onBlurField={() => {}} compact />)}
                  {kind !== "bill" && layout.showLoc && (
                    <MasterReferencePicker fieldName={`L.${i}.lc`} label="Location" required={p?.type === "STOCK"} scopeKey="locations" createMaster={{ key: "locations" }} contextKey={contextKey} placeholder={p?.type === "STOCK" ? "Choose location" : "—"} value={l.locationId} hasError={bad("lc")} options={locOpts} disabled={off || p?.type !== "STOCK"} onChange={(v) => patch(i, { locationId: v })} onCommit={afterCombo} />
                  )}
                  {hasMore && layout.cols.includes("more") && (() => {
                    // "More": location, batch and expiry of the line in one cell; Enter or a click opens the dialog (like the line's terms)
                    const isStock = p?.type === "STOCK", tracked = !!p && (isStock || p.tracksBatch || p.tracksExpiry);
                    const locCode = l.locationId ? lookups.locations.find((x) => String(x.id) === l.locationId)?.code ?? "" : "";
                    const parts = [locCode, l.batchNo.trim(), l.expiryDate].filter(Boolean);
                    const badMore = ["more", "lc", "b", "mf", "ex"].some(bad);
                    const text = parts.join(" · ");
                    return (
                      <button type="button" data-field={`L.${i}.more`} disabled={!tracked || (off && !hasBatch(l))} onClick={() => setBatchFor(i)} aria-label={`More details: ${text || "none"}`} title={tracked ? `${text || "Location, batch and expiry"} (Enter)` : "Nothing more for this product"}
                        className={`${cls("more", "")} truncate text-left ${!tracked ? "bg-slate-50 text-slate-400" : badMore ? "text-rose-700" : text ? "font-medium text-slate-800" : "text-cobalt-700"}`}>
                        {tracked ? (text || (isStock ? "Add location…" : "Add…")) : ""}
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
                  {layout.cols.includes("link") && <span className="break-words text-[11px] leading-tight text-slate-600" title={l.link}>{l.link || "—"}</span>}
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
        return <BatchDialog title={`Line ${batchFor + 1} — more details`} product={p ? `${p.code} — ${p.description}` : ""} isStock={p?.type === "STOCK"} locations={lookups.locations} tracksBatch={!!p?.tracksBatch} tracksExpiry={!!p?.tracksExpiry} value={{ locationId: l.locationId, batchNo: l.batchNo, manufactureDate: l.manufactureDate, expiryDate: l.expiryDate }}
          calendar={calendar} readOnly={readOnly}
          onClose={() => { const i = batchFor; setBatchFor(null); requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-field="L.${i}.more"]`)?.focus()); }}
          onApply={(v) => { const i = batchFor; patch(i, v); setBatchFor(null); requestAnimationFrame(() => { const el = document.querySelector<HTMLElement>(`[data-field="L.${i}.more"]`); if (el) gridRows.stepFrom(el, 1); }); }} />;
      })()}
      {errors.lines && <p className="px-3 py-1.5 text-[12px] text-rose-700">{errors.lines}</p>}
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-200 bg-slate-50 px-3 py-2.5">
        <span className="flex-1" />
        <span className="text-[12.5px] text-slate-600">Lines <b className="font-semibold tabular-nums text-ink">{live}</b></span>
      </div>
    </div>
  );
}

export { TermsGrid } from "./TermsGrid";
