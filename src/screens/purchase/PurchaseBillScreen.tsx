import { useEffect, useMemo, useRef, useState } from "react";
import { FilePlus2, RotateCcw, Send } from "lucide-react";
import { purchaseApi, type PDoc, type PListRow } from "../../api";
import { Combobox, type ComboOption } from "../../components/Combobox";
import { COMMON_HELP, DocShell, Field, HINTS, Pill, focusStep, money } from "../../components/purchase/Bits";
import { DateField, TextField, VendorFields } from "../../components/purchase/HeadFields";
import { LinesGrid, TermsGrid } from "../../components/purchase/LinesGrid";
import {
  blankLine, dateErr, defaultDate, isBlankLine, isBlankTerm, lineFromDoc, lineToPayload, str, termFromDoc, termToPayload, trimDec, validateLines, validateTerms,
  type LineRow, type TermRow,
} from "../../lib/purchaseForm";
import type { PurchaseScreenProps } from "./PurchaseOrderScreen";
import { useDocScreen, type DocConfig, type Errors } from "./useDocScreen";

const IMPORT_FIELDS: { key: string; label: string; kind: "text" | "date" | "mode"; max?: number }[] = [
  { key: "customsDeclarationNo", label: "Customs Declaration No", kind: "text" }, { key: "customsDeclarationDate", label: "Declaration Date", kind: "date" },
  { key: "customsOffice", label: "Customs Office", kind: "text" }, { key: "countryOfOrigin", label: "Country of Origin", kind: "text" },
  { key: "lcNo", label: "LC No", kind: "text" }, { key: "lcDate", label: "LC Date", kind: "date" }, { key: "lcBankName", label: "LC Bank", kind: "text" },
  { key: "transportMode", label: "Transport Mode", kind: "mode" }, { key: "blAwbNo", label: "BL / AWB No", kind: "text" }, { key: "blAwbDate", label: "BL / AWB Date", kind: "date" },
  { key: "transporterName", label: "Transporter", kind: "text" }, { key: "vehicleNo", label: "Vehicle No", kind: "text" }, { key: "lrNo", label: "LR No", kind: "text" }, { key: "lrDate", label: "LR Date", kind: "date" },
  { key: "importPermitNo", label: "Import Permit No", kind: "text" }, { key: "importPermitDate", label: "Permit Date", kind: "date" },
];
const PURCHASE_TYPES = [
  { value: "GOODS_PURCHASE_OTHERS", label: "Goods — Others" }, { value: "GOODS_PURCHASE_CAPITAL", label: "Goods — Capital" },
  { value: "SERVICE_PURCHASE_OTHERS", label: "Service — Others" }, { value: "SERVICE_PURCHASE_CAPITAL", label: "Service — Capital" },
];
const STATE_TONE: Record<string, "slate" | "green" | "amber" | "blue"> = { DRAFT: "slate", POSTED: "green", REVERSED: "amber", REVERSAL: "blue" };
const OPTIONS = [{ value: "DRAFT", label: "Draft" }, { value: "POSTED", label: "Posted" }, { value: "REVERSED", label: "Reversed" }, { value: "REVERSAL", label: "Reversal bills" }];
const HELP: [string, string][] = [...COMMON_HELP, ["Post", "Writes the journal voucher; a posted bill cannot be edited, only reversed"]];

interface BForm {
  invoiceDate: string; invoiceType: "LOCAL" | "IMPORT"; purchaseType: string; vendorGLId: string; subLedgerId: string; agentId: string; vendorInvoiceNo: string; vendorInvoiceDate: string;
  dueDays: string; dueDate: string; remarks: string; purchaseChallanId: string; purchaseOrderId: string; mainBillId: string; challanNo: string; orderNo: string;
  lines: LineRow[]; terms: TermRow[]; imp: Record<string, string>;
}
const iso10 = (v: unknown) => (v ? String(v).slice(0, 10) : "");

