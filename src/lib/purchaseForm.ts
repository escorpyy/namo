import { mulRound2, parseDec } from "../../shared/decimal";
import type { PLookups } from "../api";
import { isValidAd } from "./nepaliDate";

// Form model shared by the Order / Challan / Bill screens. Everything in a form is a string (what the user typed); toPayload turns it into
// what the API wants. The server does all the real checking and pricing; the checks here only give quick feedback.

export type Product = PLookups["products"][number];
export type Term = PLookups["terms"][number];

export interface LineRow {
  key: string;
  productId: string;
  particular: string;
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
  key: newKey(), productId: "", particular: "", altQty: "", altUnitId: "", qty: "", unitId: "", rate: "", locationId: "", batchNo: "",
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
    productId: str(l.productId), particular: str(l.particular) === str(l.productDescription) ? "" : str(l.particular),
    altQty: num(l.altQty), altUnitId: str(l.altUnitId), qty: num(l.qty), unitId: product && product.baseUnitId ? "" : str(l.unitId), rate: num(l.rate),
    locationId: str(l.locationId), batchNo: str(l.batchNo), manufactureDate: str(l.manufactureDate), expiryDate: str(l.expiryDate), expectedDate: str(l.expectedDate),
    purchaseOrderLineId: str(l.purchaseOrderLineId), challanLineId: str(l.challanLineId),
    link: [l.orderLineNumber ? `Order line ${l.orderLineNumber}` : "", l.challanLineNumber ? `Challan line ${l.challanLineNumber}` : ""].filter(Boolean).join(" · "),
  });
}
export function termFromDoc(t: Record<string, any>): TermRow {
  return blankTerm({
    termId: str(t.termId), lineNumber: str(t.lineNumber), calcType: t.calcType, rate: num(t.rate), inputAmount: num(t.inputAmount),
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
  return q && l.rate ? mulRound2(q, l.rate) : "";
};

// ---- payload ----
const nn = (s: string) => (s.trim() === "" ? null : s.trim());
export type LineKind = "order" | "challan" | "bill";
export function lineToPayload(l: LineRow, p: Product | undefined, kind: LineKind) {
  const useAlt = !!(l.altQty && l.altUnitId);
  const out: Record<string, unknown> = { productId: Number(l.productId), particular: nn(l.particular) };
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
    if (t.calcType === "PERCENT") { if (t.rate === "" || !parseDec(t.rate)) set("v", "enter a rate (percent)."); }
    else if (t.inputAmount === "" || !parseDec(t.inputAmount)) set("v", "enter an amount.");
    if (t.isOverridden && (t.overrideAmount === "" || !parseDec(t.overrideAmount))) set("o", "enter the amount to use instead.");
  });
  return e;
}
export const dateErr = (label: string, v: string, required = false) =>
  v === "" ? (required ? `${label} is required.` : undefined) : v.startsWith("?") || !isValidAd(v) ? `${label}: enter a valid date (YYYY-MM-DD).` : undefined;

// A date to start a new document on: today, kept inside the selected fiscal year.
export function defaultDate(fy: { startDate: string; endDate: string } | undefined): string {
  const d = new Date();
  const t = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (!fy) return t;
  return t < fy.startDate ? fy.startDate : t > fy.endDate ? fy.endDate : t;
}
