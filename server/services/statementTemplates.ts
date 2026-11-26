import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import * as S from "../db/schema";
import { HttpError } from "../routes/_util";
import { financialReportRows } from "./financialReportRows";
import { stockMismatches } from "../routes/stockRecon";
import { inActorTx, parseDate, type Actor, type Tx } from "./purchase/common";
import { fmt, toMicro } from "../../shared/purchase-calculation";
import { buildStatement, StatementEngineError, type EngineLine, type EngineMapping, type EngineFormula, type EngineLedger, type StatementCode } from "./statementEngine";

const STATEMENTS = ["PL", "BS", "CFS", "SCOE"] as const;
type Statement = (typeof STATEMENTS)[number];
type LineType = "HEADING" | "MAPPED" | "COMPUTED";
type Nature = "DEBIT" | "CREDIT";
type DefinitionLine = {
  statement: Statement; code: string; label: string; parentCode?: string | null; sortOrder: number;
  axis?: "LINE" | "ROW" | "COLUMN"; lineType: LineType; nature?: Nature | null; role?: string | null;
  allowedTypes?: Array<"ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE">;
  noteNo?: string | null; drillDepth?: "NONE" | "GROUP" | "SUBGROUP" | "LEDGER"; showWhenZero?: boolean;
};
type DefinitionFormula = { statement: Statement; lineCode: string; termCode: string; sign: -1 | 1; sortOrder: number };
type DefinitionMapping = {
  statement: Statement; lineCode: string; accountGroupId?: number | null; accountSubGroupId?: number | null;
  generalLedgerId?: number | null; glSetupRole?: string | null; fallbackGeneralLedgerId?: number | null;
  accountFlag?: "IS_CASH_OR_BANK" | null; cfsSource?: "BS_MOVEMENT" | "PL_ADDBACK" | "CASH_FLAG" | null;
  movementKind?: "DRAWINGS" | "DIVIDENDS" | "CAPITAL_INTRODUCED" | "TRANSFER" | "OTHER" | null; sortOrder?: number;
};
export type TemplateDefinition = { lines: DefinitionLine[]; formulas: DefinitionFormula[]; mappings: DefinitionMapping[] };
const keyOf = (statement: string, code: string) => `${statement}\u0000${code}`;
const isStatement = (v: unknown): v is Statement => typeof v === "string" && (STATEMENTS as readonly string[]).includes(v);
const asInt = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v > 0 && v <= 2_147_483_647;
const asOrder = (v: unknown) => typeof v === "number" && Number.isInteger(v) && Math.abs(v) <= 2_147_483_647;
const hasValue = (v: unknown) => v !== undefined && v !== null;
const fail = (message: string, field?: string, status = 400) => { throw new HttpError(status, message, field); };

async function ownedTemplate(tx: Tx | typeof db, companyId: number, templateId: number) {
  const [template] = await tx.select().from(S.statementTemplate).where(and(eq(S.statementTemplate.id, templateId), eq(S.statementTemplate.companyId, companyId))).limit(1);
  if (!template) fail("Statement template not found.", undefined, 404);
  return template;
}

export async function listStatementTemplates(companyId: number) {
  const templates = await db.select().from(S.statementTemplate).where(eq(S.statementTemplate.companyId, companyId)).orderBy(S.statementTemplate.name);
  if (!templates.length) return [];
  const ids = templates.map((t) => t.id);
  const lines = await db.select({ templateId: S.statementLine.templateId, statement: S.statementLine.statement }).from(S.statementLine).where(inArray(S.statementLine.templateId, ids));
  return templates.map((t) => {
    const complete = new Set(lines.filter((l) => l.templateId === t.id).map((l) => l.statement));
    return { ...t, statementsPresent: [...complete], statementsComplete: STATEMENTS.every((s) => complete.has(s)) };
  });
}

