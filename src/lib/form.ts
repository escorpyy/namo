import type { FieldDef, MasterDef } from "../../shared/masters";

export type Row = Record<string, any> & { id: number };
export type FormState = Record<string, string | boolean>;
export type Errors = Record<string, string | undefined>;

export const fieldOf = (def: MasterDef, name: string) => def.fields.find((f) => f.name === name)!;

// showIf: field tabhi dikhta/validate hota hai jab condition match kare
export const visible = (f: FieldDef, form: FormState) => !f.showIf || f.showIf.in.includes(String(form[f.showIf.field]));

export const emptyForm = (def: MasterDef): FormState =>
  Object.fromEntries(def.fields.map((f) => [f.name, f.type === "checkbox" ? Boolean(f.default ?? false) : String(f.default ?? "")]));

export const toForm = (def: MasterDef, row: Row): FormState =>
  Object.fromEntries(
    def.fields.map((f) => {
      const v = row[f.name];
      if (f.type === "checkbox") return [f.name, Boolean(v)];
      if (v == null) return [f.name, ""];
      // numeric(18,6) jaise values "50000.000000" aate hain: field ke decimals tak dikhao
      if (f.type === "number" && (f.decimals ?? 0) > 0) return [f.name, Number(v).toFixed(f.decimals)];
      return [f.name, String(v)];
    }),
  );

// Form (sab strings) -> API payload (sahi types)
export const toPayload = (def: MasterDef, form: FormState): Record<string, unknown> =>
  Object.fromEntries(
    def.fields.map((f) => {
      const v = form[f.name];
      if (!visible(f, form)) return [f.name, f.type === "checkbox" ? false : null]; // chhupe field ka data nahi bhejte
      if (f.type === "checkbox") return [f.name, !!v];
      let s = String(v).trim();
      if (f.type === "number" || f.type === "lookup") return [f.name, s === "" ? null : Number(s)];
      if (f.upper) s = s.toUpperCase();
      return [f.name, s === "" && !f.required ? null : s];
    }),
  );

export const sameForm = (a: FormState, b: FormState) => Object.keys(a).every((k) => a[k] === b[k]);

export const recordLabel = (def: MasterDef, row: Row) => String(row[def.labelFields[0]] ?? "");

const norm = (f: FieldDef, v: unknown) => (f.type === "text" ? String(v ?? "").trim().toLowerCase() : String(v ?? ""));

// Server bhi yahi rules dobara check karta hai; yahan sirf turant feedback ke liye.
export function validate(def: MasterDef, form: FormState, items: Row[], editingId: number | null): Errors {
  const e: Errors = {};
  for (const f of def.fields) {
    const v = form[f.name];
    if (f.type === "checkbox" || !visible(f, form)) continue;
    const s = String(v).trim();
    if (!s) {
      if (f.required) e[f.name] = `${f.label} is required.`;
      continue;
    }
    if (f.type === "text" && f.max && s.length > f.max) e[f.name] = `${f.label} can be at most ${f.max} characters.`;
    if (f.type === "number") {
      const n = Number(s);
      if (!Number.isFinite(n)) e[f.name] = "Enter a valid number.";
      else if (f.decimals === 0 && !Number.isInteger(n)) e[f.name] = "Whole number only.";
      else if (f.min != null && n < f.min) e[f.name] = `${f.label} must be at least ${f.min}.`;
      else if (f.maxValue != null && n > f.maxValue) e[f.name] = `${f.label} must be at most ${f.maxValue}.`;
    }
  }
  for (const set of def.unique) {
    const last = [...set].reverse().find((n) => fieldOf(def, n).type === "text")!;
    if (e[last]) continue;
    const vals = set.map((n) => norm(fieldOf(def, n), form[n]));
    if (vals.some((x) => x === "")) continue;
    const dup = items.some((it) => it.id !== editingId && set.every((n, i) => norm(fieldOf(def, n), it[n]) === vals[i]));
    if (dup) {
      const f = fieldOf(def, last);
      const shown = f.upper ? String(form[last]).trim().toUpperCase() : String(form[last]).trim();
      e[last] = `${f.label} '${shown}' already exists in this ${def.parent ? def.parent.label : "company"}.`;
    }
  }
  return e;
}
