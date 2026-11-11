import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { codeSpec } from "../../shared/codeRules";
import { MASTERS, type MasterDef } from "../../shared/masters";
import { ApiError, codeRulesApi, masterApi } from "../api";
import { emptyForm, sameForm, tabsOf, toPayload, validate, type Errors, type FormState, type Row } from "../lib/form";
import { useOnMasterChanged } from "../lib/masterEvents";
import { buildLookups, lookupKeysOf } from "../lib/masterLookups";
import { useDialog } from "./Dialog";
import { MasterForm } from "./MasterForm";
import { QuickCreateContext, type QuickCreateFn, type QuickCreateRequest } from "./quickCreateContext";

// Ctrl+M on a reference field opens the New form of the master it points to, in a dialog on top of the current screen. The screen
// behind keeps everything the user typed; the saved record comes back to the field that asked (see MasterReferencePicker).

interface Entry { id: number; req: QuickCreateRequest; resolve: (row: Row | null) => void }

export function QuickCreateHost({ companyId, calendar, children }: { companyId: number; calendar: "BS" | "AD"; children: ReactNode }) {
  // A stack, because the New form has reference fields of its own (Product -> Product Group) that can open another one.
  const [stack, setStack] = useState<Entry[]>([]);
  const seq = useRef(0);
  const open = useCallback<QuickCreateFn>((req) => {
    if (!MASTERS[req.key]) return Promise.resolve(null);
    return new Promise<Row | null>((resolve) => setStack((s) => [...s, { id: ++seq.current, req, resolve }]));
  }, []);
  const close = (entry: Entry, row: Row | null) => {
    setStack((s) => s.filter((e) => e.id !== entry.id));
    entry.resolve(row);
  };
  return (
    <QuickCreateContext.Provider value={open}>
      {children}
      {stack.map((e) => <QuickCreateDialog key={e.id} req={e.req} companyId={companyId} calendar={calendar} onClose={(row) => close(e, row)} />)}
    </QuickCreateContext.Provider>
  );
}

// The form to start from: the master's defaults, what the caller pre-fills, and what was typed in the picker as the record's name.
function startForm(def: MasterDef, req: QuickCreateRequest): FormState {
  const f = emptyForm(def);
  const defaults = req.defaults ?? {};
  for (const [k, v] of Object.entries(defaults)) if (k in f) f[k] = def.fields.find((x) => x.name === k)?.type === "checkbox" ? Boolean(v) : String(v);
  const nameField = def.fields.find((x) => x.name === def.labelFields[1]);
  if (req.name && nameField?.type === "text" && def.labelFields[1] !== def.labelFields[0] && !(nameField.name in defaults)) {
    const s = nameField.upper ? req.name.toUpperCase() : req.name;
    f[nameField.name] = nameField.max ? s.slice(0, nameField.max) : s;
  }
  return f;
}

// One field's value drives another (def.suggest), new records only: same chain MasterScreen follows.
function suggestedFrom(def: MasterDef, next: FormState, prev: FormState, rowsOf: (key: string) => Row[]): FormState {
  const sg = def.suggest;
  if (!sg || next[sg.from] === prev[sg.from] || next[sg.from] === "") return next;
  let id: unknown = next[sg.from];
  let row: Row | undefined;
  for (const hop of sg.hops) {
    row = rowsOf(hop.master).find((r) => String(r.id) === String(id));
    if (!row) return next;
    id = hop.via ? row[hop.via] : null;
  }
  const v = sg.map[String(row![sg.attr])];
  return v ? { ...next, [sg.target]: v } : next;
}

const FOCUSABLE = "input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex='-1'])";