export async function getStatementTemplate(companyId: number, templateId: number, tx: Tx | typeof db = db) {
  const template = await ownedTemplate(tx, companyId, templateId);
  const [lines, formulas, mappings] = await Promise.all([
    tx.select().from(S.statementLine).where(eq(S.statementLine.templateId, templateId)).orderBy(S.statementLine.statement, S.statementLine.sortOrder, S.statementLine.id),
    tx.select().from(S.statementLineFormula).where(eq(S.statementLineFormula.templateId, templateId)).orderBy(S.statementLineFormula.statement, S.statementLineFormula.lineId, S.statementLineFormula.sortOrder),
    tx.select().from(S.statementLineMapping).where(eq(S.statementLineMapping.templateId, templateId)).orderBy(S.statementLineMapping.statement, S.statementLineMapping.lineId, S.statementLineMapping.sortOrder),
  ]);
  const codeByKey = new Map(lines.map((l) => [keyOf(l.statement, l.code), l.code]));
  const lineCodeById = new Map(lines.map((l) => [l.id, l.code]));
  return {
    ...template,
    lines: lines.map((l) => ({ ...l, parentCode: l.parentLineId === null ? null : lineCodeById.get(l.parentLineId) ?? null })),
    formulas: formulas.map((f) => ({ ...f, lineCode: lineCodeById.get(f.lineId) ?? null, termCode: lineCodeById.get(f.termLineId) ?? null })),
    mappings: mappings.map((m) => ({ ...m, lineCode: lineCodeById.get(m.lineId) ?? null })),
  };
}

