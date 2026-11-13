import { NarrationInput } from "../../components/NarrationInput";
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { Ban, Check, Pencil, Plus, Save, Trash2, Undo2, X } from "lucide-react";
import { accountBalancesApi, ApiError, cashBankApi, type AccountBalance, type CbDoc, type CbLookups, type CbStatus, type PDoc } from "../../api";
import type { EntryTabProps } from "../../components/purchase/DocWorkspace";
import { drCrText } from "../../lib/balanceText";
import { useDialog } from "../../components/Dialog";
import { MasterReferencePicker, type ReferenceOption } from "../../components/MasterReferencePicker";
import { DocHeader, Field, Pill, focusStep, formEnterKey, groupIN } from "../../components/purchase/Bits";
import { DateField, TextField } from "../../components/purchase/HeadFields";
import { useGridRows } from "../../components/table/useGridRows";
import { dateErr, defaultDate } from "../../lib/purchaseForm";
import {
  INSTRUMENTS, MAX_CHEQUE_NO, MAX_NARRATION, MAX_PAYEE, MAX_REMARKS, closingBalance, entryTotals, formatPaise, isBlankEntry, parseAmount, voucherProblems, type EntryInput,
} from "../../../shared/cashBankVoucher";
import type { Mode, StatusInfo } from "../../types";

// Cash / Bank Voucher (ERP-006): receipts and payments made through one cash or bank ledger. The person keys the other side (a party or any
// ledger) with EITHER a receipt or a payment per line; the bank's own movement is derived by the server, so a voucher always balances.
// Validation and the balance preview use the SAME functions as the server (shared/cashBankVoucher.ts), so the screen cannot disagree with it.
// Life of a voucher: Draft (edit / delete / post) -> Posted (never edited; corrected by a reversal) -> Reversed.

export interface CashBankScreenProps {
  companyId: number; branchId: number; userId: number; branchName: string; fyCode: string; calendar: "BS" | "AD";
  setStatus: (s: StatusInfo) => void; dirtyRef: MutableRefObject<boolean>; externalMessage?: { text: string; n: number } | null;
}

interface Line { key: number; generalLedgerId: string; subLedgerId: string; receipt: string; payment: string; narration: string }
export interface CbForm {
  voucherDate: string; cashBankLedgerId: string; cashBankSubLedgerId: string; instrumentType: string; chequeNumber: string; chequeDate: string; payeeReference: string; remarks: string; lines: Line[];
}
type Errors = Record<string, string | undefined>;

export const TONE: Record<CbStatus, "slate" | "green" | "red"> = { DRAFT: "slate", POSTED: "green", REVERSED: "red" };
export const STATUS_OPTIONS = [{ value: "DRAFT", label: "Draft" }, { value: "POSTED", label: "Posted" }, { value: "REVERSED", label: "Reversed" }];
const HINTS = ["Enter: Next field (new line at the end)", "Shift+Enter: Previous", "Ctrl+S: Save draft", "Ctrl+D: Copy cell above", "Shift+Del: Remove line", "F3: New", "F2: Edit"];
// Line columns: No, Account / Party, Sub-ledger, Receipt, Payment, Narration, remove. Fluid, so the grid fits a 1366px screen without its own scroll bar.
const TEMPLATE = "40px minmax(220px,1.6fr) minmax(150px,1fr) 124px 124px minmax(160px,1.2fr) 34px";
const FILL_FIELDS = ["generalLedgerId", "subLedgerId", "receipt", "payment", "narration"] as const;
// data-field of a line cell is L.<row>.<col>; the error key of a line is lines.<row>.<account | subLedger | amount>.
const COL_OF: Record<string, "a" | "s" | "r" | "p" | "n"> = { account: "a", subLedger: "s", amount: "r" };
const FIELD_OF: Record<string, (typeof FILL_FIELDS)[number]> = { a: "generalLedgerId", s: "subLedgerId", r: "receipt", p: "payment", n: "narration" };

let keySeq = 0;
const blankLine = (): Line => ({ key: ++keySeq, generalLedgerId: "", subLedgerId: "", receipt: "", payment: "", narration: "" });
const sigOf = (f: CbForm) => JSON.stringify(f, (k, v) => (k === "key" ? undefined : v));
const amountOk = (v: string) => /^\d{0,12}(\.\d{0,2})?$/.test(v);

// "NPR 12,84,500.00" for an amount in paise.
const npr = (p: bigint) => `NPR ${groupIN(formatPaise(p))}`;
const netPaise = (b: AccountBalance | null) => (b ? (parseAmount(b.debit) ?? 0n) - (parseAmount(b.credit) ?? 0n) : null);
const balanceText = (b: AccountBalance | null) => b ? drCrText(b.debit, b.credit) : "—";
const splitBalanceText = (net: bigint) => drCrText(formatPaise(net > 0n ? net : 0n), formatPaise(net < 0n ? -net : 0n));

const toEntry = (l: Line): EntryInput => ({ generalLedgerId: l.generalLedgerId ? Number(l.generalLedgerId) : null, subLedgerId: l.subLedgerId ? Number(l.subLedgerId) : null, receipt: l.receipt, payment: l.payment, narration: l.narration });

