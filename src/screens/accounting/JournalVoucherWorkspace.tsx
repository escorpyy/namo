import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { BookOpen, Plus, Search } from "lucide-react";
import { flushSync } from "react-dom";
import { journalApi, type JListRow, type JLookups } from "../../api";
import { useDialog } from "../../components/Dialog";
import { ContextChips, Pill, money } from "../../components/purchase/Bits";
import { EmptyList, WorkspaceTabs } from "../../components/purchase/WorkspaceTabs";
import { ShortcutsOverlay } from "../../components/ShortcutsOverlay";
import { useOnMasterChanged } from "../../lib/masterEvents";
import { adToBs } from "../../lib/nepaliDate";
import type { MsgKind } from "../../types";
import JournalVoucherEntry, { J_OPTIONS, J_TONE } from "./JournalVoucherEntry";
import type { PurchaseScreenProps } from "../purchase/PurchaseOrderScreen";
import type { DocSnapshot } from "../purchase/useDocScreen";
import type { JForm } from "../../lib/journalForm";

// The Journal Voucher screen (same workspace as the Purchase Bill screen): a tab strip with the bill list first and one tab per bill being entered or viewed.
// Only the open tab is on screen; the others keep their document in a snapshot and come back exactly as they were left.

interface EntryTab { id: number; docId: number | null; title: string; dirty: boolean; initialForm?: JForm }
type Active = "list" | number;
interface TabSnap { hook: MutableRefObject<DocSnapshot<JForm> | null> }

const LIST_HINTS = ["F3: New voucher", "Enter: Open", "Del: Delete draft", "/: Search", "Alt+, Alt+.: Tabs", "F1: Help"];
const LIST_HELP: [string, string][] = [
  ["F3 / Ctrl+N", "New voucher in a new tab"],
  ["Enter", "Open the highlighted voucher in its own tab (one already open is just shown)"],
  ["↑ / ↓", "Move through the list"],
  ["Delete", "Delete the highlighted draft voucher (asks first; posted vouchers are reversed, not deleted)"],
  ["/ or F4 or Ctrl+F", "Search the list"],
  ["Alt+, / Alt+.", "Previous / next tab"],
  ["Alt+W", "Close the open voucher tab"],
  ["F1 / ?", "This help"],
];