function validateDefinition(def: TemplateDefinition) {
  if (!def || !Array.isArray(def.lines) || !Array.isArray(def.formulas) || !Array.isArray(def.mappings)) fail("lines, formulas, and mappings must be arrays.");
  if (def.lines.length > 1000 || def.formulas.length > 5000 || def.mappings.length > 5000) fail("Template definition exceeds the supported size.");
  if (def.lines.some((v) => !v || typeof v !== "object" || Array.isArray(v)) || def.formulas.some((v) => !v || typeof v !== "object" || Array.isArray(v)) || def.mappings.some((v) => !v || typeof v !== "object" || Array.isArray(v))) fail("Definition entries must be objects.");
  const lineByKey = new Map<string, DefinitionLine>();
  const roleKeys = new Set<string>();
  for (const line of def.lines) {
    if (!isStatement(line.statement) || typeof line.code !== "string" || !line.code.trim() || line.code.length > 64 || typeof line.label !== "string" || !line.label.trim() || line.label.length > 160) fail("Each line requires a valid statement, code, and label.", "lines");
    if (!asOrder(line.sortOrder) || !["HEADING", "MAPPED", "COMPUTED"].includes(line.lineType)) fail(`Invalid line definition for ${line.code}.`, "lines");
    if (line.parentCode != null && (typeof line.parentCode !== "string" || !line.parentCode.trim())) fail(`Invalid parent code for ${line.code}.`, "lines");
    if (line.allowedTypes !== undefined && (!Array.isArray(line.allowedTypes) || line.allowedTypes.some((t) => !["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"].includes(t)))) fail(`Invalid allowedTypes for ${line.code}.`, "lines");
    if (line.nature != null && line.nature !== "DEBIT" && line.nature !== "CREDIT") fail(`Invalid nature for ${line.code}.`, "lines");
    if (line.role != null && (typeof line.role !== "string" || !line.role.trim() || line.role.length > 80)) fail(`Invalid role for ${line.code}.`, "lines");
    if (line.noteNo != null && (typeof line.noteNo !== "string" || line.noteNo.length > 30)) fail(`Invalid note number for ${line.code}.`, "lines");
    if (line.drillDepth !== undefined && !["NONE", "GROUP", "SUBGROUP", "LEDGER"].includes(line.drillDepth)) fail(`Invalid drill depth for ${line.code}.`, "lines");
    if (line.showWhenZero !== undefined && typeof line.showWhenZero !== "boolean") fail(`showWhenZero must be true or false for ${line.code}.`, "lines");
    const key = keyOf(line.statement, line.code);
    if (lineByKey.has(key)) fail(`Duplicate line code ${line.code} in ${line.statement}.`, "lines");
    lineByKey.set(key, line);
    if (line.role && line.role !== "SCOE_COLUMN") {
      if (roleKeys.has(line.role)) fail(`Role ${line.role} may appear only once per template.`, "lines");
      roleKeys.add(line.role);
    }
    const allowed = line.allowedTypes ?? [];
    if (line.lineType === "HEADING" && (line.nature != null || line.role != null || allowed.length)) fail(`Heading ${line.code} cannot have nature, role, or allowed types.`, "lines");
    if (line.lineType === "MAPPED" && (!line.nature || !allowed.length)) fail(`Mapped line ${line.code} requires a nature and allowedTypes.`, "lines");
    if (line.lineType === "COMPUTED" && line.nature != null) fail(`Computed line ${line.code} cannot have a nature.`, "lines");
    const validAxis = line.statement === "SCOE" ? (line.axis === "ROW" || line.axis === "COLUMN") : (line.axis === undefined || line.axis === "LINE");
    if (!validAxis) fail(`Invalid axis for ${line.code}.`, "lines");
  }
  for (const line of def.lines) if (line.parentCode) {
    const parent = lineByKey.get(keyOf(line.statement, line.parentCode));
    if (!parent) fail(`Parent ${line.parentCode} for ${line.code} is missing in ${line.statement}.`, "lines");
  }
  const visitParent = (line: DefinitionLine, active: Set<string>, done: Set<string>) => {
    const key = keyOf(line.statement, line.code);
    if (active.has(key)) fail(`Line hierarchy has a cycle at ${line.code}.`, "lines");
    if (done.has(key)) return;
    active.add(key);
    if (line.parentCode) visitParent(lineByKey.get(keyOf(line.statement, line.parentCode))!, active, done);
    active.delete(key); done.add(key);
  };
  const done = new Set<string>();
  for (const line of def.lines) visitParent(line, new Set(), done);

  const formulasByCode = new Map<string, DefinitionFormula[]>();
  const uniqueTerms = new Set<string>();
  for (const formula of def.formulas) {
    if (!isStatement(formula.statement) || typeof formula.lineCode !== "string" || typeof formula.termCode !== "string") fail("Each formula requires a valid statement and line codes.", "formulas");
    const line = lineByKey.get(keyOf(formula.statement, formula.lineCode));
    const term = lineByKey.get(keyOf(formula.statement, formula.termCode));
    if (!line || !term || line.lineType !== "COMPUTED") fail(`Formula ${formula.lineCode} -> ${formula.termCode} must target a computed line in the same statement.`, "formulas");
    if (formula.sign !== 1 && formula.sign !== -1 || !asOrder(formula.sortOrder)) fail(`Invalid formula term for ${formula.lineCode}.`, "formulas");
    const pair = `${formula.statement}\u0000${formula.lineCode}\u0000${formula.termCode}`;
    if (uniqueTerms.has(pair)) fail(`Duplicate formula term ${formula.termCode} on ${formula.lineCode}.`, "formulas");
    uniqueTerms.add(pair);
    const k = keyOf(formula.statement, formula.lineCode);
    formulasByCode.set(k, [...(formulasByCode.get(k) ?? []), formula]);
  }
  const formulaState = new Map<string, 0 | 1 | 2>();
  const visitFormula = (line: DefinitionLine) => {
    const key = keyOf(line.statement, line.code), state = formulaState.get(key) ?? 0;
    if (state === 1) fail(`Formula graph has a cycle at ${line.code}.`, "formulas");
    if (state === 2) return;
    formulaState.set(key, 1);
    for (const term of formulasByCode.get(key) ?? []) {
      const dependency = lineByKey.get(keyOf(term.statement, term.termCode))!;
      if (dependency.lineType === "COMPUTED") visitFormula(dependency);
    }
    formulaState.set(key, 2);
  };
  for (const line of def.lines.filter((l) => l.lineType === "COMPUTED")) visitFormula(line);

  const targets = new Set<string>();
  for (const mapping of def.mappings) {
    if (!mapping || !isStatement(mapping.statement) || typeof mapping.lineCode !== "string") fail("Each mapping requires a valid statement and line code.", "mappings");
    const line = lineByKey.get(keyOf(mapping.statement, mapping.lineCode));
    if (!line || line.lineType !== "MAPPED") fail(`Mapping for ${mapping.lineCode} must target a mapped line.`, "mappings");
    if (!isStatement(mapping.statement)) fail("Invalid statement on mapping.", "mappings");
    const primary = [mapping.accountGroupId, mapping.accountSubGroupId, mapping.generalLedgerId, mapping.glSetupRole, mapping.accountFlag].filter((v) => v !== undefined && v !== null);
    if (primary.length !== 1) fail(`Mapping for ${mapping.lineCode} must have exactly one target.`, "mappings");
    if (mapping.fallbackGeneralLedgerId != null && !mapping.glSetupRole) fail("fallbackGeneralLedgerId requires glSetupRole.", "mappings");
    if (mapping.glSetupRole != null && (typeof mapping.glSetupRole !== "string" || !mapping.glSetupRole.trim() || mapping.glSetupRole.length > 80)) fail("glSetupRole must be non-empty text.", "mappings");
    if (mapping.accountFlag != null && mapping.accountFlag !== "IS_CASH_OR_BANK") fail("Invalid accountFlag.", "mappings");
    if (mapping.cfsSource != null && !["BS_MOVEMENT", "PL_ADDBACK", "CASH_FLAG"].includes(mapping.cfsSource)) fail("Invalid cfsSource.", "mappings");
    if (mapping.movementKind != null && !["DRAWINGS", "DIVIDENDS", "CAPITAL_INTRODUCED", "TRANSFER", "OTHER"].includes(mapping.movementKind)) fail("Invalid movementKind.", "mappings");
    if (mapping.statement === "CFS" && !mapping.cfsSource) fail("CFS mappings require cfsSource.", "mappings");
    if (mapping.statement !== "CFS" && mapping.cfsSource) fail("cfsSource is valid only for CFS mappings.", "mappings");
    if (mapping.movementKind && mapping.statement !== "CFS" && mapping.statement !== "SCOE") fail("movementKind is valid only for CFS or SCOE mappings.", "mappings");
    if (mapping.accountFlag && mapping.statement !== "BS" && mapping.statement !== "CFS") fail("accountFlag is valid only for BS or CFS mappings.", "mappings");
    for (const [kind, value] of [["accountGroupId", mapping.accountGroupId], ["accountSubGroupId", mapping.accountSubGroupId], ["generalLedgerId", mapping.generalLedgerId], ["glSetupRole", mapping.glSetupRole], ["accountFlag", mapping.accountFlag], ["fallbackGeneralLedgerId", mapping.fallbackGeneralLedgerId]] as const) {
      if (value === undefined || value === null) continue;
      if (kind !== "glSetupRole" && !asInt(value)) fail(`Invalid mapping target ${kind}.`, "mappings");
      const targetKey = `${mapping.statement}:${kind}:${value}`;
      if (targets.has(targetKey)) fail(`Duplicate mapping target ${kind}=${value} in ${mapping.statement}.`, "mappings");
      targets.add(targetKey);
    }
    if (!asOrder(mapping.sortOrder ?? 0)) fail("Mapping sortOrder must be an integer.", "mappings");
  }
  return { lineByKey, formulasByCode };
}

