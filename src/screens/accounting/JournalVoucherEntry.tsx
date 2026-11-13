import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { createPortal } from "react-dom";
import { Copy, Pencil, Plus, Printer, RotateCcw, Save, Send, Trash2, X } from "lucide-react";
import { accountBalancesApi, journalApi, type AccountBalance, type JDoc, type JLookups, type PDoc, type PLookups } from "../../api";
import { Dialog } from "../../components/Dialog";
import { ShortcutsOverlay } from "../../components/ShortcutsOverlay";
import { JournalLinesGrid } from "../../components/journal/JournalLinesGrid";
import { COMMON_HELP, DocHeader, Field, Pill, formEnterKey, HINTS } from "../../components/purchase/Bits";
import { DateField } from "../../components/purchase/HeadFields";
import { NumberField } from "../../components/purchase/NumberField";
import { defaultDate } from "../../lib/purchaseForm";
import { copyJForm, emptyJLines, fmtAmt, jFormFromDoc, jToPayload, jTotals, validateJournal, type JForm } from "../../lib/journalForm";
import type { PurchaseScreenProps } from "../purchase/PurchaseOrderScreen";
import { useDocScreen, type DocApi, type DocConfig, type DocSnapshot } from "../purchase/useDocScreen";

export const J_TONE: Record<string, "slate" | "green" | "amber" | "blue"> = { DRAFT: "slate", POSTED: "green", REVERSED: "amber", REVERSAL: "blue" };
export const J_OPTIONS = [{ value: "DRAFT", label: "Draft" }, { value: "POSTED", label: "Posted" }, { value: "REVERSED", label: "Reversed" }, { value: "REVERSAL", label: "Reversal" }];

// The journal API has the same shape as the purchase one, with its own document type: the shared hook only needs the shape.
export const journalDocApi = journalApi as unknown as DocApi;

const HELP: [string, string][] = [
  ...COMMON_HELP.filter(([k]) => !["Alt+4", "F4 / /", "Ctrl+↑ / Ctrl+↓", "Alt+1 / Alt+2 / Alt+3", "F3 / Ctrl+N", "Esc"].includes(k)),
  ["F3 / Ctrl+N", "New voucher in a new tab"],
  ["Esc", "Cancel editing"],
  ["Enter", "Next cell; after the last cell of a line, the next line (a new one at the end)"],
  ["F8", "On a line: set it to the amount that balances the voucher"],
  ["Ctrl+D", "Copy the cell (or the selected row) from the line above"],
  ["Delete", "Remove the selected line"],
  ["Alt+, / Alt+.", "Previous / next tab"],
  ["Alt+W", "Close this tab"],
  ["Posted", "A posted voucher is changed only with a reason, or reversed; it is never deleted by accident"],
];
const HINT_LIST = [...HINTS.filter((h) => !h.startsWith("F4")), "F8: Balance line"];

export interface JournalEntryProps extends PurchaseScreenProps {
  tabId: number;
  companyName: string;
  lookups: JLookups;
  docId: number | null;
  initialForm?: JForm;
  hookSnapRef: MutableRefObject<DocSnapshot<JForm> | null>;
  onMeta: (tabId: number, meta: { title: string; dirty: boolean; docId: number | null }) => void;
  onNew: (prefill?: JForm) => void;
  onOpenDoc: (id: number) => void;
  onClose: (tabId: number) => void;
  onListChanged: () => void;
}

