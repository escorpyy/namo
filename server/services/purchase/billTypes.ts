import { HttpError } from "../../routes/_util";

// A bill's purchase type (goods or service, capital or other) is its VAT purchase-book classification and decides how a linked cost
// is treated (a goods bill can take landed cost, a service bill is a cost source). The lines must be the kind of product that type says.
export type BillPurchaseType = "GOODS_PURCHASE_OTHERS" | "GOODS_PURCHASE_CAPITAL" | "SERVICE_PURCHASE_OTHERS" | "SERVICE_PURCHASE_CAPITAL";
type ProductKind = "STOCK" | "NON_STOCK" | "SERVICE" | "FIXED_ASSET" | "BUNDLE";

// Only clear contradictions are refused: stock items are inventory, so they belong on a goods (others) bill only; a service product is never
// goods; a fixed asset is capital. A non-stock item is an expense-type item and may be bought on any bill, since a freight or insurance
// charge is often set up as non-stock.
const ALLOWED: Record<BillPurchaseType, { label: string; kinds: ProductKind[] }> = {
  GOODS_PURCHASE_OTHERS: { label: "Goods purchase (others)", kinds: ["STOCK", "NON_STOCK"] },
  GOODS_PURCHASE_CAPITAL: { label: "Goods purchase (capital)", kinds: ["FIXED_ASSET", "NON_STOCK"] },
  SERVICE_PURCHASE_OTHERS: { label: "Service purchase (others)", kinds: ["SERVICE", "NON_STOCK"] },
  SERVICE_PURCHASE_CAPITAL: { label: "Service purchase (capital)", kinds: ["SERVICE", "NON_STOCK", "FIXED_ASSET"] },
};
const KIND_LABEL: Record<ProductKind, string> = { STOCK: "stock", NON_STOCK: "non-stock", SERVICE: "service", FIXED_ASSET: "fixed asset", BUNDLE: "bundle" };
const USE_INSTEAD: Record<ProductKind, string> = {
  STOCK: "Goods purchase (others)", NON_STOCK: "Goods purchase (others)", FIXED_ASSET: "Goods purchase (capital)", SERVICE: "a Service purchase type", BUNDLE: "none (buy its components)",
};

/** Refuses a line whose product is not the kind this purchase type is for. Throws a 400 naming the first such line. */
export function assertLinesMatchPurchaseType(purchaseType: BillPurchaseType, lines: { lineNumber: number; productType: string }[]) {
  const rule = ALLOWED[purchaseType];
  for (const l of lines) {
    const kind = l.productType as ProductKind;
    if (rule.kinds.includes(kind)) continue;
    throw new HttpError(400, `Line ${l.lineNumber}: a ${KIND_LABEL[kind] ?? l.productType} product does not belong on a ${rule.label} bill. Use ${USE_INSTEAD[kind] ?? "the matching purchase type"} for it.`, "purchaseType");
  }
}
