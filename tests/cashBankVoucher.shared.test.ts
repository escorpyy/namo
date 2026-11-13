import { describe, expect, it } from "vitest";
import {
  amountProblem, closingBalance, entryTotals, formatPaise, isBlankEntry, isIsoDate, journalLines, parseAmount, swapSides, voucherProblems,
  type EntryInput,
} from "../shared/cashBankVoucher";

// The rules the Cash / Bank Voucher screen and the server share (shared/cashBankVoucher.ts). No database here.

const BANK = 1, CUSTOMER = 10, RENT = 20;
// The worked example of the design screen: 18,500.00 received from a customer, 12,000.00 paid as office rent.
const entries: EntryInput[] = [
  { generalLedgerId: CUSTOMER, receipt: "18500.00", narration: "Receipt against invoice INV-2082-041" },
  { generalLedgerId: RENT, payment: "12000.00", narration: "Monthly office rent" },
];
const head = { voucherDate: "2026-02-10", cashBankLedgerId: BANK };

describe("parseAmount / formatPaise", () => {
  it("reads plain amounts into whole paisa", () => {
    expect(parseAmount("18500")).toBe(1_850_000n);
    expect(parseAmount("18500.5")).toBe(1_850_050n);
    expect(parseAmount("0.05")).toBe(5n);
    expect(parseAmount(12000)).toBe(1_200_000n);
  });
  it("treats blank and missing as zero", () => {
    expect(parseAmount("")).toBe(0n);
    expect(parseAmount("  ")).toBe(0n);
    expect(parseAmount(undefined)).toBe(0n);
    expect(parseAmount(null)).toBe(0n);
  });
  it("refuses anything that is not a plain amount with at most 2 decimals instead of rounding it", () => {
    for (const bad of ["-5", "1,000", "1e3", "12.345", "abc", "12.", ".5", Number.NaN, Infinity, {}, [], true, "1".repeat(13)]) expect(parseAmount(bad), String(bad)).toBeNull();
  });
  it("formats paisa back to a decimal string, with a sign for a negative amount", () => {
    expect(formatPaise(1_850_000n)).toBe("18500.00");
    expect(formatPaise(5n)).toBe("0.05");
    expect(formatPaise(0n)).toBe("0.00");
    expect(formatPaise(-1_234_567n)).toBe("-12345.67");
  });
});

describe("isIsoDate", () => {
  it("accepts real dates and refuses impossible or malformed ones", () => {
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(isIsoDate("2028-02-29")).toBe(true);
    for (const bad of ["2026-02-30", "2026-13-01", "2026-2-1", "26-02-01", "", null, undefined, 20260201]) expect(isIsoDate(bad), String(bad)).toBe(false);
  });
});

describe("entries", () => {
  it("a line needs exactly one of receipt and payment", () => {
    expect(amountProblem({ receipt: "10" })).toBeNull();
    expect(amountProblem({ payment: "10" })).toBeNull();
    expect(amountProblem({ receipt: "10", payment: "5" })).toMatch(/either a receipt or a payment/);
    expect(amountProblem({})).toMatch(/Enter a receipt or a payment/);
    expect(amountProblem({ receipt: "0", payment: "0.00" })).toMatch(/Enter a receipt or a payment/);
    expect(amountProblem({ receipt: "1.234" })).toMatch(/at most 2 decimals/);
    expect(amountProblem({ payment: "-1" })).toMatch(/at most 2 decimals/);
  });
  it("totals the two sides separately", () => {
    expect(entryTotals(entries)).toEqual({ receipts: 1_850_000n, payments: 1_200_000n });
    expect(entryTotals([{ receipt: "bad" }, { payment: "2.50" }])).toEqual({ receipts: 0n, payments: 250n });
  });
  it("closing = opening + receipts - payments (12,84,500.00 -> 12,91,000.00), and can go negative", () => {
    const { receipts, payments } = entryTotals(entries);
    expect(formatPaise(closingBalance(128_450_000n, receipts, payments))).toBe("1291000.00");
    expect(closingBalance(0n, 0n, 500n)).toBe(-500n);
  });
  it("tells an untouched row from a started one", () => {
    expect(isBlankEntry({})).toBe(true);
    expect(isBlankEntry({ generalLedgerId: null, receipt: "", payment: "", narration: "  " })).toBe(true);
    expect(isBlankEntry({ narration: "rent" })).toBe(false);
    expect(isBlankEntry({ payment: "1" })).toBe(false);
    expect(isBlankEntry({ generalLedgerId: 5 })).toBe(false);
  });
});

