import { useEffect, useMemo, useState, type MutableRefObject } from "react";
import { Plus, Save } from "lucide-react";
import { ApiError, numberSeriesApi } from "../api";
import { DOCUMENT_TYPES, exampleNumbers, seriesProblems, type AssignAt, type SeriesMode, type SeriesRow } from "../../shared/numberSeries";
import { DataTable, type Column } from "../components/table/DataTable";
import type { CompanyCtx, MsgKind, StatusInfo } from "../types";

// Settings > Number Series: how the number of each document is made. A company can keep several series for one kind of document
// (cash CV-001 and bank BV-001), choose who may use each, or let the user type any number. Changes apply to future documents only.

interface Props {
  companyId: number; userId: number; company: CompanyCtx;
  setStatus: (s: StatusInfo) => void;
  dirtyRef: MutableRefObject<boolean>;
  externalMessage: { text: string; n: number } | null;
}

type Draft = {
  id: number | null; documentType: string; name: string; prefix: string; suffix: string; padding: string; startNumber: string; endNumber: string; increment: string;
  mode: SeriesMode; assignAt: AssignAt; resetPerFy: boolean; perBranch: boolean; isDefault: boolean; isActive: boolean;
  allUsers: boolean; allBranches: boolean; userIds: number[]; branchIds: number[];
};
const blank = (documentType: string): Draft => ({
  id: null, documentType, name: "", prefix: "", suffix: "", padding: "4", startNumber: "1", endNumber: "", increment: "1", mode: "AUTOMATIC", assignAt: "DRAFT",
  resetPerFy: true, perBranch: true, isDefault: false, isActive: true, allUsers: true, allBranches: true, userIds: [], branchIds: [],
});
const fromRow = (r: SeriesRow): Draft => ({
  id: r.id, documentType: r.documentType, name: r.name, prefix: r.prefix, suffix: r.suffix, padding: String(r.padding), startNumber: String(r.startNumber),
  endNumber: r.endNumber === null ? "" : String(r.endNumber), increment: String(r.increment), mode: r.mode, assignAt: r.assignAt, resetPerFy: r.resetPerFy,
  perBranch: r.perBranch, isDefault: r.isDefault, isActive: r.isActive, allUsers: r.allUsers, allBranches: r.allBranches, userIds: r.userIds, branchIds: r.branchIds,
});
const num = (v: string) => (v.trim() === "" ? NaN : Number(v));
const same = (a: Draft, b: Draft) => JSON.stringify({ ...a, userIds: [...a.userIds].sort(), branchIds: [...a.branchIds].sort() }) === JSON.stringify({ ...b, userIds: [...b.userIds].sort(), branchIds: [...b.branchIds].sort() });
const HINTS = ["↑↓ choose a series", "Ctrl+S save"];
const MODES: [SeriesMode, string, string][] = [
  ["AUTOMATIC", "Automatic", "the system gives the number; it cannot be changed"],
  ["SUGGESTED", "Suggested", "the system proposes the number; the user may type another"],
  ["MANUAL", "Manual", "the user always types the number"],
];

