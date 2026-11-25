import { MASTERS } from "./masters";

// ============================================================
// CODE NUMBERING: the rule language and the list of masters that can have a rule.
//
// A rule is a template made of tokens, always ending with the running number:
//   {PARENT}  the code of the parent master          (sub-group under group, product under sub-group)
//   {NAME2}   the first two letters / digits of the name, upper case   ("Ramesh Traders" -> RA)
//   {TYPE}    one letter for the master's type        (vendor V, customer C, stock product S ...)
//   {SEQ:n}   the running number, n digits, zero padded (n = 1 to 6); must be the last token
// and plain upper-case letters, digits and - / . _ between them.
// The running number restarts for every different prefix (everything before {SEQ}): {NAME2}{TYPE}{SEQ:3} gives RAV001, RAV002 ...
// and starts again at RAC001 for customers. It is the highest number already used under that prefix plus one, and grows past
// its width instead of failing (999 -> 1000).
//
// Pure functions only: the server uses them to suggest a code, the settings screen to show a live example.
// ============================================================

export type CodeMode = "MANUAL" | "SUGGESTED";

export interface CodeSpec {
  key: string; // the master key (shared/masters.ts)
  label: string;
  module: string;
  /** the form field that holds the parent's id, and what the parent is called; absent = no {PARENT} */
  parentField?: string;
  parentLabel?: string;
  parentKey?: string; // the master key of the parent (to find its code)
  /** the form field that holds the type, and its one-letter codes; absent = no {TYPE} */
  typeField?: string;
  typeLetters?: Record<string, string>;
  /** the form field that holds the name; absent = no {NAME2} */
  nameField?: string;
  defaultMode: CodeMode;
  defaultTemplate: string;
}

const PARTY_LETTERS = { CUSTOMER: "C", VENDOR: "V", BOTH: "B", OTHER: "O" };
const PRODUCT_LETTERS = { STOCK: "S", NON_STOCK: "N", SERVICE: "E", FIXED_ASSET: "F", BUNDLE: "B" };
const fixed = (key: string, label: string, module: string, prefix: string, nameField = "name", extra: Partial<CodeSpec> = {}): CodeSpec =>
  ({ key, label, module, nameField, defaultMode: "SUGGESTED", defaultTemplate: `${prefix}{SEQ:3}`, ...extra });

export const CODE_SPECS: CodeSpec[] = [
  fixed("account-groups", "Account Group", "Accounts", "AG", "description"),
  fixed("account-sub-groups", "Account Sub Group", "Accounts", "AS", "description", { parentField: "accountGroupId", parentLabel: "Account Group", parentKey: "account-groups" }),
  fixed("general-ledger", "General Ledger", "Accounts", "GL", "name", { parentField: "accountGroupId", parentLabel: "Account Group", parentKey: "account-groups" }),
  fixed("sub-ledger", "Sub Ledger", "Accounts", "SL"),
  fixed("party", "Party (customer / vendor)", "Parties", "PA", "name", { typeField: "glType", typeLetters: PARTY_LETTERS }),
  fixed("areas", "Area", "Parties", "AR"),
  fixed("sub-areas", "Sub Area", "Parties", "SA", "name", { parentField: "areaId", parentLabel: "Area", parentKey: "areas" }),
  fixed("agents", "Agent", "Parties", "AT"),
  fixed("product-groups", "Product Group", "Products", "PG"),
  fixed("product-sub-groups", "Product Sub Group", "Products", "PS", "name", { parentField: "productGroupId", parentLabel: "Product Group", parentKey: "product-groups" }),
  fixed("products", "Product", "Products", "PR", "description", { parentField: "productSubGroupId", parentLabel: "Sub Group", parentKey: "product-sub-groups", typeField: "type", typeLetters: PRODUCT_LETTERS }),
  fixed("product-units", "Unit", "Products", "UN"),
  fixed("stock-categories", "Stock Category", "Products", "SC"),
  fixed("locations", "Location", "Products", "LO"),
  fixed("narrations", "Narration", "Accounts", "NR", "narration"),
  fixed("purchase-terms", "Purchase Billing Term", "Billing", "PT"),
  fixed("sales-terms", "Sales Billing Term", "Billing", "ST"),
];

export const codeSpec = (key: string) => CODE_SPECS.find((s) => s.key === key);
/** the longest code the master's Code field accepts */
export const codeMax = (key: string): number => MASTERS[key]?.fields.find((f) => f.name === "code")?.max ?? 20;

// ---- the template ----
type Token = { t: "lit"; v: string } | { t: "parent" | "name2" | "type" } | { t: "seq"; n: number };
const TOKEN = /\{([A-Z0-9:]+)\}/g;

