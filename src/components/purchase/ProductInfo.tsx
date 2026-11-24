import { useEffect, useMemo, useState } from "react";
import { purchaseApi, stockApi, type PLookups, type ProductPurchaseRow, type StockBalanceRow } from "../../api";
import { adToBs } from "../../lib/nepaliDate";
import { trimDec } from "../../lib/purchaseForm";

// The stock panel of the bill screen: what is on hand for the product the cursor is on, and what it was last bought at.
// Both are read-only look-ups; nothing here changes the bill.

export function useProductInfo(companyId: number, branchId: number, productId: string) {
  const [state, setState] = useState<{ stock: StockBalanceRow[] | null; history: ProductPurchaseRow[] | null; error: string }>({ stock: null, history: null, error: "" });
  useEffect(() => {
    if (!productId) { setState({ stock: null, history: null, error: "" }); return; }
    let live = true;
    setState({ stock: null, history: null, error: "" });
    Promise.all([stockApi.balance({ companyId, branchId, productId: Number(productId) }), purchaseApi.productHistory(companyId, Number(productId), 5)])
      .then(([stock, history]) => { if (live) setState({ stock, history, error: "" }); })
      .catch((e: Error) => { if (live) setState({ stock: [], history: [], error: e.message }); });
    return () => { live = false; };
  }, [companyId, branchId, productId]);
  return state;
}

// How far the rate typed on the line is from the last purchase rate; null when there is nothing to compare or it is close (within 10%).
export function rateDeviation(current: string, last: string | undefined): { pct: number; last: string } | null {
  const c = Number(current), l = Number(last);
  if (!last || !Number.isFinite(c) || !Number.isFinite(l) || c <= 0 || l <= 0) return null;
  const pct = ((c - l) / l) * 100;
  return Math.abs(pct) >= 10 ? { pct, last: String(last) } : null;
}

export function ProductInfoPanel({ lookups, productId, info, calendar, currentRate = "" }: {
  lookups: PLookups; productId: string; info: ReturnType<typeof useProductInfo>; calendar: "BS" | "AD"; currentRate?: string;
}) {
  const product = lookups.products.find((x) => String(x.id) === productId);
  const vendors = useMemo(() => new Map(lookups.vendors.map((v) => [v.id, v.name])), [lookups.vendors]);
  const locations = useMemo(() => new Map(lookups.locations.map((l) => [l.id, l.name])), [lookups.locations]);
  const date = (v: string | null) => { const s = String(v ?? "").slice(0, 10); return calendar === "BS" ? (adToBs(s) ?? s) : s; };
  if (!product) return <p className="px-3 py-3 text-[12.5px] text-slate-500">Move to a line and pick a product to see its stock and last purchase rates.</p>;
  const { stock, history, error } = info;
  const onHand = stock?.reduce((sum, r) => sum + Number(r.qty), 0) ?? 0;
  return (
    <div className="space-y-3 px-3 py-2 text-[12.5px]">
      <div className="min-w-0">
        <div className="truncate font-semibold text-ink" title={product.description}>{product.description}</div>
        <div className="font-mono text-[12px] text-slate-500">{product.code}</div>
      </div>
      {error && <p role="alert" className="text-rose-700">{error}</p>}
      {(() => {
        const d = rateDeviation(currentRate, info.history?.[0]?.rate);
        return d && <p role="status" className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-amber-900">Rate {trimDec(currentRate)} is <b>{Math.abs(d.pct).toFixed(0)}% {d.pct > 0 ? "higher" : "lower"}</b> than the last purchase rate {trimDec(d.last)}.</p>;
      })()}
      {product.type !== "STOCK" ? <p className="text-slate-500">Not a stock item: no stock is kept.</p> : (
        <section aria-label="Stock on hand">
          <div className="flex items-baseline justify-between border-b border-slate-200 pb-1"><span className="text-slate-600">On hand</span><b className="tabular-nums text-ink">{stock === null ? "…" : trimDec(String(onHand))}</b></div>
          {(stock ?? []).length > 1 && (
            <ul className="mt-1 space-y-0.5">
              {stock!.slice(0, 6).map((r, i) => (
                <li key={i} className="flex justify-between gap-2 text-slate-600">
                  <span className="truncate">{r.locationId ? locations.get(r.locationId) ?? `Location ${r.locationId}` : "No location"}{r.batchNo ? ` · ${r.batchNo}` : ""}</span>
                  <span className="tabular-nums">{trimDec(r.qty)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <section aria-label="Last purchase rates">
        <table className="xl-table xl-sticky w-full table-fixed">
          <colgroup><col style={{ width: "84px" }} /><col /><col style={{ width: "58px" }} /><col style={{ width: "78px" }} /></colgroup>
          <thead><tr><th className="text-left">Date</th><th className="text-left">Vendor</th><th className="text-right">Qty</th><th className="text-right">Rate</th></tr></thead>
          <tbody>
            {history === null ? <tr><td colSpan={4} className="text-left text-slate-500">Loading…</td></tr>
              : history.length === 0 ? <tr><td colSpan={4} className="text-left text-slate-500">Not purchased before.</td></tr>
              : history.map((h) => (
                <tr key={`${h.billId}-${h.rate}-${h.qty}`}>
                  <td className="text-left tabular-nums">{date(h.invoiceDate)}</td>
                  <td className="truncate text-left" title={`${h.invoiceNumber} — ${vendors.get(h.vendorGLId) ?? ""}`}>{vendors.get(h.vendorGLId) ?? h.invoiceNumber}</td>
                  <td className="text-right tabular-nums">{trimDec(h.qty)}</td>
                  <td className="text-right font-medium tabular-nums">{trimDec(h.rate)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
