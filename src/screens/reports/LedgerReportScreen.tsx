import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Download, Filter, RefreshCw, Search, X } from "lucide-react";
import { ledgerReportApi, type LedgerReportLookups, type LedgerReportResult, type LedgerReportRow } from "../../api";
import { Combobox, type ComboOption } from "../../components/Combobox";
import { DateInput } from "../../components/DateInput";
import { adToBs } from "../../lib/nepaliDate";
import { amount, balanceOf, balanceText, buildBlocks, csvCell, fmtMinor, minor, money, monthsOf, pickInitialMonth, todayLocal, voucherRef, type LedgerBlock } from "../../lib/ledgerReportLayout";
import type { StatusInfo } from "../../types";

type Ledger = LedgerReportLookups["ledgers"][number];
type Query = {
  from: string; to: string;
  ledgerIds: number[]; allLedgers: boolean; // nothing chosen yet = neither: the screen waits for a ledger instead of querying everything
  subLedgerId: number | ""; productId: number | ""; voucherType: string; status: string; search: string;
};
type Remembered = { recent: number[]; all: boolean };

const PAGE_SIZE = 200;
const ALL = "__all", MULTI = "__multi";
const STATUS_OPTIONS: ComboOption[] = [{ value: "POSTED", label: "Posted only" }, { value: "ALL", label: "Posted + drafts" }, { value: "DRAFT", label: "Drafts only" }];
const TYPE_OPTIONS: ComboOption[] = [{ value: "ALL", label: "All types" }, { value: "JOURNAL", label: "Journal" }, { value: "CASH_BANK", label: "Cash / bank" }];

const storeKey = (companyId: number) => `namo.ledgerReport.${companyId}`;
function readRemembered(companyId: number): Remembered {
  try {
    const v = JSON.parse(localStorage.getItem(storeKey(companyId)) ?? "null");
    if (v && Array.isArray(v.recent)) return { recent: v.recent.filter((x: unknown) => Number.isInteger(x)).slice(0, 8), all: v.all === true };
  } catch { /* storage unavailable or corrupt: start fresh */ }
  return { recent: [], all: false };
}
function writeRemembered(companyId: number, r: Remembered) { try { localStorage.setItem(storeKey(companyId), JSON.stringify(r)); } catch { /* ignore */ } }

const shownDate = (v: string, calendar: "BS" | "AD") => calendar === "BS" ? adToBs(v) ?? v : v;
const statusTag = (r: LedgerReportRow) => !r.posted ? { text: "Draft", cls: "bg-amber-50 text-amber-700 ring-amber-200" }
  : r.hasReversal ? { text: "Reversed", cls: "bg-rose-50 text-rose-700 ring-rose-200" }
  : r.reversalOfId ? { text: "Reversal", cls: "bg-slate-100 text-slate-600 ring-slate-200" } : null;
const rowKey = (r: LedgerReportRow) => `${r.kind}-${r.lineId}`; // journal and cash/bank lines have separate id sequences
const particulars = (r: LedgerReportRow) => r.narration || r.remarks || `${r.sourceLabel} ${r.sourceNumber}`;
const th = "lg-th whitespace-nowrap px-3 py-1.5 text-left";
const td = "border-b border-slate-100 px-3 py-1 align-middle";
const balanceSides = (value: string) => {
  const n = minor(value);
  return { debit: n > 0n ? n : 0n, credit: n < 0n ? -n : 0n };
};

