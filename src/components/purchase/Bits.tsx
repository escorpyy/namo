import type { ReactNode } from "react";
import { CalendarDays, Check, MapPin, Pencil, PanelRightClose, PanelRightOpen, Plus, Save, Search, Trash2, X } from "lucide-react";
import type { PListRow } from "../../api";
import { fmtPaise, toPaise } from "../../lib/money";
import type { DocScreen } from "../../screens/purchase/useDocScreen";
import { Dialog } from "../Dialog";
import { ShortcutsOverlay } from "../ShortcutsOverlay";

export const money = (s: unknown) => (s == null || s === "" ? "" : fmtPaise(toPaise(String(s))));
export const num = (s: unknown) => (s == null || s === "" ? "" : String(s).includes(".") ? String(s).replace(/0+$/, "").replace(/\.$/, "") : String(s));

/** Indian digit grouping (12,34,567.80) for a plain decimal string, without going through floating point. Anything that is not a plain number is returned unchanged. */
export const groupIN = (s: string): string => {
  const m = /^(-?)(\d+)(\.\d+)?$/.exec(String(s).trim());
  if (!m) return String(s);
  const [, sign, int, frac = ""] = m;
  const tail = int.slice(-3), head = int.slice(0, -3);
  return sign + (head ? `${head.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${tail}` : tail) + frac;
};
/** A date column that arrives as a full timestamp ("2026-03-15T00:00:00.000Z") shown as the date only. */
export const dateOnly = (v: unknown) => String(v ?? "").slice(0, 10);

const TONES: Record<string, string> = {
  green: "bg-emerald-50 text-emerald-800 ring-emerald-200", amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-rose-50 text-rose-800 ring-rose-200", slate: "bg-slate-100 text-slate-700 ring-slate-200", blue: "bg-cobalt-50 text-cobalt-800 ring-cobalt-200",
};
export function Pill({ text, tone = "slate" }: { text: string; tone?: keyof typeof TONES }) {
  return <span className={`lg-pill ${TONES[tone]}`}>{text.charAt(0).toUpperCase() + text.slice(1).toLowerCase()}</span>;
}

export function Field({ label, error, children, className = "", required }: { label: string; error?: string; children: ReactNode; className?: string; required?: boolean }) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="mb-1 block break-words text-[12px] font-medium leading-snug text-slate-600">{label}{required && <span className="text-rose-600"> *</span>}</span>
      {children}
      {error && <span className="mt-1 block text-[12px] text-rose-700">{error}</span>}
    </label>
  );
}

/** Grouping card for a dense document header: a quiet title bar, then the fields. */
export function FormSection({ title, hint, children, className = "" }: { title: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`lg-card ${className}`}>
      <header className="lg-card-head">
        <h2 className="lg-card-title">{title}</h2>
        {hint && <p className="lg-card-hint">{hint}</p>}
      </header>
      <div className="px-4 py-3.5">{children}</div>
    </section>
  );
}

/** Branch and fiscal year the document belongs to, as two small chips. */
export function ContextChips({ branchName, fyCode }: { branchName: string; fyCode: string }) {
  return (
    <>
      <span className="lg-chip" title="Branch"><MapPin size={12} className="text-slate-400" /><b>{branchName}</b></span>
      <span className="lg-chip" title="Fiscal year"><CalendarDays size={12} className="text-slate-400" />FY <b>{fyCode}</b></span>
    </>
  );
}

/** The title band of a document: what it is, its number and state, where it belongs, and (for a new one) how far along the entry is. */
export function DocHeader({ title, number, pill, branchName, fyCode, dirty, steps, right }: {
  title: string; number?: string; pill?: ReactNode; branchName: string; fyCode: string; dirty?: boolean;
  steps?: { labels: string[]; current: number }; right?: ReactNode;
}) {
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 bg-white px-5 py-3">
      <h1 className="lg-title">{title}{number && <span className="ml-2.5 font-mono text-[19px] font-semibold text-cobalt-800">{number}</span>}</h1>
      {pill}
      <ContextChips branchName={branchName} fyCode={fyCode} />
      {dirty && <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-amber-700"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" />Unsaved changes</span>}
      <span className="min-w-0 flex-1" />
      {steps && <Stepper labels={steps.labels} current={steps.current} />}
      {right}
    </header>
  );
}

