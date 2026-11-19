import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { ChevronDown, ChevronRight, Download, Filter, RefreshCw, Search, X } from "lucide-react";
import { ledgerReportApi, type LedgerReportLookups, type LedgerReportResult, type LedgerReportRow } from "../../api";
import { Combobox, type ComboOption } from "../../components/Combobox";
import { DateInput } from "../../components/DateInput";
import { QueryFilterGroup } from "../../components/QueryFilterGroup";
import { adToBs, bsToAd } from "../../lib/nepaliDate";
import { groupIN } from "../../components/purchase/Bits";
import type { StatusInfo } from "../../types";

type Month = { from: string; to: string; label: string };
type FilterKey = "period" | "ledgers" | "subLedger" | "product" | "voucherType" | "status" | "search";
type ReportQuery = {
  from: string; to: string; ledgerIds: number[]; subLedgerId: number | ""; productId: number | "";
  voucherType: string; status: string; search: string; enabled: Record<FilterKey, boolean>;
};
const pad = (n: number) => String(n).padStart(2, "0");
const addDay = (s: string, days: number) => { const d = new Date(`${s}T12:00:00`); d.setDate(d.getDate() + days); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
function monthsOf(fyStart: string, fyEnd: string): Month[] {
  const bsStart = adToBs(fyStart), bsEnd = adToBs(fyEnd);
  if (!bsStart || !bsEnd) {
    const months: Month[] = []; const cursor = new Date(`${fyStart}T12:00:00`), end = new Date(`${fyEnd}T12:00:00`);
    while (cursor <= end) { const y = cursor.getFullYear(), m = cursor.getMonth(), a = `${y}-${pad(m + 1)}-01`, b = `${y}-${pad(m + 1)}-${pad(new Date(y, m + 1, 0).getDate())}`, from = a < fyStart ? fyStart : a, to = b > fyEnd ? fyEnd : b; months.push({ from, to, label: `${new Intl.DateTimeFormat("en", { month: "short", year: "numeric" }).format(cursor)} · ${from}–${to}` }); cursor.setMonth(m + 1, 1); }
    return months;
  }
  const [sy, sm] = bsStart.split("-").map(Number), [ey, em] = bsEnd.split("-").map(Number), months: Month[] = [];
  let y = sy, m = sm;
  while (y < ey || (y === ey && m <= em)) {
    const nextY = m === 12 ? y + 1 : y, nextM = m === 12 ? 1 : m + 1, rawFrom = bsToAd(`${y}-${pad(m)}-01`), next = bsToAd(`${nextY}-${pad(nextM)}-01`);
    if (rawFrom && next) { const rawTo = addDay(next, -1), from = rawFrom < fyStart ? fyStart : rawFrom, to = rawTo > fyEnd ? fyEnd : rawTo; if (from <= to) months.push({ from, to, label: `${y}-${pad(m)} BS · ${adToBs(from) ?? from}–${adToBs(to) ?? to}` }); }
    y = nextY; m = nextM;
  }
  return months;
}
const shownDate = (v: string, calendar: "BS" | "AD") => calendar === "BS" ? adToBs(v) ?? v : v;
const money = (v: string) => groupIN(v || "0");
function minor(v: string): bigint { const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(v || "0"); if (!m) return 0n; const frac = (m[3] ?? "") + "00"; let n = BigInt(m[2]) * 100n + BigInt(frac.slice(0, 2)); if (frac.charCodeAt(2) >= 53) n += 1n; return m[1] ? -n : n; }
function fmtMinor(v: bigint): string { const a = v < 0n ? -v : v, digits = (a / 100n).toString(), tail = String(a % 100n).padStart(2, "0"), grouped = digits.length > 3 ? `${digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${digits.slice(-3)}` : digits; return `${v < 0n ? "-" : ""}${grouped}.${tail}`; }
const balanceText = (v: string) => `${money(fmtMinor(minor(v)))} ${minor(v) < 0n ? "Cr" : "Dr"}`;
const th = "sticky top-0 z-[1] bg-slate-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500";
const td = "border-b border-slate-100 px-3 py-2.5 align-top";
const filterLabels: Record<FilterKey, string> = { period: "Period", ledgers: "Ledger(s)", subLedger: "Sub-ledger", product: "Product", voucherType: "Voucher type", status: "Status", search: "Search" };

export default function LedgerReportScreen(p: {
  companyId: number; branchId: number; branchName: string; fyCode: string; fyStart: string; fyEnd: string; calendar: "BS" | "AD";
  setStatus: (s: StatusInfo) => void; dirtyRef: MutableRefObject<boolean>;
}) {
  const months = useMemo(() => monthsOf(p.fyStart, p.fyEnd), [p.fyStart, p.fyEnd]);
  const today = new Date().toISOString().slice(0, 10);
  const initialMonth = useMemo(() => months.find((m) => m.from <= today && m.to >= today) ?? months[months.length - 1], [months, today]);
  const makeDefaultQuery = (): ReportQuery => ({
    from: initialMonth?.from ?? p.fyStart, to: initialMonth?.to ?? p.fyEnd, ledgerIds: [], subLedgerId: "", productId: "", voucherType: "ALL", status: "POSTED", search: "",
    enabled: { period: true, ledgers: false, subLedger: false, product: false, voucherType: false, status: true, search: false },
  });
  const [draft, setDraft] = useState<ReportQuery>(makeDefaultQuery);
  const [query, setQuery] = useState<ReportQuery>(makeDefaultQuery);
  const [lookups, setLookups] = useState<LedgerReportLookups | null>(null);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<LedgerReportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const requestNo = useRef(0), filterButtonRef = useRef<HTMLButtonElement>(null), panelRef = useRef<HTMLDivElement>(null), searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => { p.dirtyRef.current = false; }, [p.dirtyRef]);
  useEffect(() => { ledgerReportApi.lookups(p.companyId).then(setLookups).catch((e: Error) => setError(e.message)); }, [p.companyId]);
  useEffect(() => {
    if (!filtersOpen) return;
    panelRef.current?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.focus();
  }, [filtersOpen]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2" && !e.ctrlKey && !e.altKey && !e.metaKey) { e.preventDefault(); setFiltersOpen((v) => !v); }
      if (e.key === "F4" && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault(); setFiltersOpen(true); setDraft((old) => ({ ...old, enabled: { ...old.enabled, search: true } }));
        window.setTimeout(() => searchRef.current?.focus(), 0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const activeLedgerIds = query.enabled.ledgers ? query.ledgerIds : [];
  const load = useCallback(() => {
    if (!query.from || !query.to || query.from.startsWith("?") || query.to.startsWith("?") || query.from > query.to) { setError("Choose a valid date range."); return; }
    const current = ++requestNo.current;
    setLoading(true); setError(""); setResult(null);
    ledgerReportApi.get({ companyId: p.companyId, branchId: p.branchId, fiscalYear: p.fyCode, from: query.from, to: query.to,
      ledgerIds: activeLedgerIds.length ? activeLedgerIds.join(",") : undefined,
      subLedgerId: query.enabled.subLedger ? query.subLedgerId : "", page, pageSize: 100,
      status: query.enabled.status ? query.status : "ALL", voucherType: query.enabled.voucherType ? query.voucherType : "ALL",
      productId: query.enabled.product ? query.productId : "", search: query.enabled.search ? query.search.trim() : "" })
      .then((data) => { if (current === requestNo.current) setResult(data); })
      .catch((e: Error) => { if (current === requestNo.current) setError(e.message || "Could not load ledger report."); })
      .finally(() => { if (current === requestNo.current) setLoading(false); });
  }, [p.companyId, p.branchId, p.fyCode, query, activeLedgerIds, page]);
  useEffect(() => { if (lookups) load(); }, [lookups, load]);
  useEffect(() => () => { requestNo.current += 1; }, []);
  useEffect(() => { p.setStatus({ mode: "view", count: result?.total ?? 0, shown: result?.rows.length ?? 0, message: error || (loading ? "Running ledger query…" : result ? "Ledger query ready" : "Loading…"), kind: error ? "err" : "info", hints: ["F2: open query filters", "Enter: run query · click a transaction to inspect its full detail", "Balances include posted entries only"] }); }, [result, loading, error, p.setStatus]);
  const setFilterEnabled = (key: FilterKey, enabled: boolean) => setDraft((old) => {
    const next = { ...old, enabled: { ...old.enabled, [key]: enabled } };
    if (!enabled) {
      if (key === "period") { next.from = p.fyStart; next.to = p.fyEnd; }
      if (key === "ledgers") next.ledgerIds = [];
      if (key === "subLedger") next.subLedgerId = "";
      if (key === "product") next.productId = "";
      if (key === "voucherType") next.voucherType = "ALL";
      if (key === "status") next.status = "ALL";
      if (key === "search") next.search = "";
    }
    return next;
  });
  const updateDraft = <K extends keyof ReportQuery>(key: K, value: ReportQuery[K]) => setDraft((old) => ({ ...old, [key]: value }));
  const applyQuery = (e?: React.FormEvent) => { e?.preventDefault(); if (draft.from > draft.to) { setError("Start date must be on or before end date."); return; } setQuery({ ...draft, ledgerIds: [...draft.ledgerIds], enabled: { ...draft.enabled } }); setPage(1); setFiltersOpen(false); filterButtonRef.current?.focus(); };
  const resetQuery = () => { const reset = makeDefaultQuery(); setDraft(reset); setQuery(reset); setPage(1); };
  const selectedMonth = months.findIndex((m) => m.from === draft.from && m.to === draft.to);
  const ledgers = lookups?.ledgers ?? [];
  const subs = (lookups?.subLedgers ?? []).filter((s) => !draft.enabled.ledgers || !draft.ledgerIds.length || draft.ledgerIds.includes(s.generalLedgerId));
  const rows = result?.rows ?? [];
  const summaries = (result?.summary ?? []).filter((x) => !activeLedgerIds.length || activeLedgerIds.includes(x.generalLedgerId));
  const summaryCards = [
    ["Opening balance", balanceText(fmtMinor(summaries.reduce((a, x) => a + minor(x.opening), 0n)))],
    ["Period debits", money(fmtMinor(summaries.reduce((a, x) => a + minor(x.debit), 0n)))],
    ["Period credits", money(fmtMinor(summaries.reduce((a, x) => a + minor(x.credit), 0n)))],
    ["Closing balance", balanceText(fmtMinor(summaries.reduce((a, x) => a + minor(x.closing), 0n)))],
  ];
  const activeFilters = Object.keys(filterLabels).filter((key) => query.enabled[key as FilterKey]).length;
  const exportCsv = () => {
    if (!result) return;
    const lines: string[][] = [["Date", "Ledger", "Sub-ledger", "Voucher type", "Voucher number", "Source", "Narration", "Remarks", "Debit", "Credit", "Running balance", "Status", "Posted at", "Posted by", "Products"]];
    for (const r of rows) lines.push([r.d, `${r.ledgerCode} ${r.ledgerName}`, r.subLedgerName ?? "", r.voucherLabel, r.voucherNumber, `${r.sourceLabel} ${r.sourceNumber}`, r.narration ?? "", r.remarks ?? "", r.debit, r.credit, r.running, r.posted ? "Posted" : "Draft", r.postedAt ?? "", r.postedByName ?? "", r.products.map((x) => `${x.code} ${x.description} ${x.qty} ${x.unit}${x.altQty ? `; alt ${x.altQty} ${x.altUnit}` : ""}${x.location ? `; ${x.location}` : ""}${x.batch ? `; batch ${x.batch}` : ""}${x.expiry ? `; expiry ${x.expiry}` : ""}`).join("; ")]);
    const csv = lines.map((line) => line.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(",")).join("\r\n"), blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }), a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `ledger-${query.from}-${query.to}-page-${page}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  const toggleRow = (lineId: number) => setExpanded((x) => x === lineId ? null : lineId);
  const queryDateLabel = `${shownDate(query.from, p.calendar)}–${shownDate(query.to, p.calendar)}`;
  const combo = (value: string, options: ComboOption[], fieldName: string, onChange: (value: string) => void, placeholder: string) => <Combobox value={value} options={options} onChange={onChange} fieldName={fieldName} placeholder={placeholder} />;
  const closeFilters = () => { setFiltersOpen(false); filterButtonRef.current?.focus(); };

  return (
    <section className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-white">
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-200 px-5 py-3">
        <div><h1 className="text-[18px] font-semibold text-slate-900">General ledger</h1><p className="mt-0.5 text-[12px] text-slate-500">{p.branchName} · FY {p.fyCode} · Ledger query and balances</p></div>
        <div className="ml-auto flex gap-2"><button className="btn" type="button" onClick={load} disabled={loading}><RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh</button><button className="btn" type="button" onClick={exportCsv} disabled={!rows.length}><Download size={13} /> Export page CSV</button></div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-5 py-2">
        <button ref={filterButtonRef} type="button" className="btn" onClick={() => setFiltersOpen(true)} aria-haspopup="dialog" aria-expanded={filtersOpen}><Filter size={14} /> Filters <span className="rounded-full bg-cobalt-100 px-1.5 text-[10px] text-cobalt-800">{activeFilters}</span><kbd className="kbd">F2</kbd></button>
        <div className="flex min-w-0 flex-1 items-center gap-2 text-[12px]"><span className="font-semibold uppercase tracking-wide text-slate-400">Query</span><span className="truncate text-slate-700">{queryDateLabel} · {activeLedgerIds.length ? `${activeLedgerIds.length} ledgers` : "All ledgers"}{query.enabled.subLedger && query.subLedgerId ? " · sub-ledger" : ""}{query.enabled.product && query.productId ? " · product" : ""}{query.enabled.voucherType && query.voucherType !== "ALL" ? ` · ${query.voucherType}` : ""}{query.enabled.status ? ` · ${query.status}` : ""}{query.enabled.search && query.search ? ` · “${query.search}”` : ""}</span></div>
      </div>
      {filtersOpen && (
        <div className="fixed inset-0 z-[100] bg-slate-950/25 p-2 sm:p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) closeFilters(); }}>
          <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="ledger-query-title" className="mx-auto flex max-h-[calc(100vh-1rem)] w-full max-w-[980px] flex-col overflow-hidden rounded-xl border border-slate-300 bg-slate-50 shadow-2xl sm:mt-6 sm:max-h-[calc(100vh-3rem)]" onKeyDown={(e) => {
            if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeFilters(); }
            if (e.key === "Tab") { const focusable = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])') ?? []); const first = focusable[0], last = focusable[focusable.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); } }
            if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement) && !(e.target instanceof HTMLInputElement && e.target.type === "checkbox")) { e.preventDefault(); applyQuery(); }
          }}>
            <header className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 py-3"><div className="min-w-0 flex-1"><h2 id="ledger-query-title" className="font-semibold text-slate-900">Build ledger query</h2><p className="text-[11px] text-slate-500">Check a filter to enable it, choose its options, then run the query.</p></div><button type="button" className="btn px-2" onClick={closeFilters} aria-label="Close filters"><X size={15} /></button></header>
            <form className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4" onSubmit={applyQuery}>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                <QueryFilterGroup label="Period" checked={draft.enabled.period} onCheckedChange={(v) => setFilterEnabled("period", v)}>
                  <div className="space-y-2"><label className="block text-[11px] font-medium text-slate-500">Fiscal month</label>{combo(String(selectedMonth), [{ value: "-1", label: "Custom range" }, ...months.map((m, i) => ({ value: String(i), label: m.label }))], "ledger-month", (v) => { const m = months[Number(v)]; if (m) setDraft((old) => ({ ...old, from: m.from, to: m.to })); }, "Choose month")}
                    <div className="grid grid-cols-2 gap-2"><label className="block text-[11px] font-medium text-slate-500">From ({p.calendar})<DateInput fieldName="From date" value={draft.from} onChange={(v) => updateDraft("from", v)} calendar={p.calendar} hasError={draft.from.startsWith("?")} onBlurField={() => { if (draft.from.startsWith("?")) setError("Enter a valid start date."); }} /></label><label className="block text-[11px] font-medium text-slate-500">To ({p.calendar})<DateInput fieldName="To date" value={draft.to} onChange={(v) => updateDraft("to", v)} calendar={p.calendar} hasError={draft.to.startsWith("?")} onBlurField={() => { if (draft.to.startsWith("?")) setError("Enter a valid end date."); }} /></label></div>
                    <div className="flex gap-2"><button type="button" className="btn" disabled={selectedMonth <= 0} onClick={() => { const m = months[selectedMonth - 1]; if (m) setDraft((old) => ({ ...old, from: m.from, to: m.to })); }}>‹ Previous month</button><button type="button" className="btn" disabled={selectedMonth < 0 || selectedMonth >= months.length - 1} onClick={() => { const m = months[selectedMonth + 1]; if (m) setDraft((old) => ({ ...old, from: m.from, to: m.to })); }}>Next month ›</button></div>
                  </div>
                </QueryFilterGroup>
                <QueryFilterGroup label="Ledger(s)" checked={draft.enabled.ledgers} onCheckedChange={(v) => setFilterEnabled("ledgers", v)}>
                  <div className="mb-2 flex gap-3 text-[11px]"><button type="button" className="text-cobalt-700 hover:underline" onClick={() => updateDraft("ledgerIds", ledgers.filter((x) => x.isActive).map((x) => x.id))}>Select active</button><button type="button" className="text-cobalt-700 hover:underline" onClick={() => updateDraft("ledgerIds", [])}>Clear</button><span className="text-slate-400">{draft.ledgerIds.length ? `${draft.ledgerIds.length} selected` : "All ledgers"}</span></div>
                  <div className="max-h-44 space-y-1 overflow-y-auto">{ledgers.map((x) => <label key={x.id} className="flex items-center gap-2 rounded px-1 py-1 text-[12px] hover:bg-slate-50"><input type="checkbox" checked={draft.ledgerIds.includes(x.id)} onChange={(e) => setDraft((old) => ({ ...old, ledgerIds: e.target.checked ? [...old.ledgerIds, x.id] : old.ledgerIds.filter((id) => id !== x.id) }))} className="h-4 w-4 accent-cobalt-700" /><span className="font-mono text-[11px] text-slate-500">{x.code}</span><span className="truncate">{x.name}</span></label>)}</div>
                </QueryFilterGroup>
                <QueryFilterGroup label="Sub-ledger" checked={draft.enabled.subLedger} onCheckedChange={(v) => setFilterEnabled("subLedger", v)}>
                  {combo(String(draft.subLedgerId), subs.map((x) => ({ value: String(x.id), label: `${x.code} — ${x.name}` })), "ledger-sub-ledger", (v) => updateDraft("subLedgerId", v ? Number(v) : ""), "All sub-ledgers")}
                </QueryFilterGroup>
                <QueryFilterGroup label="Product" checked={draft.enabled.product} onCheckedChange={(v) => setFilterEnabled("product", v)}>
                  {combo(String(draft.productId), (lookups?.products ?? []).map((x) => ({ value: String(x.id), label: `${x.code} — ${x.description}` })), "ledger-product", (v) => updateDraft("productId", v ? Number(v) : ""), "All products")}
                </QueryFilterGroup>
                <QueryFilterGroup label="Voucher type" checked={draft.enabled.voucherType} onCheckedChange={(v) => setFilterEnabled("voucherType", v)}>
                  {combo(draft.voucherType, [{ value: "ALL", label: "All types" }, { value: "JOURNAL", label: "Journal" }, { value: "CASH_BANK", label: "Cash / bank" }], "ledger-voucher-type", (v) => updateDraft("voucherType", v), "All types")}
                </QueryFilterGroup>
                <QueryFilterGroup label="Status" checked={draft.enabled.status} onCheckedChange={(v) => setFilterEnabled("status", v)}>
                  {combo(draft.status, [{ value: "POSTED", label: "Posted only" }, { value: "ALL", label: "Posted + drafts" }, { value: "DRAFT", label: "Drafts only" }], "ledger-status", (v) => updateDraft("status", v), "Choose status")}
                </QueryFilterGroup>
                <QueryFilterGroup label="Search" checked={draft.enabled.search} onCheckedChange={(v) => setFilterEnabled("search", v)} className="sm:col-span-2 xl:col-span-3">
                  <label className="flex items-center gap-2 rounded border border-slate-300 bg-white px-2 py-1.5"><Search size={14} className="text-slate-400" /><input ref={searchRef} value={draft.search} onChange={(e) => updateDraft("search", e.target.value)} placeholder="Voucher, narration, remarks, ledger or product…" className="w-full bg-transparent text-[12px] outline-none" /></label>
                </QueryFilterGroup>
              </div>
            </form>
            <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-slate-200 bg-white px-3 py-3 sm:px-4"><span className="mr-auto text-[11px] text-slate-500">Tab to move · Enter to run · Esc to close</span><button type="button" className="btn" onClick={resetQuery}>Reset</button><button type="button" className="btn" onClick={closeFilters}>Cancel</button><button type="button" className="btn btn-primary" onClick={() => applyQuery()}>Run query <kbd className="kbd ml-1">Enter</kbd></button></footer>
          </div>
        </div>
      )}
      <div className="grid shrink-0 grid-cols-2 gap-2 border-b border-slate-200 bg-slate-50 px-5 py-2 md:grid-cols-4">{summaryCards.map(([label, value]) => <div key={label} className="rounded border border-slate-200 bg-white px-3 py-2"><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div><div className="mt-0.5 truncate text-[14px] font-semibold tabular-nums text-slate-800">{value}</div></div>)}</div>
      <div className="min-h-0 flex-1 overflow-auto">
        {error ? <div role="alert" className="m-5 rounded border border-rose-200 bg-rose-50 p-3 text-[13px] text-rose-700">{error}</div> : null}
        {summaries.length > 0 && <div className="border-b border-slate-200 bg-white px-5 py-2"><div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Balance by ledger · {queryDateLabel}</div><div className="flex gap-2 overflow-x-auto pb-1">{summaries.map((s) => <div key={s.generalLedgerId} className="min-w-[220px] rounded border border-slate-200 px-3 py-2 text-[12px]"><div className="truncate font-medium text-slate-800">{s.code} · {s.name}</div><div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5 text-slate-500"><span>Opening</span><b className="text-right text-slate-700">{balanceText(s.opening)}</b><span>Dr</span><b className="text-right text-slate-700">{money(s.debit)}</b><span>Cr</span><b className="text-right text-slate-700">{money(s.credit)}</b><span>Closing</span><b className="text-right text-slate-900">{balanceText(s.closing)}</b></div></div>)}</div></div>}
        {loading && !result ? <p className="px-5 py-8 text-[13px] text-slate-500">Running ledger query…</p> : rows.length === 0 ? <div className="px-5 py-12 text-center"><p className="text-[14px] font-medium text-slate-700">No transactions match this query</p><p className="mt-1 text-[12px] text-slate-500">Open Filters to adjust the period, ledger or criteria.</p><button type="button" className="btn mt-3" onClick={() => setFiltersOpen(true)}><Filter size={13} /> Edit query</button></div> : (
          <>
            <div className="hidden md:block"><table className="w-full min-w-[1020px] border-collapse text-[12px]"><thead><tr className="border-b border-slate-200 text-left"><th className={`${th} w-7`}></th><th className={th}>Date</th>{activeLedgerIds.length !== 1 && <th className={th}>Ledger</th>}<th className={th}>Voucher / reference</th><th className={th}>Particulars</th><th className={`${th} text-right`}>Debit</th><th className={`${th} text-right`}>Credit</th><th className={`${th} text-right`}>Running balance</th><th className={th}>Status</th></tr></thead>
              <tbody>{rows.map((r: LedgerReportRow, index) => <Fragment key={`${r.kind}-${r.voucherId}-${r.lineId}`}>
                {activeLedgerIds.length !== 1 && (index === 0 || rows[index - 1].generalLedgerId !== r.generalLedgerId) && <tr className="bg-slate-100"><td colSpan={9} className="px-3 py-1.5 text-[11px] font-semibold text-slate-600">{r.ledgerCode} · {r.ledgerName}</td></tr>}
                <tr tabIndex={0} className="cursor-pointer hover:bg-blue-50/60 focus:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cobalt-600" onClick={() => toggleRow(r.lineId)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleRow(r.lineId); } }} aria-expanded={expanded === r.lineId} aria-label={`${r.voucherNumber}, ${r.ledgerName}, ${r.posted ? "posted" : "draft"}; press Enter for details`}>
                  <td className={td}>{expanded === r.lineId ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</td><td className={`${td} whitespace-nowrap tabular-nums`}>{shownDate(r.d.slice(0, 10), p.calendar)}</td>{activeLedgerIds.length !== 1 && <td className={td}><div className="font-medium text-slate-800">{r.ledgerName}</div><div className="font-mono text-[10px] text-slate-400">{r.ledgerCode}{r.subLedgerName ? ` · ${r.subLedgerName}` : ""}</div></td>}
                  <td className={td}><div className="font-mono font-semibold text-cobalt-800">{r.voucherNumber}</div><div className="mt-0.5 text-[10px] text-slate-500">{r.voucherLabel}{r.reference ? ` · ${r.reference}` : ""}</div></td><td className={`${td} max-w-[280px]`}><div className="truncate text-slate-700">{r.narration || r.remarks || `${r.sourceLabel} ${r.sourceNumber}`}</div>{r.products.length > 0 && <div className="mt-0.5 truncate text-[10px] text-slate-500">{r.products.length} product line{r.products.length === 1 ? "" : "s"}</div>}</td>
                  <td className={`${td} text-right tabular-nums text-slate-800`}>{Number(r.debit) ? money(r.debit) : "—"}</td><td className={`${td} text-right tabular-nums text-slate-800`}>{Number(r.credit) ? money(r.credit) : "—"}</td><td className={`${td} whitespace-nowrap text-right font-medium tabular-nums`}>{balanceText(r.running)}</td><td className={td}><span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${r.posted ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{r.posted ? (r.hasReversal ? "REVERSED" : r.reversalOfId ? "REVERSAL" : "POSTED") : "DRAFT"}</span></td>
                </tr>
                {expanded === r.lineId && <tr className="border-b border-slate-200 bg-slate-50"><td colSpan={activeLedgerIds.length !== 1 ? 9 : 8} className="px-10 py-3"><div className="grid gap-4 md:grid-cols-3"><div><h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Voucher detail</h3><p><b>{r.sourceLabel}:</b> {r.sourceNumber}</p><p><b>Ledger:</b> {r.ledgerCode} — {r.ledgerName}{r.subLedgerName ? ` · ${r.subLedgerName}` : ""}</p><p><b>Reference:</b> {r.reference || "—"}</p><p><b>Remarks:</b> {r.remarks || "—"}</p><p><b>Narration:</b> {r.narration || "—"}</p></div><div><h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Posting trail</h3><p><b>Status:</b> {r.posted ? "Posted" : "Draft"}</p><p><b>Posted at:</b> {r.postedAt ? new Date(r.postedAt).toLocaleString() : "—"}</p><p><b>Posted by:</b> {r.postedByName || "—"}</p><p><b>Voucher kind:</b> {r.voucherLabel}</p><p><b>Reversal link:</b> {r.reversalOfId ? `Reverses voucher ID ${r.reversalOfId}` : r.hasReversal ? "A posted reversal exists" : "—"}</p></div><div><h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Products / lines</h3>{r.products.length ? <div className="space-y-1">{r.products.map((x) => <div key={x.id} className="rounded border border-slate-200 bg-white px-2 py-1"><b>{x.code}</b> {x.description}<div className="text-[11px] text-slate-500">{x.qty} {x.unit}{x.altQty ? ` · ${x.altQty} ${x.altUnit}` : ""} × {money(x.rate)} · {money(x.amount)}</div>{(x.location || x.batch || x.expiry) && <div className="text-[10px] text-slate-400">{[x.location, x.batch && `Batch ${x.batch}`, x.expiry && `Expires ${x.expiry}`].filter(Boolean).join(" · ")}</div>}</div>)}</div> : <p className="text-slate-500">No product lines are linked to this voucher.</p>}</div></div></td></tr>}
              </Fragment>)}</tbody></table></div>
            <div className="space-y-2 p-3 md:hidden">{rows.map((r) => <article key={`${r.kind}-${r.voucherId}-${r.lineId}`} className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"><button type="button" className="block w-full p-3 text-left" onClick={() => toggleRow(r.lineId)} aria-expanded={expanded === r.lineId}><div className="flex items-start justify-between gap-2"><div><div className="text-[11px] tabular-nums text-slate-500">{shownDate(r.d.slice(0, 10), p.calendar)} · {r.voucherLabel}</div><div className="mt-0.5 font-mono text-[14px] font-semibold text-cobalt-800">{r.voucherNumber}</div></div><span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${r.posted ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{r.posted ? (r.hasReversal ? "REVERSED" : r.reversalOfId ? "REVERSAL" : "POSTED") : "DRAFT"}</span></div><div className="mt-1 text-[12px] font-medium text-slate-700">{r.ledgerCode} · {r.ledgerName}{r.subLedgerName ? ` · ${r.subLedgerName}` : ""}</div><div className="mt-1 truncate text-[12px] text-slate-500">{r.narration || r.remarks || `${r.sourceLabel} ${r.sourceNumber}`}</div><div className="mt-2 grid grid-cols-3 gap-2 border-t border-slate-100 pt-2 text-[11px]"><div><div className="text-slate-400">Debit</div><b className="tabular-nums text-slate-800">{Number(r.debit) ? money(r.debit) : "—"}</b></div><div><div className="text-slate-400">Credit</div><b className="tabular-nums text-slate-800">{Number(r.credit) ? money(r.credit) : "—"}</b></div><div className="text-right"><div className="text-slate-400">Balance</div><b className="tabular-nums text-slate-800">{balanceText(r.running)}</b></div></div></button>{expanded === r.lineId && <div className="space-y-2 border-t border-slate-200 bg-slate-50 p-3 text-[12px]"><div><b>{r.sourceLabel}:</b> {r.sourceNumber}</div><div><b>Remarks:</b> {r.remarks || "—"}</div><div><b>Narration:</b> {r.narration || "—"}</div><div><b>Posting:</b> {r.posted ? "Posted" : "Draft"}{r.postedAt ? ` · ${new Date(r.postedAt).toLocaleString()}` : ""}{r.postedByName ? ` · by ${r.postedByName}` : ""}</div><div><b>Reversal:</b> {r.reversalOfId ? `Reverses voucher ID ${r.reversalOfId}` : r.hasReversal ? "Posted reversal exists" : "—"}</div><div><b>Products:</b>{r.products.length ? <div className="mt-1 space-y-1">{r.products.map((x) => <div key={x.id} className="rounded border border-slate-200 bg-white p-2">{x.code} · {x.description}<div className="text-[11px] text-slate-500">{x.qty} {x.unit}{x.altQty ? ` · ${x.altQty} ${x.altUnit}` : ""} × {money(x.rate)} = {money(x.amount)}{x.location ? ` · ${x.location}` : ""}{x.batch ? ` · Batch ${x.batch}` : ""}</div></div>)}</div> : " — none linked"}</div></div>}</article>)}</div>
          </>
        )}
      </div>
      <footer className="flex shrink-0 items-center justify-between border-t border-slate-200 bg-white px-5 py-2 text-[12px] text-slate-600"><span>{result ? `${result.total.toLocaleString()} transaction lines · page ${page} of ${Math.max(1, Math.ceil(result.total / result.pageSize))}` : ""}</span><div className="flex gap-2"><button className="btn" disabled={page <= 1 || loading} onClick={() => setPage((x) => Math.max(1, x - 1))}>Previous</button><button className="btn" disabled={!result || page * result.pageSize >= result.total || loading} onClick={() => setPage((x) => x + 1)}>Next</button></div></footer>
    </section>
  );
}
