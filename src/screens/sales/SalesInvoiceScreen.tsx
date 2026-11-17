import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { RotateCcw, Send } from "lucide-react";
import { salesInvoiceApi, type PDoc, type PLookups, type SalesLookups } from "../../api";
import { parseDec } from "../../../shared/decimal";
import { previewPurchase } from "../../../shared/purchase-preview";
import { useDialog } from "../../components/Dialog";
import { NarrationInput } from "../../components/NarrationInput";
import type { EntryTabProps } from "../../components/purchase/DocWorkspace";
import { COMMON_HELP, DocShell, Field, FormSection, Pill, money } from "../../components/purchase/Bits";
import { DateField, TextField } from "../../components/purchase/HeadFields";
import { LinesGrid, TermsGrid } from "../../components/purchase/LinesGrid";
import { NumberField } from "../../components/purchase/NumberField";
import { PurchaseInvoiceTotals } from "../../components/purchase/PurchaseInvoiceTotals";
import { MasterReferencePicker, type ReferenceOption } from "../../components/MasterReferencePicker";
import { focusStep } from "../../components/purchase/Bits";
import {
  addDaysIso, alwaysShowTerms, blankLine, dateErr, defaultDate, effectiveQty, isBlankLine, isBlankTerm, lineAmount, lineFromDoc, lineToPayload, str, termFromDoc, termToPayload, validateLines, validateTerms,
  type LineRow, type TermRow,
} from "../../lib/purchaseForm";
import type { StatusInfo } from "../../types";
import { useDocScreen, type DocApi, type DocConfig, type Errors } from "../purchase/useDocScreen";

export interface SalesScreenProps {
  companyId: number; branchId: number; userId: number; branchName: string; fyCode: string; calendar: "BS" | "AD";
  setStatus: (s: StatusInfo) => void; dirtyRef: MutableRefObject<boolean>; externalMessage: { text: string; n: number } | null;
}

export interface SForm {
  numberSeriesId: string; docNumber: string; invoiceDate: string; customerGLId: string; subLedgerId: string; agentId: string;
  dueDays: string; dueDate: string; remarks: string; lines: LineRow[]; terms: TermRow[];
}

export const STATE_TONE: Record<string, "slate" | "green" | "amber" | "red" | "blue"> = { DRAFT: "slate", POSTED: "green", REVERSED: "red", REVERSAL: "amber" };
export const STATE_OPTIONS = [{ value: "DRAFT", label: "Draft" }, { value: "POSTED", label: "Posted" }, { value: "REVERSED", label: "Reversed" }, { value: "REVERSAL", label: "Reversal" }];
export const SALES_HINTS = ["Enter: Next", "Shift+Enter: Previous", "Space/↓: Open list", "Ctrl+S: Save", "F3: New", "F2: Edit", "F4: Search", "F1: Help"];
const HELP: [string, string][] = [
  ...COMMON_HELP.filter(([k]) => k !== "Alt+4"),
  ["Post (button)", "Create the accounting journal and lock the invoice; a posted invoice is changed only by reversing it"],
  ["Reverse (button)", "Needs a reason; writes an opposite posted invoice and journal, the original stays as it was"],
];

// The sales screens read the same pick-list shape as the purchase ones: customers stand in for vendors, a product's sales rate for its purchase rate.
export function toPLookups(l: SalesLookups): PLookups {
  return {
    vendors: l.customers.map((c) => ({ ...c, isActive: true, paymentTermDays: null })),
    subLedgers: l.subLedgers.map((s) => ({ ...s, isActive: true })),
    agents: l.agents.map((a) => ({ ...a, isActive: true })),
    locations: [],
    units: l.units,
    products: l.products.map((p) => ({
      id: p.id, code: p.code, description: p.description, type: p.type, isActive: true, baseUnitId: p.unitId, tracksBatch: false, tracksExpiry: false,
      defaultLocationId: null, purchaseRate: null, salesRate: p.salesRate, alternateUnits: p.alternateUnits.map((a) => ({ unitId: a.unitId, conversionFactor: a.conversionFactor })),
    })),
    terms: l.terms.map((t) => ({ ...t, roundingMethod: t.roundingMethod ?? undefined, distributeToLines: false, isActive: true })),
    fiscalYears: l.fiscalYears.map((f) => ({ ...f, isActive: true })),
  };
}

