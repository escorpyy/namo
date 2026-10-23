import type { ContextData } from "./types";
import type { Row } from "./lib/form";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public field?: string,
  ) {
    super(message);
  }
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });
  } catch {
    throw new ApiError("Cannot reach the server. Is the API running?", 0);
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) throw new ApiError(data?.message ?? `Request failed (${res.status})`, res.status, data?.field);
  return data as T;
}

// Data layer isolated — baaki UI sirf in functions ko jaanti hai.
export const api = {
  context: () => req<ContextData>("/api/context"),
};

// Har master ke liye ek hi generic CRUD — key = shared/masters.ts ka key
export const masterApi = (key: string) => ({
  list: (companyId: number) => req<Row[]>(`/api/masters/${key}?companyId=${companyId}`),
  create: (companyId: number, v: Record<string, unknown>) =>
    req<Row>(`/api/masters/${key}?companyId=${companyId}`, { method: "POST", body: JSON.stringify(v) }),
  update: (id: number, v: Record<string, unknown>) => req<Row>(`/api/masters/${key}/${id}`, { method: "PUT", body: JSON.stringify(v) }),
  remove: (id: number) => req<{ ok: true }>(`/api/masters/${key}/${id}`, { method: "DELETE" }),
});

// Opening Balance: grid screen ka alag API (company + branch + fiscal year ke saare ledgers)
export interface ObRow {
  key: string; generalLedgerId: number; subLedgerId: number | null; code: string; name: string;
  subLedgerCode: string | null; subLedgerName: string | null; groupCode: string; subGroupCode: string; groupType: string;
  normalBalance: "DEBIT" | "CREDIT"; isActive: boolean; requiresSubLedger: boolean; needsSubLedger: boolean; debit: string; credit: string;
}
export interface ObData {
  fiscalYear: { id: number; code: string; startDate: string; endDate: string; isClosed: boolean; isOpeningBalanceLocked: boolean; lockedAt: string | null; lockedByName: string | null };
  rows: ObRow[];
  totals: { branch: { debit: string; credit: string }; company: { debit: string; credit: string } };
}
export const obApi = {
  get: (companyId: number, branchId: number, fiscalYearId: number) =>
    req<ObData>(`/api/opening-balance?companyId=${companyId}&branchId=${branchId}&fiscalYearId=${fiscalYearId}`),
  save: (body: Record<string, unknown>) => req<{ saved: number; deleted: number }>("/api/opening-balance", { method: "PUT", body: JSON.stringify(body) }),
  lock: (body: Record<string, unknown>) => req<{ ok: true }>("/api/opening-balance/lock", { method: "POST", body: JSON.stringify(body) }),
  unlock: (body: Record<string, unknown>) => req<{ ok: true }>("/api/opening-balance/unlock", { method: "POST", body: JSON.stringify(body) }),
};

// Stock Opening Balance: grid (product x location x batch lines)
export interface SoProduct {
  stockDetailId: number; productId: number; code: string; description: string; isActive: boolean;
  unitId: number; unitCode: string; decimals: number; tracksBatch: boolean; tracksExpiry: boolean;
  closingBSGLId: number | null; defaultLocationId: number | null;
}
export interface SoLine { id: number; stockDetailId: number; locationId: number | null; batchNo: string | null; expiryDate: string | null; quantity: string; rate: string; value: string }
export interface SoData {
  fiscalYear: { id: number; code: string; startDate: string; endDate: string; isClosed: boolean; isOpeningBalanceLocked: boolean };
  products: SoProduct[];
  locations: { id: number; code: string; name: string; isActive: boolean }[];
  lines: SoLine[];
  ledgers: { id: number; code: string; name: string; balance: string }[];
}
export const soApi = {
  get: (companyId: number, branchId: number, fiscalYearId: number) =>
    req<SoData>(`/api/stock-opening?companyId=${companyId}&branchId=${branchId}&fiscalYearId=${fiscalYearId}`),
  save: (body: Record<string, unknown>) => req<{ saved: number; deleted: number }>("/api/stock-opening", { method: "PUT", body: JSON.stringify(body) }),
};

