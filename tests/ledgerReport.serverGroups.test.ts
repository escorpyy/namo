import { describe, expect, it } from "vitest";
import { buildServerGroupTree, groupTotalOf } from "../src/lib/ledgerReportGrouping";
import type { LedgerReportGroupTotal, LedgerReportRow } from "../src/api";

const row = (lineId: number, keys: (string | null)[], labels: string[]) => ({ lineId, groupKeys: keys, groupLabels: labels }) as unknown as LedgerReportRow;
const noMonth = () => undefined;

describe("server-grouped Lines view", () => {
  it("keeps the server's order instead of re-sorting groups", () => {
    // Server order: "20" before "10" on purpose (a different collation); the tree must not reorder it.
    const rows = [row(1, ["20"], ["20 — Liabilities"]), row(2, ["20"], ["20 — Liabilities"]), row(3, ["10"], ["10 — Assets"])];
    const tree = buildServerGroupTree(rows, ["accountGroup"], noMonth);
    expect(tree.map((n) => n.label)).toEqual(["20 — Liabilities", "10 — Assets"]);
    expect(tree[0].rows.map((r) => r.lineId)).toEqual([1, 2]);
  });

  it("builds a two-level path and shows a null key as Unassigned", () => {
    const rows = [row(1, ["10", "5"], ["Assets", "Agent A"]), row(2, ["10", null], ["Assets", "Unassigned"])];
    const tree = buildServerGroupTree(rows, ["accountGroup", "agent"], noMonth);
    expect(tree[0].path).toEqual(["10"]);
    expect(tree[0].children.map((c) => c.label)).toEqual(["Agent A", "Unassigned"]);
    expect(tree[0].children[1].path).toEqual(["10", null]);
  });

  it("labels month groups from the client's own calendar", () => {
    const rows = [row(1, ["2025-08-17"], ["2025-08-17"])];
    const tree = buildServerGroupTree(rows, ["month"], (k) => (k === "2025-08-17" ? "Bhadra 2082" : undefined));
    expect(tree[0].label).toBe("Bhadra 2082");
  });

  it("sums exact server totals for a parent from every deeper entry, regardless of the page", () => {
    const totals: LedgerReportGroupTotal[] = [
      { keys: ["10", "5"], debit: "100.500000", credit: "0", count: 3 },
      { keys: ["10", null], debit: "40.250000", credit: "10.000000", count: 2 },
      { keys: ["20", "5"], debit: "9.000000", credit: "0", count: 1 },
    ];
    const tree = buildServerGroupTree([row(1, ["10", "5"], ["A", "B"])], ["accountGroup", "agent"], noMonth);
    // Only one line is on this page, but the subtotal covers the whole report.
    expect(groupTotalOf(tree[0], totals)).toEqual({ debit: 14075n, credit: 1000n, count: 5 });
    expect(groupTotalOf(tree[0].children[0], totals)).toEqual({ debit: 10050n, credit: 0n, count: 3 });
    expect(groupTotalOf(tree[0], undefined)).toBeNull();
  });

  it("returns nothing for a group the server did not total, so the screen falls back to the page sum", () => {
    const tree = buildServerGroupTree([row(1, ["99"], ["X"])], ["accountGroup"], noMonth);
    expect(groupTotalOf(tree[0], [{ keys: ["10"], debit: "1", credit: "0", count: 1 }])).toBeNull();
  });
});