async function validateTargets(tx: Tx, companyId: number, mappings: DefinitionMapping[]) {
  const ids = (key: "accountGroupId" | "accountSubGroupId" | "generalLedgerId" | "fallbackGeneralLedgerId") => [...new Set(mappings.map((m) => m[key]).filter((v): v is number => typeof v === "number"))];
  const groups = ids("accountGroupId");
  if (groups.length) {
    const found = await tx.select({ id: S.accountGroup.id }).from(S.accountGroup).where(and(eq(S.accountGroup.companyId, companyId), inArray(S.accountGroup.id, groups)));
    if (found.length !== groups.length) fail("One or more account groups do not belong to this company.", "mappings");
  }
  const subs = ids("accountSubGroupId");
  if (subs.length) {
    const found = await tx.select({ id: S.accountSubGroup.id }).from(S.accountSubGroup).innerJoin(S.accountGroup, eq(S.accountSubGroup.accountGroupId, S.accountGroup.id))
      .where(and(eq(S.accountGroup.companyId, companyId), inArray(S.accountSubGroup.id, subs)));
    if (found.length !== subs.length) fail("One or more account subgroups do not belong to this company.", "mappings");
  }
  const ledgerIds = [...new Set([...ids("generalLedgerId"), ...ids("fallbackGeneralLedgerId")])];
  if (ledgerIds.length) {
    const found = await tx.select({ id: S.generalLedger.id }).from(S.generalLedger).where(and(eq(S.generalLedger.companyId, companyId), inArray(S.generalLedger.id, ledgerIds)));
    if (found.length !== ledgerIds.length) fail("One or more ledgers do not belong to this company.", "mappings");
  }
  const roleNames = [...new Set(mappings.map((m) => m.glSetupRole).filter((v): v is string => !!v))];
  if (roleNames.length) {
    const assignments = await tx.select({ role: S.generalLedgerSetup.role, generalLedgerId: S.generalLedgerSetup.generalLedgerId })
      .from(S.generalLedgerSetup).where(and(eq(S.generalLedgerSetup.companyId, companyId), inArray(S.generalLedgerSetup.role, roleNames)));
    const assignedIds = assignments.map((r) => r.generalLedgerId).filter((v): v is number => v !== null);
    if (assignedIds.length) {
      const found = await tx.select({ id: S.generalLedger.id }).from(S.generalLedger).where(and(eq(S.generalLedger.companyId, companyId), inArray(S.generalLedger.id, assignedIds)));
      if (found.length !== new Set(assignedIds).size) fail("A GL Setup role resolves to a ledger outside this company.", "mappings");
    }
  }
}

