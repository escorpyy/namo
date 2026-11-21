import { useEffect, useMemo, useState, type MutableRefObject } from "react";
import { AlertTriangle, Keyboard, Plus, Save, Trash2, X } from "lucide-react";
import {
  findShortcutConflicts,
  formatShortcutCombination,
  getBrowserShortcutStorage,
  getShortcutActions,
  getShortcutCombination,
  readShortcutBindings,
  writeShortcutBindings,
  type ReadyScreenOption,
  type ShortcutBinding,
} from "../lib/keyboardShortcuts";

interface Props {
  userId: number;
  dirtyRef: MutableRefObject<boolean>;
  screens: readonly ReadyScreenOption[];
}

const makeId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
const copy = (bindings: readonly ShortcutBinding[]) => bindings.map((binding) => ({ ...binding }));

export default function KeyboardShortcutsScreen({ userId, dirtyRef, screens }: Props) {
  const actions = useMemo(() => getShortcutActions(screens), [screens]);
  const actionById = useMemo(() => new Map(actions.map((action) => [action.id, action])), [actions]);
  const [bindings, setBindings] = useState<ShortcutBinding[]>(() => readShortcutBindings(getBrowserShortcutStorage(), userId, actions));
  const [saved, setSaved] = useState<ShortcutBinding[]>(() => copy(bindings));
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [captureMessage, setCaptureMessage] = useState("");
  const [notice, setNotice] = useState<{ text: string; kind: "ok" | "error" } | null>(null);
  const dirty = JSON.stringify(bindings) !== JSON.stringify(saved);
  const conflicts = findShortcutConflicts(bindings, actions);
  const conflictsById = useMemo(() => {
    const grouped = new Map<string, string[]>();
    for (const conflict of conflicts) grouped.set(conflict.bindingId, [...(grouped.get(conflict.bindingId) ?? []), conflict.message]);
    return grouped;
  }, [conflicts]);

  useEffect(() => {
    dirtyRef.current = dirty;
    return () => { dirtyRef.current = false; };
  }, [dirty, dirtyRef]);

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  useEffect(() => {
    const onSave = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      if (!conflicts.length) save();
      else setNotice({ text: "Resolve every shortcut conflict before saving.", kind: "error" });
    };
    function save() {
      const result = writeShortcutBindings(getBrowserShortcutStorage(), userId, bindings, actions);
      if (!result.ok) {
        setNotice({ text: result.error ?? "Resolve every shortcut conflict before saving.", kind: "error" });
        return;
      }
      setBindings(copy(result.bindings));
      setSaved(copy(result.bindings));
      setRecordingId(null);
      setCaptureMessage("");
      setNotice({ text: "Keyboard shortcuts saved for this user on this device.", kind: "ok" });
    }
    window.addEventListener("keydown", onSave);
    return () => window.removeEventListener("keydown", onSave);
  }, [actions, bindings, conflicts.length, userId]);

  const updateBinding = (id: string, changes: Partial<ShortcutBinding>) => {
    setNotice(null);
    setBindings((current) => current.map((binding) => binding.id === id ? { ...binding, ...changes } : binding));
  };

  const handleCapture = (event: React.KeyboardEvent<HTMLButtonElement>, id: string) => {
    if (recordingId !== id) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
      setRecordingId(null);
      setCaptureMessage("Shortcut recording cancelled.");
      return;
    }
    const combination = getShortcutCombination(event.nativeEvent);
    if (!combination) {
      if (!["Control", "Meta", "Alt", "Shift"].includes(event.key)) {
        setCaptureMessage("Use a modifier with the key, or a function key. Single letters are not captured globally.");
      }
      return;
    }
    updateBinding(id, { combination });
    setRecordingId(null);
    setCaptureMessage("");
  };

  const addBinding = () => {
    const id = makeId();
    setBindings((current) => [...current, { id, actionId: "save", combination: "" }]);
    setRecordingId(id);
    setCaptureMessage("");
    setNotice(null);
  };

  const save = () => {
    if (conflicts.length) {
      setNotice({ text: "Resolve every shortcut conflict before saving.", kind: "error" });
      return;
    }
    const result = writeShortcutBindings(getBrowserShortcutStorage(), userId, bindings, actions);
    if (!result.ok) {
      setNotice({ text: result.error ?? "Resolve every shortcut conflict before saving.", kind: "error" });
      return;
    }
    setBindings(copy(result.bindings));
    setSaved(copy(result.bindings));
    setRecordingId(null);
    setCaptureMessage("");
    setNotice({ text: "Keyboard shortcuts saved for this user on this device.", kind: "ok" });
  };

  const discardChanges = () => {
    setBindings(copy(saved));
    setRecordingId(null);
    setCaptureMessage("");
    setNotice(null);
  };

  return (
    <main className="ledger flex min-h-0 min-w-0 flex-1 flex-col overflow-auto bg-paper p-4 lg-scroll" aria-label="Keyboard shortcuts settings">
      <header className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="lg-title flex items-center gap-2"><Keyboard size={20} /> Keyboard Shortcuts</h1>
          <p className="mt-1 text-[12px] text-slate-500">Add extra shortcuts for common actions and navigation. Existing ERP shortcuts continue to work.</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button type="button" className="btn" onClick={discardChanges} disabled={!dirty}>Discard changes</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={!dirty || conflicts.length > 0} title={conflicts.length ? "Resolve conflicts before saving" : undefined}>
            <Save size={14} /> Save shortcuts <span className="kbd">Ctrl+S</span>
          </button>
        </div>
      </header>

      <div className="lg-card mb-3 flex flex-wrap items-start gap-2 bg-slate-50 px-3 py-2 text-[12px] text-slate-600">
        <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-600" />
        <p className="flex-1">Use a modifier (Ctrl/Command, Alt, or Shift) with a key. Built-in ERP and browser shortcuts are reserved. A shortcut can only run one action. Bindings are saved in this browser for user {userId}.</p>
        <button type="button" className="btn h-7 shrink-0" onClick={addBinding}><Plus size={13} /> Add shortcut</button>
      </div>

      {notice && <p role={notice.kind === "error" ? "alert" : "status"} className={`mb-3 rounded-md border px-3 py-2 text-[12px] ${notice.kind === "error" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>{notice.text}</p>}
      {captureMessage && <p role="status" className="mb-3 text-[12px] text-slate-600">{captureMessage}</p>}

      <section className="lg-card min-h-0 flex-1 overflow-auto" aria-label="Custom shortcuts">
        <table className="xl-table min-w-[760px] text-[12.5px]">
          <thead><tr className="lg-th text-left"><th className="px-3 py-2">Action</th><th className="px-3 py-2">Key combination</th><th className="w-[150px] px-3 py-2">Status</th><th className="w-[48px] px-2 py-2"><span className="sr-only">Remove</span></th></tr></thead>
          <tbody>
            {bindings.map((binding) => {
              const action = actionById.get(binding.actionId);
              const rowConflicts = conflictsById.get(binding.id) ?? [];
              return (
                <tr key={binding.id} className="border-b border-rule last:border-0 align-top">
                  <td className="min-w-[310px] px-3 py-2">
                    <select className="fld h-8 w-full" aria-label="Shortcut action" value={binding.actionId} onChange={(event) => updateBinding(binding.id, { actionId: event.target.value })}>
                      <optgroup label="Common actions">{actions.filter((item) => item.kind !== "navigate").map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup>
                      <optgroup label="Navigate to screen">{actions.filter((item) => item.kind === "navigate").map((item) => <option key={item.id} value={item.id}>{item.label} — {item.section}</option>)}</optgroup>
                    </select>
                    {action?.kind === "screen-key" && <p className="mt-1 text-[11px] text-slate-500">Runs the existing {action.key === "F3" ? "New" : action.key === "F2" ? "Edit" : action.key === "F1" ? "Help" : action.key === "s" ? "Save" : "Search"} shortcut on screens that support it.</p>}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      data-shortcut-capture
                      onClick={(event) => { event.currentTarget.focus(); setRecordingId(binding.id); setCaptureMessage(""); setNotice(null); }}
                      onKeyDown={(event) => handleCapture(event, binding.id)}
                      className={`inline-flex min-h-8 min-w-[170px] items-center gap-2 rounded border px-2 text-left font-ledger-mono text-[12px] ${recordingId === binding.id ? "border-cobalt-500 bg-cobalt-50 text-cobalt-800 ring-2 ring-cobalt-200" : "border-slate-300 bg-white text-ink hover:border-cobalt-400"}`}
                      aria-label={recordingId === binding.id ? "Press a key combination, Escape cancels" : `Record shortcut, current ${formatShortcutCombination(binding.combination)}`}
                    >
                      {recordingId === binding.id ? <><Keyboard size={14} /> Press keys… <span className="text-[10px] text-slate-500">Esc cancels</span></> : <><Keyboard size={14} /> {formatShortcutCombination(binding.combination)}</>}
                    </button>
                    {rowConflicts.map((message) => <p key={message} role="alert" className="mt-1 max-w-[340px] text-[11px] font-medium text-rose-700">{message}</p>)}
                  </td>
                  <td className="px-3 py-2">
                    {rowConflicts.length ? <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-1 text-[11px] font-medium text-rose-700"><AlertTriangle size={12} /> Conflict</span> : <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700">Available</span>}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <button type="button" className="btn h-7 w-7 justify-center px-0" aria-label={`Remove shortcut for ${action?.label ?? "action"}`} title="Remove shortcut" onClick={() => { setBindings((current) => current.filter((item) => item.id !== binding.id)); if (recordingId === binding.id) setRecordingId(null); setNotice(null); }}><Trash2 size={13} /></button>
                  </td>
                </tr>
              );
            })}
            {!bindings.length && <tr><td colSpan={4} className="px-4 py-10 text-center text-[12px] text-slate-500">No custom shortcuts yet. Select “Add shortcut” to create one.</td></tr>}
          </tbody>
        </table>
      </section>
      <footer className="mt-2 flex min-h-6 items-center justify-between gap-3 text-[11px] text-slate-500">
        <span>{bindings.length} custom {bindings.length === 1 ? "shortcut" : "shortcuts"}{conflicts.length ? ` · ${conflicts.length} conflict${conflicts.length === 1 ? "" : "s"} must be resolved` : " · ready to use"}</span>
        {recordingId && <span className="inline-flex items-center gap-1"><X size={12} /> Press Esc to stop recording</span>}
      </footer>
    </main>
  );
}
