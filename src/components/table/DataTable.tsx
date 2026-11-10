import { useRef, type HTMLAttributes, type KeyboardEvent, type MouseEvent, type ReactNode, type TableHTMLAttributes, type TdHTMLAttributes, type ThHTMLAttributes } from "react";
import { alignClass, rangeKeys, type ColKind } from "../../lib/tableKinds";

// The one table of the app: Excel-style gridlines, text left / numbers right / dates right / booleans centred, rows you can select and
// act on from the keyboard. Use <DataTable> for a table of rows described by columns. For a table that is laid out by hand (merged
// cells, inputs, groups) use <XlTable>, <Th> and <Td> — same look, same alignment rules, you only say `kind`.
//
//   <DataTable label="Bills" rows={bills} rowKey={(b) => b.id}
//     columns={[{ key: "no", header: "Invoice", kind: "text" }, { key: "date", header: "Date", kind: "date" }, { key: "amount", header: "Amount", kind: "number", render: (b) => money(b.amount) }]}
//     selected={sel} onSelectedChange={setSel} multiple onDelete={(rows) => remove(rows)} onFillDown={(rows, at) => copyDown(at)} />
//
// Keys while a row has focus:  ↑ ↓ Home End move · Shift+↑ ↓ extend the selection (multiple) · Enter / Space select · Ctrl+A select all
//                              Delete → onDelete · Ctrl+D → onFillDown · Esc → onEscape.
// Delete and Ctrl+D act on the selected rows when the focused row is one of them, otherwise on the focused row alone.
// Nothing is deleted here: onDelete is told which rows, and the screen decides (usually: ask first).

type Key = string | number;

export function XlTable({ sticky, className = "", ...rest }: TableHTMLAttributes<HTMLTableElement> & { sticky?: boolean }) {
  return <table {...rest} className={`xl-table ${sticky ? "xl-sticky" : ""} ${className}`} />;
}
type CellKind = { kind?: ColKind; sample?: unknown };
export function Th({ kind, sample, className = "", ...rest }: ThHTMLAttributes<HTMLTableCellElement> & CellKind) {
  return <th {...rest} className={`${alignClass(kind, sample)} ${className}`} />;
}
export function Td({ kind, sample, className = "", ...rest }: TdHTMLAttributes<HTMLTableCellElement> & CellKind) {
  return <td {...rest} className={`${alignClass(kind, sample)} ${className}`} />;
}

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** what the column holds; decides the alignment. Default text. `auto` guesses from each value. */
  kind?: ColKind;
  /** CSS width ("84px", "20%"); leave out to take the space that is left */
  width?: string;
  /** the raw value (default: row[key]); used for `auto` alignment and as the cell text when there is no render */
  value?: (row: T) => unknown;
  render?: (row: T, index: number) => ReactNode;
  footer?: ReactNode;
  className?: string;
  title?: string;
}

export interface DataTableProps<T> {
  columns: readonly Column<T>[];
  rows: readonly T[];
  rowKey: (row: T) => Key;
  label: string;
  selected?: ReadonlySet<Key>;
  onSelectedChange?: (keys: Set<Key>) => void;
  /** Shift+click / Shift+arrows select a range, Ctrl+click toggles, Ctrl+A selects all */
  multiple?: boolean;
  onActivate?: (row: T, index: number) => void;
  onDelete?: (rows: T[], indexes: number[]) => void;
  onFillDown?: (rows: T[], indexes: number[]) => void;
  onEscape?: () => void;
  rowClassName?: (row: T) => string | undefined;
  rowProps?: (row: T) => Record<string, string | number | boolean | undefined>;
  empty?: ReactNode;
  sticky?: boolean;
  /** columns keep their `width`; the rest share what is left */
  fixed?: boolean;
  className?: string;
}

