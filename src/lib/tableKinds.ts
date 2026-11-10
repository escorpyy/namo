// Excel's default ("General") alignment, by the kind of data a column holds. One place, so every table in the app lines up the same way.
//
//   text      -> left
//   number    -> right   (amounts, quantities, rates, percentages)
//   date      -> right   (Excel stores a date as a number, so it right-aligns too)
//   boolean   -> centre  (TRUE / FALSE, tick marks, on/off dots)
//   error     -> centre  (#N/A, #DIV/0! ...)
//
// Headers follow their column, so a number column's heading sits over its digits. Say the kind explicitly wherever you can: a code such
// as "00123" is text even though it looks like a number. `auto` guesses from the value, the way Excel's General format does.

export type ColKind = "text" | "number" | "date" | "boolean" | "error" | "auto";
export type Align = "left" | "right" | "center";
type Concrete = Exclude<ColKind, "auto">;

export const ALIGN_OF: Record<Concrete, Align> = { text: "left", number: "right", date: "right", boolean: "center", error: "center" };

// Whole class strings (not built from pieces) so Tailwind can see them. Right-aligned figures use tabular digits so decimals line up.
export const ALIGN_CLASS: Record<Align, string> = { left: "text-left", right: "text-right tabular-nums", center: "text-center" };

const ERROR_RE = /^#(N\/A|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|NULL!)$/i;
const NUMBER_RE = /^[+-]?\(?(\d{1,3}(,\d{2,3})+|\d+)(\.\d+)?\)?%?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** What Excel's General format would treat this value as. */
export function autoKind(value: unknown): Concrete {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number" || typeof value === "bigint") return Number.isNaN(value) ? "error" : "number";
  if (value instanceof Date) return "date";
  if (typeof value !== "string") return "text";
  const s = value.trim();
  if (s === "") return "text";
  if (ERROR_RE.test(s)) return "error";
  if (/^(TRUE|FALSE)$/i.test(s)) return "boolean";
  if (DATE_RE.test(s)) return "date";
  if (NUMBER_RE.test(s)) return "number";
  return "text";
}

export const resolveKind = (kind: ColKind | undefined, sample?: unknown): Concrete => (kind === "auto" ? autoKind(sample) : kind ?? "text");
export const alignOf = (kind: ColKind | undefined, sample?: unknown): Align => ALIGN_OF[resolveKind(kind, sample)];
export const alignClass = (kind: ColKind | undefined, sample?: unknown): string => ALIGN_CLASS[alignOf(kind, sample)];

// ---- row editing, as pure functions (the keyboard shortcuts of every grid go through these) ---------------------------------------

/**
 * Ctrl+D. One row selected: it takes the values of the row above it (like a single cell in Excel). Several rows: the top one is copied
 * down over the rest. Only `fields` are copied; anything else on the row (its key, links to other documents) stays as it was.
 * Returns null when nothing can change (first row, nothing selected, out of range).
 */
export function fillDownRows<T extends object>(rows: readonly T[], selected: readonly number[], fields: readonly (keyof T)[]): T[] | null {
  const idx = [...new Set(selected)].filter((i) => i >= 0 && i < rows.length).sort((a, b) => a - b);
  if (idx.length === 0) return null;
  const source = idx.length === 1 ? idx[0] - 1 : idx[0];
  const targets = idx.length === 1 ? idx : idx.slice(1);
  if (source < 0) return null;
  const from = rows[source];
  const set = new Set(targets);
  return rows.map((row, i) => {
    if (!set.has(i)) return row;
    const next = { ...row };
    for (const f of fields) next[f] = from[f];
    return next;
  });
}

/** Ctrl+D inside one cell: the cell takes the value of the same column one row up. Null when there is no row above. */
export function fillDownCell<T extends object>(rows: readonly T[], index: number, field: keyof T): T[] | null {
  if (index <= 0 || index >= rows.length) return null;
  return rows.map((row, i) => (i === index ? { ...row, [field]: rows[index - 1][field] } : row));
}

/** Delete on selected rows. Returns the remaining rows. */
export function removeRows<T>(rows: readonly T[], selected: readonly number[]): T[] {
  const gone = new Set(selected);
  return rows.filter((_, i) => !gone.has(i));
}

/** Which row should be selected after rows were removed: the one that moved into the gap, or the last one. -1 when the table is empty. */
export function selectionAfterRemove(remaining: number, removed: readonly number[]): number {
  if (remaining <= 0 || removed.length === 0) return remaining <= 0 ? -1 : 0;
  return Math.min(Math.min(...removed), remaining - 1);
}

/** Shift+click / Shift+arrow: every key between the anchor and the target, in table order. */
export function rangeKeys<K>(order: readonly K[], anchor: K, to: K): K[] {
  const a = order.indexOf(anchor), b = order.indexOf(to);
  if (a < 0 || b < 0) return b < 0 ? [] : [to];
  return order.slice(Math.min(a, b), Math.max(a, b) + 1);
}
