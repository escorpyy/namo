import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, FileCheck2, Plus, RotateCcw, Save, Search, Trash2, X } from "lucide-react";
import { ApiError, importAssessmentApi, purchaseApi, type ImportAssessmentPreview, type ImportAssessmentTermInput, type PLookups } from "../../api";
import { MasterReferencePicker, type ReferenceOption } from "../../components/MasterReferencePicker";
import { AssessmentAllocationGrid, type AssessmentAllocationCellUpdate } from "../../components/purchase/AssessmentAllocationGrid";
import { focusStep, FormSection, Pill } from "../../components/purchase/Bits";
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
type Form = { importBillId: string; assessmentDate: string; referenceNo: string; remarks: string; terms: AssessmentTerm[] };
type Doc = Record<string, any> & { id: number; isPosted: boolean; state: string; terms: Record<string, any>[] };
type ImportOption = Record<string, any> & { id: number; invoiceNumber: string; invoiceDate: string };

const fieldClass = "fld min-w-0 h-7";
const blankTerm = (): AssessmentTerm => ({
  key: Math.random().toString(36).slice(2), termId: "", calcType: "AMOUNT", rate: "", inputAmount: "", allocationBasis: "VALUE",
  capitalizable: true, isOverridden: false, overrideAmount: "", againstLedgerId: "", againstSubLedgerId: "", allocationMode: "AUTO", manual: {},
});
const safeMoney = (v: unknown) => { try { return formatImportCost(toMicro(String(v ?? "0")), 2); } catch { return "0.00"; } };
const asForm = (d: Doc): Form => ({
  importBillId: String(d.importBillId ?? ""), assessmentDate: String(d.assessmentDate ?? "").slice(0, 10), referenceNo: d.referenceNo ?? "", remarks: d.remarks ?? "",
  terms: (d.terms ?? []).map((t: any) => ({
    key: String(t.id ?? Math.random()), termId: String(t.termId), calcType: t.calcType ?? "AMOUNT", rate: t.rate ?? "", inputAmount: t.inputAmount ?? "",
    allocationBasis: t.allocationBasis === "QUANTITY" ? "QUANTITY" : "VALUE", capitalizable: !!t.capitalizable, isOverridden: !!t.isOverridden,
    overrideAmount: t.overrideAmount ?? "", againstLedgerId: t.againstLedgerId ? String(t.againstLedgerId) : "", againstSubLedgerId: t.againstSubLedgerId ? String(t.againstSubLedgerId) : "",
    allocationMode: t.allocationMode === "MANUAL" ? "MANUAL" : "AUTO",
    manual: Object.fromEntries((t.manualAmounts ?? []).map((m: any) => [String(m.purchaseBillLineId), String(m.amount)])),
  })),
});

function termGap(t: AssessmentTerm, result: any): number {
  const typed = Object.values(t.manual).reduce((a, v) => { try { return a + Number(v || 0); } catch { return a; } }, 0);
  const target = Number(result?.finalAmount ?? result?.amount ?? 0);
  return Math.round((target - typed) * 100) / 100;
}

