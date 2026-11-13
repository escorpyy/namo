import { useCallback, useMemo } from "react";
import { Plus, X } from "lucide-react";
import type { AccountBalance, JLookups } from "../../api";
import { blankJLine, fmtAmt, isBlankJLine, jTotals, type JErrors, type JLine } from "../../lib/journalForm";
import { fillDownRows } from "../../lib/tableKinds";
import { MasterReferencePicker, type ReferenceOption } from "../MasterReferencePicker";
import { focusStep, groupIN } from "../purchase/Bits";
import { useGridRows } from "../table/useGridRows";

// The lines of a journal voucher: S.No, General Ledger, Party Subledger (only for a ledger that has parties), Agent, Dr, Cr, Narration.
// Same keyboard flow as every other grid (useGridRows): Enter walks the cells and adds a line after the last one, Delete / Shift+Delete removes a row,
// Ctrl+D copies the cell or row above. Extra here: picking a ledger on an empty line fills the amount that balances the voucher,
// and F8 sets the line you are on to the amount that balances it.

const MONEY = /^\d{0,12}(\.\d{0,2})?$/;
const FILL: (keyof JLine)[] = ["glId", "subId", "agentId", "debit", "credit", "narration"];
const FIELD_OF: Record<string, keyof JLine> = { g: "glId", s: "subId", a: "agentId", d: "debit", c: "credit", n: "narration" };
const TEMPLATE = "40px minmax(230px,1.6fr) minmax(170px,1.1fr) minmax(130px,0.8fr) 124px 124px minmax(200px,1.5fr) 34px";

interface Props {
  lines: JLine[];
  onChange: (l: JLine[]) => void;
  lookups: JLookups;
  accountBalances: AccountBalance[] | null;
  readOnly: boolean;
  errors: JErrors;
  clearError: (...k: string[]) => void;
  contextKey: string;
}

