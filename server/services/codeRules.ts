import { and, eq, getTableColumns, like } from "drizzle-orm";
import { CODE_SPECS, codeMax, codeSpec, exampleCode, nextCode, prefixOf, templateProblems, type CodeMode, type CodeSpec } from "../../shared/codeRules";
import { db } from "../db";
import * as S from "../db/schema";
import { HttpError } from "../routes/_util";

// Code numbering (shared/codeRules.ts holds the rule language). A master with no saved rule uses its built-in default.
// Only the SUGGESTION follows a rule: the code a user types is saved as typed.

const TABLE: Record<string, any> = {
  "account-groups": S.accountGroup, "account-sub-groups": S.accountSubGroup, "general-ledger": S.generalLedger, party: S.generalLedger,
  "sub-ledger": S.subLedger, areas: S.area, "sub-areas": S.subArea, agents: S.agent, "product-groups": S.productGroup,
  "product-sub-groups": S.productSubGroup, products: S.product, "product-units": S.productUnit, "tax-rates": S.taxRate,
  "stock-categories": S.stockCategory, locations: S.location, "purchase-terms": S.purchaseTerm, "sales-terms": S.salesTerm,
};

export interface CodeRuleRow {
  key: string; label: string; module: string; mode: CodeMode; template: string; isDefault: boolean;
  defaultMode: CodeMode; defaultTemplate: string; example: string; parentLabel: string | null; usesType: boolean; usesName: boolean; codeMax: number;
}

const specOf = (key: string): CodeSpec => {
  const s = codeSpec(key);
  if (!s) throw new HttpError(404, "Unknown master.");
  return s;
};

async function storedRule(companyId: number, key: string) {
  const [r] = await db.select().from(S.codeRule).where(and(eq(S.codeRule.companyId, companyId), eq(S.codeRule.masterKey, key)));
  return r ?? null;
}

export async function listRules(companyId: number): Promise<CodeRuleRow[]> {
  const rows = await db.select().from(S.codeRule).where(eq(S.codeRule.companyId, companyId));
  const by = new Map(rows.map((r) => [r.masterKey, r]));
  return CODE_SPECS.map((s) => {
    const r = by.get(s.key);
    const mode = (r?.mode as CodeMode) ?? s.defaultMode, template = r?.template ?? s.defaultTemplate;
    return {
      key: s.key, label: s.label, module: s.module, mode, template, isDefault: !r, defaultMode: s.defaultMode, defaultTemplate: s.defaultTemplate,
      example: exampleCode(s, template), parentLabel: s.parentLabel ?? null, usesType: !!s.typeField, usesName: !!s.nameField, codeMax: codeMax(s.key),
    };
  });
}

export async function saveRule(companyId: number, key: string, input: { mode: unknown; template: unknown }, userId: number | null) {
  const spec = specOf(key);
  if (input.mode !== "MANUAL" && input.mode !== "SUGGESTED") throw new HttpError(400, "Mode must be MANUAL or SUGGESTED.", "mode");
  if (typeof input.template !== "string" || input.template.length > 60) throw new HttpError(400, "The template must be text of at most 60 characters.", "template");
  const template = input.template.trim().toUpperCase();
  const problems = templateProblems(spec, template);
  if (problems.length) throw new HttpError(400, problems[0], "template");
  await db.insert(S.codeRule)
    .values({ companyId, masterKey: key, mode: input.mode, template, updatedBy: userId })
    .onConflictDoUpdate({ target: [S.codeRule.companyId, S.codeRule.masterKey], set: { mode: input.mode, template, updatedBy: userId, updatedAt: new Date() } });
  return (await listRules(companyId)).find((r) => r.key === key)!;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export interface SuggestInput { parentId?: number | null; name?: string | null; type?: string | null }
export interface Suggestion { mode: CodeMode; code: string | null; reason?: string }

/** The code to propose for a new record: MANUAL gives none; otherwise the next number under the prefix the rule makes from what is known so far. */
export async function suggestCode(companyId: number, key: string, input: SuggestInput): Promise<Suggestion> {
  const spec = specOf(key), table = TABLE[key], rule = await storedRule(companyId, key);
  const mode = (rule?.mode as CodeMode) ?? spec.defaultMode, template = rule?.template ?? spec.defaultTemplate;
  if (mode === "MANUAL") return { mode, code: null };
  const cols = getTableColumns(table) as Record<string, any>;

  let parent: string | null = null;
  if (template.includes("{PARENT}") && spec.parentKey) {
    if (!input.parentId) return { mode, code: null, reason: `Choose the ${spec.parentLabel} first.` };
    const pt = TABLE[spec.parentKey], pc = getTableColumns(pt) as Record<string, any>;
    const [p] = await db.select({ code: pc.code, companyId: pc.companyId ?? pc.code }).from(pt).where(eq(pc.id, input.parentId));
    if (!p || (pc.companyId && p.companyId !== companyId)) return { mode, code: null, reason: `${spec.parentLabel} not found.` };
    parent = p.code;
  }
  if (template.includes("{NAME2}") && !(input.name ?? "").trim()) return { mode, code: null, reason: "Type the name first." };
  if (template.includes("{TYPE}") && !(input.type && spec.typeLetters?.[input.type])) return { mode, code: null, reason: "Choose the type first." };
  const made = prefixOf(spec, template, { parent, name: input.name, type: input.type });
  if (!made) return { mode, code: null, reason: "Type the name (letters or digits) first." };

  // the codes already used under this prefix: this company's, or for a table without a company column (sub-ledger) everyone's
  const where = [like(cols.code, `${escapeLike(made.prefix)}%`)];
  if (cols.companyId) where.push(eq(cols.companyId, companyId));
  else if (spec.parentField && input.parentId && cols[spec.parentField]) where.push(eq(cols[spec.parentField], input.parentId));
  const used = (await db.select({ code: cols.code }).from(table).where(and(...where))) as { code: string }[];
  const code = nextCode(made.prefix, made.width, used.map((u) => u.code));
  if (code.length > codeMax(key)) return { mode, code: null, reason: `The next code, ${code}, is longer than the ${codeMax(key)} characters this code allows. Type one yourself.` };
  return { mode, code };
}
