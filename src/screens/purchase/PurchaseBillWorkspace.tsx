import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { List, Plus, Search, X } from "lucide-react";
import { purchaseApi, type PListRow, type PLookups } from "../../api";
import { Pill, money } from "../../components/purchase/Bits";
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

const LIST_HINTS = ["F3: New bill", "Enter: Open", "/: Search", "Alt+, Alt+.: Tabs", "F1: Help"];
const LIST_HELP: [string, string][] = [
  ["F3 / Ctrl+N", "New bill in a new tab"],
  ["Enter", "Open the highlighted bill in its own tab (a bill already open is just shown)"],
  ["↑ / ↓", "Move through the list"],
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
  useEffect(() => {
    let live = true;
    purchaseApi.lookups(p.companyId).then((l) => { if (live) setLookups(l); }).catch((e: Error) => { if (live) setLoadError(e.message); });
    return () => { live = false; };
  }, [p.companyId]);

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
    } catch (e) { setMsg({ text: (e as Error).message, kind: "err" }); }
  }, [p.companyId, p.branchId, p.fyCode, statusFilter, search]);
  useEffect(() => { const t = setTimeout(() => void loadList(), search ? 250 : 0); return () => clearTimeout(t); }, [loadList, search]);

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
  const closeTab = useCallback((id: number, force = false) => {
    const list = tabsRef.current, at = list.findIndex((t) => t.id === id);
    if (at < 0) return;
    if (list[at].dirty && !force && !window.confirm("This bill has unsaved changes. Close the tab and lose them?")) return;
    snaps.current.delete(id);
    setTabs(list.filter((t) => t.id !== id));
    if (activeRef.current === id) setActive(list[at - 1]?.id ?? list[at + 1]?.id ?? "list");
  }, []);
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

  const tabBtn = (selected: boolean) => `flex items-center gap-1.5 border border-b-0 px-3 h-8 text-[12.5px] ${selected ? "-mb-px border-slate-400 bg-white font-semibold text-slate-900" : "border-transparent bg-slate-200 text-slate-700 hover:bg-slate-50"}`;

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div role="tablist" aria-label="Purchase bill tabs" className="flex shrink-0 items-end gap-0.5 overflow-x-auto border-b border-slate-400 bg-slate-100 px-2 pt-1.5">
        <button type="button" role="tab" aria-selected={active === "list"} onClick={() => setActive("list")} className={tabBtn(active === "list")}>
          <List size={13} /> Bill list <span className="text-[11px] font-normal text-slate-500">({total})</span>
        </button>
        {tabs.map((t) => {
          const selected = active === t.id;
          return (
            <div key={t.id} className={`${tabBtn(selected)} pr-1`}>
              <button type="button" role="tab" aria-selected={selected} onClick={() => setActive(t.id)} className="flex max-w-[190px] items-center gap-1.5 truncate font-[inherit]" title={t.title}>
                <span className="truncate font-mono text-[12px]">{t.title}</span>{t.dirty && <span className="text-amber-600" title="Unsaved changes" aria-label="unsaved changes">●</span>}
              </button>
              <button type="button" onClick={() => closeTab(t.id)} aria-label={`Close ${t.title} (Alt+W)`} title="Close tab (Alt+W)" className="grid h-5 w-5 place-items-center rounded-sm text-slate-500 hover:bg-slate-300 hover:text-slate-900"><X size={12} /></button>
            </div>
          );
        })}
        <button type="button" onClick={() => openNew()} title="New bill in a new tab (F3)" className="mb-0.5 ml-1 grid h-7 w-7 place-items-center rounded-sm text-slate-600 hover:bg-slate-300" aria-label="New bill in a new tab"><Plus size={15} /></button>
      </div>

      {loadError ? <p className="p-4 text-red-700">{loadError}</p>
        : !lookups ? <p className="p-4 text-slate-500">Loading…</p>
        : activeTab ? (
          <PurchaseBillEntry key={activeTab.id} {...p} externalMessage={note} tabId={activeTab.id} lookups={lookups} docId={activeTab.docId} initialForm={activeTab.initialForm} fromChallan={activeTab.fromChallan}
            hookSnapRef={snapOf(activeTab.id).hook} stageRef={snapOf(activeTab.id).stage} onMeta={onMeta} onNew={openNew} onClose={(id) => closeTab(id, true)} onListChanged={() => void loadList()} />
        ) : (
          <section data-purchase-document className="flex min-h-0 flex-1 flex-col gap-2 px-4 py-3">
            <div className="flex flex-wrap items-end gap-3">
              <h1 className="text-[22px] font-semibold">Purchase Bills</h1>
              <span className="pb-1 text-slate-600">Branch: <b>{p.branchName}</b> · FY <b>{p.fyCode}</b></span>
              <span className="flex-1" />
              <button type="button" className="btn btn-primary" onClick={() => openNew()}><Plus size={14} /> New bill <span className="kbd">F3</span></button>
            </div>
            <div className="double-rule" />
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-full max-w-[360px]">
                <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
                <input ref={searchRef} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search bills…  (/)" aria-label="Search bills" className="fld min-w-0 pl-7"
                  onFocus={(e) => e.currentTarget.select()}
                  onKeyDown={(e) => { if (e.key === "ArrowDown" || e.key === "Enter") { e.preventDefault(); document.querySelector<HTMLElement>("[data-zone=list] [data-row]")?.focus(); } else if (e.key === "Escape") { e.stopPropagation(); (e.target as HTMLElement).blur(); } }} />
              </div>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status filter" className="fld w-auto min-w-[150px]">
                <option value="">All statuses</option>
                {OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <span className="text-[12px] text-slate-600">{rows.length === total ? `${total} bill(s)` : `Showing ${rows.length} of ${total}`}</span>
            </div>
            <div data-zone="list" className="min-h-0 flex-1 overflow-auto border border-slate-400 bg-white/60"
              onKeyDown={(e) => {
                const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[data-row]")), i = items.indexOf(e.target as HTMLElement);
                if (e.key === "ArrowDown") { e.preventDefault(); items[Math.min(i + 1, items.length - 1)]?.focus(); }
                else if (e.key === "ArrowUp") { e.preventDefault(); if (i <= 0) searchRef.current?.focus(); else items[i - 1].focus(); }
              }}>
              <div className="sticky top-0 z-10 grid grid-cols-[130px_100px_minmax(160px,2fr)_minmax(110px,1fr)_80px_100px_120px] gap-x-2 border-b border-slate-300 bg-slate-100 px-3 py-1.5 text-[11px] font-semibold text-slate-600">
                <span>Invoice no</span><span>Date ({calendar})</span><span>Vendor</span><span>Vendor invoice</span><span>Type</span><span>Status</span><span className="text-right">Amount</span>
              </div>
              {rows.length === 0 && <p className="p-3 text-[12px] text-slate-600">No bills found.</p>}
              {rows.map((r) => (
                <button key={r.id} type="button" data-row onClick={() => openDoc(r)}
                  className="grid w-full grid-cols-[130px_100px_minmax(160px,2fr)_minmax(110px,1fr)_80px_100px_120px] items-center gap-x-2 border-b border-slate-200 px-3 py-1.5 text-left hover:bg-blue-50 focus:bg-blue-100 focus:outline-none">
                  <span className="truncate font-mono font-semibold">{String(r.invoiceNumber)}</span>
                  <span className="tabular-nums">{dateText(r.invoiceDate)}</span>
                  <span className="truncate">{r.vendorName}</span>
                  <span className="truncate text-slate-600">{r.vendorInvoiceNo ?? ""}</span>
                  <span className="text-[12px] text-slate-600">{r.invoiceType === "IMPORT" ? "Import" : "Local"}</span>
                  <span><Pill text={String(r.state)} tone={STATE_TONE[String(r.state)]} /></span>
                  <span className="text-right tabular-nums">{money(r.totalAmount)}</span>
                </button>
              ))}
            </div>
          </section>
        )}
      {help && active === "list" && <ShortcutsOverlay onClose={() => setHelp(false)} shortcuts={LIST_HELP} />}
    </main>
  );
}