async function writeDefinition(tx: Tx, companyId: number, templateId: number, def: TemplateDefinition) {
  validateDefinition(def);
  await validateTargets(tx, companyId, def.mappings);
  await tx.delete(S.statementLineMapping).where(eq(S.statementLineMapping.templateId, templateId));
  await tx.delete(S.statementLineFormula).where(eq(S.statementLineFormula.templateId, templateId));
  await tx.update(S.statementLine).set({ parentLineId: null }).where(eq(S.statementLine.templateId, templateId));
  await tx.delete(S.statementLine).where(eq(S.statementLine.templateId, templateId));

  const lineIds = new Map<string, number>();
  const pending = [...def.lines];
  while (pending.length) {
    let progressed = false;
    for (let i = 0; i < pending.length;) {
      const line = pending[i];
      const parentId = line.parentCode ? lineIds.get(keyOf(line.statement, line.parentCode)) : null;
      if (line.parentCode && parentId === undefined) { i++; continue; }
      const [inserted] = await tx.insert(S.statementLine).values({
        templateId, statement: line.statement, code: line.code.trim(), label: line.label.trim(), parentLineId: parentId ?? null,
        axis: line.axis ?? (line.statement === "SCOE" ? "ROW" : "LINE"), sortOrder: line.sortOrder, lineType: line.lineType,
        nature: line.nature ?? null, role: line.role ?? null, allowedTypes: line.allowedTypes ?? [], noteNo: line.noteNo ?? null,
        drillDepth: line.drillDepth ?? "NONE", showWhenZero: line.showWhenZero ?? false,
      }).returning({ id: S.statementLine.id });
      lineIds.set(keyOf(line.statement, line.code), inserted.id);
      pending.splice(i, 1); progressed = true;
    }
    if (!progressed) fail("Could not order statement lines by parent. Check for invalid or cyclic parent references.", "lines");
  }
  if (def.formulas.length) await tx.insert(S.statementLineFormula).values(def.formulas.map((f) => ({
    templateId, statement: f.statement, lineId: lineIds.get(keyOf(f.statement, f.lineCode))!, termLineId: lineIds.get(keyOf(f.statement, f.termCode))!, sign: f.sign, sortOrder: f.sortOrder,
  })));
  if (def.mappings.length) await tx.insert(S.statementLineMapping).values(def.mappings.map((m) => ({
    templateId, statement: m.statement, lineId: lineIds.get(keyOf(m.statement, m.lineCode))!,
    accountGroupId: m.accountGroupId ?? null, accountSubGroupId: m.accountSubGroupId ?? null, generalLedgerId: m.generalLedgerId ?? null,
    glSetupRole: m.glSetupRole ?? null, fallbackGeneralLedgerId: m.fallbackGeneralLedgerId ?? null, accountFlag: m.accountFlag ?? null,
    cfsSource: m.cfsSource ?? null, movementKind: m.movementKind ?? null, sortOrder: m.sortOrder ?? 0,
  })));
}

