import { useEffect, useMemo, useState, type MutableRefObject } from "react";
import { ArrowRight, CheckCircle2, Search, TriangleAlert } from "lucide-react";
import { ApiError, masterApi, termCorrectionApi, type TermCorrectionKind, type TermCorrectionPreview } from "../api";
import type { MsgKind, StatusInfo } from "../types";

interface Props {
  companyId: number;
  userId: number;
  setStatus: (status: StatusInfo) => void;
  dirtyRef: MutableRefObject<boolean>;
  // when opened from a term master: start with this term and its old ledger
  initial?: { kind: TermCorrectionKind; termId: number; fromLedgerId?: number; toLedgerId?: number } | null;
}

type Opt = { id: number; code: string; name: string; generalLedgerId?: number | null; isActive?: boolean };
const label = (o: Opt) => `${o.code} — ${o.name}`;
const todayStr = () => new Date().toISOString().slice(0, 10);

// One correcting journal voucher moves what a term posted to a wrong ledger. Nothing already posted is rewritten.
export default function TermCorrectionScreen({ companyId, userId, setStatus, dirtyRef, initial }: Props) {
  const [kind, setKind] = useState<TermCorrectionKind>(initial?.kind ?? "PURCHASE");
  const [terms, setTerms] = useState<Opt[]>([]);
  const [ledgers, setLedgers] = useState<Opt[]>([]);
  const [termId, setTermId] = useState<number | "">(initial?.termId ?? "");
  const [fromId, setFromId] = useState<number | "">(initial?.fromLedgerId ?? "");
  const [toId, setToId] = useState<number | "">(initial?.toLedgerId ?? "");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [voucherDate, setVoucherDate] = useState(todayStr());
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<TermCorrectionPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; kind: MsgKind }>({ text: "Pick a term, the ledger it was posted to and the right ledger, then preview.", kind: "info" });

  useEffect(() => { dirtyRef.current = false; }, [dirtyRef]);
  useEffect(() => { masterApi("general-ledger").list(companyId).then((r) => setLedgers(r as unknown as Opt[])).catch(() => setLedgers([])); }, [companyId]);
  useEffect(() => {
    masterApi(kind === "PURCHASE" ? "purchase-terms" : "sales-terms").list(companyId).then((r) => setTerms(r as unknown as Opt[])).catch(() => setTerms([]));
  }, [companyId, kind]);
  useEffect(() => {
    setStatus({ mode: "view", count: preview?.count ?? 0, shown: preview?.count ?? 0, message: msg.text, kind: msg.kind, hints: [] });
  }, [msg, preview, setStatus]);

  const term = useMemo(() => terms.find((t) => t.id === termId), [terms, termId]);
  const query = termId && fromId && toId ? { kind, termId: Number(termId), fromLedgerId: Number(fromId), toLedgerId: Number(toId), dateFrom: dateFrom || undefined, dateTo: dateTo || undefined } : null;
  const stale = () => setPreview(null);

  const pickTerm = (id: number | "") => {
    setTermId(id); stale();
    const t = terms.find((x) => x.id === id);
    if (t?.generalLedgerId) setToId(t.generalLedgerId); // the term's current (corrected) ledger is the usual target
  };

  const run = async () => {
    if (!query || busy) return;
    setBusy(true);
    try {
      const p = await termCorrectionApi.preview(companyId, query);
      setPreview(p);
      setMsg(p.count ? { text: `${p.documents} posted document(s), ${p.count} term line(s), total ${p.total}. Review, give a reason and apply.`, kind: "info" } : { text: "Nothing to correct in this range.", kind: "warn" });
    } catch (e) {
      setPreview(null);
      setMsg({ text: e instanceof ApiError ? e.message : "Could not preview.", kind: "err" });
    } finally { setBusy(false); }
  };

  const apply = async () => {
    if (!query || !preview?.count || busy) return;
    if (reason.trim().length < 3) { setMsg({ text: "Give a reason (at least 3 characters).", kind: "err" }); return; }
    if (!window.confirm(`Post ONE correcting journal voucher for ${preview.documents} document(s), total ${preview.total}? The bills themselves are not changed.`)) return;
    setBusy(true);
    try {
      const r = await termCorrectionApi.apply(companyId, userId, query, voucherDate, reason.trim());
      setMsg({ text: `Corrected ${r.documents} document(s) with voucher ${r.vouchers.map((v) => v.voucherNumber).join(", ")}.`, kind: "ok" });
      setReason("");
      setPreview(await termCorrectionApi.preview(companyId, query));
    } catch (e) {
      setMsg({ text: e instanceof ApiError ? e.message : "Could not apply the correction.", kind: "err" });
    } finally { setBusy(false); }
  };

  const ledgerName = (id: number | "") => ledgers.find((l) => l.id === id)?.name ?? "";

  return (
    <main className="ledger flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Term Ledger Correction">
      <header className="shrink-0 border-b border-slate-200 bg-white px-4 py-3">
        <h1 className="lg-title">Term Ledger Correction</h1>
        <p className="mt-1 text-[12px] text-slate-500">A term was posted to the wrong ledger on posted bills? One correcting journal voucher moves the amounts. The bills and their old vouchers stay as they are.</p>
      </header>
      <div className="lg-scroll min-h-0 flex-1 overflow-auto p-3 sm:p-4">
        <section className="lg-card grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 sm:p-4 xl:grid-cols-4">
          <label className="text-[11px] font-medium text-slate-600">Document
            <select className="fld mt-1" value={kind} onChange={(e) => { setKind(e.target.value as TermCorrectionKind); setTermId(""); stale(); }}>
              <option value="PURCHASE">Purchase bills</option><option value="SALES">Sales invoices</option>
            </select>
          </label>
          <label className="text-[11px] font-medium text-slate-600 xl:col-span-3">Term
            <select className="fld mt-1" value={termId} onChange={(e) => pickTerm(e.target.value ? Number(e.target.value) : "")}>
              <option value="">Select term…</option>
              {terms.map((t) => <option key={t.id} value={t.id}>{label(t)}</option>)}
            </select>
          </label>
          <label className="text-[11px] font-medium text-slate-600 sm:col-span-1 xl:col-span-2">Posted to (wrong ledger)
            <select className="fld mt-1" value={fromId} onChange={(e) => { setFromId(e.target.value ? Number(e.target.value) : ""); stale(); }}>
              <option value="">Select ledger…</option>
              {ledgers.map((l) => <option key={l.id} value={l.id}>{label(l)}</option>)}
            </select>
          </label>
          <label className="text-[11px] font-medium text-slate-600 sm:col-span-1 xl:col-span-2">Move to (right ledger)
            <select className="fld mt-1" value={toId} onChange={(e) => { setToId(e.target.value ? Number(e.target.value) : ""); stale(); }}>
              <option value="">Select ledger…</option>
              {ledgers.filter((l) => l.isActive !== false).map((l) => <option key={l.id} value={l.id}>{label(l)}</option>)}
            </select>
          </label>
          <label className="text-[11px] font-medium text-slate-600">Bills dated from
            <input type="date" className="fld mt-1" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); stale(); }} />
          </label>
          <label className="text-[11px] font-medium text-slate-600">Bills dated to
            <input type="date" className="fld mt-1" value={dateTo} onChange={(e) => { setDateTo(e.target.value); stale(); }} />
          </label>
          <div className="flex items-end sm:col-span-2">
            <button type="button" className="btn btn-primary" disabled={!query || busy} onClick={() => void run()}><Search size={14} /> Preview</button>
          </div>
        </section>

        {term && fromId && toId && (
          <p className="mt-3 flex items-center gap-2 text-[12px] text-slate-600">
            <b>{term.name}</b>: {ledgerName(fromId)} <ArrowRight size={13} /> {ledgerName(toId)}
          </p>
        )}

        {preview && (
          <section className="lg-card mt-3 p-3 sm:p-4">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="lg-chip"><b>{preview.documents}</b> documents</span>
              <span className="lg-chip">Total <b>{preview.total}</b></span>
            </div>
            {preview.count === 0 ? (
              <p className="flex items-center gap-2 text-[12px] text-slate-500"><CheckCircle2 size={14} /> No posted, unreversed document of this term sits on that ledger in this range.</p>
            ) : (
              <>
                <div className="max-h-[46vh] overflow-auto rounded border border-slate-200">
                  <table className="w-full text-[12px]">
                    <thead className="sticky top-0 bg-slate-50 text-left text-slate-600"><tr><th className="px-2 py-1.5">Document</th><th className="px-2 py-1.5">Date</th><th className="px-2 py-1.5">Term</th><th className="px-2 py-1.5">Was</th><th className="px-2 py-1.5 text-right">Amount</th></tr></thead>
                    <tbody>
                      {preview.rows.map((r) => (
                        <tr key={`${r.documentType}-${r.documentTermId}`} className="border-t border-slate-100">
                          <td className="px-2 py-1">{r.documentNumber}</td><td className="px-2 py-1">{r.documentDate}</td><td className="px-2 py-1">{r.termName}</td>
                          <td className="px-2 py-1">{r.side === "DR" ? "Dr" : "Cr"}</td><td className="px-2 py-1 text-right tabular-nums">{r.amount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_180px_auto] sm:items-end">
                  <label className="text-[11px] font-medium text-slate-600">Reason (kept in the audit trail)
                    <input className="fld mt-1" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Trade Discount was linked to Purchase" />
                  </label>
                  <label className="text-[11px] font-medium text-slate-600">Voucher date
                    <input type="date" className="fld mt-1" value={voucherDate} onChange={(e) => setVoucherDate(e.target.value)} />
                  </label>
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void apply()}><TriangleAlert size={14} /> Post correction</button>
                </div>
              </>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
