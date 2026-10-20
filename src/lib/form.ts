import { matchWhere, type FieldDef, type LineCol, type MasterDef } from "../../shared/masters";
import type { Mode } from "../types";
import { isValidAd } from "./nepaliDate";

export { matchWhere };
export type Row = Record<string, any> & { id: number };
export type FormState = Record<string, string | boolean>;
export type Errors = Record<string, string | undefined>;
export type Line = Record<string, string>;

export const fieldOf = (def: MasterDef, name: string) => def.fields.find((f) => f.name === name)!;

// Field kab dikhta hai: readOnly sirf VIEW me, editOnly NEW me nahi, showIf condition match par
export const visible = (f: FieldDef, form: FormState, mode?: Mode) => {
  if (mode) {
    if (f.readOnly && mode !== "view") return false;
    if (f.editOnly && mode === "new") return false;
  }
  return !f.showIf || f.showIf.in.includes(String(form[f.showIf.field]));
};
export const isRequired = (f: FieldDef, form: FormState) =>
  !!f.required || (!!f.requiredIf && f.requiredIf.in.includes(String(form[f.requiredIf.field])));

// Form ke visible tabs (pehli baar aane ke order me)
export const tabsOf = (def: MasterDef, form: FormState, mode: Mode): string[] => [
  ...new Set(def.fields.filter((f) => f.tab && visible(f, form, mode)).map((f) => f.tab!)),
];

// ---- lines (repeating rows) ----
export const parseLines = (s: unknown): Line[] => {
  try { const a = JSON.parse(String(s || "[]")); return Array.isArray(a) ? a : []; } catch { return []; }
};
const blank = (l: Line) => Object.values(l).every((v) => String(v ?? "").trim() === "");
export const cleanLines = (ls: Line[]) => ls.filter((l) => !blank(l));

// "0.125000" -> "0.125", "100.000000" -> "100.00": kam se kam `decimals` jagah, par asli precision kabhi round nahi
export const fmtDecimal = (v: unknown, decimals: number) => {
  const [w, f = ""] = String(v).split(".");
  let fr = f.replace(/0+$/, "");
  while (fr.length < decimals) fr += "0";
  return fr ? `${w}.${fr}` : w;
};
const decimalsOf = (s: string) => (s.includes(".") ? s.split(".")[1].length : 0);

export const emptyForm = (def: MasterDef): FormState =>
  Object.fromEntries(def.fields.map((f) => [f.name, f.type === "checkbox" ? Boolean(f.default ?? false) : f.type === "lines" ? "[]" : String(f.default ?? "")]));

const lineFromRow = (c: LineCol, v: unknown) => (v == null ? "" : c.type === "number" ? fmtDecimal(v, c.decimals ?? 0) : String(v));

export const toForm = (def: MasterDef, row: Row): FormState =>
  Object.fromEntries(
    def.fields.map((f) => {
      const v = row[f.name];
      if (f.type === "checkbox") return [f.name, Boolean(v)];
      if (f.type === "lines") return [f.name, JSON.stringify((Array.isArray(v) ? v : []).map((r: Record<string, unknown>) => Object.fromEntries(f.lines!.columns.map((c) => [c.name, lineFromRow(c, r[c.name])]))))];
      if (v == null) return [f.name, ""];
      if (f.type === "date") return [f.name, String(v).slice(0, 10)]; // AD ISO date
      if (f.type === "number" && (f.decimals ?? 0) > 0) return [f.name, fmtDecimal(v, f.decimals!)];
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
        if (!visible(f, form, mode)) return [f.name, f.type === "checkbox" ? false : f.type === "lines" ? [] : null]; // chhupe field ka data nahi bhejte
        if (f.type === "checkbox") return [f.name, !!v];
        if (f.type === "lines")
          return [f.name, cleanLines(parseLines(v)).map((l) => Object.fromEntries(f.lines!.columns.map((c) => [c.name, String(l[c.name] ?? "").trim() === "" ? null : Number(l[c.name])])))];
        let s = String(v).trim();
        if (f.type === "number" || f.type === "lookup") return [f.name, s === "" ? null : Number(s)];
        if (f.upper) s = s.toUpperCase();
        if (f.lower) s = s.toLowerCase();
        return [f.name, s === "" && !isRequired(f, form) ? null : s];
      }),
  );

