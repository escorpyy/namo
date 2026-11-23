import { useEffect, useMemo, useRef } from "react";
import { CheckCheck, FileText } from "lucide-react";
import { salesChallanApi, type PDoc, type PLookups } from "../../api";
import type { EntryTabProps } from "../../components/purchase/DocWorkspace";
import { COMMON_HELP, DocShell, HINTS, Pill } from "../../components/purchase/Bits";
import { AgentCells, DateCell, FCell, FLabel, FormTable, RemarksTable, TextInput, VendorRow } from "../../components/purchase/BillTables";
import { LinesGrid } from "../../components/purchase/LinesGrid";
import { NumberField } from "../../components/purchase/NumberField";
import { blankLine, dateErr, defaultDate, isBlankLine, lineFromDoc, lineToPayload, str, validateLines, type LineRow } from "../../lib/purchaseForm";
import { useDocScreen, type DocApi, type DocConfig, type Errors } from "../purchase/useDocScreen";
import { toPLookups, type SalesScreenProps } from "./SalesInvoiceScreen";

export interface CForm {
  numberSeriesId: string; docNumber: string; challanDate: string; customerGLId: string; subLedgerId: string; agentId: string;
  transporterName: string; vehicleNo: string; lrNo: string; lrDate: string; remarks: string; lines: LineRow[];
}
export const CHALLAN_OPTIONS = [{ value: "DRAFT", label: "Draft" }, { value: "CONFIRMED", label: "Confirmed" }];
const HELP: [string, string][] = [
  ...COMMON_HELP.filter(([k]) => k !== "Alt+4"),
  ["Confirm (button)", "The goods leave: stock is taken out of the location and batch on each line. A confirmed challan is final."],
  ["Create Invoice (button)", "Opens a sales invoice for what is still unbilled on this challan; stock is not taken out a second time."],
];

export const salesChallanDocApi = (companyId: number, branchId: number, userId: number): DocApi => ({
  lookups: async () => toPLookups(await salesChallanApi.lookups({ companyId, branchId, userId })),
  list: (p) => salesChallanApi.list(p) as any,
  get: (id, c) => salesChallanApi.get(id, c) as unknown as Promise<PDoc>,
  create: (b) => salesChallanApi.create(b) as any,
  update: (id, c, b) => salesChallanApi.update(id, c, b) as any,
  remove: (id, c, u) => salesChallanApi.remove(id, c, u ?? userId),
  action: (id, c) => salesChallanApi.confirm(id, c, userId) as any,
});

