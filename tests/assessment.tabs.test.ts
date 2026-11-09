import { describe, expect, it } from "vitest";
import {
  allocatedTotal, allocationsByTerm, buildMatrix, cents, centsText, ledgerCheck, manualGapCents, manualSeed,
  type LedgerCheckTerm, type LedgerInfo, type PreviewLineLike,
} from "../src/lib/assessmentTabs";

const lines: PreviewLineLike[] = [
  { id: 11, lineNumber: 1, productCode: "RICE", quantity: "10", goodsValue: "600.00", capitalizedSources: "30.00", existingPurchaseTermCosts: "0.00", capitalizedAssessments: "80.00", landedValue: "710.00", landedRate: "71.000000" },
  { id: 12, lineNumber: 2, productCode: "OIL", quantity: "5", goodsValue: "400.00", capitalizedSources: "20.00", existingPurchaseTermCosts: "0.00", capitalizedAssessments: "50.00", landedValue: "470.00", landedRate: "94.000000" },
];
// duty 150 (additive, stock) split 90/60; freight rebate 20 (deductive, stock) split 10/10; VAT 130 (additive, not stock)
const preview = {
  termResults: [{ termId: 1, key: 501 }, { termId: 2, key: 502 }, { termId: 3, key: 503 }],
  termAllocations: [
    { termKey: 501, lines: [{ lineId: 11, amount: "90.00" }, { lineId: 12, amount: "60.00" }] },
    { termKey: 502, lines: [{ lineId: 11, amount: "-10.00" }, { lineId: 12, amount: "-10.00" }] },
  ],
};
const duty = { formKey: "a", termId: "1", code: "DUTY", name: "Customs duty", nature: "ADDITIVE" as const, capitalizable: true, basis: "VALUE" as const, mode: "AUTO" as const, amount: 15000 };
const rebate = { formKey: "b", termId: "2", code: "REB", name: "Rebate", nature: "DEDUCTIVE" as const, capitalizable: true, basis: "VALUE" as const, mode: "AUTO" as const, amount: 2000 };
const vat = { formKey: "c", termId: "3", code: "VAT", name: "Import VAT", nature: "ADDITIVE" as const, capitalizable: false, basis: "VALUE" as const, mode: "AUTO" as const, amount: 13000 };

describe("paisa helpers", () => {
  it("round-trips decimal strings exactly, negatives included", () => {
    expect(cents("1250.05")).toBe(125005);
    expect(centsText(125005)).toBe("1250.05");
    expect(centsText(-5)).toBe("-0.05");
    expect(centsText(0)).toBe("0.00");
    expect(cents("garbage")).toBe(0);
  });
});

describe("allocationsByTerm", () => {
  it("maps the engine's term key back to the term and keeps signed paisa", () => {
    const a = allocationsByTerm(preview);
    expect(a.get("1")!.get(11)).toBe(9000);
    expect(a.get("2")!.get(12)).toBe(-1000);
    expect(a.has("3")).toBe(false); // a charge outside stock value has no product split
  });
  it("falls back to the saved allocation rows of an applied assessment", () => {
    const a = allocationsByTerm({ termResults: [{ termId: 1 }] }, [
      { termId: 1, purchaseBillLineId: 11, allocatedAmount: "90.00" }, { termId: 1, purchaseBillLineId: 12, allocatedAmount: "60.00" },
    ]);
    expect(allocatedTotal(a, "1")).toBe(15000);
  });
  it("totals a charge by magnitude", () => {
    expect(allocatedTotal(allocationsByTerm(preview), "2")).toBe(2000);
  });
});

describe("manual split helpers", () => {
  it("seeds every product with its automatic amount, positive, so switching to manual changes nothing", () => {
    const seed = manualSeed("2", allocationsByTerm(preview), [11, 12]);
    expect(seed).toEqual({ "11": "10.00", "12": "10.00" });
    expect(manualGapCents(2000, seed)).toBe(0);
  });
  it("reports how far typed amounts are from the charge", () => {
    expect(manualGapCents(15000, { "11": "90.00", "12": "55.00" })).toBe(500);
    expect(manualGapCents(15000, { "11": "100.00", "12": "60.00" })).toBe(-1000);
    expect(manualGapCents(15000, { "11": "", "12": "60.00" })).toBe(9000);
  });
});

