import { fmt, toMicro, type Micro, ZERO } from "../../../shared/purchase-calculation";
import { accountTypeEnum } from "../../db/schema/enums";

type AccountType = (typeof accountTypeEnum.enumValues)[number];

export type StatementCode = "PL" | "BS";
export type LineType = "HEADING" | "MAPPED" | "COMPUTED";
export type Nature = "DEBIT" | "CREDIT";
export type Selector =
  | { accountGroupId: number }
  | { accountSubGroupId: number }
  | { generalLedgerId: number }
  | { glSetupRole: string; fallbackGeneralLedgerId?: number | null }
  | { accountFlag: "IS_CASH_OR_BANK" };

export type EngineLine = {
  id: number;
  code: string;
  label: string;
  statement: StatementCode;
  parentLineId: number | null;
  sortOrder: number;
  lineType: LineType;
  nature: Nature | null;
  role: string | null;
  allowedTypes: AccountType[];
  showWhenZero: boolean;
};

export type EngineMapping = { lineId: number; selector: Selector };
export type EngineFormula = { lineId: number; termLineId: number; sign: -1 | 1; sortOrder: number };
export type EngineLedger = {
  id: number;
  code: string;
  name: string;
  accountGroupId: number;
  accountSubGroupId: number | null;
  accountType: AccountType;
  isCashOrBank: boolean;
  /** Signed balance in debit-positive form. Adapter supplies period movement (PL) or closing balance (BS). */
  amount: string;
};

export type EngineInput = {
  statement: StatementCode;
  lines: EngineLine[];
  mappings: EngineMapping[];
  formulas: EngineFormula[];
  ledgers: EngineLedger[];
  /** GL Setup role -> configured company-local ledger ID, absent when unassigned. */
  roleLedgerIds?: Record<string, number | null | undefined>;
  /** Signed debit-positive ledger adjustments, used for BS current-result folding. */
  ledgerAdjustments?: Record<number, string>;
  /** Precomputed role amounts for computed semantic lines without a formula (e.g. BS fiscal-YTD result). */
  roleAmounts?: Record<string, string>;
};

export type EngineLineResult = {
  id: number;
  code: string;
  label: string;
  parentLineId: number | null;
  lineType: LineType;
  role: string | null;
  amount: string | null;
  visible: boolean;
  children: EngineLineResult[];
};

export type UnmappedLedger = { id: number; code: string; name: string; accountType: AccountType; amount: string };
export type EngineOutput = {
  statement: StatementCode;
  rows: EngineLineResult[];
  roles: Record<string, string>;
  unmapped: UnmappedLedger[];
  warnings: string[];
};

export class StatementEngineError extends Error {
  constructor(message: string, public code: string, public field?: string) {
    super(message);
    this.name = "StatementEngineError";
  }
}

const money = (value: string, field: string): Micro => {
  try {
    return toMicro(value);
  } catch {
    throw new StatementEngineError(`Invalid amount for ${field}.`, "INVALID_AMOUNT", field);
  }
};
const abs = (v: bigint) => v < ZERO ? -v : v;

function validateLineGraph(lines: EngineLine[], statement: StatementCode) {
  const byId = new Map<number, EngineLine>();
  const codes = new Set<string>();
  const roles = new Set<string>();
  for (const line of lines) {
    if (line.statement !== statement) throw new StatementEngineError(`Line ${line.code} belongs to another statement.`, "STATEMENT_MISMATCH", line.code);
    if (!Number.isInteger(line.id) || line.id <= 0 || byId.has(line.id)) throw new StatementEngineError(`Duplicate or invalid line ID ${line.id}.`, "DUPLICATE_LINE", String(line.id));
    if (!line.code || codes.has(line.code)) throw new StatementEngineError(`Duplicate or empty line code ${line.code}.`, "DUPLICATE_LINE_CODE", line.code);
    if (line.role && line.role !== "SCOE_COLUMN") {
      if (roles.has(line.role)) throw new StatementEngineError(`Role ${line.role} must be unique within a template.`, "DUPLICATE_ROLE", line.role);
      roles.add(line.role);
    }
    codes.add(line.code);
    byId.set(line.id, line);
    if (line.lineType === "HEADING" && (line.nature !== null || line.role !== null)) throw new StatementEngineError(`Heading ${line.code} cannot have a nature or role.`, "INVALID_LINE_SHAPE", line.code);
    if (line.lineType === "MAPPED" && (!line.nature || line.allowedTypes.length === 0)) throw new StatementEngineError(`Mapped line ${line.code} requires a nature and allowed account types.`, "INVALID_LINE_SHAPE", line.code);
    if (line.lineType === "COMPUTED" && line.nature !== null) throw new StatementEngineError(`Computed line ${line.code} cannot have a nature.`, "INVALID_LINE_SHAPE", line.code);
  }
  for (const line of lines) if (line.parentLineId !== null) {
    const parent = byId.get(line.parentLineId);
    if (!parent) throw new StatementEngineError(`Parent line for ${line.code} is missing or outside this statement.`, "INVALID_PARENT", line.code);
    if (parent.id === line.id) throw new StatementEngineError(`Line ${line.code} cannot parent itself.`, "LINE_CYCLE", line.code);
  }
  const done = new Set<number>(), active = new Set<number>();
  const visit = (id: number) => {
    if (active.has(id)) throw new StatementEngineError("Statement line hierarchy contains a cycle.", "LINE_CYCLE", String(id));
    if (done.has(id)) return;
    active.add(id);
    const line = byId.get(id)!;
    if (line.parentLineId !== null) visit(line.parentLineId);
    active.delete(id); done.add(id);
  };
  for (const line of lines) visit(line.id);
  return byId;
}