export default function ImportCostAssessmentScreen(p: PurchaseScreenProps) {
  const [lookups, setLookups] = useState<PLookups | null>(null);
  const [imports, setImports] = useState<ImportOption[]>([]);
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [doc, setDoc] = useState<Doc | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState<ImportAssessmentPreview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [previewPending, setPreviewPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Loading…");
  const [listSelection, setListSelection] = useState<number | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const baseSig = useRef("");
  const seq = useRef(0);
  const statusKind = "info";
  const dirty = !!form && editing && JSON.stringify(form) !== baseSig.current;
  p.dirtyRef.current = dirty;

  const onFormKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement;
    if (e.key !== "Enter" || !el.hasAttribute("data-field") || el.getAttribute("role") === "combobox") return;
    if (el instanceof HTMLTextAreaElement) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault(); focusStep(el, e.shiftKey ? -1 : 1); return;
    }
    if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement)) return;
    e.preventDefault(); focusStep(el, e.shiftKey ? -1 : 1);
  };

  const loadImports = useCallback(async (l: PLookups | null) => {
    const r = await importAssessmentApi.eligibleImports({ companyId: p.companyId, branchId: p.branchId, fiscalYear: p.fyCode });
    setImports(r.rows as ImportOption[]);
    if (l) setForm((current) => current ?? { importBillId: "", assessmentDate: defaultDate(l.fiscalYears.find((y) => y.code === p.fyCode)), referenceNo: "", remarks: "", terms: [blankTerm()] });
  }, [p.companyId, p.branchId, p.fyCode]);
  const loadList = useCallback(async () => {
    try {
      const r = await importAssessmentApi.list({ companyId: p.companyId, branchId: p.branchId, fiscalYear: p.fyCode, search: search.trim() || undefined });
      setRows(r.rows); setTotal(r.total);
    } catch (e) { setMessage((e as Error).message); }
  }, [p.companyId, p.branchId, p.fyCode, search]);

  useEffect(() => {
    let live = true;
    purchaseApi.lookups(p.companyId).then(async (l) => {
      if (!live) return;
      setLookups(l);
      await loadImports(l);
      await loadList();
      if (live) setMessage("Ready");
    }).catch((e: Error) => live && setMessage(e.message));
    return () => { live = false; };
  }, [p.companyId, loadImports, loadList]);
  useEffect(() => { const t = window.setTimeout(() => void loadList(), search ? 250 : 0); return () => clearTimeout(t); }, [loadList, search]);
  useEffect(() => {
    p.setStatus({
      mode: editing ? doc ? "edit" : "new" : "view", count: total, shown: rows.length, message, kind: statusKind,
      hints: ["Ctrl+S Save", "F3 New", "F2 Edit", "F6 Add charge", "Ctrl+V paste allocation block", "Enter: next field"],
    });
  }, [editing, doc, total, rows.length, message, statusKind, p.setStatus]);
  useEffect(() => { if (p.externalMessage) setMessage(p.externalMessage.text); }, [p.externalMessage]);

  const masters = lookups?.terms ?? [];
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

  const startNew = () => {
    if (dirty && !window.confirm("Discard unsaved assessment changes?")) return;
    const next: Form = { importBillId: "", assessmentDate: defaultDate(lookups?.fiscalYears.find((y) => y.code === p.fyCode)), referenceNo: "", remarks: "", terms: [blankTerm()] };
    setDoc(null); setForm(next); setEditing(true); setPreview(null); setErrors({}); baseSig.current = JSON.stringify(next); setMessage("New cost assessment");
    requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-assessment-field]")?.focus());
  };
  // A new draft with the same charges as the open assessment (any state). The goods bill is left to choose, and product-wise typed amounts are
  // reset to automatic because they belong to the original bill's lines.
  const startCopy = () => {
    if (!doc) return;
    const source = asForm(doc);
    const next: Form = {
      importBillId: "", assessmentDate: defaultDate(lookups?.fiscalYears.find((y) => y.code === p.fyCode)), referenceNo: "", remarks: "",
      terms: source.terms.length ? source.terms.map((t) => ({ ...t, key: Math.random().toString(36).slice(2), allocationMode: "AUTO" as const, manual: {} })) : [blankTerm()],
    };
    setDoc(null); setForm(next); setEditing(true); setPreview(null); setErrors({}); baseSig.current = JSON.stringify(next);
    setMessage(`New assessment copied from ${doc.assessmentNumber}: choose the goods bill, then save`);
    requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-assessment-field]")?.focus());
  };
  const openDoc = async (id: number) => {
    if (dirty && !window.confirm("Discard unsaved assessment changes?")) return;
    setBusy(true);
    try {
      const r = await importAssessmentApi.get(id, p.companyId);
      const d = r.document as Doc;
      setDoc(d); setForm(asForm(d)); setEditing(false); setPreview(d.preview ?? null); setErrors({}); setListSelection(id); setMessage(`Opened assessment ${d.assessmentNumber}`);
      baseSig.current = JSON.stringify(asForm(d));
    } catch (e) { setMessage((e as Error).message); }
    finally { setBusy(false); }
  };
  const updateTerm = (index: number, patch: Partial<AssessmentTerm>) => setForm((f) => f ? ({ ...f, terms: f.terms.map((t, i) => i === index ? { ...t, ...patch } : t) }) : f);
  const addCharge = () => {
    if (!form || !editing || busy) return;
    const index = form.terms.length;
    setForm({ ...form, terms: [...form.terms, blankTerm()] });
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-field="terms.${index}.termId"]`)?.focus());
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
  const save = async () => {
    if (!form || !editing) return;
    const e: Record<string, string> = {};
    if (!form.importBillId) e.importBillId = "Choose a posted goods bill";
    if (!form.assessmentDate) e.assessmentDate = "Assessment date is required";
    if (!form.terms.some((t) => t.termId)) e.terms = "Add at least one charge term";
    for (const t of form.terms) {
      if (!t.termId) continue;
      if (!t.againstLedgerId) e.terms = "Each charge needs an against ledger (cash, bank, or party)";
    }
    setErrors(e);
    if (Object.keys(e).length) {
      setMessage(Object.values(e)[0]);
      requestAnimationFrame(() => {
        const invalid = document.querySelector<HTMLElement>("[data-assessment-field][aria-invalid=true]")
          ?? document.querySelector<HTMLElement>("[data-assessment-field] [aria-invalid=true]")
          ?? document.querySelector<HTMLElement>('[data-field^="terms."][aria-invalid="true"]')
          ?? document.querySelector<HTMLElement>('[data-field^="terms."]');
        invalid?.focus();
      });
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
      setDoc(d); setForm(asForm(d)); setEditing(false); setPreview(d.preview ?? preview); baseSig.current = JSON.stringify(asForm(d));
      setMessage(`Saved draft ${d.assessmentNumber}`); await loadList(); await loadImports(lookups);
    } catch (ex) {
      const err = ex as ApiError;
      if (err.field) {
        setErrors({ [err.field]: err.message });
        requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-field="${err.field}"]`)?.focus());
      }
      setMessage(err.message);
    }
    finally { setBusy(false); }
  };
  const beginEdit = () => { if (doc && !doc.isPosted && !doc.reversedAt) { setEditing(true); setMessage("Editing draft"); baseSig.current = JSON.stringify(form); } };
  const cancel = () => {
    if (dirty && !window.confirm("Discard unsaved assessment changes?")) return;
    if (doc) { setForm(asForm(doc)); setEditing(false); setPreview(doc.preview ?? null); }
    else { setForm({ importBillId: "", assessmentDate: defaultDate(lookups?.fiscalYears.find((y) => y.code === p.fyCode)), referenceNo: "", remarks: "", terms: [blankTerm()] }); setEditing(false); setPreview(null); }
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
      await loadList(); await loadImports(lookups);
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
      await loadList(); await loadImports(lookups);
    } catch (e) { setMessage((e as Error).message); }
    finally { setBusy(false); }
  };
  const deleteDraft = async () => {
    if (!doc || doc.isPosted || !window.confirm(`Delete draft assessment ${doc.assessmentNumber}?`)) return;
    setBusy(true);
    try {
      await importAssessmentApi.remove(doc.id, p.companyId, p.userId);
      setDoc(null); setForm(null); setEditing(false); setPreview(null); setMessage("Draft deleted");
      await loadList(); await loadImports(lookups);
    } catch (e) { setMessage((e as Error).message); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && editing) { e.preventDefault(); void save(); }
      else if (e.key === "F3") { e.preventDefault(); startNew(); }
      else if (e.key === "F2" && doc && !editing) { e.preventDefault(); beginEdit(); }
      else if (e.key === "F6" && editing && !busy && !target.closest('[role="dialog"]')) { e.preventDefault(); addCharge(); }
      else if ((e.ctrlKey || e.metaKey) && e.key === "ArrowDown") {
        e.preventDefault();
        const i = rows.findIndex((r) => r.id === listSelection);
        const n = rows[Math.min(i < 0 ? 0 : i + 1, rows.length - 1)];
        if (n) void openDoc(n.id);
      } else if ((e.ctrlKey || e.metaKey) && e.key === "ArrowUp") {
        e.preventDefault();
        const i = rows.findIndex((r) => r.id === listSelection);
        const n = rows[Math.max(i <= 0 ? 0 : i - 1, 0)];
        if (n) void openDoc(n.id);
      } else if (e.key === "Escape" && editing && !typing) cancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  const stateTone = (state: string): "green" | "amber" | "slate" | "blue" =>
    state === "APPLIED" ? "green" : state === "REVERSED" ? "amber" : "slate";
  const source = selectedImport ?? (doc ? { id: doc.importBillId, invoiceNumber: doc.invoiceNumber ?? `Goods bill ${doc.importBillId}`, invoiceDate: doc.importInvoiceDate ?? "" } : undefined);
  const canApply = !!doc && !doc.isPosted && !doc.reversedAt && !editing && !dirty;
  const isApplied = !!doc?.isPosted && !doc?.reversedAt;
  const lineRows = (preview?.lines ?? doc?.preview?.lines ?? []) as ImportAssessmentPreview["lines"];
  const activeTerms = form?.terms.filter((t) => t.termId) ?? [];
  const manualTerms = activeTerms.filter((t) => t.capitalizable && t.allocationMode === "MANUAL");
  const manualColumns = (form?.terms ?? []).flatMap((term, formIndex) => {
    if (!term.termId || !term.capitalizable || term.allocationMode !== "MANUAL") return [];
    const master: any = termById.get(term.termId);
    const result = preview?.termResults?.find?.((x: any) => x.termId === Number(term.termId) || x.termId === term.termId)
      ?? preview?.terms?.find?.((x: any) => x.termId === Number(term.termId));
    return [{
      key: term.key, formIndex, termId: term.termId, allocationBasis: term.allocationBasis, manual: term.manual,
      code: String(master?.code ?? `Charge ${formIndex + 1}`), name: String(master?.name ?? `Charge ${formIndex + 1}`), result,
    }];
  });
  const manualsBalanced = manualTerms.every((t) => {
    const result = preview?.termResults?.find?.((x: any) => x.termId === Number(t.termId) || x.termId === t.termId)
      ?? preview?.terms?.find?.((x: any) => x.termId === Number(t.termId));
    return termGap(t, result) === 0;
  });
  const ledgersOk = activeTerms.length > 0 && activeTerms.every((t) => !!t.againstLedgerId);
  const previewOk = !!preview && !previewError;
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

  return (
    <main className="flex-1 min-w-0 flex min-h-0" data-assessment-document>
      <section className="flex-1 min-w-0 flex flex-col min-h-0">
        <header className="px-4 pt-3 pb-2 shrink-0">
          <div className="flex items-end gap-3 flex-wrap">
            <h1 className="text-[22px] font-semibold">Cost Assessment</h1>
            <span className="pb-1 text-slate-600">Branch: <b>{p.branchName}</b> · FY <b>{p.fyCode}</b></span>
            {doc && <span className="pb-1 font-mono text-[12px] font-semibold text-slate-700">{doc.assessmentNumber}</span>}
            {doc && <span className="mb-1"><Pill text={doc.state} tone={stateTone(doc.state)} /></span>}
            {dirty && <span className="pb-1 text-[11px] text-amber-700">• unsaved changes</span>}
          </div>
          <div className="double-rule mt-1" />
          <p className="mt-1 truncate text-[11px] text-slate-700" role="status" title={message}>
            {message}
          </p>
        </header>

          <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-2 space-y-1.5" onKeyDown={onFormKey}>
          {!lookups || !form ? <p className="text-slate-500 p-2">Loading…</p> : <>
            <div className="grid grid-cols-1 2xl:grid-cols-12 gap-1.5">
            <FormSection title="Header" hint="Source bill and assessment details" className="2xl:col-span-4">
              <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                <label className="block text-[11px] font-semibold text-slate-600">Assessment date
                  <input data-assessment-field data-field="assessmentDate" type="date" className={fieldClass} disabled={!editing || busy} value={form.assessmentDate} aria-invalid={!!errors.assessmentDate} onChange={(e) => setForm({ ...form, assessmentDate: e.target.value })} />
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
                </div>
                <label className="block text-[11px] font-semibold text-slate-600">Customs / reference no
                  <input data-assessment-field data-field="referenceNo" className={fieldClass} maxLength={60} disabled={!editing || busy} value={form.referenceNo} onChange={(e) => setForm({ ...form, referenceNo: e.target.value })} />
                </label>
                <label className="block text-[11px] font-semibold text-slate-600">Linked goods invoice
                  <input className={`${fieldClass} bg-slate-100`} readOnly aria-readonly="true" value={source ? `${source.invoiceNumber}${source.invoiceDate ? ` · ${source.invoiceDate}` : ""}` : "Choose a posted goods bill"} />
                </label>
              </div>
              {errors.importBillId && <p className="mt-1 text-xs text-red-700" role="alert">{errors.importBillId}</p>}
            </FormSection>

            <FormSection title="Charges" hint="Dr own ledger / Cr against ledger · uncheck stock value for tax or P&L charges" className="2xl:col-span-8">
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="text-[10px] text-slate-600">Percent terms use the CIF / running base.</p>
                <button type="button" data-nav="add-charge" className="btn h-7" disabled={!editing || busy} onClick={addCharge}>
                  <Plus size={13} /> Add charge <span className="kbd">F6</span>
                </button>
              </div>
              <div className="max-h-[28vh] overflow-auto overscroll-contain border border-slate-200">
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
              {errors.terms && <p className="mt-2 text-xs text-red-700" role="alert">{errors.terms}</p>}
            </FormSection>
            </div>
            <div className="space-y-1.5">
            {form.importBillId ? (
              <div className="space-y-1.5">
                <section className="sticky top-0 z-10 border border-blue-300 bg-blue-50 shadow-sm" aria-label="Cost assessment summary" aria-live="polite" aria-busy={previewPending}>
                  <div className="grid grid-cols-2 divide-x divide-y divide-blue-200 sm:grid-cols-3 lg:grid-cols-6 lg:divide-y-0">
                    {([
                      ["Goods value", preview?.goodsValue],
                      ["CIF base", preview?.cifValue],
                      ["Invoiced services", preview?.invoicedCapitalizedCosts],
                      ["Earlier costs on bill", preview?.existingPurchaseTermCosts],
                      ["Assessed net", preview?.assessedNet],
                      ["Final landed value", preview?.totalLandedValue],
                    ] as const).map(([label, value]) => (
                      <div key={label} className="min-w-0 px-2 py-1">
                        <div className="truncate text-[9px] font-semibold uppercase tracking-wide text-slate-600">{label}</div>
                        <div className="text-right text-[13px] font-semibold tabular-nums">{value == null ? "—" : safeMoney(value)}</div>
                      </div>
                    ))}
                  </div>
                  <p className={`border-t border-blue-200 px-2.5 py-1 text-[11px] ${previewError ? "text-red-800" : "text-slate-600"}`} role={previewError ? "alert" : "status"}>
                    {previewError || (previewPending
                      ? "Updating the live costing preview…"
                      : preview
                      ? "Live preview · same costing engine as save/apply. Non-stock charges stay out of inventory value."
                      : "Calculating product-wise landed costs…")}
                  </p>
                </section>

                <FormSection title="Product allocation & landed cost" hint={manualColumns.length
                  ? "Edit manual splits inline · paste spreadsheet ranges · auto-fill exact splits by basis."
                  : "Choose Manual split on any charge to edit product allocations inline."}>
                  <AssessmentAllocationGrid lines={lineRows} terms={manualColumns} editing={editing} busy={busy}
                    previewReady={previewOk && !previewPending} onCellsChange={updateManualCells} onMessage={setMessage} />
                </FormSection>
              </div>
            ) : (
              <div className="rounded-sm border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-[12px] text-slate-600">
                Select a posted goods bill to unlock product allocation and landed-cost impact. <button type="button" className="ml-1 font-semibold text-blue-700 underline underline-offset-2" onClick={() => document.querySelector<HTMLElement>('[data-field="importBillId"]')?.focus()}>Choose a goods bill</button>.
              </div>
            )}
            </div>
            <div className="flex w-full items-center gap-2 border border-slate-300 bg-white/70 px-3 py-1">
              <label htmlFor="assessment-remarks" className="shrink-0 text-[11px] font-semibold text-slate-600">Remarks</label>
              <textarea id="assessment-remarks" data-assessment-field data-field="remarks" className="fld min-w-0 flex-1 h-9 min-h-9 resize-y" maxLength={1024}
                disabled={!editing || busy} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })}
                placeholder="Add a note for this assessment" />
            </div>
          </>}
        </div>

        <footer className="shrink-0 border-t border-slate-400 bg-slate-50 px-4 py-2 flex items-center gap-2 flex-wrap">
          {editing ? (
            <>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}><Save size={14} /> Save draft <span className="kbd">Ctrl+S</span></button>
              <button type="button" className="btn" disabled={busy} onClick={cancel}><X size={14} /> Cancel <span className="kbd">Esc</span></button>
            </>
          ) : (
            <>
              <button type="button" className="btn btn-primary" onClick={startNew}><Plus size={14} /> New assessment <span className="kbd">F3</span></button>
              <button type="button" className="btn" disabled={!doc || busy} onClick={startCopy}><Copy size={14} /> Copy</button>
              <button type="button" className="btn" disabled={!doc || doc.isPosted || !!doc.reversedAt} onClick={beginEdit}>Edit draft <span className="kbd">F2</span></button>
              <button type="button" className="btn" disabled={!doc || doc.isPosted || !!doc.reversedAt} onClick={() => void deleteDraft()}><Trash2 size={14} /> Delete draft</button>
              {canApply && <button type="button" className="btn btn-primary" disabled={busy || !ledgersOk || !manualsBalanced || !previewOk} onClick={() => void applyAssessment()}><FileCheck2 size={14} /> Apply assessment</button>}
              {isApplied && <button type="button" className="btn" disabled={busy} onClick={() => void reverseAssessment()}><RotateCcw size={14} /> Reverse</button>}
            </>
          )}
          {doc?.reversedAt && <span className="text-xs text-amber-800">Reversed: {doc.reversalReason}</span>}
        </footer>
      </section>

      <aside className="w-[min(340px,32vw)] min-w-[250px] shrink-0 border-l border-slate-400 bg-white/50 flex flex-col min-h-0" aria-label="Cost assessment list">
        <div className="p-2 border-b border-slate-300 space-y-1.5 shrink-0">
          <h2 className="text-[12px] font-semibold text-slate-700">Assessments <span className="font-normal text-slate-500">({total})</span></h2>
          <div className="relative">
            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
            <input ref={searchRef} className="fld pl-7" placeholder="Search assessments…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search assessments" />
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          {rows.map((r) => (
            <button key={r.id} type="button" onClick={() => void openDoc(r.id)}
              className={`w-full border-b border-slate-200 px-3 py-2 text-left hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-blue-700 ${listSelection === r.id ? "bg-blue-50" : ""}`}>
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 font-mono font-semibold break-words text-[13px]">{r.assessmentNumber}</span>
                <Pill text={r.state} tone={stateTone(r.state)} />
              </div>
              <div className="text-[12px] text-slate-600 break-words">{r.invoiceNumber ?? r.importInvoiceNumber}</div>
              <div className="flex flex-wrap justify-between gap-x-2 text-[12px] text-slate-500">
                <span>{r.assessmentDate}</span>
                <span className="tabular-nums whitespace-nowrap">{r.assessedNet != null ? safeMoney(r.assessedNet) : ""}</span>
              </div>
            </button>
          ))}
          {!rows.length && <p className="p-3 text-[12px] text-slate-500">No assessments in this branch / year yet.</p>}
        </div>
      </aside>
    </main>
  );
}
