import { useEffect, useMemo, useState, type MutableRefObject } from "react";
import { RotateCw, Save } from "lucide-react";
import { ApiError, entryControlApi, type EntryControlData } from "../api";
import { ENTRY_RULE_LEVELS, resolveEntry, type EntryControlKind, type EntryFeature, type EntryRuleLevel } from "../../shared/entryControl";
import type { MsgKind, StatusInfo } from "../types";

interface Props { companyId: number; userId: number; setStatus: (status: StatusInfo) => void; dirtyRef: MutableRefObject<boolean> }
const HINTS = ["Ctrl+S save"];
const COLUMNS: { kind: EntryControlKind; label: string; on: string; off: string }[] = [
  { kind: "show", label: "Show", on: "Show", off: "Hide" },
  { kind: "edit", label: "Edit", on: "Editable", off: "No edit" },
  { kind: "mandatory", label: "Mandatory", on: "Mandatory", off: "Optional" },
];

// Entry Control: what each source module shows, lets the user change, insists on, and how it reacts to a broken rule. Per company.
export default function EntryControlScreen({ companyId, userId, setStatus, dirtyRef }: Props) {
  const [data, setData] = useState<EntryControlData | null>(null);
  const [draft, setDraft] = useState<EntryControlData["controls"]>({});
  const [saved, setSaved] = useState("");
  const [moduleKey, setModuleKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; kind: MsgKind }>({ text: "Loading Entry Control…", kind: "info" });
  const dirty = !!saved && JSON.stringify(draft) !== saved;

  const apply = (d: EntryControlData) => { setData(d); setDraft(d.controls); setSaved(JSON.stringify(d.controls)); setModuleKey((k) => k || d.modules[0]?.key || ""); };
  const load = () => entryControlApi.get(companyId).then((d) => { apply(d); setMsg({ text: "Entry Control loaded.", kind: "ok" }); })
    .catch((e) => setMsg({ text: e instanceof ApiError ? e.message : "Could not load Entry Control.", kind: "err" }));
  useEffect(() => { void load(); }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { dirtyRef.current = dirty; }, [dirty, dirtyRef]);
  useEffect(() => { setStatus({ mode: dirty ? "edit" : "view", count: data?.modules.length ?? 0, shown: data?.modules.length ?? 0, message: msg.text, kind: msg.kind, hints: HINTS }); }, [dirty, data, msg, setStatus]);

  const mod = data?.modules.find((m) => m.key === moduleKey);
  const set = (f: EntryFeature, patch: Partial<{ show: boolean; edit: boolean; mandatory: boolean; rule: EntryRuleLevel }>) =>
    setDraft((cur) => ({ ...cur, [moduleKey]: { ...cur[moduleKey], [f.key]: resolveEntry(f, { ...cur[moduleKey]?.[f.key], ...patch }) } }));

  const save = async () => {
    if (busy || !dirty) return;
    setBusy(true);
    try { apply(await entryControlApi.save(companyId, userId, draft)); setMsg({ text: "Entry Control saved.", kind: "ok" }); }
    catch (e) { setMsg({ text: e instanceof ApiError ? e.message : "Could not save Entry Control.", kind: "err" }); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void save(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const groups = useMemo(() => {
    const out: { group: string; features: EntryFeature[] }[] = [];
    for (const f of mod?.features ?? []) { const g = out.find((x) => x.group === f.group); if (g) g.features.push(f); else out.push({ group: f.group, features: [f] }); }
    return out;
  }, [mod]);

  return (
    <main className="ledger flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Entry Control">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <div>
          <h1 className="lg-title">Entry Control</h1>
          <p className="mt-1 text-[12px] text-slate-500">For each source module: what to show, what the user may edit, what is mandatory, and how rules react (Ignore / Warn / Block). Applies to this company.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="btn" disabled={dirty || busy} onClick={() => void load()} title={dirty ? "Save changes before reloading." : "Reload"}><RotateCw size={14} /> Reload</button>
          <button type="button" className="btn btn-primary" disabled={!dirty || busy} onClick={() => void save()}><Save size={14} /> {busy ? "Saving…" : "Save"}</button>
        </div>
      </header>
      <div className="flex shrink-0 gap-1 border-b border-slate-200 bg-white px-4 pt-2" role="tablist">
        {data?.modules.map((m) => (
          <button key={m.key} type="button" role="tab" aria-selected={m.key === moduleKey} onClick={() => setModuleKey(m.key)}
            className={`rounded-t-md border border-b-0 px-3 py-1.5 text-[12px] font-medium ${m.key === moduleKey ? "border-slate-300 bg-slate-50 text-blue-800" : "border-transparent text-slate-600 hover:bg-slate-100"}`}>{m.label}</button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-slate-50 p-4">
        {groups.map(({ group, features }) => (
          <section key={group} className="mb-4 overflow-hidden rounded-md border border-slate-200 bg-white">
            <div className="border-b bg-slate-100 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600">{group}</div>
            <table className="w-full text-[12px]">
              <thead><tr className="text-left text-slate-500"><th className="px-3 py-1.5 font-medium">Feature</th>{COLUMNS.map((c) => <th key={c.kind} className="px-3 py-1.5 font-medium">{c.label}</th>)}<th className="px-3 py-1.5 font-medium">If the rule is broken</th></tr></thead>
              <tbody>
                {features.map((f) => {
                  const v = draft[moduleKey]?.[f.key] ?? resolveEntry(f);
                  return (
                    <tr key={f.key} className="border-t">
                      <td className="px-3 py-1.5"><div className="font-medium text-slate-800">{f.label}</div>{f.hint && <div className="text-[11px] text-slate-500">{f.hint}</div>}</td>
                      {COLUMNS.map((c) => (
                        <td key={c.kind} className="px-3 py-1.5">
                          {f.controls.includes(c.kind) ? (
                            <label className="flex items-center gap-1.5 text-slate-700">
                              <input type="checkbox" className="accent-blue-800" checked={v[c.kind as "show" | "edit" | "mandatory"]} disabled={c.kind === "mandatory" && !v.show}
                                onChange={(e) => set(f, { [c.kind]: e.target.checked })} aria-label={`${f.label}: ${c.label}`} />
                              {v[c.kind as "show" | "edit" | "mandatory"] ? c.on : c.off}
                            </label>
                          ) : <span className="text-slate-300">—</span>}
                        </td>
                      ))}
                      <td className="px-3 py-1.5">
                        {f.controls.includes("rule")
                          ? <select className="fld" value={v.rule} onChange={(e) => set(f, { rule: e.target.value as EntryRuleLevel })} aria-label={`${f.label}: rule`}>{ENTRY_RULE_LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}</select>
                          : <span className="text-slate-300">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </main>
  );
}
