import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { Plus, Receipt, Search } from "lucide-react";
import { purchaseApi, type PListRow, type PLookups } from "../../api";
import { useDialog } from "../../components/Dialog";
import { ContextChips, Pill, money } from "../../components/purchase/Bits";
import { EmptyList, WorkspaceTabs } from "../../components/purchase/WorkspaceTabs";
import { ShortcutsOverlay } from "../../components/ShortcutsOverlay";
import { adToBs } from "../../lib/nepaliDate";
import type { MsgKind } from "../../types";
import PurchaseBillEntry, { OPTIONS, STATE_TONE, type BForm, type Stage } from "./PurchaseBillScreen";
import type { PurchaseScreenProps } from "./PurchaseOrderScreen";
import type { DocSnapshot } from "./useDocScreen";

// The Purchase Bill screen: a tab strip with the bill list first and one tab per bill being entered or viewed.
// Only the open tab is on screen; the others keep their document in a snapshot and come back exactly as they were left.

interface EntryTab { id: number; docId: number | null; title: string; dirty: boolean; initialForm?: BForm; fromChallan: { id: number; n: number } | null }
type Active = "list" | number;
interface TabSnap { hook: MutableRefObject<DocSnapshot<BForm> | null>; stage: MutableRefObject<Stage | null> }

const LIST_HINTS = ["F3: New bill", "Enter: Open", "Del: Delete draft", "/: Search", "Alt+, Alt+.: Tabs", "F1: Help"];
const LIST_HELP: [string, string][] = [
  ["F3 / Ctrl+N", "New bill in a new tab"],
  ["Enter", "Open the highlighted bill in its own tab (a bill already open is just shown)"],
  ["↑ / ↓", "Move through the list"],
  ["Delete", "Delete the highlighted draft bill (asks first; posted bills cannot be deleted)"],
  ["/ or F4 or Ctrl+F", "Search the list"],
  ["Alt+, / Alt+.", "Previous / next tab"],
  ["Alt+W", "Close the open bill tab"],
  ["F1 / ?", "This help"],
];

// The "Create Bill" request from a challan is acted on once, however often this screen is mounted again afterwards.
let consumedChallan = 0;