describe("buildMatrix", () => {
  const m = buildMatrix(lines, [duty, rebate, vat], allocationsByTerm(preview));
  it("puts stock charges in columns and the rest in the other group", () => {
    expect(m.stockTerms.map((t) => t.code)).toEqual(["DUTY", "REB"]);
    expect(m.otherTerms.map((t) => t.code)).toEqual(["VAT"]);
  });
  it("totals tie to the lines and the landed value is goods + linked + charges", () => {
    expect(m.totals.goods).toBe(100000);
    expect(m.totals.cells.get("1")).toBe(15000);
    expect(m.totals.cells.get("2")).toBe(-2000);
    expect(m.totals.linked).toBe(5000);
    expect(m.totals.landed).toBe(118000);
    expect(m.totals.goods + m.totals.linked + m.totals.cells.get("1")! + m.totals.cells.get("2")!).toBe(m.totals.landed);
    expect(m.hasLinked).toBe(true);
  });
});

const ledgers: LedgerInfo[] = [
  { id: 1, code: "DUTYEXP", name: "Duty ledger", requiresSubLedger: false },
  { id: 2, code: "REBATE", name: "Rebate ledger", requiresSubLedger: false },
  { id: 3, code: "VATIN", name: "Import VAT", requiresSubLedger: false },
  { id: 9, code: "CUSTOMS", name: "Customs payable", requiresSubLedger: false },
  { id: 10, code: "AGENT", name: "Clearing agent", requiresSubLedger: true },
];
const withLedgers = (t: typeof duty, own: number, against: number | null, sub: number | null = null): LedgerCheckTerm => ({ ...t, ownLedgerId: own, againstLedgerId: against, againstSubLedgerId: sub });
const totals = { goods: 100000, services: 5000, earlier: 0, assessed: 13000, landed: 118000, lineLanded: 118000, lineAssessed: 13000 };

describe("ledgerCheck", () => {
  const alloc = allocationsByTerm(preview);
  it("posts Dr own / Cr against for an addition and swaps a deduction, and balances", () => {
    const r = ledgerCheck([withLedgers(duty, 1, 9), withLedgers(rebate, 2, 9), withLedgers(vat, 3, 9)], ledgers, alloc, totals);
    const row = (id: number) => r.rows.find((x) => x.ledgerId === id)!;
    expect(row(1)).toMatchObject({ dr: 15000, cr: 0 });
    expect(row(2)).toMatchObject({ dr: 0, cr: 2000 });
    expect(row(3)).toMatchObject({ dr: 13000, cr: 0 });
    expect(row(9)).toMatchObject({ dr: 2000, cr: 28000 });
    expect(r.dr).toBe(r.cr);
    expect(r.dr).toBe(30000);
    expect(r.notInStock).toBe(13000);
    expect(r.checks.every((c) => c.ok)).toBe(true);
    expect(row(9).lines).toHaveLength(3); // charge-wise detail behind the ledger row
  });
  it("flags a charge with no against ledger, and a ledger that needs a sub-ledger", () => {
    const r = ledgerCheck([withLedgers(duty, 1, null), withLedgers(rebate, 2, 10)], ledgers, alloc, totals);
    const set = r.checks.find((c) => c.id === "ledger-set")!;
    expect(set.ok).toBe(false);
    expect(set.detail).toContain("DUTY");
    expect(set.detail).toContain("REB");
  });
  it("flags a stock charge whose product amounts do not add up", () => {
    const short = { ...duty, amount: 16000 };
    const r = ledgerCheck([withLedgers(short, 1, 9)], ledgers, alloc, totals);
    const c = r.checks.find((x) => x.id === "ledger-split")!;
    expect(c.ok).toBe(false);
    expect(c.detail).toBe("DUTY");
  });
  it("flags landed value that does not tie to its parts", () => {
    const r = ledgerCheck([withLedgers(duty, 1, 9)], ledgers, alloc, { ...totals, landed: 117999 });
    expect(r.checks.find((x) => x.id === "ledger-landed")!.ok).toBe(false);
  });
  it("skips a charge that came to zero", () => {
    const r = ledgerCheck([withLedgers({ ...duty, amount: 0 }, 1, null)], ledgers, alloc, totals);
    expect(r.rows).toHaveLength(0);
    expect(r.checks.find((c) => c.id === "ledger-set")!.ok).toBe(true);
  });
});