export default function NumberSeriesScreen({ companyId, userId, company, setStatus, dirtyRef }: Props) {
  const [rows, setRows] = useState<SeriesRow[]>([]);
  const [users, setUsers] = useState<{ id: number; name: string }[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; kind: MsgKind }>({ text: "Ready", kind: "info" });

  const open = (d: Draft) => { setDraft(d); setSaved(d); };
  const load = async (keep?: number | null) => {
    try {
      const [r, u] = await Promise.all([numberSeriesApi.list(companyId), numberSeriesApi.users()]);
      setRows(r); setUsers(u);
      const pick = r.find((x) => x.id === keep) ?? r[0];
      open(pick ? fromRow(pick) : blank(DOCUMENT_TYPES[0].key));
    } catch (e) { setMsg({ text: e instanceof ApiError ? e.message : "Could not load the series.", kind: "err" }); }
  };
  useEffect(() => { void load(); }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = !!draft && !!saved && !same(draft, saved);
  useEffect(() => { dirtyRef.current = dirty; });
  useEffect(() => setStatus({ mode: draft?.id ? (dirty ? "edit" : "view") : "new", count: rows.length, shown: rows.length, message: msg.text, kind: msg.kind, hints: HINTS }), [dirty, draft?.id, rows.length, msg, setStatus]);

  const parsed = useMemo(() => draft && ({
    name: draft.name, prefix: draft.prefix.trim().toUpperCase(), suffix: draft.suffix.trim().toUpperCase(), padding: num(draft.padding), startNumber: num(draft.startNumber),
    endNumber: draft.endNumber.trim() === "" ? null : num(draft.endNumber), increment: num(draft.increment), mode: draft.mode,
  }), [draft]);
  const problems = useMemo(() => (parsed ? seriesProblems(parsed) : []), [parsed]);
  const extra = draft && !draft.allUsers && !draft.userIds.length ? "Choose at least one user, or allow all users."
    : draft && !draft.allBranches && !draft.branchIds.length ? "Choose at least one branch, or allow all branches." : "";
  const problem = problems[0] ?? extra;
  const preview = parsed && !problems.length && draft?.mode !== "MANUAL" ? exampleNumbers(parsed, { fiscalYear: "2082/083", branch: company.branches[0]?.name.slice(0, 4).toUpperCase() ?? "" }, 4) : [];

  const set = (p: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...p } : d));
  const toggle = (k: "userIds" | "branchIds", id: number) => setDraft((d) => (d ? { ...d, [k]: d[k].includes(id) ? d[k].filter((x) => x !== id) : [...d[k], id] } : d));

  const save = async () => {
    if (!draft || busy || problem || !dirty) return;
    setBusy(true);
    try {
      const body = { ...parsed, documentType: draft.documentType, assignAt: draft.assignAt, resetPerFy: draft.resetPerFy, perBranch: draft.perBranch, isDefault: draft.isDefault, isActive: draft.isActive,
        allUsers: draft.allUsers, allBranches: draft.allBranches, userIds: draft.userIds, branchIds: draft.branchIds };
      const r = await numberSeriesApi.save(companyId, draft.id, body, userId);
      setMsg({ text: `${r.name}: saved. It applies to documents made from now on.`, kind: "ok" });
      await load(r.id);
    } catch (e) { setMsg({ text: e instanceof ApiError ? e.message : "Could not save the series.", kind: "err" }); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void save(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const label = (k: string) => DOCUMENT_TYPES.find((d) => d.key === k)?.label ?? k;
  const columns: Column<SeriesRow>[] = [
    { key: "documentType", header: "Document", width: "130px", render: (r) => label(r.documentType) },
    { key: "name", header: "Series", render: (r) => <>{r.name}{r.isDefault ? " ★" : ""}{r.isActive ? "" : " (off)"}</> },
    { key: "mode", header: "Mode", width: "86px", render: (r) => MODES.find((m) => m[0] === r.mode)?.[1] ?? r.mode },
    { key: "example", header: "Example", width: "120px", render: (r) => <span className="font-mono">{r.mode === "MANUAL" ? "typed" : r.example[0] ?? "—"}</span> },
    { key: "who", header: "Who", width: "110px", render: (r) => `${r.allUsers ? "All users" : `${r.userIds.length} user(s)`}` },
    { key: "where", header: "Branches", width: "100px", render: (r) => (r.allBranches ? "All" : `${r.branchIds.length} branch(es)`) },
    { key: "used", header: "Used", width: "60px", kind: "number", render: (r) => r.used },
  ];
  const lbl = "block text-[12px] font-medium text-slate-700";

  return (
    <div className="flex min-h-0 flex-1 gap-3 p-3">
      <section className="lg-card flex min-w-0 flex-[3] flex-col" aria-label="Number series">
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2 text-[12px] text-slate-600">
          <span>Each kind of document can have several series. ★ is the default one. Changes apply to future documents only.</span>
          <button type="button" className="btn shrink-0" onClick={() => open(blank(draft?.documentType ?? DOCUMENT_TYPES[0].key))}><Plus size={14} /> New series</button>
        </div>
        <div className="lg-scroll min-h-0 flex-1 overflow-auto">
          <DataTable
            columns={columns} rows={rows} rowKey={(r) => String(r.id)} label="Number series" fixed
            selected={new Set(draft?.id ? [String(draft.id)] : [])}
            onSelectedChange={(k) => { const next = rows.find((r) => k.has(String(r.id))); if (next && next.id !== draft?.id) open(fromRow(next)); }}
            onActivate={() => document.querySelector<HTMLElement>("[data-ns=name]")?.focus()}
          />
        </div>
      </section>

      {draft && (
        <section className="lg-card flex min-w-[360px] flex-[2] flex-col gap-3 overflow-auto p-4" aria-label="Series details">
          <h2 className="text-[15px] font-semibold text-ink">{draft.id ? draft.name || "Series" : "New series"}</h2>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            <label className={lbl}>Document
              <select className="fld mt-1 h-8" disabled={!!draft.id} value={draft.documentType} onChange={(e) => set({ documentType: e.target.value })}>
                {DOCUMENT_TYPES.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
              </select>
            </label>
            <label className={lbl}>Series name
              <input data-ns="name" className="fld mt-1 h-8" maxLength={60} autoComplete="off" value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="Local purchase" />
            </label>
          </div>

          <fieldset className="space-y-1">
            <legend className="mb-1 text-[12px] font-medium text-slate-700">Mode</legend>
            {MODES.map(([v, l, d]) => (
              <label key={v} className="flex items-start gap-2 text-[13px]">
                <input type="radio" name="ns-mode" className="mt-1 accent-blue-800" checked={draft.mode === v} onChange={() => set({ mode: v })} />
                <span><b>{l}</b> <span className="text-slate-500">— {d}</span></span>
              </label>
            ))}
          </fieldset>

          <div className={`grid grid-cols-3 gap-x-3 gap-y-2 ${draft.mode === "MANUAL" ? "opacity-50" : ""}`}>
            <label className={lbl}>Prefix<input className="fld mt-1 h-8 font-mono" maxLength={20} value={draft.prefix} onChange={(e) => set({ prefix: e.target.value.toUpperCase() })} placeholder="LP-" /></label>
            <label className={lbl}>Padding<input className="fld mt-1 h-8 text-right" inputMode="numeric" value={draft.padding} onChange={(e) => set({ padding: e.target.value })} /></label>
            <label className={lbl}>Suffix<input className="fld mt-1 h-8 font-mono" maxLength={20} value={draft.suffix} onChange={(e) => set({ suffix: e.target.value.toUpperCase() })} placeholder="/{FY}" /></label>
            <label className={lbl}>Start<input className="fld mt-1 h-8 text-right" inputMode="numeric" value={draft.startNumber} onChange={(e) => set({ startNumber: e.target.value })} /></label>
            <label className={lbl}>End <span className="font-normal text-slate-500">(blank = none)</span><input className="fld mt-1 h-8 text-right" inputMode="numeric" value={draft.endNumber} onChange={(e) => set({ endNumber: e.target.value })} /></label>
            <label className={lbl}>Increase by<input className="fld mt-1 h-8 text-right" inputMode="numeric" value={draft.increment} onChange={(e) => set({ increment: e.target.value })} /></label>
            <p className="col-span-3 text-[11px] text-slate-500">Prefix and suffix may hold <span className="font-mono">{"{FY}"}</span> (fiscal year) and <span className="font-mono">{"{BRANCH}"}</span> (branch code).</p>
          </div>

          <div className="rounded border border-slate-200 bg-slate-50 p-3 text-[12px]">
            <p className="text-slate-600">First numbers: <b className="font-mono text-ink">{draft.mode === "MANUAL" ? "typed by the user" : preview.join(", ") || "—"}</b></p>
            <p role={problem ? "alert" : undefined} className={`mt-1 min-h-[16px] ${problem ? "text-rose-700" : "text-slate-500"}`}>{problem}</p>
          </div>

          {draft.mode !== "MANUAL" && (
            <fieldset className="space-y-1 text-[13px]">
              <legend className="mb-1 text-[12px] font-medium text-slate-700">Counting</legend>
              <label className="flex items-center gap-2"><input type="checkbox" className="accent-blue-800" checked={draft.perBranch} onChange={(e) => set({ perBranch: e.target.checked })} /> A separate count for each branch</label>
              <label className="flex items-center gap-2"><input type="checkbox" className="accent-blue-800" checked={draft.resetPerFy} onChange={(e) => set({ resetPerFy: e.target.checked })} /> Start again every fiscal year</label>
            </fieldset>
          )}

          <fieldset className="space-y-1 text-[13px]">
            <legend className="mb-1 text-[12px] font-medium text-slate-700">Who can use it</legend>
            <label className="flex items-center gap-2"><input type="radio" name="ns-users" className="accent-blue-800" checked={draft.allUsers} onChange={() => set({ allUsers: true })} /> All users</label>
            <label className="flex items-center gap-2"><input type="radio" name="ns-users" className="accent-blue-800" checked={!draft.allUsers} onChange={() => set({ allUsers: false })} /> Only chosen users</label>
            {!draft.allUsers && <div className="ml-6 flex flex-wrap gap-x-4 gap-y-1">{users.map((u) => <label key={u.id} className="flex items-center gap-1.5"><input type="checkbox" className="accent-blue-800" checked={draft.userIds.includes(u.id)} onChange={() => toggle("userIds", u.id)} />{u.name}</label>)}</div>}
            <label className="mt-1 flex items-center gap-2"><input type="radio" name="ns-br" className="accent-blue-800" checked={draft.allBranches} onChange={() => set({ allBranches: true })} /> All branches</label>
            <label className="flex items-center gap-2"><input type="radio" name="ns-br" className="accent-blue-800" checked={!draft.allBranches} onChange={() => set({ allBranches: false })} /> Only chosen branches</label>
            {!draft.allBranches && <div className="ml-6 flex flex-wrap gap-x-4 gap-y-1">{company.branches.map((b) => <label key={b.id} className="flex items-center gap-1.5"><input type="checkbox" className="accent-blue-800" checked={draft.branchIds.includes(b.id)} onChange={() => toggle("branchIds", b.id)} />{b.name}</label>)}</div>}
          </fieldset>

          <div className="flex flex-wrap gap-x-4 text-[13px]">
            <label className="flex items-center gap-2"><input type="checkbox" className="accent-blue-800" checked={draft.isDefault} onChange={(e) => set({ isDefault: e.target.checked, ...(e.target.checked ? { isActive: true } : {}) })} /> Default for {label(draft.documentType).toLowerCase()}</label>
            <label className="flex items-center gap-2"><input type="checkbox" className="accent-blue-800" checked={draft.isActive} onChange={(e) => set({ isActive: e.target.checked, ...(!e.target.checked ? { isDefault: false } : {}) })} /> Active</label>
          </div>

          <div className="mt-auto flex items-center gap-2">
            <button type="button" className="btn btn-primary" disabled={!dirty || busy || !!problem} onClick={save}><Save size={14} /> Save <span className="kbd">Ctrl+S</span></button>
          </div>
        </section>
      )}
    </div>
  );
}