/** A real sequence (header first, then the lines or charges), so the steps are numbered. */
export function Stepper({ labels, current }: { labels: string[]; current: number }) {
  return (
    <ol aria-label="Entry progress" className="flex items-center gap-2 text-[12px]">
      {labels.map((label, i) => {
        const done = i < current, active = i === current;
        return (
          <li key={label} aria-current={active ? "step" : undefined} className="flex items-center gap-2">
            {i > 0 && <span aria-hidden className={`h-px w-7 ${done || active ? "bg-cobalt-700" : "bg-slate-300"}`} />}
            <span className={`grid h-5 w-5 place-items-center rounded-full text-[11px] font-semibold ${done ? "bg-cobalt-700 text-white" : active ? "bg-cobalt-50 text-cobalt-800 ring-1 ring-cobalt-700" : "bg-slate-100 text-slate-500"}`}>
              {done ? <Check size={11} strokeWidth={3} /> : i + 1}
            </span>
            <span className={active ? "font-semibold text-ink" : done ? "text-slate-700" : "text-slate-500"}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

// Moves focus through non-destructive purchase controls in document order. Row deletion stays on native Tab/Shift+Tab and its explicit shortcut.
export function focusStep(el: Element, dir: 1 | -1) {
  const root = el.closest<HTMLElement>("[data-purchase-document], [data-assessment-document]") ?? document;
  const all = Array.from(root.querySelectorAll<HTMLElement>("[data-field], [data-nav]:not([data-nav='remove-line']):not([data-nav='remove-term'])"))
    .filter((x) => {
      const focusable = x.matches("input:not([type=hidden]), select, textarea, button, [tabindex]:not([tabindex='-1'])");
      const enabled = !("disabled" in x && (x as HTMLInputElement).disabled);
      return focusable && enabled && x.getAttribute("aria-hidden") !== "true" && !x.closest("[aria-hidden='true']") && x.getClientRects().length > 0;
    });
  const i = all.indexOf(el as HTMLElement);
  const next = all[i + dir];
  if (!next) return false;
  next.focus();
  next.scrollIntoView({ block: "nearest", inline: "nearest" });
  return true;
}

// Enter / Shift+Enter walks the fields of a purchase form in document order (Ctrl+Enter from a multi-line field).
export function formEnterKey(e: React.KeyboardEvent) {
  const el = e.target as HTMLElement;
  if (e.key !== "Enter" || el.getAttribute("role") === "combobox" || !el.hasAttribute("data-field")) return;
  if (el instanceof HTMLTextAreaElement) {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    focusStep(el, e.shiftKey ? -1 : 1);
    return;
  }
  if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement)) return;
  e.preventDefault();
  focusStep(el, e.shiftKey ? -1 : 1);
}

interface ShellProps<F extends object> {
  s: DocScreen<F>;
  title: string;
  singular: string;
  number?: string; // shown beside the title (a saved document in a workspace tab)
  branchName: string;
  fyCode: string;
  statusOptions: { value: string; label: string }[];
  pill?: ReactNode;
  notice?: ReactNode;
  canEdit: boolean;
  canDelete: boolean;
  actions?: ReactNode; // workflow buttons shown for a saved document (Approve, Confirm, Post ...)
  listRow?: (r: PListRow) => ReactNode; // not needed in a workspace tab: the workspace owns the list
  help: [string, string][];
  children: ReactNode;
}

// The frame every purchase document screen sits in: heading, the form (children), the buttons, and the document list on the right.
export function DocShell<F extends object>({ s, title, singular, number, branchName, fyCode, statusOptions, pill, notice, canEdit, canDelete, actions, listRow, help, children }: ShellProps<F>) {
  const view = s.mode === "view";
  const onFormKey = formEnterKey;
  const Root = s.tabbed ? "div" : "main"; // inside a workspace tab the workspace already is the <main>
  return (
    <>
      <Root className="ledger flex min-h-0 min-w-0 flex-1">
        <section data-purchase-document className="flex min-h-0 min-w-0 flex-1 flex-col">
          <DocHeader title={title} number={number} pill={pill} branchName={branchName} fyCode={fyCode} dirty={s.dirty} />
          {notice && <div className="shrink-0 px-5 pt-3">{notice}</div>}
          <div data-zone="form" onKeyDown={onFormKey} className="lg-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {!s.lookups || !s.form ? <p className="p-2 text-slate-500">Loading…</p> : children}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-slate-200 bg-white px-5 py-2.5">
            {!view ? (
              <>
                <button data-nav className="btn btn-primary" disabled={s.saving} onClick={() => void s.save()}><Save size={14} /> {s.mode === "edit" ? "Update" : "Save"} <span className="kbd">Ctrl+S</span></button>
                <button data-nav className="btn" onClick={s.cancel}><X size={14} /> Cancel <span className="kbd">Esc</span></button>
              </>
            ) : (
              <>
                <button data-nav className="btn" onClick={() => s.newDoc()}><Plus size={14} /> New <span className="kbd">F3</span></button>
                <button data-nav className="btn" disabled={!canEdit} onClick={s.edit}><Pencil size={14} /> Edit <span className="kbd">F2</span></button>
                <button data-nav className="btn" disabled={!canDelete} onClick={s.askDelete}><Trash2 size={14} /> Delete <span className="kbd">Ctrl+Del</span></button>
                {actions && <><span className="mx-1 h-6 w-px bg-slate-200" />{actions}</>}
              </>
            )}
          </div>
        </section>

        {!s.tabbed && <aside id="purchase-document-list" data-zone="list" aria-label={`${title} document list`} className={`${s.listCollapsed ? "w-11" : "w-[min(340px,32vw)] min-w-[250px]"} flex min-h-0 shrink-0 flex-col overflow-hidden border-l border-slate-200 bg-white transition-[width] duration-150`}>
          {s.listCollapsed ? (
            <div className="flex flex-col items-center gap-2 pt-2.5">
              <button data-list-toggle type="button" onClick={s.toggleList} aria-expanded={false} aria-controls="purchase-document-list" aria-label={`Expand ${singular.toLowerCase()} list (Alt+4)`} title={`Expand ${singular.toLowerCase()} list (Alt+4)`}
                className="grid h-8 w-8 place-items-center rounded-md text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-cobalt-700">
                <PanelRightOpen size={17} />
              </button>
              <span className="text-[11px] font-medium tabular-nums text-slate-500 [writing-mode:vertical-rl]" title={`${s.total} ${singular.toLowerCase()}s`}>{s.total}</span>
            </div>
          ) : (
            <>
              <div className="shrink-0 space-y-2 border-b border-slate-100 p-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="flex items-center gap-2 text-[13px] font-semibold text-ink">{title} list <span className="lg-count">{s.total}</span></h2>
                  <button data-list-toggle type="button" onClick={s.toggleList} aria-expanded={true} aria-controls="purchase-document-list" aria-label={`Collapse ${singular.toLowerCase()} list (Alt+4)`} title={`Collapse ${singular.toLowerCase()} list (Alt+4)`}
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-cobalt-700">
                    <PanelRightClose size={16} />
                  </button>
                </div>
                <div className="relative">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input ref={s.searchRef} value={s.search} onChange={(e) => s.setSearch(e.target.value)} placeholder={`Search ${singular.toLowerCase()}s…  (F4)`} aria-label={`Search ${singular.toLowerCase()}s`} className="fld min-w-0 pl-8"
                    onFocus={(e) => e.currentTarget.select()}
                    onKeyDown={(e) => { if (e.key === "ArrowDown" || e.key === "Enter") { e.preventDefault(); document.querySelector<HTMLElement>("[data-zone=list] [data-row]")?.focus(); } else if (e.key === "Escape") { e.stopPropagation(); (e.target as HTMLElement).blur(); } }} />
                </div>
                <select value={s.statusFilter} onChange={(e) => s.setStatusFilter(e.target.value)} aria-label="Status filter" className="fld min-w-0">
                  <option value="">All statuses</option>
                  {statusOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div className="lg-scroll min-h-0 flex-1 overflow-y-auto" onKeyDown={(e) => {
                const rows = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[data-row]")), i = rows.indexOf(e.target as HTMLElement);
                if (e.key === "ArrowDown") { e.preventDefault(); rows[Math.min(i + 1, rows.length - 1)]?.focus(); }
                else if (e.key === "ArrowUp") { e.preventDefault(); if (i <= 0) s.searchRef.current?.focus(); else rows[i - 1].focus(); }
                else if (e.key === "Delete" && i >= 0 && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) { // first press selects the row, the next one asks to delete it
                  e.preventDefault(); e.stopPropagation();
                  const r = s.rows[i];
                  if (r.id !== s.selectedId) s.select(r.id); else s.askDelete();
                }
                else if (e.key === "Escape") { e.stopPropagation(); document.querySelector<HTMLElement>("[data-zone=form] [data-field]:not(:disabled)")?.focus(); }
              }}>
                {s.rows.length === 0 && <p className="p-4 text-[12px] text-slate-500">No {singular.toLowerCase()}s found.</p>}
                {s.rows.map((r) => (
                  <button key={r.id} data-row aria-selected={r.id === s.selectedId} onClick={() => s.select(r.id)} className="lg-row min-w-0 break-words px-3.5 py-2.5">
                    {listRow?.(r)}
                  </button>
                ))}
              </div>
              <div className="shrink-0 break-words border-t border-slate-100 px-3.5 py-1.5 text-[12px] text-slate-500">{s.rows.length === s.total ? `${s.total} ${singular.toLowerCase()}(s)` : `Showing ${s.rows.length} of ${s.total}`}</div>
            </>
          )}
        </aside>}
      </Root>
      {s.dialog && <Dialog spec={s.dialog} onClose={() => s.setDialog(null)} />}
      {s.help && <ShortcutsOverlay onClose={() => s.setHelp(false)} shortcuts={help} />}
    </>
  );
}

export const COMMON_HELP: [string, string][] = [
  ["Enter / Shift+Enter", "Next / previous field (skips disabled controls; last cell adds a line or term)"],
  ["Space / ↓ / F4", "Open a lookup or combobox list (Enter never opens it)"],
  ["Backspace / Delete", "Clear an optional lookup or combobox value"],
  ["Ctrl+M (on a lookup)", "Create the vendor, product, unit… the field refers to, without leaving the document; it is selected once saved"],
  ["Tab / Shift+Tab", "Navigate every control, including row actions"],
  ["Ctrl+Enter / Ctrl+Shift+Enter", "Next / previous field from a multi-line field"],
  ["Ctrl+S", "Save / Update"],
  ["F3 / Ctrl+N", "New document"],
  ["F2", "Edit the open document"],
  ["Ctrl+Delete", "Delete the open document (confirmation)"],
  ["Esc", "Close a list / cancel editing"],
  ["F4 / /", "Search the document list"],
  ["Ctrl+↑ / Ctrl+↓", "Previous / next document"],
  ["Delete (row selected)", "Remove the selected line / term row (click its row number, or press Esc in a cell, to select the row)"],
  ["Shift+Delete", "Remove the current line or term row from inside a cell"],
  ["Ctrl+D", "Fill down: copy the cell above (in a cell) or the row above (row selected)"],
  ["Alt+1 / Alt+2 / Alt+3", "Sidebar / Form / List"],
  ["Alt+4", "Expand / collapse the purchase document list"],
  ["F1 / ?", "This help"],
];
export const HINTS = ["Enter: Next", "Shift+Enter: Previous", "Space/↓: Open list", "Ctrl+S: Save", "F3: New", "F2: Edit", "F4: Search", "F1: Help"];