function QuickCreateDialog({ req, companyId, calendar, onClose }: { req: QuickCreateRequest; companyId: number; calendar: "BS" | "AD"; onClose: (row: Row | null) => void }) {
  const def = MASTERS[req.key];
  const dlg = useDialog();
  const rootRef = useRef<HTMLElement>(null);
  const [items, setItems] = useState<Row[]>([]);
  const [lookupRows, setLookupRows] = useState<Record<string, Row[]>>({});
  const [ready, setReady] = useState(false);
  const [form, setForm] = useState<FormState>(() => startForm(def, req));
  const [errors, setErrors] = useState<Errors>({});
  const [tab, setTab] = useState("");
  const [saving, setSaving] = useState(false);
  const [codeHint, setCodeHint] = useState("");
  const [autoCode, setAutoCode] = useState("");
  const savingRef = useRef(false), codeTouched = useRef(false), autoRef = useRef("");
  const keys = useMemo(() => lookupKeysOf(def), [def]);
  const rowsOf = (key: string): Row[] => (key === def.key ? items : (lookupRows[key] ?? []));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const lookups = useMemo(() => buildLookups(def, rowsOf), [def, items, lookupRows]);

  // ---- load: the master's own rows (for the duplicate check) and every list its fields read from ----
  useEffect(() => {
    let live = true;
    Promise.all([masterApi(def.key).list(companyId), ...keys.map((k) => masterApi(k).list(companyId))])
      .then(([own, ...rest]) => {
        if (!live) return;
        setItems(own);
        setLookupRows(Object.fromEntries(keys.map((k, i) => [k, rest[i]])));
        setReady(true);
      })
      .catch((e: Error) => { if (live) { void dlg.error(e.message, { title: `Could not open New ${def.singular}` }); onClose(null); } });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (ready) setTimeout(() => rootRef.current?.querySelector<HTMLElement>("[data-zone=form] [data-nav]")?.focus(), 0);
  }, [ready]);

  // A record made from this dialog's own reference fields (a nested Ctrl+M) is in the options before the field is set.
  useOnMasterChanged(async (key) => {
    if (key !== def.key && !keys.includes(key)) return;
    const rows = await masterApi(key).list(companyId);
    flushSync(() => { if (key === def.key) setItems(rows); else setLookupRows((p) => ({ ...p, [key]: rows })); });
  });

  // ---- code numbering: the rule's code is suggested until the user types one of their own ----
  const spec = codeSpec(def.key);
  const parentVal = spec?.parentField ? String(form[spec.parentField] ?? "") : "";
  const nameVal = spec?.nameField ? String(form[spec.nameField] ?? "") : "";
  const typeVal = spec?.typeField ? String(form[spec.typeField] ?? "") : "";
  const codeEmpty = !form.code;
  useEffect(() => {
    if (!spec || !ready) return;
    if (codeTouched.current && !codeEmpty) return;
    let stale = false;
    const timer = setTimeout(async () => {
      try {
        const r = await codeRulesApi.suggest(companyId, def.key, { parentId: parentVal ? Number(parentVal) : null, name: nameVal, type: typeVal });
        if (stale) return;
        const prev = autoRef.current;
        autoRef.current = r.code ?? ""; setAutoCode(r.code ?? "");
        setForm((f) => (codeTouched.current && f.code ? f : f.code === (r.code ?? "") || (f.code && f.code !== prev) ? f : { ...f, code: r.code ?? "" }));
        setCodeHint(r.code ? "Suggested by the numbering rule; type a code to use your own." : r.mode === "SUGGESTED" ? (r.reason ?? "") : "");
      } catch { if (!stale) setCodeHint(""); }
    }, 250);
    return () => { stale = true; clearTimeout(timer); };
  }, [spec, ready, companyId, def.key, parentVal, nameVal, typeVal, codeEmpty]);

  // What the form looks like untouched (a suggested code alone is not a change).
  const base = useMemo(() => ({ ...startForm(def, req), ...(autoCode ? { code: autoCode } : {}) }), [def, req, autoCode]);
  const dirty = ready && !sameForm(def, form, base);

  const onChangeForm = (raw: FormState) => {
    if (spec && raw.code !== form.code) codeTouched.current = !!raw.code && raw.code !== autoRef.current;
    const f = suggestedFrom(def, raw, form, rowsOf);
    const next: Errors = { ...errors };
    for (const k of Object.keys(f)) if (f[k] !== form[k]) delete next[k];
    setForm(f); setErrors(next);
  };
  const onBlurField = (name: string) => {
    const e = validate(def, form, items, null, "new");
    setErrors((prev) => ({ ...prev, [name]: e[name] }));
  };
  const focusField = (name: string) => {
    const f = def.fields.find((x) => x.name === name.split(".")[0]);
    if (f?.tab) setTab(f.tab);
    setTimeout(() => {
      const r = rootRef.current;
      (r?.querySelector<HTMLElement>(`[data-field="${name}"]`) ?? r?.querySelector<HTMLElement>(`[data-field^="${name}."]`))?.focus();
    }, f?.tab ? 40 : 0);
  };

  const save = async () => {
    if (savingRef.current) return;
    const errs = validate(def, form, items, null, "new");
    const first = def.fields.find((f) => errs[f.name]);
    if (first) {
      setErrors(errs);
      focusField(first.name);
      return;
    }
    savingRef.current = true; setSaving(true);
    try {
      const rec = await masterApi(def.key).create(companyId, toPayload(def, form, "new"));
      onClose(rec);
    } catch (e) {
      if (e instanceof ApiError && e.field && def.fields.some((f) => f.name === e.field)) {
        setErrors({ [e.field]: e.message });
        focusField(e.field);
      }
      void dlg.error((e as Error).message, { title: `Could not save ${def.singular}` });
    } finally {
      savingRef.current = false; setSaving(false);
    }
  };

  const cancel = async () => {
    if (savingRef.current) return;
    if (dirty && !(await dlg.confirm("What you typed for this new record will be lost.", { title: `Cancel New ${def.singular}?`, variant: "warning", confirmLabel: "Discard", cancelLabel: "Keep editing" }))) return;
    onClose(null);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    // The screen behind must not hear any of these keys (its own Ctrl+S would save *its* form).
    e.stopPropagation();
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === "s") { e.preventDefault(); void save(); }
    else if (e.key === "Escape") { e.preventDefault(); void cancel(); }
    else if (ctrl && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
      const names = tabsOf(def, form, "new");
      if (names.length < 2) return;
      e.preventDefault();
      const i = Math.max(0, names.indexOf(tab));
      setTab(names[(i + (e.key === "ArrowRight" ? 1 : -1) + names.length) % names.length]);
      setTimeout(() => rootRef.current?.querySelector<HTMLElement>("[data-tabpane] [data-nav]")?.focus(), 40);
    } else if (e.key === "Tab") {
      const nodes = Array.from(rootRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter((n) => n.getClientRects().length > 0);
      if (!nodes.length) return;
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/40 p-0 sm:p-5">
      <section
        ref={rootRef} role="dialog" aria-modal="true" aria-label={`New ${def.singular}`} onKeyDown={onKeyDown}
        className="flex h-full max-h-full w-full max-w-[960px] flex-col overflow-hidden border border-slate-500 bg-white shadow-2xl sm:h-auto sm:max-h-[min(92vh,900px)]"
      >
        <header className="border-b border-slate-300 bg-slate-100 px-4 py-2">
          <h2 className="text-base font-semibold">New {def.singular}</h2>
          <p className="text-xs text-slate-600">Saved here, then selected in the field you came from. <span className="kbd">Ctrl+S</span> saves, <span className="kbd">Esc</span> cancels.</p>
        </header>
        <div className="min-h-0 flex-1 overflow-auto">
          {ready ? (
            <MasterForm
              hints={codeHint ? { code: codeHint } : undefined} def={def} companyId={companyId} mode="new" form={form} setForm={onChangeForm} errors={errors} onBlurField={onBlurField}
              selected={null} dirty={dirty} saving={saving} lookups={lookups} calendar={calendar} tab={tab} onTab={setTab} clearLabel="Cancel"
              actions={{ save: () => void save(), clear: () => void cancel(), edit: () => {}, del: () => {}, newRec: () => {}, cancel: () => {} }}
            />
          ) : <p className="p-6 text-slate-500">Loading…</p>}
        </div>
      </section>
    </div>
  );
}