function RowDetail({ r }: { r: LedgerReportRow }) {
  const h = "mb-1 text-[12px] font-semibold text-slate-500";
  const hasProducts = r.products.length > 0; // only vouchers recorded with products have product lines; cash, bank and journal vouchers do not
  return (
    <div className={`grid gap-4 text-[12px] ${hasProducts ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
      <div><h3 className={h}>Voucher detail</h3><p><b>{r.sourceLabel}:</b> {r.sourceNumber}</p><p><b>Ledger:</b> {r.ledgerCode} — {r.ledgerName}{r.subLedgerName ? ` · ${r.subLedgerName}` : ""}</p><p><b>Reference:</b> {r.reference || "—"}</p><p><b>Remarks:</b> {r.remarks || "—"}</p><p><b>Narration:</b> {r.narration || "—"}</p></div>
      <div><h3 className={h}>Posting trail</h3><p><b>Status:</b> {r.posted ? "Posted" : "Draft"}</p><p><b>Posted at:</b> {r.postedAt ? new Date(r.postedAt).toLocaleString() : "—"}</p><p><b>Posted by:</b> {r.postedByName || "—"}</p><p><b>Voucher kind:</b> {r.voucherLabel}</p><p><b>Reversal link:</b> {r.reversalOfId ? `Reverses voucher ID ${r.reversalOfId}` : r.hasReversal ? "A posted reversal exists" : "—"}</p></div>
      {hasProducts && <div><h3 className={h}>Products / lines</h3><div className="space-y-1">{r.products.map((x) => <div key={x.id} className="rounded border border-slate-200 bg-white px-2 py-1"><b>{x.code}</b> {x.description}<div className="text-[11px] text-slate-500">{x.qty} {x.unit}{x.altQty ? ` · ${x.altQty} ${x.altUnit}` : ""} × {money(x.rate)} · {money(x.amount)}</div>{(x.location || x.batch || x.expiry) && <div className="text-[10px] text-slate-400">{[x.location, x.batch && `Batch ${x.batch}`, x.expiry && `Expires ${x.expiry}`].filter(Boolean).join(" · ")}</div>}</div>)}</div></div>}
    </div>
  );
}

/** Opening / brought-forward / carried-forward / closing line of one ledger. */
function EdgeRow({ label, balance, debit, credit, cols, strong, title }: { label: string; balance: bigint; debit?: bigint; credit?: bigint; cols: number; strong?: boolean; title?: string }) {
  const cell = `px-3 py-1 text-right tabular-nums ${strong ? "border-t border-slate-300 font-semibold text-slate-900" : "italic text-slate-600"}`;
  return (
    <tr className="bg-slate-50" title={title}>
      <td colSpan={cols - 3} className={`px-3 py-1 ${strong ? "border-t border-slate-300 font-semibold text-slate-900" : "italic text-slate-600"}`}>{label}</td>
      <td className={cell}>{debit !== undefined ? fmtMinor(debit) : ""}</td><td className={cell}>{credit !== undefined ? fmtMinor(credit) : ""}</td><td className={`${cell} whitespace-nowrap font-medium`}>{balanceOf(balance)}</td>
    </tr>
  );
}

export default function LedgerReportScreen(p: {
  companyId: number; branchId: number; branchName: string; fyCode: string; fyStart: string; fyEnd: string; calendar: "BS" | "AD";
  setStatus: (s: StatusInfo) => void; dirtyRef: MutableRefObject<boolean>;
}) {
  const months = useMemo(() => monthsOf(p.fyStart, p.fyEnd, p.calendar), [p.fyStart, p.fyEnd, p.calendar]);
  const makeQuery = (): Query => {
    const m = pickInitialMonth(months, todayLocal());
    return { from: m?.from ?? p.fyStart, to: m?.to ?? p.fyEnd, ledgerIds: [], allLedgers: false, subLedgerId: "", productId: "", voucherType: "ALL", status: "POSTED", search: "" };
  };
  const [query, setQuery] = useState<Query>(makeQuery);
  const [draft, setDraft] = useState<Query>(query);
  const [lookups, setLookups] = useState<LedgerReportLookups | null>(null);
  const [remembered, setRemembered] = useState<Remembered>({ recent: [], all: false });
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<LedgerReportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [dialogError, setDialogError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"summary" | "lines" | "details">("lines");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [ledgerFilter, setLedgerFilter] = useState("");
  const requestNo = useRef(0), resultScope = useRef(""), keyHandler = useRef<(e: KeyboardEvent) => void>();
  const barRef = useRef<HTMLDivElement>(null), scrollRef = useRef<HTMLDivElement>(null), filterButtonRef = useRef<HTMLButtonElement>(null), panelRef = useRef<HTMLDivElement>(null);

  const ready = query.allLedgers || query.ledgerIds.length > 0;
  const single = !query.allLedgers && query.ledgerIds.length === 1;
  const ledgers = lookups?.ledgers ?? [];
  const ledgerById = useMemo(() => new Map(ledgers.map((l) => [l.id, l])), [ledgers]);
  const scopeKey = `${query.allLedgers ? "all" : query.ledgerIds.join(",")}|${query.subLedgerId}|${query.productId}|${query.voucherType}|${query.status}|${query.search}`;

  useEffect(() => { p.dirtyRef.current = false; }, [p.dirtyRef]);

  // Ledgers, sub-ledgers and products; then reopen the ledger (or "all ledgers") used last time on this company.
  useEffect(() => {
    let alive = true;
    ledgerReportApi.lookups(p.companyId).then((data) => {
      if (!alive) return;
      setLookups(data);
      const known = new Set(data.ledgers.map((l) => l.id)), mem = readRemembered(p.companyId), recent = mem.recent.filter((id) => known.has(id));
      setRemembered({ recent, all: mem.all });
      if (mem.all) setQuery((q) => ({ ...q, allLedgers: true }));
      else if (recent[0]) setQuery((q) => ({ ...q, ledgerIds: [recent[0]] }));
    }).catch((e: Error) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [p.companyId]);

  const remember = (scope: Pick<Query, "ledgerIds" | "allLedgers">) => {
    const one = scope.ledgerIds.length === 1 ? scope.ledgerIds[0] : undefined;
    const next: Remembered = { recent: one === undefined ? remembered.recent : [one, ...remembered.recent.filter((id) => id !== one)].slice(0, 8), all: scope.allLedgers };
    setRemembered(next);
    writeRemembered(p.companyId, next);
  };

  const load = useCallback(() => {
    if (!ready) return;
    if (!query.from || !query.to || query.from > query.to) { setError("Choose a valid date range."); return; }
    const current = ++requestNo.current;
    setLoading(true); setError("");
    if (resultScope.current !== scopeKey) setResult(null); // another ledger or filter: do not show the old rows; a new period or page keeps them, dimmed, until the new ones arrive
    ledgerReportApi.get({ companyId: p.companyId, branchId: p.branchId, fiscalYear: p.fyCode, from: query.from, to: query.to,
      ledgerIds: query.ledgerIds.length ? query.ledgerIds.join(",") : undefined, subLedgerId: query.subLedgerId, productId: query.productId,
      voucherType: query.voucherType, status: query.status, search: query.search.trim(), page, pageSize: PAGE_SIZE })
      .then((data) => { if (current === requestNo.current) { resultScope.current = scopeKey; setResult(data); } })
      .catch((e: Error) => { if (current === requestNo.current) setError(e.message || "Could not load the ledger."); })
      .finally(() => { if (current === requestNo.current) setLoading(false); });
  }, [p.companyId, p.branchId, p.fyCode, query, page, ready, scopeKey]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => () => { requestNo.current += 1; }, []);

  useEffect(() => {
    p.setStatus({ mode: "view", count: result?.total ?? 0, shown: result?.rows.length ?? 0,
      message: error || (loading ? "Running ledger query…" : result ? "Ledger ready" : ready ? "Loading…" : "Choose a ledger"), kind: error ? "err" : "info",
      hints: ["F4 ledger · F2 filters", "↑ ↓ move between lines · Enter opens detail", "Balances count posted entries only"] });
  }, [result, loading, error, ready, p.setStatus]);

  // ---- toolbar ---------------------------------------------------------------------------------------------------------------
  const setPeriod = (from: string, to: string) => { setQuery((q) => ({ ...q, from, to })); setPage(1); setExpanded(null); };
  const chooseLedger = (v: string) => {
    if (v === MULTI) return;
    const scope = v === "" ? { ledgerIds: [], allLedgers: false } : v === ALL ? { ledgerIds: [], allLedgers: true } : { ledgerIds: [Number(v)], allLedgers: false };
    setQuery((q) => ({ ...q, ...scope, subLedgerId: "" })); setPage(1); setExpanded(null);
    remember(scope);
  };
  const monthIdx = months.findIndex((m) => m.from === query.from && m.to === query.to);
  const monthValue = monthIdx >= 0 ? String(monthIdx) : query.from === p.fyStart && query.to === p.fyEnd ? "fy" : "custom";
  const monthOptions: ComboOption[] = [...months.map((m, i) => ({ value: String(i), label: m.label })), { value: "fy", label: "Full fiscal year" }, ...(monthValue === "custom" ? [{ value: "custom", label: "Custom range" }] : [])];
  const stepMonth = (d: number) => { const m = months[monthIdx + d]; if (m) setPeriod(m.from, m.to); };
  const focusLines = () => scrollRef.current?.focus();

  const ledgerOptions = useMemo<ComboOption[]>(() => {
    const label = (l: Ledger) => `${l.code} — ${l.name}${l.isActive ? "" : " (inactive)"}`;
    const recent = remembered.recent.map((id) => ledgerById.get(id)).filter((l): l is Ledger => !!l);
    const rest = ledgers.filter((l) => !remembered.recent.includes(l.id));
    const ordered = [...recent, ...rest.filter((l) => l.isActive), ...rest.filter((l) => !l.isActive)]; // recent first, inactive last
    return [{ value: ALL, label: "All ledgers" }, ...(query.ledgerIds.length > 1 ? [{ value: MULTI, label: `${query.ledgerIds.length} ledgers selected` }] : []), ...ordered.map((l) => ({ value: String(l.id), label: label(l) }))];
  }, [ledgers, ledgerById, remembered.recent, query.ledgerIds.length]);
  const ledgerValue = query.allLedgers ? ALL : query.ledgerIds.length > 1 ? MULTI : query.ledgerIds.length === 1 ? String(query.ledgerIds[0]) : "";
  const subsOfLedger = useMemo(() => single ? (lookups?.subLedgers ?? []).filter((s) => s.generalLedgerId === query.ledgerIds[0]) : [], [single, lookups, query.ledgerIds]);

  const activeFilters = [query.subLedgerId !== "", query.productId !== "", query.voucherType !== "ALL", query.status !== "POSTED", query.search.trim() !== ""].filter(Boolean).length;

  // ---- filter dialog (the less common criteria; everything here is applied together) ----------------------------------------
  const openFilters = () => { setDraft({ ...query, ledgerIds: [...query.ledgerIds] }); setDialogError(""); setLedgerFilter(""); setFiltersOpen(true); };
  const closeFilters = () => { setFiltersOpen(false); filterButtonRef.current?.focus(); };
  const updateDraft = <K extends keyof Query>(key: K, value: Query[K]) => setDraft((old) => ({ ...old, [key]: value }));
  const applyDraft = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (draft.from.startsWith("?") || draft.to.startsWith("?")) { setDialogError("Enter valid dates."); return; }
    if (draft.from > draft.to) { setDialogError("Start date must be on or before end date."); return; }
    setQuery({ ...draft, ledgerIds: [...draft.ledgerIds] }); setPage(1); setExpanded(null);
    remember({ ledgerIds: draft.ledgerIds, allLedgers: draft.allLedgers });
    closeFilters();
  };
  const clearDraftFilters = () => setDraft((old) => ({ ...old, subLedgerId: "", productId: "", voucherType: "ALL", status: "POSTED", search: "" }));
  useEffect(() => { if (filtersOpen) panelRef.current?.querySelector<HTMLInputElement>("input")?.focus(); }, [filtersOpen]);

  keyHandler.current = (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key === "F2") { e.preventDefault(); if (filtersOpen) closeFilters(); else openFilters(); }
    if (e.key === "F4" && !filtersOpen) { e.preventDefault(); barRef.current?.querySelector<HTMLInputElement>('[data-field="ledger-picker"]')?.focus(); }
  };
  useEffect(() => { const h = (e: KeyboardEvent) => keyHandler.current?.(e); window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, []);

  // ---- data to draw ----------------------------------------------------------------------------------------------------------
  const pageCount = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;
  const blocks: LedgerBlock[] = useMemo(() => result ? buildBlocks({ rows: result.rows, summary: result.summary, page: result.page, pageCount, ledgerIds: query.ledgerIds }) : [], [result, pageCount, query.ledgerIds]);
  const rows = result?.rows ?? [];
  const showSub = rows.some((r) => r.subLedgerName);
  const cols = showSub ? 7 : 6;
  const summary = single && !query.subLedgerId ? result?.summary.find((s) => s.generalLedgerId === query.ledgerIds[0]) : undefined;
  const summaryRows = result?.summary ?? [];
  const summaryTotals = useMemo(() => summaryRows.reduce((t, s) => {
    const opening = balanceSides(s.opening), closing = balanceSides(s.closing);
    t.openingDebit += opening.debit; t.openingCredit += opening.credit;
    t.periodDebit += minor(s.debit); t.periodCredit += minor(s.credit);
    t.closingDebit += closing.debit; t.closingCredit += closing.credit;
    return t;
  }, { openingDebit: 0n, openingCredit: 0n, periodDebit: 0n, periodCredit: 0n, closingDebit: 0n, closingCredit: 0n }), [summaryRows]);
  const toggleRow = (key: string) => setExpanded((x) => x === key ? null : key);
  const onRowKey = (e: React.KeyboardEvent<HTMLElement>, key: string) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleRow(key); }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const all = Array.from(scrollRef.current?.querySelectorAll<HTMLElement>("[data-row]") ?? []), at = all.indexOf(e.currentTarget);
      all[Math.max(0, Math.min(all.length - 1, at + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
    }
  };

  // Every line of the query (all pages), with the date in both calendars.
  const exportCsv = async () => {
    if (!ready || exporting) return;
    setExporting(true); setError("");
    try {
      const all: LedgerReportRow[] = [];
      for (let pg = 1; pg <= 100; pg++) {
        const r = await ledgerReportApi.get({ companyId: p.companyId, branchId: p.branchId, fiscalYear: p.fyCode, from: query.from, to: query.to,
          ledgerIds: query.ledgerIds.length ? query.ledgerIds.join(",") : undefined, subLedgerId: query.subLedgerId, productId: query.productId,
          voucherType: query.voucherType, status: query.status, search: query.search.trim(), page: pg, pageSize: 200 });
        all.push(...r.rows);
        if (!r.rows.length || all.length >= r.total) break;
      }
      const head = ["Date (AD)", "Date (BS)", "Ledger", "Sub-ledger", "Voucher type", "Voucher number", "Source", "Narration", "Remarks", "Debit", "Credit", "Running balance", "Status", "Posted at", "Posted by", "Products"];
      const body = all.map((r) => {
        const d = r.d.slice(0, 10);
        const prods = r.products.map((x) => `${x.code} ${x.description} ${x.qty} ${x.unit}${x.altQty ? `; alt ${x.altQty} ${x.altUnit}` : ""}${x.location ? `; ${x.location}` : ""}${x.batch ? `; batch ${x.batch}` : ""}${x.expiry ? `; expiry ${x.expiry}` : ""}`).join("; ");
        return [csvCell(d), csvCell(adToBs(d) ?? ""), csvCell(`${r.ledgerCode} ${r.ledgerName}`), csvCell(r.subLedgerName), csvCell(r.voucherLabel), csvCell(r.voucherNumber), csvCell(`${r.sourceLabel} ${r.sourceNumber}`), csvCell(r.narration), csvCell(r.remarks),
          csvCell(r.debit, "number"), csvCell(r.credit, "number"), csvCell(r.running, "number"), csvCell(r.posted ? "Posted" : "Draft"), csvCell(r.postedAt), csvCell(r.postedByName), csvCell(prods)].join(",");
      });
      const csv = [head.map((h) => csvCell(h)).join(","), ...body].join("\r\n");
      const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }), a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `ledger-${single ? ledgerById.get(query.ledgerIds[0])?.code ?? "ledger" : "all"}-${query.from}-${query.to}.csv`;
      a.click(); URL.revokeObjectURL(a.href);
    } catch (e) { setError((e as Error).message || "Could not export the ledger."); }
    finally { setExporting(false); }
  };

  // ---- pieces ----------------------------------------------------------------------------------------------------------------
  const combo = (value: string, options: ComboOption[], fieldName: string, onChange: (v: string) => void, placeholder: string, extra?: { required?: boolean; onCommit?: () => void; disabled?: boolean }) =>
    <Combobox value={value} options={options} onChange={onChange} fieldName={fieldName} placeholder={placeholder} required={extra?.required} disabled={extra?.disabled} onCommit={extra?.onCommit} />;
  const quickPicks = (remembered.recent.length ? remembered.recent.map((id) => ledgerById.get(id)).filter((l): l is Ledger => !!l) : ledgers.filter((l) => l.isActive)).slice(0, 8);
  const draftSubs = (lookups?.subLedgers ?? []).filter((s) => draft.allLedgers || !draft.ledgerIds.length || draft.ledgerIds.includes(s.generalLedgerId));
  const lf = ledgerFilter.trim().toLowerCase(), draftLedgerList = ledgers.filter((x) => !lf || `${x.code} ${x.name}`.toLowerCase().includes(lf));
  const periodNote = monthValue === "custom" ? `${shownDate(query.from, p.calendar)} → ${shownDate(query.to, p.calendar)}` : "";

  const lineRow = (r: LedgerReportRow) => {
    const key = rowKey(r), tag = statusTag(r), open = viewMode === "details" || expanded === key, ref = voucherRef(r);
    return (
      <Fragment key={key}>
        <tr data-row tabIndex={0} className={`cursor-pointer hover:bg-cobalt-50/70 focus:bg-cobalt-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cobalt-600 ${r.posted ? "" : "bg-amber-50/30"}`} onClick={() => toggleRow(key)} onKeyDown={(e) => onRowKey(e, key)} aria-expanded={open} aria-label={`${ref}, ${r.ledgerName}, ${r.posted ? "posted" : "draft"}; press Enter for details`}>
          <td className={`${td} w-6 pr-0 text-slate-400`}>{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</td>
          <td className={`${td} whitespace-nowrap tabular-nums`}>{shownDate(r.d.slice(0, 10), p.calendar)}</td>
          <td className={`${td} w-full whitespace-nowrap`} title={particulars(r)}><span className="font-semibold text-cobalt-800">{ref}</span>{tag && <span className={`ml-1.5 rounded px-1 text-[10px] font-semibold ring-1 ring-inset ${tag.cls}`}>{tag.text}</span>}</td>
          {showSub && <td className={`${td} whitespace-nowrap text-slate-600`}>{r.subLedgerName ?? ""}</td>}
          <td className={`${td} whitespace-nowrap text-right tabular-nums ${Number(r.debit) ? "text-slate-900" : "text-slate-300"}`}>{Number(r.debit) ? amount(r.debit) : "—"}</td>
          <td className={`${td} whitespace-nowrap text-right tabular-nums ${Number(r.credit) ? "text-slate-900" : "text-slate-300"}`}>{Number(r.credit) ? amount(r.credit) : "—"}</td>
          <td className={`${td} whitespace-nowrap text-right font-medium tabular-nums`}>{balanceText(r.running)}</td>
        </tr>
        {open && <tr className="border-b border-slate-200 bg-slate-50"><td colSpan={cols} className="px-10 py-3"><RowDetail r={r} /></td></tr>}
      </Fragment>
    );
  };
  const edgeTitle = "Posted entries of this ledger for the whole period, whatever filters are set";

  return (
    <section className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-white">
      <div ref={barRef} className="lr-bar flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-slate-200 bg-white px-3 py-1" role="toolbar" aria-label="Ledger report controls">
        <div className="w-full min-w-[12rem] sm:w-[17rem]">{combo(ledgerValue, ledgerOptions, "ledger-picker", chooseLedger, lookups ? "Select ledger — type code or name" : "Loading ledgers…", { onCommit: focusLines, disabled: !lookups })}</div>
        {subsOfLedger.length > 0 && <div className="w-full sm:w-[12rem]">{combo(String(query.subLedgerId), [{ value: "", label: "All sub-ledgers" }, ...subsOfLedger.map((s) => ({ value: String(s.id), label: `${s.code} — ${s.name}` }))], "ledger-sub-ledger", (v) => { setQuery((q) => ({ ...q, subLedgerId: v ? Number(v) : "" })); setPage(1); setExpanded(null); }, "All sub-ledgers", { onCommit: focusLines })}</div>}
        <div className="flex items-center gap-1">
          <button type="button" className="btn px-1.5" onClick={() => stepMonth(-1)} disabled={monthIdx <= 0} aria-label="Previous month" title="Previous month"><ChevronLeft size={14} /></button>
          <div className="w-[9.5rem]" title={`${shownDate(query.from, p.calendar)} → ${shownDate(query.to, p.calendar)}`}>{combo(monthValue, monthOptions, "ledger-month", (v) => { if (v === "fy") setPeriod(p.fyStart, p.fyEnd); else if (v !== "custom") { const m = months[Number(v)]; if (m) setPeriod(m.from, m.to); } }, "Choose month", { required: true, onCommit: focusLines })}</div>
          <button type="button" className="btn px-1.5" onClick={() => stepMonth(1)} disabled={monthIdx < 0 || monthIdx >= months.length - 1} aria-label="Next month" title="Next month"><ChevronRight size={14} /></button>
        </div>
        {periodNote && <span className="text-[11px] tabular-nums text-slate-500">{periodNote}</span>}
        <div className="inline-flex rounded-md border border-slate-300 bg-slate-50 p-0.5" role="group" aria-label="Ledger report view">
          {(["summary", "lines", "details"] as const).map((mode) => <button key={mode} type="button" className={`rounded px-2 py-1 text-[12px] font-medium transition-colors ${viewMode === mode ? "bg-white text-cobalt-800 shadow-sm ring-1 ring-slate-200" : "text-slate-600 hover:text-slate-900"}`} onClick={() => { setViewMode(mode); setExpanded(null); }} aria-pressed={viewMode === mode}>{mode[0].toUpperCase() + mode.slice(1)}</button>)}
        </div>
        <button ref={filterButtonRef} type="button" className="btn" onClick={openFilters} aria-haspopup="dialog" aria-expanded={filtersOpen}><Filter size={13} /> Filters{activeFilters > 0 && <span className="lg-count">{activeFilters}</span>}<kbd className="kbd hidden 2xl:inline">F2</kbd></button>
        <div className="ml-auto flex items-center gap-1.5">
          {summary && <span className="lg-chip" title={`Opening ${balanceText(summary.opening)} · Debit ${amount(summary.debit)} · Credit ${amount(summary.credit)}`}>Closing <b className="tabular-nums">{balanceText(summary.closing)}</b></span>}
          {pageCount > 1 && <div className="flex items-center gap-1 text-[12px] text-slate-600"><button type="button" className="btn px-1.5" disabled={page <= 1 || loading} onClick={() => setPage((x) => Math.max(1, x - 1))} aria-label="Previous page"><ChevronLeft size={14} /></button><span className="tabular-nums" title={`${result?.total.toLocaleString()} lines`}>{page} / {pageCount}</span><button type="button" className="btn px-1.5" disabled={page >= pageCount || loading} onClick={() => setPage((x) => x + 1)} aria-label="Next page"><ChevronRight size={14} /></button></div>}
          <button type="button" className="btn px-1.5" onClick={load} disabled={loading || !ready} aria-label="Refresh" title="Refresh"><RefreshCw size={13} className={loading ? "animate-spin" : ""} /></button>
          <button type="button" className="btn" onClick={exportCsv} disabled={!ready || exporting || !result?.total} title="Download every line of this query as CSV"><Download size={13} /> {exporting ? "Exporting…" : "CSV"}</button>
        </div>
      </div>

      {filtersOpen && (
        <div className="fixed inset-0 z-[100] bg-slate-950/25 p-2 sm:p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) closeFilters(); }}>
          <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="ledger-query-title" className="mx-auto flex max-h-[calc(100vh-1rem)] w-full max-w-[920px] flex-col overflow-hidden rounded-xl border border-slate-300 bg-slate-50 shadow-2xl sm:mt-6 sm:max-h-[calc(100vh-3rem)]" onKeyDown={(e) => {
            if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeFilters(); }
            if (e.key === "Tab") { const focusable = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])') ?? []); const first = focusable[0], last = focusable[focusable.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); } }
            if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement) && !(e.target instanceof HTMLInputElement && e.target.type === "checkbox")) { e.preventDefault(); applyDraft(); }
          }}>
            <header className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5"><div className="min-w-0 flex-1"><h2 id="ledger-query-title" className="font-semibold text-slate-900">More filters</h2><p className="text-[11px] text-slate-500">Ledger and month are in the bar above. Use this for several ledgers, a custom date range or other criteria.</p></div><button type="button" className="btn px-2" onClick={closeFilters} aria-label="Close filters"><X size={15} /></button></header>
            <form className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4" onSubmit={applyDraft}>
              {dialogError && <div role="alert" className="mb-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{dialogError}</div>}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <fieldset className="rounded-lg border border-slate-200 bg-white p-3 sm:row-span-2">
                  <legend className="sr-only">Ledgers</legend>
                  <div className="mb-2 flex items-center gap-3 text-[12px]"><span className="font-semibold text-slate-800">Ledgers</span><button type="button" className="text-cobalt-700 hover:underline" onClick={() => setDraft((old) => ({ ...old, allLedgers: false, ledgerIds: ledgers.filter((x) => x.isActive).map((x) => x.id) }))}>All active</button><button type="button" className="text-cobalt-700 hover:underline" onClick={() => setDraft((old) => ({ ...old, allLedgers: false, ledgerIds: [], subLedgerId: "" }))}>Clear</button><span className="ml-auto text-slate-400">{draft.allLedgers ? "All ledgers" : draft.ledgerIds.length ? `${draft.ledgerIds.length} selected` : "None selected"}</span></div>
                  <label className="mb-2 flex items-center gap-2 rounded border border-slate-300 bg-white px-2 py-1"><Search size={13} className="text-slate-400" /><input value={ledgerFilter} onChange={(e) => setLedgerFilter(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); const hit = draftLedgerList[0]; if (hit) { setDraft((old) => old.ledgerIds.includes(hit.id) ? old : { ...old, allLedgers: false, subLedgerId: "", ledgerIds: [...old.ledgerIds, hit.id] }); setLedgerFilter(""); } } }} placeholder="Find a ledger by code or name, Enter to tick the first match…" className="w-full bg-transparent text-[12px] outline-none" /></label>
                  <div className="max-h-64 space-y-0.5 overflow-y-auto">
                    <label className="flex items-center gap-2 rounded px-1 py-1 text-[12px] font-medium hover:bg-slate-50"><input type="checkbox" checked={draft.allLedgers} onChange={(e) => setDraft((old) => ({ ...old, allLedgers: e.target.checked, ledgerIds: e.target.checked ? [] : old.ledgerIds, subLedgerId: "" }))} className="h-4 w-4 accent-cobalt-700" /> All ledgers</label>
                    {draftLedgerList.map((x) => <label key={x.id} className={`flex items-center gap-2 rounded px-1 py-1 text-[12px] hover:bg-slate-50 ${x.isActive ? "" : "text-slate-400"}`}><input type="checkbox" checked={draft.ledgerIds.includes(x.id)} onChange={(e) => setDraft((old) => ({ ...old, allLedgers: false, subLedgerId: "", ledgerIds: e.target.checked ? [...old.ledgerIds, x.id] : old.ledgerIds.filter((id) => id !== x.id) }))} className="h-4 w-4 accent-cobalt-700" /><span className="font-mono text-[11px] text-slate-500">{x.code}</span><span className="truncate">{x.name}{x.isActive ? "" : " (inactive)"}</span></label>)}
                    {draftLedgerList.length === 0 && <p className="px-1 py-2 text-[12px] text-slate-500">No ledger matches “{ledgerFilter}”.</p>}
                  </div>
                </fieldset>
                <fieldset className="rounded-lg border border-slate-200 bg-white p-3">
                  <legend className="sr-only">Date range</legend>
                  <div className="mb-2 flex items-center gap-3 text-[12px]"><span className="font-semibold text-slate-800">Date range</span><button type="button" className="text-cobalt-700 hover:underline" onClick={() => setDraft((old) => ({ ...old, from: p.fyStart, to: p.fyEnd }))}>Full fiscal year</button></div>
                  <div className="grid grid-cols-2 gap-2"><label className="block text-[11px] font-medium text-slate-500">From ({p.calendar})<DateInput fieldName="From date" value={draft.from} onChange={(v) => updateDraft("from", v)} calendar={p.calendar} hasError={draft.from.startsWith("?")} onBlurField={() => { if (draft.from.startsWith("?")) setDialogError("Enter a valid start date."); }} /></label><label className="block text-[11px] font-medium text-slate-500">To ({p.calendar})<DateInput fieldName="To date" value={draft.to} onChange={(v) => updateDraft("to", v)} calendar={p.calendar} hasError={draft.to.startsWith("?")} onBlurField={() => { if (draft.to.startsWith("?")) setDialogError("Enter a valid end date."); }} /></label></div>
                </fieldset>
                <fieldset className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
                  <legend className="sr-only">Other criteria</legend>
                  <div className="flex items-center text-[12px]"><span className="font-semibold text-slate-800">Other criteria</span><button type="button" className="ml-auto text-cobalt-700 hover:underline" onClick={clearDraftFilters}>Clear these</button></div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block text-[11px] font-medium text-slate-500">Sub-ledger{combo(String(draft.subLedgerId), [{ value: "", label: "All sub-ledgers" }, ...draftSubs.map((x) => ({ value: String(x.id), label: `${x.code} — ${x.name}` }))], "ledger-sub-ledger-filter", (v) => updateDraft("subLedgerId", v ? Number(v) : ""), "All sub-ledgers")}</label>
                    <label className="block text-[11px] font-medium text-slate-500">Product{combo(String(draft.productId), [{ value: "", label: "All products" }, ...(lookups?.products ?? []).map((x) => ({ value: String(x.id), label: `${x.code} — ${x.description}` }))], "ledger-product", (v) => updateDraft("productId", v ? Number(v) : ""), "All products")}</label>
                    <label className="block text-[11px] font-medium text-slate-500">Voucher type{combo(draft.voucherType, TYPE_OPTIONS, "ledger-voucher-type", (v) => updateDraft("voucherType", v || "ALL"), "All types", { required: true })}</label>
                    <label className="block text-[11px] font-medium text-slate-500">Status{combo(draft.status, STATUS_OPTIONS, "ledger-status", (v) => updateDraft("status", v || "POSTED"), "Choose status", { required: true })}</label>
                  </div>
                  <label className="block text-[11px] font-medium text-slate-500">Search<span className="mt-0.5 flex items-center gap-2 rounded border border-slate-300 bg-white px-2 py-1.5"><Search size={14} className="text-slate-400" /><input value={draft.search} onChange={(e) => updateDraft("search", e.target.value)} placeholder="Voucher, narration, remarks, ledger or product…" className="w-full bg-transparent text-[12px] outline-none" /></span></label>
                </fieldset>
              </div>
            </form>
            <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-slate-200 bg-white px-3 py-3 sm:px-4"><span className="mr-auto text-[11px] text-slate-500">Tab to move · Enter to apply · Esc to close</span><button type="button" className="btn" onClick={closeFilters}>Cancel</button><button type="button" className="btn btn-primary" onClick={() => applyDraft()}>Apply <kbd className="kbd ml-1">Enter</kbd></button></footer>
          </div>
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        {loading && <div className="absolute inset-x-0 top-0 z-20 h-0.5 animate-pulse bg-cobalt-600" role="progressbar" aria-label="Loading ledger" />}
        <div ref={scrollRef} tabIndex={-1} className="lg-scroll h-full overflow-auto focus:outline-none" aria-busy={loading}>
          {error && <div role="alert" className="m-4 flex items-center gap-3 rounded border border-rose-200 bg-rose-50 p-3 text-[13px] text-rose-700"><span className="min-w-0 flex-1">{error}</span>{ready && <button type="button" className="btn shrink-0" onClick={load}>Try again</button>}</div>}
          {!lookups && !error ? <p className="px-5 py-10 text-[13px] text-slate-500">Loading ledgers…</p>
            : lookups && ledgers.length === 0 ? <div className="px-5 py-14 text-center"><p className="text-[14px] font-medium text-slate-700">No ledgers yet</p><p className="mt-1 text-[12px] text-slate-500">Create a general ledger under Masters, then come back to see its statement.</p></div>
            : lookups && !ready ? (
              <div className="mx-auto max-w-[640px] px-5 py-12 text-center">
                <p className="text-[15px] font-semibold text-slate-800">Choose a ledger to open its statement</p>
                <p className="mt-1 text-[12px] text-slate-500">Type a code or name in the box above (<kbd className="kbd">F4</kbd>), or start from one of these.</p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {quickPicks.map((l) => <button key={l.id} type="button" className="btn max-w-full min-w-0" onClick={() => chooseLedger(String(l.id))}><span className="shrink-0 font-mono text-[11px] text-slate-500">{l.code}</span><span className="truncate">{l.name}</span></button>)}
                  <button type="button" className="btn" onClick={() => chooseLedger(ALL)}>All ledgers</button>
                </div>
              </div>
            ) : ready && !result && !error ? <p className="px-5 py-10 text-[13px] text-slate-500">Running ledger query…</p>
            : ready && result && blocks.length === 0 && viewMode !== "summary" ? (
              <div className="px-5 py-14 text-center">
                <p className="text-[14px] font-medium text-slate-700">No transactions match</p>
                <p className="mt-1 text-[12px] text-slate-500">{monthValue === "fy" ? "Nothing in this fiscal year for the chosen ledger and filters." : "Nothing in this period for the chosen ledger and filters."}</p>
                <div className="mt-3 flex justify-center gap-2">{monthValue !== "fy" && <button type="button" className="btn" onClick={() => setPeriod(p.fyStart, p.fyEnd)}>Show full fiscal year</button>}<button type="button" className="btn" onClick={openFilters}><Filter size={13} /> More filters</button></div>
              </div>
            ) : result && viewMode === "summary" ? (
              <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
                <p className="border-b border-slate-100 px-3 py-2 text-[11px] text-slate-500">Balances show posted activity for the selected period; transaction filters apply to Lines and Details.</p>
                <div className="hidden overflow-x-auto md:block">
                  <table className="lg-ledger w-full min-w-[900px] text-[12px]">
                    <thead><tr><th className={th}>Ledger</th><th className={`${th} text-right`}>Opening Dr</th><th className={`${th} text-right`}>Opening Cr</th><th className={`${th} text-right`}>Period Dr</th><th className={`${th} text-right`}>Period Cr</th><th className={`${th} text-right`}>Closing Dr</th><th className={`${th} text-right`}>Closing Cr</th></tr></thead>
                    <tbody>
                      {summaryRows.map((s) => { const opening = balanceSides(s.opening), closing = balanceSides(s.closing); return <tr key={s.generalLedgerId}>
                        <td className={`${td} whitespace-nowrap`}><span className="mr-2 font-mono text-[11px] text-slate-500">{s.code}</span><span className="font-medium text-slate-800">{s.name}</span></td>
                        {[opening.debit, opening.credit, minor(s.debit), minor(s.credit), closing.debit, closing.credit].map((v, i) => <td key={i} className={`${td} whitespace-nowrap text-right tabular-nums`}>{v ? fmtMinor(v) : "—"}</td>)}
                      </tr>; })}
                      <tr className="bg-slate-50 font-semibold text-slate-900"><td className="border-t border-slate-300 px-3 py-1.5">Total</td>{Object.values(summaryTotals).map((v, i) => <td key={i} className="border-t border-slate-300 px-3 py-1.5 text-right tabular-nums">{v ? fmtMinor(v) : "—"}</td>)}</tr>
                      {summaryRows.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-500">No ledger balances in this selection.</td></tr>}
                    </tbody>
                  </table>
                </div>
                <div className="space-y-2 p-2 md:hidden">
                  {summaryRows.map((s) => { const opening = balanceSides(s.opening), closing = balanceSides(s.closing); const values = [opening.debit, opening.credit, minor(s.debit), minor(s.credit), closing.debit, closing.credit]; return <article key={s.generalLedgerId} className="rounded-lg border border-slate-200 bg-white p-2.5">
                    <h2 className="truncate text-[12px] font-semibold text-slate-800"><span className="mr-1.5 font-mono text-[11px] font-normal text-slate-500">{s.code}</span>{s.name}</h2>
                    <div className="mt-2 grid grid-cols-3 gap-x-2 gap-y-1.5 border-t border-slate-100 pt-2 text-[11px]">{["Opening Dr", "Opening Cr", "Period Dr", "Period Cr", "Closing Dr", "Closing Cr"].map((label, i) => <div key={label}><div className="text-slate-400">{label}</div><b className="tabular-nums">{values[i] ? fmtMinor(values[i]) : "—"}</b></div>)}</div>
                  </article>; })}
                  {summaryRows.length === 0 && <p className="px-2 py-6 text-center text-[12px] text-slate-500">No ledger balances in this selection.</p>}
                </div>
              </div>
            ) : result ? (
              <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
                <div className="hidden md:block">
                  <table className="lg-ledger w-full min-w-[760px] text-[12px]">
                    <thead><tr><th className={`${th} w-6 pr-0`} /><th className={`${th} w-[92px]`}>Date</th><th className={th}>Particulars</th>{showSub && <th className={th}>Sub-ledger</th>}<th className={`${th} w-[120px] text-right`}>Debit</th><th className={`${th} w-[120px] text-right`}>Credit</th><th className={`${th} w-[150px] text-right`}>Balance</th></tr></thead>
                    <tbody>
                      {blocks.map((b) => <Fragment key={b.key}>
                        {!single && <tr><td colSpan={cols} className="border-b border-slate-200 bg-slate-100 px-3 py-1 text-[12px] font-semibold text-slate-700"><span className="mr-2 font-mono text-[11px] font-normal text-slate-500">{b.code}</span>{b.name}</td></tr>}
                        {b.start && <EdgeRow label={b.start.label} balance={b.start.balance} cols={cols} />}
                        {b.rows.length === 0 && <tr><td colSpan={cols} className="px-3 py-4 text-center text-slate-500">No transactions in this period.</td></tr>}
                        {b.rows.map(lineRow)}
                        {b.end && <EdgeRow label={b.end.label} balance={b.end.balance} debit={b.end.kind === "closing" ? b.end.debit : undefined} credit={b.end.kind === "closing" ? b.end.credit : undefined} cols={cols} strong={b.end.kind === "closing"} title={b.end.kind === "closing" ? edgeTitle : undefined} />}
                      </Fragment>)}
                    </tbody>
                  </table>
                </div>
                <div className="space-y-2 p-2 md:hidden">
                  {blocks.map((b) => <section key={b.key} className="space-y-1.5">
                    {!single && <h2 className="px-1 pt-1 text-[12px] font-semibold text-slate-700"><span className="mr-1.5 font-mono text-[11px] font-normal text-slate-500">{b.code}</span>{b.name}</h2>}
                    {b.start && <div className="flex justify-between px-1 text-[12px] italic text-slate-600"><span>{b.start.label}</span><span className="tabular-nums">{balanceOf(b.start.balance)}</span></div>}
                    {b.rows.length === 0 && <p className="px-1 py-2 text-[12px] text-slate-500">No transactions in this period.</p>}
                    {b.rows.map((r) => { const key = rowKey(r), tag = statusTag(r), open = viewMode === "details" || expanded === key; return (
                      <article key={key} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                        <button type="button" className="block w-full p-2.5 text-left" onClick={() => toggleRow(key)} aria-expanded={open}>
                          <div className="flex items-center justify-between gap-2"><span className="text-[11px] tabular-nums text-slate-500">{shownDate(r.d.slice(0, 10), p.calendar)}</span><span className="text-[13px] font-semibold text-cobalt-800">{voucherRef(r)}{tag && <span className={`ml-1.5 rounded px-1 text-[10px] font-semibold ring-1 ring-inset ${tag.cls}`}>{tag.text}</span>}</span></div>
                          <div className="mt-0.5 truncate text-[12px] text-slate-700">{particulars(r)}{r.subLedgerName ? ` · ${r.subLedgerName}` : ""}</div>
                          <div className="mt-1.5 grid grid-cols-3 gap-2 border-t border-slate-100 pt-1.5 text-[11px]"><div><div className="text-slate-400">Debit</div><b className="tabular-nums">{Number(r.debit) ? amount(r.debit) : "—"}</b></div><div><div className="text-slate-400">Credit</div><b className="tabular-nums">{Number(r.credit) ? amount(r.credit) : "—"}</b></div><div className="text-right"><div className="text-slate-400">Balance</div><b className="tabular-nums">{balanceText(r.running)}</b></div></div>
                        </button>
                        {open && <div className="border-t border-slate-200 bg-slate-50 p-3"><RowDetail r={r} /></div>}
                      </article>); })}
                    {b.end && <div className="flex justify-between px-1 pb-1 text-[12px] font-semibold text-slate-800"><span>{b.end.label}</span><span className="tabular-nums">{balanceOf(b.end.balance)}</span></div>}
                  </section>)}
                </div>
              </div>
            ) : null}
        </div>
      </div>
    </section>
  );
}
