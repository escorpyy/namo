import { HttpError } from "../routes/_util";

// A sales invoice's type (goods or service) is its VAT sales-book classification. The lines must be the kind of product that type says.
// Stock items are goods only, a service product is never goods; a non-stock item may be sold on either (a freight or installation charge).
export type SalesType = "GOODS_SALES" | "SERVICE_SALES";
const ALLOWED: Record<SalesType, { label: string; kinds: string[]; instead: string }> = {
  GOODS_SALES: { label: "Goods sales", kinds: ["STOCK", "NON_STOCK"], instead: "a Service sales invoice" },
  SERVICE_SALES: { label: "Service sales", kinds: ["SERVICE", "NON_STOCK"], instead: "a Goods sales invoice" },
};

/** Refuses a line whose product is not the kind this sales type is for. Throws a 400 naming the first such line. */
export function assertLinesMatchSalesType(salesType: SalesType, lines: { lineNumber: number; productType: string }[]) {
  const rule = ALLOWED[salesType];
  for (const l of lines) {
    if (rule.kinds.includes(l.productType)) continue;
    throw new HttpError(400, `Line ${l.lineNumber}: a ${l.productType.toLowerCase().replace("_", "-")} product does not belong on a ${rule.label} invoice. Use ${rule.instead} for it.`, "salesType");
  }
}
