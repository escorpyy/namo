import { Fragment, useRef } from "react";
import { FilePlus, Pencil, Save, Trash2, X } from "lucide-react";
import type { FieldDef, MasterDef, Opt } from "../../shared/masters";
import { visible, type Errors, type FormState, type Row } from "../lib/form";
import type { Mode } from "../types";
import { Combobox } from "./Combobox";
import { DateInput } from "./DateInput";
import { adToBs } from "../lib/nepaliDate";
import { OptBadge } from "./OptBadge";

interface Props {
  def: MasterDef;
  mode: Mode;
  form: FormState;
  setForm: (f: FormState) => void;
  errors: Errors;
  onBlurField: (name: string) => void;
  selected: Row | null;
  dirty: boolean;
  saving: boolean;
  lookups: Record<string, Opt[]>;
  calendar: "BS" | "AD";
  actions: { save: () => void; clear: () => void; edit: () => void; del: () => void; newRec: () => void; cancel: () => void };
}

const fmt = (iso: string | undefined) => iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—";
const Err = ({ msg }: { msg?: string }) => (msg ? <p role="alert" className="mt-0.5 text-[12px] text-red-700">{msg}</p> : null);
const Kbd = ({ k }: { k: string }) => <span className="kbd">{k}</span>;

export function MasterForm({ def, mode, form, setForm, errors, onBlurField, selected, dirty, saving, lookups, calendar, actions }: Props) {
  const formRef = useRef<HTMLDivElement>(null);
  const editable = mode !== "view";

  // Enter = next field, Shift+Enter = previous. Buttons par Enter normal click hai.
  const moveFocus = (from: Element, dir: 1 | -1) => {
    const nodes = Array.from(formRef.current!.querySelectorAll<HTMLElement>("[data-nav]")).filter((n) => !(n as HTMLButtonElement).disabled);
    nodes[nodes.indexOf(from as HTMLElement) + dir]?.focus();
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter" || !editable) return;
    const el = e.target as HTMLElement;
    if (el.tagName === "BUTTON") return;
    e.preventDefault();
    moveFocus(el, e.shiftKey ? -1 : 1);
  };

  const optsOf = (f: FieldDef): Opt[] => (f.type === "select" ? (f.options ?? []) : (lookups[f.name] ?? []));
  const set = (name: string, v: string | boolean) => setForm({ ...form, [name]: v });

  const editor = (f: FieldDef) => {
    const err = errors[f.name];
    if (f.type === "checkbox")
      return <input data-nav data-field={f.name} type="checkbox" aria-label={f.label} className="h-4 w-4 mt-2 accent-blue-800" checked={!!form[f.name]} onChange={(e) => set(f.name, e.target.checked)} />;
    if (f.type === "date")
      return <DateInput fieldName={f.name} value={String(form[f.name])} onChange={(v) => set(f.name, v)} calendar={calendar} hasError={!!err} onBlurField={() => onBlurField(f.name)} />;
    if (f.type === "select" || f.type === "lookup")
      return (
        <Combobox
          fieldName={f.name} placeholder={f.placeholder ?? (f.required ? "Type or pick…" : "Optional")}
          value={String(form[f.name])} hasError={!!err} options={optsOf(f)}
          onChange={(v) => set(f.name, v)} onCommit={(el) => moveFocus(el, 1)} onBlurField={() => onBlurField(f.name)}
        />
      );
    const v = String(form[f.name]);
    return (
      <div className="relative">
        <input
          data-nav data-field={f.name} autoComplete="off" aria-invalid={!!err} placeholder={f.placeholder}
          className={`fld ${f.max ? "pr-12" : ""} ${f.name === "code" ? "font-mono" : ""} ${f.type === "number" ? "text-right tabular-nums" : ""} ${err ? "fld-err" : ""}`}
          inputMode={f.type === "number" ? "decimal" : undefined}
          maxLength={f.max} value={v}
          onChange={(e) => {
            let x = e.target.value;
            if (f.type === "number") x = x.replace(/[^0-9.]/g, "");
            else if (f.upper) x = x.toUpperCase();
            set(f.name, x);
          }}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={() => onBlurField(f.name)}
        />
        {f.max && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 tabular-nums">{v.length}/{f.max}</span>}
      </div>
    );
  };

  const display = (f: FieldDef) => {
    const v = form[f.name];
    if (f.type === "checkbox") return <div className="pt-1.5">{v ? "Yes" : "No"}</div>;
    if (f.type === "date") {
      const ad = String(v), bs = ad ? adToBs(ad) : null;
      if (!ad) return <div className="pt-1.5">—</div>;
      const [main, alt] = calendar === "BS" && bs ? [`${bs} BS`, `${ad} AD`] : [`${ad} AD`, bs ? `${bs} BS` : ""];
      return <div className="pt-1.5 font-medium tabular-nums">{main} {alt && <span className="text-[12px] font-normal text-slate-500">({alt})</span>}</div>;
    }
    if (f.type === "select") return <div className="pt-1"><OptBadge opt={optsOf(f).find((o) => o.value === v) ?? { value: "", label: String(v) }} /></div>;
    if (f.type === "lookup") return <div className="pt-1.5 font-medium">{optsOf(f).find((o) => o.value === v)?.label ?? "—"}</div>;
    return <div className={`pt-1.5 font-medium ${f.name === "code" ? "font-mono" : ""}`}>{String(v) || "—"}</div>;
  };

  const title = mode === "new" ? `New ${def.singular}` : mode === "edit" ? `Edit ${def.singular}` : `${def.singular} Details`;
  const tag = mode === "new" ? ["NEW", "bg-green-100 text-green-800 border-green-300"] : mode === "edit" ? ["EDIT", "bg-amber-100 text-amber-800 border-amber-300"] : ["VIEW", "bg-slate-100 text-slate-700 border-slate-300"];
  const two = def.cols === 2;

  return (
    <section data-zone="form" ref={formRef} onKeyDown={onKeyDown} className={`m-4 border border-slate-400 bg-white/60 ${two ? "max-w-[900px]" : "max-w-[760px]"}`}>
      <div className="px-5 pt-3 pb-2 double-rule flex items-center gap-2">
        <h2 className="text-[16px] font-semibold">{title}</h2>
        <span className={`text-[10px] font-semibold px-1.5 py-px border rounded-sm ${tag[1]}`}>{tag[0]}</span>
        {dirty && <span className="text-[11px] text-amber-700">• Modified</span>}
      </div>

      <div className={`px-5 py-2 ${two ? "grid grid-cols-2 gap-x-8" : ""}`}>
        {def.fields.filter((f) => visible(f, form, mode)).map((f) => (
          <Fragment key={f.name}>
            {f.section && (
              <div className="col-span-2 mt-1.5 mb-0.5 border-b border-slate-300 pb-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{f.section}</div>
            )}
            <div className={`grid ${two ? "grid-cols-[130px_1fr]" : "grid-cols-[120px_1fr]"} items-start gap-3 py-1 ${f.span === 2 ? "col-span-2" : ""}`}>
              <div className="pt-1.5 font-medium">{f.label} {f.required && editable && <span className="text-red-600" aria-hidden>*</span>}</div>
              <div>
                {editable ? <>{editor(f)}<Err msg={errors[f.name]} /></> : display(f)}
              </div>
            </div>
          </Fragment>
        ))}
      </div>

      {mode === "view" && selected && (
        <div className="mx-5 mb-3 border border-slate-300 bg-slate-50">
          <div className="px-3 py-1 text-[12px] font-semibold border-b border-slate-300 bg-slate-100">{def.singular} Information</div>
          <div className="flex divide-x divide-slate-300 text-[12px]">
            <div className="px-3 py-1.5 flex-1"><div className="text-slate-500">Created At</div><div className="tabular-nums">{fmt(selected.createdAt)}</div></div>
            {selected.updatedAt && <div className="px-3 py-1.5 flex-1"><div className="text-slate-500">Updated At</div><div className="tabular-nums">{fmt(selected.updatedAt)}</div></div>}
            {def.counts?.map((c) => (
              <div key={c.key} className="px-3 py-1.5 flex-1"><div className="text-slate-500">{c.label}</div><div className="tabular-nums">{selected[c.key] ?? 0}</div></div>
            ))}
          </div>
        </div>
      )}

      <div className="px-5 py-3 border-t border-slate-300 flex gap-2">
        {mode === "new" && (<>
          <button data-nav className="btn btn-primary" disabled={saving} onClick={actions.save}><Save size={14} /> Save <Kbd k="Ctrl+S" /></button>
          <button className="btn" onClick={actions.clear}><X size={14} /> Clear <Kbd k="Esc" /></button>
        </>)}
        {mode === "edit" && (<>
          <button data-nav className="btn btn-primary" disabled={saving} onClick={actions.save}><Save size={14} /> Update <Kbd k="Ctrl+S" /></button>
          <button className="btn" onClick={actions.cancel}><X size={14} /> Cancel <Kbd k="Esc" /></button>
        </>)}
        {mode === "view" && (<>
          <button data-nav className="btn" onClick={actions.edit}><Pencil size={14} /> Edit <Kbd k="F2" /></button>
          <button data-nav className="btn" onClick={actions.del}><Trash2 size={14} /> Delete <Kbd k="Ctrl+Del" /></button>
          <button data-nav className="btn" onClick={actions.newRec}><FilePlus size={14} /> New <Kbd k="F3" /></button>
        </>)}
      </div>
    </section>
  );
}