export async function createStatementTemplate(companyId: number, name: string, description: string | null, actor: Actor) {
  if (!name.trim() || name.length > 100) fail("Template name is required (100 characters maximum).", "name");
  return inActorTx(actor, undefined, async (tx) => {
    const [row] = await tx.insert(S.statementTemplate).values({ companyId, name: name.trim(), description: description?.trim() || null, createdBy: actor.userId }).returning();
    return row;
  });
}

export async function replaceStatementTemplateDefinition(companyId: number, templateId: number, definition: TemplateDefinition, actor: Actor) {
  return inActorTx(actor, undefined, async (tx) => {
    const template = await ownedTemplate(tx, companyId, templateId);
    if (template.isSystem) fail("System templates are read-only. Copy this template to customize it.", undefined, 409);
    await writeDefinition(tx, companyId, templateId, definition);
    return getStatementTemplate(companyId, templateId, tx);
  });
}

export async function copyStatementTemplate(companyId: number, sourceId: number, name: string, actor: Actor) {
  const source = await getStatementTemplate(companyId, sourceId);
  const definition: TemplateDefinition = {
    lines: source.lines.map((l: any) => ({
      statement: l.statement, code: l.code, label: l.label, parentCode: l.parentCode, sortOrder: l.sortOrder, axis: l.axis,
      lineType: l.lineType, nature: l.nature, role: l.role, allowedTypes: l.allowedTypes, noteNo: l.noteNo, drillDepth: l.drillDepth, showWhenZero: l.showWhenZero,
    })),
    formulas: source.formulas.map((f: any) => ({ statement: f.statement, lineCode: f.lineCode, termCode: f.termCode, sign: f.sign, sortOrder: f.sortOrder })),
    mappings: source.mappings.map((m: any) => ({
      statement: m.statement, lineCode: m.lineCode, accountGroupId: m.accountGroupId, accountSubGroupId: m.accountSubGroupId,
      generalLedgerId: m.generalLedgerId, glSetupRole: m.glSetupRole, fallbackGeneralLedgerId: m.fallbackGeneralLedgerId,
      accountFlag: m.accountFlag, cfsSource: m.cfsSource, movementKind: m.movementKind, sortOrder: m.sortOrder,
    })),
  };
  if (!name.trim() || name.length > 100) fail("Copy name is required (100 characters maximum).", "name");
  return inActorTx(actor, undefined, async (tx) => {
    const [template] = await tx.insert(S.statementTemplate).values({ companyId, name: name.trim(), description: source.description ?? null, createdBy: actor.userId }).returning();
    await writeDefinition(tx, companyId, template.id, definition);
    return getStatementTemplate(companyId, template.id, tx);
  });
}

export async function setDefaultStatementTemplate(companyId: number, templateId: number, actor: Actor) {
  return inActorTx(actor, undefined, async (tx) => {
    const template = await ownedTemplate(tx, companyId, templateId);
    if (!template.isActive) fail("An inactive template cannot be the default.", undefined, 409);
    await tx.update(S.statementTemplate).set({ isDefault: false, updatedAt: new Date() }).where(eq(S.statementTemplate.companyId, companyId));
    const [updated] = await tx.update(S.statementTemplate).set({ isDefault: true, updatedAt: new Date() }).where(eq(S.statementTemplate.id, templateId)).returning();
    return updated;
  });
}

