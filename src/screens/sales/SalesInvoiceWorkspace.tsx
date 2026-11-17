import { useCallback, useEffect, useMemo, useState, type MutableRefObject } from "react";
import { ArrowLeft, FilePlus2, Plus, RotateCcw, Save, Search, Send, Trash2, X } from "lucide-react";
import { ApiError, salesInvoiceApi, type SalesInvoiceDoc, type SalesInvoiceRow, type SalesLookups } from "../../api";
import { useDialog } from "../../components/Dialog";
import { DateInput } from "../../components/DateInput";
import type { StatusInfo } from "../../types";

type Props = {
  companyId: number; branchId: number; userId: number; branchName: string; fyCode: string; calendar: "BS" | "AD";
  setStatus: (s: StatusInfo) => void; dirtyRef: MutableRefObject<boolean>; externalMessage?: { text: string; n: number } | null;
};
type LineDraft = { productId: string; qty: string; unitId: string; rate: string; altQty: string; altUnitId: string };
type TermDraft = { key: string; termId: string; lineNumber: string; calcType: "PERCENT" | "AMOUNT"; rate: string; inputAmount: string; isOverridden: boolean; overrideAmount: string };
type FormDraft = {
  invoiceNumber: string; numberSeriesId: string; invoiceDate: string; customerGLId: string; subLedgerId: string; agentId: string;
  dueDays: string; dueDate: string; remarks: string; lines: LineDraft[]; terms: TermDraft[];
};
const today = () => new Date().toISOString().slice(0, 10);
const blankLine = (): LineDraft => ({ productId: "", qty: "1", unitId: "", rate: "0", altQty: "", altUnitId: "" });
const blankTerm = (): TermDraft => ({ key: `${Date.now()}-${Math.random()}`, termId: "", lineNumber: "", calcType: "AMOUNT", rate: "", inputAmount: "", isOverridden: false, overrideAmount: "" });
const blankForm = (lk: SalesLookups | null): FormDraft => ({
  invoiceNumber: "", numberSeriesId: String(lk?.series.find((s) => s.isDefault)?.id ?? lk?.series[0]?.id ?? ""),
  invoiceDate: today(), customerGLId: "", subLedgerId: "", agentId: "", dueDays: "0", dueDate: "", remarks: "", lines: [blankLine()], terms: [],
});
const errMessage = (e: unknown) => e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Unexpected error.";
const fmtAmount = (n: number) => Number.isFinite(n) ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00";

