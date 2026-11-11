import { parseDec } from "../../shared/decimal";
import { fmt, lineBasicAmount } from "../../shared/purchase-calculation";
import type { PLookups } from "../api";
import { isValidAd } from "./nepaliDate";

// Form model shared by the Order / Challan / Bill screens. Everything in a form is a string (what the user typed); toPayload turns it into
// what the API wants. The server does all the real checking and pricing; the checks here only give quick feedback.

export type Product = PLookups["products"][number];
export type Term = PLookups["terms"][number];

export interface LineRow {
  key: string;
  productId: string;
  altQty: string;
  altUnitId: string;
  qty: string;
  unitId: string; // only used when the product has no unit of its own (fixed assets)
  rate: string;
  locationId: string;
  batchNo: string;
  manufactureDate: string;
  expiryDate: string;
  expectedDate: string; // order lines
  purchaseOrderLineId: string; // challan / bill lines: the order line they fulfil (kept, not typed)
  challanLineId: string; // bill lines: the challan line they bill (kept, not typed)
  link: string; // read-only text shown for the two links above, e.g. "Order line 2"
}
export interface TermRow {
  key: string;
  termId: string;
  nature?: "ADDITIVE" | "DEDUCTIVE";
  lineNumber: string;
  calcType: "PERCENT" | "AMOUNT";
  rate: string;
  inputAmount: string;
  isOverridden: boolean;
  overrideAmount: string;
  finalAmount: string; // what the server worked out when the document was last saved ("" = not saved yet)
}

export const newKey = () => Math.random().toString(36).slice(2);
export const trimDec = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
};
export const str = (v: unknown) => (v == null ? "" : String(v));
const num = (v: unknown) => (v == null ? "" : trimDec(v));

export const blankLine = (over: Partial<LineRow> = {}): LineRow => ({
  key: newKey(), productId: "", altQty: "", altUnitId: "", qty: "", unitId: "", rate: "", locationId: "", batchNo: "",
  manufactureDate: "", expiryDate: "", expectedDate: "", purchaseOrderLineId: "", challanLineId: "", link: "", ...over,
});
export const blankTerm = (over: Partial<TermRow> = {}): TermRow => ({
  key: newKey(), termId: "", lineNumber: "", calcType: "PERCENT", rate: "", inputAmount: "", isOverridden: false, overrideAmount: "", finalAmount: "", ...over,
});
export const isBlankLine = (l: LineRow) => !l.productId && !l.qty && !l.altQty && !l.rate;
export const isBlankTerm = (t: TermRow) => !t.termId;

// A line as the server returns it (order / challan / bill documents).
export function lineFromDoc(l: Record<string, any>, product: Product | undefined): LineRow {
  return blankLine({
    productId: str(l.productId),
    altQty: num(l.altQty), altUnitId: str(l.altUnitId), qty: num(l.qty), unitId: product && product.baseUnitId ? "" : str(l.unitId), rate: num(l.rate),
    locationId: str(l.locationId), batchNo: str(l.batchNo), manufactureDate: str(l.manufactureDate), expiryDate: str(l.expiryDate), expectedDate: str(l.expectedDate),
    purchaseOrderLineId: str(l.purchaseOrderLineId), challanLineId: str(l.challanLineId),
    link: [l.orderLineNumber ? `Order line ${l.orderLineNumber}` : "", l.challanLineNumber ? `Challan line ${l.challanLineNumber}` : ""].filter(Boolean).join(" · "),
  });
}
export function termFromDoc(t: Record<string, any>): TermRow {
  return blankTerm({
    termId: str(t.termId), nature: t.nature, lineNumber: str(t.lineNumber), calcType: t.calcType, rate: num(t.rate), inputAmount: num(t.inputAmount),
    isOverridden: !!t.isOverridden, overrideAmount: t.isOverridden ? num(t.finalAmount) : "", finalAmount: str(t.finalAmount),
  });
}

