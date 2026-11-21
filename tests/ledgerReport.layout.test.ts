import { describe, expect, it } from "vitest";
import { addDay, amount, balanceOf, buildBlocks, csvCell, fmtMinor, minor, monthsOf, pickInitialMonth, todayLocal, voucherRef } from "../src/lib/ledgerReportLayout";
import { buildLedgerGroupTree, firstLedgerGroupRow } from "../src/lib/ledgerReportGrouping";
import type { LedgerReportRow, LedgerReportSummary } from "../src/api";

const FY_START = "2025-07-17", FY_END = "2026-07-16"; // FY 2082/083: Shrawan 1, 2082 to Ashadh 32, 2083

describe("ledger report months", () => {
  it("names BS months and covers the fiscal year without gaps or overlaps", () => {
    const months = monthsOf(FY_START, FY_END, "BS");
    expect(months.map((m) => m.label)).toEqual(["Shrawan 2082", "Bhadra 2082", "Ashwin 2082", "Kartik 2082", "Mangsir 2082", "Poush 2082", "Magh 2082", "Falgun 2082", "Chaitra 2082", "Baisakh 2083", "Jestha 2083", "Ashadh 2083"]);
    expect(months[0].from).toBe(FY_START);
    expect(months[months.length - 1].to).toBe(FY_END);
    for (let i = 1; i < months.length; i++) expect(months[i].from).toBe(addDay(months[i - 1].to, 1));
  });
  it("names AD months, clipping the first and last to the fiscal year", () => {
    const months = monthsOf(FY_START, FY_END, "AD");
    expect(months[0]).toEqual({ from: "2025-07-17", to: "2025-07-31", label: "July 2025" });
    expect(months[1].label).toBe("August 2025");
    expect(months[months.length - 1]).toEqual({ from: "2026-07-01", to: "2026-07-16", label: "July 2026" });
    expect(months).toHaveLength(13);
  });
  it("returns nothing for an empty fiscal year", () => {
    expect(monthsOf("", "", "AD")).toEqual([]);
  });
  it("opens on the month that holds today, else the nearest end of the year", () => {
    const months = monthsOf(FY_START, FY_END, "BS");
    expect(pickInitialMonth(months, "2025-09-20")?.label).toBe("Ashwin 2082");
    expect(pickInitialMonth(months, "2025-01-01")?.label).toBe("Shrawan 2082");
    expect(pickInitialMonth(months, "2027-01-01")?.label).toBe("Ashadh 2083");
    expect(pickInitialMonth([], "2025-09-20")).toBeUndefined();
  });
  it("reads today in local time, not UTC", () => {
    expect(todayLocal(new Date(2026, 0, 5, 0, 30))).toBe("2026-01-05");
  });
});

describe("ledger report balances", () => {
  it("does money in whole paisa with Indian grouping", () => {
    expect(minor("1234.567")).toBe(123457n);
    expect(minor("-0.5")).toBe(-50n);
    expect(minor("")).toBe(0n);
    expect(fmtMinor(12345678n)).toBe("1,23,456.78");
    expect(fmtMinor(-5n)).toBe("-0.05");
  });
  it("shows ledger amounts with two decimals", () => {
    expect(amount("250.000000")).toBe("250.00");
    expect(amount("1234567.5")).toBe("12,34,567.50");
  });
  it("shows a balance on one side", () => {
    expect(balanceOf(150000n)).toBe("1,500.00 Dr");
    expect(balanceOf(-150000n)).toBe("1,500.00 Cr");
    expect(balanceOf(0n)).toBe("0.00 Dr");
  });
});

