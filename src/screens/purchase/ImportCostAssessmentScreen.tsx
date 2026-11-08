import { Fragment, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { ArrowRight, Copy, Download, FileCheck2, Pencil, Plus, RotateCcw, Save, Trash2, X } from "lucide-react";
import { ApiError, importAssessmentApi, type ImportAssessmentPreview, type ImportAssessmentTermInput, type PLookups } from "../../api";
import { MasterReferencePicker, type ReferenceOption } from "../../components/MasterReferencePicker";
import { AssessmentAllocationGrid, type AssessmentAllocationCellUpdate } from "../../components/purchase/AssessmentAllocationGrid";
import { AssessmentInsights, AssessmentSummary } from "../../components/purchase/AssessmentPanels";
import { EmptyPanel, SidePanel, usePanelState } from "../../components/purchase/BillPanels";
import { formEnterKey, FormSection, Pill } from "../../components/purchase/Bits";
import { allocationCsv, openAssessmentsFor, readiness } from "../../lib/assessmentInsights";
import { defaultDate } from "../../lib/purchaseForm";
import { formatImportCost } from "../../../shared/import-costing";
import { toMicro } from "../../../shared/purchase-calculation";
import type { PurchaseScreenProps } from "./PurchaseOrderScreen";

type Basis = "VALUE" | "QUANTITY";
type AssessmentTerm = {
  key: string; termId: string; calcType: "PERCENT" | "AMOUNT"; rate: string; inputAmount: string; allocationBasis: Basis;
  capitalizable: boolean; isOverridden: boolean; overrideAmount: string; againstLedgerId: string; againstSubLedgerId: string;
  allocationMode: "AUTO" | "MANUAL"; manual: Record<string, string>;
};
export type Form = { importBillId: string; assessmentDate: string; referenceNo: string; remarks: string; terms: AssessmentTerm[] };
type Doc = Record<string, any> & { id: number; isPosted: boolean; state: string; terms: Record<string, any>[] };
export type ImportOption = Record<string, any> & { id: number; invoiceNumber: string; invoiceDate: string };
export type Stage = "header" | "work";
// What a tab keeps of its assessment so it can be put back when the user returns to it (the workspace shows one entry at a time).
export interface AssessmentSnapshot { doc: Doc | null; form: Form; editing: boolean; preview: ImportAssessmentPreview | null; stage: Stage; baseSig: string; message: string }

// One assessment, open in one tab of the cost assessment workspace. The workspace owns the lookups, the goods bills and the list.
export interface AssessmentEntryProps extends PurchaseScreenProps {
  tabId: number;
  lookups: PLookups;
  imports: ImportOption[];
  assessments: Record<string, any>[];
  docId: number | null;
  initialForm?: Form;
  snapRef: MutableRefObject<AssessmentSnapshot | null>;
  onMeta: (tabId: number, meta: { title: string; dirty: boolean; docId: number | null }) => void;
  onNew: (prefill?: Form) => void;
  onClose: (tabId: number) => void;
  onChanged: () => void;
}
const HEADER_KEYS = new Set(["importBillId", "assessmentDate"]);

const fieldClass = "fld min-w-0 h-7";
export const blankTerm = (): AssessmentTerm => ({
  key: Math.random().toString(36).slice(2), termId: "", calcType: "AMOUNT", rate: "", inputAmount: "", allocationBasis: "VALUE",
  capitalizable: true, isOverridden: false, overrideAmount: "", againstLedgerId: "", againstSubLedgerId: "", allocationMode: "AUTO", manual: {},
});
const safeMoney = (v: unknown) => { try { return formatImportCost(toMicro(String(v ?? "0")), 2); } catch { return "0.00"; } };
export const asForm = (d: Doc): Form => ({
  importBillId: String(d.importBillId ?? ""), assessmentDate: String(d.assessmentDate ?? "").slice(0, 10), referenceNo: d.referenceNo ?? "", remarks: d.remarks ?? "",
  terms: (d.terms ?? []).map((t: any) => ({
    key: String(t.id ?? Math.random()), termId: String(t.termId), calcType: t.calcType ?? "AMOUNT", rate: t.rate ?? "", inputAmount: t.inputAmount ?? "",
    allocationBasis: t.allocationBasis === "QUANTITY" ? "QUANTITY" : "VALUE", capitalizable: !!t.capitalizable, isOverridden: !!t.isOverridden,
    overrideAmount: t.overrideAmount ?? "", againstLedgerId: t.againstLedgerId ? String(t.againstLedgerId) : "", againstSubLedgerId: t.againstSubLedgerId ? String(t.againstSubLedgerId) : "",
    allocationMode: t.allocationMode === "MANUAL" ? "MANUAL" : "AUTO",
    manual: Object.fromEntries((t.manualAmounts ?? []).map((m: any) => [String(m.purchaseBillLineId), String(m.amount)])),
  })),
});

export const blankForm = (l: PLookups, fyCode: string): Form => ({ importBillId: "", assessmentDate: defaultDate(l.fiscalYears.find((y) => y.code === fyCode)), referenceNo: "", remarks: "", terms: [blankTerm()] });
const chargeValue = (t: AssessmentTerm) => (t.isOverridden ? t.overrideAmount : t.calcType === "PERCENT" ? t.rate : t.inputAmount).trim();

function termGap(t: AssessmentTerm, result: any): number {
  const typed = Object.values(t.manual).reduce((a, v) => { try { return a + Number(v || 0); } catch { return a; } }, 0);
  const target = Number(result?.finalAmount ?? result?.amount ?? 0);
  return Math.round((target - typed) * 100) / 100;
}

export default function ImportCostAssessmentEntry(p: AssessmentEntryProps) {
  const { lookups, imports } = p;
  const restored = useRef(p.snapRef.current);
  const first = useRef<Form | null>(restored.current ? null : p.docId ? null : p.initialForm ?? blankForm(lookups, p.fyCode));
  const [doc, setDoc] = useState<Doc | null>(restored.current?.doc ?? null);
  const [form, setForm] = useState<Form | null>(restored.current?.form ?? first.current);
  const [editing, setEditing] = useState(restored.current?.editing ?? !p.docId);
  const [stage, setStage] = useState<Stage>(restored.current?.stage ?? (p.docId ? "work" : "header"));
  const [preview, setPreview] = useState<ImportAssessmentPreview | null>(restored.current?.preview ?? null);
  const [previewError, setPreviewError] = useState("");
  const [previewPending, setPreviewPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(restored.current?.message ?? (p.docId ? "Loading…" : "New cost assessment"));
  const [leftCollapsed, toggleLeft] = usePanelState("assessment-left-collapsed");
  const [rightCollapsed, toggleRight] = usePanelState("assessment-right-collapsed");
  const baseSig = useRef(restored.current?.baseSig ?? (first.current ? JSON.stringify(first.current) : ""));
  const seq = useRef(0);
  const dirty = !!form && editing && JSON.stringify(form) !== baseSig.current;

  // open a saved assessment in this tab
  useEffect(() => {
    if (restored.current || !p.docId) return;
    let live = true;
    importAssessmentApi.get(p.docId, p.companyId).then((r) => {
      if (!live) return;
      const d = r.document as Doc;
      setDoc(d); setForm(asForm(d)); setEditing(false); setPreview(d.preview ?? null); baseSig.current = JSON.stringify(asForm(d)); setStage("work");
      setMessage(`Opened assessment ${d.assessmentNumber}`);
    }).catch((e: Error) => live && setMessage(e.message));
    return () => { live = false; };
  }, []);

  // what the workspace and the next visit to this tab need to know
  useEffect(() => { p.onMeta(p.tabId, { title: doc ? String(doc.assessmentNumber) : "New assessment", dirty, docId: doc?.id ?? null }); }, [doc?.assessmentNumber, doc?.id, dirty, p.tabId]);
  useEffect(() => { if (form) p.snapRef.current = { doc, form, editing, preview, stage, baseSig: baseSig.current, message }; });
  useEffect(() => {
    p.setStatus({
      mode: editing ? doc ? "edit" : "new" : "view", count: p.assessments.length, shown: p.assessments.length, message, kind: "info",
      hints: ["Ctrl+S Save", "F3 New tab", "F2 Edit", "F6 Add charge", "Alt+[ ] Panels", "Alt+, . Tabs", "Ctrl+V paste allocation block"],
    });
  }, [editing, doc, p.assessments.length, message, p.setStatus]);
  useEffect(() => { if (p.externalMessage) setMessage(p.externalMessage.text); }, [p.externalMessage]);

  const masters = lookups.terms ?? [];
  const termById = useMemo(() => new Map(masters.map((t) => [String(t.id), t])), [masters]);
  const termOptions: ReferenceOption[] = useMemo(
    () => masters.filter((t: any) => t.category === "ADDITIONAL").map((t: any) => ({
      value: String(t.id), label: `${t.code} — ${t.name}`, code: t.code, name: t.name,
      detail: `${t.category} · ${t.nature ?? "charge"}${t.distributeToLines ? " · normally capitalized" : ""}`, isActive: t.isActive,
    })),
    [masters],
  );
  const importOptions: ReferenceOption[] = useMemo(
    () => imports.map((b) => ({
      value: String(b.id), label: `${b.invoiceNumber} — ${b.invoiceDate}`, code: b.invoiceNumber, name: b.invoiceNumber,
      detail: `${safeMoney(b.cifValue)} CIF · ${b.lines?.length ?? 0} product lines`, isActive: true,
    })),
    [imports],
  );
  const selectedImport = imports.find((b) => String(b.id) === form?.importBillId);

  const requestTerms = (f: Form): ImportAssessmentTermInput[] => f.terms.filter((t) => t.termId).map((t) => ({
    termId: Number(t.termId), calcType: t.calcType, rate: t.calcType === "PERCENT" ? t.rate : undefined,
    inputAmount: t.calcType === "AMOUNT" ? t.inputAmount : undefined, isOverridden: t.isOverridden,
    overrideAmount: t.isOverridden ? t.overrideAmount : undefined, allocationBasis: t.allocationBasis, capitalizable: t.capitalizable,
    againstLedgerId: t.againstLedgerId ? Number(t.againstLedgerId) : null,
    againstSubLedgerId: t.againstSubLedgerId ? Number(t.againstSubLedgerId) : null,
    allocationMode: t.capitalizable ? t.allocationMode : "AUTO",
    manualAmounts: t.capitalizable && t.allocationMode === "MANUAL"
      ? Object.entries(t.manual).filter(([, v]) => v !== "").map(([line, amount]) => ({ purchaseBillLineId: Number(line), amount }))
      : undefined,
  }));

  useEffect(() => {
    const ticket = ++seq.current;
    if (!editing || !form?.importBillId) {
      setPreviewPending(false);
      if (!editing && doc?.preview) setPreview(doc.preview);
      else if (editing) { setPreview(null); setPreviewError(""); }
      return;
    }
    setPreviewPending(true);
    const timer = window.setTimeout(async () => {
      try {
        const r = await importAssessmentApi.preview({ companyId: p.companyId, branchId: p.branchId, importBillId: Number(form.importBillId), terms: requestTerms(form) });
        if (ticket === seq.current) { setPreview(r.preview); setPreviewError(""); setPreviewPending(false); }
      } catch (e) { if (ticket === seq.current) { setPreview(null); setPreviewError((e as Error).message); setPreviewPending(false); } }
    }, 180);
    return () => { clearTimeout(timer); };
  }, [editing, form, p.companyId, p.branchId, doc]);

  const focusLater = (selector: string, ms = 60) => window.setTimeout(() => document.querySelector<HTMLElement>(selector)?.focus(), ms);
  // A new tab for a new assessment, or for a copy that keeps this one's charges. The goods bill is left to choose, and product-wise typed amounts are
  // reset to automatic because they belong to the original bill's lines.
  const startCopy = () => {
    if (!doc) return;
    const source = asForm(doc);
    p.onNew({
      ...blankForm(lookups, p.fyCode),
      terms: source.terms.length ? source.terms.map((t) => ({ ...t, key: Math.random().toString(36).slice(2), allocationMode: "AUTO" as const, manual: {} })) : [blankTerm()],
    });
  };
  const updateTerm = (index: number, patch: Partial<AssessmentTerm>) => setForm((f) => f ? ({ ...f, terms: f.terms.map((t, i) => i === index ? { ...t, ...patch } : t) }) : f);
  const addCharge = () => {
    if (!form || !editing || busy || stage !== "work") return;
    const index = form.terms.length;
    setForm({ ...form, terms: [...form.terms, blankTerm()] });
    focusLater(`[data-field="terms.${index}.termId"]`, 0);
  };
  const selectTerm = (i: number, id: string) => {
    const m: any = termById.get(id);
    updateTerm(i, {
      termId: id,
      calcType: (m?.calcType as AssessmentTerm["calcType"]) || "AMOUNT",
      rate: m?.defaultRate != null ? String(m.defaultRate) : "",
      inputAmount: "",
      capitalizable: m?.distributeToLines !== false,
      againstLedgerId: m?.defaultAgainstLedgerId ? String(m.defaultAgainstLedgerId) : "",
      againstSubLedgerId: "",
      allocationMode: "AUTO",
      manual: {},
    });
  };

  // ---- header stage: the header form first; the charges open when it is complete ----
  const headerErrors = (f: Form) => {
    const e: Record<string, string> = {};
    if (!f.importBillId) e.importBillId = "Choose a posted goods bill";
    if (!f.assessmentDate) e.assessmentDate = "Assessment date is required";
    return e;
  };
  const confirmHeader = () => {
    if (!form) return false;
    const e = headerErrors(form);
    setErrors((cur) => ({ ...Object.fromEntries(Object.entries(cur).filter(([k]) => !HEADER_KEYS.has(k))), ...e }));
    const [field, text] = Object.entries(e)[0] ?? [];
    if (field) { setMessage(text); focusLater(`[data-field="${field}"]`, 30); return false; }
    setStage("work");
    setMessage(doc ? "Header checked" : "Header complete — add the charges");
    focusLater('[data-field="terms.0.termId"]');
    return true;
  };
  const editHeader = () => { setStage("header"); focusLater("[data-assessment-field]", 40); };
  const jump = (field: string) => {
    const inHeader = HEADER_KEYS.has(field);
    setStage(inHeader ? "header" : "work");
    focusLater(`[data-field="${field}"]`, 80);
  };

  const save = async () => {
    if (!form || !editing) return;
    if (stage === "header" && !doc) { confirmHeader(); return; }
    const e: Record<string, string> = headerErrors(form);
    if (!form.terms.some((t) => t.termId)) e.terms = "Add at least one charge term";
    for (const t of form.terms) {
      if (!t.termId) continue;
      if (!t.againstLedgerId) e.terms = "Each charge needs an against ledger (cash, bank, or party)";
    }
    setErrors(e);
    if (Object.keys(e).length) {
      setMessage(Object.values(e)[0]);
      if (Object.keys(e).some((k) => HEADER_KEYS.has(k))) { setStage("header"); focusLater(`[data-field="${Object.keys(e).find((k) => HEADER_KEYS.has(k))}"]`, 80); }
      else {
        setStage("work");
        focusLater('[data-field^="terms."][aria-invalid="true"], [data-field^="terms."]', 80);
      }
      return;
    }
    setBusy(true);
    const body = {
      companyId: p.companyId, branchId: p.branchId, userId: p.userId, fiscalYear: p.fyCode,
      importBillId: Number(form.importBillId), assessmentDate: form.assessmentDate,
      referenceNo: form.referenceNo.trim() || null, remarks: form.remarks.trim() || null, terms: requestTerms(form),
    };
    try {
      const r = doc ? await importAssessmentApi.update(doc.id, p.companyId, body) : await importAssessmentApi.create(body);
      const d = r.document as Doc;
      setDoc(d); setForm(asForm(d)); setEditing(false); setPreview(d.preview ?? preview); baseSig.current = JSON.stringify(asForm(d)); setStage("work");
      setMessage(`Saved draft ${d.assessmentNumber}`); p.onChanged();
    } catch (ex) {
      const err = ex as ApiError;
      if (err.field) {
        setErrors({ [err.field]: err.message });
        if (HEADER_KEYS.has(err.field)) setStage("header");
        focusLater(`[data-field="${err.field}"]`, 80);
      }
      setMessage(err.message);
    }
    finally { setBusy(false); }
  };
  const beginEdit = () => { if (doc && !doc.isPosted && !doc.reversedAt) { setEditing(true); setMessage("Editing draft"); baseSig.current = JSON.stringify(form); } };
  const cancel = () => {
    if (dirty && !window.confirm("Discard unsaved assessment changes?")) return;
    if (!doc) { p.onClose(p.tabId); return; }
    setForm(asForm(doc)); setEditing(false); setPreview(doc.preview ?? null);
    setErrors({}); setMessage("Changes discarded");
  };
  const applyAssessment = async () => {
    if (!doc || dirty || !window.confirm(`Apply assessment ${doc.assessmentNumber}? This freezes it, posts each charge to its own ledger against the chosen against ledger, and updates each product's landed cost.`)) return;
    setBusy(true);
    try {
      const r = await importAssessmentApi.apply(doc.id, p.companyId, p.userId);
      const d = r.document as Doc;
      setDoc(d); setForm(asForm(d)); setPreview(d.preview ?? null);
      setMessage(`Applied assessment ${d.assessmentNumber}; landed valuation updated.`);
      p.onChanged();
    } catch (e) { setMessage((e as Error).message); }
    finally { setBusy(false); }
  };
  const reverseAssessment = async () => {
    if (!doc || dirty) return;
    const reason = window.prompt(`Reason for reversing assessment ${doc.assessmentNumber}:`);
    if (!reason?.trim()) return;
    setBusy(true);
    try {
      const r = await importAssessmentApi.reverse(doc.id, p.companyId, p.userId, reason.trim());
      const d = r.document as Doc;
      setDoc(d); setForm(asForm(d)); setPreview(d.preview ?? null);
      setMessage(`Reversed assessment ${d.assessmentNumber}; valuation recalculated.`);
      p.onChanged();
    } catch (e) { setMessage((e as Error).message); }
    finally { setBusy(false); }
  };
  const deleteDraft = async () => {
    if (!doc || doc.isPosted || !window.confirm(`Delete draft assessment ${doc.assessmentNumber}?`)) return;
    setBusy(true);
    try {
      await importAssessmentApi.remove(doc.id, p.companyId, p.userId);
      p.onChanged(); p.onClose(p.tabId);
    } catch (e) { setMessage((e as Error).message); setBusy(false); }
  };

  // ---- shortcuts: the same ones the screen always had, plus the panels ----
  const keys = useRef<() => (e: KeyboardEvent) => void>(() => () => {});
  keys.current = () => (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      if (e.code === "BracketLeft") { e.preventDefault(); toggleLeft(); }
      else if (e.code === "BracketRight") { e.preventDefault(); toggleRight(); }
      else if (e.code === "Backslash") { e.preventDefault(); const both = leftCollapsed && rightCollapsed; if (leftCollapsed === both) toggleLeft(); if (rightCollapsed === both) toggleRight(); }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && editing) { e.preventDefault(); void save(); }
    else if (e.key === "F3") { e.preventDefault(); p.onNew(); }
    else if (e.key === "F2" && doc && !editing) { e.preventDefault(); beginEdit(); }
    else if (e.key === "F6" && editing && !busy && !target.closest('[role="dialog"]')) { e.preventDefault(); addCharge(); }
    else if (e.key === "Escape" && editing && !typing) cancel();
  };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => keys.current()(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const stateTone = (state: string): "green" | "amber" | "slate" | "blue" =>
    state === "APPLIED" ? "green" : state === "REVERSED" ? "amber" : "slate";
  const source = selectedImport ?? (doc ? { id: doc.importBillId, invoiceNumber: doc.invoiceNumber ?? `Goods bill ${doc.importBillId}`, invoiceDate: doc.importInvoiceDate ?? "" } : undefined);
  const isApplied = !!doc?.isPosted && !doc?.reversedAt;
  const lineRows = (preview?.lines ?? doc?.preview?.lines ?? []) as ImportAssessmentPreview["lines"];
  const resultFor = (t: AssessmentTerm) => preview?.termResults?.find?.((x: any) => x.termId === Number(t.termId) || x.termId === t.termId)
    ?? preview?.terms?.find?.((x: any) => x.termId === Number(t.termId));
  const activeTerms = form?.terms.filter((t) => t.termId) ?? [];
  const manualColumns = (form?.terms ?? []).flatMap((term, formIndex) => {
    if (!term.termId || !term.capitalizable || term.allocationMode !== "MANUAL") return [];
    const master: any = termById.get(term.termId);
    return [{
      key: term.key, formIndex, termId: term.termId, allocationBasis: term.allocationBasis, manual: term.manual,
      code: String(master?.code ?? `Charge ${formIndex + 1}`), name: String(master?.name ?? `Charge ${formIndex + 1}`), result: resultFor(term),
    }];
  });
  const previewOk = !!preview && !previewError;
  const chargeLabel = (t: AssessmentTerm, i: number) => { const m: any = termById.get(t.termId); return m ? String(m.code) : `Charge ${i + 1}`; };
  const checks = useMemo(() => readiness({
    hasBill: !!form?.importBillId, hasDate: !!form?.assessmentDate && !form.assessmentDate.startsWith("?"), previewOk, previewPending,
    charges: (form?.terms ?? []).map((t, index) => ({
      index, hasTerm: !!t.termId, hasLedger: !!t.againstLedgerId, hasValue: chargeValue(t) !== "", label: chargeLabel(t, index),
      manualGap: t.capitalizable && t.allocationMode === "MANUAL" ? termGap(t, resultFor(t)) : 0,
    })),
  }), [form, preview, previewOk, previewPending]);
  const firstProblem = checks.find((c) => !c.ok);
  const canApply = !!doc && !doc.isPosted && !doc.reversedAt && !editing && !dirty;
  const insightCharges = (form?.terms ?? []).flatMap((t, i) => {
    if (!t.termId) return [];
    const r: any = resultFor(t);
    const amount = Number(r?.finalAmount ?? r?.amount ?? 0);
    return [{ key: t.key, label: chargeLabel(t, i), amount: Number.isFinite(amount) ? amount : 0, inStock: t.capitalizable }];
  });
  const duplicates = openAssessmentsFor(p.assessments as { id: number; importBillId?: number | null; state?: string; assessmentNumber: string }[], form?.importBillId ? Number(form.importBillId) : null, doc?.id)
    .map((r) => ({ id: r.id, assessmentNumber: r.assessmentNumber, state: String(r.state ?? "") }));
  const updateManualCells = (updates: AssessmentAllocationCellUpdate[]) => setForm((current) => {
    if (!current) return current;
    const byTerm = new Map<string, Map<string, string>>();
    for (const update of updates) {
      const lineChanges = byTerm.get(update.termKey) ?? new Map<string, string>();
      lineChanges.set(update.lineKey, update.value);
      byTerm.set(update.termKey, lineChanges);
    }
    return {
      ...current,
      terms: current.terms.map((term) => {
        const changes = byTerm.get(term.key);
        return changes ? { ...term, manual: { ...term.manual, ...Object.fromEntries(changes) } } : term;
      }),
    };
  });
  const downloadCsv = () => {
    if (!lineRows.length) return;
    const blob = new Blob(["﻿" + allocationCsv(lineRows as any)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${doc?.assessmentNumber ?? "cost-assessment"}-landed-cost.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage(`Downloaded the landed cost of ${lineRows.length} product line${lineRows.length === 1 ? "" : "s"}.`);
  };

  if (!form) {
    return <section data-assessment-document className="grid min-h-0 flex-1 place-items-center text-slate-500">{message === "Loading…" ? "Loading…" : message}</section>;
  }
  const headerReady = stage === "work" || !!doc;
  const billLabel = source ? `${source.invoiceNumber}${source.invoiceDate ? ` · ${source.invoiceDate}` : ""}` : "";
  const stats = ([
    ["Goods value", preview?.goodsValue], ["CIF base", preview?.cifValue], ["Invoiced services", preview?.invoicedCapitalizedCosts],
    ["Earlier costs", preview?.existingPurchaseTermCosts], ["Assessed net", preview?.assessedNet], ["Final landed value", preview?.totalLandedValue],
  ] as const);

  return (
    <section data-assessment-document className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-300 px-3 py-1.5">
        <h1 className="text-[17px] font-semibold">Cost Assessment{doc && <span className="ml-2 font-mono text-[15px]">{doc.assessmentNumber}</span>}</h1>
        <span className="text-slate-600">Branch: <b>{p.branchName}</b> · FY <b>{p.fyCode}</b></span>
        {doc && <Pill text={doc.state} tone={stateTone(doc.state)} />}
        {dirty && <span className="text-[11px] text-amber-700">• unsaved changes</span>}
        <span className="min-w-0 flex-1 truncate text-right text-[11px] text-slate-600" role="status" title={message}>{message}</span>
      </div>

      <div className="flex min-h-0 flex-1">
        <SidePanel side="left" title="Header" collapsed={leftCollapsed} onToggle={toggleLeft} shortcut="Alt+[">
          {headerReady
            ? <AssessmentSummary assessmentNumber={doc?.assessmentNumber} date={form.assessmentDate} billLabel={billLabel} referenceNo={form.referenceNo} remarks={form.remarks} calendar={p.calendar} readOnly={!editing} onEdit={editHeader} />
            : <EmptyPanel>The header you enter in the middle appears here.</EmptyPanel>}
        </SidePanel>

        <div data-zone="form" onKeyDown={formEnterKey} className={`min-w-0 flex-1 px-3 py-2 ${stage === "header" ? "overflow-y-auto" : "flex min-h-0 flex-col gap-2 overflow-hidden"}`}>
          {stage === "header" ? (
            <div className="space-y-2">
              {!doc && <p className="text-[12px] text-slate-600"><b>Step 1 of 2</b> — choose the goods bill and set the date. The charges open when the header is complete.</p>}
              <FormSection title="Header" hint="Source bill and assessment details">
                <div className="grid grid-cols-1 gap-x-3 gap-y-1.5 md:grid-cols-2">
                  <label className="block text-[11px] font-semibold text-slate-600">Assessment date
                    <input data-assessment-field data-field="assessmentDate" type="date" className={fieldClass} disabled={!editing || busy} value={form.assessmentDate} aria-invalid={!!errors.assessmentDate} onChange={(e) => setForm({ ...form, assessmentDate: e.target.value })} />
                    {errors.assessmentDate && <span className="block text-[11px] font-normal text-red-700" role="alert">{errors.assessmentDate}</span>}
                  </label>
                  <div data-assessment-field>
                    <MasterReferencePicker
                      fieldName="importBillId" required label="Posted goods bill (local or import)" value={form.importBillId} options={importOptions}
                      onChange={(v) => {
                        if (v === form.importBillId) return;
                        const hadManualAmounts = form.terms.some((term) => Object.values(term.manual).some((amount) => amount.trim() !== ""));
                        setForm({ ...form, importBillId: v, terms: form.terms.map((term) => ({ ...term, manual: {} })) });
                        if (hadManualAmounts) setMessage("Source bill changed; previous product allocations were cleared.");
                      }} disabled={!editing || busy || !!doc} hasError={!!errors.importBillId}
                      scopeKey="purchase-bills" contextKey={`${p.companyId}:${p.branchId}`} placeholder="Choose a goods bill…"
                    />
                    {errors.importBillId && <p className="mt-0.5 text-[11px] text-red-700" role="alert">{errors.importBillId}</p>}
                  </div>
                  <label className="block text-[11px] font-semibold text-slate-600">Customs / reference no
                    <input data-assessment-field data-field="referenceNo" className={fieldClass} maxLength={60} disabled={!editing || busy} value={form.referenceNo} onChange={(e) => setForm({ ...form, referenceNo: e.target.value })} />
                  </label>
                  <label className="block text-[11px] font-semibold text-slate-600">Linked goods invoice
                    <input className={`${fieldClass} bg-slate-100`} readOnly aria-readonly="true" value={billLabel || "Choose a posted goods bill"} />
                  </label>
                  <label className="block text-[11px] font-semibold text-slate-600 md:col-span-2">Remarks
                    <textarea id="assessment-remarks" data-assessment-field data-field="remarks" className="fld min-h-9 w-full resize-y" rows={2} maxLength={1024}
                      disabled={!editing || busy} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} placeholder="Add a note for this assessment" />
                  </label>
                </div>
              </FormSection>
              <div className="flex justify-end pb-1">
                <button type="button" data-nav="header-continue" className="btn btn-primary" onClick={confirmHeader}>
                  {doc ? "Done — back to charges" : "Continue to charges"} <ArrowRight size={14} />{!doc && <span className="kbd">Ctrl+S</span>}
                </button>
              </div>
            </div>
          ) : (
            <>
              <section className="flex max-h-[44%] min-h-[120px] shrink-0 flex-col rounded-sm border border-slate-300 bg-white/70">
                <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <h2 className="text-[12px] font-semibold tracking-wide text-slate-800">Charges</h2>
                    <p className="text-[11px] text-slate-500">Dr own ledger / Cr against ledger · uncheck stock for tax or P&amp;L charges</p>
                  </div>
                  <button type="button" data-nav="add-charge" className="btn h-7" disabled={!editing || busy} onClick={addCharge}>
                    <Plus size={13} /> Add charge <span className="kbd">F6</span>
                  </button>
                </header>
                <div className="flex min-h-0 flex-1 flex-col p-2">
                <div className="min-h-0 flex-1 overflow-auto overscroll-contain border border-slate-200">
                  <table className="w-full min-w-[900px] table-fixed text-[10px]">
                    <thead className="sticky top-0 z-10 bg-slate-50 text-slate-600 shadow-sm">
                      <tr>
                        <th className="w-[170px] p-1 text-left">Charge term</th>
                        <th className="w-[96px] p-1 text-left">Calculation</th>
                        <th className="w-[150px] p-1 text-left">Rate / amount</th>
                        <th className="w-[132px] p-1 text-left">Allocate by</th>
                        <th className="w-[170px] p-1 text-left">Against ledger</th>
                        <th className="w-[64px] p-1 text-center">Stock</th>
                        <th className="w-[80px] p-1 text-right">Calculated</th>
                        <th className="w-[32px] p-1" aria-label="Remove" />
                      </tr>
                    </thead>
                    <tbody>
                      {form.terms.map((t, i) => {
                        const m: any = termById.get(t.termId);
                        const result = preview?.termResults?.find?.((x: any) => x.termId === Number(t.termId) || x.termId === t.termId)
                          ?? preview?.terms?.find?.((x: any) => x.termId === Number(t.termId));
                        const subs = (lookups?.subLedgers ?? []).filter((x) => String(x.generalLedgerId) === t.againstLedgerId);
                        return (
                          <Fragment key={t.key}>
                            <tr className="border-t border-slate-200 align-top">
                              <td className="p-1">
                                <MasterReferencePicker fieldName={`terms.${i}.termId`} label={`Charge ${i + 1}`} required value={t.termId} options={termOptions}
                                  onChange={(v) => selectTerm(i, v)} disabled={!editing || busy} scopeKey="purchase-terms"
                                  contextKey={`${p.companyId}:${p.branchId}`} placeholder="Choose charge…" hasError={!!errors.terms && !t.termId} />
                              </td>
                              <td className="p-1">
                                <select data-field={`terms.${i}.calcType`} className={fieldClass} disabled={!editing || busy || !t.termId} aria-label={`Calculation type for charge ${i + 1}`}
                                  value={t.calcType} onChange={(e) => updateTerm(i, { calcType: e.target.value as AssessmentTerm["calcType"] })}>
                                  <option value="PERCENT">Percent</option>
                                  <option value="AMOUNT">Fixed amount</option>
                                </select>
                                <div className="mt-0.5 truncate text-[9px] text-slate-500" title={`${m?.nature ?? "Charge"} · ${m?.calcBase ?? "CIF / running total"}`}>{m?.nature ?? "Charge"} · {m?.calcBase ?? "CIF / running total"}</div>
                              </td>
                              <td className="p-1">
                                <div className="flex gap-2">
                                  <input data-field={`terms.${i}.amount`} aria-label={t.calcType === "PERCENT" ? `Rate for charge ${i + 1}` : `Amount for charge ${i + 1}`}
                                    className={fieldClass} disabled={!editing || busy || !t.termId}
                                    value={t.calcType === "PERCENT" ? t.rate : t.inputAmount} inputMode="decimal"
                                    onChange={(e) => updateTerm(i, t.calcType === "PERCENT" ? { rate: e.target.value } : { inputAmount: e.target.value })}
                                    placeholder={t.calcType === "PERCENT" ? "Percent" : "Amount"} />
                                  {t.isOverridden && (
                                    <input data-field={`terms.${i}.override`} aria-label={`Override amount for charge ${i + 1}`} className={fieldClass} disabled={!editing || busy}
                                      value={t.overrideAmount} inputMode="decimal" onChange={(e) => updateTerm(i, { overrideAmount: e.target.value })} placeholder="Final override" />
                                  )}
                                </div>
                                <label className="mt-0.5 inline-flex items-center gap-1 text-[9px] text-slate-600">
                                  <input data-field={`terms.${i}.isOverridden`} type="checkbox" disabled={!editing || busy || !t.termId} checked={t.isOverridden} onChange={(e) => updateTerm(i, { isOverridden: e.target.checked })} />
                                  <span>Override calculated amount</span>
                                </label>
                              </td>
                              <td className="p-1">
                                <select data-field={`terms.${i}.allocationBasis`} className={fieldClass} disabled={!editing || busy || !t.capitalizable} aria-label={`Allocation basis for charge ${i + 1}`}
                                  value={t.allocationBasis} onChange={(e) => updateTerm(i, { allocationBasis: e.target.value as Basis })}>
                                  <option value="VALUE">Product value</option>
                                  <option value="QUANTITY">Quantity</option>
                                </select>
                                {t.capitalizable && (
                                  <select data-field={`terms.${i}.allocationMode`} className={`${fieldClass} mt-0.5`} disabled={!editing || busy} aria-label={`Allocation mode for charge ${i + 1}`}
                                    value={t.allocationMode} onChange={(e) => updateTerm(i, { allocationMode: e.target.value as "AUTO" | "MANUAL", manual: e.target.value === "MANUAL" ? t.manual : {} })}>
                                    <option value="AUTO">Auto split</option>
                                    <option value="MANUAL">Manual split</option>
                                  </select>
                                )}
                              </td>
                              <td className="p-1">
                                <select data-field={`terms.${i}.againstLedgerId`} className={fieldClass} disabled={!editing || busy || !t.termId} aria-label={`Against ledger for charge ${i + 1}`}
                                  aria-invalid={!!errors.terms && !!t.termId && !t.againstLedgerId} value={t.againstLedgerId}
                                  onChange={(e) => updateTerm(i, { againstLedgerId: e.target.value, againstSubLedgerId: "" })}>
                                  <option value="">Choose…</option>
                                  {(lookups?.vendors ?? []).filter((l) => l.isActive && String(l.id) !== String(m?.generalLedgerId)).map((l) => (
                                    <option key={l.id} value={l.id}>{l.code} — {l.name}</option>
                                  ))}
                                </select>
                                {subs.length > 0 && (
                                  <select data-field={`terms.${i}.againstSubLedgerId`} className={`${fieldClass} mt-0.5`} disabled={!editing || busy} aria-label={`Sub-ledger for charge ${i + 1}`}
                                    value={t.againstSubLedgerId} onChange={(e) => updateTerm(i, { againstSubLedgerId: e.target.value })}>
                                    <option value="">Sub-ledger…</option>
                                    {subs.map((x) => <option key={x.id} value={x.id}>{x.code} — {x.name}</option>)}
                                  </select>
                                )}
                                <div className="mt-0.5 truncate text-[9px] text-slate-500" title={`Own ledger: ${m ? ((lookups?.vendors ?? []).find((l) => l.id === m.generalLedgerId)?.name ?? "—") : "—"}`}>Own ledger: {m ? ((lookups?.vendors ?? []).find((l) => l.id === m.generalLedgerId)?.name ?? "—") : "—"}</div>
                              </td>
                              <td className="p-1 text-center">
                                <label className="inline-flex items-center gap-1.5">
                                  <input data-field={`terms.${i}.capitalizable`} aria-label={`Capitalize charge ${i + 1} into inventory`} type="checkbox" disabled={!editing || busy}
                                    checked={t.capitalizable} onChange={(e) => updateTerm(i, { capitalizable: e.target.checked })} />
                                  <span className="sr-only">In stock value</span>
                                </label>
                              </td>
                              <td className="p-1 text-right tabular-nums">{result ? safeMoney(result.finalAmount ?? result.amount) : "—"}</td>
                              <td className="p-1 text-right">
                                <button type="button" className="btn btn-compact" disabled={!editing || busy || form.terms.length === 1}
                                  aria-label={`Remove charge ${i + 1}`} onClick={() => setForm({ ...form, terms: form.terms.filter((_, n) => n !== i) })}>
                                  <Trash2 size={13} />
                                </button>
                              </td>
                            </tr>
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                  {errors.terms && <p className="mt-1 shrink-0 text-xs text-red-700" role="alert">{errors.terms}</p>}
                </div>
              </section>

              <section className="flex min-h-0 flex-1 flex-col rounded-sm border border-slate-300 bg-white/70">
                <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <h2 className="text-[12px] font-semibold tracking-wide text-slate-800">Product allocation &amp; landed cost</h2>
                    <p className="text-[11px] text-slate-500">{manualColumns.length ? "Edit manual splits inline · paste spreadsheet ranges" : "Choose Manual split on a charge to edit allocations inline"}</p>
                  </div>
                  <button type="button" data-nav="download-csv" className="btn h-7" disabled={!lineRows.length} onClick={downloadCsv} title="Download the landed cost of every product line as a spreadsheet file"><Download size={13} /> CSV</button>
                </header>
                <div className="flex min-h-0 flex-1 flex-col p-2">
                  {form.importBillId ? (
                    <AssessmentAllocationGrid fill lines={lineRows} terms={manualColumns} editing={editing} busy={busy}
                      previewReady={previewOk && !previewPending} onCellsChange={updateManualCells} onMessage={setMessage} />
                  ) : (
                    <div className="rounded-sm border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-[12px] text-slate-600">
                      Select a posted goods bill to unlock product allocation and landed-cost impact. <button type="button" className="ml-1 font-semibold text-blue-700 underline underline-offset-2" onClick={editHeader}>Choose a goods bill</button>.
                    </div>
                  )}
                </div>
              </section>
            </>
          )}
        </div>

        <SidePanel side="right" title="Landed cost" collapsed={rightCollapsed} onToggle={toggleRight} shortcut="Alt+]">
          {headerReady
            ? <AssessmentInsights preview={preview ?? doc?.preview ?? null} previewError={previewError} previewPending={previewPending}
                source={selectedImport ? { label: billLabel, cif: String(selectedImport.cifValue ?? "0"), lineCount: selectedImport.lines?.length ?? 0 } : undefined}
                charges={insightCharges} duplicates={duplicates} checks={checks} showChecks={!isApplied && !doc?.reversedAt} onJump={jump} />
            : <EmptyPanel>What the charges do to the landed cost appears here once the header is complete.</EmptyPanel>}
        </SidePanel>
      </div>

      <footer className="shrink-0 space-y-1.5 border-t border-slate-400 bg-slate-50 py-1.5">
        {!!form.importBillId && (
          <section aria-label="Cost assessment summary" aria-live="polite" aria-busy={previewPending} className="flex flex-wrap items-baseline justify-center gap-x-5 gap-y-0.5 px-3">
            {stats.map(([label, value], i) => (
              <div key={label} className="flex min-w-0 items-baseline gap-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-600">{label}</span>
                <span className={`tabular-nums font-semibold ${i === stats.length - 1 ? "rounded-sm bg-blue-50 px-2 text-[15px] text-blue-950" : "text-[13px] text-slate-900"}`}>{value == null ? "—" : safeMoney(value)}</span>
              </div>
            ))}
            {previewError && <span role="alert" className="max-w-[40ch] truncate text-[11px] text-red-800" title={previewError}>{previewError}</span>}
          </section>
        )}
        <div className="flex flex-wrap items-center justify-center gap-2 px-3">
          {editing ? (
            <>
              <button type="button" className="btn btn-primary" disabled={busy || (stage === "header" && !doc)} title={stage === "header" && !doc ? "Finish the header first (Continue to charges)" : undefined} onClick={() => void save()}><Save size={14} /> Save draft <span className="kbd">Ctrl+S</span></button>
              <button type="button" className="btn" disabled={busy} onClick={cancel}><X size={14} /> Cancel <span className="kbd">Esc</span></button>
            </>
          ) : (
            <>
              <button type="button" className="btn btn-primary" onClick={() => p.onNew()}><Plus size={14} /> New assessment <span className="kbd">F3</span></button>
              <button type="button" className="btn" disabled={!doc || busy} onClick={startCopy}><Copy size={14} /> Copy</button>
              <button type="button" className="btn" disabled={!doc || doc.isPosted || !!doc.reversedAt} onClick={beginEdit}><Pencil size={14} /> Edit draft <span className="kbd">F2</span></button>
              <button type="button" className="btn" disabled={!doc || doc.isPosted || !!doc.reversedAt} onClick={() => void deleteDraft()}><Trash2 size={14} /> Delete draft</button>
              {canApply && <button type="button" className="btn btn-primary" disabled={busy || !!firstProblem} title={firstProblem ? `Not ready: ${firstProblem.label}` : undefined} onClick={() => void applyAssessment()}><FileCheck2 size={14} /> Apply assessment</button>}
              {isApplied && <button type="button" className="btn" disabled={busy} onClick={() => void reverseAssessment()}><RotateCcw size={14} /> Reverse</button>}
            </>
          )}
          {doc?.reversedAt && <span className="text-xs text-amber-800">Reversed: {doc.reversalReason}</span>}
        </div>
      </footer>
    </section>
  );
}