function selectorTargetCount(s: Selector) {
  return ("accountGroupId" in s ? 1 : 0) + ("accountSubGroupId" in s ? 1 : 0) + ("generalLedgerId" in s ? 1 : 0) + ("glSetupRole" in s ? 1 : 0) + ("accountFlag" in s ? 1 : 0);
}

function resolveLedgerLines(input: EngineInput, linesById: Map<number, EngineLine>) {
  const candidates = new Map<number, Map<number, Set<number>>>();
  const add = (ledgerId: number, priority: number, lineId: number) => {
    const line = linesById.get(lineId);
    if (!line || line.lineType !== "MAPPED") throw new StatementEngineError(`Mapping targets a missing or non-mapped line ${lineId}.`, "INVALID_MAPPING", String(lineId));
    const priorities = candidates.get(ledgerId) ?? new Map<number, Set<number>>();
    const claims = priorities.get(priority) ?? new Set<number>();
    claims.add(lineId); priorities.set(priority, claims); candidates.set(ledgerId, priorities);
  };
  const roleIds = input.roleLedgerIds ?? {};
  for (const mapping of input.mappings) {
    if (selectorTargetCount(mapping.selector) !== 1) throw new StatementEngineError(`Mapping for line ${mapping.lineId} must have exactly one target.`, "INVALID_MAPPING", String(mapping.lineId));
    const s = mapping.selector;
    if ("generalLedgerId" in s) add(s.generalLedgerId, 4, mapping.lineId);
    else if ("glSetupRole" in s) {
      const roleLedgerId = roleIds[s.glSetupRole];
      if (roleLedgerId) add(roleLedgerId, 4, mapping.lineId);
      else if (s.fallbackGeneralLedgerId) add(s.fallbackGeneralLedgerId, 4, mapping.lineId);
    } else if ("accountSubGroupId" in s) {
      for (const ledger of input.ledgers) if (ledger.accountSubGroupId === s.accountSubGroupId) add(ledger.id, 3, mapping.lineId);
    } else if ("accountFlag" in s) {
      for (const ledger of input.ledgers) if (ledger.accountType === "ASSET" && ledger.isCashOrBank) add(ledger.id, 2, mapping.lineId);
    } else if ("accountGroupId" in s) {
      for (const ledger of input.ledgers) if (ledger.accountGroupId === s.accountGroupId) add(ledger.id, 1, mapping.lineId);
    }
  }
  const winners = new Map<number, number>();
  for (const [ledgerId, priorities] of candidates) {
    const top = Math.max(...priorities.keys());
    const claims = [...(priorities.get(top) ?? [])];
    if (claims.length > 1) throw new StatementEngineError(`Ledger ${ledgerId} matches multiple mappings at the same specificity.`, "AMBIGUOUS_MAPPING", String(ledgerId));
    winners.set(ledgerId, claims[0]);
  }
  return winners;
}

