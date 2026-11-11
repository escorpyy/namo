import { useRef, useState, type FocusEvent, type KeyboardEvent } from "react";

// The keyboard flow of every editable grid made of CSS-grid rows or a <table> (purchase bill lines, billing terms, import-cost charges,
// the lines of a master, opening stock ...). One hook, so every grid behaves the same.
//
// ROW MODE: the grid itself has focus and one whole row is highlighted.
//   ↑ ↓ Home End move between rows · Enter edits the row · Shift+Enter leaves the grid backwards · Delete removes the row · Ctrl+D copies the row above.
// CELL MODE: focus is inside a cell of the row.
//   Enter / Shift+Enter walk the cells · ↑ ↓ move to the same cell of the row above / below · Esc goes back to row mode ·
//   Shift+Delete removes the row (plain Delete still deletes text) · Ctrl+D copies the cell above.
// Walking past the last cell of the last filled row adds a row (when the screen gives onAddRow); past the end otherwise it leaves the grid.
// Click the row number (rowHeadProps) to select a row, like the row header in Excel.
//
// The hook only moves focus and keeps the selected row; changing the rows is up to the screen (onRemove / onFillRow / onFillCell / onAddRow).

export interface GridRowsOptions {
  count: number;
  readOnly?: boolean;
  /** the first editable cell of row r, to start editing it with Enter */
  firstCell: (grid: HTMLElement, r: number) => HTMLElement | null;
  /** which row and column a focused cell belongs to (from its data-field), or null if it is not a cell */
  cellOf: (el: HTMLElement) => { row: number; col: string } | null;
  /** fromRowMode: Delete in row mode (the grid keeps focus) as opposed to Shift+Delete in a cell */
  onRemove: (row: number, fromRowMode: boolean) => void;
  onFillRow: (row: number) => void;
  onFillCell: (row: number, col: string) => void;

  // ---- cell flow (Enter / arrows). Leave cellSelector out for a grid that only needs row mode.
  /** CSS selector of the grid's cells, e.g. '[data-field^="L."]' */
  cellSelector?: string;
  /** the data-field of a cell, for ↑ ↓ (same column, next row) */
  fieldOf?: (row: number, col: string) => string;
  /** "row": Enter at the end of a row lands on the next row in ROW MODE (lines of a bill). "continue": straight into the next row's first cell. */
  endOfRow?: "row" | "continue";
  /** Enter walked past the last cell of the last row: add a row and start editing it */
  onAddRow?: () => void;
  /** the last row is still empty, so there is no point adding another */
  lastRowBlank?: () => boolean;
  /** leave the grid (the screen's own field order) when there is nothing further inside it */
  leave?: (el: HTMLElement, dir: 1 | -1) => unknown;
  /** a cell that does something of its own on Enter (a dialog): return true when handled */
  onCellEnter?: (cell: { row: number; col: string }, el: HTMLElement) => boolean;
}

const usable = (el: HTMLElement) => !(el as HTMLInputElement).disabled && el.getClientRects().length > 0;
const reveal = (el: HTMLElement) => { el.focus(); el.scrollIntoView({ block: "nearest", inline: "nearest" }); };

