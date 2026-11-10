import { describe, expect, it } from "vitest";
import { alignClass, alignOf, autoKind, fillDownCell, fillDownRows, rangeKeys, removeRows, selectionAfterRemove } from "../src/lib/tableKinds";

// Excel's General alignment, and the pure parts of the row shortcuts (Delete, Ctrl+D) that every grid in the app goes through.

describe("alignment follows the kind of data, like Excel", () => {
  it("text left, numbers and dates right, booleans and errors centred", () => {
    expect(alignOf("text")).toBe("left");
    expect(alignOf("number")).toBe("right");
    expect(alignOf("date")).toBe("right"); // Excel keeps a date as a number
    expect(alignOf("boolean")).toBe("center");
    expect(alignOf("error")).toBe("center");
    expect(alignOf(undefined)).toBe("left");
  });

  it("right-aligned figures use tabular digits so decimals line up", () => {
    expect(alignClass("number")).toBe("text-right tabular-nums");
    expect(alignClass("text")).toBe("text-left");
    expect(alignClass("boolean")).toBe("text-center");
  });

  it("auto guesses the way the General format does", () => {
    expect(autoKind(12)).toBe("number");
    expect(autoKind("1,23,456.50")).toBe("number");
    expect(autoKind("-42")).toBe("number");
    expect(autoKind("12.5%")).toBe("number");
    expect(autoKind("2082-04-05")).toBe("date");
    expect(autoKind(true)).toBe("boolean");
    expect(autoKind("TRUE")).toBe("boolean");
    expect(autoKind("false")).toBe("boolean");
    expect(autoKind("#DIV/0!")).toBe("error");
    expect(autoKind(Number.NaN)).toBe("error");
    expect(autoKind("Rice 25kg")).toBe("text");
    expect(autoKind("")).toBe("text");
    expect(autoKind(null)).toBe("text");
    expect(alignOf("auto", "1,000.00")).toBe("right");
    expect(alignOf("auto", "Customs duty")).toBe("left");
  });
});

interface R { key: string; id?: number; name: string; qty: string; link: string }
const rows: R[] = [
  { key: "a", id: 1, name: "Rice", qty: "10", link: "Order line 1" },
  { key: "b", id: 2, name: "", qty: "", link: "Order line 2" },
  { key: "c", name: "Oil", qty: "5", link: "" },
];

describe("Ctrl+D (fill down)", () => {
  it("one row selected: it takes the listed fields of the row above, and nothing else", () => {
    const out = fillDownRows(rows, [1], ["name", "qty"])!;
    expect(out[1]).toEqual({ key: "b", id: 2, name: "Rice", qty: "10", link: "Order line 2" }); // key, id and the link stay
    expect(out[0]).toBe(rows[0]);
    expect(out[2]).toBe(rows[2]);
    expect(rows[1].name).toBe(""); // the input is not changed
  });

  it("several rows selected: the top one is copied down over the rest", () => {
    const out = fillDownRows(rows, [0, 1, 2], ["name", "qty"])!;
    expect(out.map((r) => r.name)).toEqual(["Rice", "Rice", "Rice"]);
    expect(out.map((r) => r.key)).toEqual(["a", "b", "c"]);
  });

  it("does nothing on the first row, with no selection, or out of range", () => {
    expect(fillDownRows(rows, [0], ["name"])).toBeNull();
    expect(fillDownRows(rows, [], ["name"])).toBeNull();
    expect(fillDownRows(rows, [9], ["name"])).toBeNull();
  });

  it("one cell takes the value of the cell above", () => {
    expect(fillDownCell(rows, 2, "qty")![2].qty).toBe("");
    expect(fillDownCell(rows, 1, "qty")![1].qty).toBe("10");
    expect(fillDownCell(rows, 0, "qty")).toBeNull();
  });
});

describe("Delete and selection", () => {
  it("removes the selected rows", () => {
    expect(removeRows(rows, [1]).map((r) => r.key)).toEqual(["a", "c"]);
    expect(removeRows(rows, [0, 2]).map((r) => r.key)).toEqual(["b"]);
    expect(removeRows(rows, [])).toHaveLength(3);
  });

  it("selects the row that moved into the gap, or the last one", () => {
    expect(selectionAfterRemove(2, [1])).toBe(1);
    expect(selectionAfterRemove(2, [2])).toBe(1);
    expect(selectionAfterRemove(1, [0, 1])).toBe(0);
    expect(selectionAfterRemove(0, [0])).toBe(-1);
  });

  it("a range runs from the anchor to the target, in table order, in either direction", () => {
    const order = ["a", "b", "c", "d"];
    expect(rangeKeys(order, "b", "d")).toEqual(["b", "c", "d"]);
    expect(rangeKeys(order, "d", "b")).toEqual(["b", "c", "d"]);
    expect(rangeKeys(order, "c", "c")).toEqual(["c"]);
    expect(rangeKeys(order, "zz", "c")).toEqual(["c"]);
  });
});