function evaluateFormulas(input: EngineInput, linesById: Map<number, EngineLine>, values: Map<number, Micro>) {
  const terms = new Map<number, EngineFormula[]>();
  for (const f of input.formulas) {
    const line = linesById.get(f.lineId), term = linesById.get(f.termLineId);
    if (!line || !term || line.statement !== input.statement || term.statement !== input.statement) throw new StatementEngineError("Formula references a missing or cross-statement line.", "INVALID_FORMULA", String(f.lineId));
    if (line.lineType !== "COMPUTED") throw new StatementEngineError(`Formula target ${line.code} is not computed.`, "INVALID_FORMULA", line.code);
    if (f.sign !== 1 && f.sign !== -1) throw new StatementEngineError(`Formula for ${line.code} has an invalid sign.`, "INVALID_FORMULA", line.code);
    const rows = terms.get(f.lineId) ?? [];
    rows.push(f); terms.set(f.lineId, rows);
  }
  for (const rows of terms.values()) rows.sort((a, b) => a.sortOrder - b.sortOrder || a.termLineId - b.termLineId);
  const state = new Map<number, 0 | 1 | 2>();
  const evalLine = (id: number): Micro => {
    const line = linesById.get(id)!;
    if (line.lineType !== "COMPUTED") return values.get(id) ?? ZERO;
    const s = state.get(id) ?? 0;
    if (s === 1) throw new StatementEngineError(`Computed-line formulas contain a cycle at ${line.code}.`, "FORMULA_CYCLE", line.code);
    if (s === 2) return values.get(id) ?? ZERO;
    state.set(id, 1);
    let total = ZERO;
    for (const term of terms.get(id) ?? []) total += BigInt(term.sign) * evalLine(term.termLineId);
    values.set(id, total); state.set(id, 2);
    return total;
  };
  for (const line of input.lines) if (line.lineType === "COMPUTED") {
    if (!terms.has(line.id) && line.role && input.roleAmounts?.[line.role] !== undefined) {
      values.set(line.id, money(input.roleAmounts[line.role], `role ${line.role}`));
      state.set(line.id, 2);
    } else evalLine(line.id);
  }
}

export function buildStatement(input: EngineInput): EngineOutput {
  if (input.statement !== "PL" && input.statement !== "BS") throw new StatementEngineError("Only PL and BS are supported by this engine phase.", "UNSUPPORTED_STATEMENT", "statement");
  const linesById = validateLineGraph(input.lines, input.statement);
  const lineValues = new Map<number, Micro>();
  const winners = resolveLedgerLines(input, linesById);
  const unmapped: UnmappedLedger[] = [];
  const warnings: string[] = [];
  const seenLedgerIds = new Set<number>();
  for (const ledger of input.ledgers) {
    if (seenLedgerIds.has(ledger.id)) throw new StatementEngineError(`Duplicate ledger row ${ledger.id}.`, "DUPLICATE_LEDGER", String(ledger.id));
    seenLedgerIds.add(ledger.id);
    const raw = money(ledger.amount, `ledger ${ledger.code}`) + money(input.ledgerAdjustments?.[ledger.id] ?? "0", `ledger adjustment ${ledger.code}`);
    const lineId = winners.get(ledger.id);
    if (lineId === undefined) {
      if (raw !== ZERO) unmapped.push({ id: ledger.id, code: ledger.code, name: ledger.name, accountType: ledger.accountType, amount: fmt(raw, 2) });
      continue;
    }
    const line = linesById.get(lineId)!;
    if (!line.allowedTypes.includes(ledger.accountType)) {
      throw new StatementEngineError(`Ledger ${ledger.code} (${ledger.accountType}) is not allowed on ${line.code}.`, "ALLOWED_TYPE_VIOLATION", line.code);
    }
    const signed = line.nature === "CREDIT" ? -raw : raw;
    lineValues.set(lineId, (lineValues.get(lineId) ?? ZERO) + signed);
  }
  for (const line of input.lines) if (line.lineType === "MAPPED" && !input.mappings.some((m) => m.lineId === line.id)) {
    warnings.push(`Mapped line ${line.code} has no mapping selectors.`);
  }
  evaluateFormulas(input, linesById, lineValues);

  const childMap = new Map<number | null, EngineLine[]>();
  for (const line of input.lines) {
    const list = childMap.get(line.parentLineId) ?? [];
    list.push(line); childMap.set(line.parentLineId, list);
  }
  for (const list of childMap.values()) list.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  const build = (line: EngineLine): EngineLineResult => {
    const children = (childMap.get(line.id) ?? []).map(build);
    const value = line.lineType === "HEADING" ? null : lineValues.get(line.id) ?? ZERO;
    const visible = line.showWhenZero || value !== null && abs(value) >= 5_000n || children.some((c) => c.visible);
    return {
      id: line.id, code: line.code, label: line.label, parentLineId: line.parentLineId,
      lineType: line.lineType, role: line.role,
      amount: value === null ? null : fmt(value, 2), visible, children,
    };
  };
  const rows = (childMap.get(null) ?? []).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id).map(build);
  const roles: Record<string, string> = {};
  for (const line of input.lines) if (line.role && line.role !== "SCOE_COLUMN") {
    const value = lineValues.get(line.id);
    if (value !== undefined) roles[line.role] = fmt(value, 2);
  }
  return { statement: input.statement, rows, roles, unmapped, warnings };
}
