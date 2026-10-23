import type { ReactNode } from "react";
import { Pencil, Plus, Save, Search, Trash2, X } from "lucide-react";
import type { PListRow } from "../../api";
import { fmtPaise, toPaise } from "../../lib/money";
import type { DocScreen } from "../../screens/purchase/useDocScreen";
import { ConfirmDialog } from "../ConfirmDialog";
import { ShortcutsOverlay } from "../ShortcutsOverlay";

export const money = (s: unknown) => (s == null || s === "" ? "" : fmtPaise(toPaise(String(s))));
export const num = (s: unknown) => (s == null || s === "" ? "" : String(s).includes(".") ? String(s).replace(/0+$/, "").replace(/\.$/, "") : String(s));

const TONES: Record<string, string> = {
  green: "bg-green-100 text-green-800 border-green-300", amber: "bg-amber-100 text-amber-800 border-amber-300",
  red: "bg-red-100 text-red-800 border-red-300", slate: "bg-slate-100 text-slate-700 border-slate-300", blue: "bg-blue-100 text-blue-800 border-blue-300",
};
export function Pill({ text, tone = "slate" }: { text: string; tone?: keyof typeof TONES }) {
  return <span className={`text-[10px] font-semibold px-1.5 py-px border rounded-sm whitespace-nowrap ${TONES[tone]}`}>{text}</span>;
}

export function Field({ label, error, children, className = "", required }: { label: string; error?: string; children: ReactNode; className?: string; required?: boolean }) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-[11px] font-semibold text-slate-600 mb-0.5">{label}{required && <span className="text-red-600"> *</span>}</span>
      {children}
      {error && <span className="block text-[12px] text-red-700 mt-0.5">{error}</span>}
    </label>
  );
}

// Moves focus to the next / previous enabled field of the form (document order).
export function focusStep(el: Element, dir: 1 | -1) {
  const all = Array.from(document.querySelectorAll<HTMLElement>("[data-zone=form] [data-field]")).filter((x) => !(x as HTMLInputElement).disabled);
  const i = all.indexOf(el as HTMLElement);
  all[i + dir]?.focus();
}

interface ShellProps<F extends object> {
  s: DocScreen<F>;
  title: string;
  singular: string;
  branchName: string;
  fyCode: string;
  statusOptions: { value: string; label: string }[];
  pill?: ReactNode;
  notice?: ReactNode;
  canEdit: boolean;
  canDelete: boolean;
  actions?: ReactNode; // workflow buttons shown for a saved document (Approve, Confirm, Post ...)
  listRow: (r: PListRow) => ReactNode;
  help: [string, string][];
  children: ReactNode;
}

