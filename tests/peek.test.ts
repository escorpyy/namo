import { describe, expect, it } from "vitest";
import { cashBankPeekRows, journalPeekRows, netOfBalance, netText, pendingNet } from "../src/lib/peek";
import { blankJLine } from "../src/lib/journalForm";
import { journalLines } from "../shared/cashBankVoucher";

// The rules behind the account panel's "This voucher / After this voucher" lines.
describe("account panel rules", () => {
  it("reads a balance as one signed figure and writes it as Dr / Cr", () => {
    expect(netOfBalance({ debit: "500.00", credit: "0.00" })).toBe(50_000n);
    expect(netOfBalance({ debit: "0.00", credit: "120.50" })).toBe(-12_050n);
    expect(netText(50_000n)).toBe("NPR 500.00 Dr");
    expect(netText(-12_050n)).toBe("NPR 120.50 Cr");
    expect(netText(0n)).toBe("NPR 0.00");
    expect(netText(128_450_000n)).toBe("NPR 12,84,500.00 Dr");
  });

  it("journal lines: a ledger target takes all its lines, a party target only that party's", () => {
    const rows = journalPeekRows([
      blankJLine({ glId: "7", subId: "1", debit: "100.00" }),
      blankJLine({ glId: "7", subId: "2", debit: "40" }),
      blankJLine({ glId: "7", subId: "2", credit: "15.25" }),
      blankJLine({ glId: "9", credit: "124.75" }),
      blankJLine({}), // not started: no ledger, no effect
    ]);
    expect(pendingNet({ glId: 7, subId: null }, rows)).toBe(10_000n + 4_000n - 1_525n);
    expect(pendingNet({ glId: 7, subId: 2 }, rows)).toBe(4_000n - 1_525n);
    expect(pendingNet({ glId: 7, subId: 1 }, rows)).toBe(10_000n);
    expect(pendingNet({ glId: 9, subId: null }, rows)).toBe(-12_475n);
    expect(pendingNet({ glId: 5, subId: null }, rows)).toBe(0n);
  });

  it("reads a half-typed amount (\"12.\") as 12 and an unreadable one as nothing", () => {
    const rows = journalPeekRows([blankJLine({ glId: "3", debit: "12." }), blankJLine({ glId: "3", credit: "1,5" })]);
    expect(pendingNet({ glId: 3, subId: null }, rows)).toBe(1_200n);
  });

  it("cash / bank: a receipt credits its account, a payment debits it, the bank takes the totals the other way", () => {
    const lines = [
      { generalLedgerId: "20", subLedgerId: "5", receipt: "300.00", payment: "" },   // money came in from party 5
      { generalLedgerId: "20", subLedgerId: "6", receipt: "", payment: "50" },       // money went out to party 6
      { generalLedgerId: "21", subLedgerId: "", receipt: "", payment: "10.5" },
      { generalLedgerId: "", subLedgerId: "", receipt: "", payment: "" },            // blank row
    ];
    const rows = cashBankPeekRows("99", "", lines);
    expect(pendingNet({ glId: 20, subId: 5 }, rows)).toBe(-30_000n);   // Cr 300.00
    expect(pendingNet({ glId: 20, subId: 6 }, rows)).toBe(5_000n);     // Dr 50.00
    expect(pendingNet({ glId: 20, subId: null }, rows)).toBe(-25_000n);
    expect(pendingNet({ glId: 21, subId: null }, rows)).toBe(1_050n);
    expect(pendingNet({ glId: 99, subId: null }, rows)).toBe(30_000n - 6_050n); // Dr receipts, Cr payments
  });

  it("cash / bank: the panel's rows agree with the lines the server will store", () => {
    const entries = [
      { generalLedgerId: 20, subLedgerId: 5, receipt: "300.00", payment: "" },
      { generalLedgerId: 20, subLedgerId: 6, receipt: "", payment: "50" },
      { generalLedgerId: 21, subLedgerId: null, receipt: "", payment: "10.5" },
    ];
    const stored = journalLines(99, entries, { bankSubLedgerId: 4 });
    const rows = cashBankPeekRows("99", "4", entries.map((e) => ({ generalLedgerId: String(e.generalLedgerId), subLedgerId: e.subLedgerId ? String(e.subLedgerId) : "", receipt: e.receipt, payment: e.payment })));
    const net = (xs: { glId: number; subId: number | null; dr: bigint; cr: bigint }[], gl: number, sub: number | null) => pendingNet({ glId: gl, subId: sub }, xs);
    const storedRows = stored.map((l) => ({ glId: l.generalLedgerId, subId: l.subLedgerId, dr: l.debit, cr: l.credit }));
    for (const [gl, sub] of [[20, null], [20, 5], [20, 6], [21, null], [99, null], [99, 4]] as [number, number | null][]) expect(net(rows, gl, sub)).toBe(net(storedRows, gl, sub));
  });
});
