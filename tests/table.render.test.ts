import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DataTable, Td, Th, XlTable, type Column } from "../src/components/table/DataTable";

// <DataTable> and the hand-built <XlTable>/<Th>/<Td>, rendered to static HTML: the alignment of every kind of column, the gridline class,
// selection and row attributes the screens' shortcuts look for.

interface Bill { id: number; no: string; date: string; amount: string; posted: boolean }
const bills: Bill[] = [
  { id: 1, no: "PB-001", date: "2082-04-05", amount: "1,250.00", posted: true },
  { id: 2, no: "PB-002", date: "2082-04-06", amount: "90.50", posted: false },
];
const columns: Column<Bill>[] = [
  { key: "no", header: "Invoice", kind: "text" },
  { key: "date", header: "Date", kind: "date" },
  { key: "amount", header: "Amount", kind: "number", footer: "1,340.50" },
  { key: "posted", header: "Posted", kind: "boolean", render: (b) => (b.posted ? "✓" : "") },
];
const html = (props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(DataTable<Bill>, { columns, rows: bills, rowKey: (b: Bill) => b.id, label: "Bills", ...props }));

describe("DataTable", () => {
  it("draws the Excel-style grid and aligns every column by its kind, header and cells alike", () => {
    const out = html();
    expect(out).toContain('class="xl-table xl-sticky  "'); // gridlines + sticky header
    expect(out).toMatch(/<th[^>]*class="text-left [^"]*">Invoice<\/th>/);
    expect(out).toMatch(/<th[^>]*class="text-right tabular-nums [^"]*">Date<\/th>/);
    expect(out).toMatch(/<th[^>]*class="text-right tabular-nums [^"]*">Amount<\/th>/);
    expect(out).toMatch(/<th[^>]*class="text-center [^"]*">Posted<\/th>/);
    expect(out).toMatch(/<td class="text-left [^"]*">PB-001<\/td>/);
    expect(out).toMatch(/<td class="text-right tabular-nums [^"]*">2082-04-05<\/td>/);
    expect(out).toMatch(/<td class="text-right tabular-nums [^"]*">1,250.00<\/td>/);
    expect(out).toMatch(/<td class="text-center [^"]*">✓<\/td>/);
  });

  it("auto columns align by what each cell holds", () => {
    const out = renderToStaticMarkup(createElement(DataTable<Record<string, string>>, {
      columns: [{ key: "v", header: "Value", kind: "auto" }], rows: [{ id: "1", v: "1,000.00" }, { id: "2", v: "Customs duty" }, { id: "3", v: "TRUE" }],
      rowKey: (r: Record<string, string>) => r.id, label: "Mixed",
    }));
    expect(out).toMatch(/<td class="text-right tabular-nums [^"]*">1,000.00<\/td>/);
    expect(out).toMatch(/<td class="text-left [^"]*">Customs duty<\/td>/);
    expect(out).toMatch(/<td class="text-center [^"]*">TRUE<\/td>/);
  });

  it("gives every row the attributes the screens' shortcuts use, and marks the selected ones", () => {
    const out = html({ selected: new Set([2]) });
    expect(out).toMatch(/<tr[^>]*data-row="1"[^>]*aria-selected="false"/);
    expect(out).toMatch(/<tr[^>]*data-row="2"[^>]*aria-selected="true"/);
    expect(out).toContain('role="grid"');
  });

  it("puts the footer in a tfoot and says so when empty", () => {
    expect(html()).toContain("<tfoot>");
    expect(html()).toContain("1,340.50");
    expect(html({ rows: [], empty: "No bills" })).toContain("No bills");
    expect(html({ rows: [] })).not.toContain("data-row");
  });

  it("keeps column widths for a fixed layout", () => {
    const out = html({ fixed: true, columns: columns.map((c, i) => (i === 0 ? { ...c, width: "84px" } : c)) });
    expect(out).toContain("table-fixed");
    expect(out).toContain("width:84px");
  });
});

describe("XlTable, Th and Td (hand-built tables)", () => {
  it("give a hand-built table the same grid and the same alignment", () => {
    const out = renderToStaticMarkup(createElement(XlTable, null,
      createElement("thead", null, createElement("tr", null, createElement(Th, null, "Item"), createElement(Th, { kind: "number" }, "Qty"))),
      createElement("tbody", null, createElement("tr", null, createElement(Td, null, "Rice"), createElement(Td, { kind: "number" }, "10"), createElement(Td, { kind: "boolean" }, "✓"))),
    ));
    expect(out).toContain('class="xl-table  "');
    expect(out).toContain('<th class="text-left ">Item</th>');
    expect(out).toContain('<th class="text-right tabular-nums ">Qty</th>');
    expect(out).toContain('<td class="text-right tabular-nums ">10</td>');
    expect(out).toContain('<td class="text-center ">✓</td>');
  });
});
