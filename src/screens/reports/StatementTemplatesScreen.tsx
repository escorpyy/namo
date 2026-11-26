import { useEffect, useMemo, useState, type MutableRefObject } from "react";
import { Copy, FilePlus2, FileText, LoaderCircle, Save, Settings2, Star, Trash2 } from "lucide-react";
import {
  glSetupApi,
  masterApi,
  statementTemplatesApi,
  type StatementTemplate,
  type StatementTemplateDefinition,
  type StatementTemplateStatement,
  type StatementTemplateSummary,
} from "../../api";
import type { Row } from "../../lib/form";
import type { StatusInfo } from "../../types";
import { StatementDefinitionEditor } from "../../components/statementTemplates/StatementDefinitionEditor";
import { StatementTemplateReport } from "../../components/statementTemplates/StatementTemplateReport";

const STATEMENTS: StatementTemplateStatement[] = ["PL", "BS", "CFS", "SCOE"];
const statementTitle: Record<StatementTemplateStatement, string> = { PL: "P&L", BS: "Balance Sheet", CFS: "Cash Flow", SCOE: "Changes in Equity" };
const blankDefinition = (): StatementTemplateDefinition => ({ lines: [], formulas: [], mappings: [] });
function definitionFrom(template: StatementTemplate): StatementTemplateDefinition {
  return {
    lines: template.lines.map(({ statement, code, label, parentCode, sortOrder, axis, lineType, nature, role, allowedTypes, noteNo, drillDepth, showWhenZero }) => ({ statement, code, label, parentCode, sortOrder, axis, lineType, nature, role, allowedTypes, noteNo, drillDepth, showWhenZero })),
    formulas: template.formulas.map(({ statement, lineCode, termCode, sign, sortOrder }) => ({ statement, lineCode, termCode, sign, sortOrder })),
    mappings: template.mappings.map(({ statement, lineCode, accountGroupId, accountSubGroupId, generalLedgerId, glSetupRole, fallbackGeneralLedgerId, accountFlag, cfsSource, movementKind, sortOrder }) => ({ statement, lineCode, accountGroupId, accountSubGroupId, generalLedgerId, glSetupRole, fallbackGeneralLedgerId, accountFlag, cfsSource, movementKind, sortOrder })),
  };
}
function snapshot(name: string, description: string, definition: StatementTemplateDefinition) { return JSON.stringify({ name, description, definition }); }