export async function updateStatementTemplate(companyId: number, templateId: number, patch: { name?: string; description?: string | null; isActive?: boolean }, actor: Actor) {
  if (patch.name !== undefined && (!patch.name.trim() || patch.name.length > 100)) fail("Template name is required (100 characters maximum).", "name");
  if (patch.description !== undefined && patch.description !== null && (typeof patch.description !== "string" || patch.description.length > 500)) fail("Description must be 500 characters or fewer.", "description");
  return inActorTx(actor, undefined, async (tx) => {
    const template = await ownedTemplate(tx, companyId, templateId);
    if (template.isSystem) fail("System templates are read-only. Copy this template to customize it.", undefined, 409);
    const values: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.name !== undefined) values.name = patch.name.trim();
    if (patch.description !== undefined) values.description = patch.description?.trim() || null;
    if (patch.isActive !== undefined) values.isActive = patch.isActive;
    if (patch.isActive === false && template.isDefault) values.isDefault = false;
    const [updated] = await tx.update(S.statementTemplate).set(values).where(eq(S.statementTemplate.id, templateId)).returning();
    return updated;
  });
}

export async function deleteStatementTemplate(companyId: number, templateId: number, actor: Actor) {
  return inActorTx(actor, undefined, async (tx) => {
    const template = await ownedTemplate(tx, companyId, templateId);
    if (template.isSystem) fail("System templates cannot be deleted. Copy the template to customize it.", undefined, 409);
    await tx.delete(S.statementLineMapping).where(eq(S.statementLineMapping.templateId, templateId));
    await tx.delete(S.statementLineFormula).where(eq(S.statementLineFormula.templateId, templateId));
    await tx.update(S.statementLine).set({ parentLineId: null }).where(eq(S.statementLine.templateId, templateId));
    await tx.delete(S.statementLine).where(eq(S.statementLine.templateId, templateId));
    await tx.delete(S.statementTemplate).where(eq(S.statementTemplate.id, templateId));
    return { deleted: true, id: templateId };
  });
}