// ---- quantities ----
const MICRO = 1_000_000n;
const toMicro = (s: string): bigint | null => {
  const x = parseDec(s);
  if (!x) return null;
  return x.n * 10n ** BigInt(6 - x.scale);
};
// alternate quantity x conversion factor, 6 decimals (what the server will also store)
export function derivedQty(l: LineRow, p: Product | undefined): string {
  if (!p || !l.altQty || !l.altUnitId) return "";
  const a = toMicro(l.altQty);
  const f = Number(l.altUnitId) === p.baseUnitId ? MICRO : toMicro(p.alternateUnits.find((u) => u.unitId === Number(l.altUnitId))?.conversionFactor ?? "");
  if (a === null || f === null) return "";
  let q = (a * f) / MICRO;
  if (((a * f) % MICRO) * 2n >= MICRO) q += 1n;
  return trimDec(`${q / MICRO}.${(q % MICRO).toString().padStart(6, "0")}`);
}
export const effectiveQty = (l: LineRow, p: Product | undefined) => (l.altQty && l.altUnitId ? derivedQty(l, p) : l.qty);
export const lineAmount = (l: LineRow, p: Product | undefined): string => {
  const q = effectiveQty(l, p);
  if (!q || !l.rate) return "";
  const qty = toMicro(q), rate = toMicro(l.rate);
  return qty === null || rate === null ? "" : fmt(lineBasicAmount(qty, rate), 2);
};

// ---- payload ----
const nn = (s: string) => (s.trim() === "" ? null : s.trim());
export type LineKind = "order" | "challan" | "bill";
export function lineToPayload(l: LineRow, p: Product | undefined, kind: LineKind) {
  const useAlt = !!(l.altQty && l.altUnitId);
  const out: Record<string, unknown> = { productId: Number(l.productId) };
  if (useAlt) { out.altQty = l.altQty; out.altUnitId = Number(l.altUnitId); } else out.qty = l.qty;
  if (p && !p.baseUnitId && l.unitId) out.unitId = Number(l.unitId);
  out.rate = nn(l.rate);
  if (kind === "order") out.expectedDate = nn(l.expectedDate);
  else {
    out.locationId = l.locationId ? Number(l.locationId) : null;
    out.batchNo = nn(l.batchNo); out.manufactureDate = nn(l.manufactureDate); out.expiryDate = nn(l.expiryDate);
    out.purchaseOrderLineId = l.purchaseOrderLineId ? Number(l.purchaseOrderLineId) : null;
    if (kind === "bill") out.challanLineId = l.challanLineId ? Number(l.challanLineId) : null;
  }
  return out;
}
export function termToPayload(t: TermRow, m: Term | undefined) {
  const out: Record<string, unknown> = { termId: Number(t.termId), calcType: t.calcType };
  if (m?.isProductwise && t.lineNumber) out.lineNumber = Number(t.lineNumber);
  if (t.calcType === "PERCENT") out.rate = nn(t.rate); else out.inputAmount = nn(t.inputAmount);
  if (t.isOverridden) { out.isOverridden = true; out.overrideAmount = nn(t.overrideAmount); }
  return out;
}