export function useGridRows(o: GridRowsOptions) {
  const [rowSel, setRowSel] = useState<number | null>(null);
  const last = useRef(0);
  const clamp = (r: number) => Math.max(0, Math.min(o.count - 1, r));
  const enterRow = (grid: HTMLElement | null, r: number) => {
    if (!grid || o.count === 0) return;
    last.current = clamp(r); setRowSel(last.current); grid.focus();
    grid.querySelector(`[data-row="${last.current}"]`)?.scrollIntoView({ block: "nearest" });
  };
  const cellsOf = (grid: HTMLElement | null) => (grid && o.cellSelector ? Array.from(grid.querySelectorAll<HTMLElement>(o.cellSelector)).filter(usable) : []);
  const rowOfEl = (el: HTMLElement) => o.cellOf(el)?.row ?? -1;

  /** Enter (dir 1) / Shift+Enter (dir -1) from a cell; also what a picker calls when it commits. */
  const stepFrom = (el: HTMLElement, dir: 1 | -1 = 1) => {
    const grid = el.closest<HTMLElement>("[data-grid]"), all = cellsOf(grid), next = all[all.indexOf(el) + dir], r = rowOfEl(el);
    const rowMode = (o.endOfRow ?? "continue") === "row";
    if (dir === -1) {
      if (rowMode) { if (!next || rowOfEl(next) !== r) enterRow(grid, r); else reveal(next); }
      else if (next) reveal(next);
      else o.leave?.(el, -1);
      return;
    }
    if (next) { if (rowMode && rowOfEl(next) !== r) enterRow(grid, rowOfEl(next)); else reveal(next); }
    else if (!o.readOnly && o.onAddRow && !o.lastRowBlank?.()) o.onAddRow();
    else o.leave?.(el, 1);
  };

  /** true when the key was used */
  const handleKey = (e: KeyboardEvent<HTMLElement>): boolean => {
    const el = e.target as HTMLElement, grid = e.currentTarget, ctrl = e.ctrlKey || e.metaKey, isD = e.key.toLowerCase() === "d" && ctrl && !e.shiftKey && !e.altKey;
    const use = () => { e.preventDefault(); e.stopPropagation(); return true; };
    if (el === grid) { // ROW MODE
      if (o.count === 0) return false;
      const r = clamp(rowSel ?? last.current);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { enterRow(grid, r + (e.key === "ArrowDown" ? 1 : -1)); return use(); }
      if (e.key === "Home" || e.key === "End") { enterRow(grid, e.key === "Home" ? 0 : o.count - 1); return use(); }
      if (e.key === "Enter") {
        if (e.shiftKey) { if (o.leave) { o.leave(grid, -1); return use(); } return false; }
        const c = o.firstCell(grid, r); if (c) reveal(c); return use();
      }
      if (o.readOnly) return false;
      if (e.key === "Delete" && !ctrl && !e.altKey) { o.onRemove(r, true); last.current = clamp(Math.min(r, o.count - 2)); setRowSel(last.current); return use(); }
      if (isD) { o.onFillRow(r); return use(); }
      return false;
    }
    const cell = o.cellOf(el);
    if (!cell) return false;
    const isCombo = el.getAttribute("role") === "combobox";
    if (e.key === "Escape") { enterRow(grid, cell.row); return use(); }
    if (e.key === "Enter" && o.cellSelector && !isCombo && !(el instanceof HTMLTextAreaElement)) {
      if (!e.shiftKey && o.onCellEnter?.(cell, el)) return use();
      // Actionable cells (buttons): Enter activates them; readonly inputs are skipped by usable().
      if (!e.shiftKey && el instanceof HTMLButtonElement && !el.disabled) {
        el.click();
        return use();
      }
      stepFrom(el, e.shiftKey ? -1 : 1); return use();
    }
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && o.fieldOf && !isCombo && (el instanceof HTMLButtonElement || (el instanceof HTMLInputElement && el.type !== "checkbox" && el.type !== "radio"))) {
      const dir = e.key === "ArrowDown" ? 1 : -1;
      for (let k = cell.row + dir; k >= 0 && k < o.count; k += dir) {
        const t = grid.querySelector<HTMLElement>(`[data-field="${o.fieldOf(k, cell.col)}"]`);
        if (t && usable(t)) { reveal(t); break; }
      }
      return use();
    }
    if (o.readOnly) return false;
    if (e.key === "Delete" && e.shiftKey) { o.onRemove(cell.row, false); return use(); }
    if (isD) { o.onFillCell(cell.row, cell.col); return use(); }
    return false;
  };

  const rowHeadProps = (r: number) => ({
    onClick: (e: { currentTarget: HTMLElement }) => enterRow(e.currentTarget.closest<HTMLElement>("[data-grid]"), r),
    tabIndex: -1, title: "Select row", "aria-label": `Select row ${r + 1}`,
  });
  const gridProps = {
    tabIndex: 0,
    onFocus: (e: FocusEvent<HTMLElement>) => {
      if (e.target === e.currentTarget) { if (o.count) setRowSel(clamp(last.current)); }
      else { const c = o.cellOf(e.target as HTMLElement); if (c) last.current = c.row; }
    },
    onBlur: (e: FocusEvent<HTMLElement>) => { if (e.target === e.currentTarget) setRowSel(null); },
  };
  return { rowSel, handleKey, rowHeadProps, gridProps, enterRow, stepFrom, afterCombo: (el: HTMLInputElement, dir: 1 | -1 = 1) => stepFrom(el, dir) };
}