export default function PurchaseBillScreen(p: PurchaseScreenProps & { fromChallan: { id: number; n: number } | null }) {
  const cfg = useMemo<DocConfig<BForm>>(() => ({
    kind: "bills", title: "Purchase Bill", singular: "Bill", statusOptions: OPTIONS,
    emptyForm: (lk) => ({
      invoiceDate: defaultDate(lk.fiscalYears.find((y) => y.code === p.fyCode)), invoiceType: "LOCAL", purchaseType: "GOODS_PURCHASE_OTHERS", vendorGLId: "", subLedgerId: "", agentId: "",
      vendorInvoiceNo: "", vendorInvoiceDate: "", dueDays: "", dueDate: "", remarks: "", purchaseChallanId: "", purchaseOrderId: "", mainBillId: "", challanNo: "", orderNo: "",
      lines: [blankLine()], terms: [], imp: {},
    }),
    toForm: (d: PDoc, lk) => {
      const prods = new Map(lk.products.map((x) => [String(x.id), x]));
      const imp: Record<string, string> = {};
      for (const k of IMPORT_FIELDS) imp[k.key] = str(d.importDetail?.[k.key]);
      return {
        invoiceDate: str(d.invoiceDate), invoiceType: d.invoiceType, purchaseType: str(d.purchaseType), vendorGLId: str(d.vendorGLId), subLedgerId: str(d.subLedgerId), agentId: str(d.agentId),
        vendorInvoiceNo: str(d.vendorInvoiceNo), vendorInvoiceDate: str(d.vendorInvoiceDate), dueDays: str(d.dueDays), dueDate: str(d.dueDate), remarks: str(d.remarks),
        purchaseChallanId: str(d.purchaseChallanId), purchaseOrderId: str(d.purchaseOrderId), mainBillId: str(d.mainBillId), challanNo: str(d.challanNumber), orderNo: str(d.orderNumber),
        lines: d.lines.length ? d.lines.map((l) => lineFromDoc(l, prods.get(str(l.productId)))) : [blankLine()], terms: (d.terms ?? []).map(termFromDoc), imp,
      };
    },
    toPayload: (f) => {
      const prods = new Map(lkRef.current!.products.map((x) => [String(x.id), x]));
      const masters = new Map(lkRef.current!.terms.map((x) => [String(x.id), x]));
      const nn = (v: string) => v.trim() || null;
      return {
        invoiceDate: f.invoiceDate, invoiceType: f.invoiceType, purchaseType: f.purchaseType, vendorGLId: Number(f.vendorGLId), subLedgerId: f.subLedgerId ? Number(f.subLedgerId) : null,
        agentId: f.agentId ? Number(f.agentId) : null, vendorInvoiceNo: nn(f.vendorInvoiceNo), vendorInvoiceDate: f.vendorInvoiceDate || null,
        dueDays: f.dueDays ? Number(f.dueDays) : null, dueDate: f.dueDate || null, remarks: nn(f.remarks),
        purchaseChallanId: f.purchaseChallanId ? Number(f.purchaseChallanId) : null, purchaseOrderId: f.purchaseOrderId ? Number(f.purchaseOrderId) : null, mainBillId: f.mainBillId ? Number(f.mainBillId) : null,
        lines: f.mainBillId ? [] : f.lines.filter((l) => !isBlankLine(l)).map((l) => lineToPayload(l, prods.get(l.productId), "bill")),
        terms: f.terms.filter((t) => !isBlankTerm(t)).map((t) => termToPayload(t, masters.get(t.termId))),
        importDetail: f.invoiceType === "IMPORT" ? Object.fromEntries(IMPORT_FIELDS.map((k) => [k.key, nn(f.imp[k.key] ?? "")])) : null,
      };
    },
    validate: (f, lk) => {
      const e: Errors = {};
      const vendor = lk.vendors.find((v) => String(v.id) === f.vendorGLId);
      e.invoiceDate = dateErr("Invoice date", f.invoiceDate, true);
      if (!vendor) e.vendorGLId = "Pick the vendor.";
      else if (vendor.requiresSubLedger && !f.subLedgerId) e.subLedgerId = `${vendor.code} needs a sub ledger.`;
      e.vendorInvoiceDate = dateErr("Vendor invoice date", f.vendorInvoiceDate);
      e.dueDate = dateErr("Due date", f.dueDate);
      if (f.dueDays && !/^\d{1,4}$/.test(f.dueDays)) e.dueDays = "Due days must be a whole number.";
      for (const k of IMPORT_FIELDS) if (f.invoiceType === "IMPORT" && k.kind === "date") { const m = dateErr(k.label, f.imp[k.key] ?? ""); if (m) e[`imp.${k.key}`] = m; }
      const live = f.lines.filter((l) => !isBlankLine(l)).length;
      if (f.mainBillId) { if (!f.terms.some((t) => !isBlankTerm(t))) e.terms = "An additional bill needs at least one charge (term)."; }
      else Object.assign(e, validateLines(f.lines, new Map(lk.products.map((x) => [String(x.id), x])), { rate: "required", tracking: true }));
      Object.assign(e, validateTerms(f.terms, new Map(lk.terms.map((x) => [String(x.id), x])), live));
      return e;
    },
    editable: (d) => !d.isPosted, deletable: (d) => !d.isPosted, label: (d) => d.invoiceNumber,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [p.fyCode]);
  const lkRef = useMemo(() => ({ current: null as ReturnType<typeof useDocScreen>["lookups"] }), []);
  const s = useDocScreen<BForm>(cfg, { companyId: p.companyId, branchId: p.branchId, fyCode: p.fyCode, userId: p.userId, calendar: p.calendar }, { setStatus: p.setStatus, dirtyRef: p.dirtyRef, externalMessage: p.externalMessage, hints: HINTS });
  lkRef.current = s.lookups;
  const f = s.form, lk = s.lookups, doc = s.doc, ro = s.readOnly;
  const products = useMemo(() => new Map((lk?.products ?? []).map((x) => [String(x.id), x])), [lk]);
  const masters = useMemo(() => new Map((lk?.terms ?? []).map((x) => [String(x.id), x])), [lk]);

  // start from a confirmed challan (the "Create Bill" button on the challan screen)
  const started = useRef(0);
  useEffect(() => {
    if (!p.fromChallan || !lk || started.current === p.fromChallan.n) return;
    started.current = p.fromChallan.n;
    (async () => {
      try {
        const b = await purchaseApi.billFromChallan(p.companyId, p.fromChallan!.id);
        const c = await purchaseApi.get("challans", p.fromChallan!.id, p.companyId);
        const prods = new Map(lk.products.map((x) => [String(x.id), x]));
        const base = cfg.emptyForm(lk);
        const lines: LineRow[] = (b.lines as any[]).map((l) => ({
          ...blankLine({ productId: str(l.productId), qty: trimDec(l.qty), rate: trimDec(l.rate), locationId: str(l.locationId), batchNo: str(l.batchNo), manufactureDate: iso10(l.manufactureDate), expiryDate: iso10(l.expiryDate), purchaseOrderLineId: str(l.purchaseOrderLineId), challanLineId: str(l.challanLineId), link: "From challan" }),
          unitId: prods.get(str(l.productId))?.baseUnitId ? "" : str(l.unitId),
        }));
        s.newDoc({ ...base, vendorGLId: str(b.vendorGLId), subLedgerId: str(b.subLedgerId), agentId: str(b.agentId), purchaseChallanId: str(b.purchaseChallanId), purchaseOrderId: str(b.purchaseOrderId), challanNo: str(c.challanNumber), orderNo: str(c.orderNumber), lines });
        s.flash(`Bill started from challan ${c.challanNumber}: enter the vendor's invoice details and check the rates`, "info");
      } catch (e) { s.flash((e as Error).message, "err"); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.fromChallan, lk]);

  // posted main bills that a charge can be added to
  const [mains, setMains] = useState<PListRow[]>([]);
  useEffect(() => {
    purchaseApi.list("bills", { companyId: p.companyId, branchId: p.branchId, fiscalYear: "", status: "POSTED" }).then((r) => setMains(r.rows.filter((x) => !x.isAdditional))).catch(() => {});
  }, [p.companyId, p.branchId, s.doc?.id, s.mode]);
  const mainOpts = useMemo<ComboOption[]>(() => {
    const o = mains.map((x) => ({ value: String(x.id), label: `${x.invoiceNumber} — ${x.vendorName}` }));
    if (f?.mainBillId && !o.some((x) => x.value === f.mainBillId) && doc?.mainBill) o.push({ value: f.mainBillId, label: doc.mainBill.invoiceNumber });
    return o;
  }, [mains, f?.mainBillId, doc]);
  const pickMain = async (id: string) => {
    if (!id) return s.patch({ mainBillId: "" });
    try {
      const m = await purchaseApi.get("bills", Number(id), p.companyId);
      s.patch({ mainBillId: id, vendorGLId: str(m.vendorGLId), subLedgerId: str(m.subLedgerId), agentId: str(m.agentId), invoiceType: m.invoiceType, purchaseType: str(m.purchaseType), lines: [blankLine()] });
    } catch (e) { s.flash((e as Error).message, "err"); }
  };
  const addCharges = () => {
    if (!doc || !lk) return;
    s.newDoc({
      ...cfg.emptyForm(lk), mainBillId: String(doc.id), vendorGLId: str(doc.vendorGLId), subLedgerId: str(doc.subLedgerId), agentId: str(doc.agentId), invoiceType: doc.invoiceType, purchaseType: str(doc.purchaseType),
      remarks: `Additional charges for ${doc.invoiceNumber}`,
    });
  };

  const state = doc?.state as string | undefined;
  const isAdditional = !!f?.mainBillId;
  const reversible = !!doc && state === "POSTED";
  const actions = doc && (
    <>
      {state === "DRAFT" && <button className="btn btn-primary" onClick={() => s.run({ action: "post", title: "Post bill?", body: <>Post <b className="font-mono">{doc.invoiceNumber}</b> for <b>{money(doc.totalAmount)}</b>? A balanced journal voucher is written and the bill can no longer be edited or deleted — only reversed.</>, button: "Post", done: (d) => `Posted ${d.invoiceNumber}${d.journalVoucher ? ` (voucher ${d.journalVoucher.voucherNumber})` : ""}` })}><Send size={14} /> Post</button>}
      {reversible && !doc.mainBillId && <button className="btn" onClick={addCharges}><FilePlus2 size={14} /> Add Charges</button>}
      {reversible && (
        <button className="btn" onClick={() => {
          const fy = lk?.fiscalYears.find((y) => y.code === p.fyCode);
          const d0 = defaultDate(fy), rv = { date: d0 < doc.invoiceDate ? doc.invoiceDate : d0, reason: "" };
          s.run({
            action: "reverse", title: "Reverse bill?", button: "Reverse", danger: true, payload: rv,
            body: (
              <div className="space-y-2">
                <p>Reverse <b className="font-mono">{doc.invoiceNumber}</b>? A reversal bill and a reversing voucher are posted; the original stays on record.</p>
                <label className="block text-[12px]">Reversal date (AD, YYYY-MM-DD)<input data-af defaultValue={rv.date} onChange={(e) => { rv.date = e.target.value.trim(); }} className="fld mt-0.5" /></label>
                <label className="block text-[12px]">Reason<input defaultValue="" maxLength={200} onChange={(e) => { rv.reason = e.target.value; }} className="fld mt-0.5" /></label>
              </div>
            ),
            done: (d) => `Reversed ${d.invoiceNumber}`,
          });
        }}><RotateCcw size={14} /> Reverse</button>
      )}
    </>
  );

  const notice = doc && (
    <div className="mt-2 space-y-1">
      {state === "POSTED" && <p className="text-[12px] text-green-800 bg-green-50 border border-green-300 px-2 py-1">Posted{doc.journalVoucher ? <> as voucher <b className="font-mono">{doc.journalVoucher.voucherNumber}</b> dated {doc.journalVoucher.voucherDate}</> : ""}. A posted bill cannot be edited; reverse it to correct it.</p>}
      {state === "REVERSED" && <p className="text-[12px] text-amber-800 bg-amber-50 border border-amber-300 px-2 py-1">Reversed by <b className="font-mono">{doc.reversedBy?.invoiceNumber}</b>.</p>}
      {state === "REVERSAL" && <p className="text-[12px] text-blue-800 bg-blue-50 border border-blue-300 px-2 py-1">This is the reversal of <b className="font-mono">{doc.reversalOf?.invoiceNumber}</b>.</p>}
      {doc.mainBill && <p className="text-[12px] text-slate-700 bg-slate-50 border border-slate-300 px-2 py-1">Additional charges bill for <b className="font-mono">{doc.mainBill.invoiceNumber}</b>.</p>}
    </div>
  );

  return (
    <DocShell s={s} title="Purchase Bill" singular="Bill" branchName={p.branchName} fyCode={p.fyCode} statusOptions={OPTIONS}
      pill={state && <Pill text={state} tone={STATE_TONE[state]} />} canEdit={!!doc && cfg.editable(doc)} canDelete={!!doc && cfg.deletable(doc)} actions={actions} help={HELP} notice={notice}
      listRow={(r) => (
        <>
          <div className="flex items-start justify-between gap-2"><span className="min-w-0 font-mono font-semibold break-words">{r.invoiceNumber}</span><span className="flex shrink-0 gap-1">{r.isAdditional && <Pill text="ADDL" tone="blue" />}<Pill text={r.state} tone={STATE_TONE[r.state]} /></span></div>
          <div className="text-[12px] text-slate-600 break-words">{r.vendorName}{r.vendorInvoiceNo ? ` · ${r.vendorInvoiceNo}` : ""}</div>
          <div className="flex flex-wrap justify-between gap-x-2 text-[12px] text-slate-500"><span>{r.invoiceDate}</span><span className="tabular-nums whitespace-nowrap">{money(r.totalAmount)}</span></div>
        </>
      )}>
      {f && lk && (
        <div className="space-y-3 pt-2">
          <div className="grid min-w-0 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5 gap-x-3 gap-y-2">
            <Field label="Invoice No"><input disabled className="fld bg-slate-100 text-slate-600" value={doc?.invoiceNumber ?? ""} placeholder="(next number)" aria-label="Invoice number" /></Field>
            <DateField label="Invoice Date" name="invoiceDate" value={f.invoiceDate} onChange={(v) => { s.patch({ invoiceDate: v }); s.clearError("invoiceDate"); }} calendar={p.calendar} readOnly={ro} error={s.err("invoiceDate")} required />
            <Field label="Invoice Type">
              <select data-field="invoiceType" disabled={ro || isAdditional} value={f.invoiceType} onChange={(e) => s.patch({ invoiceType: e.target.value as BForm["invoiceType"] })} className={`fld ${ro ? "bg-slate-100 text-slate-600" : ""}`}><option value="LOCAL">Local</option><option value="IMPORT">Import</option></select>
            </Field>
            <Field label="Purchase Type" className="col-span-1 sm:col-span-2 2xl:col-span-2">
              <select data-field="purchaseType" disabled={ro || isAdditional} value={f.purchaseType} onChange={(e) => s.patch({ purchaseType: e.target.value })} className={`fld ${ro ? "bg-slate-100 text-slate-600" : ""}`}>{PURCHASE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select>
            </Field>
            <VendorFields lookups={lk} vendorGLId={f.vendorGLId} subLedgerId={f.subLedgerId} agentId={f.agentId} readOnly={ro} errors={s.errors} lockVendor={!!f.purchaseChallanId || isAdditional}
              onChange={(c) => { s.patch(c); s.clearError("vendorGLId", "subLedgerId"); }} />
            <TextField label="Vendor Invoice No" name="vendorInvoiceNo" value={f.vendorInvoiceNo} onChange={(v) => s.patch({ vendorInvoiceNo: v })} readOnly={ro} error={s.err("vendorInvoiceNo")} />
            <DateField label="Vendor Invoice Date" name="vendorInvoiceDate" value={f.vendorInvoiceDate} onChange={(v) => { s.patch({ vendorInvoiceDate: v }); s.clearError("vendorInvoiceDate"); }} calendar={p.calendar} readOnly={ro} error={s.err("vendorInvoiceDate")} />
            <TextField label="Due Days" name="dueDays" value={f.dueDays} onChange={(v) => /^\d{0,4}$/.test(v) && s.patch({ dueDays: v })} readOnly={ro} error={s.err("dueDays")} max={4} />
            <DateField label="Due Date" name="dueDate" value={f.dueDate} onChange={(v) => { s.patch({ dueDate: v }); s.clearError("dueDate"); }} calendar={p.calendar} readOnly={ro} error={s.err("dueDate")} />
            <Field label="Additional to Bill" error={s.err("mainBillId")}>
              <Combobox fieldName="mainBillId" placeholder="— (a normal bill)" value={f.mainBillId} hasError={!!s.err("mainBillId")} options={mainOpts} disabled={ro || !!doc || !!f.purchaseChallanId} onChange={(v) => void pickMain(v)} onCommit={(el, dir) => focusStep(el, dir)} />
            </Field>
            <Field label="Challan / Order"><input disabled className="fld bg-slate-100 text-slate-600" value={[f.challanNo && `Challan ${f.challanNo}`, f.orderNo && `Order ${f.orderNo}`].filter(Boolean).join(" · ")} placeholder="—" aria-label="Linked documents" /></Field>
            <TextField label="Remarks" name="remarks" value={f.remarks} onChange={(v) => s.patch({ remarks: v })} readOnly={ro} max={1024} className="col-span-1 sm:col-span-2 2xl:col-span-3" error={s.err("remarks")} />
          </div>

          {f.invoiceType === "IMPORT" && (
            <fieldset className="border border-slate-400 bg-white/60 px-3 pt-1 pb-2">
              <legend className="px-1 text-[12px] font-semibold">Import details <span className="font-normal text-slate-600">(the customs declaration no is needed to post)</span></legend>
              <div className="grid min-w-0 grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-x-3 gap-y-2">
                {IMPORT_FIELDS.map((k) => k.kind === "date"
                  ? <DateField key={k.key} label={k.label} name={`imp.${k.key}`} value={f.imp[k.key] ?? ""} onChange={(v) => { s.patch({ imp: { ...f.imp, [k.key]: v } }); s.clearError(`imp.${k.key}`); }} calendar={p.calendar} readOnly={ro} error={s.err(`imp.${k.key}`)} />
                  : k.kind === "mode"
                    ? <Field key={k.key} label={k.label}><select data-field={`imp.${k.key}`} disabled={ro} value={f.imp[k.key] ?? ""} onChange={(e) => s.patch({ imp: { ...f.imp, [k.key]: e.target.value } })} className={`fld ${ro ? "bg-slate-100 text-slate-600" : ""}`}><option value="">—</option><option value="ROAD">Road</option><option value="AIR">Air</option><option value="RAIL">Rail</option><option value="OTHER">Other</option></select></Field>
                    : <TextField key={k.key} label={k.label} name={`imp.${k.key}`} value={f.imp[k.key] ?? ""} onChange={(v) => s.patch({ imp: { ...f.imp, [k.key]: v } })} readOnly={ro} max={k.max ?? 60} error={s.err(`imp.${k.key}`)} />)}
              </div>
            </fieldset>
          )}

          {!isAdditional && (
            <>
              <h2 className="text-[13px] font-semibold">Lines</h2>
              <LinesGrid kind="bill" lines={f.lines} onChange={(lines) => s.patch({ lines })} lookups={lk} products={products} readOnly={ro} errors={s.errors} calendar={p.calendar} clearError={s.clearError} lockProducts />
            </>
          )}
          <h2 className="text-[13px] font-semibold">{isAdditional ? "Additional charges" : "Billing Terms"}</h2>
          <TermsGrid terms={f.terms} onChange={(terms) => s.patch({ terms })} lookups={lk} masters={masters} lineCount={f.lines.filter((l) => !isBlankLine(l)).length} readOnly={ro} errors={s.errors} clearError={s.clearError} category={isAdditional ? "ADDITIONAL" : undefined} />
          {s.err("terms") && <p className="text-[12px] text-red-700">{s.err("terms")}</p>}
          {doc && (
            <div className="flex flex-wrap justify-end gap-x-4 gap-y-1 text-[13px] border border-slate-400 bg-slate-50 px-3 py-1.5">
              <span>Basic <b className="tabular-nums ml-1">{money(doc.basicAmount)}</b></span><span>Terms <b className="tabular-nums ml-1">{money(doc.termAmount)}</b></span><span>Total <b className="tabular-nums ml-1">{money(doc.totalAmount)}</b></span>
            </div>
          )}
          {ro && doc && !isAdditional && doc.lines.some((l) => Number(l.landedAmount) !== 0) && (
            <p className="text-[12px] text-slate-600">Landed cost per line: {doc.lines.map((l) => `${l.lineNumber}: ${money(l.landedAmount)}`).join(" · ")}</p>
          )}
          {doc && doc.additionalBills?.length > 0 && <p className="text-[12px] text-slate-600">Additional bills: {doc.additionalBills.map((a: any) => `${a.invoiceNumber} (${money(a.totalAmount)}, ${a.state.toLowerCase()})`).join(", ")}</p>}
        </div>
      )}
    </DocShell>
  );
}