// ---- quick checks (the server checks everything again) ----
export function validateLines(lines: LineRow[], products: Map<string, Product>, opts: { rate: "required" | "optional"; tracking: boolean }): Record<string, string> {
  const e: Record<string, string> = {};
  const live = lines.map((l, i) => ({ l, i })).filter(({ l }) => !isBlankLine(l));
  if (!live.length) { e.lines = "Add at least one line."; return e; }
  for (const { l, i } of live) {
    const p = products.get(l.productId);
    const set = (col: string, msg: string) => { if (!e[`L.${i}.${col}`]) e[`L.${i}.${col}`] = `Line ${i + 1}: ${msg}`; };
    if (!p) { set("p", "pick a product."); continue; }
    if (l.altQty && !l.altUnitId) set("au", "an alternate quantity needs its unit.");
    if (l.altUnitId && !l.altQty) set("aq", "an alternate unit needs its quantity.");
    const q = effectiveQty(l, p);
    if (!q || !(Number(q) > 0)) set(l.altQty ? "aq" : "q", "quantity must be greater than zero.");
    else if (!parseDec(q)) set("q", "quantity is not a valid number.");
    if (!p.baseUnitId && !l.unitId) set("u", "pick a unit.");
    if (l.rate && !parseDec(l.rate)) set("r", "rate is not a valid number.");
    if (opts.rate === "required" && l.rate === "") set("r", "enter the rate.");
    for (const [col, v, label] of [["mf", l.manufactureDate, "manufacture date"], ["ex", l.expiryDate, "expiry date"], ["xd", l.expectedDate, "expected date"]] as const) {
      if (v && (v.startsWith("?") || !isValidAd(v))) set(col, `${label} is not a valid date.`);
    }
    if (opts.tracking && p.tracksBatch && !l.batchNo.trim()) set("b", "this product is batch-tracked; enter the batch number.");
    if (opts.tracking && p.tracksExpiry && !l.expiryDate) set("ex", "this product expires; enter the expiry date.");
    if (l.manufactureDate && l.expiryDate && l.expiryDate < l.manufactureDate) set("ex", "expiry is before manufacture.");
  }
  return e;
}
export function validateTerms(terms: TermRow[], masters: Map<string, Term>, lineCount: number): Record<string, string> {
  const e: Record<string, string> = {};
  const seen = new Set<string>();
  terms.forEach((t, i) => {
    if (isBlankTerm(t)) return;
    const m = masters.get(t.termId);
    const set = (col: string, msg: string) => { if (!e[`T.${i}.${col}`]) e[`T.${i}.${col}`] = `Term ${i + 1}: ${msg}`; };
    if (!m) return set("t", "pick a term.");
    if (m.isProductwise) {
      if (!t.lineNumber) set("l", "this term applies to one line; pick the line.");
      else if (Number(t.lineNumber) > lineCount) set("l", `there is no line ${t.lineNumber}.`);
    }
    const k = `${t.termId}:${m.isProductwise ? t.lineNumber : ""}`;
    if (seen.has(k)) set("t", `${m.code} is entered twice.`);
    seen.add(k);
    if (m.category === "ROUNDED") { /* a Round Off term has no rate or amount to enter */ }
    else if (t.calcType === "PERCENT") { if (t.rate === "" || !parseDec(t.rate)) set("v", "enter a rate (percent)."); }
    else if (t.inputAmount === "" || !parseDec(t.inputAmount)) set("v", "enter an amount.");
    if (t.isOverridden && (t.overrideAmount === "" || !parseDec(t.overrideAmount))) set("o", "enter the amount to use instead.");
  });
  return e;
}
export const dateErr = (label: string, v: string, required = false) =>
  v === "" ? (required ? `${label} is required.` : undefined) : v.startsWith("?") || !isValidAd(v) ? `${label}: enter a valid date (YYYY-MM-DD).` : undefined;

// A date (YYYY-MM-DD) some whole days after another, or "" when the start is not a valid date. Used to keep a bill's due date in step with its invoice date and due days.
export function addDaysIso(iso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m || !isValidAd(iso) || !Number.isInteger(days) || days < 0) return "";
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days)).toISOString().slice(0, 10);
}

// The document-wise terms a new document starts with: every active "always show" term (GENERAL or ROUNDED) in the master's sequence order, at the
// master's default value (zero unless the master says otherwise). The user can change the value but not skip the term.
export function alwaysShowTerms(masters: Term[]): TermRow[] {
  return masters
    .filter((m) => m.isMandatory && m.isActive && !m.isProductwise && (m.category === "GENERAL" || m.category === "ROUNDED"))
    .sort((a, b) => a.sequence - b.sequence || a.code.localeCompare(b.code))
    .map((m) => blankTerm({
      termId: String(m.id), calcType: m.defaultCalcType,
      rate: m.defaultCalcType === "PERCENT" ? trimDec(m.defaultValue) : "", inputAmount: m.defaultCalcType === "AMOUNT" ? trimDec(m.defaultValue) : "",
    }));
}

// The charge terms a picker offers: optionally only one category, or everything except one (a bill hides COSTING terms but keeps GENERAL and
// ROUNDED ones such as Round Off), and optionally only line-wise or only document-wise terms.
export function pickableTerms<T extends { category: string; isProductwise: boolean }>(terms: T[], f: { category?: string; excludeCategory?: string; productwiseOnly?: boolean }): T[] {
  return terms.filter((t) => (!f.category || t.category === f.category) && (!f.excludeCategory || t.category !== f.excludeCategory) && (f.productwiseOnly === undefined || t.isProductwise === f.productwiseOnly));
}

