import { useRef, useState, type FocusEvent, type KeyboardEvent } from "react";

// Row mode for an editable grid made of CSS-grid rows (the lines of a master, the billing terms, the opening stock ...).
//
// The grid itself takes focus ("row mode"): one whole row is highlighted, ↑ ↓ Home End move between rows, Enter starts editing that row,
// Delete removes it and Ctrl+D copies the row above into it. Inside a cell Esc goes back to row mode, Shift+Delete removes the row
// (plain Delete keeps deleting text), and Ctrl+D copies the cell above into this one.
// Click the row number to select a row, like the row header in Excel.
//
// The hook only handles keys and keeps the selected row; changing the rows is up to the screen (onRemove / onFillRow / onFillCell).

export interface GridRowsOptions {
  count: number;
  readOnly?: boolean;
  /** the first editable cell of row r, to start editing it with Enter */
  firstCell: (grid: HTMLElement, r: number) => HTMLElement | null;
  /** which row and column a focused cell belongs to (from its data-field), or null if it is not a cell */
  cellOf: (el: HTMLElement) => { row: number; col: string } | null;
  onRemove: (row: number) => void;
  onFillRow: (row: number) => void;
  onFillCell: (row: number, col: string) => void;
}

export function useGridRows(o: GridRowsOptions) {
  const [rowSel, setRowSel] = useState<number | null>(null);
  const last = useRef(0);
  const clamp = (r: number) => Math.max(0, Math.min(o.count - 1, r));
  const enterRow = (grid: HTMLElement | null, r: number) => {
    if (!grid || o.count === 0) return;
    last.current = clamp(r); setRowSel(last.current); grid.focus();
    grid.querySelector(`[data-row="${last.current}"]`)?.scrollIntoView({ block: "nearest" });
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
      if (e.key === "Enter" && !e.shiftKey) { const c = o.firstCell(grid, r); if (c) { c.focus(); c.scrollIntoView({ block: "nearest", inline: "nearest" }); } return use(); }
      if (o.readOnly) return false;
      if (e.key === "Delete" && !ctrl && !e.altKey) { o.onRemove(r); last.current = clamp(Math.min(r, o.count - 2)); setRowSel(last.current); return use(); }
      if (isD) { o.onFillRow(r); return use(); }
      return false;
    }
    const cell = o.cellOf(el);
    if (!cell) return false;
    if (e.key === "Escape") { enterRow(grid, cell.row); return use(); }
    if (o.readOnly) return false;
    if (e.key === "Delete" && e.shiftKey) { o.onRemove(cell.row); return use(); }
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
  return { rowSel, handleKey, rowHeadProps, gridProps, enterRow };
}