export function DataTable<T>({ columns, rows, rowKey, label, selected, onSelectedChange, multiple, onActivate, onDelete, onFillDown, onEscape, rowClassName, rowProps, empty, sticky = true, fixed, className = "" }: DataTableProps<T>) {
  const tableRef = useRef<HTMLTableElement>(null);
  const anchor = useRef<Key | null>(null);
  const keys = rows.map(rowKey);
  const isSel = (k: Key) => !!selected?.has(k);
  const els = () => Array.from(tableRef.current?.querySelectorAll<HTMLElement>("tbody > tr[data-row]") ?? []);
  const hasFooter = columns.some((c) => c.footer !== undefined);

  const setSel = (next: Iterable<Key>) => onSelectedChange?.(new Set(next));
  const targets = (i: number) => {
    const picked = keys.map((k, n) => (isSel(k) ? n : -1)).filter((n) => n >= 0);
    return picked.includes(i) ? picked : [i];
  };
  const focusRow = (i: number) => { const el = els()[i]; if (el) { el.focus(); el.scrollIntoView({ block: "nearest" }); } };

  const pick = (i: number, mods: { shift?: boolean; ctrl?: boolean }) => {
    const k = keys[i];
    if (multiple && mods.shift && anchor.current != null) setSel(rangeKeys(keys, anchor.current, k));
    else if (multiple && mods.ctrl) { const s = new Set(selected ?? []); if (s.has(k)) s.delete(k); else s.add(k); anchor.current = k; setSel(s); }
    else { anchor.current = k; setSel([k]); }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTableElement>) => {
    const row = e.target as HTMLElement;
    if (row.tagName !== "TR" || row.dataset.row === undefined) return; // keys typed inside a cell belong to the cell
    const i = els().indexOf(row), n = rows.length, ctrl = e.ctrlKey || e.metaKey;
    if (i < 0) return;
    const go = (to: number) => {
      e.preventDefault();
      const t = Math.max(0, Math.min(n - 1, to));
      focusRow(t);
      if (multiple && e.shiftKey) { if (anchor.current == null) anchor.current = keys[i]; setSel(rangeKeys(keys, anchor.current, keys[t])); }
    };
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(n - 1);
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(i, {}); if (e.key === "Enter") onActivate?.(rows[i], i); }
    else if (e.key === "a" && ctrl && multiple) { e.preventDefault(); setSel(keys); }
    else if (e.key === "Delete" && !ctrl && !e.shiftKey && !e.altKey && onDelete) { e.preventDefault(); e.stopPropagation(); const at = targets(i); onDelete(at.map((n2) => rows[n2]), at); }
    else if (e.key.toLowerCase() === "d" && ctrl && !e.shiftKey && !e.altKey && onFillDown) { e.preventDefault(); e.stopPropagation(); const at = targets(i); onFillDown(at.map((n2) => rows[n2]), at); }
    else if (e.key === "Escape" && onEscape) { e.stopPropagation(); onEscape(); }
  };
  const onRowClick = (i: number) => (e: MouseEvent<HTMLElement>) => { pick(i, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey }); e.currentTarget.focus(); };

  return (
    <table ref={tableRef} role="grid" aria-label={label} aria-multiselectable={multiple || undefined} onKeyDown={onKeyDown}
      className={`xl-table ${sticky ? "xl-sticky" : ""} ${fixed ? "table-fixed" : ""} ${className}`}>
      {columns.some((c) => c.width) && <colgroup>{columns.map((c) => <col key={c.key} style={c.width ? { width: c.width } : undefined} />)}</colgroup>}
      <thead>
        <tr>{columns.map((c) => <th key={c.key} scope="col" title={c.title} className={`${alignClass(c.kind)} ${c.className ?? ""}`}>{c.header}</th>)}</tr>
      </thead>
      <tbody>
        {rows.length === 0 && <tr><td colSpan={columns.length} className="text-left text-slate-500">{empty ?? "Nothing to show."}</td></tr>}
        {rows.map((row, i) => {
          const k = keys[i], extra = rowProps?.(row);
          return (
            <tr key={k} data-row={String(k)} role="row" tabIndex={-1} aria-selected={isSel(k)} {...(extra as HTMLAttributes<HTMLTableRowElement>)}
              onClick={onRowClick(i)} onDoubleClick={onActivate ? () => onActivate(row, i) : undefined}
              className={`cursor-pointer ${rowClassName?.(row) ?? ""}`}>
              {columns.map((c) => {
                const v = c.value ? c.value(row) : (row as Record<string, unknown>)[c.key];
                return <td key={c.key} className={`${alignClass(c.kind, v)} ${c.className ?? ""}`}>{c.render ? c.render(row, i) : v == null ? "" : String(v)}</td>;
              })}
            </tr>
          );
        })}
      </tbody>
      {hasFooter && <tfoot><tr>{columns.map((c) => <td key={c.key} className={`${alignClass(c.kind)} ${c.className ?? ""}`}>{c.footer}</td>)}</tr></tfoot>}
    </table>
  );
}
