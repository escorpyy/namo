import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { MASTERS, type MasterDef, type Opt } from "../../shared/masters";
import { ApiError, masterApi } from "../api";
import { emptyForm, recordLabel, recordTitle, sameForm, toForm, toPayload, validate, type Errors, type FormState, type Row } from "../lib/form";
import type { Mode, MsgKind, StatusInfo } from "../types";
import { MasterForm } from "../components/MasterForm";
import { MasterList } from "../components/MasterList";
import { ConfirmDialog, type DialogSpec } from "../components/ConfirmDialog";
import { ShortcutsOverlay } from "../components/ShortcutsOverlay";

const q = (sel: string) => document.querySelector<HTMLElement>(sel);
const focusField = (n: string) => q(`[data-field="${n}"]`)?.focus();
const focusForm = () => setTimeout(() => q("[data-zone=form] [data-nav]")?.focus(), 0);
const sortRows = (def: MasterDef, a: Row[]) => {
  const k = def.sortBy ?? "code", dir = def.sortDir === "desc" ? -1 : 1;
  return [...a].sort((x, y) => dir * String(x[k] ?? "").localeCompare(String(y[k] ?? "")));
};

interface Props {
  def: MasterDef;
  companyId: number;
  setStatus: (s: StatusInfo) => void;
  dirtyRef: MutableRefObject<boolean>;
  externalMessage: { text: string; n: number } | null;
  calendar: "BS" | "AD";
  onContextChanged: () => void;
}

