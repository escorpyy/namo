import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { ChevronDown, ChevronRight, Download, RefreshCw, Search } from "lucide-react";
import { ledgerReportApi, type LedgerReportLookups, type LedgerReportResult, type LedgerReportRow } from "../../api";
import { DateInput } from "../../components/DateInput";
import { adToBs, bsToAd } from "../../lib/nepaliDate";
import { groupIN } from "../../components/purchase/Bits";
import type { StatusInfo } from "../../types";

type Month = { from: string; to: string; label: string };
const pad = (n: number) => String(n).padStart(2, "0");
const addDay = (s: string, days: number) => { const d = new Date(`${s}T12:00:00`); d.setDate(d.getDate() + days); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
function monthsOf(fyStart: string, fyEnd: string): Month[] {
  const bsStart = adToBs(fyStart), bsEnd = adToBs(fyEnd);
  if (!bsStart || !bsEnd) {
    const months: Month[] = []; const cursor = new Date(`${fyStart}T12:00:00`), end = new Date(`${fyEnd}T12:00:00`);
    while (cursor <= end) { const y = cursor.getFullYear(), m = cursor.getMonth(); const a = `${y}-${pad(m + 1)}-01`, b = `${y}-${pad(m + 1)}-${pad(new Date(y, m + 1, 0).getDate())}`; const from = a < fyStart ? fyStart : a, to = b > fyEnd ? fyEnd : b; months.push({ from, to, label: `${new Intl.DateTimeFormat("en", { month: "short", year: "numeric" }).format(cursor)} · ${from}–${to}` }); cursor.setMonth(m + 1, 1); }
    return months;
  }
  const [sy, sm] = bsStart.split("-").map(Number), [ey, em] = bsEnd.split("-").map(Number); const months: Month[] = [];
  let y = sy, m = sm;
  while (y < ey || (y === ey && m <= em)) {
    const nextY = m === 12 ? y + 1 : y, nextM = m === 12 ? 1 : m + 1;
    const rawFrom = bsToAd(`${y}-${pad(m)}-01`), next = bsToAd(`${nextY}-${pad(nextM)}-01`);
    if (rawFrom && next) {
      const rawTo = addDay(next, -1), from = rawFrom < fyStart ? fyStart : rawFrom, to = rawTo > fyEnd ? fyEnd : rawTo;
      if (from <= to) months.push({ from, to, label: `${y}-${pad(m)} BS · ${adToBs(from) ?? from}–${adToBs(to) ?? to}` });
    }
    y = nextY; m = nextM;
  }
  return months;
}
const shownDate = (v: string, calendar: "BS" | "AD") => calendar === "BS" ? adToBs(v) ?? v : v;
const money = (v: string) => groupIN(v || "0");
function minor(v: string): bigint {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(v || "0"); if (!m) return 0n;
  const frac = (m[3] ?? "") + "00"; let n = BigInt(m[2]) * 100n + BigInt(frac.slice(0, 2));
  if (frac.charCodeAt(2) >= 53) n += 1n; return m[1] ? -n : n;
}
function fmtMinor(v: bigint): string {
  const a = v < 0n ? -v : v, digits = (a / 100n).toString(), tail = String(a % 100n).padStart(2, "0");
  const grouped = digits.length > 3 ? `${digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${digits.slice(-3)}` : digits;
  return `${v < 0n ? "-" : ""}${grouped}.${tail}`;
}
const balanceText = (v: string) => `${money(fmtMinor(minor(v)))} ${minor(v) < 0n ? "Cr" : "Dr"}`;
const th = "sticky top-0 z-[1] bg-slate-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500";
const td = "border-b border-slate-100 px-3 py-2.5 align-top";

export default function LedgerReportScreen(p: {
  companyId: number; branchId: number; branchName: string; fyCode: string; fyStart: string; fyEnd: string; calendar: "BS" | "AD";
  setStatus: (s: StatusInfo) => void; dirtyRef: MutableRefObject<boolean>;
}) {
  const months = useMemo(() => monthsOf(p.fyStart, p.fyEnd), [p.fyStart, p.fyEnd]);
  const initialMonth = useMemo(() => months.find((m) => m.from <= new Date().toISOString().slice(0, 10) && m.to >= new Date().toISOString().slice(0, 10)) ?? months[months.length - 1], [months]);
  const [from, setFrom] = useState(initialMonth?.from ?? p.fyStart);
  const [to, setTo] = useState(initialMonth?.to ?? p.fyEnd);
  const [lookups, setLookups] = useState<LedgerReportLookups | null>(null);
  const [ledgerIds, setLedgerIds] = useState<number[]>([]);
  const [subLedgerId, setSubLedgerId] = useState<number | "">("");
  const [productId, setProductId] = useState<number | "">("");
  const [voucherType, setVoucherType] = useState("ALL");
  const [status, setStatus] = useState("POSTED");
  const [searchText, setSearchText] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<LedgerReportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [ledgerMenu, setLedgerMenu] = useState(false);
  const requestNo = useRef(0);
  useEffect(() => { p.dirtyRef.current = false; }, [p.dirtyRef]);
  useEffect(() => { ledgerReportApi.lookups(p.companyId).then(setLookups).catch((e: Error) => setError(e.message)); }, [p.companyId]);
  useEffect(() => { const t = window.setTimeout(() => { setSearch(searchText.trim()); setPage(1); }, 250); return () => window.clearTimeout(t); }, [searchText]);
  const load = useCallback(() => {
    if (!from || !to || from.startsWith("?") || to.startsWith("?") || from > to) { setError("Choose a valid date range."); return; }
    const current = ++requestNo.current;
    setLoading(true); setError(""); setResult(null);
    ledgerReportApi.get({ companyId: p.companyId, branchId: p.branchId, fiscalYear: p.fyCode, from, to, ledgerIds: ledgerIds.length ? ledgerIds.join(",") : undefined,
      subLedgerId, page, pageSize: 100, status, voucherType, productId, search })
      .then((data) => { if (current === requestNo.current) setResult(data); })
      .catch((e: Error) => { if (current === requestNo.current) setError(e.message || "Could not load ledger report."); })
      .finally(() => { if (current === requestNo.current) setLoading(false); });
  }, [p.companyId, p.branchId, p.fyCode, from, to, ledgerIds, subLedgerId, page, status, voucherType, productId, search]);
  useEffect(() => { if (lookups) load(); }, [lookups, load]);
  useEffect(() => () => { requestNo.current += 1; }, []);
  useEffect(() => { p.setStatus({ mode: "view", count: result?.total ?? 0, shown: result?.rows.length ?? 0, message: error || (loading ? "Loading ledger report…" : result ? "Ledger report ready" : "Loading…"), kind: error ? "err" : "info", hints: ["Click a transaction to inspect posting, remarks, narration and product lines", "Opening and closing balances include posted entries only"] }); }, [result, loading, error, p.setStatus]);
  const switchMonth = (idx: number) => { const m = months[idx]; if (!m) return; setFrom(m.from); setTo(m.to); setPage(1); };
  const selectedMonth = months.findIndex((m) => m.from === from && m.to === to);
  const ledgers = lookups?.ledgers ?? [];
  const subs = (lookups?.subLedgers ?? []).filter((s) => !ledgerIds.length || ledgerIds.includes(s.generalLedgerId));
  const rows = result?.rows ?? [];
  const summaries = (result?.summary ?? []).filter((x) => !ledgerIds.length || ledgerIds.includes(x.generalLedgerId));
  const summaryCards = [
    ["Opening balance", balanceText(fmtMinor(summaries.reduce((a, x) => a + minor(x.opening), 0n)))],
    ["Period debits", money(fmtMinor(summaries.reduce((a, x) => a + minor(x.debit), 0n)))],
    ["Period credits", money(fmtMinor(summaries.reduce((a, x) => a + minor(x.credit), 0n)))],
    ["Closing balance", balanceText(fmtMinor(summaries.reduce((a, x) => a + minor(x.closing), 0n)))],
  ];
  const exportCsv = () => {
    if (!result) return;
    const lines: string[][] = [["Date", "Ledger", "Sub-ledger", "Voucher type", "Voucher number", "Source", "Narration", "Remarks", "Debit", "Credit", "Running balance", "Status", "Posted at", "Posted by", "Products"]];
    for (const r of rows) lines.push([r.d, `${r.ledgerCode} ${r.ledgerName}`, r.subLedgerName ?? "", r.voucherLabel, r.voucherNumber, `${r.sourceLabel} ${r.sourceNumber}`, r.narration ?? "", r.remarks ?? "", r.debit, r.credit, r.running, r.posted ? "Posted" : "Draft", r.postedAt ?? "", r.postedByName ?? "", r.products.map((x) => `${x.code} ${x.description} ${x.qty} ${x.unit}${x.altQty ? `; alt ${x.altQty} ${x.altUnit}` : ""}${x.location ? `; ${x.location}` : ""}${x.batch ? `; batch ${x.batch}` : ""}${x.expiry ? `; expiry ${x.expiry}` : ""}`).join("; ")]);
    const csv = lines.map((line) => line.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `ledger-${from}-${to}-page-${page}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-white">
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-200 px-5 py-3">
        <div><h1 className="text-[18px] font-semibold text-slate-900">General ledger</h1><p className="mt-0.5 text-[12px] text-slate-500">{p.branchName} · FY {p.fyCode} · Posted activity and account balances</p></div>
        <div className="ml-auto flex gap-2"><button className="btn" type="button" onClick={load} disabled={loading}><RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh</button><button className="btn" type="button" onClick={exportCsv} disabled={!rows.length}><Download size={13} /> Export page CSV</button></div>
      </div>
      <div className="z-[2] flex shrink-0 flex-wrap items-end gap-x-3 gap-y-2 border-b border-slate-200 bg-white px-5 py-3">
        <label className="text-[11px] font-medium text-slate-500">Ledger(s)
          <button type="button" className="ml-1 flex min-w-[190px] items-center justify-between gap-3 rounded border border-slate-300 bg-white px-2 py-1.5 text-left text-[13px] text-slate-800" onClick={() => setLedgerMenu((x) => !x)} aria-expanded={ledgerMenu}>
            <span>{ledgerIds.length === 0 ? "All ledgers" : `${ledgerIds.length} selected`}</span>{ledgerMenu ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        </label>
        <label className="text-[11px] font-medium text-slate-500">From ({p.calendar})<DateInput fieldName="From date" value={from} onChange={(v) => { setFrom(v); setPage(1); }} calendar={p.calendar} hasError={from.startsWith("?")} onBlurField={() => { if (from.startsWith("?")) setError("Enter a valid start date."); }} /></label>
        <label className="text-[11px] font-medium text-slate-500">To ({p.calendar})<DateInput fieldName="To date" value={to} onChange={(v) => { setTo(v); setPage(1); }} calendar={p.calendar} hasError={to.startsWith("?")} onBlurField={() => { if (to.startsWith("?")) setError("Enter a valid end date."); }} /></label>
        <label className="text-[11px] font-medium text-slate-500">Fiscal month
          <select className="ml-1 block h-[31px] max-w-[245px] rounded border border-slate-300 px-2 text-[12px]" value={selectedMonth} onChange={(e) => switchMonth(Number(e.target.value))}>
            <option value={-1}>Custom range</option>{months.map((m, i) => <option key={m.from} value={i}>{m.label}</option>)}
          </select>
        </label>
        <div className="flex gap-1 pb-0.5"><button className="btn px-2" aria-label="Previous month" disabled={selectedMonth <= 0} onClick={() => switchMonth(selectedMonth - 1)}>‹</button><button className="btn px-2" aria-label="Next month" disabled={selectedMonth < 0 || selectedMonth >= months.length - 1} onClick={() => switchMonth(selectedMonth + 1)}>›</button></div>
        <label className="text-[11px] font-medium text-slate-500">Sub-ledger
          <select className="ml-1 block h-[31px] max-w-[190px] rounded border border-slate-300 px-2 text-[12px]" value={subLedgerId} onChange={(e) => { setSubLedgerId(e.target.value ? Number(e.target.value) : ""); setPage(1); }}>
            <option value="">All sub-ledgers</option>{subs.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
          </select>
        </label>
        <label className="text-[11px] font-medium text-slate-500">Product
          <select className="ml-1 block h-[31px] max-w-[190px] rounded border border-slate-300 px-2 text-[12px]" value={productId} onChange={(e) => { setProductId(e.target.value ? Number(e.target.value) : ""); setPage(1); }}>
            <option value="">All products</option>{(lookups?.products ?? []).map((x) => <option key={x.id} value={x.id}>{x.code} — {x.description}</option>)}
          </select>
        </label>
        <label className="text-[11px] font-medium text-slate-500">Voucher
          <select className="ml-1 block h-[31px] rounded border border-slate-300 px-2 text-[12px]" value={voucherType} onChange={(e) => { setVoucherType(e.target.value); setPage(1); }}><option value="ALL">All types</option><option value="JOURNAL">Journal</option><option value="CASH_BANK">Cash / bank</option></select>
        </label>
        <label className="text-[11px] font-medium text-slate-500">Status
          <select className="ml-1 block h-[31px] rounded border border-slate-300 px-2 text-[12px]" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="POSTED">Posted only</option><option value="ALL">Posted + drafts</option><option value="DRAFT">Drafts only</option></select>
        </label>
      </div>
      {ledgerMenu && <div className="max-h-56 shrink-0 overflow-auto border-b border-slate-200 bg-slate-50 px-5 py-2"><div className="mb-1 flex gap-3 text-[12px]"><button className="text-cobalt-700 hover:underline" onClick={() => { setLedgerIds([]); setPage(1); }}>All ledgers</button><button className="text-cobalt-700 hover:underline" onClick={() => { setLedgerIds(ledgers.filter((x) => x.isActive).map((x) => x.id)); setPage(1); }}>Select active</button><button className="text-cobalt-700 hover:underline" onClick={() => { setLedgerIds([]); setPage(1); }}>Clear</button></div><div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2 lg:grid-cols-4">{ledgers.map((x) => <label key={x.id} className="flex items-center gap-2 truncate py-1 text-[12px] text-slate-700"><input type="checkbox" checked={ledgerIds.includes(x.id)} onChange={(e) => { setLedgerIds((old) => e.target.checked ? [...old, x.id] : old.filter((id) => id !== x.id)); setPage(1); }} /><span className="font-mono text-slate-500">{x.code}</span>{x.name}</label>)}</div></div>}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50/80 px-5 py-2">
        <label className="flex min-w-[230px] flex-1 items-center gap-2 rounded border border-slate-300 bg-white px-2 py-1"><Search size={14} className="text-slate-400" /><input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Search voucher, narration, remarks, ledger or product…" className="w-full border-0 bg-transparent text-[12px] outline-none" /></label>
        <span className="text-[11px] text-slate-500">Balances include posted movements; filters narrow visible transactions.</span>
      </div>
      <div className="grid shrink-0 grid-cols-2 gap-2 border-b border-slate-200 bg-slate-50 px-5 py-2 md:grid-cols-4">
        {summaryCards.map(([label, value]) => <div key={label} className="rounded border border-slate-200 bg-white px-3 py-2"><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div><div className="mt-0.5 truncate text-[14px] font-semibold tabular-nums text-slate-800">{value}</div></div>)}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {error ? <div role="alert" className="m-5 rounded border border-rose-200 bg-rose-50 p-3 text-[13px] text-rose-700">{error}</div> : null}
        {summaries.length > 0 && <div className="border-b border-slate-200 bg-white px-5 py-2"><div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Balance by ledger · {shownDate(from, p.calendar)} to {shownDate(to, p.calendar)}</div><div className="flex gap-2 overflow-x-auto pb-1">{summaries.map((s) => <div key={s.generalLedgerId} className="min-w-[220px] rounded border border-slate-200 px-3 py-2 text-[12px]"><div className="truncate font-medium text-slate-800">{s.code} · {s.name}</div><div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5 text-slate-500"><span>Opening</span><b className="text-right text-slate-700">{balanceText(s.opening)}</b><span>Dr</span><b className="text-right text-slate-700">{money(s.debit)}</b><span>Cr</span><b className="text-right text-slate-700">{money(s.credit)}</b><span>Closing</span><b className="text-right text-slate-900">{balanceText(s.closing)}</b></div></div>)}</div></div>}
        {loading && !result ? <p className="px-5 py-8 text-[13px] text-slate-500">Loading ledger activity…</p> : rows.length === 0 ? <div className="px-5 py-12 text-center"><p className="text-[14px] font-medium text-slate-700">No transactions match these filters</p><p className="mt-1 text-[12px] text-slate-500">Try a wider period, different ledger or fewer filters.</p></div> : (
          <>
          <div className="hidden md:block">
          <table className="w-full min-w-[1020px] border-collapse text-[12px]">
            <thead><tr className="border-b border-slate-200 text-left"><th className={`${th} w-7`}></th><th className={th}>Date</th>{ledgerIds.length !== 1 && <th className={th}>Ledger</th>}<th className={th}>Voucher / reference</th><th className={th}>Particulars</th><th className={`${th} text-right`}>Debit</th><th className={`${th} text-right`}>Credit</th><th className={`${th} text-right`}>Running balance</th><th className={th}>Status</th></tr></thead>
            <tbody>{rows.map((r: LedgerReportRow, index) => <Fragment key={`${r.kind}-${r.voucherId}-${r.lineId}`}>
              {ledgerIds.length !== 1 && (index === 0 || rows[index - 1].generalLedgerId !== r.generalLedgerId) && <tr className="bg-slate-100"><td colSpan={9} className="px-3 py-1.5 text-[11px] font-semibold text-slate-600">{r.ledgerCode} · {r.ledgerName}</td></tr>}
              <tr className="cursor-pointer hover:bg-blue-50/60" onClick={() => setExpanded((x) => x === r.lineId ? null : r.lineId)} aria-expanded={expanded === r.lineId}>
                <td className={td}>{expanded === r.lineId ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</td><td className={`${td} whitespace-nowrap tabular-nums`}>{shownDate(r.d.slice(0, 10), p.calendar)}</td>
                {ledgerIds.length !== 1 && <td className={td}><div className="font-medium text-slate-800">{r.ledgerName}</div><div className="font-mono text-[10px] text-slate-400">{r.ledgerCode}{r.subLedgerName ? ` · ${r.subLedgerName}` : ""}</div></td>}
                <td className={td}><div className="font-mono font-semibold text-cobalt-800">{r.voucherNumber}</div><div className="mt-0.5 text-[10px] text-slate-500">{r.voucherLabel}{r.reference ? ` · ${r.reference}` : ""}</div></td>
                <td className={`${td} max-w-[280px]`}><div className="truncate text-slate-700">{r.narration || r.remarks || `${r.sourceLabel} ${r.sourceNumber}`}</div>{r.products.length > 0 && <div className="mt-0.5 truncate text-[10px] text-slate-500">{r.products.length} product line{r.products.length === 1 ? "" : "s"}</div>}</td>
                <td className={`${td} text-right tabular-nums text-slate-800`}>{Number(r.debit) ? money(r.debit) : "—"}</td><td className={`${td} text-right tabular-nums text-slate-800`}>{Number(r.credit) ? money(r.credit) : "—"}</td><td className={`${td} whitespace-nowrap text-right font-medium tabular-nums`}>{balanceText(r.running)}</td>
                <td className={td}><span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${r.posted ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{r.posted ? (r.hasReversal ? "REVERSED" : r.reversalOfId ? "REVERSAL" : "POSTED") : "DRAFT"}</span></td>
              </tr>
              {expanded === r.lineId && <tr className="border-b border-slate-200 bg-slate-50"><td colSpan={ledgerIds.length !== 1 ? 9 : 8} className="px-10 py-3"><div className="grid gap-4 md:grid-cols-3">
                <div><h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Voucher detail</h3><p><b>{r.sourceLabel}:</b> {r.sourceNumber}</p><p><b>Ledger:</b> {r.ledgerCode} — {r.ledgerName}{r.subLedgerName ? ` · ${r.subLedgerName}` : ""}</p><p><b>Reference:</b> {r.reference || "—"}</p><p><b>Remarks:</b> {r.remarks || "—"}</p><p><b>Narration:</b> {r.narration || "—"}</p></div>
                <div><h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Posting trail</h3><p><b>Status:</b> {r.posted ? "Posted" : "Draft"}</p><p><b>Posted at:</b> {r.postedAt ? new Date(r.postedAt).toLocaleString() : "—"}</p><p><b>Posted by:</b> {r.postedByName || "—"}</p><p><b>Voucher kind:</b> {r.voucherLabel}</p><p><b>Reversal link:</b> {r.reversalOfId ? `Reverses voucher ID ${r.reversalOfId}` : r.hasReversal ? "A posted reversal exists" : "—"}</p></div>
                <div><h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Products / lines</h3>{r.products.length ? <div className="space-y-1">{r.products.map((x) => <div key={x.id} className="rounded border border-slate-200 bg-white px-2 py-1"><b>{x.code}</b> {x.description}<div className="text-[11px] text-slate-500">{x.qty} {x.unit}{x.altQty ? ` · ${x.altQty} ${x.altUnit}` : ""} × {money(x.rate)} · {money(x.amount)}</div>{(x.location || x.batch || x.expiry) && <div className="text-[10px] text-slate-400">{[x.location, x.batch && `Batch ${x.batch}`, x.expiry && `Expires ${x.expiry}`].filter(Boolean).join(" · ")}</div>}</div>)}</div> : <p className="text-slate-500">No product lines are linked to this voucher.</p>}</div>
              </div></td></tr>}
            </Fragment>)}</tbody>
          </table>
          </div>
          <div className="space-y-2 p-3 md:hidden">
            {rows.map((r) => <article key={`${r.kind}-${r.voucherId}-${r.lineId}`} className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
              <button type="button" className="block w-full p-3 text-left" onClick={() => setExpanded((x) => x === r.lineId ? null : r.lineId)} aria-expanded={expanded === r.lineId}>
                <div className="flex items-start justify-between gap-2"><div><div className="text-[11px] tabular-nums text-slate-500">{shownDate(r.d.slice(0, 10), p.calendar)} · {r.voucherLabel}</div><div className="mt-0.5 font-mono text-[14px] font-semibold text-cobalt-800">{r.voucherNumber}</div></div><span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${r.posted ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{r.posted ? (r.hasReversal ? "REVERSED" : r.reversalOfId ? "REVERSAL" : "POSTED") : "DRAFT"}</span></div>
                <div className="mt-1 text-[12px] font-medium text-slate-700">{r.ledgerCode} · {r.ledgerName}{r.subLedgerName ? ` · ${r.subLedgerName}` : ""}</div>
                <div className="mt-1 truncate text-[12px] text-slate-500">{r.narration || r.remarks || `${r.sourceLabel} ${r.sourceNumber}`}</div>
                <div className="mt-2 grid grid-cols-3 gap-2 border-t border-slate-100 pt-2 text-[11px]"><div><div className="text-slate-400">Debit</div><b className="tabular-nums text-slate-800">{Number(r.debit) ? money(r.debit) : "—"}</b></div><div><div className="text-slate-400">Credit</div><b className="tabular-nums text-slate-800">{Number(r.credit) ? money(r.credit) : "—"}</b></div><div className="text-right"><div className="text-slate-400">Balance</div><b className="tabular-nums text-slate-800">{balanceText(r.running)}</b></div></div>
              </button>
              {expanded === r.lineId && <div className="space-y-2 border-t border-slate-200 bg-slate-50 p-3 text-[12px]"><div><b>{r.sourceLabel}:</b> {r.sourceNumber}</div><div><b>Remarks:</b> {r.remarks || "—"}</div><div><b>Narration:</b> {r.narration || "—"}</div><div><b>Posting:</b> {r.posted ? "Posted" : "Draft"}{r.postedAt ? ` · ${new Date(r.postedAt).toLocaleString()}` : ""}{r.postedByName ? ` · by ${r.postedByName}` : ""}</div><div><b>Reversal:</b> {r.reversalOfId ? `Reverses voucher ID ${r.reversalOfId}` : r.hasReversal ? "Posted reversal exists" : "—"}</div><div><b>Products:</b>{r.products.length ? <div className="mt-1 space-y-1">{r.products.map((x) => <div key={x.id} className="rounded border border-slate-200 bg-white p-2">{x.code} · {x.description}<div className="text-[11px] text-slate-500">{x.qty} {x.unit}{x.altQty ? ` · ${x.altQty} ${x.altUnit}` : ""} × {money(x.rate)} = {money(x.amount)}{x.location ? ` · ${x.location}` : ""}{x.batch ? ` · Batch ${x.batch}` : ""}</div></div>)}</div> : " — none linked"}</div></div>}
            </article>)}
          </div>
          </>
        )}
      </div>
      <footer className="flex shrink-0 items-center justify-between border-t border-slate-200 bg-white px-5 py-2 text-[12px] text-slate-600"><span>{result ? `${result.total.toLocaleString()} transaction lines · page ${page} of ${Math.max(1, Math.ceil(result.total / result.pageSize))}` : ""}</span><div className="flex gap-2"><button className="btn" disabled={page <= 1 || loading} onClick={() => setPage((x) => Math.max(1, x - 1))}>Previous</button><button className="btn" disabled={!result || page * result.pageSize >= result.total || loading} onClick={() => setPage((x) => x + 1)}>Next</button></div></footer>
    </section>
  );
}
