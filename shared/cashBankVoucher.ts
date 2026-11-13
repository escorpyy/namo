// ============================================================
// CASH / BANK VOUCHER: the rules that do not need the database. The screen validates and previews with these, the server
// validates with the same functions, so the two cannot disagree about what a valid voucher is.
//
// What the person keys: a cash/bank ledger, then entry lines. Each line is one account (a party's ledger or any other ledger) with
// EITHER a receipt (money came in from it) OR a payment (money went out to it). The cash/bank ledger's own movement is not keyed:
//   receipt line  -> Cr the account        payment line -> Dr the account
//   Dr cash/bank ledger = total receipts   Cr cash/bank ledger = total payments      (two lines, a zero side is left out)
// so every voucher balances by construction, and the database check (Dr = Cr per voucher, migration 0007) is only the safety net.
// Money is whole paisa in bigint here (never floating point); amounts travel as plain decimal strings ("12000.50").
// ============================================================

export const INSTRUMENTS = [
  { value: "CHEQUE", label: "Cheque" },
  { value: "RTGS", label: "RTGS" },
  { value: "ONLINE_TRANSFER", label: "Online transfer" },
  { value: "OTHER", label: "Other" },
] as const;
export type InstrumentType = (typeof INSTRUMENTS)[number]["value"];
export const isInstrument = (v: unknown): v is InstrumentType => INSTRUMENTS.some((i) => i.value === v);

export const MAX_ENTRY_LINES = 200;
export const MAX_NARRATION = 500;
export const MAX_REMARKS = 1024;
export const MAX_PAYEE = 100;
export const MAX_CHEQUE_NO = 30;

// ---------- amounts ----------
/**
 * An amount in paisa. Blank or missing is 0. Anything else must be a plain non-negative number with at most 2 decimals
 * ("1234", "1234.5", "1234.50"): a negative sign, a thousands comma, exponent form or a third decimal is refused (null) rather than rounded.
 */
export function parseAmount(v: unknown): bigint | null {
  if (v === null || v === undefined) return 0n;
  const s = typeof v === "number" ? (Number.isFinite(v) ? String(v) : "x") : typeof v === "string" ? v.trim() : "x";
  if (s === "") return 0n;
  const m = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  return BigInt(m[1]) * 100n + BigInt(((m[2] ?? "") + "00").slice(0, 2));
}

/** paisa -> "1234.50" (a minus sign for a negative amount) */
export function formatPaise(p: bigint): string {
  const neg = p < 0n, a = neg ? -p : p;
  return `${neg ? "-" : ""}${a / 100n}.${String(a % 100n).padStart(2, "0")}`;
}