const zeroTermRow = (m: Term, lineNumber?: number): TermRow => blankTerm({
  termId: String(m.id), calcType: m.defaultCalcType, rate: m.defaultCalcType === "PERCENT" ? "0" : "", inputAmount: m.defaultCalcType === "AMOUNT" ? "0" : "",
  lineNumber: m.isProductwise ? String(lineNumber ?? 1) : "",
});

// The rows the terms dialog opens with: every active term of its kind (line-wise for a line, document-wise for the header) in the master's
// sequence order. A term already on the document keeps its values; every other term starts at zero, so the user only types the ones that apply.
// Terms already on the document that the picker would no longer offer (inactive, COSTING) stay visible at the end instead of vanishing.
export function dialogTermRows(masters: Term[], existing: TermRow[], scope: { productwise: boolean; lineNumber?: number }): TermRow[] {
  const offered = pickableTerms(masters, { excludeCategory: "COSTING", productwiseOnly: scope.productwise })
    .filter((m) => m.isActive || existing.some((t) => t.termId === String(m.id)))
    .sort((a, b) => a.sequence - b.sequence || a.code.localeCompare(b.code));
  const used = new Set<string>();
  const rows = offered.map((m) => {
    const found = existing.find((t) => t.termId === String(m.id) && !used.has(t.key));
    if (!found) return zeroTermRow(m, scope.lineNumber);
    used.add(found.key);
    return found;
  });
  return [...rows, ...existing.filter((t) => !used.has(t.key))];
}

// A term row that adds or takes nothing: the value it would use (override, rate or amount) is empty or zero.
export function isZeroTerm(t: TermRow): boolean {
  const v = (t.isOverridden ? t.overrideAmount : t.calcType === "PERCENT" ? t.rate : t.inputAmount).trim();
  if (v === "") return true;
  const x = parseDec(v);
  return !!x && x.n === 0n;
}

// What "Apply" keeps from the dialog: rows left at zero are dropped (they would only clutter the bill), except a mandatory term, which must stay on
// the document even at zero, so its empty value is written as 0.
export function dialogTermsToApply(draft: TermRow[], masters: Map<string, Term>): TermRow[] {
  return draft.flatMap((t) => {
    if (isBlankTerm(t)) return [];
    if (!isZeroTerm(t)) return [t];
    if (!masters.get(t.termId)?.isMandatory) return [];
    const zero = (v: string) => (v.trim() === "" ? "0" : v);
    return [t.isOverridden ? { ...t, overrideAmount: zero(t.overrideAmount) } : t.calcType === "PERCENT" ? { ...t, rate: zero(t.rate) } : { ...t, inputAmount: zero(t.inputAmount) }];
  });
}

// The form for a NEW draft bill copied from an existing one: the same vendor, lines and charges, but nothing that identifies the original or links
// it to other documents. The vendor invoice no./date, due date and customs declaration no./date are cleared (a repeated vendor invoice no. or a
// repeated declaration no. is refused on save), the order and challan links are dropped, the invoice date is today's, and every row gets a new key.
export interface BillCopyFields {
  numberSeriesId?: string; docNumber?: string; // a copy is a new bill: it gets its own number
  invoiceDate: string; vendorInvoiceNo: string; vendorInvoiceDate: string; dueDate: string;
  purchaseChallanId: string; purchaseOrderId: string; challanNo: string; orderNo: string;
  lines: LineRow[]; terms: TermRow[]; imp: Record<string, string>;
}
export function copyBillForm<F extends BillCopyFields>(source: F, invoiceDate: string): F {
  return {
    ...source,
    invoiceDate, vendorInvoiceNo: "", vendorInvoiceDate: "", dueDate: "", numberSeriesId: "", docNumber: "",
    purchaseChallanId: "", purchaseOrderId: "", challanNo: "", orderNo: "",
    lines: source.lines.map((l) => ({ ...l, key: newKey(), purchaseOrderLineId: "", challanLineId: "", link: "" })),
    terms: source.terms.map((t) => ({ ...t, key: newKey(), finalAmount: "" })),
    imp: { ...source.imp, customsDeclarationNo: "", customsDeclarationDate: "" },
  };
}

// A date to start a new document on: today, kept inside the selected fiscal year.
export function defaultDate(fy: { startDate: string; endDate: string } | undefined): string {
  const d = new Date();
  const t = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (!fy) return t;
  return t < fy.startDate ? fy.startDate : t > fy.endDate ? fy.endDate : t;
}
