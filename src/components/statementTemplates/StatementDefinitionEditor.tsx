import { Plus, Trash2 } from "lucide-react";
import type {
  StatementAccountType,
  StatementTemplateDefinition,
  StatementTemplateFormulaDefinition,
  StatementTemplateLineDefinition,
  StatementTemplateLineType,
  StatementTemplateMappingDefinition,
  StatementTemplateStatement,
} from "../../api";
import type { GLSetupRole, GLSetupLedger } from "../../api";
import type { Row } from "../../lib/form";

type TargetKind = "accountGroupId" | "accountSubGroupId" | "generalLedgerId" | "glSetupRole" | "accountFlag";
type Lookups = { groups: Row[]; subgroups: Row[]; ledgers: GLSetupLedger[]; roles: GLSetupRole[] };
type Props = {
  definition: StatementTemplateDefinition;
  statement: StatementTemplateStatement;
  readOnly: boolean;
  lookups: Lookups;
  onChange: (next: StatementTemplateDefinition) => void;
};

const ACCOUNT_TYPES: StatementAccountType[] = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"];
const statementNames: Record<StatementTemplateStatement, string> = { PL: "Profit & Loss", BS: "Balance Sheet", CFS: "Cash Flow", SCOE: "Changes in Equity" };
const control = "fld min-w-0";
const moneyType: Record<StatementTemplateStatement, StatementAccountType[]> = {
  PL: ["REVENUE", "EXPENSE"], BS: ["ASSET", "LIABILITY", "EQUITY"], CFS: ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"], SCOE: ["EQUITY", "REVENUE", "EXPENSE"],
};
const targetKeys: TargetKind[] = ["accountGroupId", "accountSubGroupId", "generalLedgerId", "glSetupRole", "accountFlag"];
const targetLabels: Record<TargetKind, string> = { accountGroupId: "Account group", accountSubGroupId: "Subgroup", generalLedgerId: "Ledger", glSetupRole: "GL Setup role", accountFlag: "Cash / bank flag" };
const targetOf = (mapping: StatementTemplateMappingDefinition): TargetKind => targetKeys.find((key) => mapping[key] !== undefined && mapping[key] !== null) ?? "accountGroupId";
const targetValue = (mapping: StatementTemplateMappingDefinition) => {
  const key = targetOf(mapping);
  if (key === "accountFlag") return mapping.accountFlag ? "IS_CASH_OR_BANK" : "";
  return String(mapping[key] ?? "");
};
const labelOf = (row: Row) => `${row.code ?? ""}${row.code ? " — " : ""}${row.description ?? row.name ?? ""}`;
const glLabel = (row: GLSetupLedger) => `${row.code} — ${row.name}`;

function emptyMapping(statement: StatementTemplateStatement, lineCode: string): StatementTemplateMappingDefinition {
  return { statement, lineCode, sortOrder: 0, ...(statement === "CFS" ? { cfsSource: "BS_MOVEMENT" as const } : {}) };
}
function selectTarget(mapping: StatementTemplateMappingDefinition, kind: TargetKind): StatementTemplateMappingDefinition {
  const next: StatementTemplateMappingDefinition = { ...mapping };
  for (const key of targetKeys) delete next[key];
  if (kind === "accountFlag") next.accountFlag = "IS_CASH_OR_BANK";
  else if (kind === "glSetupRole") next.glSetupRole = "";
  else next[kind] = null;
  return next;
}