export default function PurchaseBillWorkspace(p: PurchaseScreenProps & { fromChallan: { id: number; n: number } | null }) {
  const [lookups, setLookups] = useState<PLookups | null>(null);
  const [loadError, setLoadError] = useState("");
  const dlg = useDialog();
  useEffect(() => {
    let live = true;
    purchaseApi.lookups(p.companyId).then((l) => { if (live) setLookups(l); }).catch((e: Error) => { if (live) { setLoadError(e.message); void dlg.error(e.message, { title: "Could not load the bill screen" }); } });
    return () => { live = false; };
  }, [p.companyId, dlg]);

  // ---- the list ----
  const [rows, setRows] = useState<PListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [msg, setMsg] = useState<{ text: string; kind: MsgKind }>({ text: "Loading…", kind: "info" });
  const searchRef = useRef<HTMLInputElement>(null);
  const loadList = useCallback(async () => {
    try {
      const r = await purchaseApi.list("bills", { companyId: p.companyId, branchId: p.branchId, fiscalYear: p.fyCode, status: statusFilter || undefined, search: search.trim() || undefined });
      setRows(r.rows); setTotal(r.total); setMsg({ text: "Ready", kind: "info" });
    } catch (e) { setMsg({ text: (e as Error).message, kind: "err" }); void dlg.error((e as Error).message); }
  }, [p.companyId, p.branchId, p.fyCode, statusFilter, search, dlg]);
  useEffect(() => { const t = setTimeout(() => void loadList(), search ? 250 : 0); return () => clearTimeout(t); }, [loadList, search]);

  // Delete on a highlighted row: only a draft can go, it must not be open in a tab, and the person is asked first.
  const deleteDraft = async (row: PListRow) => {
    const no = String(row.invoiceNumber);
    if (String(row.state) !== "DRAFT") { void dlg.warning(`Bill ${no} is ${String(row.state).toLowerCase()}; only a draft bill can be deleted.`, { title: "Cannot delete" }); return; }
    if (tabsRef.current.some((t) => t.docId === row.id)) { void dlg.warning(`Bill ${no} is open in a tab. Close that tab first.`, { title: "Cannot delete" }); return; }
    if (!(await dlg.confirm(`Delete draft bill ${no}? This cannot be undone.`, { title: "Delete draft bill?", variant: "danger", confirmLabel: "Delete" }))) return;
    try { await purchaseApi.remove("bills", row.id, p.companyId, p.userId); setMsg({ text: `Deleted ${no}`, kind: "ok" }); await loadList(); }
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
    if (!s) { s = { hook: { current: null }, stage: { current: null } }; snaps.current.set(id, s); }
    return s;
  };

  const addTab = useCallback((t: Pick<EntryTab, "docId" | "fromChallan"> & Partial<Pick<EntryTab, "title" | "initialForm">>) => {
    const id = nextId.current++;
    setTabs((cur) => [...cur, { id, docId: t.docId, title: t.title ?? "New bill", dirty: false, initialForm: t.initialForm, fromChallan: t.fromChallan }]);
    setActive(id);
  }, []);
  const openNew = useCallback((prefill?: BForm) => addTab({ docId: null, fromChallan: null, initialForm: prefill }), [addTab]);
  const openDoc = useCallback((row: PListRow) => {
    const open = tabsRef.current.find((t) => t.docId === row.id);
    if (open) setActive(open.id);
    else addTab({ docId: row.id, fromChallan: null, title: String(row.invoiceNumber) });
  }, [addTab]);
  const closeTab = useCallback(async (id: number, force = false) => {
    if (!force && tabsRef.current.find((t) => t.id === id)?.dirty
      && !(await dlg.confirm("This bill has unsaved changes. Close the tab and lose them?", { title: "Close this tab?", variant: "warning", confirmLabel: "Close tab", cancelLabel: "Keep editing" }))) return;
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

  // a challan's "Create Bill" opens a new tab
  useEffect(() => {
    if (!p.fromChallan || consumedChallan === p.fromChallan.n) return;
    consumedChallan = p.fromChallan.n;
    addTab({ docId: null, fromChallan: p.fromChallan });
  }, [p.fromChallan, addTab]);

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

  const COLS = "grid-cols-[116px_108px_minmax(180px,2fr)_minmax(120px,1fr)_84px_112px_132px]";
  const statusTabs = [{ value: "", label: "All" }, ...OPTIONS];

  return (
    <main className="ledger flex min-h-0 min-w-0 flex-1 flex-col">
      <WorkspaceTabs ariaLabel="Purchase bill tabs" listLabel="Bill list" listCount={total} active={active} onList={() => setActive("list")}
        tabs={tabs} onSelect={setActive} onClose={(id) => closeTab(id)} onNew={() => openNew()} newTitle="New bill in a new tab (F3)" />

      {loadError ? <p className="p-5 text-rose-700">{loadError}</p>
        : !lookups ? <p className="p-5 text-slate-500">Loading…</p>
        : activeTab ? (
          <PurchaseBillEntry key={activeTab.id} {...p} externalMessage={note} tabId={activeTab.id} lookups={lookups} docId={activeTab.docId} initialForm={activeTab.initialForm} fromChallan={activeTab.fromChallan}
            hookSnapRef={snapOf(activeTab.id).hook} stageRef={snapOf(activeTab.id).stage} onMeta={onMeta} onNew={openNew} onClose={(id) => closeTab(id, true)} onListChanged={() => void loadList()} />
        ) : (
          <section data-purchase-document className="flex min-h-0 flex-1 flex-col gap-4 px-6 py-5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h1 className="lg-title">Purchase bills</h1>
              <ContextChips branchName={p.branchName} fyCode={p.fyCode} />
              <span className="flex-1" />
              <button type="button" className="btn btn-primary h-9 px-4" onClick={() => openNew()}><Plus size={15} /> New bill <span className="kbd">F3</span></button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative w-full max-w-[380px]">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input ref={searchRef} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by number, vendor or vendor invoice…  (/)" aria-label="Search bills" className="fld h-9 min-w-0 pl-9"
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
              <span className="text-[12.5px] text-slate-500">{rows.length === total ? `${total} bill${total === 1 ? "" : "s"}` : `Showing ${rows.length} of ${total}`}</span>
            </div>
            <div data-zone="list" className="lg-card lg-scroll min-h-0 flex-1 overflow-auto"
              onKeyDown={(e) => {
                const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[data-row]")), i = items.indexOf(e.target as HTMLElement);
                if (e.key === "ArrowDown") { e.preventDefault(); items[Math.min(i + 1, items.length - 1)]?.focus(); }
                else if (e.key === "ArrowUp") { e.preventDefault(); if (i <= 0) searchRef.current?.focus(); else items[i - 1].focus(); }
                else if (e.key === "Delete" && i >= 0 && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); void deleteDraft(rows[i]); }
              }}>
              <div className={`lg-th xl-head min-w-[860px] ${COLS}`}>
                <span>Invoice no</span><span className="text-right">Date ({calendar})</span><span>Vendor</span><span>Vendor invoice</span><span>Type</span><span>Status</span><span className="text-right">Amount</span>
              </div>
              {rows.length === 0 && <EmptyList icon={<Receipt size={20} />} title={search || statusFilter ? "No bills match" : "No bills in this branch and year yet"} hint={search || statusFilter ? "Try a different search or status." : "Press F3 to enter the first purchase bill."} />}
              {rows.map((r) => (
                <button key={r.id} type="button" data-row onClick={() => openDoc(r)} className={`lg-row xl-row min-w-[860px] ${COLS}`}>
                  <span className="truncate font-mono text-[13px] font-semibold text-cobalt-800">{String(r.invoiceNumber)}</span>
                  <span className="text-right tabular-nums text-slate-600">{dateText(r.invoiceDate)}</span>
                  <span className="truncate font-medium text-ink">{r.vendorName}</span>
                  <span className="truncate text-slate-500">{r.vendorInvoiceNo ?? ""}</span>
                  <span>{r.invoiceType === "IMPORT"
                    ? <span className="inline-flex h-[22px] items-center rounded-full bg-sky-50 px-2.5 text-[11.5px] font-semibold text-sky-800 ring-1 ring-inset ring-sky-200">Import</span>
                    : <span className="text-slate-500">Local</span>}</span>
                  <span><Pill text={String(r.state)} tone={STATE_TONE[String(r.state)]} /></span>
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