export default function SalesInvoiceWorkspace(p: Props) {
  const dialog = useDialog();
  const [lookups, setLookups] = useState<SalesLookups | null>(null);
  const [list, setList] = useState<SalesInvoiceRow[]>([]);
  const [count, setCount] = useState(0);
  const [doc, setDoc] = useState<SalesInvoiceDoc | null>(null);
  const [form, setForm] = useState<FormDraft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");

  const flash = useCallback((message: string, kind: StatusInfo["kind"] = "info") => {
    p.setStatus({ mode: form ? (doc ? "edit" : "new") : "view", count, shown: list.length, message, kind });
  }, [p.setStatus, form, doc, count, list.length]);
  const loadLookups = useCallback(async () => {
    const lk = await salesInvoiceApi.lookups({ companyId: p.companyId, branchId: p.branchId, userId: p.userId });
    setLookups(lk);
    return lk;
  }, [p.companyId, p.branchId, p.userId]);
  const loadList = useCallback(async () => {
    const result = await salesInvoiceApi.list({ companyId: p.companyId, branchId: p.branchId, fiscalYear: p.fyCode, search: search || undefined, status: filter || undefined });
    setList(result.rows); setCount(result.total);
    return result;
  }, [p.companyId, p.branchId, p.fyCode, search, filter]);
  const refresh = useCallback(async () => {
    setLoading(true); setProblem("");
    try { await Promise.all([loadLookups(), loadList()]); }
    catch (e) { setProblem(errMessage(e)); }
    finally { setLoading(false); }
  }, [loadLookups, loadList]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { p.dirtyRef.current = dirty; }, [dirty, p.dirtyRef]);
  useEffect(() => () => { p.dirtyRef.current = false; }, [p.dirtyRef]);
  useEffect(() => { if (p.externalMessage) flash(p.externalMessage.text); }, [p.externalMessage?.n]);

  const products = useMemo(() => new Map((lookups?.products ?? []).map((x) => [String(x.id), x])), [lookups]);
  const terms = useMemo(() => new Map((lookups?.terms ?? []).map((x) => [String(x.id), x])), [lookups]);
  const customers = lookups?.customers ?? [];
  const subtotal = useMemo(() => (form?.lines ?? []).reduce((sum, l) => {
    const product = products.get(l.productId);
    const alt = product?.alternateUnits.find((u) => String(u.unitId) === l.altUnitId);
    const qty = alt && l.altQty ? Number(l.altQty) * Number(alt.conversionFactor) : Number(l.qty || 0);
    return sum + (qty * Number(l.rate || 0));
  }, 0), [form, products]);
  const readonly = !!doc && doc.state !== "DRAFT";

  const openNew = () => {
    setDoc(null); setForm(blankForm(lookups)); setDirty(false); setProblem("");
  };
  const openDoc = async (row: SalesInvoiceRow) => {
    if (dirty && !(await dialog.confirm("Discard your unsaved invoice changes and open another document?", { title: "Discard changes", variant: "warning", confirmLabel: "Discard" }))) return;
    setBusy(true); setProblem("");
    try {
      const d = await salesInvoiceApi.get(row.id, p.companyId);
      setDoc(d);
      setForm({
        invoiceNumber: d.invoiceNumber, numberSeriesId: String(d.numberSeriesId ?? ""), invoiceDate: d.invoiceDate, customerGLId: String(d.customerGLId),
        subLedgerId: String(d.subLedgerId ?? ""), agentId: String(d.agentId ?? ""), dueDays: String(d.dueDays ?? 0), dueDate: d.dueDate ?? "", remarks: d.remarks ?? "",
        lines: d.lines.length ? d.lines.map((l) => ({ productId: String(l.productId), qty: String(l.qty), unitId: String(l.unitId), rate: String(l.rate), altQty: l.altQty == null ? "" : String(l.altQty), altUnitId: String(l.altUnitId ?? "") })) : [blankLine()],
        terms: d.terms.map((t) => ({ key: String(t.id), termId: String(t.termId), lineNumber: t.lineNumber == null ? "" : String(t.lineNumber), calcType: t.calcType,
          rate: t.rate == null ? "" : String(t.rate), inputAmount: t.inputAmount == null ? "" : String(t.inputAmount), isOverridden: !!t.isOverridden,
          overrideAmount: t.isOverridden ? String(t.finalAmount) : "" })),
      });
      setDirty(false);
    } catch (e) { setProblem(errMessage(e)); }
    finally { setBusy(false); }
  };
  const patch = (part: Partial<FormDraft>) => { setForm((f) => f ? { ...f, ...part } : f); setDirty(true); setProblem(""); };
  const updateLine = (index: number, part: Partial<LineDraft>) => {
    if (!form) return;
    const next = [...form.lines];
    next[index] = { ...next[index], ...part };
    setForm({ ...form, lines: next }); setDirty(true); setProblem("");
  };
  const updateTerm = (index: number, part: Partial<TermDraft>) => {
    if (!form) return;
    const next = [...form.terms]; next[index] = { ...next[index], ...part };
    setForm({ ...form, terms: next }); setDirty(true); setProblem("");
  };
  const goBack = async () => {
    if (dirty && !(await dialog.confirm("Discard your unsaved changes?", { title: "Discard changes", variant: "warning", confirmLabel: "Discard" }))) return;
    setDoc(null); setForm(null); setDirty(false); setProblem("");
  };
  const save = async () => {
    if (!form) return;
    const filled = form.lines.filter((l) => l.productId);
    if (!form.invoiceDate || form.invoiceDate.startsWith("?")) return setProblem("Enter a valid invoice date.");
    if (form.dueDate.startsWith("?")) return setProblem("Enter a valid due date or clear the field.");
    const customer = customers.find((c) => String(c.id) === form.customerGLId);
    if (!customer) return setProblem("Choose a customer ledger.");
    if (customer.requiresSubLedger && !form.subLedgerId) return setProblem(`${customer.code} needs a sub-ledger.`);
    if (!filled.length) return setProblem("Add at least one sales line.");
    if (filled.some((l) => !l.qty || Number(l.qty) <= 0 || Number(l.rate) < 0)) return setProblem("Each sales line needs a positive quantity and a non-negative rate.");
    const series = lookups?.series.find((s) => String(s.id) === form.numberSeriesId);
    if (series?.mode === "MANUAL" && !form.invoiceNumber.trim()) return setProblem("Type the invoice number required by the manual number series.");
    const body = {
      companyId: p.companyId, branchId: p.branchId, userId: p.userId, invoiceDate: form.invoiceDate, fiscalYear: p.fyCode,
      invoiceNumber: form.invoiceNumber.trim() || null, numberSeriesId: form.numberSeriesId ? Number(form.numberSeriesId) : null,
      customerGLId: Number(form.customerGLId), subLedgerId: form.subLedgerId ? Number(form.subLedgerId) : null, agentId: form.agentId ? Number(form.agentId) : null,
      dueDays: Number(form.dueDays || 0), dueDate: form.dueDate || null, remarks: form.remarks.trim() || null,
      lines: filled.map((l) => ({ productId: Number(l.productId), qty: Number(l.qty || 0), unitId: Number(l.unitId), rate: Number(l.rate || 0),
        altQty: l.altQty ? Number(l.altQty) : null, altUnitId: l.altUnitId ? Number(l.altUnitId) : null })),
      terms: form.terms.filter((t) => t.termId).map((t) => {
        const selectedLine = t.lineNumber ? Number(t.lineNumber) - 1 : -1;
        const lineNumber = selectedLine >= 0 && form.lines[selectedLine]?.productId ? form.lines.slice(0, selectedLine + 1).filter((l) => l.productId).length : null;
        return { termId: Number(t.termId), lineNumber,
        calcType: t.calcType, rate: t.rate || null, inputAmount: t.inputAmount || null, isOverridden: t.isOverridden,
        overrideAmount: t.isOverridden ? t.overrideAmount || null : null };
      }),
    };
    setBusy(true); setProblem("");
    try {
      const result = doc ? await salesInvoiceApi.update(doc.id, p.companyId, body) : await salesInvoiceApi.create(body);
      setDoc(result.document); setDirty(false);
      setForm((f) => f ? { ...f, invoiceNumber: result.document.invoiceNumber, numberSeriesId: String(result.document.numberSeriesId ?? f.numberSeriesId) } : f);
      await loadList(); flash(`Saved ${result.document.invoiceNumber}.`, "ok");
    } catch (e) { setProblem(errMessage(e)); }
    finally { setBusy(false); }
  };
  const post = async () => {
    if (!doc || dirty) return setProblem("Save the draft before posting.");
    if (!(await dialog.confirm(<>Post <b>{doc.invoiceNumber}</b>? This creates the accounting journal and locks the invoice from editing.</>, { title: "Post sales invoice", confirmLabel: "Post invoice" }))) return;
    setBusy(true); setProblem("");
    try { const result = await salesInvoiceApi.post(doc.id, p.companyId, p.userId); setDoc(result.document); setDirty(false); await loadList(); flash(`Posted ${result.document.invoiceNumber}.`, "ok"); }
    catch (e) { setProblem(errMessage(e)); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!doc) return;
    if (!(await dialog.confirm(<>Delete draft <b>{doc.invoiceNumber}</b>? This cannot be undone.</>, { title: "Delete draft", variant: "danger", confirmLabel: "Delete draft" }))) return;
    setBusy(true); setProblem("");
    try { await salesInvoiceApi.remove(doc.id, p.companyId, p.userId); setDoc(null); setForm(null); setDirty(false); await loadList(); flash(`Deleted ${doc.invoiceNumber}.`, "ok"); }
    catch (e) { setProblem(errMessage(e)); }
    finally { setBusy(false); }
  };
  const reverse = async () => {
    if (!doc || doc.state !== "POSTED") return;
    const reason = await dialog.prompt(<>Enter the reason for reversing <b>{doc.invoiceNumber}</b>. The reversal will be a new posted invoice with an opposite journal entry.</>, { title: "Reverse invoice", label: "Reason", required: true, confirmLabel: "Continue" });
    if (!reason) return;
    if (!(await dialog.confirm(<>Create a reversal for <b>{doc.invoiceNumber}</b>? Original invoice remains unchanged.</>, { title: "Confirm reversal", variant: "danger", confirmLabel: "Create reversal" }))) return;
    setBusy(true); setProblem("");
    try { const result = await salesInvoiceApi.reverse(doc.id, p.companyId, p.userId, reason); setDoc(result.document); setDirty(false); await loadList(); flash(`Created reversal ${result.document.invoiceNumber}.`, "ok"); }
    catch (e) { setProblem(errMessage(e)); }
    finally { setBusy(false); }
  };

  const input = "fld h-9 w-full min-w-0";
  const field = "block text-[11px] font-semibold text-slate-600 mb-1";
  const lines = form?.lines ?? [];
  const lineSubtotal = subtotal;
  return (
    <section className="flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-slate-50">
      <header className="flex min-h-12 items-center justify-between border-b border-slate-200 bg-white px-4 py-2">
        <div className="min-w-0"><div className="text-[14px] font-semibold text-slate-900">Sales Invoice</div><div className="text-[11px] text-slate-500">{p.branchName} · FY {p.fyCode}</div></div>
        <div className="flex items-center gap-2">
          {form ? <button className="btn" onClick={() => void goBack()} disabled={busy}><ArrowLeft size={14} /> Invoices</button> : <button className="btn btn-primary" onClick={openNew} disabled={!lookups || busy}><FilePlus2 size={14} /> New Invoice</button>}
          {form && !readonly && <button className="btn btn-primary" onClick={() => void save()} disabled={busy || !dirty}><Save size={14} /> {busy ? "Saving…" : "Save draft"}</button>}
          {doc?.state === "DRAFT" && <button className="btn btn-primary" onClick={() => void post()} disabled={busy || dirty}><Send size={14} /> Post</button>}
          {doc?.state === "DRAFT" && <button className="btn text-rose-700" onClick={() => void remove()} disabled={busy}><Trash2 size={14} /> Delete</button>}
          {doc?.state === "POSTED" && <button className="btn" onClick={() => void reverse()} disabled={busy}><RotateCcw size={14} /> Reverse</button>}
        </div>
      </header>
      {problem && <div role="alert" className="mx-4 mt-3 rounded border border-rose-300 bg-rose-50 px-3 py-2 text-[12px] text-rose-800">{problem}</div>}
      {!form ? (
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1 max-w-md"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input className={`${input} pl-9`} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search invoice or customer" /></div>
            <select className={`${input} w-36`} value={filter} onChange={(e) => setFilter(e.target.value)}><option value="">All statuses</option><option value="DRAFT">Draft</option><option value="POSTED">Posted</option><option value="REVERSED">Reversed</option><option value="REVERSAL">Reversal</option></select>
            <button className="btn" onClick={() => void refresh()} disabled={loading || busy}>Refresh</button>
          </div>
          {loading ? <p className="p-5 text-[13px] text-slate-500">Loading sales invoices…</p> : list.length ? (
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
              <table className="w-full min-w-[720px] text-left text-[12px]"><thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2">Invoice</th><th className="px-3 py-2">Date</th><th className="px-3 py-2">Customer</th><th className="px-3 py-2">FY</th><th className="px-3 py-2 text-right">Total</th><th className="px-3 py-2">Status</th></tr></thead>
                <tbody>{list.map((r) => <tr key={r.id} onClick={() => void openDoc(r)} className="cursor-pointer border-t border-slate-100 hover:bg-blue-50/60"><td className="px-3 py-2 font-mono font-semibold text-slate-800">{r.invoiceNumber}</td><td className="px-3 py-2">{r.invoiceDate}</td><td className="px-3 py-2"><span className="font-mono text-slate-500">{r.customerCode}</span> · {r.customerName}</td><td className="px-3 py-2">{r.fiscalYear}</td><td className="px-3 py-2 text-right font-mono">{fmtAmount(Number(r.totalAmount))}</td><td className="px-3 py-2"><StatePill state={r.state} /></td></tr>)}</tbody>
              </table>
            </div>
          ) : <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center"><p className="text-[14px] font-semibold text-slate-700">No sales invoices found</p><p className="mt-1 text-[12px] text-slate-500">Create a draft invoice to start recording a sale.</p><button className="btn btn-primary mt-4" onClick={openNew}><Plus size={14} /> New Invoice</button></div>}
          <p className="mt-2 text-[11px] text-slate-500">Showing {list.length} of {count} invoices for the selected branch and fiscal year.</p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {doc && <div className="mb-3 flex items-center gap-2 text-[12px]"><StatePill state={doc.state} /><span className="font-mono font-semibold">{doc.invoiceNumber}</span>{doc.reversalOf && <span className="text-slate-500">Reversal of {doc.reversalOf.invoiceNumber}</span>}{doc.reversedBy && <span className="text-rose-700">Reversed by {doc.reversedBy.invoiceNumber}</span>}</div>}
          {readonly && <div className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">Posted invoices are read-only. To correct one, create a reversal and enter a corrected invoice.</div>}
          <div className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-2 xl:grid-cols-4">
            <div><label className={field}>Invoice Number</label><input className={input} value={form.invoiceNumber} onChange={(e) => patch({ invoiceNumber: e.target.value })} disabled={readonly || (lookups?.series.find((s) => String(s.id) === form.numberSeriesId)?.mode === "AUTOMATIC" && !doc)} placeholder="Assigned on save" /></div>
            <div><label className={field}>Number Series</label><select className={input} value={form.numberSeriesId} onChange={(e) => patch({ numberSeriesId: e.target.value, invoiceNumber: "" })} disabled={readonly}><option value="">Default / legacy</option>{lookups?.series.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.mode}</option>)}</select></div>
            <div><label className={field}>Invoice Date</label><DateInput fieldName="Invoice" value={form.invoiceDate} onChange={(v) => patch({ invoiceDate: v })} calendar={p.calendar} hasError={false} onBlurField={() => {}} disabled={readonly} /></div>
            <div><label className={field}>Customer Ledger</label><select className={input} value={form.customerGLId} onChange={(e) => patch({ customerGLId: e.target.value, subLedgerId: "" })} disabled={readonly}><option value="">Choose customer</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}{c.requiresSubLedger ? " *" : ""}</option>)}</select></div>
            <div><label className={field}>Sub-ledger</label><select className={input} value={form.subLedgerId} onChange={(e) => patch({ subLedgerId: e.target.value })} disabled={readonly || !form.customerGLId}><option value="">—</option>{(lookups?.subLedgers ?? []).filter((s) => String(s.generalLedgerId) === form.customerGLId).map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></div>
            <div><label className={field}>Salesperson</label><select className={input} value={form.agentId} onChange={(e) => patch({ agentId: e.target.value })} disabled={readonly}><option value="">—</option>{lookups?.agents.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></div>
            <div><label className={field}>Due Days</label><input className={input} type="number" min="0" max="3650" value={form.dueDays} onChange={(e) => patch({ dueDays: e.target.value })} disabled={readonly} /></div>
            <div><label className={field}>Due Date (optional override)</label><DateInput fieldName="Due" value={form.dueDate} onChange={(v) => patch({ dueDate: v })} calendar={p.calendar} hasError={false} onBlurField={() => {}} disabled={readonly} /></div>
            <div className="sm:col-span-2 xl:col-span-4"><label className={field}>Remarks</label><input className={input} maxLength={1024} value={form.remarks} onChange={(e) => patch({ remarks: e.target.value })} disabled={readonly} /></div>
          </div>

          <div className="mt-4 flex items-center justify-between"><h2 className="text-[13px] font-semibold text-slate-800">Invoice Lines</h2>{!readonly && <button className="btn" onClick={() => patch({ lines: [...lines, blankLine()] })}><Plus size={13} /> Add line</button>}</div>
          <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full min-w-[850px] text-left text-[11px]"><thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-2 py-2">Product</th><th className="px-2 py-2">Quantity / Unit</th><th className="px-2 py-2">Alternate Qty</th><th className="px-2 py-2 text-right">Rate</th><th className="px-2 py-2 text-right">Amount</th><th className="px-2 py-2"></th></tr></thead><tbody>
              {lines.map((line, i) => {
                const product = products.get(line.productId); const alt = product?.alternateUnits.find((u) => String(u.unitId) === line.altUnitId);
                const effectiveQty = alt && line.altQty ? Number(line.altQty) * Number(alt.conversionFactor) : Number(line.qty || 0);
                return <tr key={i} className="border-t border-slate-100 align-top">
                  <td className="min-w-[260px] p-2"><select className="fld h-8 w-full" value={line.productId} onChange={(e) => { const x = products.get(e.target.value); updateLine(i, { productId: e.target.value, unitId: String(x?.unitId ?? ""), rate: String(x?.salesRate ?? "0"), altQty: "", altUnitId: "" }); }} disabled={readonly}><option value="">Choose product/service</option>{lookups?.products.map((x) => <option key={x.id} value={x.id}>{x.code} · {x.description}</option>)}</select><div className={`mt-1 text-[10px] ${product && !product.salesGLId ? "font-medium text-rose-700" : "text-slate-500"}`}>{product ? `${product.type.replace("_", " ")} · ${product.unitCode || "No unit"}${product.salesGLId ? "" : " · No sales ledger configured"}` : ""}</div></td>
                  <td className="w-44 p-2"><div className="flex items-center gap-1"><input className="fld h-8 w-20" aria-label="Quantity" type="number" min="0" step="0.001" value={line.qty} onChange={(e) => updateLine(i, { qty: e.target.value })} disabled={readonly || !!alt} /><span className="max-w-20 truncate text-slate-500">{product?.unitCode || "unit"}</span></div></td>
                  <td className="w-48 p-2"><div className="flex items-center gap-1"><input className="fld h-8 w-20" aria-label="Alternate quantity" type="number" min="0" step="0.001" value={line.altQty} onChange={(e) => updateLine(i, { altQty: e.target.value })} disabled={readonly || !product?.alternateUnits.length} /><select aria-label="Alternate unit" className="fld h-8 min-w-24" value={line.altUnitId} onChange={(e) => updateLine(i, { altUnitId: e.target.value, altQty: e.target.value ? (line.altQty || "1") : "" })} disabled={readonly || !product?.alternateUnits.length}><option value="">Base</option>{product?.alternateUnits.map((u) => <option key={u.unitId} value={u.unitId}>{u.unitCode} × {u.conversionFactor}</option>)}</select></div></td>
                  <td className="w-32 p-2"><input className="fld h-8 w-full text-right" type="number" min="0" step="0.0001" value={line.rate} onChange={(e) => updateLine(i, { rate: e.target.value })} disabled={readonly} /></td>
                  <td className="w-32 p-2 text-right font-mono pt-4">{fmtAmount(effectiveQty * Number(line.rate || 0))}</td>
                  <td className="w-10 p-2">{!readonly && <button type="button" aria-label="Remove line" className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-700" onClick={() => { const next = lines.filter((_, x) => x !== i); patch({ lines: next.length ? next : [blankLine()] }); }}><X size={14}/></button>}</td>
                </tr>;
              })}
            </tbody><tfoot><tr className="border-t border-slate-200 bg-slate-50"><td colSpan={4} className="px-2 py-2 text-right font-semibold">Line subtotal</td><td className="px-2 py-2 text-right font-mono font-semibold">{fmtAmount(lineSubtotal)}</td><td/></tr></tfoot></table>
          </div>

          <div className="mt-4 flex items-center justify-between"><div><h2 className="text-[13px] font-semibold text-slate-800">Sales Terms</h2><p className="text-[10px] text-slate-500">Term amounts and dependencies are calculated on save using the shared pricing engine.</p></div>{!readonly && <button className="btn" onClick={() => patch({ terms: [...form.terms, blankTerm()] })}><Plus size={13}/> Add term</button>}</div>
          <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full min-w-[760px] text-left text-[11px]"><thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-2 py-2">Term</th><th className="px-2 py-2">Scope</th><th className="px-2 py-2">Calculation</th><th className="px-2 py-2">Rate / Amount</th><th className="px-2 py-2">Override</th><th className="px-2 py-2"></th></tr></thead><tbody>
              {form.terms.map((term, i) => { const master = terms.get(term.termId); const fixed = !!master && !master.isEditable; const rounded = master?.category === "ROUNDED"; return <tr key={term.key} className="border-t border-slate-100">
                <td className="min-w-[230px] p-2"><select className="fld h-8 w-full" value={term.termId} disabled={readonly} onChange={(e) => { const m = terms.get(e.target.value); updateTerm(i, { termId: e.target.value, calcType: m?.category === "ROUNDED" ? "AMOUNT" : m?.defaultCalcType ?? "AMOUNT", rate: m?.defaultCalcType === "PERCENT" ? m.defaultValue : "", inputAmount: m?.defaultCalcType === "AMOUNT" ? m.defaultValue : "", isOverridden: false, overrideAmount: "" }); }}><option value="">Choose term</option>{(lookups?.terms ?? []).filter((t) => t.category !== "COSTING").map((t) => <option key={t.id} value={t.id}>{t.code} · {t.name}{t.isMandatory ? " *" : ""}</option>)}</select></td>
                <td className="w-36 p-2">{master?.isProductwise ? <select className="fld h-8 w-full" value={term.lineNumber} onChange={(e) => updateTerm(i, { lineNumber: e.target.value })} disabled={readonly}><option value="">Choose line</option>{form.lines.map((l, n) => l.productId ? <option key={n} value={n + 1}>Line {n + 1} · {products.get(l.productId)?.code}</option> : null)}</select> : <span className="px-1 text-slate-500">Document</span>}</td>
                <td className="w-28 p-2">{rounded ? <span className="px-1">Rounded</span> : <select className="fld h-8 w-full" value={term.calcType} onChange={(e) => updateTerm(i, { calcType: e.target.value as "PERCENT" | "AMOUNT" })} disabled={readonly || fixed}><option value="PERCENT">Percent</option><option value="AMOUNT">Amount</option></select>}</td>
                <td className="w-36 p-2">{rounded ? <span className="text-slate-400">Calculated</span> : <input className="fld h-8 w-full" type="number" min="0" step={term.calcType === "PERCENT" ? "0.0001" : "0.01"} value={term.calcType === "PERCENT" ? term.rate : term.inputAmount} onChange={(e) => updateTerm(i, term.calcType === "PERCENT" ? { rate: e.target.value } : { inputAmount: e.target.value })} disabled={readonly || fixed} />}</td>
                <td className="w-40 p-2">{rounded || fixed ? <span className="text-slate-400">—</span> : <div className="flex items-center gap-1"><input type="checkbox" checked={term.isOverridden} onChange={(e) => updateTerm(i, { isOverridden: e.target.checked })} disabled={readonly} aria-label="Override calculated term"/><input className="fld h-8 w-full" type="number" min="0" step="0.01" placeholder="Final amount" value={term.overrideAmount} onChange={(e) => updateTerm(i, { overrideAmount: e.target.value })} disabled={readonly || !term.isOverridden}/></div>}</td>
                <td className="w-10 p-2">{!readonly && <button type="button" aria-label="Remove term" className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-700" onClick={() => patch({ terms: form.terms.filter((_, x) => x !== i) })}><X size={14}/></button>}</td>
              </tr>; })}
              {!form.terms.length && <tr><td colSpan={6} className="p-4 text-center text-slate-400">No terms added</td></tr>}
            </tbody></table>
          </div>
          <div className="mt-4 flex items-center justify-end gap-8 rounded-lg border border-slate-200 bg-white px-4 py-3 text-[12px]"><div className="text-slate-500">Term pricing is finalized when saved.</div><div className="font-semibold">Line subtotal <span className="ml-2 font-mono">{fmtAmount(lineSubtotal)}</span></div>{doc && <div className="font-semibold">Saved total <span className="ml-2 font-mono">{fmtAmount(Number(doc.totalAmount))}</span></div>}</div>
          {dirty && !readonly && <p className="mt-2 text-[11px] text-amber-800">Unsaved changes. Save the draft before posting.</p>}
        </div>
      )}
    </section>
  );
}

function StatePill({ state }: { state: string }) {
  const cls = state === "POSTED" ? "bg-emerald-100 text-emerald-800" : state === "REVERSED" ? "bg-rose-100 text-rose-800" : state === "REVERSAL" ? "bg-violet-100 text-violet-800" : "bg-amber-100 text-amber-800";
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${cls}`}>{state}</span>;
}