const line = (n: number, gl: number, debit: string, credit: string, running: string, posted = true): LedgerReportRow => ({
  lineId: n, voucherId: n, generalLedgerId: gl, subLedgerId: null, d: "2025-08-01", voucherNumber: `JV-${n}`, kind: "JOURNAL", voucherLabel: "Journal voucher",
  posted, postedAt: null, postedBy: null, postedByName: null, remarks: null, narration: null, reference: null, reversalOfId: null, hasReversal: false,
  ledgerCode: gl === 1 ? "1010" : "2020", ledgerName: gl === 1 ? "Cash" : "Creditors",
  accountSubGroupId: gl, accountSubGroupCode: gl === 1 ? "10" : "20", accountSubGroupName: gl === 1 ? "Current assets" : "Payables",
  accountGroupId: gl, accountGroupCode: gl === 1 ? "1" : "2", accountGroupName: gl === 1 ? "Assets" : "Liabilities",
  agentId: null, agentCode: null, agentName: null, areaId: null, areaCode: null, areaName: null, subAreaId: null, subAreaCode: null, subAreaName: null,
  invoiceAgentId: null, invoiceAgentCode: null, invoiceAgentName: null,
  subLedgerCode: null, subLedgerName: null, debit, credit,
  sourceNumber: `JV-${n}`, sourceLabel: "Journal voucher", sourceScreen: "journal", sourceId: n, products: [], productIds: [], running, total: 0,
});
const sum = (gl: number, opening: string, debit: string, credit: string, closing: string): LedgerReportSummary => ({
  generalLedgerId: gl, code: gl === 1 ? "1010" : "2020", name: gl === 1 ? "Cash" : "Creditors",
  accountSubGroupId: gl, accountSubGroupCode: gl === 1 ? "10" : "20", accountSubGroupName: gl === 1 ? "Current assets" : "Payables",
  accountGroupId: gl, accountGroupCode: gl === 1 ? "1" : "2", accountGroupName: gl === 1 ? "Assets" : "Liabilities",
  agentId: null, agentCode: null, agentName: null, areaId: null, areaCode: null, areaName: null, subAreaId: null, subAreaCode: null, subAreaName: null,
  opening, debit, credit, closing,
});

describe("ledger report grouping", () => {
  it("builds the selected hierarchy in order and keeps rows under the right account group", () => {
    const rows = [line(1, 1, "1", "0", "1"), line(2, 2, "0", "1", "-1"), line(3, 1, "2", "0", "3")];
    const tree = buildLedgerGroupTree(rows, ["accountGroup", "accountSubGroup"], monthsOf(FY_START, FY_END, "BS"));
    expect(tree.map((group) => group.label)).toEqual(["1 — Assets", "2 — Liabilities"]);
    expect(tree[0].children[0].rows.map((row) => row.lineId)).toEqual([1, 3]);
    expect(tree[1].children[0].rows.map((row) => row.lineId)).toEqual([2]);
  });

  it("finds the first row in the displayed group order", () => {
    const rows = [line(1, 2, "0", "1", "-1"), line(2, 1, "1", "0", "1")];
    const tree = buildLedgerGroupTree(rows, ["accountGroup"], monthsOf(FY_START, FY_END, "BS"));
    expect(firstLedgerGroupRow(tree)?.lineId).toBe(2);
  });

  it("places missing dimensions in a visible Unassigned group", () => {
    const tree = buildLedgerGroupTree([line(1, 1, "1", "0", "1")], ["agent"], monthsOf(FY_START, FY_END, "BS"));
    expect(tree[0].label).toBe("Unassigned");
  });

  it("groups invoice agents separately from the shared Agent dimension", () => {
    const row = { ...line(1, 1, "1", "0", "1"), invoiceAgentId: 7, invoiceAgentCode: "AG7", invoiceAgentName: "Sales Agent" };
    const tree = buildLedgerGroupTree([row], ["invoiceAgent"], monthsOf(FY_START, FY_END, "BS"));
    expect(tree[0].label).toBe("AG7 — Sales Agent");
  });

  it("uses fiscal-calendar month labels for transaction grouping", () => {
    const rows = [line(1, 1, "1", "0", "1"), line(2, 1, "1", "0", "2")];
    rows[0].d = "2025-08-18";
    rows[1].d = "2025-07-18";
    const tree = buildLedgerGroupTree(rows, ["month"], monthsOf(FY_START, FY_END, "BS"));
    expect(tree.map((group) => group.label)).toEqual(["Shrawan 2082", "Bhadra 2082"]);
  });
});

