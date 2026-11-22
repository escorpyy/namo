import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, FileText, X } from "lucide-react";
import { purchaseApi, type PDoc, type PListRow, type PLookups } from "../../api";
import { formatImportCost } from "../../../shared/import-costing";
import { toMicro } from "../../../shared/purchase-calculation";
import { adToBs } from "../../lib/nepaliDate";
import { addDaysIso, isBlankTerm, type Term, type TermRow } from "../../lib/purchaseForm";
import { AdvanceBlock } from "../AdvanceBlock";
import { Combobox, type ComboOption } from "../Combobox";
import { DateInput } from "../DateInput";
import { NarrationInput } from "../NarrationInput";
import { Pill, focusStep, formEnterKey, money } from "./Bits";
import { AgentPicker, SubLedgerPicker, VendorPicker, useVendorOptions } from "./HeadFields";
import { NumberField } from "./NumberField";
import type { BForm } from "../../screens/purchase/PurchaseBillScreen";

// The purchase bill screen is laid out as tables: the header is a label | value grid, the import details are another, and the terms, the
// vendor's earlier bills and the linked service costs are small tables beside / under the lines. These are the pieces; the screen owns the state.

export const IMPORT_FIELDS: { key: string; label: string; short?: string; kind: "text" | "date" | "mode"; max?: number }[] = [
  { key: "customsDeclarationNo", label: "Customs Declaration No", kind: "text", max: 30 }, { key: "customsDeclarationDate", label: "Declaration Date", kind: "date" },
  { key: "customsOffice", label: "Customs Office", kind: "text", max: 100 }, { key: "countryOfOrigin", label: "Country of Origin", kind: "text", max: 50 },
  { key: "lcNo", label: "LC No", kind: "text", max: 30 }, { key: "lcDate", label: "LC Date", kind: "date" }, { key: "lcBankName", label: "LC Bank", kind: "text", max: 100 },
  { key: "transportMode", label: "Transport Mode", kind: "mode" }, { key: "blAwbNo", label: "BL / AWB No", kind: "text", max: 30 }, { key: "blAwbDate", label: "BL / AWB Date", kind: "date" },
  { key: "transporterName", label: "Transporter", kind: "text", max: 100 }, { key: "vehicleNo", label: "Vehicle No", kind: "text", max: 30 }, { key: "lrNo", label: "LR No", kind: "text", max: 30 }, { key: "lrDate", label: "LR Date", kind: "date" },
  { key: "importPermitNo", label: "Import Permit No", kind: "text", max: 30 }, { key: "importPermitDate", label: "Permit Date", kind: "date" },
  // Optional foreign currency: amounts on the bill stay in NPR; these record how they were converted.
  { key: "currencyCode", label: "Invoice Currency (optional, e.g. USD; blank = NPR)", short: "Foreign Currency", kind: "text", max: 3 }, { key: "exchangeRate", label: "Exchange Rate (NPR per 1 unit)", short: "Exchange Rate", kind: "text", max: 20 }, { key: "foreignInvoiceAmount", label: "Invoice Total in Foreign Currency", short: "Foreign Invoice Total", kind: "text", max: 20 },
];
export const PURCHASE_TYPES = [
  { value: "GOODS_PURCHASE_OTHERS", label: "Goods — Others" }, { value: "GOODS_PURCHASE_CAPITAL", label: "Goods — Capital" },
  { value: "SERVICE_PURCHASE_OTHERS", label: "Service — Others" }, { value: "SERVICE_PURCHASE_CAPITAL", label: "Service — Capital" },
];

const STATE_TONE: Record<string, "slate" | "green" | "amber" | "blue"> = { DRAFT: "slate", POSTED: "green", REVERSED: "amber", REVERSAL: "blue" };
type Errs = (key: string) => string | undefined;

// The outer card draws the frame, so the cells' own outer lines are dropped (they would double it).
const FRAME = "[&_tr>:first-child]:border-l-0 [&_tr>:last-child]:border-r-0 [&>tbody>tr:last-child>*]:border-b-0";
const NO_HOVER = "[&_tbody_tr:hover]:bg-transparent";
const shown = (v: string) => (v === "" ? "—" : v.startsWith("-") ? `− ${money(v.slice(1))}` : money(v));

// ---- label | value cells ----------------------------------------------------------------------------------------------------------

