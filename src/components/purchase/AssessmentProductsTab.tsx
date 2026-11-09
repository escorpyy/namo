import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Check, RotateCcw, X } from "lucide-react";
import { allocatedTotal, cents, centsText, lineId, lineLabel, type LineAlloc, type PreviewLineLike, type TermView } from "../../lib/assessmentTabs";
import { ModeChip, NatureChip, basisLabel, fmtC, natureClass, signedC } from "./AssessmentBits";
import { money } from "./Bits";

// "Product-wise" tab: one row per product with what the charges did to it. Enter on a row opens that product's own charge table, already
// split automatically, so the user can check it and correct an amount. Editing an amount turns that charge to a manual split; every
// charge must add up to its total again before the assessment can be applied.

export interface ProductsTabProps {
  lines: PreviewLineLike[];
  terms: TermView[];
  alloc: LineAlloc;
  editing: boolean;
  ready: boolean;
  hasLinked: boolean;
  splitSummary: string;
  onChangeSplit: () => void;
  onEditAmount: (termId: string, lineId: number, value: string) => void;
  onResetAuto: (termId: string) => void;
}

const TH = "px-2.5 py-2 text-right";

export function ProductsTab(p: ProductsTabProps) {
  const [openId, setOpenId] = useState<number | null>(null);
  const stock = useMemo(() => p.terms.filter((t) => t.capitalizable), [p.terms]);
  const hasOpen = openId != null && p.lines.some((l) => lineId(l) === openId);
  useEffect(() => { if (openId != null && !hasOpen) setOpenId(null); }, [openId, hasOpen]);

  const totals = useMemo(() => {
    const t = { goods: 0, linked: 0, terms: 0, landed: 0 };
    for (const l of p.lines) {
      t.goods += cents(l.goodsValue); t.linked += cents(l.capitalizedSources) + cents(l.existingPurchaseTermCosts);
      t.terms += cents(l.capitalizedAssessments); t.landed += cents(l.landedValue);
    }
    return t;
  }, [p.lines]);
  const open = (id: number) => { if (p.ready && stock.length) setOpenId(id); };

  const rowKeys = (e: React.KeyboardEvent<HTMLTableRowElement>, id: number) => {
    const rows = Array.from(e.currentTarget.parentElement?.querySelectorAll<HTMLElement>("[data-prow]") ?? []);
    const at = rows.indexOf(e.currentTarget);
    if (e.key === "ArrowDown") { e.preventDefault(); rows[Math.min(at + 1, rows.length - 1)]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); rows[Math.max(at - 1, 0)]?.focus(); }
    else if (e.key === "Enter") { e.preventDefault(); open(id); }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-100 px-4 py-2.5 text-[12px] text-slate-600">
        <span>
          Split: <b className="text-ink">{p.splitSummary}</b>
          {p.editing && <button type="button" className="ml-2 font-semibold text-cobalt-700 underline underline-offset-2" onClick={p.onChangeSplit}>Change</button>}
        </span>
        {stock.map((t) => {
          const gap = t.gap ?? 0;
          return (
            <span key={t.formKey} className="inline-flex items-center gap-1.5">
              <NatureChip nature={t.nature}>{t.code}</NatureChip>
              <ModeChip mode={t.mode} />
              {t.mode === "MANUAL" && (
                gap === 0
                  ? <span className="inline-flex items-center gap-0.5 font-semibold text-green-700"><Check size={12} /> ties</span>
                  : <span className="font-semibold text-red-700" role="alert">{gap > 0 ? "short" : "over"} {fmtC(gap)}</span>
              )}
              {t.mode === "MANUAL" && p.editing && (
                <button type="button" className="inline-flex items-center gap-0.5 text-cobalt-700 underline underline-offset-2" onClick={() => p.onResetAuto(t.termId)} title={`Go back to the automatic split of ${t.code}`}>
                  <RotateCcw size={11} /> auto
                </button>
              )}
            </span>
          );
        })}
        {stock.length === 0 && <span>No charge in this assessment goes into stock value, so there is nothing to split by product.</span>}
      </div>

      <div className="lg-scroll lg-grid min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[720px] text-[12.5px]">
          <thead className="lg-th sticky top-0 z-10">
            <tr>
              <th className="px-2.5 py-2 text-left">Product</th>
              <th className={TH}>Qty</th>
              <th className={TH}>Goods value</th>
              {p.hasLinked && <th className={TH} title="Invoiced service costs and earlier bill costs">Linked costs</th>}
              <th className={TH}>Terms</th>
              <th className={TH}>Landed value</th>
              <th className={TH}>Landed unit cost</th>
            </tr>
          </thead>
          <tbody>
            {p.lines.map((l) => {
              const id = lineId(l), terms = cents(l.capitalizedAssessments);
              return (
                <tr key={id} data-prow tabIndex={0} aria-label={`${lineLabel(l)}: open its charges`} onKeyDown={(e) => rowKeys(e, id)} onDoubleClick={() => open(id)}
                  className="cursor-default border-t border-slate-100 outline-none transition-colors hover:bg-cobalt-50/40 focus:bg-cobalt-50 focus:ring-2 focus:ring-inset focus:ring-cobalt-600">
                  <td className="px-2.5 py-2"><span className="mr-2 text-slate-400">{l.lineNumber}</span><span className="font-medium text-ink">{lineLabel(l)}</span>{l.description && l.productCode ? <span className="ml-2 text-slate-500">{l.description}</span> : null}</td>
                  <td className="px-2.5 py-2 text-right tabular-nums">{l.quantity ?? ""}</td>
                  <td className="px-2.5 py-2 text-right tabular-nums">{money(l.goodsValue)}</td>
                  {p.hasLinked && <td className="px-2.5 py-2 text-right tabular-nums">{fmtC(cents(l.capitalizedSources) + cents(l.existingPurchaseTermCosts))}</td>}
                  <td className="px-2.5 py-1.5 text-right"><span className={`inline-block min-w-[88px] rounded px-2 py-1 font-semibold tabular-nums ${terms < 0 ? natureClass("DEDUCTIVE") : natureClass("ADDITIVE")}`}>{signedC(terms)}</span></td>
                  <td className="px-2.5 py-2 text-right font-semibold tabular-nums text-ink">{money(l.landedValue)}</td>
                  <td className="px-2.5 py-2 text-right tabular-nums">{money(l.landedRate)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
              <td className="px-2.5 py-2">Total</td><td />
              <td className="px-2.5 py-2 text-right tabular-nums">{fmtC(totals.goods)}</td>
              {p.hasLinked && <td className="px-2.5 py-2 text-right tabular-nums">{fmtC(totals.linked)}</td>}
              <td className="px-2.5 py-2 text-right tabular-nums">{signedC(totals.terms)}</td>
              <td className="px-2.5 py-2 text-right tabular-nums">{fmtC(totals.landed)}</td><td />
            </tr>
          </tfoot>
        </table>
        {p.lines.length === 0 && <p className="p-4 text-slate-500">{p.ready ? "This goods bill has no product lines." : "Working out the product split…"}</p>}
      </div>
      <p className="border-t border-slate-100 px-4 py-2 text-[11.5px] text-slate-500">↑ ↓ choose a product · Enter opens its charges{p.editing ? " · change an amount to split that charge by hand" : ""}</p>

      {hasOpen && (
        <ProductDialog lines={p.lines} openId={openId!} terms={stock} alloc={p.alloc} editing={p.editing}
          onEditAmount={p.onEditAmount} onResetAuto={p.onResetAuto} onNavigate={setOpenId} onClose={() => setOpenId(null)} />
      )}
    </div>
  );
}

function ProductDialog(p: {
  lines: PreviewLineLike[]; openId: number; terms: TermView[]; alloc: LineAlloc; editing: boolean;
  onEditAmount: ProductsTabProps["onEditAmount"]; onResetAuto: ProductsTabProps["onResetAuto"]; onNavigate: (id: number) => void; onClose: () => void;
}) {
  const at = p.lines.findIndex((l) => lineId(l) === p.openId);
  const line = p.lines[at];
  const box = useRef<HTMLDivElement>(null);
  const go = (to: number) => { const l = p.lines[to]; if (l) p.onNavigate(lineId(l)); };
  useEffect(() => {
    const first = box.current?.querySelector<HTMLElement>("input[data-amount]:not([disabled])") ?? box.current?.querySelector<HTMLElement>("[data-done]");
    first?.focus();
  }, [p.openId]);

  const keys = (e: React.KeyboardEvent) => {
    e.stopPropagation(); // the screen's own shortcuts (Esc to cancel the document, Enter to move between fields) must not see these keys
    if (e.key === "Escape") { e.preventDefault(); p.onClose(); }
    else if (e.key === "PageDown") { e.preventDefault(); go(at + 1); }
    else if (e.key === "PageUp") { e.preventDefault(); go(at - 1); }
    else if (e.key === "Enter" && (e.target as HTMLElement).hasAttribute("data-amount")) {
      e.preventDefault();
      const all = Array.from(box.current?.querySelectorAll<HTMLElement>("input[data-amount]:not([disabled])") ?? []);
      const next = all[all.indexOf(e.target as HTMLElement) + (e.shiftKey ? -1 : 1)];
      (next ?? box.current?.querySelector<HTMLElement>("[data-done]"))?.focus();
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) p.onClose(); }}>
      <div ref={box} role="dialog" aria-modal="true" aria-label={`Charges for ${lineLabel(line)}`} onKeyDown={keys} className="lg-card flex max-h-[88vh] w-[min(820px,96vw)] flex-col bg-white shadow-xl">
        <header className="lg-card-head justify-between">
          <div className="min-w-0">
            <h2 className="lg-card-title truncate">Line {line.lineNumber} · {lineLabel(line)}</h2>
            <p className="lg-card-hint">Qty {line.quantity} · goods {money(line.goodsValue)} · landed <b className="text-ink">{money(line.landedValue)}</b> · unit cost <b className="text-ink">{money(line.landedRate)}</b></p>
          </div>
          <button type="button" className="btn h-8 w-8 justify-center px-0" onClick={p.onClose} aria-label="Close"><X size={14} /></button>
        </header>
        <div className="lg-scroll min-h-0 flex-1 overflow-auto">
          <table className="w-full text-[12.5px]">
            <thead className="lg-th">
              <tr>
                <th className="px-3 py-2 text-left">Charge</th>
                <th className="px-3 py-2 text-left">Split by</th>
                <th className="px-3 py-2 text-right">Amount for this product</th>
                <th className="px-3 py-2 text-right">Charge total</th>
                <th className="px-3 py-2 text-right">Allocated</th>
                <th className="px-3 py-2 text-left">Check</th>
              </tr>
            </thead>
            <tbody>
              {p.terms.map((t) => {
                const mine = p.alloc.get(t.termId)?.get(p.openId) ?? 0;
                const manual = t.mode === "MANUAL";
                const value = manual ? (t.manual?.[String(p.openId)] ?? "") : centsText(Math.abs(mine));
                const allocated = manual ? t.amount - (t.gap ?? 0) : allocatedTotal(p.alloc, t.termId);
                const diff = t.amount - allocated;
                return (
                  <tr key={t.formKey} className="border-t border-slate-100">
                    <td className="px-3 py-2"><NatureChip nature={t.nature}>{t.code}</NatureChip> <span className="ml-1 text-slate-600">{t.name}</span></td>
                    <td className="px-3 py-2 text-slate-600">{basisLabel(t.basis)}</td>
                    <td className="px-3 py-1.5 text-right">
                      <span className="inline-flex items-center justify-end gap-1.5">
                        <span className={t.nature === "DEDUCTIVE" ? "text-red-700" : "text-green-800"} aria-hidden>{t.nature === "DEDUCTIVE" ? "−" : "+"}</span>
                        <input data-amount inputMode="decimal" aria-label={`${t.code} amount for ${lineLabel(line)}`} disabled={!p.editing}
                          className="fld h-8 w-[120px] text-right tabular-nums" value={value} onFocus={(e) => e.currentTarget.select()}
                          onChange={(e) => { if (/^\d*(\.\d{0,2})?$/.test(e.target.value)) p.onEditAmount(t.termId, p.openId, e.target.value); }} />
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtC(t.amount)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtC(allocated)}</td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-2">
                        <ModeChip mode={t.mode} />
                        {diff === 0
                          ? <span className="inline-flex items-center gap-0.5 font-semibold text-green-700"><Check size={12} /> ties</span>
                          : <span className="font-semibold text-red-700" role="alert">{diff > 0 ? "short" : "over"} {fmtC(diff)}</span>}
                        {manual && p.editing && <button type="button" className="text-cobalt-700 underline underline-offset-2" onClick={() => p.onResetAuto(t.termId)}>Reset</button>}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <footer className="flex flex-wrap items-center gap-2 border-t border-slate-200 px-4 py-3">
          <button type="button" className="btn" disabled={at <= 0} onClick={() => go(at - 1)}><ChevronLeft size={14} /> Previous product <span className="kbd">PgUp</span></button>
          <button type="button" className="btn" disabled={at >= p.lines.length - 1} onClick={() => go(at + 1)}>Next product <ChevronRight size={14} /> <span className="kbd">PgDn</span></button>
          <span className="flex-1" />
          <span className="text-[11.5px] text-slate-500">Enter moves to the next amount · each charge must add up to its total before Apply</span>
          <button type="button" data-done className="btn btn-primary" onClick={p.onClose}>Done <span className="kbd">Esc</span></button>
        </footer>
      </div>
    </div>
  );
}
