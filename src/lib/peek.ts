import { formatPaise, parseAmount } from "../../shared/cashBankVoucher";
import { drCrText } from "./balanceText";
import type { JLine } from "./journalForm";

// The account panel beside the voucher screens (components/PeekPanel.tsx): the plain rules it needs, kept apart from React so they can be tested.
// Money is whole paisa in bigint, like shared/cashBankVoucher.ts.

/** the account the cursor is on: a ledger, or one party (sub-ledger) of it */
export interface PeekTarget { glId: number; subId: number | null }

/** one side of one line of the voucher being typed, as it will hit the books */
export interface PeekRow { glId: number; subId: number | null; dr: bigint; cr: bigint }

// "12." is what the field holds for a moment while a number is being typed: read it as 12.
const amount = (v: string) => parseAmount(v.trim().replace(/\.$/, "")) ?? 0n;

/** debit minus credit of a balance as the server sends it (one side is always 0.00) */
export const netOfBalance = (b: { debit: string; credit: string }): bigint => (parseAmount(b.debit) ?? 0n) - (parseAmount(b.credit) ?? 0n);

/**
 * What the voucher being typed does to the account: the lines that belong to it, debit minus credit. A ledger target takes every line of
 * the ledger (its balance is the whole control account); a party target only the lines of that party.
 */
export function pendingNet(target: PeekTarget, rows: PeekRow[]): bigint {
  let n = 0n;
  for (const r of rows) if (r.glId === target.glId && (target.subId === null || r.subId === target.subId)) n += r.dr - r.cr;
  return n;
}

/** the lines of a journal voucher form, for pendingNet */
export function journalPeekRows(lines: JLine[]): PeekRow[] {
  return lines.filter((l) => l.glId).map((l) => ({ glId: Number(l.glId), subId: l.subId ? Number(l.subId) : null, dr: amount(l.debit), cr: amount(l.credit) }));
}

interface CashBankLineInput { generalLedgerId: string; subLedgerId: string; receipt: string; payment: string }

/**
 * The lines a cash / bank voucher becomes (same rule as journalLines in shared/cashBankVoucher.ts): a receipt credits its account, a payment
 * debits it, and the cash / bank ledger takes the totals the other way round (Dr receipts, Cr payments).
 */
export function cashBankPeekRows(bankLedgerId: string, bankSubLedgerId: string, lines: CashBankLineInput[]): PeekRow[] {
  const rows: PeekRow[] = [];
  let receipts = 0n, payments = 0n;
  for (const l of lines) {
    const r = amount(l.receipt), p = amount(l.payment);
    receipts += r; payments += p;
    if (l.generalLedgerId) rows.push({ glId: Number(l.generalLedgerId), subId: l.subLedgerId ? Number(l.subLedgerId) : null, dr: p, cr: r });
  }
  if (bankLedgerId && (receipts > 0n || payments > 0n)) rows.push({ glId: Number(bankLedgerId), subId: bankSubLedgerId ? Number(bankSubLedgerId) : null, dr: receipts, cr: payments });
  return rows;
}

/** "NPR 12,500.00 Dr" / "NPR 300.00 Cr" / "NPR 0.00" for a net amount (debit minus credit) */
export const netText = (net: bigint): string => drCrText(formatPaise(net > 0n ? net : 0n), formatPaise(net < 0n ? -net : 0n));