export function StatementDefinitionEditor({ definition, statement, readOnly, lookups, onChange }: Props) {
  const lines = definition.lines.filter((line) => line.statement === statement).slice().sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
  const updateLine = (code: string, patch: Partial<StatementTemplateLineDefinition>) => {
    const nextCode = patch.code ?? code;
    const rename = nextCode !== code;
    onChange({
      ...definition,
      lines: definition.lines.map((line) => line.statement === statement && line.code === code ? { ...line, ...patch } : rename && line.statement === statement && line.parentCode === code ? { ...line, parentCode: nextCode } : line),
      formulas: rename ? definition.formulas.map((formula) => formula.statement === statement ? { ...formula, lineCode: formula.lineCode === code ? nextCode : formula.lineCode, termCode: formula.termCode === code ? nextCode : formula.termCode } : formula) : definition.formulas,
      mappings: rename ? definition.mappings.map((mapping) => mapping.statement === statement && mapping.lineCode === code ? { ...mapping, lineCode: nextCode } : mapping) : definition.mappings,
    });
  };
  const addLine = () => {
    const codes = new Set(lines.map((line) => line.code));
    let n = 1; while (codes.has(`LINE_${n}`)) n++;
    const newLine: StatementTemplateLineDefinition = {
      statement, code: `LINE_${n}`, label: "New statement line", parentCode: null, sortOrder: lines.length * 10 + 10,
      axis: statement === "SCOE" ? "ROW" : "LINE", lineType: "HEADING", nature: null, role: null, allowedTypes: [], noteNo: null, drillDepth: "NONE", showWhenZero: true,
    };
    onChange({ ...definition, lines: [...definition.lines, newLine] });
  };
  const removeLine = (code: string) => onChange({
    ...definition,
    lines: definition.lines.filter((line) => !(line.statement === statement && line.code === code)).map((line) => line.statement === statement && line.parentCode === code ? { ...line, parentCode: null } : line),
    formulas: definition.formulas.filter((formula) => formula.statement !== statement || formula.lineCode !== code && formula.termCode !== code),
    mappings: definition.mappings.filter((mapping) => mapping.statement !== statement || mapping.lineCode !== code),
  });
  const updateMapping = (index: number, patch: Partial<StatementTemplateMappingDefinition>) => {
    const rows = definition.mappings.slice(); rows[index] = { ...rows[index], ...patch }; onChange({ ...definition, mappings: rows });
  };
  const addMapping = (lineCode: string) => onChange({ ...definition, mappings: [...definition.mappings, emptyMapping(statement, lineCode)] });
  const removeMapping = (index: number) => onChange({ ...definition, mappings: definition.mappings.filter((_, i) => i !== index) });
  const updateFormula = (index: number, patch: Partial<StatementTemplateFormulaDefinition>) => {
    const rows = definition.formulas.slice(); rows[index] = { ...rows[index], ...patch }; onChange({ ...definition, formulas: rows });
  };
  const addFormula = (lineCode: string) => {
    const termCode = lines.find((line) => line.code !== lineCode && line.lineType !== "HEADING")?.code ?? "";
    onChange({ ...definition, formulas: [...definition.formulas, { statement, lineCode, termCode, sign: 1, sortOrder: definition.formulas.filter((formula) => formula.statement === statement && formula.lineCode === lineCode).length }] });
  };
  const removeFormula = (index: number) => onChange({ ...definition, formulas: definition.formulas.filter((_, i) => i !== index) });
  const mappingIndices = definition.mappings.map((mapping, index) => ({ mapping, index })).filter(({ mapping }) => mapping.statement === statement);
  const formulaIndices = definition.formulas.map((formula, index) => ({ formula, index })).filter(({ formula }) => formula.statement === statement);

  return <section className="space-y-3" aria-label={`${statementNames[statement]} statement definition`}>
    <div className="flex flex-wrap items-center justify-between gap-2 rounded border bg-slate-50 px-3 py-2">
      <div><h2 className="font-semibold text-slate-800">{statementNames[statement]} definition</h2><p className="text-xs text-slate-500">Set display order, hierarchy, line behavior, mapping selectors, and formulas.</p></div>
      <button type="button" className="btn" disabled={readOnly} onClick={addLine}><Plus size={14} /> Add line</button>
    </div>
    <div role="note" className="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-950">
      <p><strong>Line code is an internal name for this template row</strong> (for example, <code className="rounded bg-white px-1">SALES_REVENUE</code>). It is not your ledger/account code. The starter code like <code className="rounded bg-white px-1">LINE_1</code> can be renamed.</p>
      <p className="mt-1">To connect a real account, choose <strong>Mapped</strong>, then add an <strong>Account mapping selector</strong> below and select the ledger, group, or GL Setup role. Use line codes to organize parent rows and refer to source lines in formulas.</p>
    </div>
    {!lines.length ? <div className="rounded border border-dashed bg-white p-8 text-center text-sm text-slate-500">No lines in this statement yet. Add a heading, mapped line, or computed line.</div> : lines.map((line) => {
      const lineMappings = mappingIndices.filter(({ mapping }) => mapping.lineCode === line.code);
      const lineFormulas = formulaIndices.filter(({ formula }) => formula.lineCode === line.code);
      return <article key={`${statement}:${line.code}`} className="rounded border bg-white shadow-sm">
        <div className="grid gap-2 p-3 md:grid-cols-12">
          <label className="text-[11px] font-medium text-slate-600 md:col-span-2" title="Internal reference for this template line, not a ledger/account code.">Template line code<input className={`${control} mt-1`} maxLength={64} placeholder="e.g. SALES_REVENUE" value={line.code} disabled={readOnly} onChange={(e) => updateLine(line.code, { code: e.target.value.toUpperCase() })} /></label>
          <label className="text-[11px] font-medium text-slate-600 md:col-span-4">Caption<input className={`${control} mt-1`} maxLength={160} value={line.label} disabled={readOnly} onChange={(e) => updateLine(line.code, { label: e.target.value })} /></label>
          <label className="text-[11px] font-medium text-slate-600 md:col-span-2">Line kind<select className={`${control} mt-1`} value={line.lineType} disabled={readOnly} onChange={(e) => {
            const lineType = e.target.value as StatementTemplateLineType;
            updateLine(line.code, lineType === "HEADING" ? { lineType, nature: null, role: null, allowedTypes: [] } : lineType === "MAPPED" ? { lineType, nature: "DEBIT", role: null, allowedTypes: moneyType[statement] } : { lineType, nature: null, allowedTypes: [] });
          }}><option value="HEADING">Heading</option><option value="MAPPED">Mapped</option><option value="COMPUTED">Computed</option></select></label>
          <label className="text-[11px] font-medium text-slate-600 md:col-span-2">Parent template line<select className={`${control} mt-1`} value={line.parentCode ?? ""} disabled={readOnly} onChange={(e) => updateLine(line.code, { parentCode: e.target.value || null })}><option value="">Top level</option>{lines.filter((other) => other.code !== line.code).map((other) => <option key={other.code} value={other.code}>{other.code} — {other.label}</option>)}</select></label>
          <label className="text-[11px] font-medium text-slate-600 md:col-span-1">Order<input className={`${control} mt-1`} type="number" value={line.sortOrder} disabled={readOnly} onChange={(e) => updateLine(line.code, { sortOrder: Number(e.target.value) || 0 })} /></label>
          <div className="flex items-end justify-end md:col-span-1"><button type="button" className="btn btn-danger" title="Remove line" aria-label={`Remove line ${line.code}`} disabled={readOnly} onClick={() => removeLine(line.code)}><Trash2 size={14} /></button></div>
          {line.lineType === "MAPPED" && <>
            <label className="text-[11px] font-medium text-slate-600 md:col-span-2">Natural sign<select className={`${control} mt-1`} value={line.nature ?? "DEBIT"} disabled={readOnly} onChange={(e) => updateLine(line.code, { nature: e.target.value as "DEBIT" | "CREDIT" })}><option value="DEBIT">Debit</option><option value="CREDIT">Credit</option></select></label>
            <fieldset className="md:col-span-6"><legend className="text-[11px] font-medium text-slate-600">Allowed account types</legend><div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">{ACCOUNT_TYPES.map((type) => <label key={type} className="flex items-center gap-1 text-xs"><input type="checkbox" checked={(line.allowedTypes ?? []).includes(type)} disabled={readOnly} onChange={(e) => updateLine(line.code, { allowedTypes: e.target.checked ? [...new Set([...(line.allowedTypes ?? []), type])] : (line.allowedTypes ?? []).filter((value) => value !== type) })} />{type}</label>)}</div></fieldset>
          </>}
          {line.lineType !== "HEADING" && <label className="text-[11px] font-medium text-slate-600 md:col-span-2">Statement role<input className={`${control} mt-1`} maxLength={80} value={line.role ?? ""} placeholder="Optional" disabled={readOnly} onChange={(e) => updateLine(line.code, { role: e.target.value || null })} /></label>}
          <label className="text-[11px] font-medium text-slate-600 md:col-span-1">Note no.<input className={`${control} mt-1`} maxLength={30} value={line.noteNo ?? ""} placeholder="—" disabled={readOnly} onChange={(e) => updateLine(line.code, { noteNo: e.target.value || null })} /></label>
          <label className="text-[11px] font-medium text-slate-600 md:col-span-2">Drill level<select className={`${control} mt-1`} value={line.drillDepth ?? "NONE"} disabled={readOnly} onChange={(e) => updateLine(line.code, { drillDepth: e.target.value as StatementTemplateLineDefinition["drillDepth"] })}><option value="NONE">None</option><option value="GROUP">Group</option><option value="SUBGROUP">Subgroup</option><option value="LEDGER">Ledger</option></select></label>
          {statement === "SCOE" && <label className="text-[11px] font-medium text-slate-600 md:col-span-2">Axis<select className={`${control} mt-1`} value={line.axis ?? "ROW"} disabled={readOnly} onChange={(e) => updateLine(line.code, { axis: e.target.value as "ROW" | "COLUMN" })}><option value="ROW">Row</option><option value="COLUMN">Column</option></select></label>}
          <label className="flex items-center gap-2 self-end pb-1 text-xs text-slate-700 md:col-span-2"><input type="checkbox" checked={line.showWhenZero ?? false} disabled={readOnly} onChange={(e) => updateLine(line.code, { showWhenZero: e.target.checked })} />Show when zero</label>
        </div>

        {line.lineType === "MAPPED" && <div className="border-t bg-slate-50/70 p-3">
          <div className="mb-2 flex items-center justify-between gap-2"><div><h3 className="text-xs font-semibold text-slate-700">Account mapping selectors</h3><p className="text-[11px] text-slate-500">Connect this template line to actual ledger accounts. More-specific selectors win when multiple selectors match.</p></div><button type="button" className="btn h-7" disabled={readOnly} onClick={() => addMapping(line.code)}><Plus size={13} /> Add selector</button></div>
          {!lineMappings.length ? <p className="rounded border border-dashed bg-white px-3 py-2 text-xs text-amber-800">No selectors yet; amounts will appear in the unmapped list.</p> : <div className="space-y-2">{lineMappings.map(({ mapping, index }) => {
            const kind = targetOf(mapping), value = targetValue(mapping);
            const chooseTarget = (nextKind: TargetKind) => updateMapping(index, selectTarget(mapping, nextKind));
            return <div key={`${mapping.lineCode}:${index}`} className="grid gap-2 rounded border bg-white p-2 md:grid-cols-12">
              <label className="text-[10px] font-medium text-slate-600 md:col-span-2">Match by<select className={`${control} mt-1`} value={kind} disabled={readOnly} onChange={(e) => chooseTarget(e.target.value as TargetKind)}>{targetKeys.filter((key) => key !== "accountFlag" || statement === "BS" || statement === "CFS").map((key) => <option key={key} value={key}>{targetLabels[key]}</option>)}</select></label>
              <label className="text-[10px] font-medium text-slate-600 md:col-span-4">Target
                {kind === "accountFlag" ? <select className={`${control} mt-1`} value={value} disabled={readOnly} onChange={(e) => updateMapping(index, { accountFlag: e.target.value ? "IS_CASH_OR_BANK" : null })}><option value="">Choose flag</option><option value="IS_CASH_OR_BANK">Cash or bank ledger</option></select>
                  : kind === "glSetupRole" ? <select className={`${control} mt-1`} value={value} disabled={readOnly} onChange={(e) => updateMapping(index, { glSetupRole: e.target.value })}><option value="">Choose role</option>{lookups.roles.map((role) => <option key={role.role} value={role.role}>{role.label}</option>)}</select>
                    : <select className={`${control} mt-1`} value={value} disabled={readOnly} onChange={(e) => updateMapping(index, { [kind]: e.target.value ? Number(e.target.value) : null })}>
                      <option value="">Choose {targetLabels[kind].toLowerCase()}</option>
                      {(kind === "accountGroupId" ? lookups.groups : kind === "accountSubGroupId" ? lookups.subgroups : lookups.ledgers).map((row: any) => <option key={row.id} value={row.id}>{kind === "generalLedgerId" ? glLabel(row) : labelOf(row)}</option>)}
                    </select>}
              </label>
              {kind === "glSetupRole" && <label className="text-[10px] font-medium text-slate-600 md:col-span-3">Fallback ledger<select className={`${control} mt-1`} value={mapping.fallbackGeneralLedgerId ?? ""} disabled={readOnly} onChange={(e) => updateMapping(index, { fallbackGeneralLedgerId: e.target.value ? Number(e.target.value) : null })}><option value="">None</option>{lookups.ledgers.map((ledger) => <option key={ledger.id} value={ledger.id}>{glLabel(ledger)}</option>)}</select></label>}
              {statement === "CFS" && <label className="text-[10px] font-medium text-slate-600 md:col-span-2">Cash-flow source<select className={`${control} mt-1`} value={mapping.cfsSource ?? "BS_MOVEMENT"} disabled={readOnly} onChange={(e) => updateMapping(index, { cfsSource: e.target.value as StatementTemplateMappingDefinition["cfsSource"] })}><option value="BS_MOVEMENT">Balance-sheet movement</option><option value="PL_ADDBACK">P&amp;L add-back</option><option value="CASH_FLAG">Cash flag</option></select></label>}
              {(statement === "CFS" || statement === "SCOE") && <label className="text-[10px] font-medium text-slate-600 md:col-span-2">Movement kind<select className={`${control} mt-1`} value={mapping.movementKind ?? ""} disabled={readOnly} onChange={(e) => updateMapping(index, { movementKind: (e.target.value || null) as StatementTemplateMappingDefinition["movementKind"] })}><option value="">Not specified</option>{["DRAWINGS", "DIVIDENDS", "CAPITAL_INTRODUCED", "TRANSFER", "OTHER"].map((kindName) => <option key={kindName} value={kindName}>{kindName.replaceAll("_", " ")}</option>)}</select></label>}
              <div className="flex items-end justify-end md:col-span-1"><button type="button" className="btn btn-danger h-7" aria-label={`Remove mapping for ${line.code}`} disabled={readOnly} onClick={() => removeMapping(index)}><Trash2 size={13} /></button></div>
            </div>;
          })}</div>}
        </div>}

        {line.lineType === "COMPUTED" && <div className="border-t bg-slate-50/70 p-3">
          <div className="mb-2 flex items-center justify-between gap-2"><div><h3 className="text-xs font-semibold text-slate-700">Formula</h3><p className="text-[11px] text-slate-500">Terms are added in order; computed lines may reference other computed lines.</p></div><button type="button" className="btn h-7" disabled={readOnly} onClick={() => addFormula(line.code)}><Plus size={13} /> Add term</button></div>
          {!lineFormulas.length ? <p className="rounded border border-dashed bg-white px-3 py-2 text-xs text-slate-500">No formula terms. This line will calculate as zero unless it has a supported semantic role.</p> : <div className="space-y-2">{lineFormulas.map(({ formula, index }) => <div key={`${formula.lineCode}:${index}`} className="grid gap-2 rounded border bg-white p-2 md:grid-cols-12">
            <label className="text-[10px] font-medium text-slate-600 md:col-span-2">Term order<input className={`${control} mt-1`} type="number" value={formula.sortOrder} disabled={readOnly} onChange={(e) => updateFormula(index, { sortOrder: Number(e.target.value) || 0 })} /></label>
            <label className="text-[10px] font-medium text-slate-600 md:col-span-6">Source template line<select className={`${control} mt-1`} value={formula.termCode} disabled={readOnly} onChange={(e) => updateFormula(index, { termCode: e.target.value })}><option value="">Choose line</option>{lines.filter((other) => other.code !== line.code && other.lineType !== "HEADING").map((other) => <option key={other.code} value={other.code}>{other.code} — {other.label}</option>)}</select></label>
            <label className="text-[10px] font-medium text-slate-600 md:col-span-2">Sign<select className={`${control} mt-1`} value={formula.sign} disabled={readOnly} onChange={(e) => updateFormula(index, { sign: Number(e.target.value) as -1 | 1 })}><option value={1}>Add</option><option value={-1}>Subtract</option></select></label>
            <div className="flex items-end justify-end md:col-span-2"><button type="button" className="btn btn-danger h-7" aria-label={`Remove formula term from ${line.code}`} disabled={readOnly} onClick={() => removeFormula(index)}><Trash2 size={13} /></button></div>
          </div>)}</div>}
        </div>}
      </article>;
    })}
    <div className="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-[11px] leading-5 text-blue-900">
      Mapping priority is ledger → subgroup → account group; ties at equal specificity are reported as conflicts. A mapped ledger’s account type must be included above. All formulas use signed account balances and are evaluated with fixed-point arithmetic.
    </div>
  </section>;
}