// The frame every purchase document screen sits in: heading, the form (children), the buttons, and the document list on the right.
export function DocShell<F extends object>({ s, title, singular, branchName, fyCode, statusOptions, pill, notice, canEdit, canDelete, actions, listRow, help, children }: ShellProps<F>) {
  const view = s.mode === "view";
  const onFormKey = (e: React.KeyboardEvent) => {
    const el = e.target as HTMLElement;
    if (e.key !== "Enter" || el.tagName !== "INPUT" || el.getAttribute("role") === "combobox" || !el.hasAttribute("data-field")) return;
    e.preventDefault();
    focusStep(el, e.shiftKey ? -1 : 1);
  };
  return (
    <>
      <main className="flex-1 min-w-0 flex min-h-0">
        <section className="flex-1 min-w-0 flex flex-col min-h-0">
          <div className="px-4 pt-3 pb-2 shrink-0">
            <div className="flex items-end gap-3 flex-wrap">
              <h1 className="text-[22px] font-semibold">{title}</h1>
              <span className="pb-1 text-slate-600">Branch: <b>{branchName}</b> · FY <b>{fyCode}</b></span>
              {pill && <span className="mb-1">{pill}</span>}
              {s.dirty && <span className="pb-1 text-[11px] text-amber-700">• unsaved changes</span>}
            </div>
            <div className="double-rule mt-1" />
            {notice}
          </div>
          <div data-zone="form" onKeyDown={onFormKey} className="flex-1 min-h-0 overflow-y-auto px-4 pb-3">
            {!s.lookups || !s.form ? <p className="text-slate-500 p-2">Loading…</p> : children}
          </div>
          <div className="shrink-0 border-t border-slate-400 bg-slate-50 px-4 py-2 flex items-center gap-2 flex-wrap">
            {!view ? (
              <>
                <button className="btn btn-primary" disabled={s.saving} onClick={() => void s.save()}><Save size={14} /> {s.mode === "edit" ? "Update" : "Save"} <span className="kbd">Ctrl+S</span></button>
                <button className="btn" onClick={s.cancel}><X size={14} /> Cancel <span className="kbd">Esc</span></button>
              </>
            ) : (
              <>
                <button className="btn" onClick={() => s.newDoc()}><Plus size={14} /> New <span className="kbd">F3</span></button>
                <button className="btn" disabled={!canEdit} onClick={s.edit}><Pencil size={14} /> Edit <span className="kbd">F2</span></button>
                <button className="btn" disabled={!canDelete} onClick={s.askDelete}><Trash2 size={14} /> Delete <span className="kbd">Ctrl+Del</span></button>
                {actions && <><span className="w-px h-6 bg-slate-300 mx-1" />{actions}</>}
              </>
            )}
          </div>
        </section>

        <aside data-zone="list" className="w-[330px] shrink-0 border-l border-slate-400 bg-white/50 flex flex-col min-h-0">
          <div className="p-2 border-b border-slate-300 space-y-1.5 shrink-0">
            <div className="relative">
              <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
              <input ref={s.searchRef} value={s.search} onChange={(e) => s.setSearch(e.target.value)} placeholder={`Search ${singular.toLowerCase()}s…  (F4)`} aria-label="Search" className="fld pl-7"
                onFocus={(e) => e.currentTarget.select()}
                onKeyDown={(e) => { if (e.key === "ArrowDown" || e.key === "Enter") { e.preventDefault(); document.querySelector<HTMLElement>("[data-zone=list] [data-row]")?.focus(); } else if (e.key === "Escape") { e.stopPropagation(); (e.target as HTMLElement).blur(); } }} />
            </div>
            <select value={s.statusFilter} onChange={(e) => s.setStatusFilter(e.target.value)} aria-label="Status filter" className="fld">
              <option value="">All statuses</option>
              {statusOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto" onKeyDown={(e) => {
            const rows = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[data-row]")), i = rows.indexOf(e.target as HTMLElement);
            if (e.key === "ArrowDown") { e.preventDefault(); rows[Math.min(i + 1, rows.length - 1)]?.focus(); }
            else if (e.key === "ArrowUp") { e.preventDefault(); if (i <= 0) s.searchRef.current?.focus(); else rows[i - 1].focus(); }
            else if (e.key === "Escape") { e.stopPropagation(); document.querySelector<HTMLElement>("[data-zone=form] [data-field]:not(:disabled)")?.focus(); }
          }}>
            {s.rows.length === 0 && <p className="p-3 text-slate-500 text-[12px]">No {singular.toLowerCase()}s found.</p>}
            {s.rows.map((r) => (
              <button key={r.id} data-row aria-selected={r.id === s.selectedId} onClick={() => s.select(r.id)}
                className={`w-full text-left px-2.5 py-1.5 border-b border-slate-200 hover:bg-blue-50 focus:outline-none focus:bg-blue-100 ${r.id === s.selectedId ? "bg-blue-100" : ""}`}>
                {listRow(r)}
              </button>
            ))}
          </div>
          <div className="shrink-0 px-2.5 py-1 border-t border-slate-300 text-[11px] text-slate-600">{s.rows.length === s.total ? `${s.total} ${singular.toLowerCase()}(s)` : `Showing ${s.rows.length} of ${s.total}`}</div>
        </aside>
      </main>
      {s.dialog && <ConfirmDialog spec={s.dialog} onClose={() => s.setDialog(null)} />}
      {s.help && <ShortcutsOverlay onClose={() => s.setHelp(false)} shortcuts={help} />}
    </>
  );
}

export const COMMON_HELP: [string, string][] = [
  ["Enter / Shift+Enter", "Next / previous field (last cell of the last line adds a line)"],
  ["Ctrl+S", "Save / Update"],
  ["F3 / Ctrl+N", "New document"],
  ["F2", "Edit the open document"],
  ["Ctrl+Delete", "Delete the open document (confirmation)"],
  ["Esc", "Cancel editing"],
  ["F4 / /", "Search the list"],
  ["Ctrl+↑ / Ctrl+↓", "Previous / next document"],
  ["Shift+Delete", "Remove the current line or term row"],
  ["Alt+1 / Alt+2 / Alt+3", "Sidebar / Form / List"],
  ["F1 / ?", "This help"],
];
export const HINTS = ["Enter: Next", "Ctrl+S: Save", "F3: New", "F2: Edit", "F4: Search", "F1: Help"];
