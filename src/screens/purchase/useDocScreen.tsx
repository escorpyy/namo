import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { ApiError, purchaseApi, type PDoc, type PListRow, type PLookups, type PurchaseKind } from "../../api";
import { useDialog, type DialogSpec } from "../../components/Dialog";
import type { Mode, MsgKind, StatusInfo } from "../../types";

// The behaviour every purchase document screen shares: the list on the right, the selected document, new / view / edit, the
// unsaved-changes guard, save, delete, workflow actions (approve, confirm, post, ...) and the keyboard shortcuts.
// A screen supplies the form <-> document <-> payload conversions and what it draws.

export type Errors = Record<string, string | undefined>;
export interface Ctx { companyId: number; branchId: number; fyCode: string; userId: number; calendar: "BS" | "AD" }

export interface DocConfig<F extends object> {
  kind: PurchaseKind;
  title: string;
  singular: string;
  statusOptions: { value: string; label: string }[];
  emptyForm: (lookups: PLookups) => F;
  toForm: (d: PDoc, lookups: PLookups) => F;
  toPayload: (f: F, doc: PDoc | null) => Record<string, unknown>;
  validate: (f: F, lookups: PLookups) => Errors;
  editable: (d: PDoc) => boolean;
  deletable: (d: PDoc) => boolean;
  label: (d: { [k: string]: any }) => string;
}

const sig = (f: unknown) => JSON.stringify(f, (k, v) => (k === "key" || k === "link" || k === "finalAmount" ? undefined : v));
const q = (sel: string) => document.querySelector<HTMLElement>(sel);

// What a screen keeps of one document so it can be put back later (the bill workspace unmounts the entry of a tab you switch away from).
export interface DocSnapshot<F extends object> { doc: PDoc | null; mode: Mode; form: F; baseSig: string; selectedId: number | null }

// Optional hooks for a screen that is one tab among several (the purchase bill workspace). Order and challan screens pass none of them.
export interface DocTabOptions<F extends object> {
  sharedLookups?: PLookups;              // already loaded by the workspace: do not fetch again
  skipList?: boolean;                    // the workspace owns the list
  initialDocId?: number | null;          // open this saved document in view mode
  initialForm?: F;                       // start a new document from this form (copy of a bill)
  restore?: DocSnapshot<F> | null;       // put a document back exactly as it was left
  snapshotRef?: MutableRefObject<DocSnapshot<F> | null>;
  onNew?: () => void;                    // New (F3 / Ctrl+N): open another tab instead of resetting this one
  onDeleted?: () => void;                // after a delete: close this tab instead of showing a blank form
  onListChanged?: () => void;            // after a save / delete / workflow action: refresh the workspace list
  beforeSave?: () => boolean;            // return false to stop a save (the screen handled the keypress itself)
}

export interface ActionSpec {
  action: string;
  title: string;
  body: ReactNode;
  button: string;
  danger?: boolean;
  payload?: Record<string, unknown>;
  done: (doc: PDoc, result: Record<string, any>) => string;
}

