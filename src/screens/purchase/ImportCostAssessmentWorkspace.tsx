import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { Calculator, Plus, Search } from "lucide-react";
import { importAssessmentApi, purchaseApi, type PLookups } from "../../api";
import { ContextChips, Pill, money } from "../../components/purchase/Bits";
import { EmptyList, WorkspaceTabs } from "../../components/purchase/WorkspaceTabs";
import { ShortcutsOverlay } from "../../components/ShortcutsOverlay";
import { adToBs } from "../../lib/nepaliDate";
import ImportCostAssessmentEntry, { type AssessmentSnapshot, type Form, type ImportOption } from "./ImportCostAssessmentScreen";
import type { PurchaseScreenProps } from "./PurchaseOrderScreen";

// The Cost Assessment screen: a tab strip with the assessment list first and one tab per assessment being entered or viewed.
// Only the open tab is on screen; the others keep their document in a snapshot and come back exactly as they were left.

interface EntryTab { id: number; docId: number | null; title: string; dirty: boolean; initialForm?: Form }
type Active = "list" | number;
type Row = Record<string, any> & { id: number; assessmentNumber: string; state: string };

const LIST_HINTS = ["F3: New assessment", "Enter: Open", "/: Search", "Alt+, Alt+.: Tabs", "F1: Help"];
const LIST_HELP: [string, string][] = [
  ["F3 / Ctrl+N", "New assessment in a new tab"],
  ["Enter", "Open the highlighted assessment in its own tab (one already open is just shown)"],
  ["↑ / ↓", "Move through the list"],
  ["/ or F4 or Ctrl+F", "Search the list"],
  ["Alt+, / Alt+.", "Previous / next tab"],
  ["Alt+W", "Close the open assessment tab"],
  ["F1 / ?", "This help"],
];
const tone = (state: string): "green" | "amber" | "slate" => (state === "APPLIED" ? "green" : state === "REVERSED" ? "amber" : "slate");
const STATES = [["", "All"], ["DRAFT", "Draft"], ["APPLIED", "Applied"], ["REVERSED", "Reversed"]] as const;
const COLS = "grid-cols-[120px_110px_minmax(120px,1.2fr)_minmax(100px,1fr)_110px_130px_140px]";