export function parseTemplate(template: string): { tokens: Token[]; problems: string[] } {
  const problems: string[] = [], tokens: Token[] = [];
  const src = template.trim().toUpperCase();
  if (!src) return { tokens, problems: ["Enter a template, for example {PARENT}{SEQ:3}."] };
  let at = 0, m: RegExpExecArray | null;
  const lit = (s: string) => {
    if (!s) return;
    if (!/^[A-Z0-9\-/._]+$/.test(s)) problems.push(`"${s}" is not allowed between tokens; use letters, digits and - / . _ only.`);
    else tokens.push({ t: "lit", v: s });
  };
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(src))) {
    lit(src.slice(at, m.index)); at = m.index + m[0].length;
    const w = m[1], seq = /^SEQ:(\d)$/.exec(w);
    if (w === "PARENT") tokens.push({ t: "parent" });
    else if (w === "NAME2") tokens.push({ t: "name2" });
    else if (w === "TYPE") tokens.push({ t: "type" });
    else if (seq && Number(seq[1]) >= 1 && Number(seq[1]) <= 6) tokens.push({ t: "seq", n: Number(seq[1]) });
    else problems.push(`Unknown token {${w}}. Use {PARENT}, {NAME2}, {TYPE} or {SEQ:3}.`);
  }
  lit(src.slice(at));
  if (/[{}]/.test(src.replace(TOKEN, ""))) problems.push("A { or } is not closed properly.");
  const seqs = tokens.filter((x) => x.t === "seq");
  if (seqs.length !== 1 || tokens[tokens.length - 1]?.t !== "seq") problems.push("The template must end with exactly one running number, like {SEQ:3}.");
  return { tokens, problems };
}

/** every reason a template cannot be used for this master (empty = fine) */
export function templateProblems(spec: CodeSpec, template: string): string[] {
  const { tokens, problems } = parseTemplate(template);
  const out = [...problems];
  if (tokens.some((x) => x.t === "parent") && !spec.parentField) out.push(`${spec.label} has no parent, so {PARENT} cannot be used.`);
  if (tokens.some((x) => x.t === "type") && !spec.typeField) out.push(`${spec.label} has no type, so {TYPE} cannot be used.`);
  if (tokens.some((x) => x.t === "name2") && !spec.nameField) out.push(`${spec.label} has no name, so {NAME2} cannot be used.`);
  if (!out.length) {
    // The parent's own length is not counted here (it is usually short); a suggestion that turns out too long is not offered.
    const longest = tokens.reduce((n, x) => n + (x.t === "lit" ? x.v.length : x.t === "name2" ? 2 : x.t === "type" ? 1 : x.t === "seq" ? x.n : 0), 0);
    if (longest > codeMax(spec.key)) out.push(`This makes codes of ${longest} characters or more, but the ${spec.label} code holds at most ${codeMax(spec.key)}.`);
  }
  return out;
}

export interface CodeCtx { parent?: string | null; name?: string | null; type?: string | null }

/** the first two letters / digits of a name, upper case ("Ramesh Traders" -> RA); "" if the name has none */
export const name2 = (name: string | null | undefined) => (name ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 2);

/** everything in front of the running number, or null while a value the template needs is not known yet (no parent chosen, no name typed) */
export function prefixOf(spec: CodeSpec, template: string, ctx: CodeCtx): { prefix: string; width: number } | null {
  const { tokens, problems } = parseTemplate(template);
  if (problems.length) return null;
  let prefix = "", width = 1;
  for (const x of tokens) {
    if (x.t === "lit") prefix += x.v;
    else if (x.t === "seq") width = x.n;
    else if (x.t === "parent") { if (!ctx.parent) return null; prefix += ctx.parent.toUpperCase(); }
    else if (x.t === "name2") { const v = name2(ctx.name); if (!v) return null; prefix += v; }
    else if (x.t === "type") { const v = spec.typeLetters?.[ctx.type ?? ""]; if (!v) return null; prefix += v; }
  }
  return { prefix, width };
}

/** the next code under a prefix: the highest running number already used there, plus one */
export function nextCode(prefix: string, width: number, existing: readonly string[]): string {
  let max = 0;
  for (const c of existing) {
    const rest = c.toUpperCase().startsWith(prefix) ? c.slice(prefix.length) : "";
    if (rest.length >= width && /^\d+$/.test(rest)) max = Math.max(max, Number(rest));
  }
  return prefix + String(max + 1).padStart(width, "0");
}

/** a made-up code to show what a template does */
export function exampleCode(spec: CodeSpec, template: string): string {
  const letters = spec.typeLetters ? Object.keys(spec.typeLetters)[0] : undefined;
  const p = prefixOf(spec, template, { parent: spec.parentKey ? "10".slice(0, Math.min(2, codeMax(spec.parentKey))) : undefined, name: "Ramesh Traders", type: letters });
  return p ? nextCode(p.prefix, p.width, []) : "";
}

/** one master's rule as the settings screen shows it */
export interface CodeRuleRow {
  key: string; label: string; module: string; mode: CodeMode; template: string; isDefault: boolean;
  defaultMode: CodeMode; defaultTemplate: string; example: string; parentLabel: string | null; usesType: boolean; usesName: boolean; codeMax: number;
}
export interface CodeSuggestion { mode: CodeMode; code: string | null; reason?: string }
