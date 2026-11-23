import { useEffect, useState, type ReactNode } from "react";
import { parseDec } from "../../../shared/decimal";
import { fmt, toMicro } from "../../../shared/purchase-calculation";
import { previewPurchase, type PurchasePreview } from "../../../shared/purchase-preview";
import type { PLookups } from "../../api";
import {
  dialogTermRows, dialogTermsToApply, effectiveQty, isBlankLine, isBlankTerm, isHiddenTerm, lineAmount, type LineRow, type Product, type Term, type TermRow,
} from "../../lib/purchaseForm";
import { focusStep, money } from "./Bits";
import { TermsGrid } from "./TermsGrid";

// The "Assess terms" dialog of a document that has line-wise and document-wise terms (the sales invoice; the purchase bill carries its own older copy).
// The document form shows one strip ("Terms: n, total") and one amount per line; this dialog is where the terms are entered, one scope at a time:
//   header: every document-wise term, in sequence;   line: every line-wise term for one line.
// Every active term of the scope is listed, the ones not on the document yet at zero; Apply keeps only those with a value (a mandatory term stays).
// It uses the same exact engine as the server for its live amounts, and hands the keyboard back to where it came from.

export type TermScope = { scope: "header" } | { scope: "line"; lineNumber: number; lineIndex: number; continueAfterApply?: () => void };
type Errs = Record<string, string | undefined>;

const shown = (v: string) => (v === "" ? "—" : v.startsWith("-") ? `− ${money(v.slice(1))}` : money(v));
function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="px-3 py-1.5">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-600">{label}</div>
      <div className={`tabular-nums ${strong ? "text-[17px] font-bold text-blue-950" : "text-[15px] font-semibold text-slate-900"}`}>{value}</div>
    </div>
  );
}

interface Opts {
  lines: LineRow[]; terms: TermRow[];
  lookups: PLookups | null; products: Map<string, Product>; masters: Map<string, Term>;
  readOnly: boolean;
  /** the saved document's basic / net amounts, shown while viewing */
  savedBasic?: string; savedNet?: string;
  /** live totals of the whole document, for the per-line and header summaries */
  preview: PurchasePreview;
  errors: Errs; clearError: (...k: string[]) => void;
  setTerms: (t: TermRow[]) => void;
  contextKey: string; noun: string;
  /** a document already saved shows the amounts it was saved with */
  saved: boolean;
}

