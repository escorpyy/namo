import { MASTERS, matchWhere, type LookupWhere, type MasterDef, type Opt } from "../../shared/masters";
import { recordTitle, type Row } from "./form";

// The other masters a master's form reads its lookups from (fields, lines columns, and `loads`), same rule MasterScreen uses.
export const lookupKeysOf = (def: MasterDef): string[] => {
  const lineLookups = def.fields.flatMap((f) => (f.type === "lines" ? f.lines!.columns.filter((c) => c.type === "lookup").map((c) => c.lookup!) : []));
  const own = def.fields.filter((f) => f.type === "lookup" && f.lookupScope !== "record").map((f) => f.lookup!);
  return [...new Set([...own, ...lineLookups, ...(def.loads ?? [])])].filter((k) => k !== def.key);
};

// Options of every lookup field (and lines lookup column) of `def` from already-loaded rows: the same shape MasterScreen builds.
export function buildLookups(def: MasterDef, rowsOf: (masterKey: string) => Row[]): Record<string, Opt[]> {
  const out: Record<string, Opt[]> = {};
  const build = (key: string, lookup: string, where: LookupWhere | undefined) => {
    const target = MASTERS[lookup];
    const rows = rowsOf(lookup).filter((r) => matchWhere(where, r));
    // A child master (Sub Group) shows its parent's code too: "AG01 / SG01 — Cash-in-Hand"
    const pf = target.parent && target.fields.find((x) => x.name === target.parent!.field);
    const parents = pf ? rowsOf(pf.lookup!) : [];
    const pTarget = pf ? MASTERS[pf.lookup!] : null;
    out[key] = rows.map((r) => {
      const par = pf ? parents.find((p) => p.id === r[pf.name]) : null;
      const prefix = par && pTarget ? `${par[pTarget.labelFields[0]]} / ` : "";
      const code = String(r[target.labelFields[0]] ?? "");
      const name = String(r[target.labelFields[1]] ?? "");
      const parentDetail = par && pTarget ? `${pTarget.title}: ${recordTitle(pTarget, par)}` : "";
      const attributes = [r.type, r.category, r.glType, r.role].filter((v) => typeof v === "string" && v).join(" · ");
      const searchText = Object.entries(r).filter(([k, v]) => !["id", "createdAt", "updatedAt"].includes(k) && ["string", "number", "boolean"].includes(typeof v)).map(([, v]) => String(v)).join(" ");
      return { value: String(r.id), label: `${prefix}${recordTitle(target, r)}`, short: code, code, name, detail: [parentDetail, attributes].filter(Boolean).join(" · "), searchText, isActive: typeof r.isActive === "boolean" ? r.isActive : true };
    });
  };
  for (const f of def.fields) {
    if (f.type === "lookup" && f.lookupScope !== "record") build(f.name, f.lookup!, f.lookupWhere);
    if (f.type === "lines") for (const c of f.lines!.columns) if (c.type === "lookup") build(`${f.name}.${c.name}`, c.lookup!, c.lookupWhere);
  }
  return out;
}