export default function StatementTemplatesScreen(p: {
  companyId: number; branchId: number; branchName: string; userId: number; companyName: string; fyCode: string; fyStart: string; fyEnd: string;
  setStatus: (status: StatusInfo) => void; dirtyRef: MutableRefObject<boolean>;
}) {
  const [templates, setTemplates] = useState<StatementTemplateSummary[]>([]);
  const [selectedId, setSelectedId] = useState(0);
  const [template, setTemplate] = useState<StatementTemplate | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [definition, setDefinition] = useState<StatementTemplateDefinition>(blankDefinition());
  const [savedSnapshot, setSavedSnapshot] = useState("");
  const [activeStatement, setActiveStatement] = useState<StatementTemplateStatement>("PL");
  const [tab, setTab] = useState<"definition" | "report">("definition");
  const [lookups, setLookups] = useState<{ groups: Row[]; subgroups: Row[]; ledgers: Awaited<ReturnType<typeof glSetupApi.get>>["ledgers"]; roles: Awaited<ReturnType<typeof glSetupApi.get>>["roles"] }>({ groups: [], subgroups: [], ledgers: [], roles: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lookupWarning, setLookupWarning] = useState("");
  const currentSnapshot = snapshot(name, description, definition);
  const dirty = !!savedSnapshot && !!template && !template.isSystem && currentSnapshot !== savedSnapshot;
  const activeLineCount = useMemo(() => definition.lines.filter((line) => line.statement === activeStatement).length, [definition.lines, activeStatement]);

  const reloadList = async (preferredId?: number) => {
    const result = await statementTemplatesApi.list(p.companyId);
    setTemplates(result);
    const nextId = preferredId && result.some((row) => row.id === preferredId) ? preferredId : result.find((row) => row.isDefault)?.id ?? result[0]?.id ?? 0;
    setSelectedId(nextId);
  };

  useEffect(() => {
    let live = true;
    setLoading(true); setError("");
    setLookupWarning("");
    Promise.allSettled([
      masterApi("account-groups").list(p.companyId),
      masterApi("account-sub-groups").list(p.companyId),
      glSetupApi.get(p.companyId),
    ]).then(([groupsResult, subgroupsResult, setupResult]) => {
      if (!live) return;
      const groups = groupsResult.status === "fulfilled" ? groupsResult.value : [];
      const subgroups = subgroupsResult.status === "fulfilled" ? subgroupsResult.value : [];
      const setup = setupResult.status === "fulfilled" ? setupResult.value : { ledgers: [], roles: [] };
      const failures = [groupsResult, subgroupsResult, setupResult].filter((result) => result.status === "rejected").length;
      setLookupWarning(failures ? `Template management is available, but ${failures} mapping lookup${failures === 1 ? " is" : "s are"} unavailable. Some selector lists may be incomplete.` : "");
      setLookups({ groups, subgroups, ledgers: setup.ledgers, roles: setup.roles });
    });
    statementTemplatesApi.list(p.companyId).then((list) => {
      if (!live) return;
      setTemplates(list);
      setSelectedId((current) => current && list.some((row) => row.id === current) ? current : list.find((row) => row.isDefault)?.id ?? list[0]?.id ?? 0);
    }).catch((e: Error) => { if (live) setError(e.message || "Could not load statement templates."); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [p.companyId]);

  useEffect(() => {
    let live = true;
    if (!selectedId) { setTemplate(null); setName(""); setDescription(""); setDefinition(blankDefinition()); setSavedSnapshot(""); return; }
    setLoading(true); setError("");
    statementTemplatesApi.get(p.companyId, selectedId).then((result) => {
      if (!live) return;
      const nextDefinition = definitionFrom(result);
      setTemplate(result); setName(result.name); setDescription(result.description ?? ""); setDefinition(nextDefinition); setSavedSnapshot(snapshot(result.name, result.description ?? "", nextDefinition));
    }).catch((e: Error) => { if (live) { setTemplate(null); setError(e.message || "Could not load this template."); } })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [p.companyId, selectedId]);

  useEffect(() => { p.dirtyRef.current = dirty; return () => { p.dirtyRef.current = false; }; }, [dirty, p.dirtyRef]);
  useEffect(() => {
    p.setStatus({ mode: dirty ? "edit" : "view", count: templates.length, shown: templates.length, message: error || (loading ? "Loading statement templates…" : dirty ? "Unsaved template changes" : lookupWarning || (template ? `${template.name} ready` : "No statement templates configured")), kind: error ? "err" : dirty || lookupWarning ? "warn" : "info", hints: ["Custom templates only can be edited", "PL and BS reports are available"] });
  }, [dirty, error, loading, lookupWarning, template, templates.length, p.setStatus]);

  const openTemplate = (id: number) => {
    if (id === selectedId) return;
    if (dirty && !window.confirm("Discard unsaved template changes and open another template?")) return;
    setSelectedId(id); setTab("definition"); setActiveStatement("PL");
  };
  const createTemplate = async () => {
    if (dirty) return;
    const nextName = window.prompt("Name for the new statement template:", "New statement template");
    if (!nextName?.trim()) return;
    setBusy(true); setError("");
    try {
      const created = await statementTemplatesApi.create(p.companyId, p.userId, nextName.trim());
      await reloadList(created.id);
    } catch (e) { setError((e as Error).message || "Could not create the template."); }
    finally { setBusy(false); }
  };
  const copyTemplate = async () => {
    if (!template || dirty) return;
    const nextName = window.prompt("Name for the copied template:", `${template.name} copy`);
    if (!nextName?.trim()) return;
    setBusy(true); setError("");
    try {
      const copied = await statementTemplatesApi.copy(p.companyId, p.userId, template.id, nextName.trim());
      await reloadList(copied.id);
    } catch (e) { setError((e as Error).message || "Could not copy the template."); }
    finally { setBusy(false); }
  };
  const save = async () => {
    if (!template || template.isSystem || busy) return;
    if (!name.trim()) { setError("Template name is required."); return; }
    setBusy(true); setError("");
    try {
      if (JSON.stringify(definition) !== JSON.stringify(definitionFrom(template))) await statementTemplatesApi.replaceDefinition(p.companyId, p.userId, template.id, definition);
      if (name !== template.name || description !== (template.description ?? "")) await statementTemplatesApi.update(p.companyId, p.userId, template.id, { name: name.trim(), description: description || null });
      const [fresh, list] = await Promise.all([statementTemplatesApi.get(p.companyId, template.id), statementTemplatesApi.list(p.companyId)]);
      const freshDefinition = definitionFrom(fresh);
      setTemplate(fresh); setTemplates(list); setName(fresh.name); setDescription(fresh.description ?? ""); setDefinition(freshDefinition); setSavedSnapshot(snapshot(fresh.name, fresh.description ?? "", freshDefinition));
    } catch (e) { setError((e as Error).message || "Could not save template changes."); }
    finally { setBusy(false); }
  };
  const setDefault = async () => {
    if (!template || template.isDefault || busy) return;
    setBusy(true); setError("");
    try { await statementTemplatesApi.setDefault(p.companyId, p.userId, template.id); await reloadList(template.id); }
    catch (e) { setError((e as Error).message || "Could not set the default template."); }
    finally { setBusy(false); }
  };
  const toggleActive = async () => {
    if (!template || template.isSystem || busy) return;
    if (dirty) { setError("Save or discard your edits before changing template status."); return; }
    setBusy(true); setError("");
    try {
      const updated = await statementTemplatesApi.update(p.companyId, p.userId, template.id, { isActive: !template.isActive });
      await reloadList(updated.id);
    } catch (e) { setError((e as Error).message || "Could not update template status."); }
    finally { setBusy(false); }
  };
  const deleteTemplate = async () => {
    if (!template || template.isSystem || busy) return;
    if (dirty) { setError("Save or discard your edits before deleting this template."); return; }
    if (!window.confirm(`Delete “${template.name}”? Its lines, formulas, and mappings will also be deleted.`)) return;
    setBusy(true); setError("");
    try { await statementTemplatesApi.remove(p.companyId, p.userId, template.id); await reloadList(); }
    catch (e) { setError((e as Error).message || "Could not delete the template."); }
    finally { setBusy(false); }
  };

  return <main className="ledger flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Statement Templates">
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
      <div><div className="text-[11px] font-semibold uppercase tracking-wide text-blue-700">Financial Statements · {p.companyName}</div><h1 className="lg-title">Statement Templates</h1><p className="mt-1 text-xs text-slate-500">Manage mapped statement layouts and preview PL/BS reports for {p.branchName} · FY {p.fyCode}.</p></div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn" disabled={busy || loading || dirty} title={dirty ? "Save or discard changes first." : "Create a blank company template"} onClick={() => void createTemplate()}><FilePlus2 size={14} />New template</button>
        {template && <button type="button" className="btn" disabled={busy || loading || dirty} onClick={() => void copyTemplate()}><Copy size={14} />Copy</button>}
        {template && !template.isSystem && <button type="button" className="btn btn-danger" disabled={busy || loading || dirty} title={dirty ? "Save or discard changes first." : "Delete custom template"} onClick={() => void deleteTemplate()}><Trash2 size={14} />Delete</button>}
        {template && <button type="button" className="btn btn-primary" disabled={!dirty || busy || template.isSystem} onClick={() => void save()}><Save size={14} />{busy ? "Saving…" : "Save changes"}</button>}
      </div>
    </header>
    {error && <div role="alert" className="mx-4 mt-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
    {lookupWarning && <div role="status" className="mx-4 mt-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">{lookupWarning}</div>}
    <div className="lg-scroll grid min-h-0 flex-1 grid-cols-1 overflow-auto xl:grid-cols-[270px_minmax(0,1fr)]">
      <aside className="border-b bg-slate-100 p-3 xl:border-b-0 xl:border-r" aria-label="Template list">
        <div className="mb-2 flex items-center justify-between"><h2 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Company templates</h2><span className="lg-count">{templates.length}</span></div>
        {loading && !templates.length ? <div className="rounded border bg-white p-4 text-center text-xs text-slate-500"><LoaderCircle className="mr-1 inline animate-spin" size={14} />Loading…</div> : templates.length ? <div className="space-y-2">
          {templates.map((row) => <button key={row.id} type="button" className={`w-full rounded border p-3 text-left transition-colors ${row.id === selectedId ? "border-blue-500 bg-white shadow-sm ring-1 ring-blue-200" : "border-slate-200 bg-white hover:border-slate-400"}`} onClick={() => openTemplate(row.id)}>
            <span className="flex items-start justify-between gap-2"><span className="font-semibold text-slate-800">{row.name}</span>{row.isDefault && <Star size={14} className="shrink-0 fill-amber-400 text-amber-500" aria-label="Default template" />}</span>
            <span className="mt-2 flex flex-wrap gap-1">{row.isSystem && <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[9px] font-medium text-purple-800">SYSTEM</span>}{row.isDefault && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium text-amber-800">DEFAULT</span>}{!row.isActive && <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[9px] font-medium text-slate-700">INACTIVE</span>}</span>
            <span className="mt-2 block text-[10px] text-slate-500">{row.statementsPresent?.length ? row.statementsPresent.map((s) => statementTitle[s]).join(" · ") : "No statement lines yet"}</span>
          </button>)}
        </div> : <div className="rounded border border-dashed bg-white p-5 text-center text-xs text-slate-500"><FileText className="mx-auto mb-2 text-slate-400" size={20} />No templates found. Create a template to define statement lines and mappings.</div>}
      </aside>

      <section className="min-w-0 p-3 sm:p-4">
        {loading && !template ? <div className="rounded border bg-white p-8 text-center text-sm text-slate-500"><LoaderCircle className="mr-2 inline animate-spin" size={16} />Loading template…</div> : !template ? <div className="rounded border border-dashed bg-white p-10 text-center text-sm text-slate-500">Select a template or create a new one.</div> : <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded border bg-white p-3">
            <div className="min-w-[220px] flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="text-base font-semibold text-slate-900">{template.name}</h2>{template.isSystem && <span className="rounded bg-purple-100 px-2 py-0.5 text-[10px] font-semibold text-purple-800">System · read-only</span>}{template.isDefault && <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">Default</span>}{!template.isActive && <span className="rounded bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-700">Inactive</span>}</div><p className="mt-1 text-xs text-slate-500">{template.isSystem ? "Copy this system template to make company-specific changes." : "Changes affect this company only."}</p></div>
            <div className="flex flex-wrap gap-2">
              {!template.isDefault && template.isActive && <button type="button" className="btn" disabled={busy || dirty} onClick={() => void setDefault()}><Star size={14} />Set default</button>}
              {!template.isSystem && <button type="button" className="btn" disabled={busy || dirty} onClick={() => void toggleActive()}><Settings2 size={14} />{template.isActive ? "Deactivate" : "Activate"}</button>}
            </div>
          </div>
          {!template.isSystem && <section className="mb-3 grid gap-3 rounded border bg-white p-3 md:grid-cols-[minmax(180px,0.7fr)_minmax(280px,1.3fr)]">
            <label className="text-xs font-medium text-slate-600">Template name<input className="fld mt-1" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label className="text-xs font-medium text-slate-600">Description<input className="fld mt-1" maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional purpose or reporting basis" /></label>
          </section>}
          <div className="mb-3 flex flex-wrap items-center gap-1 border-b border-slate-300">
            <button type="button" className={`border-b-2 px-3 py-2 text-xs font-semibold ${tab === "definition" ? "border-blue-700 text-blue-800" : "border-transparent text-slate-500 hover:text-slate-800"}`} onClick={() => setTab("definition")}>Definition</button>
            <button type="button" className={`border-b-2 px-3 py-2 text-xs font-semibold ${tab === "report" ? "border-blue-700 text-blue-800" : "border-transparent text-slate-500 hover:text-slate-800"}`} onClick={() => setTab("report")}>Report preview</button>
            {dirty && <span className="ml-auto rounded bg-amber-100 px-2 py-1 text-[10px] font-medium text-amber-800">Unsaved changes</span>}
          </div>
          {tab === "definition" ? <>
            <div className="mb-3 flex flex-wrap items-center gap-1 rounded border bg-white p-1">{STATEMENTS.map((statement) => <button key={statement} type="button" className={`rounded px-3 py-1.5 text-xs font-medium ${activeStatement === statement ? "bg-blue-800 text-white" : "text-slate-600 hover:bg-slate-100"}`} onClick={() => setActiveStatement(statement)}>{statementTitle[statement]}<span className={`ml-1.5 rounded px-1 ${activeStatement === statement ? "bg-white/15" : "bg-slate-100"}`}>{definition.lines.filter((line) => line.statement === statement).length}</span></button>)}<span className="ml-auto px-2 text-[10px] text-slate-500">PL &amp; BS report preview supported in this phase</span></div>
            {activeLineCount > 0 && !template.isSystem && <p className="mb-2 text-[11px] text-slate-500">Use the line editor to add statement rows, mappings and formula terms. Save validates parent and formula references.</p>}
            <StatementDefinitionEditor definition={definition} statement={activeStatement} readOnly={template.isSystem || !template.isActive || busy} lookups={lookups} onChange={setDefinition} />
          </> : <>
            {!template.isActive && <div className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">This template is inactive. Activate it before running a report.</div>}
            {template.isActive ? <StatementTemplateReport key={`${template.id}:${p.branchId}:${p.fyCode}`} companyId={p.companyId} templateId={template.id} branchId={p.branchId} branchName={p.branchName} fyCode={p.fyCode} fyStart={p.fyStart} fyEnd={p.fyEnd} /> : <div className="rounded border border-dashed bg-white p-8 text-center text-sm text-slate-500">Inactive templates cannot run new reports. Activate this template to preview it.</div>}
          </>}
        </>}
      </section>
    </div>
  </main>;
}
