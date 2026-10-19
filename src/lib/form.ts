import type { FieldDef, MasterDef } from "../../shared/masters";
import type { Mode } from "../types";
import { isValidAd } from "./nepaliDate";

export type Row = Record<string, any> & { id: number };
export type FormState = Record<string, string | boolean>;
export type Errors = Record<string, string | undefined>;

export const fieldOf = (def: MasterDef, name: string) => def.fields.find((f) => f.name === name)!;

// Field kab dikhta hai: readOnly sirf VIEW me, editOnly NEW me nahi, showIf condition match par
export const visible = (f: FieldDef, form: FormState, mode?: Mode) => {
  if (mode) {
    if (f.readOnly && mode !== "view") return false;
    if (f.editOnly && mode === "new") return false;
  }
  return !f.showIf || f.showIf.in.includes(String(form[f.showIf.field]));
};

export const emptyForm = (def: MasterDef): FormState =>
  Object.fromEntries(def.fields.map((f) => [f.name, f.type === "checkbox" ? Boolean(f.default ?? false) : String(f.default ?? "")]));

export const toForm = (def: MasterDef, row: Row): FormState =>
  Object.fromEntries(
    def.fields.map((f) => {
      const v = row[f.name];
      if (f.type === "checkbox") return [f.name, Boolean(v)];
      if (v == null) return [f.name, ""];
      if (f.type === "date") return [f.name, String(v).slice(0, 10)]; // AD ISO date
      // numeric(18,6) jaise values "50000.000000" aate hain: field ke decimals tak dikhao
      if (f.type === "number" && (f.decimals ?? 0) > 0) return [f.name, Number(v).toFixed(f.decimals)];
      return [f.name, String(v)];
    }),
  );

// Form (sab strings) -> API payload (sahi types). readOnly fields payload me nahi jaate.
export const toPayload = (def: MasterDef, form: FormState, mode: Mode): Record<string, unknown> =>
  Object.fromEntries(
    def.fields
      .filter((f) => !f.readOnly)
      .map((f) => {
        const v = form[f.name];
        if (!visible(f, form, mode)) return [f.name, f.type === "checkbox" ? false : null]; // chhupe field ka data nahi bhejte
        if (f.type === "checkbox") return [f.name, !!v];
        let s = String(v).trim();
        if (f.type === "number" || f.type === "lookup") return [f.name, s === "" ? null : Number(s)];
        if (f.upper) s = s.toUpperCase();
        if (f.lower) s = s.toLowerCase();
        return [f.name, s === "" && !f.required ? null : s];
      }),
  );

export const sameForm = (a: FormState, b: FormState) => Object.keys(a).every((k) => a[k] === b[k]);

export const recordTitle = (def: MasterDef, row: Row) => {
  const [a, b] = def.labelFields;
  return a === b ? String(row[a] ?? "") : `${row[a] ?? ""} — ${row[b] ?? ""}`;
};
export const recordLabel = (def: MasterDef, row: Row) => String(row[def.labelFields[0]] ?? "");

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const norm = (f: FieldDef, v: unknown) => (f.type === "text" ? String(v ?? "").trim().toLowerCase() : String(v ?? ""));

// Server bhi yahi rules dobara check karta hai; yahan sirf turant feedback ke liye.
export function validate(def: MasterDef, form: FormState, items: Row[], editingId: number | null, mode: Mode): Errors {
  const e: Errors = {};
  for (const f of def.fields) {
    const v = form[f.name];
    if (f.type === "checkbox" || !visible(f, form, mode)) continue;
    const s = String(v).trim();
    if (!s) {
      if (f.required) e[f.name] = `${f.label} is required.`;
      continue;
    }
    if (f.type === "date" && (s.startsWith("?") || !isValidAd(s))) e[f.name] = `${f.label}: enter a valid date (YYYY-MM-DD).`;
    if (f.type === "text" && f.max && s.length > f.max) e[f.name] = `${f.label} can be at most ${f.max} characters.`;
    if (f.type === "text" && f.format === "email" && !EMAIL.test(s)) e[f.name] = "Enter a valid email address.";
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
      e[last] = `${f.label} '${shown}' already exists in this ${def.uniqueScope === "system" ? "system" : def.parent ? def.parent.label : "company"}.`;
    }
  }
  // Date range: End Date, Start Date ke baad hona chahiye (jaise Fiscal Year)
  const sd = def.fields.find((f) => f.name === "startDate"), ed = def.fields.find((f) => f.name === "endDate");
  if (sd && ed && !e.startDate && !e.endDate && form.startDate && form.endDate && String(form.endDate) <= String(form.startDate)) e.endDate = "End Date must be after Start Date.";
  return e;
}
