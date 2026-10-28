import { useEffect, useMemo, useState } from "react";
import { CheckCheck, FileText } from "lucide-react";
import { purchaseApi, type PDoc, type PListRow } from "../../api";
import { Combobox, type ComboOption } from "../../components/Combobox";
import { COMMON_HELP, DocShell, Field, HINTS, Pill, focusStep, money } from "../../components/purchase/Bits";
import { DateField, TextField, VendorFields } from "../../components/purchase/HeadFields";
import { LinesGrid } from "../../components/purchase/LinesGrid";
import { blankLine, dateErr, defaultDate, isBlankLine, lineFromDoc, lineToPayload, str, trimDec, validateLines, type LineRow } from "../../lib/purchaseForm";
import type { PurchaseScreenProps } from "./PurchaseOrderScreen";
import { useDocScreen, type DocConfig, type Errors } from "./useDocScreen";

interface CForm {
  challanDate: string; vendorGLId: string; subLedgerId: string; agentId: string; purchaseOrderId: string; vendorChallanNo: string; vendorChallanDate: string;
  transporterName: string; vehicleNo: string; lrNo: string; lrDate: string; remarks: string; lines: LineRow[];
}
const OPTIONS = [{ value: "DRAFT", label: "Draft" }, { value: "CONFIRMED", label: "Confirmed" }];
const HELP: [string, string][] = [...COMMON_HELP];

