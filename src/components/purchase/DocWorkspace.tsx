import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { Plus, Search } from "lucide-react";
import { flushSync } from "react-dom";
import { useDialog } from "../Dialog";
import { ShortcutsOverlay } from "../ShortcutsOverlay";
import { useOnMasterChanged } from "../../lib/masterEvents";
import { adToBs } from "../../lib/nepaliDate";
import type { MsgKind, StatusInfo } from "../../types";
import { ContextChips } from "./Bits";
import { EmptyList, WorkspaceTabs } from "./WorkspaceTabs";
import type { DocSnapshot } from "../../screens/purchase/useDocScreen";

// A workspace for any document type: a tab strip with the document list first and one tab per document being entered or viewed.
// Only the open tab is on screen; the others keep their document in a snapshot and come back exactly as they were left.
// (The Purchase Bill and Journal Voucher workspaces predate this and carry their own copy of the same behaviour.)

export interface WorkspaceCtx {
  companyId: number; branchId: number; userId: number; branchName: string; fyCode: string; calendar: "BS" | "AD";
  setStatus: (s: StatusInfo) => void; dirtyRef: MutableRefObject<boolean>; externalMessage: { text: string; n: number } | null;
}

// What the workspace hands to the entry component that draws one tab.
export interface EntryTabProps<F extends object, L> {
  tabId: number;
  lookups: L;
  docId: number | null;
  initialForm?: F;
  hookSnapRef: MutableRefObject<DocSnapshot<F> | null>;
  externalMessage: { text: string; n: number } | null;
  onMeta: (tabId: number, meta: { title: string; dirty: boolean; docId: number | null }) => void;
  onNew: (prefill?: F) => void;
  onClose: (tabId: number) => void;
  onListChanged: () => void;
}

export interface WorkspaceColumn<R> { header: ReactNode; align?: "right"; cell: (row: R, dateText: (v: unknown) => string) => ReactNode }

export interface DocWorkspaceConfig<F extends object, R extends { id: number }, L> {
  plural: string;                       // "Purchase orders"
  singular: string;                     // "order"
  tabsLabel: string;                    // aria label of the tab strip
  icon: ReactNode;                      // shown when the list is empty
  grid: string;                         // tailwind grid-cols class shared by the header and every row
  minWidth: string;                     // tailwind min-w class
  columns: WorkspaceColumn<R>[];
  numberOf: (r: R) => string;           // the document number shown on its tab
  stateOf: (r: R) => string;
  deletableStates: string[];            // only these can be deleted from the list
  cannotDeleteText?: (no: string, state: string) => string;
  statusOptions: { value: string; label: string }[];
  searchPlaceholder: string;
  loadLookups: (companyId: number) => Promise<L>;
  list: (q: { companyId: number; branchId: number; fiscalYear: string; status?: string; search?: string }) => Promise<{ rows: R[]; total: number }>;
  remove: (id: number, companyId: number, userId: number) => Promise<unknown>;
}

interface EntryTab<F extends object> { id: number; docId: number | null; title: string; dirty: boolean; initialForm?: F }
type Active = "list" | number;