// Dirty check: lines me khali (adhoori) row ko ignore karte hain
export const sameForm = (def: MasterDef, a: FormState, b: FormState) =>
  Object.keys(a).every((k) => {
    const f = def.fields.find((x) => x.name === k);
    return f?.type === "lines" ? JSON.stringify(cleanLines(parseLines(a[k]))) === JSON.stringify(cleanLines(parseLines(b[k]))) : a[k] === b[k];
  });

export const recordTitle = (def: MasterDef, row: Row) => {
  const [a, b] = def.labelFields;
  return a === b ? String(row[a] ?? "") : `${row[a] ?? ""} — ${row[b] ?? ""}`;
};
export const recordLabel = (def: MasterDef, row: Row) => String(row[def.labelFields[0]] ?? "");

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const norm = (f: FieldDef, v: unknown) => (f.type === "text" ? String(v ?? "").trim().toLowerCase() : String(v ?? ""));

function validateNumber(f: { label: string; decimals?: number; min?: number; maxValue?: number; positive?: boolean }, s: string): string | undefined {
  const n = Number(s);
  if (!Number.isFinite(n)) return "Enter a valid number.";
  if (f.decimals === 0 && !Number.isInteger(n)) return "Whole number only.";
  if ((f.decimals ?? 0) > 0 || f.positive) {
    if (decimalsOf(s) > 6) return `${f.label}: at most 6 decimal places.`;
    if (Math.abs(n) >= 1e12) return `${f.label} is too large.`;
  }
  if (f.positive && n <= 0) return `${f.label} must be greater than 0.`;
  if (f.min != null && n < f.min) return `${f.label} must be at least ${f.min}.`;
  if (f.maxValue != null && n > f.maxValue) return `${f.label} must be at most ${f.maxValue}.`;
}

// Server bhi yahi rules dobara check karta hai; yahan sirf turant feedback ke liye.
export function validate(def: MasterDef, form: FormState, items: Row[], editingId: number | null, mode: Mode): Errors {
  const e: Errors = {};
  for (const f of def.fields) {
    const v = form[f.name];
    if (f.type === "checkbox" || !visible(f, form, mode)) continue;
    if (f.type === "lines") {
      const ls = cleanLines(parseLines(v)), cols = f.lines!.columns;
      if (f.lines!.min && ls.length < f.lines!.min) { e[f.name] = `${f.label}: add at least ${f.lines!.min} line.`; continue; }
      for (let i = 0; i < ls.length && !e[f.name]; i++) {
        for (const c of cols) {
          const s = String(ls[i][c.name] ?? "").trim();
          if (!s) { if (c.required) e[f.name] = `${f.label}, line ${i + 1}: ${c.label} is required.`; }
          else if (c.type === "number") { const m = validateNumber({ ...c, decimals: undefined }, s); if (m) e[f.name] = `${f.label}, line ${i + 1}: ${m}`; }
          if (e[f.name]) break;
        }
      }
      if (!e[f.name] && f.lines!.unique) {
        const keys = ls.map((l) => f.lines!.unique!.map((n) => l[n]).join("|"));
        if (new Set(keys).size !== keys.length) e[f.name] = `${f.label}: the same ${cols.find((c) => c.name === f.lines!.unique![0])?.label ?? "value"} appears twice.`;
      }
      continue;
    }
    const s = String(v).trim();
    if (!s) {
      if (isRequired(f, form)) e[f.name] = `${f.label} is required.`;
      continue;
    }
    if (f.type === "date" && (s.startsWith("?") || !isValidAd(s))) e[f.name] = `${f.label}: enter a valid date (YYYY-MM-DD).`;
    if (f.type === "text" && f.max && s.length > f.max) e[f.name] = `${f.label} can be at most ${f.max} characters.`;
    if (f.type === "text" && f.format === "email" && !EMAIL.test(s)) e[f.name] = "Enter a valid email address.";
    if (f.type === "number") { const m = validateNumber(f, s); if (m) e[f.name] = m.includes(f.label) ? m : m; }
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
  // Cross-field: max >= min stock, salvage <= cost (Product)
  const n = (k: string) => (String(form[k] ?? "").trim() === "" ? null : Number(form[k]));
  if (def.key === "products") {
    if (!e.maxStock && !e.minStock && n("maxStock") != null && n("minStock") != null && n("maxStock")! < n("minStock")!) e.maxStock = "Max Stock cannot be less than Min Stock.";
    if (!e.salvageValue && !e.originalCost && n("salvageValue") != null && n("originalCost") != null && n("salvageValue")! > n("originalCost")!) e.salvageValue = "Salvage Value cannot exceed Original Cost.";
  }
  return e;
}