export const salesDocApi = (companyId: number, branchId: number, userId: number): DocApi => ({
  lookups: async () => toPLookups(await salesInvoiceApi.lookups({ companyId, branchId, userId })),
  list: (p) => salesInvoiceApi.list(p) as any,
  get: (id, c) => salesInvoiceApi.get(id, c) as unknown as Promise<PDoc>,
  create: (b) => salesInvoiceApi.create(b) as any,
  update: (id, c, b) => salesInvoiceApi.update(id, c, b) as any,
  remove: (id, c, u) => salesInvoiceApi.remove(id, c, u ?? userId),
  action: (id, c, action, b) => (action === "reverse"
    ? salesInvoiceApi.reverse(id, c, userId, String(b.reason ?? ""), b.date ? String(b.date) : undefined)
    : salesInvoiceApi.post(id, c, userId)) as any,
});

// One Sales Invoice tab of the sales workspace: the workspace owns the list, the lookups and the tab strip.
export default function SalesInvoiceEntry(p: SalesScreenProps & EntryTabProps<SForm, PLookups>) {
  const dlg = useDialog();
  const api = useMemo(() => salesDocApi(p.companyId, p.branchId, p.userId), [p.companyId, p.branchId, p.userId]);
  const lookupsRef = useMemo(() => ({ current: null as ReturnType<typeof useDocScreen>["lookups"] }), []);
  const cfg = useMemo<DocConfig<SForm>>(() => ({
    kind: "sales-invoice", api, title: "Sales Invoice", singular: "Invoice", statusOptions: STATE_OPTIONS,
    emptyForm: (lk) => ({
      numberSeriesId: "", docNumber: "", invoiceDate: defaultDate(lk.fiscalYears.find((y) => y.code === p.fyCode)), customerGLId: "", subLedgerId: "", agentId: "", dueDays: "", dueDate: "", remarks: "",
      lines: [blankLine()], terms: alwaysShowTerms(lk.terms),
    }),
    toForm: (d: PDoc, lk) => {
      const prods = new Map(lk.products.map((x) => [String(x.id), x]));
      return {
        numberSeriesId: str(d.numberSeriesId), docNumber: str(d.invoiceNumber), invoiceDate: str(d.invoiceDate), customerGLId: str(d.customerGLId), subLedgerId: str(d.subLedgerId), agentId: str(d.agentId),
        dueDays: d.dueDays ? str(d.dueDays) : "", dueDate: str(d.dueDate), remarks: str(d.remarks),
        lines: d.lines.length ? d.lines.map((l) => lineFromDoc(l, prods.get(str(l.productId)))) : [blankLine()], terms: (d.terms ?? []).map(termFromDoc),
      };
    },
    toPayload: (f, doc) => {
      const prods = new Map(lookupsRef.current!.products.map((x) => [String(x.id), x]));
      const masters = new Map(lookupsRef.current!.terms.map((x) => [String(x.id), x]));
      const nn = (s: string) => (s.trim() === "" ? null : s.trim());
      return {
        invoiceDate: f.invoiceDate, fiscalYear: p.fyCode, customerGLId: Number(f.customerGLId), subLedgerId: f.subLedgerId ? Number(f.subLedgerId) : null, agentId: f.agentId ? Number(f.agentId) : null,
        dueDays: f.dueDays ? Number(f.dueDays) : 0, dueDate: f.dueDate || null, remarks: nn(f.remarks),
        ...(doc ? { invoiceNumber: doc.invoiceNumber, numberSeriesId: doc.numberSeriesId ?? null } : { invoiceNumber: nn(f.docNumber), numberSeriesId: f.numberSeriesId ? Number(f.numberSeriesId) : null }),
        lines: f.lines.filter((l) => !isBlankLine(l)).map((l) => lineToPayload(l, prods.get(l.productId), "sales")),
        terms: f.terms.filter((t) => !isBlankTerm(t)).map((t) => termToPayload(t, masters.get(t.termId))),
      };
    },
    validate: (f, lk) => {
      const e: Errors = {};
      const customer = lk.vendors.find((v) => String(v.id) === f.customerGLId);
      e.invoiceDate = dateErr("Invoice date", f.invoiceDate, true);
      if (!customer) e.customerGLId = "Pick the customer.";
      else if (customer.requiresSubLedger && !f.subLedgerId) e.subLedgerId = `${customer.code} needs a sub ledger.`;
      e.dueDate = dateErr("Due date", f.dueDate);
      if (f.dueDays && !/^\d{1,4}$/.test(f.dueDays)) e.dueDays = "Due days must be a whole number.";
      const prods = new Map(lk.products.map((x) => [String(x.id), x]));
      Object.assign(e, validateLines(f.lines, prods, { rate: "required", tracking: false }), validateTerms(f.terms, new Map(lk.terms.map((x) => [String(x.id), x])), f.lines.filter((l) => !isBlankLine(l)).length));
      return e;
    },
    editable: (d) => d.state === "DRAFT", deletable: (d) => d.state === "DRAFT", label: (d) => d.invoiceNumber,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [p.fyCode, api]);

  const restored = useRef(p.hookSnapRef.current);
  const localDirty = useRef(false);
  const s = useDocScreen<SForm>(cfg, { companyId: p.companyId, branchId: p.branchId, fyCode: p.fyCode, userId: p.userId, calendar: p.calendar }, {
    setStatus: p.setStatus, dirtyRef: localDirty, externalMessage: p.externalMessage, hints: SALES_HINTS,
    sharedLookups: p.lookups, skipList: true, initialDocId: p.docId, initialForm: p.initialForm, restore: restored.current, snapshotRef: p.hookSnapRef,
    onNew: () => p.onNew(), onDeleted: () => p.onClose(p.tabId), onListChanged: p.onListChanged,
  });
  lookupsRef.current = s.lookups;
  useEffect(() => { p.onMeta(p.tabId, { title: s.doc ? String(s.doc.invoiceNumber) : "New invoice", dirty: s.dirty, docId: s.doc?.id ?? null }); }, [s.doc?.invoiceNumber, s.doc?.id, s.dirty, p.tabId]); // eslint-disable-line react-hooks/exhaustive-deps
  const f = s.form, lk = s.lookups, doc = s.doc, ro = s.readOnly;
  const products = useMemo(() => new Map((lk?.products ?? []).map((x) => [String(x.id), x])), [lk]);
  const masters = useMemo(() => new Map((lk?.terms ?? []).map((x) => [String(x.id), x])), [lk]);
  const state = doc?.state as string | undefined;
  const liveLines = f ? f.lines.filter((l) => !isBlankLine(l)).length : 0;

  // live totals from the same exact engine the server uses when it saves
  const preview = useMemo(() => {
    if (!f) return previewPurchase([], [], new Map(), true);
    const live = f.lines.filter((l) => !isBlankLine(l));
    let incomplete = live.length === 0;
    const priced = live.flatMap((l, i) => {
      const product = products.get(l.productId), qty = effectiveQty(l, product);
      const badAlt = (!!l.altQty && !l.altUnitId) || (!!l.altUnitId && !l.altQty);
      const amount = lineAmount(l, product);
      if (!product || badAlt || !qty || !parseDec(qty) || parseDec(qty)!.n <= 0n || !l.rate || !parseDec(l.rate) || !amount) { incomplete = true; return []; }
      return [{ lineNumber: i + 1, basicAmount: amount }];
    });
    const terms = f.terms.filter((t) => !isBlankTerm(t)).map((t) => ({ rowKey: t.key, termId: Number(t.termId), lineNumber: t.lineNumber, calcType: t.calcType, rate: t.rate, inputAmount: t.inputAmount, isOverridden: t.isOverridden, overrideAmount: t.overrideAmount }));
    return previewPurchase(priced, terms, new Map((lk?.terms ?? []).map((t) => [t.id, t])), incomplete);
  }, [f, lk?.terms, products]);

  const customers = useMemo<ReferenceOption[]>(() => (lk?.vendors ?? []).map((v) => ({ value: String(v.id), label: `${v.code} — ${v.name}`, code: v.code, name: v.name, detail: v.requiresSubLedger ? "Requires sub ledger" : "Customer ledger", isActive: v.isActive })), [lk]);
  const customer = lk?.vendors.find((v) => String(v.id) === f?.customerGLId);
  const subs = useMemo<ReferenceOption[]>(() => (lk?.subLedgers ?? []).filter((x) => String(x.generalLedgerId) === f?.customerGLId).map((x) => ({ value: String(x.id), label: `${x.code} — ${x.name}`, code: x.code, name: x.name, detail: customer?.name ? `For ${customer.name}` : "Sub ledger", isActive: x.isActive })), [lk, f?.customerGLId, customer?.name]);
  const agents = useMemo<ReferenceOption[]>(() => (lk?.agents ?? []).map((a) => ({ value: String(a.id), label: `${a.code} — ${a.name}`, code: a.code, name: a.name, isActive: a.isActive })), [lk]);

  const post = () => doc && s.run({ action: "post", title: "Post invoice?", body: <>Post <b className="font-mono">{doc.invoiceNumber}</b>? This creates the accounting journal and the invoice can no longer be edited.</>, button: "Post invoice", done: (d) => `Posted ${d.invoiceNumber}` });
  const reverse = async () => {
    if (!doc) return;
    const reason = await dlg.prompt(<>Reason for reversing <b className="font-mono">{doc.invoiceNumber}</b>. The reversal is a new posted invoice with an opposite journal; the original stays as it is.</>, { title: "Reverse invoice", label: "Reason", required: true, confirmLabel: "Continue" });
    if (!reason) return;
    // the reversal is dated like any new entry: today, kept inside the invoice's fiscal year (the person can type another date)
    const date = await dlg.prompt("Date of the reversal (AD, YYYY-MM-DD). It must fall in an open period of a fiscal year.", { title: "Reversal date", label: "Date", required: true, confirmLabel: "Continue", defaultValue: defaultDate(lk?.fiscalYears.find((y) => y.code === doc.fiscalYear)) });
    if (!date) return;
    const bad = dateErr("Reversal date", date, true);
    if (bad) { void dlg.warning(bad, { title: "Reversal date" }); return; }
    s.run({ action: "reverse", payload: { reason, date }, title: "Reverse invoice?", body: <>Create a reversal of <b className="font-mono">{doc.invoiceNumber}</b> dated {date}?</>, button: "Create reversal", danger: true, done: (d) => `Created reversal ${d.invoiceNumber}` });
  };
  const actions = doc && (
    <>
      {state === "DRAFT" && <button data-nav className="btn btn-primary" onClick={post}><Send size={14} /> Post</button>}
      {state === "POSTED" && <button data-nav className="btn" onClick={() => void reverse()}><RotateCcw size={14} /> Reverse</button>}
      {doc.reversalOf && <button data-nav className="btn" onClick={() => p.onOpenDoc?.(doc.reversalOf.id)}>Open {doc.reversalOf.invoiceNumber}</button>}
      {doc.reversedBy && <button data-nav className="btn" onClick={() => p.onOpenDoc?.(doc.reversedBy.id)}>Open {doc.reversedBy.invoiceNumber}</button>}
    </>
  );
  const notice = doc && state !== "DRAFT" && (
    <p className="mt-2 border border-amber-300 bg-amber-50 px-2 py-1 text-[12px] text-amber-800">
      {state === "POSTED" ? "Posted invoices cannot be edited. To correct one, reverse it and enter a corrected invoice."
        : state === "REVERSED" ? `This invoice was reversed by ${doc.reversedBy?.invoiceNumber ?? "a reversal invoice"}.` : `This is a reversal of ${doc.reversalOf?.invoiceNumber ?? "another invoice"}.`}
    </p>
  );

  return (
    <DocShell s={s} title="Sales Invoice" singular="Invoice" number={doc ? String(doc.invoiceNumber) : undefined} branchName={p.branchName} fyCode={p.fyCode} statusOptions={STATE_OPTIONS}
      pill={state && <Pill text={state} tone={STATE_TONE[state]} />} canEdit={!!doc && cfg.editable(doc)} canDelete={!!doc && cfg.deletable(doc)} actions={actions} help={HELP} notice={notice}>
      {f && lk && (
        <div className="space-y-3 pt-2">
          <FormSection title="Invoice Header" hint="Number, customer and payment terms">
            <div className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              <NumberField label="Invoice No" documentType="SALES_INVOICE" companyId={p.companyId} branchId={p.branchId} fyCode={p.fyCode} userId={p.userId} existingNumber={doc ? String(doc.invoiceNumber) : undefined} readOnly={ro} seriesId={f.numberSeriesId} number={f.docNumber} onChange={(c) => s.patch(c)} />
              <DateField label="Invoice Date" name="invoiceDate" value={f.invoiceDate} calendar={p.calendar} readOnly={ro} error={s.err("invoiceDate")} required
                onChange={(v) => { const due = f.dueDays ? addDaysIso(v, Number(f.dueDays)) : ""; s.patch(due ? { invoiceDate: v, dueDate: due } : { invoiceDate: v }); s.clearError("invoiceDate"); }} />
              <Field label="Customer" required error={s.err("customerGLId")} className="col-span-1 sm:col-span-2">
                <MasterReferencePicker fieldName="customerGLId" label="Customer ledger" scopeKey="customer-ledgers" contextKey={String(p.companyId)} placeholder="Choose customer ledger…" required value={f.customerGLId} hasError={!!s.err("customerGLId")} options={customers} disabled={ro}
                  createMaster={{ key: "party", defaults: { glType: "CUSTOMER" }, valueFrom: (r) => String(r.generalLedgerId ?? r.id) }}
                  onChange={(v) => { s.patch({ customerGLId: v, subLedgerId: "" }); s.clearError("customerGLId", "subLedgerId"); }} onCommit={(el, dir) => focusStep(el, dir)} />
              </Field>
              <Field label={customer?.requiresSubLedger ? "Sub Ledger" : "Sub Ledger (not needed)"} required={!!customer?.requiresSubLedger} error={s.err("subLedgerId")}>
                <MasterReferencePicker fieldName="subLedgerId" label="Sub Ledger" scopeKey="sub-ledger" contextKey={`${p.companyId}:${f.customerGLId || "none"}`} placeholder={subs.length ? "Choose sub ledger…" : customer?.requiresSubLedger ? "None yet — Ctrl+M to create" : "—"} value={f.subLedgerId} hasError={!!s.err("subLedgerId")} options={subs}
                  disabled={ro || (subs.length === 0 && !customer?.requiresSubLedger)} required={!!customer?.requiresSubLedger} createMaster={customer?.requiresSubLedger ? { key: "sub-ledger", defaults: { generalLedgerId: f.customerGLId } } : undefined}
                  onChange={(v) => { s.patch({ subLedgerId: v }); s.clearError("subLedgerId"); }} onCommit={(el, dir) => focusStep(el, dir)} />
              </Field>
              <Field label="Salesperson" error={s.err("agentId")}>
                <MasterReferencePicker fieldName="agentId" label="Salesperson" scopeKey="agents" contextKey={String(p.companyId)} placeholder="Salesperson (optional)" value={f.agentId} hasError={!!s.err("agentId")} options={agents} disabled={ro} createMaster={{ key: "agents" }}
                  onChange={(v) => s.patch({ agentId: v })} onCommit={(el, dir) => focusStep(el, dir)} />
              </Field>
              <TextField label="Due Days" name="dueDays" value={f.dueDays} max={4} readOnly={ro} error={s.err("dueDays")}
                onChange={(v) => { const due = v ? addDaysIso(f.invoiceDate, Number(v)) : ""; s.patch(due ? { dueDays: v, dueDate: due } : { dueDays: v }); if (due) s.clearError("dueDate"); }} />
              <DateField label="Due Date" name="dueDate" value={f.dueDate} onChange={(v) => { s.patch({ dueDate: v }); s.clearError("dueDate"); }} calendar={p.calendar} readOnly={ro} error={s.err("dueDate")} />
              <TextField label="Remarks" name="remarks" value={f.remarks} onChange={(v) => s.patch({ remarks: v })} readOnly={ro} max={1024} narrationCompanyId={p.companyId} className="col-span-1 sm:col-span-2 2xl:col-span-3" error={s.err("remarks")} />
            </div>
          </FormSection>
          <h2 className="text-[13px] font-semibold">Lines</h2>
          <LinesGrid kind="sales" lines={f.lines} onChange={(lines) => s.patch({ lines })} lookups={lk} products={products} readOnly={ro} errors={s.errors} calendar={p.calendar} clearError={s.clearError} contextKey={String(p.companyId)} />
          <h2 className="text-[13px] font-semibold">Sales Terms</h2>
          <TermsGrid terms={f.terms} onChange={(terms) => s.patch({ terms })} lookups={lk} masters={masters} lineCount={liveLines} readOnly={ro} errors={s.errors} clearError={s.clearError} contextKey={String(p.companyId)} excludeCategory="COSTING"
            calculationPreview={ro ? undefined : preview.terms} previewError={preview.message} />
          {s.err("terms") && <p role="alert" className="text-[12px] text-rose-700">{s.err("terms")}</p>}
          <PurchaseInvoiceTotals noun="invoice" preview={preview} savedDoc={doc} readOnly={ro} hasLines={liveLines > 0} />
        </div>
      )}
    </DocShell>
  );
}