export default function JournalVoucherEntry(p: JournalEntryProps) {
  const reasonRef = useRef("");
  const lkRef = useRef<JLookups | null>(null);
  const [accountBalances, setAccountBalances] = useState<AccountBalance[] | null>(null);
  const [balanceStatus, setBalanceStatus] = useState<"loading" | "ready" | "error" | "unavailable">("loading");
  const cfg = useMemo<DocConfig<JForm>>(() => ({
    kind: "journal", api: journalDocApi, title: "Journal Voucher", singular: "Voucher", statusOptions: J_OPTIONS,
    emptyForm: (lk) => ({ numberSeriesId: "", docNumber: "", voucherDate: defaultDate((lk as unknown as JLookups).fiscalYears.find((y) => y.code === p.fyCode)), remarks: "", lines: emptyJLines() }),
    toForm: (d) => jFormFromDoc(d as unknown as JDoc),
    toPayload: (f, doc) => { const r = reasonRef.current; reasonRef.current = ""; return jToPayload(f, doc as unknown as JDoc | null, r); },
    validate: (f, lk) => validateJournal(f, lk as unknown as JLookups),
    editable: (d) => (d as unknown as JDoc).editable, deletable: (d) => (d as unknown as JDoc).deletable, label: (d) => d.voucherNumber,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [p.fyCode]);
  const restored = useRef(p.hookSnapRef.current);
  const localDirty = useRef(false);
  const beforeSave = useRef<() => boolean>(() => true);
  const s = useDocScreen<JForm>(cfg, { companyId: p.companyId, branchId: p.branchId, fyCode: p.fyCode, userId: p.userId, calendar: p.calendar }, {
    setStatus: p.setStatus, dirtyRef: localDirty, externalMessage: p.externalMessage, hints: HINT_LIST,
    sharedLookups: p.lookups as unknown as PLookups, skipList: true, initialDocId: p.docId, initialForm: p.initialForm, restore: restored.current, snapshotRef: p.hookSnapRef,
    onNew: () => p.onNew(), onDeleted: () => p.onClose(p.tabId), onListChanged: p.onListChanged, beforeSave: () => beforeSave.current(),
  });
  const f = s.form, lk = p.lookups, doc = s.doc as unknown as JDoc | null, ro = s.readOnly;
  lkRef.current = lk;

  useEffect(() => {
    const date = f?.voucherDate;
    if (!date) { setAccountBalances(null); setBalanceStatus("unavailable"); return; }
    let live = true;
    setAccountBalances(null);
    setBalanceStatus("loading");
    const fiscalYear = lk.fiscalYears.find((y) => y.startDate <= date && date <= y.endDate)?.code ?? p.fyCode;
    const timer = window.setTimeout(() => {
      accountBalancesApi.get({ companyId: p.companyId, branchId: p.branchId, fiscalYear, date, excludeJournalVoucherId: doc?.id })
        .then((r) => { if (live) { setAccountBalances(r.rows); setBalanceStatus("ready"); } })
        .catch(() => { if (live) { setAccountBalances(null); setBalanceStatus("error"); } });
    }, 150);
    return () => { live = false; window.clearTimeout(timer); };
  }, [f?.voucherDate, lk.fiscalYears, p.companyId, p.branchId, p.fyCode, doc?.id]);

  useEffect(() => { p.onMeta(p.tabId, { title: doc ? doc.voucherNumber : "New voucher", dirty: s.dirty, docId: doc?.id ?? null }); }, [doc?.voucherNumber, doc?.id, s.dirty, p.tabId]);

  // Posted vouchers: a change needs a reason. Save stops here, asks, then saves again with the reason.
  beforeSave.current = () => {
    if (!doc?.isPosted || reasonRef.current) return true;
    const box = { v: "" };
    s.setDialog({
      title: "Change a posted voucher", variant: "warning",
      body: (
        <div className="space-y-2">
          <p><b className="font-mono">{doc.voucherNumber}</b> is posted. The change is kept in the audit trail with your reason.</p>
          <label className="block text-[12px]">Reason<input data-af maxLength={500} autoFocus onChange={(e) => { box.v = e.target.value; }} className="fld mt-0.5" /></label>
        </div>
      ),
      buttons: [
        { label: "Cancel", kind: "neutral", onClick: () => s.setDialog(null) },
        { label: "Save change", kind: "primary", onClick: () => {
          if (!box.v.trim()) { s.flash("Type the reason for the change.", "warn"); return; }
          reasonRef.current = box.v.trim(); s.setDialog(null); void s.save();
        } },
      ],
      onCancel: () => s.setDialog(null),
    });
    return false;
  };

  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    if (!printing) return;
    const done = () => setPrinting(false);
    window.addEventListener("afterprint", done);
    const t = window.setTimeout(() => window.print(), 50);
    return () => { window.removeEventListener("afterprint", done); window.clearTimeout(t); };
  }, [printing]);

  if (!f) return <section className="grid min-h-0 flex-1 place-items-center text-slate-500">Loading…</section>;

  const state = doc?.state, t = jTotals(f.lines), balanced = t.diff === 0 && t.used > 0;
  const startDate = cfg.emptyForm(lk as unknown as PLookups).voucherDate;
  const reverse = () => {
    if (!doc) return;
    const rv = { date: startDate < doc.voucherDate ? doc.voucherDate : startDate, reason: "" };
    s.setDialog({
      title: "Reverse voucher?", variant: "warning",
      body: (
        <div className="space-y-2">
          <p>Reverse <b className="font-mono">{doc.voucherNumber}</b>? A new voucher with Dr and Cr swapped is posted; the original stays on record.</p>
          <label className="block text-[12px]">Reversal date (AD, YYYY-MM-DD)<input data-af defaultValue={rv.date} onChange={(e) => { rv.date = e.target.value.trim(); }} className="fld mt-0.5" /></label>
          <label className="block text-[12px]">Reason<input defaultValue="" maxLength={500} onChange={(e) => { rv.reason = e.target.value; }} className="fld mt-0.5" /></label>
        </div>
      ),
      buttons: [
        { label: "Cancel", kind: "neutral", autoFocus: true, onClick: () => s.setDialog(null) },
        { label: "Reverse", kind: "danger", onClick: async () => {
          if (!rv.reason.trim()) { s.flash("Type the reason for the reversal.", "warn"); return; }
          s.setDialog(null);
          try {
            const r = await journalApi.action(doc.id, p.companyId, "reverse", { reason: rv.reason.trim(), date: rv.date, userId: p.userId });
            s.open(await journalApi.get(doc.id, p.companyId) as unknown as PDoc);
            p.onListChanged();
            s.flash(`Reversed ${doc.voucherNumber} by ${r.document.voucherNumber}`, "ok");
            p.onOpenDoc(r.document.id);
          } catch (e) { s.flash((e as Error).message, "err"); }
        } },
      ],
      onCancel: () => s.setDialog(null),
    });
  };
  const post = () => doc && s.run({ action: "post", title: "Post voucher?", button: "Post", done: (d) => `Posted ${(d as unknown as JDoc).voucherNumber}`,
    body: <>Post <b className="font-mono">{doc.voucherNumber}</b> for <b>{fmtAmt(t.dr)}</b>? A posted voucher is changed only with a reason, or reversed.</> });

  const notice = doc && (
    <div className="mx-5 mt-3 space-y-1">
      {doc.source && <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-700">Made by {doc.source}. Change it from there; it cannot be edited here.</p>}
      {state === "POSTED" && !doc.source && <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-900">Posted. Changing it needs a reason (F2); a wrong entry is better reversed.</p>}
      {state === "REVERSED" && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">Reversed by <button className="font-mono font-semibold underline" onClick={() => p.onOpenDoc(doc.reversedBy!.id)}>{doc.reversedBy?.voucherNumber}</button>.</p>}
      {state === "REVERSAL" && <p className="rounded-lg border border-cobalt-200 bg-cobalt-50 px-3 py-2 text-[12px] text-cobalt-800">Reversal of <button className="font-mono font-semibold underline" onClick={() => p.onOpenDoc(doc.reversalOf!.id)}>{doc.reversalOf?.voucherNumber}</button>.</p>}
    </div>
  );

  const ledgerName = new Map(lk.ledgers.map((g) => [String(g.id), `${g.code} — ${g.name}`]));
  const partyName = new Map(lk.subLedgers.map((x) => [String(x.id), x.name]));
  const printable = printing && createPortal(
    <div className="jv-print">
      <h1>{p.companyName}</h1><h2>Journal Voucher</h2>
      <p><b>No:</b> {doc?.voucherNumber ?? f.docNumber ?? ""} &nbsp; <b>Date:</b> {f.voucherDate} &nbsp; {state && <b>[{state}]</b>}</p>
      <table><thead><tr><th>S.No</th><th>Ledger / Party</th><th>Narration</th><th className="r">Dr.</th><th className="r">Cr.</th></tr></thead>
        <tbody>{f.lines.filter((l) => l.glId).map((l, i) => (
          <tr key={l.key}><td>{i + 1}</td><td>{ledgerName.get(l.glId)}{l.subId ? ` / ${partyName.get(l.subId) ?? ""}` : ""}</td><td>{l.narration}</td><td className="r">{l.debit && fmtAmt(Math.round(Number(l.debit) * 100))}</td><td className="r">{l.credit && fmtAmt(Math.round(Number(l.credit) * 100))}</td></tr>))}</tbody>
        <tfoot><tr><td colSpan={3} className="r">Total</td><td className="r">{fmtAmt(t.dr)}</td><td className="r">{fmtAmt(t.cr)}</td></tr></tfoot></table>
      {f.remarks && <p><b>Remarks:</b> {f.remarks}</p>}
      <div className="sign"><span>Prepared by</span><span>Checked by</span><span>Approved by</span></div>
    </div>, document.body);

  return (
    <>
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <DocHeader title="Journal voucher" number={doc?.voucherNumber} pill={state ? <Pill text={state} tone={J_TONE[state]} /> : undefined} branchName={p.branchName} fyCode={p.fyCode} dirty={s.dirty} right={<span className="text-[12px] text-slate-500">F1 help</span>} />
        {notice}
        <div data-zone="form" onKeyDown={formEnterKey} className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden px-5 py-4">
          <div className="grid shrink-0 grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4">
            <NumberField label="Voucher No" documentType="JOURNAL_VOUCHER" companyId={p.companyId} branchId={p.branchId} fyCode={p.fyCode} userId={p.userId} existingNumber={doc?.voucherNumber} readOnly={ro} seriesId={f.numberSeriesId} number={f.docNumber} onChange={(c) => s.patch(c)} />
            <DateField label="Date" name="voucherDate" value={f.voucherDate} onChange={(v) => { s.patch({ voucherDate: v }); s.clearError("voucherDate"); }} calendar={p.calendar} readOnly={ro} error={s.err("voucherDate")} required />
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            <JournalLinesGrid lines={f.lines} onChange={(lines) => s.patch({ lines })} lookups={lk} accountBalances={accountBalances} balanceStatus={balanceStatus} readOnly={ro} errors={s.errors} clearError={s.clearError} contextKey={String(p.companyId)} />
          </div>
          <div className="shrink-0">
            <Field label="Remarks (for the whole voucher)" error={s.err("remarks")}>
              <textarea data-field="remarks" rows={2} maxLength={1024} disabled={ro} value={f.remarks} onChange={(e) => { s.patch({ remarks: e.target.value }); s.clearError("remarks"); }} className={`fld h-auto py-1.5 ${ro ? "bg-slate-100 text-slate-600" : ""}`} />
            </Field>
          </div>
        </div>
        <footer className="tape flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2.5 px-5 py-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-6 gap-y-1 text-[13px]" aria-live="polite">
            <span>Dr. <b className="tabular-nums">{fmtAmt(t.dr)}</b></span>
            <span>Cr. <b className="tabular-nums">{fmtAmt(t.cr)}</b></span>
            <span className={balanced ? "font-semibold text-emerald-700" : t.used ? "font-semibold text-rose-700" : "text-slate-500"}>
              {balanced ? "Balanced" : t.used ? `Difference ${t.diff > 0 ? "Dr" : "Cr"} ${fmtAmt(Math.abs(t.diff))}` : "Enter the lines"}
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {!ro ? (
              <>
                <button data-nav className="btn btn-primary" disabled={s.saving} onClick={() => void s.save()}><Save size={14} /> {s.mode === "edit" ? "Update" : "Save"} <span className="kbd">Ctrl+S</span></button>
                <button data-nav className="btn" onClick={() => (doc ? s.cancel() : s.guard(() => p.onClose(p.tabId)))}><X size={14} /> Cancel {doc && <span className="kbd">Esc</span>}</button>
              </>
            ) : (
              <>
                <button data-nav className="btn" onClick={() => p.onNew()}><Plus size={14} /> New <span className="kbd">F3</span></button>
                <button data-nav className="btn" disabled={!doc?.editable} onClick={s.edit}><Pencil size={14} /> Edit <span className="kbd">F2</span></button>
                <button data-nav className="btn" disabled={!doc?.deletable} onClick={s.askDelete}><Trash2 size={14} /> Delete <span className="kbd">Ctrl+Del</span></button>
                <span className="tape-sep mx-1" />
                {doc && <button data-nav className="btn" onClick={() => p.onNew(copyJForm(jFormFromDoc(doc), startDate))}><Copy size={14} /> Copy</button>}
                {doc && <button data-nav className="btn" onClick={() => setPrinting(true)}><Printer size={14} /> Print</button>}
                {state === "DRAFT" && <button data-nav className="btn btn-primary" onClick={post}><Send size={14} /> Post</button>}
                {doc?.reversible && <button data-nav className="btn" onClick={reverse}><RotateCcw size={14} /> Reverse</button>}
              </>
            )}
          </div>
        </footer>
      </section>
      {printable}
      {s.dialog && <Dialog spec={s.dialog} onClose={() => s.setDialog(null)} />}
      {s.help && <ShortcutsOverlay onClose={() => s.setHelp(false)} shortcuts={HELP} />}
    </>
  );
}