describe("voucherProblems", () => {
  const fields = (h: any, e: EntryInput[]) => voucherProblems(h, e).map((p) => p.field);
  it("a complete voucher has no problem", () => {
    expect(voucherProblems(head, entries)).toEqual([]);
  });
  it("needs a date, a cash/bank ledger and at least one line", () => {
    expect(fields({}, [])).toEqual(["voucherDate", "cashBankLedgerId", "lines"]);
    expect(fields({ ...head, voucherDate: "2026-02-30" }, entries)).toEqual(["voucherDate"]);
  });
  it("names the row and the field of a bad line (0-based index in the field, 1-based in the message)", () => {
    const p = voucherProblems(head, [entries[0], { generalLedgerId: null, receipt: "5" }, { generalLedgerId: RENT, receipt: "1", payment: "1" }]);
    expect(p.map((x) => x.field)).toEqual(["lines.1.account", "lines.2.amount"]);
    expect(p[0].message).toMatch(/^Line 2:/);
    expect(p[1].message).toMatch(/^Line 3:/);
  });
  it("the cash/bank ledger cannot also be an entry line", () => {
    expect(fields(head, [{ generalLedgerId: BANK, receipt: "5" }])).toEqual(["lines.0.account"]);
  });
  it("a cheque needs its number and date; other instruments do not", () => {
    expect(fields({ ...head, instrumentType: "CHEQUE" }, entries)).toEqual(["chequeNumber", "chequeDate"]);
    expect(fields({ ...head, instrumentType: "CHEQUE", chequeNumber: "008421", chequeDate: "2026-02-10" }, entries)).toEqual([]);
    expect(fields({ ...head, instrumentType: "RTGS" }, entries)).toEqual([]);
    expect(fields({ ...head, instrumentType: "" }, entries)).toEqual([]);
    expect(fields({ ...head, instrumentType: "CARRIER_PIGEON" }, entries)).toEqual(["instrumentType"]);
    expect(fields({ ...head, instrumentType: "RTGS", chequeDate: "2026-02-31" }, entries)).toEqual(["chequeDate"]);
  });
  it("limits the lengths of the text fields", () => {
    const f = fields({ ...head, payeeReference: "x".repeat(101), remarks: "x".repeat(1025), chequeNumber: "x".repeat(31) }, [{ generalLedgerId: RENT, payment: "1", narration: "x".repeat(501) }]);
    expect(f).toEqual(["chequeNumber", "payeeReference", "remarks", "lines.0.narration"]);
  });
  it("allows 200 lines and refuses 201", () => {
    const many = (n: number): EntryInput[] => Array.from({ length: n }, () => ({ generalLedgerId: RENT, payment: "1" }));
    expect(voucherProblems(head, many(200))).toEqual([]);
    expect(fields(head, many(201))).toEqual(["lines"]);
  });
});

describe("journalLines", () => {
  const sum = (ls: { debit: bigint; credit: bigint }[]) => ls.reduce((a, l) => ({ d: a.d + l.debit, c: a.c + l.credit }), { d: 0n, c: 0n });

  it("the design screen's example: the receipt credits the customer, the payment debits the rent, the bank moves by the totals", () => {
    const ls = journalLines(BANK, entries);
    expect(ls.map((l) => [l.generalLedgerId, l.debit, l.credit, l.isCashBankLine])).toEqual([
      [CUSTOMER, 0n, 1_850_000n, false],
      [RENT, 1_200_000n, 0n, false],
      [BANK, 1_850_000n, 0n, true], // Dr bank = total receipts
      [BANK, 0n, 1_200_000n, true], // Cr bank = total payments
    ]);
  });
  it("always balances, whatever the mix", () => {
    for (const set of [entries, [entries[0]], [entries[1]], [{ generalLedgerId: RENT, payment: "0.01" }, { generalLedgerId: CUSTOMER, receipt: "99999999.99" }]]) {
      const t = sum(journalLines(BANK, set));
      expect(t.d).toBe(t.c);
    }
  });
  it("leaves out the side that has no money: a receipts-only voucher has no credit to the bank", () => {
    const ls = journalLines(BANK, [entries[0]]);
    expect(ls.filter((l) => l.isCashBankLine).map((l) => [l.debit, l.credit])).toEqual([[1_850_000n, 0n]]);
  });
  it("puts the instrument on the bank lines only", () => {
    const ls = journalLines(BANK, entries, { instrumentType: "CHEQUE", chequeNumber: " 008421 ", chequeDate: "2026-02-10" });
    for (const l of ls.filter((x) => x.isCashBankLine)) expect([l.instrumentType, l.chequeNumber, l.chequeDate]).toEqual(["CHEQUE", "008421", "2026-02-10"]);
    for (const l of ls.filter((x) => !x.isCashBankLine)) expect([l.instrumentType, l.chequeNumber, l.chequeDate]).toEqual([null, null, null]);
  });
  it("puts the bank's sub-ledger on the two bank lines only, never on the entries", () => {
    const ls = journalLines(BANK, [{ generalLedgerId: CUSTOMER, receipt: "5" }, { generalLedgerId: RENT, subLedgerId: 7, payment: "2" }], { bankSubLedgerId: 99 });
    expect(ls.filter((l) => l.isCashBankLine).map((l) => l.subLedgerId)).toEqual([99, 99]);
    expect(ls.filter((l) => !l.isCashBankLine).map((l) => l.subLedgerId)).toEqual([null, 7]);
    expect(journalLines(BANK, entries).filter((l) => l.isCashBankLine).every((l) => l.subLedgerId === null)).toBe(true);
  });
  it("keeps the sub-ledger and trims the narration of an entry", () => {
    const [l] = journalLines(BANK, [{ generalLedgerId: RENT, subLedgerId: 7, payment: "5", narration: "  rent  " }]);
    expect([l.subLedgerId, l.narration]).toEqual([7, "rent"]);
  });
  it("swapSides turns every debit into a credit: a reversal nets to nothing", () => {
    const ls = journalLines(BANK, entries);
    const back = swapSides(ls);
    ls.forEach((l, i) => { expect(back[i].debit).toBe(l.credit); expect(back[i].credit).toBe(l.debit); expect(back[i].generalLedgerId).toBe(l.generalLedgerId); });
    const both = sum([...ls, ...back]);
    expect(both.d).toBe(both.c);
    // per ledger the two vouchers cancel out
    for (const id of [BANK, CUSTOMER, RENT]) {
      const net = [...ls, ...back].filter((l) => l.generalLedgerId === id).reduce((a, l) => a + l.debit - l.credit, 0n);
      expect(net, `ledger ${id}`).toBe(0n);
    }
  });
});
