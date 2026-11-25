import { eq } from "drizzle-orm";
import { db } from "../db";
import * as S from "../db/schema";
import { HttpError } from "../routes/_util";
import { ENTRY_MODULES, featureOf, resolveEntry, type EntryControlMap, type EntryModuleKey, type EntryValues } from "../../shared/entryControl";
import type { Tx } from "./purchase/common";

/** Every feature of every module for one company, saved choices over the defaults. */
export async function entryControlsOf(tx: Tx | typeof db, companyId: number): Promise<EntryControlMap> {
  const saved = await tx.select().from(S.entryControl).where(eq(S.entryControl.companyId, companyId));
  const by = new Map(saved.map((r) => [`${r.module}.${r.feature}`, r]));
  const out: EntryControlMap = {};
  for (const m of ENTRY_MODULES) {
    out[m.key] = {};
    for (const f of m.features) {
      const r = by.get(`${m.key}.${f.key}`);
      out[m.key][f.key] = resolveEntry(f, r ? { show: r.isShown, edit: r.isEditable, mandatory: r.isMandatory, rule: r.ruleLevel as EntryValues["rule"] } : null);
    }
  }
  return out;
}

/** A broken business rule, as the company's Entry Control wants it handled: Ignore does nothing, Block refuses, Warn refuses until the user
 *  has acknowledged the warning (the screen asks, then repeats the request with acknowledgeWarnings). */
export function ruleOutcome(level: "IGNORE" | "WARN" | "BLOCK", acknowledged: boolean | undefined, message: string, field?: string) {
  if (level === "IGNORE") return;
  if (level === "WARN" && acknowledged) return;
  throw new HttpError(409, message, field, level === "WARN" ? "ENTRY_WARNING" : "ENTRY_BLOCKED");
}

/** What a field is worth to the server: a mandatory, shown feature must hold a value; a hidden one is not asked for. */
export async function assertMandatory(tx: Tx | typeof db, companyId: number, module: EntryModuleKey, values: Record<string, unknown>, field: Record<string, string> = {}) {
  const controls = (await entryControlsOf(tx, companyId))[module];
  for (const [key, value] of Object.entries(values)) {
    const f = featureOf(module, key);
    const c = controls[key];
    if (!f || !c || !c.mandatory) continue;
    const empty = value === null || value === undefined || (typeof value === "string" && value.trim() === "") || (Array.isArray(value) && value.length === 0);
    if (empty) throw new HttpError(409, `${f.label} is mandatory (Entry Control).`, field[key] ?? key);
  }
}