// ---- Purchase documents (Order -> Challan -> Bill): /api/purchase ----
export type PurchaseKind = "orders" | "challans" | "bills";
export interface PLookups {
  vendors: { id: number; code: string; name: string; requiresSubLedger: boolean; isActive: boolean }[];
  subLedgers: { id: number; code: string; name: string; generalLedgerId: number | null; isActive: boolean }[];
  agents: { id: number; code: string; name: string; isActive: boolean }[];
  locations: { id: number; code: string; name: string; isActive: boolean }[];
  units: { id: number; code: string; name: string; decimalPlaces: number }[];
  products: {
    id: number; code: string; description: string; type: "STOCK" | "NON_STOCK" | "SERVICE" | "FIXED_ASSET"; isActive: boolean; baseUnitId: number | null;
    tracksBatch: boolean; tracksExpiry: boolean; defaultLocationId: number | null; alternateUnits: { unitId: number; conversionFactor: string }[];
  }[];
  terms: {
    id: number; code: string; name: string; category: "GENERAL" | "ADDITIONAL"; nature: "ADDITIVE" | "DEDUCTIVE"; isProductwise: boolean; isMandatory: boolean;
    sequence: number; defaultCalcType: "PERCENT" | "AMOUNT"; defaultValue: string; calcBase: string; distributeToLines: boolean; isActive: boolean;
  }[];
  fiscalYears: { id: number; code: string; startDate: string; endDate: string; isActive: boolean; isClosed: boolean; isCurrent: boolean }[];
}
export interface PListRow { id: number; branchId: number; vendorGLId: number; vendorCode: string; vendorName: string; fiscalYear: string; [k: string]: any }
export interface PList { total: number; rows: PListRow[] }
// A whole document as the server returns it (orders / challans / bills share the common header + lines + terms shape; extra fields differ).
export interface PDoc { id: number; companyId: number; branchId: number; vendorGLId: number; fiscalYear: string; lines: Record<string, any>[]; terms?: Record<string, any>[]; [k: string]: any }
export interface PWrite<D = PDoc> { result: Record<string, any>; document: D }

const qstr = (o: Record<string, string | number | undefined | null>) =>
  Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");

export const purchaseApi = {
  lookups: (companyId: number) => req<PLookups>(`/api/purchase/lookups?companyId=${companyId}`),
  list: (kind: PurchaseKind, p: { companyId: number; branchId: number; fiscalYear: string; status?: string; search?: string; vendorGLId?: number }) =>
    req<PList>(`/api/purchase/${kind}?${qstr(p)}`),
  get: (kind: PurchaseKind, id: number, companyId: number) => req<PDoc>(`/api/purchase/${kind}/${id}?companyId=${companyId}`),
  create: (kind: PurchaseKind, body: Record<string, unknown>) => req<PWrite>(`/api/purchase/${kind}`, { method: "POST", body: JSON.stringify(body) }),
  update: (kind: PurchaseKind, id: number, companyId: number, body: Record<string, unknown>) =>
    req<PWrite>(`/api/purchase/${kind}/${id}?companyId=${companyId}`, { method: "PUT", body: JSON.stringify(body) }),
  remove: (kind: PurchaseKind, id: number, companyId: number, userId?: number) =>
    req<{ result: { id: number } }>(`/api/purchase/${kind}/${id}?${qstr({ companyId, userId })}`, { method: "DELETE" }),
  action: (kind: PurchaseKind, id: number, companyId: number, action: string, body: Record<string, unknown> = {}) =>
    req<PWrite>(`/api/purchase/${kind}/${id}/${action}?companyId=${companyId}`, { method: "POST", body: JSON.stringify(body) }),
  billFromChallan: (companyId: number, challanId: number) => req<Record<string, any>>(`/api/purchase/bills/from-challan/${challanId}?companyId=${companyId}`),
};
