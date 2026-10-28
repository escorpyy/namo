import { Plus, X } from "lucide-react";
import type { FieldDef, Opt } from "../../shared/masters";
import { cleanLines, parseLines, type Line } from "../lib/form";
import { MasterReferencePicker } from "./MasterReferencePicker";

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
// Keyboard: Enter agla cell; aakhri row ke aakhri cell par Enter = nayi row; Shift+Delete = row hatao.
export function LinesEditor({ field, value, onChange, lookups, contextKey, hasError, onBlurField, onCommit }: Props) {
  const cols = field.lines!.columns;
  const lines = parseLines(value);
  const grid = { gridTemplateColumns: `${cols.map((c) => c.width ?? "1fr").join(" ")} 28px` };
  const set = (next: Line[]) => onChange(JSON.stringify(next));
  const isBlank = (l: Line) => cleanLines([l]).length === 0;
  const add = () => { set([...lines, Object.fromEntries(cols.map((c) => [c.name, ""]))]); setTimeout(() => document.querySelector<HTMLElement>(`[data-field="${field.name}.${lines.length}.${cols[0].name}"]`)?.focus(), 30); };
  const update = (i: number, col: string, v: string) => set(lines.map((l, k) => (k === i ? { ...l, [col]: v } : l)));
  const remove = (i: number) => set(lines.filter((_, k) => k !== i));

  const onKeyDown = (e: React.KeyboardEvent) => {
    const el = e.target as HTMLElement;
    const m = /^.+\.(\d+)\.(.+)$/.exec(el.getAttribute("data-field") ?? "");
    if (!m) return;
    const i = Number(m[1]), col = m[2];
    if (e.key === "Delete" && e.shiftKey) { e.preventDefault(); e.stopPropagation(); remove(i); return; }
    if (e.key === "Enter" && !e.shiftKey && i === lines.length - 1 && col === cols[cols.length - 1].name && !isBlank(lines[i])) {
      e.preventDefault(); e.stopPropagation(); add(); // aakhri cell par Enter: nayi row
    }
  };

  return (
    <div onKeyDown={onKeyDown} className={`border bg-white ${hasError ? "border-red-600" : "border-slate-300"}`}>
      <div style={grid} className="grid gap-x-2 px-2 py-1 text-[11px] font-semibold text-slate-600 bg-slate-100 border-b border-slate-300">
        {cols.map((c) => <span key={c.name}>{c.label}</span>)}<span />
      </div>
      {lines.length === 0 && <div className="px-2 py-2 text-slate-500 text-[12px]">No lines yet. “Add line” dabao.</div>}
      {lines.map((l, i) => (
        <div key={i} style={grid} className="grid gap-x-2 px-2 py-1 items-start">
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
          <button type="button" tabIndex={-1} onClick={() => remove(i)} title="Remove line (Shift+Delete)" aria-label="Remove line" className="h-8 grid place-items-center text-slate-500 hover:text-red-700"><X size={14} /></button>
        </div>
      ))}
      <div className="px-2 py-1.5 border-t border-slate-200 flex items-center gap-3">
        <button type="button" className="btn h-7" onClick={add}><Plus size={13} /> Add line</button>
        {field.lines!.hint && <span className="text-[11px] text-slate-500">{field.lines!.hint}</span>}
      </div>
    </div>
  );
}