// ---------- dates ----------
export function isIsoDate(s: unknown): s is string {
  const m = typeof s === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(s) : null;
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

// ---------- entries ----------
export interface EntryInput {
  generalLedgerId?: number | null;
  subLedgerId?: number | null;
  receipt?: unknown;
  payment?: unknown;
  narration?: string | null;
}

/** true for a row the person has not started (nothing chosen, no amount): the screen drops these instead of complaining */
export const isBlankEntry = (e: EntryInput) => !e.generalLedgerId && !e.subLedgerId && !parseAmount(e.receipt) && !parseAmount(e.payment) && !(e.narration ?? "").trim();

/** what is wrong with the amounts of one line, or null */
export function amountProblem(e: Pick<EntryInput, "receipt" | "payment">): string | null {
  const r = parseAmount(e.receipt), p = parseAmount(e.payment);
  if (r === null) return "Receipt must be an amount with at most 2 decimals.";
  if (p === null) return "Payment must be an amount with at most 2 decimals.";
  if (r > 0n && p > 0n) return "Enter either a receipt or a payment on a line, not both.";
  if (r === 0n && p === 0n) return "Enter a receipt or a payment amount.";
  return null;
}

export function entryTotals(entries: Pick<EntryInput, "receipt" | "payment">[]): { receipts: bigint; payments: bigint } {
  let receipts = 0n, payments = 0n;
  for (const e of entries) { receipts += parseAmount(e.receipt) ?? 0n; payments += parseAmount(e.payment) ?? 0n; }
  return { receipts, payments };
}

/** the cash/bank balance after the voucher: opening + receipts - payments */
export const closingBalance = (opening: bigint, receipts: bigint, payments: bigint) => opening + receipts - payments;

// ---------- the voucher as a whole ----------
export interface VoucherHead {
  voucherDate?: unknown;
  cashBankLedgerId?: number | null;
  instrumentType?: string | null;
  chequeNumber?: string | null;
  chequeDate?: string | null;
  payeeReference?: string | null;
  remarks?: string | null;
}
export interface Problem { field: string; message: string }

/**
 * Every problem the rules above can see, in the order the form is read. Fields: voucherDate, cashBankLedgerId, instrumentType,
 * chequeNumber, chequeDate, payeeReference, remarks, lines (the list as a whole) and lines.<i>.account / .amount / .narration for row i (0-based).
 * What needs the database (the ledger exists and is a cash/bank ledger, the sub-ledger belongs to the account) is checked by the service.
 */
export function voucherProblems(h: VoucherHead, entries: EntryInput[]): Problem[] {
  const out: Problem[] = [];
  const add = (field: string, message: string) => out.push({ field, message });
  if (!isIsoDate(h.voucherDate)) add("voucherDate", "Voucher date must be a real date like 2026-10-22.");
  if (!h.cashBankLedgerId) add("cashBankLedgerId", "Choose the cash / bank ledger.");
  const inst = h.instrumentType ?? null;
  if (inst !== null && inst !== "" && !isInstrument(inst)) add("instrumentType", "Instrument type is not one of the known types.");
  const cheque = (h.chequeNumber ?? "").trim();
  if (cheque.length > MAX_CHEQUE_NO) add("chequeNumber", `Cheque number can have ${MAX_CHEQUE_NO} characters at most.`);
  if (h.chequeDate && !isIsoDate(h.chequeDate)) add("chequeDate", "Cheque date must be a real date like 2026-10-22.");
  if (inst === "CHEQUE") {
    if (!cheque) add("chequeNumber", "Enter the cheque number.");
    if (!h.chequeDate) add("chequeDate", "Enter the cheque date.");
  }
  if ((h.payeeReference ?? "").length > MAX_PAYEE) add("payeeReference", `Payee / reference can have ${MAX_PAYEE} characters at most.`);
  if ((h.remarks ?? "").length > MAX_REMARKS) add("remarks", `Remarks can have ${MAX_REMARKS} characters at most.`);
  if (entries.length === 0) add("lines", "Add at least one entry line.");
  if (entries.length > MAX_ENTRY_LINES) add("lines", `At most ${MAX_ENTRY_LINES} lines per voucher.`);
  entries.forEach((e, i) => {
    if (!e.generalLedgerId) add(`lines.${i}.account`, `Line ${i + 1}: choose the account or party.`);
    else if (h.cashBankLedgerId && e.generalLedgerId === h.cashBankLedgerId) add(`lines.${i}.account`, `Line ${i + 1}: the cash / bank ledger cannot also be an entry line.`);
    const a = amountProblem(e);
    if (a) add(`lines.${i}.amount`, `Line ${i + 1}: ${a}`);
    if ((e.narration ?? "").length > MAX_NARRATION) add(`lines.${i}.narration`, `Line ${i + 1}: narration can have ${MAX_NARRATION} characters at most.`);
  });
  return out;
}

// ---------- the journal the voucher becomes ----------
export interface JournalLine {
  generalLedgerId: number;
  subLedgerId: number | null;
  debit: bigint;
  credit: bigint;
  narration: string | null;
  isCashBankLine: boolean;
  instrumentType: InstrumentType | null;
  chequeNumber: string | null;
  chequeDate: string | null;
}

/**
 * The lines to store: the entries first (a receipt credits its account, a payment debits it), then the cash/bank movement
 * (Dr total receipts, Cr total payments; the instrument details and the bank's sub-ledger sit on these two lines because they describe the bank side).
 * Assumes the entries already passed voucherProblems.
 */
export function journalLines(
  cashBankLedgerId: number,
  entries: EntryInput[],
  instrument: { instrumentType?: string | null; chequeNumber?: string | null; chequeDate?: string | null; bankSubLedgerId?: number | null } = {},
): JournalLine[] {
  const inst = instrument.instrumentType && isInstrument(instrument.instrumentType) ? instrument.instrumentType : null;
  const cheque = (instrument.chequeNumber ?? "").trim() || null; // kept for any instrument: an RTGS / transfer reference may be typed in the same box
  const out: JournalLine[] = entries.map((e) => {
    const r = parseAmount(e.receipt) ?? 0n, p = parseAmount(e.payment) ?? 0n;
    return {
      generalLedgerId: e.generalLedgerId as number, subLedgerId: e.subLedgerId ?? null, debit: p, credit: r,
      narration: (e.narration ?? "").trim() || null, isCashBankLine: false, instrumentType: null, chequeNumber: null, chequeDate: null,
    };
  });
  const { receipts, payments } = entryTotals(entries);
  const bank = (debit: bigint, credit: bigint): JournalLine => ({
    generalLedgerId: cashBankLedgerId, subLedgerId: instrument.bankSubLedgerId ?? null, debit, credit, narration: null, isCashBankLine: true,
    instrumentType: inst, chequeNumber: cheque, chequeDate: instrument.chequeDate || null,
  });
  if (receipts > 0n) out.push(bank(receipts, 0n));
  if (payments > 0n) out.push(bank(0n, payments));
  return out;
}

/** the same lines turned inside out (a reversal): every debit becomes a credit and the other way round */
export const swapSides = (lines: JournalLine[]): JournalLine[] => lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit }));
