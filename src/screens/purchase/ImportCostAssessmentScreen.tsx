import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { FileCheck2, Plus, RotateCcw, Save, Search, Trash2, X } from "lucide-react";
import { ApiError, importAssessmentApi, purchaseApi, type ImportAssessmentPreview, type ImportAssessmentTermInput, type PLookups } from "../../api";
import { MasterReferencePicker, type ReferenceOption } from "../../components/MasterReferencePicker";
import { defaultDate } from "../../lib/purchaseForm";
import type { StatusInfo } from "../../types";
import { formatImportCost } from "../../../shared/import-costing";
import { toMicro } from "../../../shared/purchase-calculation";
import type { PurchaseScreenProps } from "./PurchaseOrderScreen";

type Basis = "VALUE" | "QUANTITY";
type AssessmentTerm = { key: string; termId: string; calcType: "PERCENT" | "AMOUNT"; rate: string; inputAmount: string; allocationBasis: Basis; capitalizable: boolean; isOverridden: boolean; overrideAmount: string };
type Form = { importBillId: string; assessmentDate: string; referenceNo: string; remarks: string; terms: AssessmentTerm[] };
type Doc = Record<string, any> & { id: number; isPosted: boolean; state: string; terms: Record<string, any>[] };
type ImportOption = Record<string, any> & { id: number; invoiceNumber: string; invoiceDate: string };
const fieldClass = "fld min-w-0";
const blankTerm = (): AssessmentTerm => ({ key: Math.random().toString(36).slice(2), termId: "", calcType: "AMOUNT", rate: "", inputAmount: "", allocationBasis: "VALUE", capitalizable: true, isOverridden: false, overrideAmount: "" });
const safeMoney = (v: unknown) => { try { return formatImportCost(toMicro(String(v ?? "0")), 2); } catch { return "0.00"; } };
const asForm = (d: Doc): Form => ({
  importBillId: String(d.importBillId ?? ""), assessmentDate: String(d.assessmentDate ?? "").slice(0, 10), referenceNo: d.referenceNo ?? "", remarks: d.remarks ?? "",
  terms: (d.terms ?? []).map((t: any) => ({ key: String(t.id ?? Math.random()), termId: String(t.termId), calcType: t.calcType ?? "AMOUNT", rate: t.rate ?? "", inputAmount: t.inputAmount ?? "", allocationBasis: t.allocationBasis === "QUANTITY" ? "QUANTITY" : "VALUE", capitalizable: !!t.capitalizable, isOverridden: !!t.isOverridden, overrideAmount: t.overrideAmount ?? "" })),
});

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
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Loading…");
  const [listSelection, setListSelection] = useState<number | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const baseSig = useRef("");
  const seq = useRef(0);
  const statusKind = message === "Ready" ? "info" : "info";
  const dirty = !!form && editing && JSON.stringify(form) !== baseSig.current;
  p.dirtyRef.current = dirty;

  const loadImports = useCallback(async (l: PLookups | null) => {
    const r = await importAssessmentApi.eligibleImports({ companyId: p.companyId, branchId: p.branchId, fiscalYear: p.fyCode });
    setImports(r.rows as ImportOption[]);
    if (l) setForm((current) => current ?? { importBillId: "", assessmentDate: defaultDate(l.fiscalYears.find((y) => y.code === p.fyCode)), referenceNo: "", remarks: "", terms: [blankTerm()] });
  // Initialize only when no form exists; functional state avoids a stale `form === null` closure here.
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
  useEffect(() => { p.setStatus({ mode: editing ? doc ? "edit" : "new" : "view", count: total, shown: rows.length, message, kind: statusKind, hints: ["Ctrl+S Save", "F3 New", "F2 Edit", "Use Tab to move through fields", "Arrow keys move through the document list"] }); }, [editing, doc, total, rows.length, message, statusKind, p.setStatus]);
  useEffect(() => { if (p.externalMessage) setMessage(p.externalMessage.text); }, [p.externalMessage]);

  const masters = lookups?.terms ?? [];
  const termById = useMemo(() => new Map(masters.map((t) => [String(t.id), t])), [masters]);
  const termOptions: ReferenceOption[] = useMemo(() => masters.filter((t: any) => t.category === "ADDITIONAL").map((t: any) => ({ value: String(t.id), label: `${t.code} — ${t.name}`, code: t.code, name: t.name, detail: `${t.category} · ${t.nature ?? "charge"}${t.distributeToLines ? " · normally capitalized" : ""}`, isActive: t.isActive })), [masters]);
  const importOptions: ReferenceOption[] = useMemo(() => imports.map((b) => ({ value: String(b.id), label: `${b.invoiceNumber} — ${b.invoiceDate}`, code: b.invoiceNumber, name: b.invoiceNumber, detail: `${safeMoney(b.cifValue)} CIF · ${b.lines?.length ?? 0} product lines`, isActive: true })), [imports]);
  const selectedImport = imports.find((b) => String(b.id) === form?.importBillId);
  const requestTerms = (f: Form): ImportAssessmentTermInput[] => f.terms.filter((t) => t.termId).map((t) => ({ termId: Number(t.termId), calcType: t.calcType, rate: t.calcType === "PERCENT" ? t.rate : undefined, inputAmount: t.calcType === "AMOUNT" ? t.inputAmount : undefined, isOverridden: t.isOverridden, overrideAmount: t.isOverridden ? t.overrideAmount : undefined, allocationBasis: t.allocationBasis, capitalizable: t.capitalizable }));

  useEffect(() => {
    if (!editing || !form?.importBillId) { if (!editing && doc?.preview) setPreview(doc.preview); return; }
    const ticket = ++seq.current;
    const timer = window.setTimeout(async () => {
      try {
        const r = await importAssessmentApi.preview({ companyId: p.companyId, branchId: p.branchId, importBillId: Number(form.importBillId), terms: requestTerms(form) });
        if (ticket === seq.current) { setPreview(r.preview); setPreviewError(""); }
      } catch (e) { if (ticket === seq.current) { setPreview(null); setPreviewError((e as Error).message); } }
    }, 180);
    return () => { clearTimeout(timer); };
  }, [editing, form, p.companyId, p.branchId, doc]);

  const startNew = () => {
    if (dirty && !window.confirm("Discard unsaved assessment changes?")) return;
    const next: Form = { importBillId: "", assessmentDate: defaultDate(lookups?.fiscalYears.find((y) => y.code === p.fyCode)), referenceNo: "", remarks: "", terms: [blankTerm()] };
    setDoc(null); setForm(next); setEditing(true); setPreview(null); setErrors({}); baseSig.current = JSON.stringify(next); setMessage("New import cost assessment");
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
  const selectTerm = (i: number, id: string) => {
    const m: any = termById.get(id);
    updateTerm(i, { termId: id, calcType: m?.defaultCalcType ?? "AMOUNT", rate: m?.defaultCalcType === "PERCENT" ? m.defaultValue : "", inputAmount: m?.defaultCalcType === "AMOUNT" ? m.defaultValue : "", allocationBasis: m?.allocationBasis === "QUANTITY" ? "QUANTITY" : "VALUE", capitalizable: !!m?.distributeToLines, isOverridden: false, overrideAmount: "" });
  };
  const save = async () => {
    if (!form || busy) return;
    const e: Record<string, string> = {};
    if (!form.importBillId) e.importBillId = "Choose a posted import goods bill.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.assessmentDate)) e.assessmentDate = "Enter an assessment date in YYYY-MM-DD format.";
    const terms = form.terms.filter((t) => t.termId);
    if (!terms.length) e.terms = "Add at least one customs or excise charge.";
    for (const t of terms) {
      if (t.calcType === "PERCENT" && (!t.rate || !/^\d+(\.\d{1,4})?$/.test(t.rate))) e.terms = "Enter a valid percentage for each percentage charge.";
      if (t.calcType === "AMOUNT" && (!t.inputAmount || !/^\d+(\.\d{1,6})?$/.test(t.inputAmount))) e.terms = "Enter a valid amount for each amount charge.";
      if (t.isOverridden && (!t.overrideAmount || !/^\d+(\.\d{1,6})?$/.test(t.overrideAmount))) e.terms = "Enter a valid override amount.";
    }
    setErrors(e);
    if (Object.keys(e).length) { setMessage(Object.values(e)[0]); document.querySelector<HTMLElement>("[data-assessment-field] [aria-invalid=true]")?.focus(); return; }
    setBusy(true);
    const body = { companyId: p.companyId, branchId: p.branchId, userId: p.userId, fiscalYear: p.fyCode, importBillId: Number(form.importBillId), assessmentDate: form.assessmentDate, referenceNo: form.referenceNo.trim() || null, remarks: form.remarks.trim() || null, terms: requestTerms(form) };
    try {
      const r = doc ? await importAssessmentApi.update(doc.id, p.companyId, body) : await importAssessmentApi.create(body);
      const d = r.document as Doc;
      setDoc(d); setForm(asForm(d)); setEditing(false); setPreview(d.preview ?? preview); baseSig.current = JSON.stringify(asForm(d)); setMessage(`Saved draft ${d.assessmentNumber}`); await loadList(); await loadImports(lookups);
    } catch (ex) { const err = ex as ApiError; if (err.field) setErrors({ [err.field]: err.message }); setMessage(err.message); }
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
    if (!doc || dirty || !window.confirm(`Apply assessment ${doc.assessmentNumber}? This freezes the assessment and updates each import product's landed cost. No supplier or GL posting is created.`)) return;
    setBusy(true);
    try { const r = await importAssessmentApi.apply(doc.id, p.companyId, p.userId); const d = r.document as Doc; setDoc(d); setForm(asForm(d)); setPreview(d.preview ?? null); setMessage(`Applied assessment ${d.assessmentNumber}; landed valuation updated.`); await loadList(); await loadImports(lookups); }
    catch (e) { setMessage((e as Error).message); }
    finally { setBusy(false); }
  };
  const reverseAssessment = async () => {
    if (!doc || dirty) return;
    const reason = window.prompt(`Reason for reversing assessment ${doc.assessmentNumber}:`);
    if (!reason?.trim()) return;
    setBusy(true);
    try { const r = await importAssessmentApi.reverse(doc.id, p.companyId, p.userId, reason.trim()); const d = r.document as Doc; setDoc(d); setForm(asForm(d)); setPreview(d.preview ?? null); setMessage(`Reversed assessment ${d.assessmentNumber}; valuation recalculated.`); await loadList(); await loadImports(lookups); }
    catch (e) { setMessage((e as Error).message); }
    finally { setBusy(false); }
  };
  const deleteDraft = async () => {
    if (!doc || doc.isPosted || !window.confirm(`Delete draft assessment ${doc.assessmentNumber}?`)) return;
    setBusy(true);
    try { await importAssessmentApi.remove(doc.id, p.companyId, p.userId); setDoc(null); setForm(null); setEditing(false); setPreview(null); setMessage("Draft deleted"); await loadList(); await loadImports(lookups); }
    catch (e) { setMessage((e as Error).message); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && editing) { e.preventDefault(); void save(); }
      else if (e.key === "F3") { e.preventDefault(); startNew(); }
      else if (e.key === "F2" && doc && !editing) { e.preventDefault(); beginEdit(); }
      else if ((e.ctrlKey || e.metaKey) && e.key === "ArrowDown") { e.preventDefault(); const i = rows.findIndex((r) => r.id === listSelection); const n = rows[Math.min(i < 0 ? 0 : i + 1, rows.length - 1)]; if (n) void openDoc(n.id); }
      else if ((e.ctrlKey || e.metaKey) && e.key === "ArrowUp") { e.preventDefault(); const i = rows.findIndex((r) => r.id === listSelection); const n = rows[Math.max(i <= 0 ? 0 : i - 1, 0)]; if (n) void openDoc(n.id); }
      else if (e.key === "Escape" && editing && !typing) cancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  const stateTone = (state: string) => state === "APPLIED" ? "bg-green-100 text-green-800" : state === "REVERSED" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-700";
  const source = selectedImport ?? (doc ? { id: doc.importBillId, invoiceNumber: doc.invoiceNumber ?? `Import bill ${doc.importBillId}`, invoiceDate: doc.importInvoiceDate ?? "" } : undefined);
  const canApply = !!doc && !doc.isPosted && !doc.reversedAt && !editing && !dirty;
  const isApplied = !!doc?.isPosted && !doc?.reversedAt;
  const lineRows = (preview?.lines ?? doc?.preview?.lines ?? []) as ImportAssessmentPreview["lines"];

  return (
    <main className="flex-1 min-w-0 flex min-h-0" data-assessment-document>
      <section className="flex-1 min-w-0 flex flex-col min-h-0">
        <header className="px-4 pt-3 pb-2 shrink-0">
          <div className="flex items-end gap-3 flex-wrap"><h1 className="text-[22px] font-semibold">Import Cost Assessment</h1><span className="pb-1 text-slate-600">Branch: <b>{p.branchName}</b> · FY <b>{p.fyCode}</b></span>{doc && <span className={`mb-1 rounded-sm px-2 py-0.5 text-xs font-semibold ${stateTone(doc.state)}`}>{doc.state}</span>}{dirty && <span className="pb-1 text-[11px] text-amber-700">Unsaved changes</span>}</div>
          <div className="double-rule mt-1" />
          <p className="mt-2 text-[12px] text-slate-700" role="status">{message}. This document records assessed costs for landed valuation only; it does not create a supplier invoice, payable, or GL voucher.</p>
        </header>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-3 space-y-3">
          {!lookups || !form ? <p className="text-slate-500 p-2">Loading…</p> : <>
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Assessment details">
              <label className="block text-[11px] font-semibold text-slate-600">Assessment date<input data-assessment-field type="date" className={fieldClass} disabled={!editing || busy} value={form.assessmentDate} aria-invalid={!!errors.assessmentDate} onChange={(e) => setForm({ ...form, assessmentDate: e.target.value })} /></label>
              <div data-assessment-field><MasterReferencePicker fieldName="importBillId" label="Posted import goods bill" value={form.importBillId} options={importOptions} onChange={(v) => setForm({ ...form, importBillId: v })} disabled={!editing || busy || !!doc} hasError={!!errors.importBillId} scopeKey="purchase-bills" contextKey={`${p.companyId}:${p.branchId}`} placeholder="Choose an import bill…" /></div>
              <label className="block text-[11px] font-semibold text-slate-600">Customs assessment reference<input data-assessment-field className={fieldClass} maxLength={60} disabled={!editing || busy} value={form.referenceNo} onChange={(e) => setForm({ ...form, referenceNo: e.target.value })} /></label>
              <label className="block text-[11px] font-semibold text-slate-600">Linked goods invoice<input className={`${fieldClass} bg-slate-100`} readOnly aria-readonly="true" value={source ? `${source.invoiceNumber}${source.invoiceDate ? ` · ${source.invoiceDate}` : ""}` : "Choose a posted import bill"} /></label>
            </section>
            {errors.importBillId && <p className="text-xs text-red-700" role="alert">{errors.importBillId}</p>}
            <section className="border border-slate-300 bg-white" aria-label="Assessed charges">
              <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-300"><div><h2 className="font-semibold text-sm">Customs and assessed charges</h2><p className="text-[11px] text-slate-600">Percentages use the CIF base and term sequence from the shared purchase calculation engine.</p></div><button type="button" className="btn" disabled={!editing || busy} onClick={() => setForm({ ...form, terms: [...form.terms, blankTerm()] })}><Plus size={14} /> Add charge</button></div>
              <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-xs"><thead className="bg-slate-50 text-slate-600"><tr><th className="p-2 text-left">Charge term</th><th className="p-2 text-left">Calculation</th><th className="p-2 text-left">Rate / amount</th><th className="p-2 text-left">Allocate by</th><th className="p-2 text-center">Capitalize</th><th className="p-2 text-right">Calculated</th><th className="p-2" aria-label="Remove" /></tr></thead>
                <tbody>{form.terms.map((t, i) => { const m: any = termById.get(t.termId); const result = preview?.termResults?.find?.((x: any) => x.termId === Number(t.termId) || x.termId === t.termId) ?? preview?.terms?.find?.((x: any) => x.termId === Number(t.termId)); return <tr key={t.key} className="border-t border-slate-200 align-top">
                  <td className="p-2 w-[260px]"><MasterReferencePicker fieldName={`terms.${i}.termId`} label={`Charge ${i + 1}`} value={t.termId} options={termOptions} onChange={(v) => selectTerm(i, v)} disabled={!editing || busy} scopeKey="purchase-terms" contextKey={`${p.companyId}:${p.branchId}`} placeholder="Choose customs charge…" hasError={!!errors.terms && !t.termId} /></td>
                  <td className="p-2"><select className={fieldClass} disabled={!editing || busy || !t.termId} aria-label={`Calculation type for charge ${i + 1}`} value={t.calcType} onChange={(e) => updateTerm(i, { calcType: e.target.value as AssessmentTerm["calcType"] })}><option value="PERCENT">Percent</option><option value="AMOUNT">Fixed amount</option></select><div className="mt-1 text-[10px] text-slate-500">{m?.nature ?? "Charge"} · {m?.calcBase ?? "CIF / running total"}</div></td>
                  <td className="p-2"><div className="flex gap-2"><input aria-label={t.calcType === "PERCENT" ? `Rate for charge ${i + 1}` : `Amount for charge ${i + 1}`} className={fieldClass} disabled={!editing || busy || !t.termId} value={t.calcType === "PERCENT" ? t.rate : t.inputAmount} inputMode="decimal" onChange={(e) => updateTerm(i, t.calcType === "PERCENT" ? { rate: e.target.value } : { inputAmount: e.target.value })} placeholder={t.calcType === "PERCENT" ? "Percent" : "Amount"} />{t.isOverridden && <input aria-label={`Override amount for charge ${i + 1}`} className={fieldClass} disabled={!editing || busy} value={t.overrideAmount} inputMode="decimal" onChange={(e) => updateTerm(i, { overrideAmount: e.target.value })} placeholder="Final override" />}</div><label className="mt-1 inline-flex items-center gap-1 text-[10px] text-slate-600"><input type="checkbox" disabled={!editing || busy || !t.termId} checked={t.isOverridden} onChange={(e) => updateTerm(i, { isOverridden: e.target.checked })} /><span>Override calculated amount</span></label>
                  </td>
                  <td className="p-2"><select className={fieldClass} disabled={!editing || busy || !t.capitalizable} aria-label={`Allocation basis for charge ${i + 1}`} value={t.allocationBasis} onChange={(e) => updateTerm(i, { allocationBasis: e.target.value as Basis })}><option value="VALUE">Product value</option><option value="QUANTITY">Quantity</option></select></td>
                  <td className="p-2 text-center"><label className="inline-flex items-center gap-1.5"><input aria-label={`Capitalize charge ${i + 1} into inventory`} type="checkbox" disabled={!editing || busy} checked={t.capitalizable} onChange={(e) => updateTerm(i, { capitalizable: e.target.checked })} /><span className="sr-only">Capitalize</span></label></td>
                  <td className="p-2 text-right tabular-nums">{result ? safeMoney(result.finalAmount ?? result.amount) : "—"}</td>
                  <td className="p-2 text-right"><button type="button" className="btn btn-compact" disabled={!editing || busy || form.terms.length === 1} aria-label={`Remove charge ${i + 1}`} onClick={() => setForm({ ...form, terms: form.terms.filter((_, n) => n !== i) })}><Trash2 size={13} /></button></td>
                </tr>; })}</tbody></table></div>
              {errors.terms && <p className="px-3 py-2 text-xs text-red-700" role="alert">{errors.terms}</p>}
            </section>
            <label className="block text-[11px] font-semibold text-slate-600">Notes<textarea data-assessment-field className={`${fieldClass} min-h-16`} maxLength={1024} disabled={!editing || busy} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} /></label>
            {form.importBillId && <>
              <section className="sticky top-0 z-10 border border-blue-300 bg-blue-50 shadow-sm" aria-label="Import cost summary" aria-live="polite">
                <div className="grid grid-cols-2 divide-x divide-y divide-blue-200 sm:grid-cols-3 lg:grid-cols-6 lg:divide-y-0">
                  {[ ["Goods value", preview?.goodsValue], ["CIF base", preview?.cifValue], ["Invoiced services", preview?.invoicedCapitalizedCosts], ["Existing bill terms", preview?.existingPurchaseTermCosts], ["Assessed net", preview?.assessedNet], ["Final landed value", preview?.totalLandedValue] ].map(([label, value]) => <div key={String(label)} className="min-w-0 px-2.5 py-1.5"><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-600">{label}</div><div className="text-right text-sm font-semibold tabular-nums">{value == null ? "—" : safeMoney(value)}</div></div>)}
                </div><p className={`border-t border-blue-200 px-2.5 py-1 text-[11px] ${previewError ? "text-red-800" : "text-slate-600"}`} role={previewError ? "alert" : "status"}>{previewError || (preview ? "Live preview · exact shared costing engine. Non-capitalizable assessed amounts remain out of inventory value." : "Calculating CIF and product-wise landed costs…")}</p>
              </section>
              <section className="border border-slate-300 bg-white" aria-label="Product-wise landed cost"><h2 className="px-3 py-2 border-b border-slate-300 text-sm font-semibold">Product-wise allocation and landed unit cost</h2><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-xs"><thead className="bg-slate-50 text-slate-600"><tr><th className="p-2 text-left">Line</th><th className="p-2 text-right">Goods value</th><th className="p-2 text-right">Customs value</th><th className="p-2 text-right">Service costs</th><th className="p-2 text-right">Existing bill terms</th><th className="p-2 text-right">Assessed costs</th><th className="p-2 text-right">Landed value</th><th className="p-2 text-right">Landed unit cost</th></tr></thead><tbody>{lineRows.map((line, i) => <tr key={line.key ?? line.id ?? i} className="border-t border-slate-200"><td className="p-2">{line.lineNumber}. {line.productCode ?? line.description ?? `Product line ${line.lineNumber}`}</td><td className="p-2 text-right tabular-nums">{safeMoney(line.goodsValue)}</td><td className="p-2 text-right tabular-nums">{safeMoney(line.customsValue)}</td><td className="p-2 text-right tabular-nums">{safeMoney(line.capitalizedSources)}</td><td className="p-2 text-right tabular-nums">{safeMoney(line.existingPurchaseTermCosts)}</td><td className="p-2 text-right tabular-nums">{safeMoney(line.capitalizedAssessments)}</td><td className="p-2 text-right tabular-nums font-semibold">{safeMoney(line.landedValue)}</td><td className="p-2 text-right tabular-nums font-semibold">{safeMoney(line.landedRate)}</td></tr>)}</tbody></table>{!lineRows.length && <p className="p-3 text-xs text-slate-600">Choose an import bill to see product-wise cost allocation.</p>}</div></section>
            </>}
          </>}
        </div>
        <footer className="shrink-0 border-t border-slate-400 bg-slate-50 px-4 py-2 flex items-center gap-2 flex-wrap">
          {editing ? <><button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}><Save size={14} /> Save draft <span className="kbd">Ctrl+S</span></button><button type="button" className="btn" disabled={busy} onClick={cancel}><X size={14} /> Cancel <span className="kbd">Esc</span></button></> : <><button type="button" className="btn btn-primary" onClick={startNew}><Plus size={14} /> New assessment <span className="kbd">F3</span></button><button type="button" className="btn" disabled={!doc || doc.isPosted || !!doc.reversedAt} onClick={beginEdit}>Edit draft <span className="kbd">F2</span></button><button type="button" className="btn" disabled={!doc || doc.isPosted || !!doc.reversedAt} onClick={() => void deleteDraft()}><Trash2 size={14} /> Delete draft</button>{canApply && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void applyAssessment()}><FileCheck2 size={14} /> Apply assessment</button>}{isApplied && <button type="button" className="btn" disabled={busy} onClick={() => void reverseAssessment()}><RotateCcw size={14} /> Reverse</button>}</>}
          {doc?.reversedAt && <span className="text-xs text-amber-800">Reversed: {doc.reversalReason}</span>}
        </footer>
      </section>
      <aside className="w-[min(340px,32vw)] min-w-[250px] shrink-0 border-l border-slate-400 bg-white/50 flex flex-col min-h-0" aria-label="Import assessment list">
        <div className="p-2 border-b border-slate-300 space-y-1.5"><h2 className="text-[12px] font-semibold text-slate-700">Assessments <span className="font-normal text-slate-500">({total})</span></h2><div className="relative"><Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500"/><input ref={searchRef} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search assessments…" aria-label="Search import cost assessments" className="fld min-w-0 pl-7" onKeyDown={(e) => { if (e.key === "ArrowDown" || e.key === "Enter") { e.preventDefault(); document.querySelector<HTMLElement>("[data-assessment-row]")?.focus(); } }} /></div><span className="text-[10px] text-slate-500">{p.fyCode} · Tab to navigate · Ctrl+S saves</span></div>
        <div className="flex-1 min-h-0 overflow-y-auto" onKeyDown={(e) => { const list = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[data-assessment-row]")); const i = list.indexOf(e.target as HTMLElement); if (e.key === "ArrowDown") { e.preventDefault(); list[Math.min(i + 1, list.length - 1)]?.focus(); } else if (e.key === "ArrowUp") { e.preventDefault(); if (i <= 0) searchRef.current?.focus(); else list[i - 1]?.focus(); } }}>
          {!rows.length && <p className="p-3 text-xs text-slate-600">No assessments found. Start one with F3.</p>}
          {rows.map((r) => <button key={r.id} data-assessment-row aria-selected={r.id === listSelection} onClick={() => void openDoc(r.id)} className={`w-full min-w-0 text-left px-2.5 py-2 border-b border-slate-200 hover:bg-blue-50 focus:outline-none focus:bg-blue-100 ${r.id === listSelection ? "bg-blue-100" : ""}`}><div className="flex justify-between gap-2"><span className="font-mono font-semibold">{r.assessmentNumber}</span><span className={`rounded-sm px-1.5 py-px text-[10px] ${stateTone(r.state)}`}>{r.state}</span></div><div className="text-[11px] text-slate-600">{r.invoiceNumber ?? `Import ${r.importBillId}`}{r.referenceNo ? ` · ${r.referenceNo}` : ""}</div><div className="flex justify-between gap-2 text-[11px] text-slate-500"><span>{r.assessmentDate}</span><span className="tabular-nums">{safeMoney(r.assessedNet)}</span></div></button>)}
        </div>
        <div className="border-t border-slate-300 p-2 text-[10px] text-slate-600">{message}</div>
      </aside>
    </main>
  );
}
