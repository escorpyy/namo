import { useCallback, useEffect, useRef, useState } from "react";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { accountPeekApi, type AccountPeek, type PeekEntry } from "../api";
import { isIsoDate } from "../../shared/cashBankVoucher";
import { adToBs } from "../lib/nepaliDate";
import { netOfBalance, netText, type PeekTarget } from "../lib/peek";
import { groupIN } from "./purchase/Bits";

// The account panel: a read-only strip on the right of a voucher screen. It shows the ledger (or party) the cursor is on: its balance on
// the voucher date, what this voucher does to it, and its last posted entries, so nobody has to leave the voucher to look it up.
// It never takes the keyboard (F6 shows / hides it; clicking it leaves the cursor where it was) and it changes no data.

const OPEN_KEY = "peek-open";

/** Open / closed, remembered in this browser. Starts open on a wide screen, closed on a narrow one. F6 flips it. */
export function usePeekOpen(): [boolean, () => void] {
  const [open, setOpen] = useState<boolean>(() => {
    try { const s = localStorage.getItem(OPEN_KEY); if (s === "1" || s === "0") return s === "1"; } catch { /* storage can be unavailable */ }
    return typeof window !== "undefined" && window.innerWidth >= 1600;
  });
  const toggle = useCallback(() => setOpen((o) => {
    const n = !o;
    try { localStorage.setItem(OPEN_KEY, n ? "1" : "0"); } catch { /* the panel still toggles without storage */ }
    return n;
  }), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F6" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && !(e.target as HTMLElement | null)?.closest?.('[role="dialog"]')) { e.preventDefault(); toggle(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);
  return [open, toggle];
}

/**
 * The account the cursor is on. `resolve` is told the data-field name of the field that has the cursor and answers
 * the account of its line, `null` for a line with no account chosen yet, or `undefined` for a field that is not part of a line
 * (the date, remarks...): then the panel keeps showing the last account.
 */
export function usePeekTarget(resolve: (field: string) => PeekTarget | null | undefined): PeekTarget | null {
  const [field, setField] = useState<string | null>(null);
  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      const f = (e.target as HTMLElement | null)?.getAttribute?.("data-field");
      if (f) setField(f);
    };
    document.addEventListener("focusin", onFocus);
    return () => document.removeEventListener("focusin", onFocus);
  }, []);
  const last = useRef<PeekTarget | null>(null);
  const r = field === null ? undefined : resolve(field);
  if (r !== undefined) last.current = r;
  return last.current;
}

/** The button for the screen's header, for people who do not use F6. It is not a tab stop, so entry order is untouched. */
export function PeekToggle({ open, onClick }: { open: boolean; onClick: () => void }) {
  const Icon = open ? PanelRightClose : PanelRightOpen;
  return (
    <button type="button" tabIndex={-1} aria-pressed={open} onClick={onClick} title={`${open ? "Hide" : "Show"} the account panel (F6)`} className="btn">
      <Icon size={14} /> Account <span className="kbd">F6</span>
    </button>
  );
}

export interface PeekPanelProps {
  open: boolean;
  onToggle: () => void;
  target: PeekTarget | null;
  companyId: number;
  branchId: number;
  fiscalYear: string;
  /** the voucher date, AD (YYYY-MM-DD) */
  date: string;
  excludeJournalVoucherId?: number | null;
  excludeCashBankVoucherId?: number | null;
  /** what the voucher being typed does to the target account: debit minus credit, in paisa */
  pending: bigint;
  calendar: "BS" | "AD";
  /** the kind of voucher this screen is: only its entries can be opened here */
  ownKind: PeekEntry["kind"];
  onOpen?: (voucherId: number) => void;
}

const KIND_LABEL: Record<PeekEntry["kind"], string> = { JOURNAL: "Journal", CASH_BANK: "Cash / Bank" };