function FLabel({ children, required, title }: { children: ReactNode; required?: boolean; title?: string }) {
  return <th scope="row" title={title} className="bg-slate-50 text-left align-middle text-[12px] font-semibold leading-snug text-slate-600">{children}{required && <span className="text-rose-600"> *</span>}</th>;
}
// p-0: the input fills the cell, like a spreadsheet cell
function FCell({ children, error, colSpan, className = "" }: { children: ReactNode; error?: string; colSpan?: number; className?: string }) {
  return (
    <td colSpan={colSpan} className={`p-0 align-top ${className}`}>
      {children}
      {error && <p role="alert" className="px-2 pb-1 text-[11.5px] leading-tight text-rose-700">{error}</p>}
    </td>
  );
}
// a date field shows the same date in the other calendar under it: keep that hint off the cell edge
const DATE_CELL = "[&_span]:px-2";

function TextInput({ name, label, value, onChange, readOnly, error, max = 60 }: { name: string; label: string; value: string; onChange: (v: string) => void; readOnly: boolean; error?: string; max?: number }) {
  return <input data-field={name} aria-label={label} value={value} maxLength={max} autoComplete="off" disabled={readOnly} onChange={(e) => onChange(e.target.value)} onFocus={(e) => e.currentTarget.select()} className={`fld min-w-0 ${error ? "fld-err" : ""}`} />;
}
function SelectInput({ name, label, value, onChange, disabled, children }: { name: string; label: string; value: string; onChange: (v: string) => void; disabled: boolean; children: ReactNode }) {
  return <select data-field={name} aria-label={label} disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} className="fld">{children}</select>;
}
function DateCell({ name, label, value, onChange, calendar, readOnly, error, hint = true }: { name: string; label: string; value: string; onChange: (v: string) => void; calendar: "BS" | "AD"; readOnly: boolean; error?: string; hint?: boolean }) {
  return (
    <>
      <FLabel>{label} ({calendar})</FLabel>
      <FCell error={error} className={hint ? DATE_CELL : "[&_span]:hidden"}><DateInput fieldName={name} value={value} onChange={onChange} calendar={calendar} hasError={!!error} onBlurField={() => {}} disabled={readOnly} /></FCell>
    </>
  );
}

