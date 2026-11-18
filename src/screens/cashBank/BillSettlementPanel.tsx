import { useEffect, useMemo, useState } from "react";
import { cashBankApi, type CbSettlement, type OpenDocument, type SettleKind } from "../../api";
import { groupIN } from "../../components/purchase/Bits";
import { adToBs } from "../../lib/nepaliDate";
import { formatPaise, parseAmount } from "../../../shared/cashBankVoucher";

// Bill-wise adjustment, in the account panel: the unpaid invoices (for a receipt) or bills (for a payment) of the account the cursor is on,
// each with a box for how much of it this voucher settles. Money is never moved here; the voucher's own lines do that.
// Settled amounts are kept in the form as { "S:<invoice id>" | "P:<bill id>": "amount" } so they save, cancel and warn-when-dirty with the voucher.

export type SettleMap = Record<string, string>;
export const settleKey = (kind: SettleKind, id: number) => `${kind === "SALES_INVOICE" ? "S" : "P"}:${id}`;
export const settlementsToMap = (list: CbSettlement[] | undefined): SettleMap => Object.fromEntries((list ?? []).map((s) => [settleKey(s.kind, s.documentId), s.amount]));
export const settlementsPayload = (m: SettleMap) => Object.entries(m).filter(([, v]) => (parseAmount(v) ?? 0n) > 0n).map(([k, v]) => ({
  kind: k[0] === "S" ? "SALES_INVOICE" : "PURCHASE_BILL", documentId: Number(k.slice(2)), amount: v,
}));

const nprText = (p: bigint) => groupIN(formatPaise(p));
const OK = /^\d{0,12}(\.\d{0,2})?$/;

export function BillSettlementPanel(p: {
  companyId: number; kind: SettleKind; glId: number; lineTotal: bigint; values: SettleMap; onChange: (next: SettleMap) => void; calendar: "BS" | "AD";
}) {
  const [docs, setDocs] = useState<OpenDocument[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setDocs(null); setFailed(false);
    cashBankApi.openDocuments({ companyId: p.companyId, kind: p.kind, generalLedgerId: p.glId }).then((r) => { if (live) setDocs(r.rows); }).catch(() => { if (live) { setDocs([]); setFailed(true); } });
    return () => { live = false; };
  }, [p.companyId, p.kind, p.glId]);
  const noun = p.kind === "SALES_INVOICE" ? "invoice" : "bill";
  const date = (v: string) => (p.calendar === "BS" ? adToBs(v) ?? v : v);
  const mine = (docs ?? []).filter((d) => d.kind === p.kind);
  const settled = useMemo(() => mine.reduce((a, d) => a + (parseAmount(p.values[settleKey(d.kind, d.id)] ?? "") ?? 0n), 0n), [mine, p.values]);
  const left = p.lineTotal - settled;
  const set = (d: OpenDocument, v: string) => { if (OK.test(v)) p.onChange({ ...p.values, [settleKey(d.kind, d.id)]: v }); };
  // Oldest first: settle each unpaid document in turn until the amount on the voucher line is used up.
  const auto = () => {
    let rest = p.lineTotal;
    const next: SettleMap = { ...p.values };
    for (const d of mine) {
      const take = rest < (parseAmount(d.outstanding) ?? 0n) ? rest : (parseAmount(d.outstanding) ?? 0n);
      if (take > 0n) { next[settleKey(d.kind, d.id)] = formatPaise(take); rest -= take; } else delete next[settleKey(d.kind, d.id)];
    }
    p.onChange(next);
  };
  const clear = () => { const next = { ...p.values }; mine.forEach((d) => delete next[settleKey(d.kind, d.id)]); p.onChange(next); };
  return (
    <div data-testid="bill-settlement">
      <div className="flex items-center justify-between gap-2 px-4 pb-1 pt-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Settle {noun}s</h3>
        <span className="flex gap-1">
          <button type="button" className="btn" disabled={!mine.length || p.lineTotal <= 0n} onClick={auto} title="Fill the oldest unpaid first, up to the amount on this line">Auto</button>
          <button type="button" className="btn" disabled={settled === 0n} onClick={clear}>Clear</button>
        </span>
      </div>
      {docs === null ? <p className="px-4 py-2 text-[12.5px] text-slate-500">Loading…</p>
        : failed ? <p className="px-4 py-2 text-[12.5px] text-rose-700" role="alert">Could not load the unpaid {noun}s.</p>
        : mine.length === 0 ? <p className="px-4 py-2 text-[12.5px] text-slate-500">No unpaid {noun}s on this account; the amount stays as an advance.</p>
        : (
          <ul>
            {mine.map((d) => {
              const v = p.values[settleKey(d.kind, d.id)] ?? "";
              const over = (parseAmount(v) ?? 0n) > (parseAmount(d.outstanding) ?? 0n);
              return (
                <li key={d.id} className="space-y-1 border-b border-slate-100 px-4 py-2">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="font-mono text-[12px] font-semibold text-cobalt-800">{d.number}</span>
                    <span className="tabular-nums text-[12px] text-slate-500">{date(d.date)}</span>
                  </span>
                  <span className="flex items-center justify-between gap-2 text-[12px] text-slate-600">
                    <span>Due <b className="tabular-nums text-ink">{nprText(parseAmount(d.outstanding) ?? 0n)}</b>{d.overdueDays > 0 && <span className="ml-1.5 text-amber-700">{d.overdueDays}d old</span>}</span>
                    <input value={v} onChange={(e) => set(d, e.target.value)} inputMode="decimal" placeholder="0.00" aria-label={`Settle ${d.number}`} aria-invalid={over}
                      className={`w-[104px] border px-1.5 py-0.5 text-right tabular-nums ${over ? "border-rose-400 bg-rose-50" : "border-slate-300"}`} />
                  </span>
                  {over && <span role="alert" className="block text-[11.5px] text-rose-700">More than is due on {d.number}.</span>}
                </li>
              );
            })}
          </ul>
        )}
      {mine.length > 0 && (
        <p className={`px-4 py-2 text-[12.5px] ${left < 0n ? "text-rose-700" : "text-slate-600"}`} role={left < 0n ? "alert" : "status"}>
          Settled <b className="tabular-nums">{nprText(settled)}</b> of <b className="tabular-nums">{nprText(p.lineTotal)}</b>
          {left > 0n ? <> · <b className="tabular-nums">{nprText(left)}</b> advance</> : left < 0n ? <> · <b className="tabular-nums">{nprText(-left)}</b> more than the voucher takes</> : null}
        </p>
      )}
    </div>
  );
}

// A saved voucher's settlements, read-only.
export function SettlementList({ rows, calendar }: { rows: CbSettlement[]; calendar: "BS" | "AD" }) {
  if (!rows.length) return null;
  return (
    <div data-testid="bill-settlement-view">
      <h3 className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Settled against</h3>
      <ul>{rows.map((s) => (
        <li key={s.id} className="flex items-baseline justify-between gap-2 border-b border-slate-100 px-4 py-2 text-[12.5px]">
          <span><span className="font-mono text-[12px] font-semibold text-cobalt-800">{s.number}</span> <span className="tabular-nums text-slate-500">{calendar === "BS" ? adToBs(s.date) ?? s.date : s.date}</span></span>
          <b className="tabular-nums text-ink">{groupIN(s.amount)}</b>
        </li>
      ))}</ul>
    </div>
  );
}
