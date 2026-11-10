import { Plus, X } from "lucide-react";
import type { FieldDef, Opt } from "../../shared/masters";
import { cleanLines, parseLines, type Line } from "../lib/form";
import { MasterReferencePicker } from "./MasterReferencePicker";
import { useGridRows } from "./table/useGridRows";
import { fillDownCell, fillDownRows } from "../lib/tableKinds";

interface Props {
  field: FieldDef;
  value: string; // JSON string of Line[]
  onChange: (v: string) => void;
  lookups: Record<string, Opt[]>; // key: `${field}.${column}`
  contextKey: string;
  hasError: boolean;
  onBlurField: () => void;
  onCommit: (el: HTMLInputElement) => void; // Combobox Enter -> next field
}

// Repeating rows (Alternate Units, Bundle Components...). Aage vouchers ki lines me bhi yahi pattern chalega.
// Keyboard: Enter agla cell; aakhri row ke aakhri cell par Enter = nayi row. Row number par click (ya cell me Esc) se row select hoti hai:
// Delete = row hatao, Ctrl+D = upar wali row copy. Cell me Shift+Delete = row hatao, Ctrl+D = upar wali cell copy.
export function LinesEditor({ field, value, onChange, lookups, contextKey, hasError, onBlurField, onCommit }: Props) {
  const cols = field.lines!.columns;
  const lines = parseLines(value);
  const grid = { gridTemplateColumns: `34px ${cols.map((c) => c.width ?? "1fr").join(" ")} 28px` };
  const set = (next: Line[]) => onChange(JSON.stringify(next));
  const isBlank = (l: Line) => cleanLines([l]).length === 0;
  const add = () => { set([...lines, Object.fromEntries(cols.map((c) => [c.name, ""]))]); setTimeout(() => document.querySelector<HTMLElement>(`[data-field="${field.name}.${lines.length}.${cols[0].name}"]`)?.focus(), 30); };
  const update = (i: number, col: string, v: string) => set(lines.map((l, k) => (k === i ? { ...l, [col]: v } : l)));
  const remove = (i: number) => set(lines.filter((_, k) => k !== i));

  const names = cols.map((c) => c.name);
  const fill = (next: Line[] | null) => { if (next) set(next); };
  const rows = useGridRows({
    count: lines.length,
    firstCell: (grid, r) => grid.querySelector<HTMLElement>(`[data-field="${field.name}.${r}.${cols[0].name}"]:not(:disabled)`),
    cellOf: (el) => { const m = /^.+\.(\d+)\.(.+)$/.exec(el.getAttribute("data-field") ?? ""); return m ? { row: Number(m[1]), col: m[2] } : null; },
    onRemove: remove,
    onFillRow: (r) => fill(fillDownRows(lines, [r], names)),
    onFillCell: (r, col) => fill(fillDownCell(lines, r, col)),
  });

  const onKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (rows.handleKey(e)) return;
    const el = e.target as HTMLElement;
    const m = /^.+\.(\d+)\.(.+)$/.exec(el.getAttribute("data-field") ?? "");
    if (!m) return;
    const i = Number(m[1]), col = m[2];
    if (e.key === "Enter" && !e.shiftKey && i === lines.length - 1 && col === cols[cols.length - 1].name && !isBlank(lines[i])) {
      e.preventDefault(); e.stopPropagation(); add(); // aakhri cell par Enter: nayi row
    }
  };

  return (
    <div data-grid="lines" {...rows.gridProps} onKeyDown={onKeyDown} aria-label={`${field.label} lines`} className={`border bg-white outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${hasError ? "border-red-600" : "border-slate-300"}`}>
      <div style={grid} className="xl-head">
        <span className="xl-rowhead">#</span>
        {cols.map((c) => <span key={c.name} className={c.type === "lookup" ? "" : "text-right"}>{c.label}</span>)}<span />
      </div>
      {lines.length === 0 && <div className="px-2 py-2 text-slate-500 text-[12px]">No lines yet. “Add line” dabao.</div>}
      {lines.map((l, i) => (
        <div key={i} data-row={i} data-selected={rows.rowSel === i} style={grid} className={`xl-row ${rows.rowSel === i ? "bg-cobalt-50 ring-2 ring-inset ring-cobalt-700" : ""}`}>
          <button type="button" className="xl-rowhead" {...rows.rowHeadProps(i)}>{i + 1}</button>
          {cols.map((c) =>
            c.type === "lookup" ? (
              <MasterReferencePicker
                key={c.name} fieldName={`${field.name}.${i}.${c.name}`} label={c.label} scopeKey={c.lookup!} contextKey={contextKey}
                placeholder={c.placeholder ?? "Choose…"} value={l[c.name] ?? ""} hasError={false} options={lookups[`${field.name}.${c.name}`] ?? []}
                onChange={(v) => update(i, c.name, v)} onCommit={(el) => onCommit(el)} onBlurField={onBlurField}
              />
            ) : (
              <input
                key={c.name} data-nav data-field={`${field.name}.${i}.${c.name}`} inputMode="decimal" autoComplete="off"
                className="fld text-right tabular-nums" value={l[c.name] ?? ""} aria-label={`${c.label} (line ${i + 1})`}
                onChange={(e) => { const x = e.target.value; if (/^\d{0,12}(\.\d{0,6})?$/.test(x)) update(i, c.name, x); }}
                onFocus={(e) => e.currentTarget.select()} onBlur={onBlurField}
              />
            ),
          )}
          <button type="button" tabIndex={-1} onClick={() => remove(i)} title="Remove line (Delete when the row is selected)" aria-label="Remove line" className="grid place-items-center text-slate-500 hover:text-red-700"><X size={14} /></button>
        </div>
      ))}
      <div className="px-2 py-1.5 border-t border-slate-200 flex items-center gap-3">
        <button type="button" className="btn h-7" onClick={add}><Plus size={13} /> Add line</button>
        {field.lines!.hint && <span className="text-[11px] text-slate-500">{field.lines!.hint}</span>}
      </div>
    </div>
  );
}