describe("ledger report blocks", () => {
  const summary = [sum(1, "1000.00", "500.00", "200.00", "1300.00"), sum(2, "-50.00", "0.00", "25.00", "-75.00")];

  it("wraps a single ledger page in opening and closing rows", () => {
    const rows = [line(1, 1, "500.00", "0", "1500.00"), line(2, 1, "0", "200.00", "1300.00")];
    const [b] = buildBlocks({ rows, summary, page: 1, pageCount: 1, ledgerIds: [1] });
    expect(b.start).toEqual({ label: "Opening balance", balance: 100000n });
    expect(b.end).toEqual({ kind: "closing", label: "Closing balance", debit: 50000n, credit: 20000n, balance: 130000n });
  });
  it("keeps a chosen ledger visible when it has no lines in the period", () => {
    const blocks = buildBlocks({ rows: [], summary, page: 1, pageCount: 1, ledgerIds: [2] });
    expect(blocks).toHaveLength(1);
    expect(blocks[0].rows).toEqual([]);
    expect(blocks[0].start?.balance).toBe(-5000n);
    expect(blocks[0].end?.balance).toBe(-7500n);
  });
  it("shows nothing for an empty all-ledgers query", () => {
    expect(buildBlocks({ rows: [], summary, page: 1, pageCount: 1, ledgerIds: [] })).toEqual([]);
  });
  it("carries a ledger forward when it continues on the next page, then brings it forward", () => {
    const first = buildBlocks({ rows: [line(1, 1, "500.00", "0", "1500.00")], summary, page: 1, pageCount: 2, ledgerIds: [1] })[0];
    expect(first.start?.label).toBe("Opening balance");
    expect(first.end).toMatchObject({ kind: "carry", label: "Carried forward", balance: 150000n });
    const next = buildBlocks({ rows: [line(2, 1, "0", "200.00", "1300.00")], summary, page: 2, pageCount: 2, ledgerIds: [1] })[0];
    expect(next.start).toEqual({ label: "Brought forward", balance: 150000n });
    expect(next.end?.kind).toBe("closing");
  });
  it("closes every ledger but the last one on a page that has more pages", () => {
    const rows = [line(1, 1, "500.00", "0", "1500.00"), line(2, 1, "0", "200.00", "1300.00"), line(3, 2, "0", "25.00", "-75.00")];
    const [a, b] = buildBlocks({ rows, summary, page: 1, pageCount: 2, ledgerIds: [] });
    expect(a.end?.kind).toBe("closing");
    expect(b.end?.kind).toBe("carry");
    expect(b.start).toEqual({ label: "Opening balance", balance: -5000n });
  });
  it("labels a ledger that starts a later page as its opening balance", () => {
    const rows = [line(3, 2, "0", "25.00", "-75.00")];
    const [b] = buildBlocks({ rows, summary, page: 2, pageCount: 2, ledgerIds: [] });
    expect(b.start).toEqual({ label: "Opening balance", balance: -5000n });
  });
  it("ignores draft lines when working out the balance before a page", () => {
    const rows = [line(2, 1, "900.00", "0", "1500.00", false)];
    const [b] = buildBlocks({ rows, summary, page: 2, pageCount: 2, ledgerIds: [1] });
    expect(b.start).toEqual({ label: "Brought forward", balance: 150000n });
  });
});

describe("ledger report CSV", () => {
  it("quotes cells", () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(null)).toBe('""');
  });
  it("keeps spreadsheet formulas in text columns from running", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(csvCell("+91 98")).toBe(`"'+91 98"`);
    expect(csvCell("@SUM(A1)")).toBe(`"'@SUM(A1)"`);
  });
  it("leaves numbers alone, negative ones included", () => {
    expect(csvCell("-1500.00", "number")).toBe('"-1500.00"');
  });
});

describe("ledger report voucher label", () => {
  it("joins the module name and the voucher number", () => {
    expect(voucherRef({ sourceLabel: "Sales invoice", sourceNumber: "001", voucherNumber: "JV-9" })).toBe("Sales Bill ## 001");
    expect(voucherRef({ sourceLabel: "Purchase bill", sourceNumber: "PB-12", voucherNumber: "JV-3" })).toBe("Purchase Bill ## PB-12");
    expect(voucherRef({ sourceLabel: "Cash / bank voucher", sourceNumber: "CB-5", voucherNumber: "CB-5" })).toBe("Cash/Bank ## CB-5");
  });
  it("falls back to the voucher number and to the raw label for an unknown module", () => {
    expect(voucherRef({ sourceLabel: "Journal voucher", sourceNumber: "", voucherNumber: "JV-7" })).toBe("Journal ## JV-7");
    expect(voucherRef({ sourceLabel: "Stock transfer", sourceNumber: "ST-1", voucherNumber: "x" })).toBe("Stock transfer ## ST-1");
  });
});
