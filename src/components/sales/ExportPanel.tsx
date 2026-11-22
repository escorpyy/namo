import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Field } from "../purchase/Bits";
import { DateField, TextField } from "../purchase/HeadFields";

// The extra fields of an export invoice (Tax Invoice - Export). Everything is optional except the exchange rate when the invoice is in a
// foreign currency. The server checks and stores them; the panel is collapsed until the person opens it.
export type ExportValues = Record<string, string>;
type FieldDef = { key: string; label: string; kind?: "text" | "date" | "num" | "mode"; max?: number; wide?: boolean };
const GROUPS: { title: string; fields: FieldDef[] }[] = [
  { title: "Currency", fields: [
    { key: "exportCurrency", label: "Invoice currency (blank = NPR)", max: 3 }, { key: "exportExchangeRate", label: "NRB rate (NPR per 1 unit)", kind: "num" },
  ] },
  { title: "Contract and buyer", fields: [
    { key: "salesContractNo", label: "Sales contract / pro-forma no.", max: 40 }, { key: "salesContractDate", label: "Contract date", kind: "date" },
    { key: "buyerOrderNo", label: "Buyer's order no.", max: 40 }, { key: "buyerOrderDate", label: "Buyer's order date", kind: "date" },
    { key: "buyerTaxId", label: "Buyer tax ID (foreign VAT / reg. no.)", max: 40 }, { key: "notifyParty", label: "Notify party (if different)", max: 200, wide: true },
  ] },
  { title: "Customs", fields: [
    { key: "customsDeclarationNo", label: "Customs declaration (CDF) no.", max: 30 }, { key: "customsDeclarationDate", label: "CDF date", kind: "date" },
    { key: "customsOfficeExit", label: "Customs office of exit", max: 100 }, { key: "certificateOfOriginNo", label: "Certificate of origin no.", max: 40 },
    { key: "preferentialScheme", label: "Preferential scheme / GSP form", max: 60 },
  ] },
  { title: "Shipment", fields: [
    { key: "finalDestination", label: "Final destination (country)", max: 60 }, { key: "incoterm", label: "Incoterm (e.g. FCA)", max: 10 },
    { key: "incotermPlace", label: "Incoterm named place", max: 60 }, { key: "transportMode", label: "Mode of transport", kind: "mode" },
    { key: "pointOfLoading", label: "Point of loading", max: 60 }, { key: "pointOfDischarge", label: "Point of discharge", max: 60 },
    { key: "vehicleNo", label: "Vehicle / flight / vessel no.", max: 40 }, { key: "transportDocNo", label: "Transport doc (LR / AWB / BL) no.", max: 40 },
    { key: "transportDocDate", label: "Transport doc date", kind: "date" }, { key: "packagesMarks", label: "Packages, marks and numbers", max: 200, wide: true },
    { key: "grossWeight", label: "Gross weight (kg)", kind: "num" }, { key: "netWeight", label: "Net weight (kg)", kind: "num" },
  ] },
  { title: "Payment and bank", fields: [
    { key: "paymentTerms", label: "Payment terms (advance / L/C / other)", max: 60 }, { key: "fxReference", label: "FX reference (bank certificate / L/C)", max: 60 },
    { key: "bankAccountName", label: "Beneficiary account name", max: 100 }, { key: "bankAccountNo", label: "Account no.", max: 40 },
    { key: "bankName", label: "Bank and branch", max: 100 }, { key: "bankSwift", label: "SWIFT / BIC", max: 20 },
  ] },
];
export const EXPORT_KEYS = GROUPS.flatMap((g) => g.fields.map((f) => f.key));
export const DATE_KEYS = GROUPS.flatMap((g) => g.fields.filter((f) => f.kind === "date").map((f) => f.key));
export const blankExport = (): ExportValues => Object.fromEntries(EXPORT_KEYS.map((k) => [k, ""]));
export const exportFromDoc = (d: Record<string, any> | null | undefined): ExportValues => Object.fromEntries(EXPORT_KEYS.map((k) => [k, d?.[k] == null ? "" : String(d[k]).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "")]));
/** True when the invoice is in a foreign currency, so line rates are typed in it and converted to NPR. */
export const foreignCurrency = (v: ExportValues) => { const c = v.exportCurrency.trim().toUpperCase(); return c !== "" && c !== "NPR"; };

export function ExportPanel({ value, onChange, readOnly, errors, calendar }: { value: ExportValues; onChange: (patch: ExportValues) => void; readOnly: boolean; errors: Record<string, string | undefined>; calendar: "BS" | "AD" }) {
  const [open, setOpen] = useState(false);
  const filled = EXPORT_KEYS.filter((k) => value[k]?.trim()).length;
  const set = (k: string, v: string) => onChange({ ...value, [k]: v });
  return (
    <section className="lg-card shrink-0 px-4 py-2" aria-label="Export details">
      <button type="button" data-nav="export-panel" onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 text-left" aria-expanded={open}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <h2 className="lg-card-title">Export details</h2>
        <span className="lg-chip">{filled} filled</span>
        {foreignCurrency(value) && <span className="lg-chip">{value.exportCurrency.trim().toUpperCase()} @ {value.exportExchangeRate || "?"}</span>}
        {errors.exportDetail && <span role="alert" className="text-[12px] text-rose-700">{errors.exportDetail}</span>}
      </button>
      {open && (
        <div className="mt-2 max-h-[38vh] space-y-3 overflow-y-auto pr-1">
          {GROUPS.map((g) => (
            <div key={g.title}>
              <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{g.title}</h3>
              <div className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-2 md:grid-cols-4">
                {g.fields.map((f) => f.kind === "date"
                  ? <DateField key={f.key} label={f.label} name={f.key} value={value[f.key]} onChange={(v) => set(f.key, v)} calendar={calendar} readOnly={readOnly} error={errors[`exp.${f.key}`]} />
                  : f.kind === "mode"
                    ? <Field key={f.key} label={f.label}><select data-field={f.key} disabled={readOnly} value={value[f.key]} onChange={(e) => set(f.key, e.target.value)} className={`fld ${readOnly ? "bg-slate-100 text-slate-600" : ""}`}>
                      <option value="">—</option><option value="ROAD">Road</option><option value="AIR">Air</option><option value="SEA">Sea (via transit)</option><option value="RAIL">Rail</option><option value="OTHER">Other</option></select></Field>
                    : <TextField key={f.key} label={f.label} name={f.key} value={value[f.key]} readOnly={readOnly} error={errors[`exp.${f.key}`]} max={f.kind === "num" ? 20 : f.max}
                      className={f.wide ? "col-span-2" : undefined}
                      onChange={(v) => set(f.key, f.key === "exportCurrency" ? v.toUpperCase().replace(/[^A-Z]/g, "") : f.kind === "num" ? v.replace(/[^0-9.]/g, "") : v)} />)}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
