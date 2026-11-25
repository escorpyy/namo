import { HttpError } from "../routes/_util";
import { assertDecimalPlaces, optDate } from "./purchase/common";
import { toMicro, fmt } from "./purchase/money";

// The extra header fields of an EXPORT sales invoice (Tax Invoice - Export). All optional. Stored as columns of SalesInvoice so the
// period lock, the audit trail and the "reason to change a posted invoice" rule cover them like every other header field.
export const EXPORT_FIELDS: { key: string; kind: "text" | "date" | "num" | "mode"; max: number }[] = [
  { key: "salesContractNo", kind: "text", max: 40 },
  { key: "salesContractDate", kind: "date", max: 0 },
  { key: "notifyParty", kind: "text", max: 200 },
  { key: "buyerOrderNo", kind: "text", max: 40 },
  { key: "buyerOrderDate", kind: "date", max: 0 },
  { key: "buyerTaxId", kind: "text", max: 40 },
  { key: "customsDeclarationNo", kind: "text", max: 30 },
  { key: "customsDeclarationDate", kind: "date", max: 0 },
  { key: "customsOfficeExit", kind: "text", max: 100 },
  { key: "certificateOfOriginNo", kind: "text", max: 40 },
  { key: "preferentialScheme", kind: "text", max: 60 },
  { key: "incoterm", kind: "text", max: 10 },
  { key: "incotermPlace", kind: "text", max: 60 },
  { key: "transportMode", kind: "mode", max: 10 },
  { key: "pointOfLoading", kind: "text", max: 60 },
  { key: "pointOfDischarge", kind: "text", max: 60 },
  { key: "finalDestination", kind: "text", max: 60 },
  { key: "vehicleNo", kind: "text", max: 40 },
  { key: "transportDocNo", kind: "text", max: 40 },
  { key: "transportDocDate", kind: "date", max: 0 },
  { key: "packagesMarks", kind: "text", max: 200 },
  { key: "grossWeight", kind: "num", max: 0 },
  { key: "netWeight", kind: "num", max: 0 },
  { key: "paymentTerms", kind: "text", max: 60 },
  { key: "fxReference", kind: "text", max: 60 },
  { key: "bankAccountName", kind: "text", max: 100 },
  { key: "bankAccountNo", kind: "text", max: 40 },
  { key: "bankName", kind: "text", max: 100 },
  { key: "bankSwift", kind: "text", max: 20 },
];
export const TRANSPORT_MODES = ["ROAD", "AIR", "SEA", "RAIL", "OTHER"] as const;
export const EXPORT_COLUMNS = ["exportCurrency", "exportExchangeRate", "exportForeignTotal", ...EXPORT_FIELDS.map((f) => f.key)];
export const NO_EXPORT: Record<string, null> = Object.fromEntries(EXPORT_COLUMNS.map((k) => [k, null]));

export type ExportInput = Record<string, string | number | null | undefined>;

/** Checks the export block and returns the column values to store (every export column, null when empty). */
export function cleanExport(input: ExportInput | null | undefined): { cols: Record<string, any>; currency: string | null; rate: bigint | null } {
  const cols: Record<string, any> = { ...NO_EXPORT };
  const d = input ?? {};
  for (const f of EXPORT_FIELDS) {
    const raw = d[f.key];
    const text = raw === null || raw === undefined ? "" : String(raw).trim();
    if (!text) continue;
    if (f.kind === "date") cols[f.key] = optDate(text, f.key);
    else if (f.kind === "num") {
      const n = toMicro(text);
      if (n < 0n) throw new HttpError(400, `${f.key} cannot be negative.`, "exportDetail");
      cols[f.key] = fmt(n);
    } else if (f.kind === "mode") {
      if (!(TRANSPORT_MODES as readonly string[]).includes(text)) throw new HttpError(400, "Mode of transport must be Road, Air, Sea, Rail or Other.", "exportDetail");
      cols[f.key] = text;
    } else {
      if (text.length > f.max) throw new HttpError(400, `${f.key} can be at most ${f.max} characters.`, "exportDetail");
      cols[f.key] = text;
    }
  }
  // NPR (or nothing) means the invoice is entered in rupees and there is no conversion
  const currency = String(d.exportCurrency ?? "").trim().toUpperCase();
  if (!currency || currency === "NPR") return { cols, currency: currency || null, rate: null };
  if (!/^[A-Z]{3}$/.test(currency)) throw new HttpError(400, "Currency must be a 3-letter code such as USD.", "exportDetail");
  const rateText = String(d.exportExchangeRate ?? "").trim();
  assertDecimalPlaces(rateText, 6, "Exchange rate can have at most 6 decimal places.", "exportDetail");
  const rate = rateText ? toMicro(rateText) : 0n;
  if (rate <= 0n) throw new HttpError(400, `Enter the exchange rate (NPR per 1 ${currency}, Nepal Rastra Bank rate of the invoice day).`, "exportDetail");
  cols.exportCurrency = currency; cols.exportExchangeRate = fmt(rate);
  return { cols, currency, rate };
}