export default function MasterScreen({ def, companyId, setStatus, dirtyRef, externalMessage, calendar, onContextChanged }: Props) {
  const api = useMemo(() => masterApi(def.key), [def.key]);
  const firstField = def.fields[0].name;
  const [items, setItems] = useState<Row[]>([]);
  const [lookupRows, setLookupRows] = useState<Record<string, Row[]>>({});
  const [scopedRows, setScopedRows] = useState<Record<string, Row[]>>({}); // lookupScope=record fields ke options
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>("new");
  const [form, setForm] = useState<FormState>(() => emptyForm(def));
  const [errors, setErrors] = useState<Errors>({});
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<DialogSpec | null>(null);
  const [help, setHelp] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; kind: MsgKind }>({ text: "Ready", kind: "info" });
  const savingRef = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const flash = (text: string, kind: MsgKind = "info") => setMsg({ text, kind });
  const selected = items.find((i) => i.id === selectedId) ?? null;

  const baseline = mode === "edit" && selected ? toForm(def, selected) : emptyForm(def);
  const dirty = mode !== "view" && !sameForm(form, baseline);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return items;
    return items.filter((i) => Object.entries(i).some(([k, v]) => typeof v === "string" && k !== "createdAt" && k !== "updatedAt" && v.toLowerCase().includes(s)));
  }, [items, search]);

  // Lookup options: doosre masters ki list (ya apni hi list, parent location jaise cases me)
  const rowsOf = (key: string): Row[] => (key === def.key ? items : (lookupRows[key] ?? []));

  const lookups = useMemo(() => {
    const out: Record<string, Opt[]> = {};
    for (const f of def.fields) {
      if (f.type !== "lookup") continue;
      const target = MASTERS[f.lookup!];
      const rows = (f.lookupScope === "record" ? (scopedRows[f.name] ?? []) : rowsOf(f.lookup!)).filter((r) => (f.lookup !== def.key || r.id !== selectedId) && (!f.lookupWhere || r[f.lookupWhere.field] === f.lookupWhere.value));
      // Child master ho (jaise Sub Group) to label me parent code bhi: "AG01 / SG01 — Cash-in-Hand"
      const pf = target.parent && target.fields.find((x) => x.name === target.parent!.field);
      const parents = pf ? rowsOf(pf.lookup!) : [];
      const pTarget = pf ? MASTERS[pf.lookup!] : null;
      out[f.name] = rows.map((r) => {
        const par = pf ? parents.find((p) => p.id === r[pf.name]) : null;
        const prefix = par && pTarget ? `${par[pTarget.labelFields[0]]} / ` : "";
        return { value: String(r.id), label: `${prefix}${recordTitle(target, r)}`, short: String(r[target.labelFields[0]]) };
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def, items, lookupRows, scopedRows, selectedId]);

  // ---- load ----
  useEffect(() => {
    let live = true;
    const keys = [...new Set([...def.fields.filter((f) => f.type === "lookup" && f.lookupScope !== "record").map((f) => f.lookup!), ...(def.loads ?? [])])].filter((k) => k !== def.key);
    Promise.all([api.list(companyId), ...keys.map((k) => masterApi(k).list(companyId))])
      .then(([own, ...rest]) => {
        if (!live) return;
        setItems(own);
        setLookupRows(Object.fromEntries(keys.map((k, i) => [k, rest[i]])));
        flash(`Loaded ${own.length} record(s)`, "info");
        setTimeout(() => focusField(firstField), 50);
      })
      .catch((e: Error) => live && flash(e.message, "err"));
    return () => { live = false; };
  }, [companyId, def, api, firstField]);

  // Company screen par: Retained Earnings GL ke options us company ke ledgers se aate hain jo select hai (header wali nahi)
  useEffect(() => {
    const fields = def.fields.filter((f) => f.lookupScope === "record");
    if (!fields.length) return;
    if (selectedId == null) { setScopedRows({}); return; }
    let live = true;
    Promise.all(fields.map((f) => masterApi(f.lookup!).list(selectedId).then((rows) => [f.name, rows] as const)))
      .then((e) => live && setScopedRows(Object.fromEntries(e))).catch(() => {});
    return () => { live = false; };
  }, [selectedId, def]);

  useEffect(() => { if (externalMessage) flash(externalMessage.text, "info"); }, [externalMessage]);
  useEffect(() => { dirtyRef.current = dirty; });
  useEffect(() => setStatus({ mode, count: items.length, shown: filtered.length, message: msg.text, kind: msg.kind }), [mode, items.length, filtered.length, msg, setStatus]);

  // ---- mode transitions ----
  const resetToNew = () => {
    setSelectedId(null); setMode("new"); setForm(emptyForm(def)); setErrors({});
    setTimeout(() => focusField(firstField), 0);
  };

  // Unsaved changes guard: Save / Discard / Stay
  const guard = (action: () => void) => {
    if (!dirty) return action();
    const stay = () => { setDialog(null); setTimeout(() => focusField(firstField), 0); };
    setDialog({
      title: "Discard changes?",
      body: "This form has unsaved changes.",
      buttons: [
        { label: "Save", kind: "primary", onClick: () => { setDialog(null); void save(); } },
        { label: "Discard", kind: "danger", onClick: () => { setDialog(null); action(); } },
        { label: "Stay", kind: "neutral", autoFocus: true, onClick: stay },
      ],
      onCancel: stay,
    });
  };

  const select = (id: number) => guard(() => {
    const r = items.find((i) => i.id === id);
    if (!r) return;
    setSelectedId(id); setMode("view"); setForm(toForm(def, r)); setErrors({});
  });

  const moveSel = (dir: 1 | -1) => {
    if (!filtered.length) return;
    const i = filtered.findIndex((x) => x.id === selectedId);
    const n = i < 0 ? (dir === 1 ? 0 : filtered.length - 1) : Math.min(Math.max(i + dir, 0), filtered.length - 1);
    if (filtered[n].id !== selectedId) select(filtered[n].id);
  };

  const newRec = () => guard(resetToNew);
  const clear = () => (dirty ? guard(resetToNew) : (setForm(emptyForm(def)), setErrors({}), focusField(firstField)));
  const edit = () => { if (mode === "view" && selected) { setMode("edit"); setErrors({}); setTimeout(() => focusField(firstField), 0); } };
  const cancelEdit = () => guard(() => {
    if (!selected) return;
    setMode("view"); setForm(toForm(def, selected)); setErrors({}); focusForm();
  });

  // ---- save / update ----
  const persist = async (payload: Record<string, unknown>): Promise<boolean> => {
    if (savingRef.current) return false; // double-submit roko
    savingRef.current = true; setSaving(true);
    const wasEdit = mode === "edit" && selectedId != null;
    try {
      const rec = wasEdit ? await api.update(selectedId!, payload) : await api.create(companyId, payload);
      setItems((prev) => sortRows(def, [...prev.filter((i) => i.id !== rec.id), rec]));
      setSelectedId(rec.id); setMode("view"); setForm(toForm(def, rec)); setErrors({});
      flash(`${wasEdit ? "Updated" : "Saved"} ${recordLabel(def, rec)}`, "ok");
      if (def.refreshContext) onContextChanged();
      focusForm();
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.field && def.fields.some((f) => f.name === e.field)) {
        setErrors({ [e.field]: e.message });
        setTimeout(() => focusField(e.field!), 0);
      }
      flash((e as Error).message, "err"); // typed data form me hi rehta hai
      return false;
    } finally {
      savingRef.current = false; setSaving(false);
    }
  };

  const save = async (): Promise<boolean> => {
    if (mode === "view") return false;
    const errs = validate(def, form, items, mode === "edit" ? selectedId : null, mode);
    const first = def.fields.find((f) => errs[f.name]);
    if (first) {
      setErrors(errs);
      flash("Please correct the highlighted fields.", "err");
      focusField(first.name);
      return false;
    }
    const payload = toPayload(def, form, mode);
    const w = def.warnOnChange;
    if (mode === "edit" && selected && w && String(selected[w.field] ?? "") !== String(payload[w.field] ?? "") && (selected[w.countKey] ?? 0) > 0) {
      const n = selected[w.countKey];
      const cl = def.counts?.find((c) => c.key === w.countKey)?.label ?? "child record(s)";
      setDialog({
        title: `Change ${def.fields.find((f) => f.name === w.field)?.label}?`,
        body: `${recordLabel(def, selected)} has ${n} ${cl}. ${w.text}`,
        buttons: [
          { label: "Cancel", kind: "neutral", autoFocus: true, onClick: () => setDialog(null) },
          { label: "Change", kind: "danger", onClick: () => { setDialog(null); void persist(payload); } },
        ],
      });
      return false;
    }
    return persist(payload);
  };

  // ---- delete ----
  const askDelete = () => {
    if (mode !== "view" || !selected) return;
    if (def.noDelete) {
      flash(def.noDelete, "err");
      setDialog({ title: "Cannot delete", body: def.noDelete, buttons: [{ label: "OK", kind: "neutral", autoFocus: true, onClick: () => setDialog(null) }] });
      return;
    }
    const blocker = def.counts?.find((c) => (selected[c.key] ?? 0) > 0);
    if (blocker) {
      const text = `Cannot delete: ${selected[blocker.key]} ${blocker.label} linked to this ${def.singular}.`;
      flash(text, "err");
      setDialog({ title: "Cannot delete", body: text, buttons: [{ label: "OK", kind: "neutral", autoFocus: true, onClick: () => setDialog(null) }] });
      return;
    }
    const target = selected;
    setDialog({
      title: `Delete ${def.singular}?`,
      body: <><span className="font-mono font-semibold">{recordTitle(def, target)}</span><br /><span className="text-slate-600">This cannot be undone.</span></>,
      buttons: [
        { label: "Cancel", kind: "neutral", autoFocus: true, onClick: () => setDialog(null) },
        {
          label: "Delete", kind: "danger",
          onClick: async () => {
            setDialog(null);
            try {
              await api.remove(target.id);
              setItems((p) => p.filter((i) => i.id !== target.id));
              resetToNew();
              flash(`Deleted ${recordLabel(def, target)}`, "ok");
              if (def.refreshContext) onContextChanged();
            } catch (e) { flash((e as Error).message, "err"); }
          },
        },
      ],
    });
  };

  // ---- field validation ----
  const onBlurField = (name: string) => {
    if (mode === "view") return;
    const e = validate(def, form, items, mode === "edit" ? selectedId : null, mode);
    setErrors((prev) => ({ ...prev, [name]: e[name] }));
  };
  // Suggest: ek field chunte hi doosra auto-bharo (sirf NEW mode; user baad me badal sakta hai)
  const suggested = (f: FormState): FormState => {
    const sg = def.suggest;
    if (!sg || mode !== "new" || f[sg.from] === form[sg.from] || f[sg.from] === "") return f;
    let id: unknown = f[sg.from];
    let row: Row | undefined;
    for (const hop of sg.hops) {
      row = rowsOf(hop.master).find((r) => String(r.id) === String(id));
      if (!row) return f;
      id = hop.via ? row[hop.via] : null;
    }
    const v = sg.map[String(row![sg.attr])];
    return v ? { ...f, [sg.target]: v } : f;
  };

  const onChangeForm = (raw: FormState) => {
    const f = suggested(raw);
    const next: Errors = { ...errors };
    for (const k of Object.keys(f)) if (f[k] !== form[k]) delete next[k]; // typing shuru, purana error hatao
    setForm(f); setErrors(next);
  };

  // ---- search box keys ----
  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); moveSel(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); moveSel(-1); }
    else if (e.key === "Enter") { e.preventDefault(); if (selectedId == null && filtered[0]) select(filtered[0].id); focusForm(); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); focusForm(); }
  };

  // ---- global shortcuts (ek hi listener, latest handlers ref se) ----
  const H = useRef({ save, newRec, edit, askDelete, moveSel, cancelEdit, clear, mode, dirty, dialogOpen: false, help: false });
  H.current = { save, newRec, edit, askDelete, moveSel, cancelEdit, clear, mode, dirty, dialogOpen: !!dialog, help };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const h = H.current;
      if (h.dialogOpen) return;
      if (h.help) { if (e.key === "Escape" || e.key === "F1") { e.preventDefault(); setHelp(false); } return; }
      const k = e.key, kl = k.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
      const t = e.target as HTMLElement;
      const typing = t.tagName === "INPUT" || t.tagName === "TEXTAREA";
      if (ctrl && kl === "s") { e.preventDefault(); void h.save(); }
      else if ((ctrl && kl === "n") || k === "F3") { e.preventDefault(); h.newRec(); }
      else if (k === "F2") { e.preventDefault(); h.edit(); }
      else if ((ctrl && k === "Delete") || (e.altKey && kl === "d")) { e.preventDefault(); h.askDelete(); }
      else if (k === "F4" || (ctrl && kl === "f") || (k === "/" && !typing)) { e.preventDefault(); searchRef.current?.focus(); }
      else if (ctrl && k === "ArrowDown") { e.preventDefault(); h.moveSel(1); }
      else if (ctrl && k === "ArrowUp") { e.preventDefault(); h.moveSel(-1); }
      else if (k === "F1" || (k === "?" && !typing)) { e.preventDefault(); setHelp(true); }
      else if (e.altKey && k === "1") { e.preventDefault(); q("[data-zone=sidebar] button[data-sb]")?.focus(); }
      else if (e.altKey && k === "2") { e.preventDefault(); q("[data-zone=form] [data-nav]")?.focus(); }
      else if (e.altKey && k === "3") { e.preventDefault(); (q("[data-zone=list] [data-row][aria-selected=true]") ?? q("[data-zone=list] [data-row]") ?? searchRef.current)?.focus(); }
      else if (k === "Escape") {
        if (h.mode === "edit") h.cancelEdit();
        else if (h.mode === "new" && h.dirty) h.clear();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <main className="flex-1 min-w-0 overflow-y-auto">
        <div className="px-4 pt-3">
          <h1 className="text-[22px] font-semibold">{def.title}</h1>
          <div className="double-rule mt-1" />
        </div>
        <MasterForm
          def={def} mode={mode} form={form} setForm={onChangeForm} errors={errors} onBlurField={onBlurField}
          selected={selected} dirty={dirty} saving={saving} lookups={lookups} calendar={calendar}
          actions={{ save: () => void save(), clear, edit, del: askDelete, newRec, cancel: cancelEdit }}
        />
      </main>
      <MasterList
        def={def} items={filtered} total={items.length} selectedId={mode === "new" ? null : selectedId}
        search={search} onSearch={setSearch} onSelect={select} searchRef={searchRef} onSearchKeyDown={onSearchKey} lookups={lookups}
      />
      {dialog && <ConfirmDialog spec={dialog} onClose={() => setDialog(null)} />}
      {help && <ShortcutsOverlay onClose={() => setHelp(false)} />}
    </>
  );
}
