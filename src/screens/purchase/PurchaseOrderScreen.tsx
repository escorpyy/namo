import { useMemo, type MutableRefObject } from "react";
import { Check, Lock, Ban } from "lucide-react";
import type { PDoc } from "../../api";
import { COMMON_HELP, DocShell, Field, HINTS, Pill, money } from "../../components/purchase/Bits";
import { DateField, TextField, VendorFields } from "../../components/purchase/HeadFields";
import { LinesGrid, TermsGrid } from "../../components/purchase/LinesGrid";
import {
  blankLine, dateErr, defaultDate, isBlankLine, isBlankTerm, lineFromDoc, lineToPayload, str, termFromDoc, termToPayload, validateLines, validateTerms,
  type LineRow, type TermRow,
} from "../../lib/purchaseForm";
import type { StatusInfo } from "../../types";
import { useDocScreen, type DocConfig, type Errors } from "./useDocScreen";

export interface PurchaseScreenProps {
  companyId: number; branchId: number; userId: number; branchName: string; fyCode: string; calendar: "BS" | "AD";
  setStatus: (s: StatusInfo) => void; dirtyRef: MutableRefObject<boolean>; externalMessage: { text: string; n: number } | null;
}

interface OForm {
  orderDate: string; vendorGLId: string; subLedgerId: string; agentId: string; vendorRefNo: string; vendorRefDate: string; expectedDate: string; remarks: string;
  lines: LineRow[]; terms: TermRow[];
}
const STATUS_TONE: Record<string, "slate" | "green" | "amber" | "red"> = { DRAFT: "slate", APPROVED: "green", CLOSED: "amber", CANCELLED: "red" };
const OPTIONS = [{ value: "DRAFT", label: "Draft" }, { value: "APPROVED", label: "Approved" }, { value: "CLOSED", label: "Closed" }, { value: "CANCELLED", label: "Cancelled" }];
const HELP: [string, string][] = [...COMMON_HELP];

