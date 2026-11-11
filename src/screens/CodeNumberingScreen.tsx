import { useEffect, useMemo, useState, type MutableRefObject } from "react";
import { RotateCcw, Save } from "lucide-react";
import { ApiError, codeRulesApi } from "../api";
import { codeSpec, nextCode, prefixOf, templateProblems, type CodeMode, type CodeRuleRow } from "../../shared/codeRules";
import { DataTable, type Column } from "../components/table/DataTable";
import type { MsgKind, StatusInfo } from "../types";

// Settings > Code Numbering: how the code of each master is suggested. Pick a master on the left, set its mode and rule on the right and
// try it with a sample name / type / parent before saving. A suggested code is only a suggestion: the user can always type their own.

interface Props {
  companyId: number; userId: number;
  setStatus: (s: StatusInfo) => void;
  dirtyRef: MutableRefObject<boolean>;
  externalMessage: { text: string; n: number } | null;
}

const TOKENS: [string, string, string][] = [
  ["{PARENT}", "Parent's code", "the code of the parent master"],
  ["{NAME2}", "Name, 2 letters", "the first two letters of the name"],
  ["{TYPE}", "Type letter", "one letter for the type"],
  ["{SEQ:3}", "Running number", "the running number, 3 digits (must be last)"],
];
const HINTS = ["↑↓ choose a master", "Enter edit the rule", "Ctrl+S save"];