export function JournalLinesGrid({ lines, onChange, lookups, accountBalances, readOnly, errors, clearError, contextKey }: Props) {
  const balanceMap = useMemo(() => new Map((accountBalances ?? []).map((b) => [`${b.generalLedgerId}:${b.subLedgerId ?? ""}`, b])), [accountBalances]);
  const balanceText = useCallback((glId: number, subLedgerId: number | null = null) => {
    const b = balanceMap.get(`${glId}:${subLedgerId ?? ""}`);
    return b ? `Balance · Dr NPR ${groupIN(b.debit)} · Cr NPR ${groupIN(b.credit)}` : accountBalances ? "Balance · Dr NPR 0.00 · Cr NPR 0.00" : undefined;
  }, [balanceMap, accountBalances]);
  const ledgerOpts = useMemo<ReferenceOption[]>(() => lookups.ledgers.map((g) => ({ value: String(g.id), label: `${g.code} — ${g.name}`, code: g.code, name: g.name, detail: g.requiresSubLedger ? "Needs a party" : undefined, subtext: balanceText(g.id), isActive: g.isActive })), [lookups.ledgers, balanceText]);
  const agentOpts = useMemo<ReferenceOption[]>(() => lookups.agents.map((a) => ({ value: String(a.id), label: `${a.code} — ${a.name}`, code: a.code, name: a.name, isActive: a.isActive })), [lookups.agents]);
  const ledgers = useMemo(() => new Map(lookups.ledgers.map((g) => [String(g.id), g])), [lookups.ledgers]);

  const clearRow = (i: number) => clearError(...Object.keys(errors).filter((k) => k.startsWith(`L.${i}.`)), "lines");
  const patch = (i: number, p: Partial<JLine>) => { onChange(lines.map((l, k) => (k === i ? { ...l, ...p } : l))); clearRow(i); };

  // what the other lines leave to balance: positive = more Dr than Cr, so this line should take the credit
  const diffWithout = (i: number) => { const t = jTotals(lines.filter((_, k) => k !== i)); return t.dr - t.cr; };
  const balancing = (i: number): Partial<JLine> => {
    const d = diffWithout(i);
    return d === 0 ? {} : d > 0 ? { debit: "", credit: fmtAmt(d).replaceAll(",", "") } : { credit: "", debit: fmtAmt(-d).replaceAll(",", "") };
  };
  const pickLedger = (i: number, id: string) => {
    const l = lines[i], empty = !l.debit && !l.credit;
    patch(i, { glId: id, subId: "", ...(id && empty ? balancing(i) : {}) });
  };
  const balanceRow = (i: number) => {
    if (readOnly || !lines[i]) return;
    const b = balancing(i);
    if (!Object.keys(b).length) return;
    patch(i, b);
  };

  const addRow = (focus = true) => {
    onChange([...lines, blankJLine()]);
    if (focus) setTimeout(() => document.querySelector<HTMLElement>(`[data-field="L.${lines.length}.g"]`)?.focus(), 40);
  };
  const remove = (i: number, fromRowMode = false) => {
    const n = lines.filter((_, k) => k !== i);
    onChange(n.length >= 2 ? n : [...n, ...Array.from({ length: 2 - n.length }, () => blankJLine())]);
    if (fromRowMode) return;
    requestAnimationFrame(() => (document.querySelector<HTMLElement>(`[data-field="L.${Math.min(i, n.length - 1)}.g"]:not(:disabled)`) ?? document.querySelector<HTMLElement>('[data-nav="add-line"]:not(:disabled)'))?.focus());
  };
  const fillRow = (i: number) => { if (readOnly || i < 1) return; const next = fillDownRows(lines, [i], FILL); if (next) { onChange(next); clearRow(i); } };
  const fillCell = (i: number, col: string) => {
    const f = FIELD_OF[col], above = lines[i - 1];
    if (readOnly || !f || !above) return;
    patch(i, f === "glId" ? { glId: above.glId, subId: "" } : { [f]: above[f] } as Partial<JLine>);
  };

  const cellsOf = (root: Element | null) => Array.from(root?.querySelectorAll<HTMLElement>('[data-field^="L."]') ?? []).filter((el) => !(el as HTMLInputElement).disabled && el.getClientRects().length > 0);
  const rowOf = (el: Element) => { const m = /^L\.(\d+)\./.exec(el.getAttribute("data-field") ?? ""); return m ? Number(m[1]) : -1; };
  const gridRows = useGridRows({
    count: lines.length, readOnly,
    firstCell: (grid, r) => cellsOf(grid).find((c) => rowOf(c) === r) ?? null,
    cellOf: (el) => { const m = /^L\.(\d+)\.(\w+)$/.exec(el.getAttribute("data-field") ?? ""); return m ? { row: Number(m[1]), col: m[2] } : null; },
    onRemove: remove, onFillRow: fillRow, onFillCell: fillCell,
    cellSelector: '[data-field^="L."]', fieldOf: (r, c) => `L.${r}.${c}`, endOfRow: "continue",
    onAddRow: () => addRow(), lastRowBlank: () => isBlankJLine(lines[lines.length - 1]), leave: (el, dir) => focusStep(el, dir),
  });
  const rowSel = gridRows.rowSel;

  // F8 on any cell (or the highlighted row) of the grid: this line takes the amount that balances the voucher
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "F8" && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      const el = e.target as HTMLElement, row = el === e.currentTarget ? rowSel : rowOf(el);
      if (row !== null && row >= 0) { e.preventDefault(); e.stopPropagation(); balanceRow(row); }
      return;
    }
    gridRows.handleKey(e);
  };

  const t = jTotals(lines);
  const sideInput = (i: number, key: "debit" | "credit", col: "d" | "c", other: "debit" | "credit") => {
    const l = lines[i], bad = !!errors[`L.${i}.${col}`];
    return (
      <input data-field={`L.${i}.${col}`} disabled={readOnly} inputMode="decimal" autoComplete="off" value={l[key]} placeholder="0.00" aria-label={`${key === "debit" ? "Dr" : "Cr"} line ${i + 1}`}
        onChange={(e) => { const v = e.target.value; if (MONEY.test(v)) patch(i, v ? { [key]: v, [other]: "" } as Partial<JLine> : { [key]: v }); }}
        onFocus={(e) => e.currentTarget.select()}
        className={`fld h-8 text-right font-mono ${bad ? "fld-err" : ""} ${readOnly ? "bg-slate-100 text-slate-600" : ""}`} />
    );
  };

  return (
    <div className="lg-card lg-grid flex min-h-0 flex-col">
      <div className="lg-scroll min-h-0 overflow-auto outline-none" data-grid="lines" data-nav="lines-grid" {...gridRows.gridProps} onKeyDown={onKey} aria-label="Journal voucher lines">
        <div className="min-w-[1040px]">
          <div style={{ gridTemplateColumns: TEMPLATE }} className="lg-th xl-head">
            <span className="xl-rowhead">S.No</span><span>General Ledger</span><span>Party Subledger</span><span>Agent</span><span className="text-right">Dr.</span><span className="text-right">Cr.</span><span>Narration</span><span />
          </div>
          {lines.map((l, i) => {
            const g = ledgers.get(l.glId);
            const needsSub = !!g?.requiresSubLedger, subs = g ? lookups.subLedgers.filter((s) => s.generalLedgerId === g.id) : [];
            const subOpts: ReferenceOption[] = subs.map((s) => ({ value: String(s.id), label: `${s.code} — ${s.name}`, code: s.code, name: s.name, detail: g ? `For ${g.name}` : undefined, subtext: balanceText(g!.id, s.id), isActive: s.isActive }));
            const bad = (c: string) => !!errors[`L.${i}.${c}`];
            const msgs = Object.entries(errors).filter(([k, v]) => k.startsWith(`L.${i}.`) && v).map(([, v]) => v!);
            return (
              <div key={l.key} data-row={i} className={`border-b border-slate-100 transition-colors ${rowSel === i ? "bg-cobalt-50 ring-2 ring-inset ring-cobalt-700" : msgs.length ? "bg-rose-50" : "hover:bg-slate-50/80"}`}
                onMouseDown={(e) => {
                  if ((e.target as HTMLElement).closest("input, button, [role=\"combobox\"], textarea, select, a")) return;
                  const first = e.currentTarget.querySelector<HTMLElement>('[data-field^="L."]:not(:disabled)');
                  if (first) { e.preventDefault(); first.focus(); }
                }}>
                <div style={{ gridTemplateColumns: TEMPLATE }} data-selected={rowSel === i} className="xl-row">
                  <button type="button" className="xl-rowhead" {...gridRows.rowHeadProps(i)}>{i + 1}</button>
                  <MasterReferencePicker fieldName={`L.${i}.g`} label="General ledger" scopeKey="journal-ledgers" createMaster={{ key: "general-ledger" }} contextKey={contextKey} placeholder="Choose ledger…" value={l.glId} hasError={bad("g")}
                    options={ledgerOpts} disabled={readOnly} onChange={(v) => pickLedger(i, v)} onCommit={gridRows.afterCombo} />
                  <MasterReferencePicker fieldName={`L.${i}.s`} label="Party subledger" scopeKey="journal-parties" createMaster={needsSub ? { key: "sub-ledger", defaults: { generalLedgerId: l.glId } } : undefined}
                    contextKey={`${contextKey}:${l.glId || "none"}`} placeholder={!g ? "—" : needsSub ? (subOpts.length ? "Choose party…" : "None yet — Ctrl+M") : subOpts.length ? "Party (optional)" : "— not needed —"} value={l.subId} hasError={bad("s")}
                    required={needsSub} options={subOpts} disabled={readOnly || !g || (!needsSub && subOpts.length === 0)} onChange={(v) => patch(i, { subId: v })} onCommit={gridRows.afterCombo} />
                  <MasterReferencePicker fieldName={`L.${i}.a`} label="Agent" scopeKey="agents" createMaster={{ key: "agents" }} contextKey={contextKey} placeholder="—" value={l.agentId} hasError={bad("a")}
                    options={agentOpts} disabled={readOnly} onChange={(v) => patch(i, { agentId: v })} onCommit={gridRows.afterCombo} />
                  {sideInput(i, "debit", "d", "credit")}
                  {sideInput(i, "credit", "c", "debit")}
                  <input data-field={`L.${i}.n`} disabled={readOnly} maxLength={500} autoComplete="off" value={l.narration} placeholder="Narration" aria-label={`Narration line ${i + 1}`}
                    onChange={(e) => patch(i, { narration: e.target.value })} onFocus={(e) => e.currentTarget.select()} className={`fld h-8 ${readOnly ? "bg-slate-100 text-slate-600" : ""}`} />
                  <button type="button" data-nav="remove-line" disabled={readOnly} onClick={() => remove(i)} title="Remove line (Delete when the row is selected)" aria-label="Remove line"
                    className="grid h-8 w-8 place-items-center rounded text-slate-400 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-30"><X size={14} /></button>
                </div>
                {msgs.length > 0 && <p className="px-3 pb-1 text-[12px] text-rose-700">{msgs[0]}</p>}
              </div>
            );
          })}
        </div>
      </div>
      {errors.lines && <p className="px-3 py-1.5 text-[12px] text-rose-700" role="alert">{errors.lines}</p>}
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-200 bg-slate-50 px-3 py-2.5">
        {!readOnly && <button type="button" data-nav="add-line" className="btn" onClick={() => addRow()}><Plus size={13} /> Add line <span className="kbd">Ctrl+Enter</span></button>}
        {!readOnly && <span className="text-[12px] text-slate-500">F8 sets this line to the amount that balances the voucher</span>}
        <span className="flex-1" />
        <span className="text-[12.5px] text-slate-600">Lines <b className="font-semibold tabular-nums text-ink">{t.used}</b></span>
      </div>
    </div>
  );
}