export default function ImportCostAssessmentWorkspace(p: PurchaseScreenProps) {
  const [lookups, setLookups] = useState<PLookups | null>(null);
  const [imports, setImports] = useState<ImportOption[]>([]);
  const [loadError, setLoadError] = useState("");
  const [all, setAll] = useState<Row[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [msg, setMsg] = useState<{ text: string; kind: "ok" | "err" | "info" }>({ text: "Loading…", kind: "info" });
  const searchRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const [list, eligible] = await Promise.all([
        importAssessmentApi.list({ companyId: p.companyId, branchId: p.branchId, fiscalYear: p.fyCode }),
        importAssessmentApi.eligibleImports({ companyId: p.companyId, branchId: p.branchId, fiscalYear: p.fyCode }),
      ]);
      setAll(list.rows as Row[]); setImports(eligible.rows as ImportOption[]); setMsg({ text: "Ready", kind: "info" });
    } catch (e) { setMsg({ text: (e as Error).message, kind: "err" }); }
  }, [p.companyId, p.branchId, p.fyCode]);
  useEffect(() => {
    let live = true;
    purchaseApi.lookups(p.companyId).then((l) => { if (live) setLookups(l); }).catch((e: Error) => { if (live) setLoadError(e.message); });
    return () => { live = false; };
  }, [p.companyId]);
  useEffect(() => { void refresh(); }, [refresh]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return all.filter((r) => (!statusFilter || r.state === statusFilter)
      && (!needle || [r.assessmentNumber, r.referenceNo, r.invoiceNumber].some((v) => String(v ?? "").toLowerCase().includes(needle))));
  }, [all, search, statusFilter]);
  const counts = useMemo(() => {
    const byState: Record<string, number> = { DRAFT: 0, APPLIED: 0, REVERSED: 0 };
    let net = 0;
    for (const r of all) { byState[r.state] = (byState[r.state] ?? 0) + 1; if (r.state === "APPLIED") net += Number(r.assessedNet ?? 0) || 0; }
    return { byState, net };
  }, [all]);

  // ---- tabs ----
  const [tabs, setTabs] = useState<EntryTab[]>([]);
  const [active, setActive] = useState<Active>("list");
  const tabsRef = useRef(tabs); tabsRef.current = tabs;
  const activeRef = useRef(active); activeRef.current = active;
  const nextId = useRef(1);
  const snaps = useRef(new Map<number, MutableRefObject<AssessmentSnapshot | null>>());
  const snapOf = (id: number) => {
    let s = snaps.current.get(id);
    if (!s) { s = { current: null }; snaps.current.set(id, s); }
    return s;
  };
  const addTab = useCallback((t: Pick<EntryTab, "docId"> & Partial<Pick<EntryTab, "title" | "initialForm">>) => {
    const id = nextId.current++;
    setTabs((cur) => [...cur, { id, docId: t.docId, title: t.title ?? "New assessment", dirty: false, initialForm: t.initialForm }]);
    setActive(id);
  }, []);
  const openNew = useCallback((prefill?: Form) => addTab({ docId: null, initialForm: prefill }), [addTab]);
  const openDoc = useCallback((row: Row) => {
    const open = tabsRef.current.find((t) => t.docId === row.id);
    if (open) setActive(open.id);
    else addTab({ docId: row.id, title: String(row.assessmentNumber) });
  }, [addTab]);
  const closeTab = useCallback((id: number, force = false) => {
    const list = tabsRef.current, at = list.findIndex((t) => t.id === id);
    if (at < 0) return;
    if (list[at].dirty && !force && !window.confirm("This assessment has unsaved changes. Close the tab and lose them?")) return;
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
  const helpRef = useRef(false);
  helpRef.current = help;
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
        else if (e.key === "Escape" && helpRef.current) { e.preventDefault(); setHelp(false); }
        else if (e.key === "F1" || (e.key === "?" && !typing)) { e.preventDefault(); setHelp(!helpRef.current); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeTab, openNew]);

  useEffect(() => {
    if (active === "list") p.setStatus({ mode: "view", count: all.length, shown: rows.length, message: msg.text, kind: msg.kind, hints: LIST_HINTS });
  }, [active, all.length, rows.length, msg, p.setStatus]);

  const calendar = p.calendar;
  const dateText = (v: unknown) => { const s = String(v ?? "").slice(0, 10); return calendar === "BS" ? (adToBs(s) ?? s) : s; };
  const activeTab = typeof active === "number" ? tabs.find((t) => t.id === active) : undefined;

  return (
    <main className="ledger flex min-h-0 min-w-0 flex-1 flex-col">
      <WorkspaceTabs ariaLabel="Cost assessment tabs" listLabel="Assessments" listCount={all.length} active={active} onList={() => setActive("list")}
        tabs={tabs} onSelect={setActive} onClose={(id) => closeTab(id)} onNew={() => openNew()} newTitle="New assessment in a new tab (F3)" />

      {loadError ? <p className="p-4 text-red-700">{loadError}</p>
        : !lookups ? <p className="p-4 text-slate-500">Loading…</p>
        : activeTab ? (
          <ImportCostAssessmentEntry key={activeTab.id} {...p} tabId={activeTab.id} lookups={lookups} imports={imports} assessments={all} docId={activeTab.docId} initialForm={activeTab.initialForm}
            snapRef={snapOf(activeTab.id)} onMeta={onMeta} onNew={openNew} onClose={(id) => closeTab(id, true)} onChanged={() => void refresh()} />
        ) : (
          <section data-assessment-document className="flex min-h-0 flex-1 flex-col gap-4 px-6 py-5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h1 className="lg-title">Cost assessments</h1>
              <ContextChips branchName={p.branchName} fyCode={p.fyCode} />
              <span className="flex-1" />
              <button type="button" className="btn btn-primary h-9 px-4" onClick={() => openNew()}><Plus size={15} /> New assessment <span className="kbd">F3</span></button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative w-full max-w-[380px]">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input ref={searchRef} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by number, goods bill or reference…  (/)" aria-label="Search assessments" className="fld h-9 min-w-0 pl-9"
                  onFocus={(e) => e.currentTarget.select()}
                  onKeyDown={(e) => { if (e.key === "ArrowDown" || e.key === "Enter") { e.preventDefault(); document.querySelector<HTMLElement>("[data-zone=list] [data-row]")?.focus(); } else if (e.key === "Escape") { e.stopPropagation(); (e.target as HTMLElement).blur(); } }} />
              </div>
              <div role="group" aria-label="State filter" data-insight="list-summary" className="inline-flex flex-wrap gap-0.5 rounded-lg bg-slate-200/70 p-0.5">
                {STATES.map(([v, l]) => {
                  const on = statusFilter === v;
                  return (
                    <button key={v || "all"} type="button" aria-pressed={on} onClick={() => setStatusFilter(v)}
                      className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[12.5px] transition-colors ${on ? "bg-white font-semibold text-ink shadow-sm" : "text-slate-600 hover:text-ink"}`}>
                      {l}{v && <span className="lg-count">{counts.byState[v] ?? 0}</span>}
                    </button>
                  );
                })}
              </div>
              <span className="text-[12.5px] text-slate-500">{rows.length === all.length ? `${all.length} assessment${all.length === 1 ? "" : "s"}` : `Showing ${rows.length} of ${all.length}`}</span>
              <span className="flex-1" />
              <span className="text-[12.5px] text-slate-500">Applied assessed net <b className="ml-1 text-[14px] font-semibold tabular-nums text-ink">{money(counts.net)}</b></span>
            </div>
            <div data-zone="list" className="lg-card lg-scroll min-h-0 flex-1 overflow-auto"
              onKeyDown={(e) => {
                const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[data-row]")), i = items.indexOf(e.target as HTMLElement);
                if (e.key === "ArrowDown") { e.preventDefault(); items[Math.min(i + 1, items.length - 1)]?.focus(); }
                else if (e.key === "ArrowUp") { e.preventDefault(); if (i <= 0) searchRef.current?.focus(); else items[i - 1].focus(); }
              }}>
              <div className={`lg-th grid min-w-[860px] ${COLS} items-center gap-x-3 px-5 py-2.5`}>
                <span>Assessment no</span><span>Date ({calendar})</span><span>Goods bill</span><span>Reference</span><span>State</span><span className="text-right">Assessed net</span><span className="text-right">Landed value</span>
              </div>
              {rows.length === 0 && <EmptyList icon={<Calculator size={20} />} title={search || statusFilter ? "No assessments match" : "No assessments in this branch and year yet"} hint={search || statusFilter ? "Try a different search or state." : "Press F3 to assess the landed cost of an import bill."} />}
              {rows.map((r) => (
                <button key={r.id} type="button" data-row onClick={() => openDoc(r)} className={`lg-row grid min-w-[860px] ${COLS} items-center gap-x-3 px-5 py-3`}>
                  <span className="truncate font-mono text-[13px] font-semibold text-cobalt-800">{String(r.assessmentNumber)}</span>
                  <span className="tabular-nums text-slate-600">{dateText(r.assessmentDate)}</span>
                  <span className="truncate font-medium text-ink">{r.invoiceNumber ?? r.importInvoiceNumber}</span>
                  <span className="truncate text-slate-500">{r.referenceNo ?? ""}</span>
                  <span><Pill text={r.state} tone={tone(r.state)} /></span>
                  <span className="text-right font-medium tabular-nums text-ink">{r.assessedNet != null ? money(r.assessedNet) : ""}</span>
                  <span className="text-right tabular-nums text-slate-600">{r.totalLandedValue != null ? money(r.totalLandedValue) : ""}</span>
                </button>
              ))}
            </div>
          </section>
        )}
      {help && active === "list" && <ShortcutsOverlay onClose={() => setHelp(false)} shortcuts={LIST_HELP} />}
    </main>
  );
}