export function useTermsDialog(o: Opts) {
  const { lines, terms, lookups, products, masters, readOnly: ro } = o;
  const [dlg, setDlg] = useState<TermScope | null>(null);
  const [draft, setDraft] = useState<TermRow[]>([]);
  const liveLines = lines.filter((l) => !isBlankLine(l)).length;
  const lineNumberAt = (index: number) => lines.slice(0, index).filter((l) => !isBlankLine(l)).length + 1;

  const inScope = (t: TermRow, sc: TermScope) => {
    if (isBlankTerm(t)) return false;
    const productwise = masters.get(t.termId)?.isProductwise ?? !!t.lineNumber;
    return sc.scope === "header" ? !productwise : productwise && Number(t.lineNumber) === sc.lineNumber;
  };
  const open = (sc: TermScope) => {
    const scoped = terms.filter((t) => inScope(t, sc)).map((t) => ({ ...t }));
    // editing: every term of this kind, the ones not on the document yet at zero; viewing: only what the document carries
    setDraft(ro ? scoped : dialogTermRows(lookups?.terms ?? [], scoped, { productwise: sc.scope === "line", lineNumber: sc.scope === "line" ? sc.lineNumber : undefined }));
    setDlg(sc);
    window.setTimeout(() => (document.querySelector<HTMLElement>('[data-term-dialog] [data-field^="T."]:not(:disabled)') ?? document.querySelector<HTMLElement>("[data-term-dialog] button"))?.focus(), 40);
  };
  const close = (continueAfterApply = false) => {
    const prev = dlg;
    setDlg(null);
    window.requestAnimationFrame(() => {
      const target = prev?.scope === "line" ? document.querySelector<HTMLElement>(`[data-nav="line-terms-${prev.lineIndex}"]`) : document.querySelector<HTMLElement>('[data-nav="header-terms"]');
      if (continueAfterApply) {
        if (prev?.scope === "line" && prev.continueAfterApply) { prev.continueAfterApply(); return; }
        if (target && focusStep(target, 1)) return;
      }
      target?.focus();
    });
  };
  const apply = () => {
    if (!dlg) return;
    // outside this scope, or an inactive term the dialog never showed: both stay on the document unchanged
    const kept = terms.filter((t) => !isBlankTerm(t) && (!inScope(t, dlg) || isHiddenTerm(t, masters)));
    o.setTerms([...kept, ...dialogTermsToApply(draft, masters)]);
    o.clearError(...Object.keys(o.errors).filter((k) => k === "terms" || k.startsWith("T.")));
    close(true);
  };

  // a save that found a problem in a term opens the dialog at that term
  useEffect(() => {
    if (dlg) return;
    const key = Object.keys(o.errors).find((n) => /^T\.\d+\./.test(n) && o.errors[n]);
    if (!key && !o.errors.terms) return;
    if (!key) { open({ scope: "header" }); return; }
    const t = terms[Number(/^T\.(\d+)\./.exec(key)?.[1])];
    if (!t) return;
    if (masters.get(t.termId)?.isProductwise) { const n = Number(t.lineNumber) || 1; open({ scope: "line", lineNumber: n, lineIndex: Math.max(0, n - 1) }); } else open({ scope: "header" });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o.errors]);

  // keep a line's terms attached to the right line number when lines are inserted, moved or removed
  const updateLines = (next: LineRow[], apply: (p: { lines: LineRow[]; terms?: TermRow[] }) => void) => {
    const oldLive = lines.filter((l) => !isBlankLine(l)), nextLive = next.filter((l) => !isBlankLine(l));
    const numberOf = new Map(nextLive.map((l, i) => [l.key, i + 1]));
    let changed = false;
    const moved = terms.flatMap((t) => {
      if (!masters.get(t.termId)?.isProductwise) return [t];
      const old = Number(t.lineNumber);
      if (!Number.isInteger(old) || old < 1 || !oldLive[old - 1]) return [t];
      const now = numberOf.get(oldLive[old - 1].key);
      if (!now) { changed = true; return []; }
      if (now === old) return [t];
      changed = true;
      return [{ ...t, lineNumber: String(now) }];
    });
    apply(changed ? { lines: next, terms: moved } : { lines: next });
  };

  const signedOf = (t: TermRow) => {
    const m = masters.get(t.termId);
    const live = o.preview.terms.get(t.key)?.signedAmount;
    if (ro && t.finalAmount) return `${t.nature === "DEDUCTIVE" || m?.nature === "DEDUCTIVE" ? "-" : ""}${t.finalAmount}`;
    return live ?? (t.finalAmount && (ro || o.saved) ? `${t.nature === "DEDUCTIVE" || m?.nature === "DEDUCTIVE" ? "-" : ""}${t.finalAmount}` : "0");
  };
  const sumOf = (pick: (t: TermRow) => boolean) => {
    let total = 0n, count = 0;
    for (const t of terms) { if (isBlankTerm(t) || !pick(t)) continue; count += 1; try { total += toMicro(signedOf(t)); } catch { /* a malformed legacy value is left out of the label */ } }
    return { amount: fmt(total, 2), count };
  };
  const lineSummary = (index: number) => {
    if (isBlankLine(lines[index])) return { amount: "0.00", count: 0 };
    const n = lineNumberAt(index);
    return sumOf((t) => !!masters.get(t.termId)?.isProductwise && Number(t.lineNumber) === n);
  };
  const header = sumOf((t) => !masters.get(t.termId)?.isProductwise);

  // ---- the dialog ----
  let node: ReactNode = null;
  if (dlg) {
    const errs: Errs = {};
    for (const [k, v] of Object.entries(o.errors)) {
      if (k === "terms") { errs.terms = v; continue; }
      const m = /^T\.(\d+)\.(.+)$/.exec(k);
      if (!m) continue;
      const local = draft.findIndex((t) => t.key === terms[Number(m[1])]?.key);
      if (local >= 0) errs[`T.${local}.${m[2]}`] = v;
    }
    const clear = (...keys: string[]) => o.clearError(...keys.map((k) => {
      const m = /^T\.(\d+)\.(.+)$/.exec(k);
      if (!m) return k;
      const g = terms.findIndex((t) => t.key === draft[Number(m[1])]?.key);
      return g < 0 ? k : `T.${g}.${m[2]}`;
    }));
    const live: PurchasePreview | undefined = ro ? undefined : (() => {
      let incomplete = liveLines === 0;
      const priced = lines.filter((l) => !isBlankLine(l)).flatMap((l, i) => {
        const p = products.get(l.productId), q = effectiveQty(l, p);
        if (!p || !q || !parseDec(q) || parseDec(q)!.n <= 0n || !l.rate || !parseDec(l.rate) || !!l.altQty !== !!l.altUnitId) { incomplete = true; return []; }
        const amount = lineAmount(l, p);
        return amount ? [{ lineNumber: i + 1, basicAmount: amount }] : (incomplete = true, []);
      });
      const rows = [...terms.filter((t) => !isBlankTerm(t) && !inScope(t, dlg)), ...draft.filter((t) => !isBlankTerm(t))]
        .map((t) => ({ rowKey: t.key, termId: Number(t.termId), lineNumber: t.lineNumber, calcType: t.calcType, rate: t.rate, inputAmount: t.inputAmount, isOverridden: t.isOverridden, overrideAmount: t.overrideAmount }));
      return previewPurchase(priced, rows, new Map((lookups?.terms ?? []).map((t) => [t.id, t])), incomplete);
    })();
    let totalMicro = 0n, totalComplete = ro;
    if (ro) {
      for (const t of draft) { if (t.finalAmount) { try { totalMicro += toMicro(`${t.nature === "DEDUCTIVE" || masters.get(t.termId)?.nature === "DEDUCTIVE" ? "-" : ""}${t.finalAmount}`); } catch { /* skip */ } } }
    } else if (live?.status === "ready") {
      totalComplete = true;
      for (const t of draft) { const a = live.terms.get(t.key)?.signedAmount; if (a) totalMicro += toMicro(a); }
    }
    const totalText = totalComplete ? fmt(totalMicro, 2) : "—";
    const line = dlg.scope === "line" ? lines[dlg.lineIndex] : undefined;
    const basicAfterLineTerms = (() => {
      if (ro) {
        try {
          let total = toMicro(o.savedBasic ?? "0");
          for (const term of terms) {
            const master = masters.get(term.termId);
            if (isBlankTerm(term) || !master?.isProductwise || !term.finalAmount) continue;
            const amount = toMicro(term.finalAmount);
            total += (term.nature ?? master.nature) === "DEDUCTIVE" ? -amount : amount;
          }
          return fmt(total, 2);
        } catch { return o.savedBasic ?? ""; }
      }
      if (!live) return "";
      const lineTerms = [...terms.filter((term) => !inScope(term, dlg)), ...draft];
      const productwise = lineTerms.filter((term) => !isBlankTerm(term) && masters.get(term.termId)?.isProductwise);
      if (live.status !== "ready") return productwise.length ? "" : live.basicAmount;
      try {
        let total = toMicro(live.basicAmount);
        for (const term of productwise) {
          const amount = live.terms.get(term.key)?.signedAmount;
          if (amount) total += toMicro(amount);
        }
        return fmt(total, 2);
      } catch { return ""; }
    })();
    const basic = dlg.scope === "line" ? (line ? lineAmount(line, products.get(line.productId)) : "") : basicAfterLineTerms;
    const net = dlg.scope === "line"
      ? (basic && totalComplete ? fmt(toMicro(basic) + totalMicro, 2) : "")
      : ro ? o.savedNet ?? "" : live?.status === "ready" && basic ? fmt(toMicro(basic) + totalMicro, 2) : "";
    const filled = draft.filter((t) => !isBlankTerm(t) && (ro || !(() => { const v = (t.isOverridden ? t.overrideAmount : t.calcType === "PERCENT" ? t.rate : t.inputAmount).trim(); const x = parseDec(v); return v === "" || (!!x && x.n === 0n); })())).length;
    node = (
      <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-3" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
        <div data-term-dialog data-purchase-document role="dialog" aria-modal="true" aria-labelledby="terms-dialog-title" className="flex max-h-[92vh] w-[min(1120px,96vw)] flex-col border border-slate-500 bg-white shadow-xl"
          onKeyDown={(e) => {
            if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); return; }
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); e.stopPropagation(); if (!ro) apply(); return; }
            if (e.key === "Tab") { // the keyboard stays inside the dialog
              const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])')).filter((x) => x.getClientRects().length > 0);
              const first = items[0], last = items[items.length - 1];
              if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
            }
          }}>
          <div className="flex items-center justify-between gap-3 border-b border-slate-300 bg-slate-100 px-3 py-2">
            <div>
              <h2 id="terms-dialog-title" className="text-[14px] font-semibold text-slate-800">{dlg.scope === "header" ? `Terms for the whole ${o.noun}` : `Line ${dlg.lineNumber} terms`}</h2>
              <p className="text-[11px] text-slate-600">{dlg.scope === "header" ? "Document-level terms, in sequence." : `${line ? products.get(line.productId)?.description ?? "Product line" : "Product line"} — terms for this line, in sequence.`} Terms left at 0 are not saved.</p>
            </div>
            <button type="button" className="btn" onClick={() => close()} aria-label="Close terms dialog">Close <span className="kbd">Esc</span></button>
          </div>
          <div className="grid shrink-0 grid-cols-3 divide-x divide-slate-200 border-b border-slate-300 bg-white text-center" aria-live="polite">
            <Stat label={dlg.scope === "line" ? "Line amount" : "Basic amount"} value={shown(basic)} />
            <Stat label={dlg.scope === "line" ? "Line terms" : "Net terms"} value={totalText === "—" ? "—" : shown(totalText)} />
            <Stat label={dlg.scope === "line" ? "Basic amount" : "Net amount"} value={shown(net)} strong />
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-3">
            <TermsGrid terms={draft} onChange={setDraft} lookups={lookups!} masters={masters} lineCount={liveLines} readOnly={ro} errors={errs} clearError={clear} contextKey={o.contextKey}
              calculationPreview={ro ? undefined : live?.terms} previewError={live?.message} excludeCategory="COSTING" productwiseOnly={dlg.scope === "line"} fixedLineNumber={dlg.scope === "line" ? dlg.lineNumber : undefined} fixedRows={!ro}
              editableResult hideLineNumber={dlg.scope === "header"} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-300 bg-slate-50 px-3 py-2">
            <span className="text-[12px] text-slate-600">{filled} term(s) with a value</span>
            <div className="flex gap-2">
              <button type="button" className="btn" onClick={() => close()}>Cancel</button>
              {!ro && <button type="button" data-nav="terms-apply" aria-keyshortcuts="Enter Control+S" className="btn btn-primary" onClick={apply}
                onKeyDown={(e) => { if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); e.stopPropagation(); focusStep(e.currentTarget, -1); } }}>
                Apply to {o.noun} <span className="kbd">Enter / Ctrl+S</span>
              </button>}
            </div>
          </div>
        </div>
      </div>
    );
  }
  return { open, node, isOpen: !!dlg, header, lineSummary, lineNumberAt, updateLines, signedOf };
}