// One Cash / Bank Voucher tab of the voucher workspace: the workspace owns the list, the lookups and the tab strip.
export default function CashBankVoucherEntry(p: CashBankScreenProps & EntryTabProps<CbForm, CbLookups>) {
  const dlg = useDialog();
  const lk = p.lookups;
  const [doc, setDoc] = useState<CbDoc | null>(null);
  const [mode, setMode] = useState<Mode>("new");
  const [form, setForm] = useState<CbForm | null>(null);
  const [baseSig, setBaseSig] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; kind: StatusInfo["kind"] }>({ text: "Loading…", kind: "info" });
  const [accountBalances, setAccountBalances] = useState<AccountBalance[] | null>(null);
  const [balanceStatus, setBalanceStatus] = useState<"loading" | "ready" | "error" | "unavailable">("loading");

  const ro = mode === "view";
  const dirty = mode !== "view" && !!form && sigOf(form) !== baseSig;
  const flash = useCallback((text: string, kind: StatusInfo["kind"] = "info") => setMsg({ text, kind }), []);
  const fyOf = useCallback((l: CbLookups | null, date: string) => l?.fiscalYears.find((y) => y.startDate <= date && date <= y.endDate), []);

  // ---------- load ----------

  const emptyForm = useCallback((l: CbLookups): CbForm => {
    const banks = l.cashBankLedgers.filter((b) => b.isActive);
    return {
      voucherDate: defaultDate(l.fiscalYears.find((y) => y.code === p.fyCode)), cashBankLedgerId: banks.length === 1 ? String(banks[0].id) : "", cashBankSubLedgerId: "", instrumentType: "", chequeNumber: "", chequeDate: "", payeeReference: "", remarks: "",
      lines: [blankLine(), blankLine()],
    };
  }, [p.fyCode]);
  const toForm = (d: CbDoc): CbForm => ({
    voucherDate: d.voucherDate, cashBankLedgerId: d.cashBankLedgerId ? String(d.cashBankLedgerId) : "", cashBankSubLedgerId: d.cashBankSubLedgerId ? String(d.cashBankSubLedgerId) : "", instrumentType: d.instrumentType ?? "", chequeNumber: d.chequeNumber ?? "", chequeDate: d.chequeDate ?? "",
    payeeReference: d.payeeReference, remarks: d.remarks,
    lines: d.entries.length ? d.entries.map((e) => ({ key: ++keySeq, generalLedgerId: String(e.generalLedgerId), subLedgerId: e.subLedgerId ? String(e.subLedgerId) : "", receipt: e.receipt, payment: e.payment, narration: e.narration })) : [blankLine()],
  });
  const show = (f: CbForm, m: Mode, d: CbDoc | null) => { setForm(f); setBaseSig(sigOf(f)); setMode(m); setDoc(d); setErrors({}); };

  // A tab starts one of three ways: put back as it was left, a saved voucher opened in view mode, or a new blank voucher.
  const restored = useRef(p.hookSnapRef.current);
  useEffect(() => {
    const snap = restored.current;
    if (snap) { setForm(snap.form as CbForm); setBaseSig(snap.baseSig); setMode(snap.mode); setDoc(snap.doc as unknown as CbDoc | null); flash("Ready", "info"); return; }
    if (!p.docId) { show(p.initialForm ?? emptyForm(lk), "new", null); flash("New voucher", "info"); return; }
    let live = true;
    cashBankApi.get(p.docId, p.companyId).then((d) => { if (live) { show(toForm(d), "view", d); flash(`Opened ${d.voucherNumber}`, "info"); } }).catch((e: Error) => { if (live) fail(e, "Could not open the voucher"); });
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { if (form) p.hookSnapRef.current = { doc: doc as unknown as PDoc | null, mode, form, baseSig, selectedId: doc?.id ?? null }; });
  useEffect(() => { p.onMeta(p.tabId, { title: doc ? doc.voucherNumber : "New voucher", dirty, docId: doc?.id ?? null }); }, [doc?.voucherNumber, doc?.id, dirty, p.tabId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (p.externalMessage) flash(p.externalMessage.text, "info"); }, [p.externalMessage, flash]);

  useEffect(() => p.setStatus({ mode, count: 0, shown: 0, message: msg.text, kind: msg.kind, hints: HINTS }), [mode, msg, p.setStatus]);

  // ---------- balances ----------
  const fyCodeFor = useCallback((date: string) => fyOf(lk, date)?.code ?? p.fyCode, [fyOf, lk, p.fyCode]);
  const dateValid = !!form && !dateErr("Date", form.voucherDate, true);
  const bankId = form?.cashBankLedgerId ?? "", voucherDate = form?.voucherDate ?? "", docId = doc?.id;
  useEffect(() => {
    if (!lk || !dateValid) { setAccountBalances(null); setBalanceStatus("unavailable"); return; }
    let live = true;
    setAccountBalances(null);
    setBalanceStatus("loading");
    const timer = window.setTimeout(() => {
      accountBalancesApi.get({ companyId: p.companyId, branchId: p.branchId, fiscalYear: fyCodeFor(voucherDate), date: voucherDate, excludeCashBankVoucherId: docId })
        .then((r) => { if (live) { setAccountBalances(r.rows); setBalanceStatus("ready"); } })
        .catch(() => { if (live) { setAccountBalances(null); setBalanceStatus("error"); } });
    }, 120);
    return () => { live = false; window.clearTimeout(timer); };
  }, [lk, voucherDate, dateValid, docId, p.companyId, p.branchId, fyCodeFor]);

  // ---------- derived ----------
  const ledgers = lk?.ledgers ?? [];
  const balanceMap = useMemo(() => new Map((accountBalances ?? []).map((b) => [`${b.generalLedgerId}:${b.subLedgerId ?? ""}`, b])), [accountBalances]);
  const accountBalance = useCallback((glId: string | number, subLedgerId: string | number | null = null): AccountBalance | null => {
    if (!accountBalances) return null;
    return balanceMap.get(`${glId}:${subLedgerId ?? ""}`) ?? { generalLedgerId: Number(glId), subLedgerId: subLedgerId === null ? null : Number(subLedgerId), debit: "0.00", credit: "0.00" };
  }, [accountBalances, balanceMap]);
  const balanceSubtext = useCallback((glId: string | number, subLedgerId: string | number | null = null) => {
    const b = accountBalance(glId, subLedgerId);
    return b ? `Balance · ${balanceText(b)}` : balanceStatus === "loading" ? "Balance loading…" : balanceStatus === "error" ? "Balance unavailable" : "Choose a valid voucher date";
  }, [accountBalance, balanceStatus]);
  const bankOptions = useMemo<ReferenceOption[]>(() => (lk?.cashBankLedgers ?? []).map((l) => ({ value: String(l.id), label: `${l.code} — ${l.name}`, code: l.code, name: l.name, detail: "Cash / bank ledger", subtext: balanceSubtext(l.id), isActive: l.isActive })), [lk, balanceSubtext]);
  const accountOptions = useMemo<ReferenceOption[]>(() => ledgers.filter((l) => String(l.id) !== bankId).map((l) => ({ value: String(l.id), label: `${l.code} — ${l.name}`, code: l.code, name: l.name, detail: l.requiresSubLedger ? `${l.glType} · needs sub ledger` : `${l.glType} ledger`, subtext: balanceSubtext(l.id), isActive: l.isActive })), [ledgers, bankId, balanceSubtext]);
  const ledgerById = useMemo(() => new Map(ledgers.map((l) => [String(l.id), l])), [ledgers]);
  const totals = useMemo(() => entryTotals((form?.lines ?? []).map(toEntry)), [form]);
  const headBal = bankId ? accountBalance(bankId) : null;
  const opening = netPaise(headBal);
  const closing = opening === null ? null : closingBalance(opening, totals.receipts, totals.payments);
  const entryCount = (form?.lines ?? []).filter((l) => !isBlankEntry(toEntry(l))).length;
  const instrumentOn = !!form?.instrumentType;
  const bankLedger = lk?.cashBankLedgers.find((l) => String(l.id) === bankId);
  const bankSubs = (lk?.subLedgers ?? []).filter((s) => String(s.generalLedgerId) === bankId);
  const bankNeedsSub = !!bankLedger?.requiresSubLedger;
  const bankSubOptions = useMemo<ReferenceOption[]>(() => bankSubs.map((s) => ({ value: String(s.id), label: `${s.code} — ${s.name}`, code: s.code, name: s.name, detail: bankLedger ? `For ${bankLedger.name}` : undefined, subtext: balanceSubtext(s.generalLedgerId, s.id), isActive: s.isActive })), [bankSubs, bankLedger, balanceSubtext]);

  // ---------- editing ----------
  const patch = (c: Partial<CbForm>) => setForm((f) => (f ? { ...f, ...c } : f));
  const clear = (...ks: string[]) => setErrors((e) => { const n = { ...e }; ks.forEach((k) => delete n[k]); return n; });
  const patchLine = (key: number, c: Partial<Line>) => { clear("lines"); setForm((f) => (f ? { ...f, lines: f.lines.map((l) => (l.key === key ? { ...l, ...c } : l)) } : f)); };
  const setAmount = (key: number, side: "receipt" | "payment", v: string) => {
    if (!amountOk(v)) return;
    const other = side === "receipt" ? "payment" : "receipt";
    patchLine(key, { [side]: v, ...((parseAmount(v) ?? 0n) > 0n ? { [other]: "" } : {}) } as Partial<Line>);
    clear(`lines.${form!.lines.findIndex((l) => l.key === key)}.amount`);
  };
  const focusField = (name: string, delay = 40) => window.setTimeout(() => document.querySelector<HTMLElement>(`[data-field="${name}"]:not(:disabled)`)?.focus(), delay);
  const addLine = () => { setForm((f) => (f ? { ...f, lines: [...f.lines, blankLine()] } : f)); if (form) focusField(`L.${form.lines.length}.a`); };
  const removeLineAt = (i: number, fromRowMode = false) => {
    if (!form) return;
    const left = form.lines.filter((_, k) => k !== i);
    setForm({ ...form, lines: left.length ? left : [blankLine()] });
    clear("lines", ...Object.keys(errors).filter((k) => k.startsWith("lines.")));
    if (!fromRowMode) focusField(`L.${Math.min(i, Math.max(0, left.length - 1))}.a`, 30);
  };
  // Ctrl+D: the cell above (or the whole line above in row mode), so a run of similar lines is a few key presses.
  const copyCellDown = (i: number, col: string) => {
    const f = FIELD_OF[col], above = form?.lines[i - 1], cur = form?.lines[i];
    if (ro || !f || !above || !cur) return;
    const c: Partial<Line> = f === "generalLedgerId" ? { generalLedgerId: above.generalLedgerId, subLedgerId: "" } : { [f]: above[f] };
    if (f === "receipt" && above.receipt) c.payment = ""; else if (f === "payment" && above.payment) c.receipt = "";
    patchLine(cur.key, c);
  };
  const copyRowDown = (i: number) => {
    const above = form?.lines[i - 1], cur = form?.lines[i];
    if (ro || !above || !cur) return;
    patchLine(cur.key, Object.fromEntries(FILL_FIELDS.map((k) => [k, above[k]])) as Partial<Line>);
  };
  const cellsOf = (root: Element | null) => Array.from(root?.querySelectorAll<HTMLElement>('[data-field^="L."]') ?? []).filter((el) => !(el as HTMLInputElement).disabled && el.getClientRects().length > 0);
  const rowOfCell = (el: Element) => { const m = /^L\.(\d+)\./.exec(el.getAttribute("data-field") ?? ""); return m ? Number(m[1]) : -1; };
  // The same keyboard flow as the journal grid: Enter walks the cells, past the last cell of the last filled line a new line opens by itself.
  const gridRows = useGridRows({
    count: form?.lines.length ?? 0, readOnly: ro,
    firstCell: (grid, r) => cellsOf(grid).find((c) => rowOfCell(c) === r) ?? null,
    cellOf: (el) => { const m = /^L\.(\d+)\.(\w+)$/.exec(el.getAttribute("data-field") ?? ""); return m ? { row: Number(m[1]), col: m[2] } : null; },
    onRemove: removeLineAt, onFillRow: copyRowDown, onFillCell: copyCellDown,
    cellSelector: '[data-field^="L."]', fieldOf: (r, c) => `L.${r}.${c}`, endOfRow: "continue",
    onAddRow: addLine, lastRowBlank: () => !!form && isBlankEntry(toEntry(form.lines[form.lines.length - 1])), leave: (el, dir) => focusStep(el, dir),
  });

  // ---------- validate + save ----------
  // Rows the person has not started are dropped (index mapping is kept so a message points at the row as shown).
  const validate = (f: CbForm): Errors => {
    const e: Errors = {};
    const kept = f.lines.map((l, i) => ({ l, i })).filter(({ l }) => !isBlankEntry(toEntry(l)));
    const entries = kept.map(({ l }) => toEntry(l));
    for (const pr of voucherProblems({ voucherDate: f.voucherDate, cashBankLedgerId: f.cashBankLedgerId ? Number(f.cashBankLedgerId) : null, instrumentType: f.instrumentType, chequeNumber: f.chequeNumber, chequeDate: f.chequeDate, payeeReference: f.payeeReference, remarks: f.remarks }, entries)) {
      const m = /^lines\.(\d+)\.(\w+)$/.exec(pr.field);
      const key = m ? `lines.${kept[Number(m[1])].i}.${m[2]}` : pr.field;
      e[key] ??= m ? pr.message.replace(/^Line \d+: /, "") : pr.message;
    }
    if (bankNeedsSub && !f.cashBankSubLedgerId) e.cashBankSubLedgerId = `${bankLedger!.code} needs a sub ledger.`;
    kept.forEach(({ l, i }) => {
      const gl = ledgerById.get(l.generalLedgerId);
      if (gl?.requiresSubLedger && !l.subLedgerId) e[`lines.${i}.subLedger`] ??= `${gl.code} needs a sub ledger.`;
    });
    return e;
  };
  const payload = (f: CbForm) => ({
    companyId: p.companyId, branchId: p.branchId, userId: p.userId, fiscalYear: fyCodeFor(f.voucherDate), voucherDate: f.voucherDate, cashBankLedgerId: Number(f.cashBankLedgerId), cashBankSubLedgerId: f.cashBankSubLedgerId ? Number(f.cashBankSubLedgerId) : null,
    instrumentType: f.instrumentType || null, chequeNumber: f.chequeNumber.trim() || null, chequeDate: f.chequeDate || null, payeeReference: f.payeeReference.trim() || null, remarks: f.remarks.trim() || null,
    lines: f.lines.filter((l) => !isBlankEntry(toEntry(l))).map((l) => ({ generalLedgerId: Number(l.generalLedgerId) || null, subLedgerId: l.subLedgerId ? Number(l.subLedgerId) : null, receipt: l.receipt || null, payment: l.payment || null, narration: l.narration.trim() || null })),
  });
  // The cell an error belongs to: header errors are named like their field; a line error is lines.<row>.<account|subLedger|amount>.
  const fieldOfError = (key: string) => {
    const m = /^lines\.(\d+)\.(\w+)$/.exec(key);
    if (m) return `L.${m[1]}.${COL_OF[m[2]] ?? "a"}`;
    return key === "lines" ? "L.0.a" : key;
  };
  // A failed save does not open a dialog: the first wrong field takes the cursor and the status bar says what is wrong with it.
  const showFirstError = (e: Errors) => {
    const keys = Object.keys(e).filter((k) => e[k]);
    const rank = (k: string) => (k === "lines" ? 1e6 : /^lines\./.test(k) ? 1000 + Number(k.split(".")[1]) : 0);
    const first = keys.sort((a, b) => rank(a) - rank(b))[0];
    flash(first ? e[first]! : "Fix the highlighted fields.", "warn");
    if (first) focusField(fieldOfError(first), 20);
  };
  const fail = (e: unknown, title: string) => {
    const err = e as ApiError;
    if (err.field) setErrors((x) => ({ ...x, [err.field!]: err.message }));
    flash(err.message, "err");
    void dlg.error(err.message, { title });
  };

  const save = async (post: boolean) => {
    if (!form || saving) return;
    const e = validate(form);
    setErrors(e);
    if (Object.keys(e).length) { showFirstError(e); return; }
    if (post && !(await dlg.confirm(<>Post this voucher? Receipts <b>{npr(totals.receipts)}</b>, payments <b>{npr(totals.payments)}</b>. A posted voucher can no longer be edited; it can only be reversed.</>, { title: "Post voucher?", confirmLabel: "Post voucher" }))) return;
    setSaving(true);
    try {
      const body = { ...payload(form), post };
      const r = doc ? await cashBankApi.update(doc.id, p.companyId, body) : await cashBankApi.create(body);
      show(toForm(r.document), "view", r.document);
      flash(`${post ? "Posted" : "Saved draft"} ${r.document.voucherNumber}`, "ok");
      p.onListChanged();
    } catch (x) { fail(x, "Could not save the voucher"); } finally { setSaving(false); }
  };

  const guard = async (action: () => void) => {
    if (dirty && !(await dlg.confirm("Unsaved changes will be lost. Continue?", { title: "Discard unsaved changes?", variant: "warning", confirmLabel: "Discard", cancelLabel: "Stay here" }))) return;
    action();
  };
  const newDoc = () => p.onNew();
  const edit = () => { if (doc && form && doc.status === "DRAFT") { setMode("edit"); setBaseSig(sigOf(form)); flash(`Editing ${doc.voucherNumber}`, "info"); } };
  const cancel = () => void guard(() => { if (doc) show(toForm(doc), "view", doc); else show(emptyForm(lk), "new", null); flash("Cancelled", "info"); });

  const askDelete = async () => {
    if (!doc || doc.status !== "DRAFT") return;
    if (!(await dlg.confirm(<>Delete draft <b className="font-mono">{doc.voucherNumber}</b>? This cannot be undone.</>, { title: "Delete voucher?", variant: "danger", confirmLabel: "Delete" }))) return;
    try { await cashBankApi.remove(doc.id, p.companyId, p.userId); p.onListChanged(); p.onClose(p.tabId); } catch (x) { fail(x, "Could not delete the voucher"); }
  };
  const postDraft = async () => {
    if (!doc || doc.status !== "DRAFT") return;
    if (!(await dlg.confirm(<>Post <b className="font-mono">{doc.voucherNumber}</b>? It can no longer be edited; it can only be reversed.</>, { title: "Post voucher?", confirmLabel: "Post voucher" }))) return;
    try { const r = await cashBankApi.post(doc.id, p.companyId, p.userId); show(toForm(r.document), "view", r.document); flash(`Posted ${r.document.voucherNumber}`, "ok"); p.onListChanged(); } catch (x) { fail(x, "Could not post the voucher"); }
  };
  const reverse = async () => {
    if (!doc || doc.status !== "POSTED" || doc.isReversal) return;
    const reason = await dlg.prompt(<>Reverse <b className="font-mono">{doc.voucherNumber}</b>? A new posted voucher with every debit and credit swapped is created; this one is marked reversed. Reason:</>, { title: "Reverse voucher?", required: true });
    if (reason === null) return;
    try {
      const r = await cashBankApi.reverse(doc.id, p.companyId, p.userId, reason, defaultDate(fyOf(lk, doc.voucherDate)));
      show(toForm(r.document), "view", r.document); flash(`Reversed ${r.document.voucherNumber}`, "ok"); p.onListChanged();
    } catch (x) { fail(x, "Could not reverse the voucher"); }
  };

  // keyboard: Ctrl+S saves the draft, F3 new, F2 edit
  const keys = useRef({ save, newDoc, edit });
  keys.current = { save, newDoc, edit };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); if (mode !== "view") void keys.current.save(false); }
      else if (e.key === "F3") { e.preventDefault(); keys.current.newDoc(); }
      else if (e.key === "F2") { e.preventDefault(); keys.current.edit(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode]);

  const status = doc?.status;
  const err = (k: string) => errors[k];
  const plain = (v: bigint) => groupIN(formatPaise(v));
  const overdrawn = closing !== null && closing < 0n;

  // A new voucher starts on the first thing still empty: the cash / bank ledger, else the first line.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !form || mode !== "new") return;
    started.current = true;
    focusField(form.cashBankLedgerId ? "L.0.a" : "cashBankLedgerId", 80);
  });

  const summary: { label: string; value: string }[] = [
    { label: "Opening", value: opening === null ? "—" : splitBalanceText(opening) },
    { label: "Receipts", value: plain(totals.receipts) },
    { label: "Payments", value: plain(totals.payments) },
  ];
  const closingNote = closing === null ? "Choose a ledger and a valid date" : overdrawn ? "Overdrawn" : "";

  return (
    <div className="ledger flex min-h-0 min-w-0 flex-1">
      <section data-purchase-document className="flex min-h-0 min-w-0 flex-1 flex-col">
        <DocHeader title="Cash / Bank Voucher" number={doc?.voucherNumber} pill={status ? <Pill text={status} tone={TONE[status]} /> : <Pill text="Draft" tone="slate" />} branchName={p.branchName} fyCode={p.fyCode} dirty={dirty} />
        {doc && status !== "DRAFT" && (
          <div className="shrink-0 px-5 pt-2"><p className="border border-amber-300 bg-amber-50 px-2 py-1 text-[12px] text-amber-800">
            {status === "REVERSED" ? <>This voucher was reversed by <b className="font-mono">{doc.reversedByNumber}</b>.</> : doc.isReversal ? "This is a reversal voucher; it cannot be edited or reversed." : "Posted vouchers cannot be edited. Reverse it and enter a correct one."}
          </p></div>
        )}
        {/* The page is the only thing that scrolls. Totals and the buttons are in the footer below and stay in view. */}
        <div data-zone="form" onKeyDown={formEnterKey} className="lg-scroll min-h-0 flex-1 overflow-y-auto px-5 py-3">
          {!lk || !form ? <p className="p-2 text-slate-500">Loading…</p> : (
            <div className="space-y-2.5">
              <section className="lg-card space-y-2 px-4 py-3" aria-label="Voucher details">
                <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                  <Field label="Voucher No" className="w-[110px] shrink-0"><input readOnly tabIndex={-1} value={doc?.voucherNumber ?? "Auto"} aria-label="Voucher number" className="fld min-w-0 bg-slate-50 font-mono text-slate-600" /></Field>
                  <div className="w-[150px] shrink-0"><DateField label="Date" name="voucherDate" value={form.voucherDate} onChange={(v) => { patch({ voucherDate: v }); clear("voucherDate"); }} calendar={p.calendar} readOnly={ro} error={err("voucherDate")} required /></div>
                  <Field label="Cash / Bank Ledger" required error={err("cashBankLedgerId")} className="min-w-[230px] flex-[1.4]">
                    <MasterReferencePicker fieldName="cashBankLedgerId" label="Cash / bank ledger" scopeKey="cash-bank-ledgers" contextKey={String(p.companyId)} placeholder="Choose cash / bank ledger…" required value={form.cashBankLedgerId} hasError={!!err("cashBankLedgerId")} selectedSubtext={bankId ? balanceSubtext(bankId) : undefined}
                      options={bankOptions} disabled={ro} onChange={(v) => { patch({ cashBankLedgerId: v, cashBankSubLedgerId: "" }); clear("cashBankLedgerId", "cashBankSubLedgerId"); }} onCommit={(el, dir) => focusStep(el, dir)} />
                  </Field>
                  {(bankNeedsSub || bankSubs.length > 0) && (
                    <Field label={bankNeedsSub ? "Bank Sub Ledger" : "Bank Sub Ledger (optional)"} required={bankNeedsSub} error={err("cashBankSubLedgerId")} className="min-w-[170px] flex-1">
                      <MasterReferencePicker fieldName="cashBankSubLedgerId" label="Bank sub-ledger" scopeKey="cash-bank-bank-subledgers" contextKey={`${p.companyId}:${bankId || "none"}`} placeholder={bankNeedsSub ? "Choose sub-ledger…" : "None"} required={bankNeedsSub} value={form.cashBankSubLedgerId} hasError={!!err("cashBankSubLedgerId")} selectedSubtext={form.cashBankSubLedgerId ? balanceSubtext(bankId, form.cashBankSubLedgerId) : undefined}
                        options={bankSubOptions} disabled={ro} onChange={(v) => { patch({ cashBankSubLedgerId: v }); clear("cashBankSubLedgerId"); }} onCommit={(el, dir) => focusStep(el, dir)} />
                    </Field>
                  )}
                </div>
                <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                  <Field label="Instrument" error={err("instrumentType")} className="w-[150px] shrink-0">
                    <select data-field="instrumentType" disabled={ro} value={form.instrumentType} onChange={(e) => { patch({ instrumentType: e.target.value }); clear("instrumentType", "chequeNumber", "chequeDate"); }} className="fld min-w-0">
                      <option value="">None / cash</option>
                      {INSTRUMENTS.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}
                    </select>
                  </Field>
                  <TextField className="w-[140px] shrink-0" label={form.instrumentType === "CHEQUE" ? "Cheque No" : "Reference No"} name="chequeNumber" value={form.chequeNumber} onChange={(v) => { patch({ chequeNumber: v }); clear("chequeNumber"); }} readOnly={ro || !instrumentOn} max={MAX_CHEQUE_NO} placeholder="e.g. 008421" required={form.instrumentType === "CHEQUE"} error={err("chequeNumber")} />
                  <div className="w-[150px] shrink-0"><DateField label={form.instrumentType === "CHEQUE" ? "Cheque Date" : "Instrument Date"} name="chequeDate" value={form.chequeDate} onChange={(v) => { patch({ chequeDate: v }); clear("chequeDate"); }} calendar={p.calendar} readOnly={ro || !instrumentOn} error={err("chequeDate")} required={form.instrumentType === "CHEQUE"} /></div>
                  <TextField className="min-w-[170px] flex-1" label="Payee / Reference" name="payeeReference" value={form.payeeReference} onChange={(v) => { patch({ payeeReference: v }); clear("payeeReference"); }} readOnly={ro} max={MAX_PAYEE} placeholder="Optional" error={err("payeeReference")} />
                  <TextField className="min-w-[200px] flex-[1.3]" label="Remarks" name="remarks" value={form.remarks} onChange={(v) => { patch({ remarks: v }); clear("remarks"); }} readOnly={ro} max={MAX_REMARKS} narrationCompanyId={p.companyId} placeholder="Optional note for this voucher" error={err("remarks")} />
                </div>
              </section>

              <section className="lg-card lg-grid" aria-label="Voucher entries">
                {/* No scroll box of its own: the grid is as tall as its lines and the page scrolls. */}
                <div data-grid="lines" data-nav="lines-grid" {...gridRows.gridProps} onKeyDown={(e) => { gridRows.handleKey(e); }} aria-label="Voucher entries" className="min-w-[860px] outline-none">
                  <div style={{ gridTemplateColumns: TEMPLATE }} className="xl-head">
                    <span className="xl-rowhead">No</span><span>Account / Party</span><span>Sub-ledger</span><span className="text-right">Receipt</span><span className="text-right">Payment</span><span>Narration</span><span />
                  </div>
                  {form.lines.map((l, i) => {
                    const gl = ledgerById.get(l.generalLedgerId);
                    const subs = (lk.subLedgers ?? []).filter((s) => String(s.generalLedgerId) === l.generalLedgerId);
                    const subOptions: ReferenceOption[] = subs.map((s) => ({ value: String(s.id), label: `${s.code} — ${s.name}`, code: s.code, name: s.name, detail: gl ? `For ${gl.name}` : undefined, subtext: balanceSubtext(s.generalLedgerId, s.id), isActive: s.isActive }));
                    const needSub = !!gl?.requiresSubLedger;
                    const msg = (["account", "subLedger", "amount"] as const).map((k) => err(`lines.${i}.${k}`)).find(Boolean);
                    const sel = gridRows.rowSel === i;
                    return (
                      <div key={l.key} data-row={i} className={`transition-colors ${sel ? "bg-cobalt-50 ring-2 ring-inset ring-cobalt-700" : msg ? "bg-rose-50" : "hover:bg-slate-50/80"}`}
                        onMouseDown={(e) => {
                          if ((e.target as HTMLElement).closest("input, button, [role=\"combobox\"], textarea, select, a")) return;
                          const first = e.currentTarget.querySelector<HTMLElement>('[data-field^="L."]:not(:disabled)');
                          if (first) { e.preventDefault(); first.focus(); }
                        }}>
                        <div style={{ gridTemplateColumns: TEMPLATE }} data-selected={sel} className="xl-row items-start">
                          <button type="button" className="xl-rowhead" {...gridRows.rowHeadProps(i)}>{i + 1}</button>
                          <MasterReferencePicker fieldName={`L.${i}.a`} label={`Line ${i + 1} account`} scopeKey="cash-bank-accounts" contextKey={String(p.companyId)} placeholder="Choose account / party…" value={l.generalLedgerId} hasError={!!err(`lines.${i}.account`)} selectedSubtext={l.generalLedgerId ? balanceSubtext(l.generalLedgerId) : undefined}
                            options={accountOptions} disabled={ro} onChange={(v) => { patchLine(l.key, { generalLedgerId: v, subLedgerId: "" }); clear(`lines.${i}.account`, `lines.${i}.subLedger`); }} onCommit={gridRows.afterCombo} />
                          <MasterReferencePicker fieldName={`L.${i}.s`} label={`Line ${i + 1} sub-ledger`} scopeKey="cash-bank-line-subledgers" contextKey={`${p.companyId}:${l.generalLedgerId || "none"}`} placeholder={!gl ? "—" : needSub ? (subOptions.length ? "Choose sub-ledger…" : "None yet") : subOptions.length ? "None (optional)" : "— not needed —"} required={needSub} value={l.subLedgerId} hasError={!!err(`lines.${i}.subLedger`)} selectedSubtext={l.subLedgerId && gl ? balanceSubtext(gl.id, l.subLedgerId) : undefined}
                            options={subOptions} disabled={ro || !gl || (!needSub && subs.length === 0)} onChange={(v) => { patchLine(l.key, { subLedgerId: v }); clear(`lines.${i}.subLedger`); }} onCommit={gridRows.afterCombo} />
                          <input data-field={`L.${i}.r`} aria-label={`Line ${i + 1} receipt`} inputMode="decimal" autoComplete="off" disabled={ro} placeholder="0.00" value={l.receipt} onChange={(e) => setAmount(l.key, "receipt", e.target.value)} onFocus={(e) => e.currentTarget.select()} className={`fld min-w-0 text-right font-mono tabular-nums ${err(`lines.${i}.amount`) ? "fld-err" : ""}`} />
                          <input data-field={`L.${i}.p`} aria-label={`Line ${i + 1} payment`} inputMode="decimal" autoComplete="off" disabled={ro} placeholder="0.00" value={l.payment} onChange={(e) => setAmount(l.key, "payment", e.target.value)} onFocus={(e) => e.currentTarget.select()} className={`fld min-w-0 text-right font-mono tabular-nums ${err(`lines.${i}.amount`) ? "fld-err" : ""}`} />
                          <NarrationInput companyId={p.companyId} data-field={`L.${i}.n`} aria-label={`Line ${i + 1} narration`} disabled={ro} maxLength={MAX_NARRATION} value={l.narration} onText={(v) => patchLine(l.key, { narration: v })} onFocus={(e) => e.currentTarget.select()} className="fld min-w-0" />
                          <button type="button" data-nav="remove-line" tabIndex={-1} disabled={ro} onClick={() => removeLineAt(i)} aria-label={`Remove line ${i + 1}`} title="Remove line (Shift+Delete)" className="grid h-8 w-full place-items-center text-slate-400 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-30"><X size={14} /></button>
                        </div>
                        {msg && <p className="px-3 pb-1 pt-0.5 text-[12px] text-rose-700" role="alert">{msg}</p>}
                      </div>
                    );
                  })}
                </div>
                {err("lines") && <p className="px-3 py-1.5 text-[12px] text-rose-700" role="alert">{err("lines")}</p>}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-200 bg-slate-50 px-3 py-2">
                  {!ro && <button type="button" data-nav="add-line" className="btn" onClick={addLine}><Plus size={13} /> Add line</button>}
                  {!ro && <span className="text-[12px] text-slate-500">Enter moves on and opens a new line at the end · enter an amount in Receipt or Payment</span>}
                  <span className="flex-1" />
                  <span className="text-[12.5px] text-slate-600">Entries <b className="font-semibold tabular-nums text-ink">{entryCount}</b></span>
                </div>
              </section>
            </div>
          )}
        </div>

        {/* Always in view: opening balance, receipts, payments and the closing balance, beside the buttons. */}
        <footer className="tape flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2 px-5 py-2.5">
          <div className="flex min-w-0 flex-1 flex-wrap items-end gap-x-6 gap-y-1" aria-live="polite" aria-label="Balance summary">
            {summary.map((s) => (
              <div key={s.label} className="min-w-0">
                <div className="text-[12px] font-medium text-white/65">{s.label}</div>
                <div className="truncate text-[15px] font-semibold leading-tight tabular-nums text-white">{s.value}</div>
              </div>
            ))}
            <div className="flex min-w-0 items-end gap-3 border-l border-white/15 pl-6">
              <div className="min-w-0">
                <div className="text-[12px] font-medium text-white/65">Closing balance</div>
                <div key={closing === null ? "none" : closing.toString()} className={`lg-settle truncate text-[22px] font-semibold leading-tight tabular-nums ${overdrawn ? "text-amber-300" : "text-brass"}`}>{closing === null ? "—" : splitBalanceText(closing)}</div>
              </div>
              {closingNote && <span role={overdrawn ? "alert" : "status"} className={`pb-0.5 text-[12px] ${overdrawn ? "text-amber-300" : "text-white/60"}`}>{closingNote}</span>}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {!ro ? (
              <>
                <button data-nav className="btn" onClick={cancel}><X size={14} /> Cancel</button>
                <button data-nav className="btn" disabled={saving} onClick={() => void save(false)}><Save size={14} /> Save draft <span className="kbd">Ctrl+S</span></button>
                <button data-nav className="btn btn-primary" disabled={saving} onClick={() => void save(true)}><Check size={14} /> Save voucher</button>
              </>
            ) : (
              <>
                <button data-nav className="btn" onClick={newDoc}><Plus size={14} /> New <span className="kbd">F3</span></button>
                <button data-nav className="btn" disabled={status !== "DRAFT"} onClick={edit}><Pencil size={14} /> Edit <span className="kbd">F2</span></button>
                <button data-nav className="btn" disabled={status !== "DRAFT"} onClick={() => void askDelete()}><Trash2 size={14} /> Delete</button>
                {status === "DRAFT" && <button data-nav className="btn btn-primary" onClick={() => void postDraft()}><Check size={14} /> Post voucher</button>}
                {status === "POSTED" && !doc?.isReversal && <button data-nav className="btn" onClick={() => void reverse()}><Undo2 size={14} /> Reverse</button>}
                {status === "REVERSED" && <span className="inline-flex items-center gap-1.5 text-[12px] text-amber-300"><Ban size={13} /> Reversed</span>}
              </>
            )}
          </div>
        </footer>
      </section>
    </div>
  );
}
