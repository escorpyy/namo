import type { JDoc, JLookups } from "../api";
import { dateErr, newKey, str } from "./purchaseForm";
import { fromPaise, toPaise } from "./money";

// The journal voucher form <-> document <-> payload, and its rules. The server repeats every rule; these only let the screen say so before saving.

export interface JLine { key: string; glId: string; subId: string; agentId: string; debit: string; credit: string; narration: string }
export interface JForm { numberSeriesId: string; docNumber: string; voucherDate: string; remarks: string; lines: JLine[] }
export type JErrors = Record<string, string | undefined>;

export const blankJLine = (over: Partial<JLine> = {}): JLine => ({ key: newKey(), glId: "", subId: "", agentId: "", debit: "", credit: "", narration: "", ...over });
export const isBlankJLine = (l: JLine) => !l.glId && !l.subId && !l.agentId && !l.debit.trim() && !l.credit.trim() && !l.narration.trim();
// A new voucher starts with two lines: one Dr, one Cr. (Entry order is the accountant's: debit first.)
export const emptyJLines = () => [blankJLine(), blankJLine()];

const amountOf = (v: string) => (/^\d{0,12}(\.\d{0,2})?$/.test(v) ? toPaise(v) : 0);
export const jTotals = (lines: JLine[]) => {
  let dr = 0, cr = 0, used = 0;
  for (const l of lines) { const d = amountOf(l.debit), c = amountOf(l.credit); dr += d; cr += c; if (d || c) used++; }
  return { dr, cr, diff: dr - cr, used };
};
export const fmtAmt = (paise: number) => fromPaise(paise).replace(/\B(?=(\d{2})*\d{3}(?!\d))/g, ",");

export const jLineFromDoc = (l: JDoc["lines"][number]): JLine => ({
  key: newKey(), glId: str(l.generalLedgerId), subId: str(l.subLedgerId), agentId: str(l.agentId),
  debit: toPaise(l.debit) ? fromPaise(toPaise(l.debit)) : "", credit: toPaise(l.credit) ? fromPaise(toPaise(l.credit)) : "", narration: str(l.narration),
});
export const jFormFromDoc = (d: JDoc): JForm => ({
  numberSeriesId: str(d.numberSeriesId), docNumber: d.voucherNumber, voucherDate: d.voucherDate, remarks: str(d.remarks),
  lines: d.lines.length ? d.lines.map(jLineFromDoc) : emptyJLines(),
});
// A new draft from a saved voucher: same lines and remarks, today's date, a new number.
export const copyJForm = (f: JForm, date: string): JForm => ({ numberSeriesId: "", docNumber: "", voucherDate: date, remarks: f.remarks, lines: f.lines.map((l) => ({ ...l, key: newKey() })) });

export const jToPayload = (f: JForm, doc: JDoc | null, reason?: string) => ({
  voucherDate: f.voucherDate, remarks: f.remarks.trim() || null,
  ...(doc ? {} : { voucherNumber: f.docNumber.trim() || null, numberSeriesId: f.numberSeriesId ? Number(f.numberSeriesId) : null }),
  ...(reason ? { reason } : {}),
  lines: f.lines.filter((l) => !isBlankJLine(l)).map((l) => ({
    generalLedgerId: Number(l.glId), subLedgerId: l.subId ? Number(l.subId) : null, agentId: l.agentId ? Number(l.agentId) : null,
    debit: l.debit.trim() || "0", credit: l.credit.trim() || "0", narration: l.narration.trim() || null,
  })),
});

// Errors are keyed like the purchase grids: "L.<row>.<col>" for a cell, "lines" for the whole grid. Row numbers count every row, blank ones too.
export function validateJournal(f: JForm, lk: JLookups): JErrors {
  const e: JErrors = {};
  e.voucherDate = dateErr("Voucher date", f.voucherDate, true);
  if (f.remarks.length > 1024) e.remarks = "Remarks can be at most 1024 characters.";
  const gl = new Map(lk.ledgers.map((x) => [String(x.id), x]));
  let live = 0;
  f.lines.forEach((l, i) => {
    if (isBlankJLine(l)) return;
    live++;
    const d = amountOf(l.debit), c = amountOf(l.credit);
    const g = gl.get(l.glId);
    if (!l.glId || !g) e[`L.${i}.g`] = `Line ${i + 1}: pick the ledger.`;
    else if (g.requiresSubLedger && !l.subId) e[`L.${i}.s`] = `Line ${i + 1}: ${g.code} needs a party.`;
    if (l.debit.trim() && !/^\d{0,12}(\.\d{1,2})?$/.test(l.debit.trim())) e[`L.${i}.d`] = `Line ${i + 1}: Dr must be a number with at most 2 decimals.`;
    if (l.credit.trim() && !/^\d{0,12}(\.\d{1,2})?$/.test(l.credit.trim())) e[`L.${i}.c`] = `Line ${i + 1}: Cr must be a number with at most 2 decimals.`;
    if (d && c) e[`L.${i}.d`] = `Line ${i + 1}: enter Dr or Cr, not both.`;
    else if (!d && !c) e[`L.${i}.d`] = `Line ${i + 1}: enter an amount in Dr or Cr.`;
  });
  if (live === 0) e.lines = "Enter at least two lines.";
  else if (live < 2) e.lines = "A voucher needs at least two lines.";
  const t = jTotals(f.lines);
  if (!e.lines && t.diff !== 0) e.lines = `Dr and Cr must be equal: difference ${fmtAmt(Math.abs(t.diff))}. Use F8 to balance the last line.`;
  return e;
}