// Four label | value pairs (the bill header uses five). Rows that need fewer pairs fill the rest with a quiet cell.
function FormTable({ label, children, className = "", pairs = 4 }: { label: string; children: ReactNode; className?: string; pairs?: number }) {
  return (
    <div className={`lg-grid min-w-0 border border-slate-200 bg-white [&_.fld:disabled]:text-slate-700 [&_select:disabled]:[-webkit-text-fill-color:#334155] ${className}`}>
      <table aria-label={label} className={`xl-table ${pairs >= 5 ? "min-w-[1180px]" : pairs > 1 ? "min-w-[960px]" : ""} table-fixed ${FRAME} ${NO_HOVER}`}>
        <colgroup>{Array.from({ length: pairs }, (_, i) => i).map((i) => <Fragment key={i}><col style={{ width: "128px" }} /><col /></Fragment>)}</colgroup>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
const Filler = ({ pairs }: { pairs: number }) => (pairs > 0 ? <td colSpan={pairs * 2} className="bg-slate-50" /> : null);

// ---- the header -------------------------------------------------------------------------------------------------------------------

export interface BillHeaderProps {
  f: BForm; lk: PLookups; doc: PDoc | null; readOnly: boolean;
  companyId: number; branchId: number; fyCode: string; userId: number; calendar: "BS" | "AD";
  err: Errs;
  patch: (change: Partial<BForm>) => void;
  clearError: (...keys: string[]) => void;
  /** goods bills a service bill can be linked to as a cost (already labelled) and the bills they come from */
  costTargets: ComboOption[]; mains: PListRow[];
  onInvoiceType: (type: BForm["invoiceType"]) => void;
  /** confirmed challans a new goods bill can start from, and what happens when one is picked ("" = cleared) */
  challanOptions: ComboOption[]; onPickChallan: (id: string) => void;
  /** an earlier bill of this vendor with the same vendor invoice number */
  duplicate?: PListRow;
}

export function BillHeaderTable(p: BillHeaderProps) {
  const { f, lk, doc, readOnly: ro, err, patch, clearError, calendar: cal } = p;
  const ctx = String(p.companyId);
  const { vendor, vendors, subs, agents } = useVendorOptions(lk, f.vendorGLId);
  const service = f.purchaseType.startsWith("SERVICE_PURCHASE_");
  const noCost = ro || !f.importCostForBillId;
  const links = [f.challanNo && `Challan ${f.challanNo}`, f.orderNo && `Order ${f.orderNo}`].filter(Boolean).join(" · ");
  return (
    <FormTable label="Bill header" pairs={5}>
      <tr>
        <FLabel title="A confirmed challan fills the vendor and the lines">Challan</FLabel>
        <FCell error={err("purchaseChallanId")}>
          {ro || doc || service
            ? <input disabled className="fld" value={links} placeholder="—" aria-label="Linked documents" />
            : <Combobox fieldName="purchaseChallanId" placeholder="— (none)" value={f.purchaseChallanId} hasError={!!err("purchaseChallanId")} options={p.challanOptions} allowClear
                onChange={(value) => p.onPickChallan(value)} onCommit={(el, dir) => focusStep(el, dir)} />}
        </FCell>
        <FLabel>Invoice No</FLabel>
        <FCell><NumberField bare label="Invoice No" documentType="PURCHASE_BILL" companyId={p.companyId} branchId={p.branchId} fyCode={p.fyCode} userId={p.userId} existingNumber={doc ? String(doc.invoiceNumber) : undefined} readOnly={ro} seriesId={f.numberSeriesId} number={f.docNumber} onChange={(c) => patch(c)} /></FCell>
        <FLabel required>Invoice Date ({cal})</FLabel>
        <FCell error={err("invoiceDate")} className={DATE_CELL}>
          <DateInput fieldName="invoiceDate" value={f.invoiceDate} calendar={cal} hasError={!!err("invoiceDate")} onBlurField={() => {}} disabled={ro} onChange={(v) => {
            // with due days entered, the due date follows the invoice date
            const due = f.dueDays ? addDaysIso(v, Number(f.dueDays)) : "";
            patch(due ? { invoiceDate: v, dueDate: due } : { invoiceDate: v });
            clearError("invoiceDate");
          }} />
        </FCell>
        <FLabel>Vendor Invoice No</FLabel>
        <FCell error={err("vendorInvoiceNo")}><TextInput name="vendorInvoiceNo" label="Vendor Invoice No" value={f.vendorInvoiceNo} onChange={(v) => patch({ vendorInvoiceNo: v })} readOnly={ro} error={err("vendorInvoiceNo")} max={30} /></FCell>
        <DateCell name="vendorInvoiceDate" label="Vendor Invoice Date" value={f.vendorInvoiceDate} onChange={(v) => { patch({ vendorInvoiceDate: v }); clearError("vendorInvoiceDate"); }} calendar={cal} readOnly={ro} error={err("vendorInvoiceDate")} />
      </tr>
      <tr>
        <FLabel required>Vendor</FLabel>
        <FCell colSpan={3} error={err("vendorGLId")}>
          <VendorPicker vendors={vendors} vendorGLId={f.vendorGLId} readOnly={ro} error={err("vendorGLId")} lockVendor={!!f.purchaseChallanId} contextKey={ctx}
            onChange={(c) => {
              // a new vendor brings its payment term days, unless due days are already filled
              const days = c.vendorGLId && c.vendorGLId !== f.vendorGLId && !f.dueDays ? lk.vendors.find((v) => String(v.id) === c.vendorGLId)?.paymentTermDays : null;
              patch(days ? { ...c, dueDays: String(days), dueDate: f.invoiceDate ? addDaysIso(f.invoiceDate, days) : f.dueDate } : c);
              clearError("vendorGLId", "subLedgerId");
            }} />
        </FCell>
        <FLabel required={!!vendor?.requiresSubLedger}>{vendor?.requiresSubLedger ? "Sub Ledger" : "Sub Ledger (not needed)"}</FLabel>
        <FCell colSpan={5} error={err("subLedgerId")}><SubLedgerPicker subs={subs} requiresSubLedger={!!vendor?.requiresSubLedger} vendorGLId={f.vendorGLId} subLedgerId={f.subLedgerId} readOnly={ro} error={err("subLedgerId")} contextKey={ctx} onChange={(c) => patch(c)} /></FCell>
      </tr>
      <tr>
        <FLabel>Agent</FLabel>
        <FCell error={err("agentId")}><AgentPicker agents={agents} agentId={f.agentId} readOnly={ro} error={err("agentId")} contextKey={ctx} onChange={(c) => patch(c)} /></FCell>
        <FLabel>Invoice Type</FLabel>
        <FCell><SelectInput name="invoiceType" label="Invoice Type" disabled={ro} value={f.invoiceType} onChange={(v) => { patch({ invoiceType: v as BForm["invoiceType"] }); p.onInvoiceType(v as BForm["invoiceType"]); }}><option value="LOCAL">Local</option><option value="IMPORT">Import</option></SelectInput></FCell>
        <FLabel>Purchase Type</FLabel>
        <FCell><SelectInput name="purchaseType" label="Purchase Type" disabled={ro} value={f.purchaseType} onChange={(purchaseType) => { patch({ purchaseType, importCostForBillId: purchaseType.startsWith("SERVICE_PURCHASE_") ? f.importCostForBillId : "" }); clearError("importCostForBillId"); }}>{PURCHASE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</SelectInput></FCell>
        <FLabel>Due Days</FLabel>
        <FCell error={err("dueDays")}>
          <TextInput name="dueDays" label="Due Days" value={f.dueDays} readOnly={ro} error={err("dueDays")} max={4} onChange={(v) => {
            if (!/^\d{0,4}$/.test(v)) return;
            // typing the days sets the due date from the invoice date; a due date typed afterwards still wins
            const due = v ? addDaysIso(f.invoiceDate, Number(v)) : "";
            patch(due ? { dueDays: v, dueDate: due } : { dueDays: v });
            if (due) clearError("dueDate");
          }} />
        </FCell>
        <DateCell name="dueDate" label="Due Date" value={f.dueDate} onChange={(v) => { patch({ dueDate: v }); clearError("dueDate"); }} calendar={cal} readOnly={ro} error={err("dueDate")} />
      </tr>
      {p.duplicate && (
        <tr>
          <td colSpan={10} role="alert" className="bg-amber-50 text-left text-[12px] text-amber-900">
            Vendor invoice <b>{f.vendorInvoiceNo.trim()}</b> is already on bill <b className="font-mono">{p.duplicate.invoiceNumber}</b>. A repeated vendor invoice number is refused on save.
          </td>
        </tr>
      )}
      {service && (
        <tr>
          <FLabel>Cost of goods bill</FLabel>
          <FCell error={err("importCostForBillId")}>
            <Combobox fieldName="importCostForBillId" placeholder="— (not linked: stays an expense)" value={f.importCostForBillId} hasError={!!err("importCostForBillId")} options={p.costTargets} disabled={ro} allowClear
              onChange={(value) => {
                const target = p.mains.find((x) => String(x.id) === value);
                patch({ importCostForBillId: value, ...(value && target && target.invoiceType !== "IMPORT" ? { importCostTreatment: "LANDED_ONLY" as const } : {}) });
                clearError("importCostForBillId");
              }} onCommit={(el, dir) => focusStep(el, dir)} />
          </FCell>
          <FLabel>Source allocation basis</FLabel>
          <FCell><SelectInput name="importCostAllocationBasis" label="Source allocation basis" disabled={noCost} value={f.importCostAllocationBasis} onChange={(v) => patch({ importCostAllocationBasis: v as BForm["importCostAllocationBasis"] })}><option value="VALUE">By goods value</option><option value="QUANTITY">By quantity</option></SelectInput></FCell>
          <FLabel>Cost treatment</FLabel>
          <FCell><SelectInput name="importCostTreatment" label="Cost treatment" disabled={noCost} value={f.importCostTreatment} onChange={(v) => patch({ importCostTreatment: v as BForm["importCostTreatment"] })}><option value="CIF">CIF input (pre-customs)</option><option value="LANDED_ONLY">Landed only (post-CIF)</option></SelectInput></FCell>
          <Filler pairs={2} />
        </tr>
      )}
    </FormTable>
  );
}

/** Remarks: a one-row table that sits right under the lines grid. */
export function BillRemarksTable({ f, readOnly: ro, companyId, err, patch }: { f: BForm; readOnly: boolean; companyId: number; err: (k: string) => string | undefined; patch: (c: Partial<BForm>) => void }) {
  return (
    <FormTable label="Remarks" pairs={1}>
      <tr>
        <FLabel>Remarks</FLabel>
        <FCell error={err("remarks")}>
          <NarrationInput multiline rows={1} companyId={companyId} data-field="remarks" maxLength={1024} disabled={ro} value={f.remarks} onText={(v) => patch({ remarks: v })}
            placeholder="Optional note for this bill…" className={`fld min-h-8 resize-y py-1.5 ${err("remarks") ? "fld-err" : ""}`} aria-label="Remarks" />
        </FCell>
      </tr>
    </FormTable>
  );
}

// ---- import details (customs, LC, transport, foreign currency) --------------------------------------------------------------------

export const importFilled = (imp: Record<string, string>) => Object.values(imp).filter((v) => String(v ?? "").trim() !== "").length;
const MODE_LABEL: Record<string, string> = { ROAD: "Road", AIR: "Air", RAIL: "Rail", OTHER: "Other" };

// Import details are a button in the flow before the lines, not a table on the screen: hover shows what is entered, click opens the dialog to view / edit / save.
// For an import bill, moving on from the completed header lands on the button and `autoOpen` opens the dialog once.
export function ImportDetailsButton({ imp, readOnly, autoOpen, onOpen }: { imp: Record<string, string>; readOnly: boolean; autoOpen: boolean; onOpen: (auto: boolean) => void }) {
  const filled = importFilled(imp);
  const needsDeclaration = !readOnly && !String(imp.customsDeclarationNo ?? "").trim();
  const rows = IMPORT_FIELDS.filter((k) => String(imp[k.key] ?? "").trim() !== "");
  return (
    <div className="group relative inline-block shrink-0">
      <button type="button" data-nav="import-details" aria-haspopup="dialog" className="btn" onClick={() => onOpen(false)} onFocus={() => { if (autoOpen) onOpen(true); }}>
        <FileText size={14} /> Import details
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11.5px] font-medium text-slate-600">{filled ? `${filled} filled` : "not entered"}</span>
        {needsDeclaration && <span className="text-[12px] font-normal text-amber-800">customs declaration no. needed to post</span>}
      </button>
      {filled > 0 && (
        <div role="tooltip" className="invisible absolute left-0 top-full z-30 mt-1 w-[min(560px,90vw)] border border-slate-300 bg-white shadow-lg group-hover:visible">
          <table aria-label="Import details entered" className="xl-table table-fixed [&_tr>:first-child]:border-l-0 [&_tr>:last-child]:border-r-0 [&>tbody>tr:last-child>*]:border-b-0">
            <colgroup><col style={{ width: "42%" }} /><col /></colgroup>
            <tbody>
              {rows.map((k) => (
                <tr key={k.key}>
                  <th scope="row" className="bg-slate-50 text-left text-[12px] font-semibold text-slate-600">{k.short ?? k.label}</th>
                  <td className="truncate text-left">{k.kind === "mode" ? MODE_LABEL[imp[k.key]] ?? imp[k.key] : imp[k.key]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-2 py-1 text-[11.5px] text-slate-500">{readOnly ? "Click to view" : "Click to edit"}</p>
        </div>
      )}
    </div>
  );
}

// The details are edited on a draft; Save puts it on the bill, Cancel / Esc leaves the bill as it was.
export function ImportDetailsDialog({ imp, readOnly: ro, calendar, err, onSave, onClose }: {
  imp: Record<string, string>; readOnly: boolean; calendar: "BS" | "AD"; err: Errs; onSave: (imp: Record<string, string>) => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>(imp);
  const changed = JSON.stringify(draft) !== JSON.stringify(imp);
  const set = (key: string, v: string) => setDraft((d) => ({ ...d, [key]: v }));
  useEffect(() => {
    const t = window.setTimeout(() => (document.querySelector<HTMLElement>("[data-import-dialog] [data-field]:not(:disabled)") ?? document.querySelector<HTMLElement>("[data-import-dialog] button"))?.focus(), 40);
    return () => window.clearTimeout(t);
  }, []);
  const rows: (typeof IMPORT_FIELDS)[] = [];
  for (let i = 0; i < IMPORT_FIELDS.length; i += 4) rows.push(IMPORT_FIELDS.slice(i, i + 4));
  const fx = Number(draft.exchangeRate) > 0 && Number(draft.foreignInvoiceAmount) > 0;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-3" onMouseDown={(e) => { if (e.target === e.currentTarget && !changed) onClose(); }}>
      <div data-import-dialog data-purchase-document role="dialog" aria-modal="true" aria-labelledby="import-dialog-title" className="ledger flex max-h-[92vh] w-[min(1100px,96vw)] flex-col border border-slate-500 bg-white shadow-xl"
        onKeyDown={(e) => {
          if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); return; }
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); e.stopPropagation(); if (!ro) onSave(draft); return; }
          if (e.key === "Tab") {
            const all = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("input, select, textarea, button")).filter((x) => !(x as HTMLInputElement).disabled && x.getClientRects().length > 0);
            const first = all[0], last = all[all.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
            return;
          }
          formEnterKey(e);
        }}>
        <header className="flex items-center gap-3 border-b border-slate-300 px-4 py-2.5">
          <h2 id="import-dialog-title" className="text-[15px] font-semibold text-ink">Import details</h2>
          <span className="text-[12px] text-slate-500">{ro ? "View only" : "Customs declaration number is needed to post an import bill; the rest is optional."}</span>
          <span className="flex-1" />
          <button type="button" className="btn !h-7 !px-2" aria-label="Close" onClick={onClose}><X size={14} /></button>
        </header>
        <div className="lg-scroll min-h-0 overflow-auto p-3">
          {fx && <p className="mb-2 text-[12px] text-slate-600">{(draft.currencyCode ?? "").toUpperCase()} {draft.foreignInvoiceAmount} × {draft.exchangeRate} = NPR <b>{(Math.round(Number(draft.foreignInvoiceAmount) * Number(draft.exchangeRate) * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}</b>. Enter line rates in NPR (foreign rate × exchange rate).</p>}
          <div className="lg-grid min-w-0 border border-slate-200 bg-white [&_.fld:disabled]:text-slate-700 [&_select:disabled]:[-webkit-text-fill-color:#334155]">
            <table aria-label="Import details" className={`xl-table min-w-[860px] table-fixed ${FRAME} ${NO_HOVER}`}>
              <colgroup>{[0, 1, 2, 3].map((i) => <Fragment key={i}><col style={{ width: "128px" }} /><col /></Fragment>)}</colgroup>
              <tbody>
                {rows.map((chunk, r) => (
                  <tr key={r}>
                    {chunk.map((k) => {
                      const name = `imp.${k.key}`, value = draft[k.key] ?? "";
                      return k.kind === "date"
                        ? <DateCell key={k.key} name={name} label={k.label} value={value} onChange={(v) => set(k.key, v)} calendar={calendar} readOnly={ro} error={err(name)} hint={false} />
                        : (
                          <Fragment key={k.key}>
                            <FLabel title={k.label}>{k.short ?? k.label}</FLabel>
                            <FCell error={err(name)}>
                              {k.kind === "mode"
                                ? <SelectInput name={name} label={k.label} disabled={ro} value={value} onChange={(v) => set(k.key, v)}><option value="">—</option><option value="ROAD">Road</option><option value="AIR">Air</option><option value="RAIL">Rail</option><option value="OTHER">Other</option></SelectInput>
                                : <TextInput name={name} label={k.label} value={value} onChange={(v) => set(k.key, v)} readOnly={ro} max={k.max ?? 60} error={err(name)} />}
                            </FCell>
                          </Fragment>
                        );
                    })}
                    <Filler pairs={4 - chunk.length} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <footer className="flex items-center justify-end gap-2 border-t border-slate-300 px-4 py-2.5">
          {ro
            ? <button type="button" className="btn" onClick={onClose}>Close <span className="kbd">Esc</span></button>
            : (
              <>
                <button type="button" className="btn btn-primary" onClick={() => onSave(draft)}>Save <span className="kbd">Ctrl+S</span></button>
                <button type="button" className="btn" onClick={onClose}>Cancel <span className="kbd">Esc</span></button>
              </>
            )}
        </footer>
      </div>
    </div>
  );
}

// ---- header terms -----------------------------------------------------------------------------------------------------------------

// What the bill's document-wise terms come to. They are entered in the "Assess terms" dialog (Apply keeps only those with a value); this is the result.
export function HeaderTermsTable({ terms, masters, signedOf, total, readOnly, error, onOpen }: {
  terms: TermRow[]; masters: Map<string, Term>; signedOf: (t: TermRow) => string; total: string; readOnly: boolean; error?: string; onOpen: () => void;
}) {
  const rows = terms.filter((t) => !isBlankTerm(t) && !masters.get(t.termId)?.isProductwise);
  return (
    <section className="lg-card flex min-w-0 flex-col" aria-label="Header terms and conditions">
      <header className="lg-card-head !min-h-[36px] !py-1">
        <h2 className="lg-card-title">Header terms and conditions</h2>
        <span className="flex-1" />
        <button type="button" data-nav="header-terms" className="btn !h-7" onClick={onOpen}>{readOnly ? "View terms" : "Assess terms"}</button>
      </header>
      <div className="lg-scroll max-h-[170px] overflow-auto">
        <table className={`xl-table xl-sticky table-fixed ${FRAME}`}>
          <colgroup><col style={{ width: "34px" }} /><col /><col style={{ width: "92px" }} /><col style={{ width: "100px" }} /><col style={{ width: "112px" }} /></colgroup>
          <thead><tr><th className="xl-rowhead">#</th><th className="text-left">Term</th><th className="text-right">Value</th><th className="text-right">Own amount</th><th className="text-right">Amount</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5} className="text-left text-slate-500">No header terms{readOnly ? "." : " — Assess terms adds VAT, discount, freight and the like."}</td></tr>}
            {rows.map((t, i) => {
              const m = masters.get(t.termId);
              const auto = m?.category === "ROUNDED";
              const value = auto ? "Auto" : t.calcType === "PERCENT" ? (t.rate ? `${t.rate} %` : "") : (t.inputAmount ? money(t.inputAmount) : "");
              return (
                <tr key={t.key}>
                  <td className="xl-rowhead">{i + 1}</td>
                  <td className="truncate text-left" title={m ? `${m.code} — ${m.name}` : undefined}>{m ? `${m.code} — ${m.name}` : t.termId}</td>
                  <td className="text-right tabular-nums">{value || "—"}</td>
                  <td className="text-right tabular-nums">{t.isOverridden && t.overrideAmount ? money(t.overrideAmount) : "—"}</td>
                  <td className="text-right font-medium tabular-nums">{shown(signedOf(t))}</td>
                </tr>
              );
            })}
            {error && <tr><td colSpan={5} role="alert" className="text-left text-[12px] text-rose-700">{error}</td></tr>}
          </tbody>
          <tfoot><tr><td colSpan={4} className="text-right">Net terms</td><td className="text-right tabular-nums">{shown(total) === "—" ? "0.00" : shown(total)}</td></tr></tfoot>
        </table>
      </div>
    </section>
  );
}

// ---- the vendor's earlier bills ---------------------------------------------------------------------------------------------------

// The vendor's other bills, newest first, and which of them (if any) already carries the vendor invoice number that was typed.
export function useVendorBills(companyId: number, branchId: number, vendorGLId: string, docId: number | undefined, vendorInvoiceNo: string) {
  const [bills, setBills] = useState<PListRow[] | null>(null);
  useEffect(() => {
    if (!vendorGLId) { setBills(null); return; }
    let live = true;
    setBills(null);
    purchaseApi.list("bills", { companyId, branchId, fiscalYear: "", vendorGLId: Number(vendorGLId) }).then((r) => { if (live) setBills(r.rows); }).catch(() => { if (live) setBills([]); });
    return () => { live = false; };
  }, [companyId, branchId, vendorGLId, docId]);
  const others = useMemo(() => (bills ?? []).filter((b) => b.id !== docId).sort((a, b) => String(b.invoiceDate).localeCompare(String(a.invoiceDate)) || b.id - a.id), [bills, docId]);
  const typed = vendorInvoiceNo.trim().toLowerCase();
  const duplicate = typed ? others.find((b) => String(b.vendorInvoiceNo ?? "").trim().toLowerCase() === typed) : undefined;
  return { bills, others, duplicate };
}

export function VendorBillsTable({ lookups, vendorGLId, vendorBills, doc, companyId, userId, calendar }: {
  lookups: PLookups; vendorGLId: string; vendorBills: ReturnType<typeof useVendorBills>; doc: PDoc | null; companyId: number; userId?: number; calendar: "BS" | "AD";
}) {
  const vendor = lookups.vendors.find((v) => String(v.id) === vendorGLId);
  const { bills, others } = vendorBills;
  const date = (v: unknown) => { const s = String(v ?? "").slice(0, 10); return calendar === "BS" ? (adToBs(s) ?? s) : s; };
  return (
    <section className="lg-card flex min-w-0 flex-col" aria-label="Vendor">
      <header className="lg-card-head !min-h-[36px] !py-1">
        <h2 className="min-w-0 truncate lg-card-title" title={vendor?.name}>Recent bills{vendor ? ` — ${vendor.name}` : ""}</h2>
      </header>
      <div className="lg-scroll max-h-[170px] overflow-auto">
        <table className={`xl-table xl-sticky table-fixed ${FRAME}`}>
          <colgroup><col /><col style={{ width: "92px" }} /><col style={{ width: "78px" }} /><col style={{ width: "104px" }} /></colgroup>
          <thead><tr><th className="text-left">Invoice</th><th className="text-right">Date</th><th className="text-left">Status</th><th className="text-right">Amount</th></tr></thead>
          <tbody>
            {!vendorGLId ? <tr><td colSpan={4} className="text-left text-slate-500">Pick a vendor to see its bills.</td></tr>
              : bills === null ? <tr><td colSpan={4} className="text-left text-slate-500">Loading…</td></tr>
              : others.length === 0 ? <tr><td colSpan={4} className="text-left text-slate-500">No earlier bills.</td></tr>
              : others.slice(0, 8).map((b) => (
                <tr key={b.id}>
                  <td className="truncate text-left font-mono text-[12.5px] font-semibold text-cobalt-800">{b.invoiceNumber}</td>
                  <td className="text-right tabular-nums">{date(b.invoiceDate)}</td>
                  <td className="text-left"><Pill text={String(b.state ?? "")} tone={STATE_TONE[String(b.state)]} /></td>
                  <td className="text-right font-medium tabular-nums">{money(b.totalAmount)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {vendorGLId && userId !== undefined && (
        <AdvanceBlock companyId={companyId} userId={userId} kind="PURCHASE_BILL" generalLedgerId={Number(vendorGLId)} doc={doc ? { id: doc.id, number: String(doc.invoiceNumber), state: String(doc.state), fiscalYear: String(doc.fiscalYear) } : null} fiscalYears={lookups.fiscalYears} calendar={calendar} />
      )}
    </section>
  );
}

// ---- service costs linked to a goods bill ------------------------------------------------------------------------------------------

export function LinkedCostsTable({ doc, open, onToggle }: { doc: PDoc; open: boolean; onToggle: () => void }) {
  const sources: any[] = doc.importCostSources ?? [];
  const included = sources.filter((source) => source.includedInCIF);
  const sum = (treatment: string) => included.filter((source) => source.importCostTreatment === treatment).reduce((total: bigint, source) => total + toMicro(source.basicAmount), 0n);
  const cifSourceAmount = sum("CIF"), landedOnlyAmount = sum("LANDED_ONLY");
  const cifTotal = doc.invoiceType === "IMPORT" ? formatImportCost(toMicro(doc.basicAmount) + cifSourceAmount, 2) : null;
  return (
    <section className="lg-card min-w-0 border-sky-200 bg-sky-50/50">
      <div className="lg-scroll max-h-[240px] overflow-auto">
        <table aria-label="Linked service costs and landed value" className={`xl-table min-w-[860px] table-fixed ${FRAME} ${NO_HOVER}`}>
          <colgroup><col /><col /><col /><col /><col /><col /><col /><col /></colgroup>
          <thead>
            <tr>
              <th colSpan={8} className="p-0 text-left">
                <button type="button" className="flex min-h-[34px] w-full items-center gap-2 px-3 py-1 text-left hover:bg-sky-100/60" onClick={onToggle} aria-expanded={open}>
                  {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <span className="text-[13px] font-semibold text-ink">Linked service costs and landed value</span>
                  <span className="text-[12px] font-normal text-slate-500">{sources.length ? `${sources.length} linked` : "No service invoices linked yet"}</span>
                </button>
              </th>
            </tr>
          </thead>
          {open && (
            <tbody>
              <tr><td colSpan={8} className="bg-white/60 text-left text-[12px] text-slate-700">Only posted, unreversed service bills are included. Tax-exclusive basic amount is allocated; the service bill&apos;s tax stays on its own term. CIF = before customs; Landed only = after CIF.</td></tr>
              <tr>
                <th scope="row" className="bg-slate-50 text-left text-[12px] font-semibold text-slate-600">Goods basic</th><td className="text-right font-semibold tabular-nums">{money(doc.basicAmount)}</td>
                <th scope="row" className="bg-slate-50 text-left text-[12px] font-semibold text-slate-600">CIF service costs</th><td className="text-right font-semibold tabular-nums">{money(formatImportCost(cifSourceAmount, 2))}</td>
                <th scope="row" className="bg-slate-50 text-left text-[12px] font-semibold text-slate-600">Landed-only costs</th><td className="text-right font-semibold tabular-nums">{money(formatImportCost(landedOnlyAmount, 2))}</td>
                <th scope="row" className="bg-slate-50 text-left text-[12px] font-semibold text-slate-600">CIF base</th><td className="text-right font-semibold tabular-nums">{money(cifTotal ?? "0")}</td>
              </tr>
              {sources.length === 0
                ? <tr><td colSpan={8} className="text-left text-slate-600">No service purchase invoices are linked yet.</td></tr>
                : (
                  <>
                    <tr className="bg-slate-50 text-[12px] font-semibold text-slate-600">
                      <td colSpan={2} className="text-left">Service invoice</td><td colSpan={2} className="text-left">Vendor</td><td className="text-left">Source basis</td><td className="text-left">Treatment</td><td className="text-right">Basic amount</td><td className="text-left">Cost status</td>
                    </tr>
                    {sources.map((source) => (
                      <tr key={source.id}>
                        <td colSpan={2} className="truncate text-left font-mono">{source.invoiceNumber}{source.vendorInvoiceNo ? ` · ${source.vendorInvoiceNo}` : ""}</td>
                        <td colSpan={2} className="truncate text-left">{source.vendorName}</td>
                        <td className="text-left">{source.importCostAllocationBasis === "QUANTITY" ? "Quantity" : "Goods value"}</td>
                        <td className="text-left">{source.importCostTreatment === "LANDED_ONLY" ? "Landed only" : "CIF"}</td>
                        <td className="text-right tabular-nums">{money(source.basicAmount)}</td>
                        <td className="text-left">{source.includedInCIF ? "Included" : String(source.state).toLowerCase()}</td>
                      </tr>
                    ))}
                  </>
                )}
            </tbody>
          )}
        </table>
      </div>
    </section>
  );
}