export function useDocScreen<F extends object>(cfg: DocConfig<F>, ctx: Ctx, extra: { setStatus: (s: StatusInfo) => void; dirtyRef: MutableRefObject<boolean>; externalMessage: { text: string; n: number } | null; hints: string[] } & DocTabOptions<F>) {
  const { kind } = cfg;
  const skipList = !!extra.skipList;
  const [lookups, setLookups] = useState<PLookups | null>(extra.sharedLookups ?? null);
  const [rows, setRows] = useState<PListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [doc, setDoc] = useState<PDoc | null>(null);
  const [mode, setMode] = useState<Mode>("new");
  const [form, setFormState] = useState<F | null>(null);
  const [baseSig, setBaseSig] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [dialog, setDialog] = useState<DialogSpec | null>(null);
  const [help, setHelp] = useState(false);
  const [msg, setMsg] = useState<{ text: string; kind: MsgKind }>({ text: "Loading…", kind: "info" });
  const busy = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const listStorageKey = `purchase-list-collapsed:${kind}`;
  const [listCollapsed, setListCollapsed] = useState(() => {
    const saved = localStorage.getItem(listStorageKey);
    return saved === "1" || (saved === null && window.innerWidth < 960);
  });
  const toggleList = useCallback(() => {
    const next = !listCollapsed;
    localStorage.setItem(listStorageKey, next ? "1" : "0");
    setListCollapsed(next);
    window.setTimeout(() => q("[data-list-toggle]")?.focus(), 0);
  }, [listCollapsed, listStorageKey]);
  const dlg = useDialog();
  // The status bar keeps every message; a warning or an error also stops the person with a dialog (title: optional heading for it).
  const flash = useCallback((text: string, kind: MsgKind = "info", title?: string) => {
    setMsg({ text, kind });
    if (kind === "err") void dlg.error(text, { title });
    else if (kind === "warn") void dlg.warning(text, { title });
  }, [dlg]);

  const dirty = mode !== "view" && form !== null && sig(form) !== baseSig;

  // ---- loading ----
  const loadList = useCallback(async () => {
    if (skipList) return;
    try {
      const r = await purchaseApi.list(kind, { companyId: ctx.companyId, branchId: ctx.branchId, fiscalYear: ctx.fyCode, status: statusFilter || undefined, search: search.trim() || undefined });
      setRows(r.rows); setTotal(r.total);
    } catch (e) { flash((e as Error).message, "err"); }
  }, [kind, ctx.companyId, ctx.branchId, ctx.fyCode, statusFilter, search, flash, skipList]);
  useEffect(() => { const t = setTimeout(() => void loadList(), search ? 250 : 0); return () => clearTimeout(t); }, [loadList, search]);

  const show = (f: F, m: Mode) => { setFormState(f); setBaseSig(sig(f)); setMode(m); setErrors({}); };

  useEffect(() => {
    let live = true;
    const init = async (l: PLookups) => {
      setLookups(l);
      const snap = extra.restore;
      if (snap) {
        setSelectedId(snap.selectedId); setDoc(snap.doc); setFormState(snap.form); setBaseSig(snap.baseSig); setMode(snap.mode); setErrors({});
        flash("Ready", "info");
        return;
      }
      if (extra.initialDocId) {
        try {
          const d = await purchaseApi.get(kind, extra.initialDocId, ctx.companyId);
          if (!live) return;
          setSelectedId(d.id); setDoc(d); show(cfg.toForm(d, l), "view");
          flash(`Opened ${cfg.singular.toLowerCase()}`, "info");
        } catch (e) { if (live) flash((e as Error).message, "err"); }
        return;
      }
      show(extra.initialForm ?? cfg.emptyForm(l), "new");
      flash("Ready", "info");
      setTimeout(() => q("[data-zone=form] [data-field]:not(:disabled)")?.focus(), 60);
    };
    if (extra.sharedLookups) void init(extra.sharedLookups);
    else purchaseApi.lookups(ctx.companyId).then((l) => { if (live) void init(l); }).catch((e: Error) => live && flash(e.message, "err"));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.companyId]);

  useEffect(() => { extra.dirtyRef.current = dirty; });
  useEffect(() => { if (extra.snapshotRef && form) extra.snapshotRef.current = { doc, mode, form, baseSig, selectedId }; });
  useEffect(() => { if (extra.externalMessage) flash(extra.externalMessage.text, "info"); }, [extra.externalMessage, flash]);
  useEffect(() => extra.setStatus({ mode, count: total, shown: rows.length, message: msg.text, kind: msg.kind, hints: extra.hints }), [mode, total, rows.length, msg, extra.hints, extra.setStatus]);
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const setForm = (f: F) => { setFormState(f); };
  const patch = (p: Partial<F>) => setFormState((f) => (f ? { ...f, ...p } : f));
  const refreshList = () => { void loadList(); extra.onListChanged?.(); };
  const clearError = (...keys: string[]) => setErrors((e) => { const n = { ...e }; for (const k of keys) delete n[k]; return n; });

  // ---- guard ----
  const guard = (action: () => void) => {
    if (!dirty) return action();
    const stay = () => setDialog(null);
    setDialog({
      title: "Discard changes?", body: "This document has unsaved changes.", variant: "warning",
      buttons: [
        { label: "Save", kind: "primary", onClick: () => { setDialog(null); void save(); } },
        { label: "Discard", kind: "danger", onClick: () => { setDialog(null); action(); } },
        { label: "Stay", kind: "neutral", autoFocus: true, onClick: stay },
      ],
      onCancel: stay,
    });
  };

  // ---- mode changes ----
  const open = (d: PDoc, m: Mode = "view") => { setSelectedId(d.id); setDoc(d); show(cfg.toForm(d, lookups!), m); };
  const newDoc = (prefill?: F) => guard(() => {
    if (!lookups) return;
    setSelectedId(null); setDoc(null); show(prefill ?? cfg.emptyForm(lookups), "new");
    flash("New " + cfg.singular.toLowerCase(), "info");
    setTimeout(() => q("[data-zone=form] [data-field]:not(:disabled)")?.focus(), 40);
  });
  const select = (id: number) => guard(async () => {
    if (!lookups) return;
    try { open(await purchaseApi.get(kind, id, ctx.companyId)); flash(`Opened ${cfg.singular.toLowerCase()}`, "info"); }
    catch (e) { flash((e as Error).message, "err"); }
  });
  const edit = () => {
    if (mode !== "view" || !doc) return;
    if (!cfg.editable(doc)) return flash(`This ${cfg.singular.toLowerCase()} can no longer be edited.`, "warn", "Cannot edit");
    setMode("edit"); setErrors({});
    setTimeout(() => q("[data-zone=form] [data-field]:not(:disabled)")?.focus(), 40);
  };
  const cancel = () => guard(() => {
    if (doc) { open(doc); setTimeout(() => q("[data-zone=form] [data-field]:not(:disabled)")?.focus(), 0); } else if (lookups) show(cfg.emptyForm(lookups), "new");
  });
  const moveSel = (dir: 1 | -1) => {
    if (!rows.length) return;
    const i = rows.findIndex((r) => r.id === selectedId);
    const n = i < 0 ? (dir === 1 ? 0 : rows.length - 1) : Math.min(Math.max(i + dir, 0), rows.length - 1);
    if (rows[n].id !== selectedId) select(rows[n].id);
  };

  // ---- save ----
  const save = async (): Promise<boolean> => {
    if (mode === "view" || !form || !lookups || busy.current) return false;
    if (extra.beforeSave && !extra.beforeSave()) return false;
    const errs = cfg.validate(form, lookups);
    const first = Object.keys(errs).find((k) => errs[k]);
    if (first) {
      setErrors(errs);
      flash(errs[first]!, "warn");
      setTimeout(() => (q(`[data-field="${first}"]`) ?? q(`[data-field^="${first}"]`))?.focus(), 0);
      return false;
    }
    busy.current = true; setSaving(true);
    try {
      const body = { ...cfg.toPayload(form, doc), userId: ctx.userId };
      const r = mode === "edit" && doc
        ? await purchaseApi.update(kind, doc.id, ctx.companyId, body)
        : await purchaseApi.create(kind, { ...body, companyId: ctx.companyId, branchId: ctx.branchId });
      open(r.document);
      flash(`${mode === "edit" ? "Updated" : "Saved"} ${cfg.label(r.document)}`, "ok");
      refreshList();
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.field) setErrors({ [e.field]: e.message });
      flash((e as Error).message, "err");
      return false;
    } finally { busy.current = false; setSaving(false); }
  };

  // ---- delete ----
  const askDelete = () => {
    if (mode !== "view" || !doc) return;
    if (!cfg.deletable(doc)) { flash(`This ${cfg.singular.toLowerCase()} cannot be deleted.`, "warn", "Cannot delete"); return; }
    const target = doc;
    setDialog({
      title: `Delete ${cfg.singular.toLowerCase()}?`,
      body: <><span className="font-mono font-semibold">{cfg.label(target)}</span><br /><span className="text-slate-600">This cannot be undone.</span></>,
      buttons: [
        { label: "Cancel", kind: "neutral", autoFocus: true, onClick: () => setDialog(null) },
        {
          label: "Delete", kind: "danger",
          onClick: async () => {
            setDialog(null);
            try {
              await purchaseApi.remove(kind, target.id, ctx.companyId, ctx.userId);
              if (extra.onDeleted) extra.onDeleted();
              else { setSelectedId(null); setDoc(null); if (lookups) show(cfg.emptyForm(lookups), "new"); }
              flash(`Deleted ${cfg.label(target)}`, "ok");
              refreshList();
            } catch (e) { flash((e as Error).message, "err"); }
          },
        },
      ],
    });
  };

  // ---- workflow actions: approve, confirm, post, reverse ... (always asks first) ----
  const run = (spec: ActionSpec) => {
    if (!doc) return;
    if (dirty) return flash("Save or cancel your changes first.", "warn");
    const target = doc;
    setDialog({
      title: spec.title, body: spec.body,
      buttons: [
        { label: "Cancel", kind: "neutral", autoFocus: true, onClick: () => setDialog(null) },
        {
          label: spec.button, kind: spec.danger ? "danger" : "primary",
          onClick: async () => {
            setDialog(null);
            try {
              const r = await purchaseApi.action(kind, target.id, ctx.companyId, spec.action, { ...spec.payload, userId: ctx.userId });
              open(r.document);
              flash(spec.done(r.document, r.result), "ok");
              refreshList();
            } catch (e) { flash((e as Error).message, "err"); }
          },
        },
      ],
      onCancel: () => setDialog(null),
    });
  };

  // ---- shortcuts (one listener; the latest handlers come from a ref) ----
  const H = useRef({ save, newDoc, onNew: extra.onNew, edit, askDelete, cancel, moveSel, mode, dirty, dialogOpen: false, help: false, listCollapsed, setListCollapsed, listStorageKey, toggleList });
  H.current = { save, newDoc, onNew: extra.onNew, edit, askDelete, cancel, moveSel, mode, dirty, dialogOpen: !!dialog, help, listCollapsed, setListCollapsed, listStorageKey, toggleList };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const h = H.current;
      if (h.dialogOpen) return;
      if (h.help) { if (e.key === "Escape" || e.key === "F1") { e.preventDefault(); setHelp(false); } return; }
      const k = e.key, kl = k.toLowerCase(), ctrl = e.ctrlKey || e.metaKey, typing = (e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "TEXTAREA";
      if (ctrl && kl === "s") { e.preventDefault(); void h.save(); }
      else if ((ctrl && kl === "n") || k === "F3") { e.preventDefault(); if (h.onNew) h.onNew(); else h.newDoc(); }
      else if (k === "F2") { e.preventDefault(); h.edit(); }
      else if ((ctrl && k === "Delete") || (e.altKey && kl === "d")) { e.preventDefault(); h.askDelete(); }
      else if (k === "F4" || (ctrl && kl === "f") || (k === "/" && !typing)) { e.preventDefault(); searchRef.current?.focus(); }
      else if (ctrl && k === "ArrowDown") { e.preventDefault(); h.moveSel(1); }
      else if (ctrl && k === "ArrowUp") { e.preventDefault(); h.moveSel(-1); }
      else if (k === "F1" || (k === "?" && !typing)) { e.preventDefault(); setHelp(true); }
      else if (e.altKey && k === "1") { e.preventDefault(); q("[data-zone=sidebar] button[data-sb]")?.focus(); }
      else if (e.altKey && k === "2") { e.preventDefault(); q("[data-zone=form] [data-field]:not(:disabled)")?.focus(); }
      else if (e.altKey && k === "3") {
        e.preventDefault();
        if (h.listCollapsed) {
          h.setListCollapsed(false);
          localStorage.setItem(h.listStorageKey, "0");
          window.setTimeout(() => (q("[data-zone=list] [data-row][aria-selected=true]") ?? q("[data-zone=list] [data-row]") ?? q("[data-list-toggle]"))?.focus(), 40);
        } else (q("[data-zone=list] [data-row][aria-selected=true]") ?? q("[data-zone=list] [data-row]") ?? searchRef.current)?.focus();
      }
      else if (e.altKey && k === "4") { e.preventDefault(); h.toggleList(); }
      else if (k === "Escape" && h.mode === "edit") h.cancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const err = useMemo(() => (k: string) => errors[k], [errors]);

  return {
    lookups, rows, total, search, setSearch, statusFilter, setStatusFilter, selectedId, doc, mode, form, setForm, patch, errors, setErrors, err, clearError, saving, dirty,
    listCollapsed, toggleList,
    dialog, setDialog, help, setHelp, searchRef, flash, newDoc, select, edit, cancel, save, askDelete, run, open, guard, reload: loadList,
    readOnly: mode === "view",
  };
}
export type DocScreen<F extends object> = ReturnType<typeof useDocScreen<F>>;