export default function PurchaseChallanScreen(p: PurchaseScreenProps & { onCreateBill: (challanId: number) => void }) {
  const cfg = useMemo<DocConfig<CForm>>(() => ({
    kind: "challans", title: "Purchase Challan", singular: "Challan", statusOptions: OPTIONS,
    emptyForm: (lk) => ({
      challanDate: defaultDate(lk.fiscalYears.find((y) => y.code === p.fyCode)), vendorGLId: "", subLedgerId: "", agentId: "", purchaseOrderId: "", vendorChallanNo: "", vendorChallanDate: "",
      transporterName: "", vehicleNo: "", lrNo: "", lrDate: "", remarks: "", lines: [blankLine()],
    }),
    toForm: (d: PDoc, lk) => {
      const prods = new Map(lk.products.map((x) => [String(x.id), x]));
      return {
        challanDate: str(d.challanDate), vendorGLId: str(d.vendorGLId), subLedgerId: str(d.subLedgerId), agentId: str(d.agentId), purchaseOrderId: str(d.purchaseOrderId),
        vendorChallanNo: str(d.vendorChallanNo), vendorChallanDate: str(d.vendorChallanDate), transporterName: str(d.transporterName), vehicleNo: str(d.vehicleNo), lrNo: str(d.lrNo), lrDate: str(d.lrDate),
        remarks: str(d.remarks), lines: d.lines.length ? d.lines.map((l) => lineFromDoc(l, prods.get(str(l.productId)))) : [blankLine()],
      };
    },
    toPayload: (f, doc) => {
      const prods = new Map(lkRef.current!.products.map((x) => [String(x.id), x]));
      return {
        challanDate: f.challanDate, vendorGLId: Number(f.vendorGLId), subLedgerId: f.subLedgerId ? Number(f.subLedgerId) : null, agentId: f.agentId ? Number(f.agentId) : null,
        purchaseOrderId: f.purchaseOrderId ? Number(f.purchaseOrderId) : null, vendorChallanNo: f.vendorChallanNo.trim() || null, vendorChallanDate: f.vendorChallanDate || null,
        transporterName: f.transporterName.trim() || null, vehicleNo: f.vehicleNo.trim() || null, lrNo: f.lrNo.trim() || null, lrDate: f.lrDate || null, remarks: f.remarks.trim() || null,
        ...(doc ? { challanNumber: doc.challanNumber } : {}),
        lines: f.lines.filter((l) => !isBlankLine(l)).map((l) => lineToPayload(l, prods.get(l.productId), "challan")),
      };
    },
    validate: (f, lk) => {
      const e: Errors = {};
      const vendor = lk.vendors.find((v) => String(v.id) === f.vendorGLId);
      e.challanDate = dateErr("Challan date", f.challanDate, true);
      if (!vendor) e.vendorGLId = "Pick the vendor.";
      else if (vendor.requiresSubLedger && !f.subLedgerId) e.subLedgerId = `${vendor.code} needs a sub ledger.`;
      e.vendorChallanDate = dateErr("Vendor challan date", f.vendorChallanDate);
      e.lrDate = dateErr("LR date", f.lrDate);
      Object.assign(e, validateLines(f.lines, new Map(lk.products.map((x) => [String(x.id), x])), { rate: "optional", tracking: true }));
      return e;
    },
    editable: (d) => !d.isConfirmed, deletable: (d) => !d.isConfirmed, label: (d) => d.challanNumber,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [p.fyCode]);
  const lkRef = useMemo(() => ({ current: null as ReturnType<typeof useDocScreen>["lookups"] }), []);
  const s = useDocScreen<CForm>(cfg, { companyId: p.companyId, branchId: p.branchId, fyCode: p.fyCode, userId: p.userId, calendar: p.calendar }, { setStatus: p.setStatus, dirtyRef: p.dirtyRef, externalMessage: p.externalMessage, hints: HINTS });
  lkRef.current = s.lookups;
  const f = s.form, lk = s.lookups, doc = s.doc, ro = s.readOnly;
  const products = useMemo(() => new Map((lk?.products ?? []).map((x) => [String(x.id), x])), [lk]);

  // approved orders that goods can be received against
  const [orders, setOrders] = useState<PListRow[]>([]);
  useEffect(() => {
    purchaseApi.list("orders", { companyId: p.companyId, branchId: p.branchId, fiscalYear: "", status: "APPROVED" }).then((r) => setOrders(r.rows)).catch(() => {});
  }, [p.companyId, p.branchId, s.doc?.id, s.mode]);
  const orderOpts = useMemo<ComboOption[]>(() => {
    const list = orders.filter((o) => !f?.vendorGLId || String(o.vendorGLId) === f.vendorGLId || String(o.id) === f.purchaseOrderId);
    const o = list.map((x) => ({ value: String(x.id), label: `${x.orderNumber} — ${x.vendorName} (${x.orderDate})` }));
    if (f?.purchaseOrderId && doc?.orderNumber && !o.some((x) => x.value === f.purchaseOrderId)) o.push({ value: f.purchaseOrderId, label: String(doc.orderNumber) });
    return o;
  }, [orders, f?.vendorGLId, f?.purchaseOrderId, doc]);

  const pickOrder = async (id: string) => {
    if (!f || !lk) return;
    if (!id) return s.patch({ purchaseOrderId: "" });
    try {
      const o = await purchaseApi.get("orders", Number(id), p.companyId);
      const prods = new Map(lk.products.map((x) => [String(x.id), x]));
      const lines = o.lines.filter((l) => Number(l.pendingToReceive) > 0).map((l) => ({
        ...lineFromDoc({ ...l, qty: l.pendingToReceive, purchaseOrderLineId: l.id, orderLineNumber: l.lineNumber, altQty: null, altUnitId: null, locationId: null }, prods.get(str(l.productId))),
        locationId: prods.get(str(l.productId))?.type === "STOCK" && prods.get(str(l.productId))?.defaultLocationId ? String(prods.get(str(l.productId))!.defaultLocationId) : "",
        qty: trimDec(l.pendingToReceive),
      }));
      s.patch({ purchaseOrderId: id, vendorGLId: str(o.vendorGLId), subLedgerId: str(o.subLedgerId), agentId: str(o.agentId), lines: lines.length ? lines : [blankLine()] });
      s.clearError("vendorGLId", "subLedgerId");
      s.flash(lines.length ? `Filled ${lines.length} line(s) with what is still to be received on ${o.orderNumber}` : `${o.orderNumber} has nothing left to receive`, lines.length ? "info" : "err");
    } catch (e) { s.flash((e as Error).message, "err"); }
  };

  const confirmed = !!doc?.isConfirmed;
  const actions = doc && (
    <>
      {!confirmed && <button className="btn btn-primary" onClick={() => s.run({ action: "confirm", title: "Confirm challan?", body: <>Confirm <b className="font-mono">{doc.challanNumber}</b>? Stock is received and the challan can no longer be edited or deleted.</>, button: "Confirm", done: (d) => `Confirmed ${d.challanNumber}` })}><CheckCheck size={14} /> Confirm</button>}
      {confirmed && <button className="btn btn-primary" onClick={() => p.onCreateBill(doc.id)}><FileText size={14} /> Create Bill</button>}
    </>
  );

  return (
    <DocShell s={s} title="Purchase Challan" singular="Challan" branchName={p.branchName} fyCode={p.fyCode} statusOptions={OPTIONS}
      pill={doc && <Pill text={confirmed ? "CONFIRMED" : "DRAFT"} tone={confirmed ? "green" : "slate"} />} canEdit={!!doc && cfg.editable(doc)} canDelete={!!doc && cfg.deletable(doc)} actions={actions} help={HELP}
      notice={confirmed && <p className="mt-2 text-[12px] text-amber-800 bg-amber-50 border border-amber-300 px-2 py-1">A confirmed challan is final. To correct it, raise a corrected bill instead.</p>}
      listRow={(r) => (
        <>
          <div className="flex items-start justify-between gap-2"><span className="min-w-0 font-mono font-semibold break-words">{r.challanNumber}</span><Pill text={r.isConfirmed ? "CONFIRMED" : "DRAFT"} tone={r.isConfirmed ? "green" : "slate"} /></div>
          <div className="text-[12px] text-slate-600 break-words">{r.vendorName}{r.orderNumber ? ` · ${r.orderNumber}` : ""}</div>
          <div className="flex flex-wrap justify-between gap-x-2 text-[12px] text-slate-500"><span>{r.challanDate}</span><span className="tabular-nums whitespace-nowrap">{money(r.totalAmount)}</span></div>
        </>
      )}>
      {f && lk && (
        <div className="space-y-3 pt-2">
          <div className="grid min-w-0 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5 gap-x-3 gap-y-2">
            <Field label="Challan No"><input disabled className="fld bg-slate-100 text-slate-600" value={doc?.challanNumber ?? ""} placeholder="(next number)" aria-label="Challan number" /></Field>
            <DateField label="Challan Date" name="challanDate" value={f.challanDate} onChange={(v) => { s.patch({ challanDate: v }); s.clearError("challanDate"); }} calendar={p.calendar} readOnly={ro} error={s.err("challanDate")} required />
            <Field label="Against Order" className="col-span-1 sm:col-span-2" error={s.err("purchaseOrderId")}>
              <Combobox fieldName="purchaseOrderId" placeholder="Approved order (optional)" value={f.purchaseOrderId} hasError={!!s.err("purchaseOrderId")} options={orderOpts} disabled={ro} onChange={(v) => void pickOrder(v)} onCommit={(el, dir) => focusStep(el, dir)} />
            </Field>
            <VendorFields lookups={lk} contextKey={String(p.companyId)} vendorGLId={f.vendorGLId} subLedgerId={f.subLedgerId} agentId={f.agentId} readOnly={ro} errors={s.errors} lockVendor={!!f.purchaseOrderId}
              onChange={(c) => { s.patch(c); s.clearError("vendorGLId", "subLedgerId"); }} />
            <TextField label="Vendor Challan No" name="vendorChallanNo" value={f.vendorChallanNo} onChange={(v) => s.patch({ vendorChallanNo: v })} readOnly={ro} error={s.err("vendorChallanNo")} />
            <DateField label="Vendor Challan Date" name="vendorChallanDate" value={f.vendorChallanDate} onChange={(v) => { s.patch({ vendorChallanDate: v }); s.clearError("vendorChallanDate"); }} calendar={p.calendar} readOnly={ro} error={s.err("vendorChallanDate")} />
            <TextField label="Transporter" name="transporterName" value={f.transporterName} onChange={(v) => s.patch({ transporterName: v })} readOnly={ro} error={s.err("transporterName")} />
            <TextField label="Vehicle No" name="vehicleNo" value={f.vehicleNo} onChange={(v) => s.patch({ vehicleNo: v })} readOnly={ro} error={s.err("vehicleNo")} />
            <TextField label="LR No" name="lrNo" value={f.lrNo} onChange={(v) => s.patch({ lrNo: v })} readOnly={ro} error={s.err("lrNo")} />
            <DateField label="LR Date" name="lrDate" value={f.lrDate} onChange={(v) => { s.patch({ lrDate: v }); s.clearError("lrDate"); }} calendar={p.calendar} readOnly={ro} error={s.err("lrDate")} />
            <TextField label="Remarks" name="remarks" value={f.remarks} onChange={(v) => s.patch({ remarks: v })} readOnly={ro} max={1024} className="col-span-1 sm:col-span-2" error={s.err("remarks")} />
          </div>
          <h2 className="text-[13px] font-semibold">Lines received</h2>
          <LinesGrid kind="challan" lines={f.lines} onChange={(lines) => s.patch({ lines })} lookups={lk} products={products} readOnly={ro} errors={s.errors} calendar={p.calendar} clearError={s.clearError} contextKey={String(p.companyId)} lockProducts />
          {ro && doc && doc.lines.length > 0 && (
            <p className="text-[12px] text-slate-600">Billed so far: {doc.lines.map((l) => `line ${l.lineNumber}: ${l.billed} of ${l.qty}`).join(" · ")}</p>
          )}
          {doc && doc.bills.length > 0 && <p className="text-[12px] text-slate-600">Bills: {doc.bills.map((b: any) => `${b.invoiceNumber}${b.isPosted ? "" : " (draft)"}`).join(", ")}</p>}
        </div>
      )}
    </DocShell>
  );
}