export async function reportFromStatementTemplate(input: {
  companyId: number; templateId: number; statement: StatementCode; branchId: number; fiscalYear: string; from: string; to: string;
}) {
  const template = await getStatementTemplate(input.companyId, input.templateId);
  const [fy] = await db.select().from(S.fiscalYear).where(and(eq(S.fiscalYear.companyId, input.companyId), eq(S.fiscalYear.code, input.fiscalYear))).limit(1);
  if (!fy) fail("Fiscal year not found for this company.", "fiscalYear", 404);
  const [branch] = await db.select({ id: S.branch.id }).from(S.branch).where(and(eq(S.branch.id, input.branchId), eq(S.branch.companyId, input.companyId))).limit(1);
  if (!branch) fail("Branch not found for this company.", "branchId", 404);
  const fromDate = parseDate(input.from, "from"), toDate = parseDate(input.to, "to");
  const from = fromDate.toISOString().slice(0, 10), to = toDate.toISOString().slice(0, 10);
  if (from > to) fail("A valid from/to date range is required.", "from");
  const fyStart = new Date(fy.startDate).toISOString().slice(0, 10), fyEnd = new Date(fy.endDate).toISOString().slice(0, 10);
  if (from < fyStart || to > fyEnd) fail(`Choose dates within fiscal year ${input.fiscalYear} (${fyStart} to ${fyEnd}).`, "from");
  const kind = input.statement === "PL" ? "profit-loss" : "balance-sheet";
  const rows = await financialReportRows(db, { companyId: input.companyId, branchId: input.branchId, fiscalYear: input.fiscalYear, start: from, end: to, kind });
  const ledgers: EngineLedger[] = rows.map((r) => ({
    id: r.generalLedgerId, code: r.code, name: r.name, accountGroupId: r.accountGroupId, accountSubGroupId: r.accountSubGroupId,
    accountType: r.accountType, isCashOrBank: r.isCashOrBank,
    amount: input.statement === "PL" ? fmt(toMicro(r.debit) - toMicro(r.credit), 6) : r.closing,
  }));
  const lines = template.lines.filter((l: any) => l.statement === input.statement) as EngineLine[];
  const formulas: EngineFormula[] = template.formulas.filter((f: any) => f.statement === input.statement).map((f: any) => ({ lineId: f.lineId, termLineId: f.termLineId, sign: f.sign, sortOrder: f.sortOrder }));
  const mappings: EngineMapping[] = template.mappings.filter((m: any) => m.statement === input.statement).map((m: any) => {
    const { lineId, accountGroupId, accountSubGroupId, generalLedgerId, glSetupRole, fallbackGeneralLedgerId, accountFlag } = m;
    const selector = accountGroupId !== null ? { accountGroupId } : accountSubGroupId !== null ? { accountSubGroupId } : generalLedgerId !== null ? { generalLedgerId }
      : glSetupRole !== null ? { glSetupRole, fallbackGeneralLedgerId } : { accountFlag };
    return { lineId, selector } as EngineMapping;
  });
  const roleRows = await db.select({ role: S.generalLedgerSetup.role, generalLedgerId: S.generalLedgerSetup.generalLedgerId }).from(S.generalLedgerSetup).where(eq(S.generalLedgerSetup.companyId, input.companyId));
  const roleLedgerIds: Record<string, number | null> = Object.fromEntries(roleRows.map((r) => [r.role, r.generalLedgerId]));
  let ledgerAdjustments: Record<number, string> = {};
  let roleAmounts: Record<string, string> = {};
  const warnings: string[] = [];
  if (input.statement === "BS") {
    const allRows = await financialReportRows(db, { companyId: input.companyId, branchId: input.branchId, fiscalYear: input.fiscalYear, start: fyStart, end: to, kind: "profit-loss", excludeActiveCloseJournals: false });
    const ytdResult = allRows.reduce((s, r) => s + toMicro(r.credit) - toMicro(r.debit), 0n);
    const plRoleLedger = roleLedgerIds.PROFIT_AND_LOSS;
    const resultLedger = plRoleLedger ? (await db.select({ id: S.generalLedger.id, accountType: S.accountGroup.type }).from(S.generalLedger).innerJoin(S.accountGroup, eq(S.generalLedger.accountGroupId, S.accountGroup.id)).where(and(eq(S.generalLedger.id, plRoleLedger), eq(S.generalLedger.companyId, input.companyId))).limit(1))[0] : undefined;
    if (resultLedger?.accountType === "EQUITY") ledgerAdjustments = { [resultLedger.id]: fmt(-ytdResult, 6) };
    else {
      roleAmounts = { PROFIT_FOR_PERIOD: fmt(ytdResult, 6) };
      if (resultLedger) warnings.push("Configured Profit and Loss Account ledger is not equity; current-year result is shown separately.");
    }
  }
  try {
    const output = buildStatement({ statement: input.statement, lines, mappings, formulas, ledgers, roleLedgerIds, ledgerAdjustments, roleAmounts });
    const stockWarnings = input.statement === "BS" ? (await stockMismatches(input.companyId, fy.id)).filter((m) => m.branchId === input.branchId) : [];
    return {
      template: { id: template.id, name: template.name, isSystem: template.isSystem, isDefault: template.isDefault },
      fiscalYear: input.fiscalYear, from, to, periodMode: input.statement === "PL" ? "SELECTED_PERIOD" : "AS_OF_END",
      ...output,
      warnings: [...warnings, ...output.warnings, ...stockWarnings.map((m) => `Stock opening mismatch: ${m.ledger} (${m.stock} vs ${m.ledgerBalance}).`)],
      stockOpeningMismatches: stockWarnings,
      checks: [],
    };
  } catch (error) {
    if (error instanceof StatementEngineError) fail(error.message, error.field, 400);
    throw error;
  }
}