export default function PurchaseOrderScreen(p: PurchaseScreenProps) {
  const cfg = useMemo<DocConfig<OForm>>(() => ({
    kind: "orders", title: "Purchase Order", singular: "Order", statusOptions: OPTIONS,
    emptyForm: (lk) => ({
      orderDate: defaultDate(lk.fiscalYears.find((y) => y.code === p.fyCode)), vendorGLId: "", subLedgerId: "", agentId: "", vendorRefNo: "", vendorRefDate: "", expectedDate: "", remarks: "",
      lines: [blankLine()], terms: lk.terms.filter((t) => t.isMandatory && t.isActive && !t.isProductwise && t.category === "GENERAL").map((t) => ({ key: Math.random().toString(36).slice(2), termId: String(t.id), lineNumber: "", calcType: t.defaultCalcType, rate: t.defaultCalcType === "PERCENT" ? t.defaultValue.replace(/\.?0+$/, "") : "", inputAmount: t.defaultCalcType === "AMOUNT" ? t.defaultValue.replace(/\.?0+$/, "") : "", isOverridden: false, overrideAmount: "", finalAmount: "" })),
    }),
    toForm: (d: PDoc, lk) => {
      const prods = new Map(lk.products.map((x) => [String(x.id), x]));
      return {
        orderDate: str(d.orderDate), vendorGLId: str(d.vendorGLId), subLedgerId: str(d.subLedgerId), agentId: str(d.agentId), vendorRefNo: str(d.vendorRefNo), vendorRefDate: str(d.vendorRefDate),
        expectedDate: str(d.expectedDate), remarks: str(d.remarks),
        lines: d.lines.length ? d.lines.map((l) => lineFromDoc(l, prods.get(str(l.productId)))) : [blankLine()], terms: (d.terms ?? []).map(termFromDoc),
      };
    },
    toPayload: (f, doc) => {
      const prods = new Map(lookupsRef.current!.products.map((x) => [String(x.id), x]));
      const masters = new Map(lookupsRef.current!.terms.map((x) => [String(x.id), x]));
      return {
        orderDate: f.orderDate, vendorGLId: Number(f.vendorGLId), subLedgerId: f.subLedgerId ? Number(f.subLedgerId) : null, agentId: f.agentId ? Number(f.agentId) : null,
        vendorRefNo: f.vendorRefNo.trim() || null, vendorRefDate: f.vendorRefDate || null, expectedDate: f.expectedDate || null, remarks: f.remarks.trim() || null,
        ...(doc ? { orderNumber: doc.orderNumber } : {}),
        lines: f.lines.filter((l) => !isBlankLine(l)).map((l) => lineToPayload(l, prods.get(l.productId), "order")),
        terms: f.terms.filter((t) => !isBlankTerm(t)).map((t) => termToPayload(t, masters.get(t.termId))),
      };
    },
    validate: (f, lk) => {
      const e: Errors = {};
      const vendor = lk.vendors.find((v) => String(v.id) === f.vendorGLId);
      e.orderDate = dateErr("Order date", f.orderDate, true);
      if (!vendor) e.vendorGLId = "Pick the vendor.";
      else if (vendor.requiresSubLedger && !f.subLedgerId) e.subLedgerId = `${vendor.code} needs a sub ledger.`;
      e.vendorRefDate = dateErr("Vendor reference date", f.vendorRefDate);
      e.expectedDate = dateErr("Expected date", f.expectedDate);
      if (!e.orderDate && !e.expectedDate && f.expectedDate && f.expectedDate < f.orderDate) e.expectedDate = "Expected date is before the order date.";
      const prods = new Map(lk.products.map((x) => [String(x.id), x]));
      Object.assign(e, validateLines(f.lines, prods, { rate: "optional", tracking: false }), validateTerms(f.terms, new Map(lk.terms.map((x) => [String(x.id), x])), f.lines.filter((l) => !isBlankLine(l)).length));
      return e;
    },
    editable: (d) => d.status === "DRAFT", deletable: (d) => d.status === "DRAFT", label: (d) => d.orderNumber,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [p.fyCode]);
  const lookupsRef = useMemo(() => ({ current: null as ReturnType<typeof useDocScreen>["lookups"] }), []);

  const s = useDocScreen<OForm>(cfg, { companyId: p.companyId, branchId: p.branchId, fyCode: p.fyCode, userId: p.userId, calendar: p.calendar }, { setStatus: p.setStatus, dirtyRef: p.dirtyRef, externalMessage: p.externalMessage, hints: HINTS });
  lookupsRef.current = s.lookups;
  const f = s.form, lk = s.lookups, doc = s.doc, ro = s.readOnly;
  const products = useMemo(() => new Map((lk?.products ?? []).map((x) => [String(x.id), x])), [lk]);
  const masters = useMemo(() => new Map((lk?.terms ?? []).map((x) => [String(x.id), x])), [lk]);
  const status = doc?.status as string | undefined;

  const actions = doc && (
    <>
      {status === "DRAFT" && <button className="btn" onClick={() => s.run({ action: "approve", title: "Approve order?", body: <>Approve <b className="font-mono">{doc.orderNumber}</b>? It can no longer be edited, and challans and bills can be raised against it.</>, button: "Approve", done: (d) => `Approved ${d.orderNumber}` })}><Check size={14} /> Approve</button>}
      {status === "APPROVED" && <button className="btn" onClick={() => s.run({ action: "close", title: "Close order?", body: <>Close <b className="font-mono">{doc.orderNumber}</b>? Nothing more can be received or billed against it.</>, button: "Close order", done: (d) => `Closed ${d.orderNumber}` })}><Lock size={14} /> Close</button>}
      {(status === "DRAFT" || status === "APPROVED") && <button className="btn" onClick={() => s.run({ action: "cancel", title: "Cancel order?", body: <>Cancel <b className="font-mono">{doc.orderNumber}</b>? This cannot be undone.</>, button: "Cancel order", danger: true, done: (d) => `Cancelled ${d.orderNumber}` })}><Ban size={14} /> Cancel order</button>}
    </>
  );

  return (
    <DocShell s={s} title="Purchase Order" singular="Order" branchName={p.branchName} fyCode={p.fyCode} statusOptions={OPTIONS}
      pill={status && <Pill text={status} tone={STATUS_TONE[status]} />} canEdit={!!doc && cfg.editable(doc)} canDelete={!!doc && cfg.deletable(doc)} actions={actions} help={HELP}
      notice={doc && status !== "DRAFT" && <p className="mt-2 text-[12px] text-amber-800 bg-amber-50 border border-amber-300 px-2 py-1">{status === "APPROVED" ? "Approved orders cannot be edited." : `This order is ${status!.toLowerCase()}.`}</p>}
      listRow={(r) => (
        <>
          <div className="flex items-start justify-between gap-2"><span className="min-w-0 font-mono font-semibold break-words">{r.orderNumber}</span><Pill text={r.status} tone={STATUS_TONE[r.status]} /></div>
          <div className="text-[12px] text-slate-600 break-words">{r.vendorName}</div>
          <div className="flex flex-wrap justify-between gap-x-2 text-[12px] text-slate-500"><span>{r.orderDate}</span><span className="tabular-nums whitespace-nowrap">{money(r.totalAmount)}</span></div>
        </>
      )}>
      {f && lk && (
        <div className="space-y-3 pt-2">
          <div className="grid min-w-0 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5 gap-x-3 gap-y-2">
            <Field label="Order No"><input disabled className="fld bg-slate-100 text-slate-600" value={doc?.orderNumber ?? ""} placeholder="(next number)" aria-label="Order number" /></Field>
            <DateField label="Order Date" name="orderDate" value={f.orderDate} onChange={(v) => { s.patch({ orderDate: v }); s.clearError("orderDate"); }} calendar={p.calendar} readOnly={ro} error={s.err("orderDate")} required />
            <VendorFields lookups={lk} contextKey={String(p.companyId)} vendorGLId={f.vendorGLId} subLedgerId={f.subLedgerId} agentId={f.agentId} readOnly={ro} errors={s.errors}
              onChange={(c) => { s.patch(c); s.clearError("vendorGLId", "subLedgerId"); }} />
            <TextField label="Vendor Ref No" name="vendorRefNo" value={f.vendorRefNo} onChange={(v) => s.patch({ vendorRefNo: v })} readOnly={ro} error={s.err("vendorRefNo")} />
            <DateField label="Vendor Ref Date" name="vendorRefDate" value={f.vendorRefDate} onChange={(v) => { s.patch({ vendorRefDate: v }); s.clearError("vendorRefDate"); }} calendar={p.calendar} readOnly={ro} error={s.err("vendorRefDate")} />
            <DateField label="Expected By" name="expectedDate" value={f.expectedDate} onChange={(v) => { s.patch({ expectedDate: v }); s.clearError("expectedDate"); }} calendar={p.calendar} readOnly={ro} error={s.err("expectedDate")} />
            <TextField label="Remarks" name="remarks" value={f.remarks} onChange={(v) => s.patch({ remarks: v })} readOnly={ro} max={1024} className="col-span-1 sm:col-span-2 2xl:col-span-3" error={s.err("remarks")} />
          </div>
          <h2 className="text-[13px] font-semibold">Lines</h2>
          <LinesGrid kind="order" lines={f.lines} onChange={(lines) => s.patch({ lines })} lookups={lk} products={products} readOnly={ro} errors={s.errors} calendar={p.calendar} clearError={s.clearError} contextKey={String(p.companyId)} />
          {ro && doc && doc.lines.length > 0 && (
            <div className="overflow-x-auto rounded-sm border border-slate-300 bg-white/60" tabIndex={0} aria-label="Order line progress; scroll horizontally if needed">
              <div className="min-w-[760px]">
                <div className="grid grid-cols-[34px_minmax(220px,1fr)_110px_110px_110px_110px] gap-x-2 px-2 py-1 text-[11px] font-semibold text-slate-600 bg-slate-100 border-b border-slate-300"><span>#</span><span>Progress</span><span className="text-right">Ordered</span><span className="text-right">Received</span><span className="text-right">Billed</span><span className="text-right">Pending bill</span></div>
                {doc.lines.map((l) => (
                  <div key={l.id} className="grid grid-cols-[34px_minmax(220px,1fr)_110px_110px_110px_110px] gap-x-2 px-2 py-1 text-[12px] border-b border-slate-200 last:border-0">
                    <span className="text-slate-500">{l.lineNumber}</span><span className="break-words">{l.code} — {l.description}</span>
                    <span className="text-right tabular-nums whitespace-nowrap">{l.qty} {l.unitCode}</span><span className="text-right tabular-nums">{l.received}</span><span className="text-right tabular-nums">{l.billed}</span><span className="text-right tabular-nums">{l.pendingToBill}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <h2 className="text-[13px] font-semibold">Billing Terms</h2>
          <TermsGrid terms={f.terms} onChange={(terms) => s.patch({ terms })} lookups={lk} masters={masters} lineCount={f.lines.filter((l) => !isBlankLine(l)).length} readOnly={ro} errors={s.errors} clearError={s.clearError} contextKey={String(p.companyId)} category="GENERAL" />
          {doc && (
            <div className="flex flex-wrap justify-end gap-x-4 gap-y-1 text-[13px] border border-slate-400 bg-slate-50 px-3 py-1.5">
              <span>Basic <b className="tabular-nums ml-1">{money(doc.basicAmount)}</b></span><span>Terms <b className="tabular-nums ml-1">{money(doc.termAmount)}</b></span><span>Total <b className="tabular-nums ml-1">{money(doc.totalAmount)}</b></span>
            </div>
          )}
          {doc && ((doc.challans?.length ?? 0) > 0 || (doc.bills?.length ?? 0) > 0) && (
            <p className="text-[12px] text-slate-600">
              {doc.challans.length > 0 && <>Challans: {doc.challans.map((c: any) => `${c.challanNumber}${c.isConfirmed ? "" : " (draft)"}`).join(", ")}. </>}
              {doc.bills.length > 0 && <>Bills: {doc.bills.map((b: any) => `${b.invoiceNumber}${b.isPosted ? "" : " (draft)"}`).join(", ")}.</>}
            </p>
          )}
        </div>
      )}
    </DocShell>
  );
}