export function PeekPanel(p: PeekPanelProps) {
  const { open, target, date } = p;
  const dateOk = isIsoDate(date);
  const key = target && dateOk ? [p.companyId, p.branchId, p.fiscalYear, date, target.glId, target.subId ?? "", p.excludeJournalVoucherId ?? "", p.excludeCashBankVoucherId ?? ""].join("|") : "";
  const [res, setRes] = useState<{ key: string; data?: AccountPeek; error?: string }>({ key: "" });

  useEffect(() => {
    if (!open || !key || !target) return;
    let live = true;
    const timer = window.setTimeout(() => {
      accountPeekApi.get({
        companyId: p.companyId, branchId: p.branchId, fiscalYear: p.fiscalYear, date, generalLedgerId: target.glId, subLedgerId: target.subId,
        excludeJournalVoucherId: p.excludeJournalVoucherId, excludeCashBankVoucherId: p.excludeCashBankVoucherId,
      }).then((data) => { if (live) setRes({ key, data }); }).catch((e: Error) => { if (live) setRes({ key, error: e.message }); });
    }, 150);
    return () => { live = false; window.clearTimeout(timer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key]);

  if (!open) return null;

  const cur = res.key === key ? res : null; // an answer for another account is not shown while the right one loads
  const dateText = (s: string) => (p.calendar === "BS" ? adToBs(s) ?? s : s);
  const net = cur?.data ? netOfBalance(cur.data.balance) : 0n;
  const amountText = (e: PeekEntry) => (e.debit !== "0.00" ? `${groupIN(e.debit)} Dr` : e.credit !== "0.00" ? `${groupIN(e.credit)} Cr` : "0.00");

  let body: React.ReactNode;
  if (!target) body = <p className="px-4 py-4 text-[12.5px] text-slate-500">Move to a ledger line to see its balance and recent entries here.</p>;
  else if (!dateOk) body = <p className="px-4 py-4 text-[12.5px] text-slate-500">Choose a valid voucher date to see the balance.</p>;
  else if (!cur) body = <p className="px-4 py-4 text-[12.5px] text-slate-500">Loading…</p>;
  else if (cur.error || !cur.data) body = <p className="px-4 py-4 text-[12.5px] text-rose-700" role="alert">{cur.error ?? "The account could not be loaded."}</p>;
  else {
    const d = cur.data;
    body = (
      <>
        <div className="border-b border-slate-100 px-4 py-3">
          <div className="font-mono text-[12px] text-slate-500">{d.ledger.code}</div>
          <div className="text-[15px] font-semibold leading-snug text-ink">{d.ledger.name}</div>
          {d.subLedger && <div className="mt-0.5 text-[13px] text-slate-700">{d.subLedger.name} <span className="font-mono text-[12px] text-slate-500">{d.subLedger.code}</span></div>}
        </div>
        <div className="border-b border-slate-100 px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Balance on {dateText(date)}</div>
          <div className="mt-0.5 text-[19px] font-semibold tabular-nums text-ink">{netText(net)}</div>
          {p.pending !== 0n && (
            <dl className="mt-2.5 space-y-1 text-[12.5px]">
              <div className="flex items-baseline justify-between gap-2"><dt className="text-slate-500">This voucher</dt><dd className="tabular-nums text-slate-700">{netText(p.pending)}</dd></div>
              <div className="flex items-baseline justify-between gap-2"><dt className="font-medium text-slate-700">After this voucher</dt><dd className="font-semibold tabular-nums text-ink">{netText(net + p.pending)}</dd></div>
            </dl>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <h3 className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Last entries</h3>
          {d.recent.length === 0 ? <p className="px-4 py-2 text-[12.5px] text-slate-500">No posted entries yet.</p> : (
            <ul>
              {d.recent.map((e, i) => {
                const inner = (
                  <>
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="font-mono text-[12px] font-semibold text-cobalt-800">{e.voucherNumber}</span>
                      <span className="tabular-nums text-[12px] text-slate-500">{dateText(e.voucherDate)}</span>
                    </span>
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate text-[12px] text-slate-600" title={e.narration ?? undefined}>{e.narration ?? <span className="text-slate-400">{KIND_LABEL[e.kind]}</span>}</span>
                      <span className="shrink-0 tabular-nums text-[12.5px] font-medium text-ink">{amountText(e)}</span>
                    </span>
                  </>
                );
                const cls = "block w-full space-y-0.5 border-b border-slate-100 px-4 py-2 text-left";
                return (
                  <li key={`${e.kind}:${e.voucherId}:${i}`}>
                    {e.kind === p.ownKind && p.onOpen
                      ? <button type="button" tabIndex={-1} onClick={() => p.onOpen!(e.voucherId)} title={`Open ${e.voucherNumber} in a new tab`} className={`${cls} hover:bg-slate-50`}>{inner}</button>
                      : <div className={cls} title={e.kind === p.ownKind ? undefined : `${KIND_LABEL[e.kind]} voucher: open it from its own screen`}>{inner}</div>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </>
    );
  }

  return (
    // onMouseDown: a click in the panel must not pull the cursor out of the field being typed in
    <aside role="complementary" aria-label="Account panel" onMouseDown={(e) => e.preventDefault()} className="hidden min-h-0 w-[280px] shrink-0 flex-col border-l border-slate-200 bg-white lg:flex">
      <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-2.5">
        <h2 className="text-[13px] font-semibold text-ink">Account</h2>
        <button type="button" tabIndex={-1} onClick={p.onToggle} title="Hide the account panel (F6)" aria-label="Hide the account panel" className="grid h-7 w-7 place-items-center rounded-md text-slate-500 hover:bg-slate-100"><PanelRightClose size={16} /></button>
      </div>
      {body}
    </aside>
  );
}