// One Sales Challan tab of the challan workspace: the workspace owns the list, the lookups and the tab strip.
export default function SalesChallanEntry(p: SalesScreenProps & EntryTabProps<CForm, PLookups> & { onCreateInvoice: (challanId: number) => void }) {
  const api = useMemo(() => salesChallanDocApi(p.companyId, p.branchId, p.userId), [p.companyId, p.branchId, p.userId]);
  const lkRef = useMemo(() => ({ current: null as ReturnType<typeof useDocScreen>["lookups"] }), []);
  const cfg = useMemo<DocConfig<CForm>>(() => ({
    kind: "sales-invoice", api, title: "Sales Challan", singular: "Challan", statusOptions: CHALLAN_OPTIONS,
    emptyForm: (lk) => ({
      numberSeriesId: "", docNumber: "", challanDate: defaultDate(lk.fiscalYears.find((y) => y.code === p.fyCode)), customerGLId: "", subLedgerId: "", agentId: "",
      transporterName: "", vehicleNo: "", lrNo: "", lrDate: "", remarks: "", lines: [blankLine()],
    }),
    toForm: (d: PDoc, lk) => {
      const prods = new Map(lk.products.map((x) => [String(x.id), x]));
      return {
        numberSeriesId: str(d.numberSeriesId), docNumber: str(d.challanNumber), challanDate: str(d.challanDate), customerGLId: str(d.customerGLId), subLedgerId: str(d.subLedgerId), agentId: str(d.agentId),
        transporterName: str(d.transporterName), vehicleNo: str(d.vehicleNo), lrNo: str(d.lrNo), lrDate: str(d.lrDate), remarks: str(d.remarks),
        lines: d.lines.length ? d.lines.map((l) => lineFromDoc(l, prods.get(str(l.productId)))) : [blankLine()],
      };
    },
    toPayload: (f, doc) => {
      const prods = new Map(lkRef.current!.products.map((x) => [String(x.id), x]));
      return {
        challanDate: f.challanDate, fiscalYear: p.fyCode, customerGLId: Number(f.customerGLId), subLedgerId: f.subLedgerId ? Number(f.subLedgerId) : null, agentId: f.agentId ? Number(f.agentId) : null,
        transporterName: f.transporterName.trim() || null, vehicleNo: f.vehicleNo.trim() || null, lrNo: f.lrNo.trim() || null, lrDate: f.lrDate || null, remarks: f.remarks.trim() || null,
        ...(doc ? { challanNumber: doc.challanNumber, numberSeriesId: doc.numberSeriesId ?? null } : { challanNumber: f.docNumber.trim() || null, numberSeriesId: f.numberSeriesId ? Number(f.numberSeriesId) : null }),
        lines: f.lines.filter((l) => !isBlankLine(l)).map((l) => { const row = lineToPayload(l, prods.get(l.productId), "sales"); delete (row as any).challanLineId; return row; }),
      };
    },
    validate: (f, lk) => {
      const e: Errors = {};
      const customer = lk.vendors.find((v) => String(v.id) === f.customerGLId);
      e.challanDate = dateErr("Challan date", f.challanDate, true);
      if (!customer) e.customerGLId = "Pick the customer.";
      else if (customer.requiresSubLedger && !f.subLedgerId) e.subLedgerId = `${customer.code} needs a sub ledger.`;
      e.lrDate = dateErr("LR date", f.lrDate);
      const prods = new Map(lk.products.map((x) => [String(x.id), x]));
      Object.assign(e, validateLines(f.lines, prods, { rate: "optional", tracking: true }));
      if (!e.lines && f.lines.some((l) => l.productId && prods.get(l.productId)?.type !== "STOCK")) e.lines = "A challan carries stock items only.";
      return e;
    },
    editable: (d) => !d.isConfirmed, deletable: (d) => !d.isConfirmed, label: (d) => d.challanNumber,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [p.fyCode, api]);
  const restored = useRef(p.hookSnapRef.current);
  const localDirty = useRef(false);
  const s = useDocScreen<CForm>(cfg, { companyId: p.companyId, branchId: p.branchId, fyCode: p.fyCode, userId: p.userId, calendar: p.calendar }, {
    setStatus: p.setStatus, dirtyRef: localDirty, externalMessage: p.externalMessage, hints: HINTS,
    sharedLookups: p.lookups, skipList: true, initialDocId: p.docId, initialForm: p.initialForm, restore: restored.current, snapshotRef: p.hookSnapRef,
    onNew: () => p.onNew(), onDeleted: () => p.onClose(p.tabId), onListChanged: p.onListChanged,
  });
  lkRef.current = s.lookups;
  useEffect(() => { p.onMeta(p.tabId, { title: s.doc ? String(s.doc.challanNumber) : "New challan", dirty: s.dirty, docId: s.doc?.id ?? null }); }, [s.doc?.challanNumber, s.doc?.id, s.dirty, p.tabId]); // eslint-disable-line react-hooks/exhaustive-deps
  const f = s.form, lk = s.lookups, doc = s.doc, ro = s.readOnly;
  const products = useMemo(() => new Map((lk?.products ?? []).map((x) => [String(x.id), x])), [lk]);
  // a challan carries stock items only
  const stockLookups = useMemo(() => (lk ? { ...lk, products: lk.products.filter((x) => x.type === "STOCK") } : lk), [lk]);

  const confirmed = !!doc?.isConfirmed;
  const actions = doc && (
    <>
      {!confirmed && <button data-nav className="btn btn-primary" onClick={() => s.run({ action: "confirm", title: "Confirm challan?", body: <>Confirm <b className="font-mono">{doc.challanNumber}</b>? The goods leave stock and the challan can no longer be edited or deleted.</>, button: "Confirm", done: (d) => `Confirmed ${d.challanNumber}` })}><CheckCheck size={14} /> Confirm</button>}
      {confirmed && <button data-nav className="btn btn-primary" onClick={() => p.onCreateInvoice(doc.id)}><FileText size={14} /> Create Invoice</button>}
    </>
  );

  return (
    <DocShell s={s} title="Sales Challan" singular="Challan" number={doc ? String(doc.challanNumber) : undefined} branchName={p.branchName} fyCode={p.fyCode} statusOptions={CHALLAN_OPTIONS}
      pill={doc && <Pill text={confirmed ? "CONFIRMED" : "DRAFT"} tone={confirmed ? "green" : "slate"} />} canEdit={!!doc && cfg.editable(doc)} canDelete={!!doc && cfg.deletable(doc)} actions={actions} help={HELP}
      notice={confirmed && <p className="mt-2 text-[12px] text-amber-800 bg-amber-50 border border-amber-300 px-2 py-1">A confirmed challan is final: the goods have left. Bill it with an invoice.</p>}>
      {f && lk && stockLookups && (
        <div className="space-y-3 pt-2">
          <FormTable label="Challan header" pairs={5}>
            <tr>
              <FLabel>Challan No</FLabel>
              <FCell><NumberField bare label="Challan No" documentType="SALES_CHALLAN" companyId={p.companyId} branchId={p.branchId} fyCode={p.fyCode} userId={p.userId} existingNumber={doc ? String(doc.challanNumber) : undefined} readOnly={ro} seriesId={f.numberSeriesId} number={f.docNumber} onChange={(c) => s.patch(c)} /></FCell>
              <DateCell name="challanDate" label="Challan Date" value={f.challanDate} onChange={(v) => { s.patch({ challanDate: v }); s.clearError("challanDate"); }} calendar={p.calendar} readOnly={ro} error={s.err("challanDate")} />
              <FLabel>Transporter</FLabel>
              <FCell error={s.err("transporterName")}><TextInput name="transporterName" label="Transporter" value={f.transporterName} onChange={(v) => s.patch({ transporterName: v })} readOnly={ro} error={s.err("transporterName")} /></FCell>
              <FLabel>Vehicle No</FLabel>
              <FCell error={s.err("vehicleNo")}><TextInput name="vehicleNo" label="Vehicle No" value={f.vehicleNo} onChange={(v) => s.patch({ vehicleNo: v })} readOnly={ro} error={s.err("vehicleNo")} /></FCell>
            </tr>
            <VendorRow lk={lk} vendorGLId={f.customerGLId} subLedgerId={f.subLedgerId} readOnly={ro} err={(k) => s.err(k === "vendorGLId" ? "customerGLId" : k)} contextKey={String(p.companyId)} onChange={(c: any) => { const { vendorGLId, ...rest } = c; s.patch({ ...rest, ...(vendorGLId !== undefined ? { customerGLId: vendorGLId } : {}) }); s.clearError("customerGLId", "subLedgerId"); }} />
            <tr>
              <AgentCells lk={lk} agentId={f.agentId} readOnly={ro} err={s.err} contextKey={String(p.companyId)} onChange={(c) => s.patch(c)} />
              <FLabel>LR No</FLabel>
              <FCell error={s.err("lrNo")}><TextInput name="lrNo" label="LR No" value={f.lrNo} onChange={(v) => s.patch({ lrNo: v })} readOnly={ro} error={s.err("lrNo")} /></FCell>
              <DateCell name="lrDate" label="LR Date" value={f.lrDate} onChange={(v) => { s.patch({ lrDate: v }); s.clearError("lrDate"); }} calendar={p.calendar} readOnly={ro} error={s.err("lrDate")} />
            </tr>
          </FormTable>
          <h2 className="text-[13px] font-semibold">Goods delivered</h2>
          <LinesGrid kind="sales" lines={f.lines} onChange={(lines) => s.patch({ lines })} lookups={stockLookups} products={products} readOnly={ro} errors={s.errors} calendar={p.calendar} clearError={s.clearError} contextKey={String(p.companyId)} />
          <RemarksTable value={f.remarks} onChange={(v) => s.patch({ remarks: v })} readOnly={ro} companyId={p.companyId} error={s.err("remarks")} />
          {ro && doc && doc.lines.length > 0 && (
            <p className="text-[12px] text-slate-600">Billed so far: {doc.lines.map((l: any) => `line ${l.lineNumber}: ${Number(l.billedQty)} of ${Number(l.qty)}`).join(" · ")}</p>
          )}
        </div>
      )}
    </DocShell>
  );
}