export default function DocWorkspace<F extends object, R extends { id: number }, L>({ cfg, ctx, renderEntry }: {
  cfg: DocWorkspaceConfig<F, R, L>; ctx: WorkspaceCtx; renderEntry: (e: EntryTabProps<F, L>) => ReactNode;
}) {
  const { singular, plural } = cfg;
  const Singular = singular.charAt(0).toUpperCase() + singular.slice(1);
  const [lookups, setLookups] = useState<L | null>(null);
  const [loadError, setLoadError] = useState("");
  const dlg = useDialog();
  useEffect(() => {
    let live = true;
    cfg.loadLookups(ctx.companyId).then((l) => { if (live) setLookups(l); }).catch((e: Error) => { if (live) { setLoadError(e.message); void dlg.error(e.message, { title: `Could not load the ${singular} screen` }); } });
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.companyId, dlg]);
  // A master record made with Ctrl+M on one of the form's pickers: reload the pick-lists so it is in them before the field is set.
  useOnMasterChanged(async () => {
    const l = await cfg.loadLookups(ctx.companyId);
    flushSync(() => setLookups(l));
  });

  // ---- the list ----
  const [rows, setRows] = useState<R[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [msg, setMsg] = useState<{ text: string; kind: MsgKind }>({ text: "Loading…", kind: "info" });
  const searchRef = useRef<HTMLInputElement>(null);
  const loadList = useCallback(async () => {
    try {
      const r = await cfg.list({ companyId: ctx.companyId, branchId: ctx.branchId, fiscalYear: ctx.fyCode, status: statusFilter || undefined, search: search.trim() || undefined });
      setRows(r.rows); setTotal(r.total); setMsg({ text: "Ready", kind: "info" });
    } catch (e) { setMsg({ text: (e as Error).message, kind: "err" }); void dlg.error((e as Error).message); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.companyId, ctx.branchId, ctx.fyCode, statusFilter, search, dlg]);
  useEffect(() => { const t = setTimeout(() => void loadList(), search ? 250 : 0); return () => clearTimeout(t); }, [loadList, search]);

  // Delete on a highlighted row: only a document in a deletable state can go, it must not be open in a tab, and the person is asked first.
  const deleteDoc = async (row: R) => {
    const no = cfg.numberOf(row), state = cfg.stateOf(row);
    if (!cfg.deletableStates.includes(state)) { void dlg.warning(cfg.cannotDeleteText?.(no, state) ?? `${Singular} ${no} is ${state.toLowerCase()} and cannot be deleted.`, { title: "Cannot delete" }); return; }
    if (tabsRef.current.some((t) => t.docId === row.id)) { void dlg.warning(`${Singular} ${no} is open in a tab. Close that tab first.`, { title: "Cannot delete" }); return; }
    if (!(await dlg.confirm(`Delete ${singular} ${no}? This cannot be undone.`, { title: `Delete ${singular}?`, variant: "danger", confirmLabel: "Delete" }))) return;
    try { await cfg.remove(row.id, ctx.companyId, ctx.userId); setMsg({ text: `Deleted ${no}`, kind: "ok" }); await loadList(); }
    catch (e) { void dlg.error((e as Error).message); }
  };

  // ---- tabs ----
  const [tabs, setTabs] = useState<EntryTab<F>[]>([]);
  const [active, setActive] = useState<Active>("list");
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeRef = useRef(active);
  activeRef.current = active;
  const nextId = useRef(1);
  const snaps = useRef(new Map<number, MutableRefObject<DocSnapshot<F> | null>>());
  const snapOf = (id: number) => {
    let s = snaps.current.get(id);
    if (!s) { s = { current: null }; snaps.current.set(id, s); }
    return s;
  };

  const addTab = useCallback((t: Pick<EntryTab<F>, "docId"> & Partial<Pick<EntryTab<F>, "title" | "initialForm">>) => {
    const id = nextId.current++;
    setTabs((cur) => [...cur, { id, docId: t.docId, title: t.title ?? `New ${singular}`, dirty: false, initialForm: t.initialForm }]);
    setActive(id);
  }, [singular]);
  const openNew = useCallback((prefill?: F) => addTab({ docId: null, initialForm: prefill }), [addTab]);
  const openDoc = useCallback((row: R) => {
    const open = tabsRef.current.find((t) => t.docId === row.id);
    if (open) setActive(open.id);
    else addTab({ docId: row.id, title: cfg.numberOf(row) });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addTab]);
  const closeTab = useCallback(async (id: number, force = false) => {
    if (!force && tabsRef.current.find((t) => t.id === id)?.dirty
      && !(await dlg.confirm(`This ${singular} has unsaved changes. Close the tab and lose them?`, { title: "Close this tab?", variant: "warning", confirmLabel: "Close tab", cancelLabel: "Keep editing" }))) return;
    const list = tabsRef.current, at = list.findIndex((t) => t.id === id); // read again: the tabs may have changed while the question was open
    if (at < 0) return;
    snaps.current.delete(id);
    setTabs(list.filter((t) => t.id !== id));
    if (activeRef.current === id) setActive(list[at - 1]?.id ?? list[at + 1]?.id ?? "list");
  }, [dlg, singular]);
  const onMeta = useCallback((id: number, meta: { title: string; dirty: boolean; docId: number | null }) => {
    setTabs((cur) => {
      let changed = false;
      const next = cur.map((t) => {
        if (t.id !== id || (t.title === meta.title && t.dirty === meta.dirty && t.docId === meta.docId)) return t;
        changed = true;
        return { ...t, ...meta };
      });
      return changed ? next : cur;
    });
  }, []);

  // the app asks before switching screen / company / branch / year: tell it whether any tab has unsaved work
  const anyDirty = tabs.some((t) => t.dirty);
  useEffect(() => { ctx.dirtyRef.current = anyDirty; });
  useEffect(() => () => { ctx.dirtyRef.current = false; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!anyDirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [anyDirty]);

  // ---- shortcuts that belong to the tab strip ----
  const [help, setHelp] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = ["INPUT", "TEXTAREA", "SELECT"].includes((e.target as HTMLElement).tagName);
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.code === "Comma" || e.code === "Period")) {
        e.preventDefault();
        const order: Active[] = ["list", ...tabsRef.current.map((t) => t.id)];
        const at = order.indexOf(activeRef.current);
        setActive(order[(at + (e.code === "Period" ? 1 : -1) + order.length) % order.length]);
      } else if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === "KeyW") {
        if (typeof activeRef.current === "number") { e.preventDefault(); void closeTab(activeRef.current); }
      } else if (activeRef.current === "list") {
        const ctrl = e.ctrlKey || e.metaKey;
        if ((ctrl && e.key.toLowerCase() === "n") || e.key === "F3") { e.preventDefault(); openNew(); }
        else if (e.key === "F4" || (ctrl && e.key.toLowerCase() === "f") || (e.key === "/" && !typing)) { e.preventDefault(); searchRef.current?.focus(); }
        else if (e.key === "F1" || (e.key === "?" && !typing)) { e.preventDefault(); setHelp(true); }
        else if (e.key === "Escape" && help) setHelp(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeTab, openNew, help]);

  // status bar while the list is open (a document tab sets its own)
  const listHints = [`F3: New ${singular}`, "Enter: Open", "Del: Delete", "/: Search", "Alt+, Alt+.: Tabs", "F1: Help"];
  useEffect(() => {
    if (active === "list") ctx.setStatus({ mode: "view", count: total, shown: rows.length, message: msg.text, kind: msg.kind, hints: listHints });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, total, rows.length, msg, ctx.setStatus]);
  const listHelp: [string, string][] = [
    ["F3 / Ctrl+N", `New ${singular} in a new tab`],
    ["Enter", `Open the highlighted ${singular} in its own tab (one already open is just shown)`],
    ["↑ / ↓", "Move through the list"],
    ["Delete", `Delete the highlighted ${singular} (asks first; only ${cfg.deletableStates.map((s) => s.toLowerCase()).join(" / ")} can be deleted)`],
    ["/ or F4 or Ctrl+F", "Search the list"],
    ["Alt+, / Alt+.", "Previous / next tab"],
    ["Alt+W", `Close the open ${singular} tab`],
    ["F1 / ?", "This help"],
  ];

  const mountedAt = useMemo(() => Date.now(), [active]); // eslint-disable-line react-hooks/exhaustive-deps
  const note = ctx.externalMessage && ctx.externalMessage.n >= mountedAt ? ctx.externalMessage : null;
  const dateText = (v: unknown) => { const s = String(v ?? "").slice(0, 10); return ctx.calendar === "BS" ? (adToBs(s) ?? s) : s; };
  const activeTab = typeof active === "number" ? tabs.find((t) => t.id === active) : undefined;
  const statusTabs = [{ value: "", label: "All" }, ...cfg.statusOptions];

  return (
    <main className="ledger flex min-h-0 min-w-0 flex-1 flex-col">
      <WorkspaceTabs ariaLabel={cfg.tabsLabel} listLabel={`${Singular} list`} listCount={total} active={active} onList={() => setActive("list")}
        tabs={tabs} onSelect={setActive} onClose={(id) => void closeTab(id)} onNew={() => openNew()} newTitle={`New ${singular} in a new tab (F3)`} />

      {loadError ? <p className="p-5 text-rose-700">{loadError}</p>
        : !lookups ? <p className="p-5 text-slate-500">Loading…</p>
        : activeTab ? (
          <div key={activeTab.id} className="flex min-h-0 min-w-0 flex-1">
            {renderEntry({
              tabId: activeTab.id, lookups, docId: activeTab.docId, initialForm: activeTab.initialForm, hookSnapRef: snapOf(activeTab.id), externalMessage: note,
              onMeta, onNew: openNew, onClose: (id) => void closeTab(id, true), onListChanged: () => void loadList(),
            })}
          </div>
        ) : (
          <section data-purchase-document className="flex min-h-0 flex-1 flex-col gap-4 px-6 py-5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h1 className="lg-title">{plural}</h1>
              <ContextChips branchName={ctx.branchName} fyCode={ctx.fyCode} />
              <span className="flex-1" />
              <button type="button" className="btn btn-primary h-9 px-4" onClick={() => openNew()}><Plus size={15} /> New {singular} <span className="kbd">F3</span></button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative w-full max-w-[380px]">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input ref={searchRef} value={search} onChange={(e) => setSearch(e.target.value)} placeholder={cfg.searchPlaceholder} aria-label={`Search ${plural.toLowerCase()}`} className="fld h-9 min-w-0 pl-9"
                  onFocus={(e) => e.currentTarget.select()}
                  onKeyDown={(e) => { if (e.key === "ArrowDown" || e.key === "Enter") { e.preventDefault(); document.querySelector<HTMLElement>("[data-zone=list] [data-row]")?.focus(); } else if (e.key === "Escape") { e.stopPropagation(); (e.target as HTMLElement).blur(); } }} />
              </div>
              <div role="group" aria-label="Status filter" className="inline-flex flex-wrap gap-0.5 rounded-lg bg-slate-200/70 p-0.5">
                {statusTabs.map((o) => {
                  const on = statusFilter === o.value;
                  return (
                    <button key={o.value || "all"} type="button" aria-pressed={on} onClick={() => setStatusFilter(o.value)}
                      className={`h-8 rounded-md px-3 text-[12.5px] transition-colors ${on ? "bg-white font-semibold text-ink shadow-sm" : "text-slate-600 hover:text-ink"}`}>{o.label}</button>
                  );
                })}
              </div>
              <span className="text-[12.5px] text-slate-500">{rows.length === total ? `${total} ${total === 1 ? singular : `${singular}s`}` : `Showing ${rows.length} of ${total}`}</span>
            </div>
            <div data-zone="list" className="lg-card lg-scroll min-h-0 flex-1 overflow-auto"
              onKeyDown={(e) => {
                const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[data-row]")), i = items.indexOf(e.target as HTMLElement);
                if (e.key === "ArrowDown") { e.preventDefault(); items[Math.min(i + 1, items.length - 1)]?.focus(); }
                else if (e.key === "ArrowUp") { e.preventDefault(); if (i <= 0) searchRef.current?.focus(); else items[i - 1].focus(); }
                else if (e.key === "Delete" && i >= 0 && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); void deleteDoc(rows[i]); }
              }}>
              <div className={`lg-th xl-head ${cfg.minWidth} ${cfg.grid}`}>
                {cfg.columns.map((c, i) => <span key={i} className={c.align === "right" ? "text-right" : undefined}>{c.header}</span>)}
              </div>
              {rows.length === 0 && <EmptyList icon={cfg.icon} title={search || statusFilter ? `No ${plural.toLowerCase()} match` : `No ${plural.toLowerCase()} in this branch and year yet`} hint={search || statusFilter ? "Try a different search or status." : `Press F3 to enter the first ${singular}.`} />}
              {rows.map((r) => (
                <button key={r.id} type="button" data-row onClick={() => openDoc(r)} className={`lg-row xl-row ${cfg.minWidth} ${cfg.grid}`}>
                  {cfg.columns.map((c, i) => <span key={i} className={c.align === "right" ? "text-right" : undefined}>{c.cell(r, dateText)}</span>)}
                </button>
              ))}
            </div>
          </section>
        )}
      {help && active === "list" && <ShortcutsOverlay onClose={() => setHelp(false)} shortcuts={listHelp} />}
    </main>
  );
}