export default function JournalVoucherWorkspace(p: PurchaseScreenProps & { companyName: string }) {
  const [lookups, setLookups] = useState<JLookups | null>(null);
  const [loadError, setLoadError] = useState("");
  const dlg = useDialog();
  useEffect(() => {
    let live = true;
    journalApi.lookups(p.companyId).then((l) => { if (live) setLookups(l); }).catch((e: Error) => { if (live) { setLoadError(e.message); void dlg.error(e.message, { title: "Could not load the journal voucher screen" }); } });
    return () => { live = false; };
  }, [p.companyId, dlg]);
  // A master record made with Ctrl+M on one of the bill's pickers: reload the pick-lists so it is in them before the field is set.
  useOnMasterChanged(async () => {
    const l = await journalApi.lookups(p.companyId);
    flushSync(() => setLookups(l));
  });

  // ---- the list ----
  const [rows, setRows] = useState<JListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [msg, setMsg] = useState<{ text: string; kind: MsgKind }>({ text: "Loading…", kind: "info" });
  const searchRef = useRef<HTMLInputElement>(null);
  const loadList = useCallback(async () => {
    try {
      const r = await journalApi.list({ companyId: p.companyId, branchId: p.branchId, fiscalYear: p.fyCode, status: statusFilter || undefined, search: search.trim() || undefined });
      setRows(r.rows); setTotal(r.total); setMsg({ text: "Ready", kind: "info" });
    } catch (e) { setMsg({ text: (e as Error).message, kind: "err" }); void dlg.error((e as Error).message); }
  }, [p.companyId, p.branchId, p.fyCode, statusFilter, search, dlg]);
  useEffect(() => { const t = setTimeout(() => void loadList(), search ? 250 : 0); return () => clearTimeout(t); }, [loadList, search]);

  // Delete on a highlighted row: only a draft can go, it must not be open in a tab, and the person is asked first.
  const deleteDraft = async (row: JListRow) => {
    const no = row.voucherNumber;
    if (String(row.state) !== "DRAFT") { void dlg.warning(`Voucher ${no} is ${String(row.state).toLowerCase()}; only a draft can be deleted. Reverse a posted voucher instead.`, { title: "Cannot delete" }); return; }
    if (tabsRef.current.some((t) => t.docId === row.id)) { void dlg.warning(`Voucher ${no} is open in a tab. Close that tab first.`, { title: "Cannot delete" }); return; }
    if (!(await dlg.confirm(`Delete draft voucher ${no}? This cannot be undone.`, { title: "Delete draft voucher?", variant: "danger", confirmLabel: "Delete" }))) return;
    try { await journalApi.remove(row.id, p.companyId, p.userId); setMsg({ text: `Deleted ${no}`, kind: "ok" }); await loadList(); }
    catch (e) { void dlg.error((e as Error).message); }
  };

  // ---- tabs ----
  const [tabs, setTabs] = useState<EntryTab[]>([]);
  const [active, setActive] = useState<Active>("list");
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeRef = useRef(active);
  activeRef.current = active;
  const nextId = useRef(1);
  const snaps = useRef(new Map<number, TabSnap>());
  const snapOf = (id: number): TabSnap => {
    let s = snaps.current.get(id);
    if (!s) { s = { hook: { current: null } }; snaps.current.set(id, s); }
    return s;
  };

  const addTab = useCallback((t: Pick<EntryTab, "docId"> & Partial<Pick<EntryTab, "title" | "initialForm">>) => {
    const id = nextId.current++;
    setTabs((cur) => [...cur, { id, docId: t.docId, title: t.title ?? "New voucher", dirty: false, initialForm: t.initialForm }]);
    setActive(id);
  }, []);
  const openNew = useCallback((prefill?: JForm) => addTab({ docId: null, initialForm: prefill }), [addTab]);
  const openDocId = useCallback((id: number, title = "Voucher") => {
    const open = tabsRef.current.find((t) => t.docId === id);
    if (open) setActive(open.id);
    else addTab({ docId: id, title });
  }, [addTab]);
  const closeTab = useCallback(async (id: number, force = false) => {
    if (!force && tabsRef.current.find((t) => t.id === id)?.dirty
      && !(await dlg.confirm("This voucher has unsaved changes. Close the tab and lose them?", { title: "Close this tab?", variant: "warning", confirmLabel: "Close tab", cancelLabel: "Keep editing" }))) return;
    const list = tabsRef.current, at = list.findIndex((t) => t.id === id); // read again: the tabs may have changed while the question was open
    if (at < 0) return;
    snaps.current.delete(id);
    setTabs(list.filter((t) => t.id !== id));
    if (activeRef.current === id) setActive(list[at - 1]?.id ?? list[at + 1]?.id ?? "list");
  }, [dlg]);
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
  useEffect(() => { p.dirtyRef.current = anyDirty; });
  useEffect(() => () => { p.dirtyRef.current = false; }, []);
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
        if (typeof activeRef.current === "number") { e.preventDefault(); closeTab(activeRef.current); }
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

  // status bar while the list is open (a bill tab sets its own)
  useEffect(() => {
    if (active === "list") p.setStatus({ mode: "view", count: total, shown: rows.length, message: msg.text, kind: msg.kind, hints: LIST_HINTS });
  }, [active, total, rows.length, msg, p.setStatus]);

  const mountedAt = useMemo(() => Date.now(), [active]);
  const note = p.externalMessage && p.externalMessage.n >= mountedAt ? p.externalMessage : null;
  const calendar = p.calendar;
  const dateText = (v: unknown) => { const s = String(v ?? "").slice(0, 10); return calendar === "BS" ? (adToBs(s) ?? s) : s; };
  const activeTab = typeof active === "number" ? tabs.find((t) => t.id === active) : undefined;

  const COLS = "grid-cols-[130px_108px_minmax(220px,2fr)_70px_112px_132px]";
  const statusTabs = [{ value: "", label: "All" }, ...J_OPTIONS];

  return (
    <main className="ledger flex min-h-0 min-w-0 flex-1 flex-col">
      <WorkspaceTabs ariaLabel="Journal voucher tabs" listLabel="Voucher list" listCount={total} active={active} onList={() => setActive("list")}
        tabs={tabs} onSelect={setActive} onClose={(id) => closeTab(id)} onNew={() => openNew()} newTitle="New voucher in a new tab (F3)" />

      {loadError ? <p className="p-5 text-rose-700">{loadError}</p>
        : !lookups ? <p className="p-5 text-slate-500">Loading…</p>
        : activeTab ? (
          <JournalVoucherEntry key={activeTab.id} {...p} externalMessage={note} tabId={activeTab.id} lookups={lookups} docId={activeTab.docId} initialForm={activeTab.initialForm}
            hookSnapRef={snapOf(activeTab.id).hook} onMeta={onMeta} onNew={openNew} onOpenDoc={(id) => openDocId(id)} onClose={(id) => closeTab(id, true)} onListChanged={() => void loadList()} />
        ) : (
          <section data-purchase-document className="flex min-h-0 flex-1 flex-col gap-4 px-6 py-5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h1 className="lg-title">Journal vouchers</h1>
              <ContextChips branchName={p.branchName} fyCode={p.fyCode} />
              <span className="flex-1" />
              <button type="button" className="btn btn-primary h-9 px-4" onClick={() => openNew()}><Plus size={15} /> New voucher <span className="kbd">F3</span></button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative w-full max-w-[380px]">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input ref={searchRef} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by number or remarks…  (/)" aria-label="Search vouchers" className="fld h-9 min-w-0 pl-9"
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
              <span className="text-[12.5px] text-slate-500">{rows.length === total ? `${total} voucher${total === 1 ? "" : "s"}` : `Showing ${rows.length} of ${total}`}</span>
            </div>
            <div data-zone="list" className="lg-card lg-scroll min-h-0 flex-1 overflow-auto"
              onKeyDown={(e) => {
                const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[data-row]")), i = items.indexOf(e.target as HTMLElement);
                if (e.key === "ArrowDown") { e.preventDefault(); items[Math.min(i + 1, items.length - 1)]?.focus(); }
                else if (e.key === "ArrowUp") { e.preventDefault(); if (i <= 0) searchRef.current?.focus(); else items[i - 1].focus(); }
                else if (e.key === "Delete" && i >= 0 && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); void deleteDraft(rows[i]); }
              }}>
              <div className={`lg-th xl-head min-w-[760px] ${COLS}`}>
                <span>Voucher no</span><span className="text-right">Date ({calendar})</span><span>Remarks</span><span className="text-right">Lines</span><span>Status</span><span className="text-right">Amount</span>
              </div>
              {rows.length === 0 && <EmptyList icon={<BookOpen size={20} />} title={search || statusFilter ? "No vouchers match" : "No journal vouchers in this branch and year yet"} hint={search || statusFilter ? "Try a different search or status." : "Press F3 to enter the first journal voucher."} />}
              {rows.map((r) => (
                <button key={r.id} type="button" data-row onClick={() => openDocId(r.id, r.voucherNumber)} className={`lg-row xl-row min-w-[760px] ${COLS}`}>
                  <span className="truncate font-mono text-[13px] font-semibold text-cobalt-800">{r.voucherNumber}</span>
                  <span className="text-right tabular-nums text-slate-600">{dateText(r.voucherDate)}</span>
                  <span className="truncate text-slate-600">{r.remarks ?? ""}{r.source ? <span className="ml-2 text-[11.5px] text-slate-400">{r.source}</span> : null}</span>
                  <span className="text-right tabular-nums text-slate-500">{r.lineCount}</span>
                  <span><Pill text={r.state} tone={J_TONE[r.state]} /></span>
                  <span className="text-right font-medium tabular-nums text-ink">{money(r.totalAmount)}</span>
                </button>
              ))}
            </div>
          </section>
        )}
      {help && active === "list" && <ShortcutsOverlay onClose={() => setHelp(false)} shortcuts={LIST_HELP} />}
    </main>
  );
}