export default function CodeNumberingScreen({ companyId, userId, setStatus, dirtyRef }: Props) {
  const [rules, setRules] = useState<CodeRuleRow[]>([]);
  const [key, setKey] = useState<string>("");
  const [mode, setMode] = useState<CodeMode>("MANUAL");
  const [template, setTemplate] = useState("");
  const [sample, setSample] = useState({ name: "Ramesh Traders", type: "", parent: "10" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; kind: MsgKind }>({ text: "Ready", kind: "info" });

  const load = async (keep?: string) => {
    try {
      const r = await codeRulesApi.list(companyId);
      setRules(r);
      const pick = r.find((x) => x.key === (keep ?? key)) ?? r[0];
      if (pick) choose(pick);
    } catch (e) { setMsg({ text: e instanceof ApiError ? e.message : "Could not load the rules.", kind: "err" }); }
  };
  const choose = (r: CodeRuleRow) => {
    setKey(r.key); setMode(r.mode); setTemplate(r.template);
    const s = codeSpec(r.key);
    setSample((p) => ({ ...p, type: s?.typeLetters ? Object.keys(s.typeLetters)[0] : "" }));
  };
  useEffect(() => { void load(); }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const rule = rules.find((r) => r.key === key);
  const spec = codeSpec(key);
  const dirty = !!rule && (mode !== rule.mode || template.trim().toUpperCase() !== rule.template);
  useEffect(() => { dirtyRef.current = dirty; });
  useEffect(() => setStatus({ mode: dirty ? "edit" : "view", count: rules.length, shown: rules.length, message: msg.text, kind: msg.kind, hints: HINTS }), [dirty, rules.length, msg, setStatus]);

  const problems = useMemo(() => (spec ? templateProblems(spec, template) : []), [spec, template]);
  const preview = useMemo(() => {
    if (!spec || problems.length) return "";
    const p = prefixOf(spec, template, { parent: sample.parent, name: sample.name, type: sample.type });
    if (!p) return "";
    const first = nextCode(p.prefix, p.width, []);
    return `${first}, ${nextCode(p.prefix, p.width, [first])}, ${nextCode(p.prefix, p.width, [first, nextCode(p.prefix, p.width, [first])])}`;
  }, [spec, template, problems, sample]);

  const save = async () => {
    if (!rule || busy || problems.length) return;
    setBusy(true);
    try {
      const r = await codeRulesApi.save(companyId, rule.key, { mode, template: template.trim().toUpperCase() }, userId);
      setRules((cur) => cur.map((x) => (x.key === r.key ? r : x)));
      setTemplate(r.template); setMode(r.mode);
      setMsg({ text: `${r.label}: rule saved.`, kind: "ok" });
    } catch (e) { setMsg({ text: e instanceof ApiError ? e.message : "Could not save the rule.", kind: "err" }); }
    finally { setBusy(false); }
  };
  const resetDefault = () => { if (rule) { setMode(rule.defaultMode); setTemplate(rule.defaultTemplate); } };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void save(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const columns: Column<CodeRuleRow>[] = [
    { key: "module", header: "Module", width: "90px" },
    { key: "label", header: "Master" },
    { key: "mode", header: "Mode", width: "86px", render: (r) => (r.mode === "SUGGESTED" ? "Suggested" : "Manual") },
    { key: "template", header: "Rule", width: "150px", render: (r) => <span className="font-mono">{r.mode === "MANUAL" ? "—" : r.template}</span> },
    { key: "example", header: "Example", width: "100px", render: (r) => <span className="font-mono">{r.mode === "MANUAL" ? "typed" : r.example || "—"}</span> },
  ];

  const insert = (tok: string) => setTemplate((t) => {
    const hasSeq = /\{SEQ:\d\}$/.test(t.trim().toUpperCase());
    return tok.startsWith("{SEQ") ? (hasSeq ? t.replace(/\{SEQ:\d\}$/i, tok) : t + tok) : hasSeq ? t.replace(/(\{SEQ:\d\})$/i, tok + "$1") : t + tok;
  });

  return (
    <div className="flex min-h-0 flex-1 gap-3 p-3">
      <section className="lg-card flex min-w-0 flex-[3] flex-col" aria-label="Rules">
        <div className="border-b border-slate-200 px-3 py-2 text-[12px] text-slate-600">
          The code of a new record is <b>suggested</b> from its master's rule: the next number under the same prefix. The user can overtype it.
        </div>
        <div className="lg-scroll min-h-0 flex-1 overflow-auto">
          <DataTable
            columns={columns} rows={rules} rowKey={(r) => r.key} label="Code numbering rules" fixed
            selected={new Set(key ? [key] : [])} onSelectedChange={(k) => { const next = rules.find((r) => k.has(r.key)); if (next && next.key !== key) choose(next); }}
            onActivate={() => document.querySelector<HTMLElement>("[data-cn=template]")?.focus()}
          />
        </div>
      </section>

      {rule && spec && (
        <section className="lg-card flex min-w-[330px] flex-[2] flex-col gap-3 overflow-auto p-4" aria-label={`Rule for ${rule.label}`}>
          <div>
            <h2 className="text-[15px] font-semibold text-ink">{rule.label}</h2>
            <p className="text-[12px] text-slate-500">{rule.isDefault ? "Using the built-in rule." : "Rule saved for this company."} Code holds up to {rule.codeMax} characters.</p>
          </div>

          <fieldset className="space-y-1">
            <legend className="mb-1 text-[12px] font-medium text-slate-700">Mode</legend>
            {([["SUGGESTED", "Suggested", "the form proposes the next code; the user can change it"], ["MANUAL", "Manual", "the user always types the code"]] as const).map(([v, label, d]) => (
              <label key={v} className="flex items-start gap-2 text-[13px]">
                <input type="radio" name="cn-mode" className="mt-1 accent-blue-800" checked={mode === v} onChange={() => setMode(v)} />
                <span><b>{label}</b> <span className="text-slate-500">— {d}</span></span>
              </label>
            ))}
          </fieldset>

          <div className={mode === "MANUAL" ? "opacity-50" : ""}>
            <label className="block text-[12px] font-medium text-slate-700" htmlFor="cn-template">Rule</label>
            <input id="cn-template" data-cn="template" autoComplete="off" spellCheck={false} maxLength={60} value={template} onChange={(e) => setTemplate(e.target.value.toUpperCase())}
              className={`fld mt-1 h-8 font-mono ${problems.length && mode === "SUGGESTED" ? "fld-err" : ""}`} aria-invalid={problems.length > 0} aria-describedby="cn-problems" />
            <div className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Add a token">
              {TOKENS.map(([tok, label, hint]) => {
                const off = (tok === "{PARENT}" && !spec.parentField) || (tok === "{TYPE}" && !spec.typeField) || (tok === "{NAME2}" && !spec.nameField);
                return <button key={tok} type="button" disabled={off} title={off ? `${rule.label} has none` : hint} onClick={() => insert(tok)} className="btn h-6 px-2 text-[11px] disabled:opacity-40">{label} <span className="font-mono text-slate-500">{tok}</span></button>;
              })}
            </div>
            <p id="cn-problems" role={problems.length ? "alert" : undefined} className={`mt-1.5 min-h-[16px] text-[12px] ${problems.length ? "text-rose-700" : "text-slate-500"}`}>{problems[0] ?? ""}</p>
          </div>

          <div className="rounded border border-slate-200 bg-slate-50 p-3">
            <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-slate-500">Try it</h3>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-[12px]">
              {spec.nameField && <label className="col-span-2">Name<input className="fld mt-0.5 h-7" value={sample.name} onChange={(e) => setSample((s) => ({ ...s, name: e.target.value }))} /></label>}
              {spec.typeField && spec.typeLetters && (
                <label>Type<select className="fld mt-0.5 h-7" value={sample.type} onChange={(e) => setSample((s) => ({ ...s, type: e.target.value }))}>
                  {Object.entries(spec.typeLetters).map(([t, l]) => <option key={t} value={t}>{t.replace("_", " ").toLowerCase()} ({l})</option>)}
                </select></label>
              )}
              {spec.parentField && <label>{spec.parentLabel} code<input className="fld mt-0.5 h-7 font-mono" value={sample.parent} onChange={(e) => setSample((s) => ({ ...s, parent: e.target.value.toUpperCase() }))} /></label>}
            </div>
            <p className="mt-2 text-[12px] text-slate-600">First codes made: <b className="font-mono text-ink">{mode === "MANUAL" ? "typed by the user" : preview || "—"}</b></p>
          </div>

          <div className="mt-auto flex items-center gap-2">
            <button type="button" className="btn btn-primary" disabled={!dirty || busy || problems.length > 0} onClick={save}><Save size={14} /> Save <span className="kbd">Ctrl+S</span></button>
            <button type="button" className="btn" disabled={mode === rule.defaultMode && template === rule.defaultTemplate} onClick={resetDefault}><RotateCcw size={14} /> Built-in rule</button>
          </div>
        </section>
      )}
    </div>
  );
}

