import type { ContextData } from "./types";
import type { Row } from "./lib/form";
import type { CodeMode, CodeRuleRow, CodeSuggestion } from "../shared/codeRules";
import type { SeriesMode, SeriesRow } from "../shared/numberSeries";
import type { GlRoleKey } from "../shared/glSetup";

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

// Counts the narrations created, changed or deleted in this browser session, so the cached list that the narration fields offer
// (src/lib/narrations.ts) knows when it is out of date.
let narrationEdits = 0;
export const narrationEditCount = () => narrationEdits;

// Har master ke liye ek hi generic CRUD — key = shared/masters.ts ka key
export const masterApi = (key: string) => {
  const edited = <T>(p: Promise<T>) => (key === "narrations" ? p.then((r) => { narrationEdits++; return r; }) : p);
  return {
    list: (companyId: number) => req<Row[]>(`/api/masters/${key}?companyId=${companyId}`),
    // userId (optional) is who is making the change: the audit trail of the masters that decide where amounts post records it
    create: (companyId: number, v: Record<string, unknown>, userId?: number) =>
      edited(req<Row>(`/api/masters/${key}?companyId=${companyId}${userId ? `&userId=${userId}` : ""}`, { method: "POST", body: JSON.stringify(v) })),
    update: (id: number, companyId: number, v: Record<string, unknown>, userId?: number, reassign?: "ALL" | "UPCOMING", reassignSales?: "ALL" | "UPCOMING") => edited(req<Row & { ledgerJob?: { id: number; total: number } }>(`/api/masters/${key}/${id}?companyId=${companyId}${userId ? `&userId=${userId}` : ""}${reassign ? `&reassign=${reassign}` : ""}${reassignSales ? `&reassignSales=${reassignSales}` : ""}`, { method: "PUT", body: JSON.stringify(v) })),
    remove: (id: number, companyId: number, userId?: number) => edited(req<{ ok: true }>(`/api/masters/${key}/${id}?companyId=${companyId}${userId ? `&userId=${userId}` : ""}`, { method: "DELETE" })),
  };
};

// Code numbering rules (shared/codeRules.ts): the rule of every master, and the code to propose for a new record
export const codeRulesApi = {
  list: (companyId: number) => req<CodeRuleRow[]>(`/api/code-rules?companyId=${companyId}`),
  save: (companyId: number, key: string, v: { mode: CodeMode; template: string }, userId?: number) =>
    req<CodeRuleRow>(`/api/code-rules/${key}`, { method: "PUT", body: JSON.stringify({ companyId, userId, ...v }) }),
  suggest: (companyId: number, key: string, v: { parentId?: number | null; name?: string; type?: string }) =>
    req<CodeSuggestion>(`/api/code-rules/${key}/suggest`, { method: "POST", body: JSON.stringify({ companyId, ...v }) }),
};

// Number series (shared/numberSeries.ts): the settings, and what a document form offers
export interface AvailableSeries { id: number; name: string; mode: SeriesMode; assignAt: "DRAFT" | "POST"; isDefault: boolean; next: string | null; left: number | null; problem?: string }
export const numberSeriesApi = {
  list: (companyId: number) => req<SeriesRow[]>(`/api/number-series?companyId=${companyId}`),
  users: () => req<{ id: number; name: string }[]>(`/api/number-series/users`),
  save: (companyId: number, id: number | null, v: Record<string, unknown>, userId?: number) =>
    req<SeriesRow>(id ? `/api/number-series/${id}` : `/api/number-series`, { method: id ? "PUT" : "POST", body: JSON.stringify({ companyId, userId, ...v }) }),
  available: (companyId: number, documentType: string, branchId: number, fiscalYear: string, userId?: number) =>
    req<AvailableSeries[]>(`/api/number-series/available?companyId=${companyId}&documentType=${documentType}&branchId=${branchId}&fiscalYear=${encodeURIComponent(fiscalYear)}${userId ? `&userId=${userId}` : ""}`),
};

export type GLSetupRole = {
  role: GlRoleKey; label: string; hint: string; generalLedgerId: number | null;
  allowJournal: boolean; allowCashBank: boolean; allowSalesInvoice: boolean; allowSalesReturn: boolean;
  allowPurchaseBill: boolean; allowPurchaseReturn: boolean; allowOpeningBalance: boolean; allowStockOpening: boolean; isLocked: boolean;
};
export type GLSetupLedger = { id: number; code: string; name: string; normalBalance: "DEBIT" | "CREDIT"; isActive: boolean; isCashOrBank: boolean; requiresSubLedger: boolean };
export const glSetupApi = {
  get: (companyId: number) => req<{ roles: GLSetupRole[]; ledgers: GLSetupLedger[] }>(`/api/gl-setup?companyId=${companyId}`),
  save: (companyId: number, userId: number, roles: GLSetupRole[]) =>
    req<{ roles: GLSetupRole[]; ledgers: GLSetupLedger[] }>("/api/gl-setup", { method: "PUT", body: JSON.stringify({ companyId, userId, roles }) }),
};
export interface ProductGLDefaults {
  companyId: number;
  stock: { openingGLId: number | null; closingPLGLId: number | null; closingBSGLId: number | null; purchaseGLId: number | null; purchaseReturnGLId: number | null; salesGLId: number | null; salesReturnGLId: number | null };
  nonStock: { purchaseGLId: number | null; salesGLId: number | null };
}
export const productGLDefaultsApi = {
  get: (companyId: number) => req<ProductGLDefaults>(`/api/product-gl-defaults?companyId=${companyId}`),
  apply: (companyId: number, userId: number, roles: GlRoleKey[], mode: "UPDATE_ALL" | "PRESERVE_EXPLICIT") =>
    req<{ ok: true; affected: number; mode: "UPDATE_ALL" | "PRESERVE_EXPLICIT" }>("/api/product-gl-defaults/apply", {
      method: "POST", body: JSON.stringify({ companyId, userId, roles, mode }),
    }),
};

// Ledger change on a master: how many transactions already carry the old ledger, and the background job that moves them
export type LedgerJobKind = "PURCHASE_TERM" | "SALES_TERM" | "PRODUCT_PURCHASE" | "PRODUCT_SALES";
export type LedgerImpact = { masterName: string; ledgerId: number | null; documents: number; posted: number; lines: number };
export type LedgerJob = { id: number; kind: LedgerJobKind; masterName: string; status: "QUEUED" | "RUNNING" | "DONE" | "FAILED"; total: number; processed: number; skipped: number; message: string | null };
export const ledgerReassignApi = {
  impact: (companyId: number, kind: LedgerJobKind, masterId: number) => req<LedgerImpact>(`/api/ledger-reassign/impact?companyId=${companyId}&kind=${kind}&masterId=${masterId}`),
  jobs: (companyId: number, userId?: number) => req<LedgerJob[]>(`/api/ledger-reassign/jobs?companyId=${companyId}${userId ? `&userId=${userId}` : ""}`),
  seen: (companyId: number, id: number) => req<{ ok: true }>(`/api/ledger-reassign/jobs/${id}/seen?companyId=${companyId}`, { method: "POST" }),
  retry: (companyId: number, id: number) => req<{ ok: true }>(`/api/ledger-reassign/jobs/${id}/retry?companyId=${companyId}`, { method: "POST" }),
};

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
  vendors: { id: number; code: string; name: string; requiresSubLedger: boolean; isActive: boolean; paymentTermDays: number | null; creditLimit?: string | null }[];
  subLedgers: { id: number; code: string; name: string; generalLedgerId: number | null; isActive: boolean }[];
  agents: { id: number; code: string; name: string; isActive: boolean }[];
  locations: { id: number; code: string; name: string; isActive: boolean }[];
  units: { id: number; code: string; name: string; decimalPlaces: number }[];
  products: {
    id: number; code: string; description: string; type: "STOCK" | "NON_STOCK" | "SERVICE" | "FIXED_ASSET"; isActive: boolean; baseUnitId: number | null;
    tracksBatch: boolean; tracksExpiry: boolean; defaultLocationId: number | null; purchaseRate: string | null; salesRate?: string | null; alternateUnits: { unitId: number; conversionFactor: string }[];
  }[];
  terms: {
    id: number; code: string; name: string; generalLedgerId?: number | null; affectsStockValue?: boolean; defaultAgainstLedgerId?: number | null; lastAgainstLedgerId?: number | null; allocationBasis?: string; category: "GENERAL" | "COSTING" | "ROUNDED"; nature: "ADDITIVE" | "DEDUCTIVE"; isProductwise: boolean; isMandatory: boolean; isEditable: boolean; roundingMethod?: "NEAREST" | "UP" | "DOWN";
    sequence: number; defaultCalcType: "PERCENT" | "AMOUNT"; defaultValue: string; calcBase: "ITEM_VALUE" | "RUNNING_TOTAL" | "SINGLE_TERM"; baseTermId: number | null; distributeToLines: boolean; isActive: boolean;
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

export interface LedgerReportProduct { id: number; code: string; description: string; qty: string; unit: string; altQty?: string | null; altUnit?: string | null; rate: string; amount: string; location?: string | null; batch?: string | null; expiry?: string | null }
export interface LedgerReportRow {
  lineId: number; voucherId: number; generalLedgerId: number; subLedgerId: number | null; d: string; voucherNumber: string;
  kind: "JOURNAL" | "CASH_BANK" | "STOCK"; voucherLabel: string; posted: boolean; postedAt: string | null; postedBy: number | null; postedByName: string | null;
  remarks: string | null; narration: string | null; reference: string | null; reversalOfId: number | null; hasReversal: boolean;
  ledgerCode: string; ledgerName: string;
  accountSubGroupId: number | null; accountSubGroupCode: string | null; accountSubGroupName: string | null;
  accountGroupId: number; accountGroupCode: string; accountGroupName: string;
  agentId: number | null; agentCode: string | null; agentName: string | null; subAreaId: number | null; subAreaCode: string | null; subAreaName: string | null; areaId: number | null; areaCode: string | null; areaName: string | null;
  invoiceAgentId: number | null; invoiceAgentCode: string | null; invoiceAgentName: string | null;
  subLedgerCode: string | null; subLedgerName: string | null; debit: string; credit: string;
  sourceNumber: string; sourceLabel: string; /** the screen that owns the source record (App screen id) and the record's id there, so a line can open it */ sourceScreen: string; sourceId: number; products: LedgerReportProduct[]; productIds: number[]; running: string; total: number;
  /** Present only when the request asked for groupBy: the server's group key and label for each level, in the order asked. A null key is "Unassigned". */
  groupKeys?: (string | null)[]; groupLabels?: string[];
}
export interface LedgerReportSummary {
  generalLedgerId: number; code: string; name: string;
  accountSubGroupId: number | null; accountSubGroupCode: string | null; accountSubGroupName: string | null;
  accountGroupId: number; accountGroupCode: string; accountGroupName: string;
  agentId: number | null; agentCode: string | null; agentName: string | null;
  subAreaId: number | null; subAreaCode: string | null; subAreaName: string | null; areaId: number | null; areaCode: string | null; areaName: string | null;
  opening: string; debit: string; credit: string; closing: string;
}
export interface LedgerReportLookups {
  ledgers: { id: number; code: string; name: string; type: string; requiresSubLedger: boolean; isActive: boolean }[];
  subLedgers: { id: number; code: string; name: string; generalLedgerId: number }[];
  products: { id: number; code: string; description: string }[];
}
/** Debit/credit/line count of one deepest group over the WHOLE filtered report (all pages). Parent groups are the sum of the entries under them. */
export interface LedgerReportGroupTotal { keys: (string | null)[]; debit: string; credit: string; count: number }
export interface LedgerReportResult { rows: LedgerReportRow[]; summary: LedgerReportSummary[]; total: number; page: number; pageSize: number; fiscalYear: string; from: string; to: string; groupBy?: string[]; groupTotals?: LedgerReportGroupTotal[] }
export const ledgerReportApi = {
  lookups: (companyId: number) => req<LedgerReportLookups>(`/api/ledger-report/lookups?companyId=${companyId}`),
  get: (p: { companyId: number; branchId: number; fiscalYear: string; from: string; to: string; ledgerIds?: string; subLedgerId?: number | ""; page?: number; pageSize?: number; status?: string; voucherType?: string; productId?: number | ""; search?: string; groupBy?: string; monthBounds?: string }) =>
    req<LedgerReportResult>(`/api/ledger-report?${qstr(p)}`),
};

export interface AccountBalance { generalLedgerId: number; subLedgerId: number | null; debit: string; credit: string }
export const accountBalancesApi = {
  get: (p: { companyId: number; branchId: number; fiscalYear: string; date: string; excludeJournalVoucherId?: number; excludeCashBankVoucherId?: number }) =>
    req<{ rows: AccountBalance[] }>(`/api/account-balances?${qstr(p)}`),
};

// The account panel beside the voucher screens: one ledger (or one sub-ledger of it) with its balance on the voucher date and its last posted entries.
export interface PeekEntry { kind: "JOURNAL" | "CASH_BANK"; voucherId: number; voucherNumber: string; voucherDate: string; narration: string | null; debit: string; credit: string }
export interface AccountPeek {
  ledger: { id: number; code: string; name: string; requiresSubLedger: boolean };
  subLedger: { id: number; code: string; name: string } | null;
  balance: { debit: string; credit: string };
  recent: PeekEntry[];
}
export const accountPeekApi = {
  get: (p: { companyId: number; branchId: number; fiscalYear: string; date: string; generalLedgerId: number; subLedgerId?: number | null; excludeJournalVoucherId?: number | null; excludeCashBankVoucherId?: number | null; limit?: number }) =>
    req<AccountPeek>(`/api/account-peek?${qstr(p)}`),
};

// ---- Journal voucher ------------------------------------------------------------------------------------------------------------
export interface JLookups {
  ledgers: { id: number; code: string; name: string; requiresSubLedger: boolean; isActive: boolean }[];
  subLedgers: { id: number; code: string; name: string; generalLedgerId: number; isActive: boolean }[];
  agents: { id: number; code: string; name: string; isActive: boolean }[];
  fiscalYears: PLookups["fiscalYears"];
}
export interface JDocLine {
  id: number; lineNumber: number; generalLedgerId: number; glCode: string; glName: string; subLedgerId: number | null; subCode: string | null; subName: string | null;
  agentId: number | null; agentName: string | null; debit: string; credit: string; narration: string | null;
}
export type JState = "DRAFT" | "POSTED" | "REVERSED" | "REVERSAL";
export interface JDoc {
  id: number; companyId: number; branchId: number; voucherNumber: string; numberSeriesId: number | null; voucherDate: string; fiscalYear: string; remarks: string | null;
  isPosted: boolean; postedAt: string | null; state: JState; source: string | null; reversalOf: { id: number; voucherNumber: string } | null; reversedBy: { id: number; voucherNumber: string } | null;
  totalDebit: string; totalCredit: string; editable: boolean; deletable: boolean; reversible: boolean; lines: JDocLine[]; settlements?: CbSettlement[];
}
export interface JListRow { id: number; branchId: number; voucherNumber: string; voucherDate: string; fiscalYear: string; remarks: string | null; state: JState; lineCount: number; totalAmount: string; source: string | null }
export interface JWrite { result: Record<string, any>; document: JDoc }
export const journalApi = {
  lookups: (companyId: number) => req<JLookups>(`/api/journal-vouchers/lookups?companyId=${companyId}`),
  list: (p: { companyId: number; branchId: number; fiscalYear: string; status?: string; search?: string }) => req<{ total: number; rows: JListRow[] }>(`/api/journal-vouchers?${qstr(p)}`),
  get: (id: number, companyId: number) => req<JDoc>(`/api/journal-vouchers/${id}?companyId=${companyId}`),
  create: (body: Record<string, unknown>) => req<JWrite>(`/api/journal-vouchers`, { method: "POST", body: JSON.stringify(body) }),
  update: (id: number, companyId: number, body: Record<string, unknown>) => req<JWrite>(`/api/journal-vouchers/${id}?companyId=${companyId}`, { method: "PUT", body: JSON.stringify(body) }),
  remove: (id: number, companyId: number, userId?: number, reason?: string) => req<{ result: { id: number } }>(`/api/journal-vouchers/${id}?${qstr({ companyId, userId, reason })}`, { method: "DELETE" }),
  action: (id: number, companyId: number, action: "post" | "reverse", body: Record<string, unknown> = {}) =>
    req<JWrite>(`/api/journal-vouchers/${id}/${action}?companyId=${companyId}`, { method: "POST", body: JSON.stringify(body) }),
};

export interface ProductPurchaseRow { billId: number; invoiceNumber: string; invoiceDate: string | null; vendorGLId: number; qty: string; rate: string }
export interface StockBalanceRow { productId: number; code: string; description: string; locationId: number | null; batchNo: string | null; expiryDate: string | null; qty: string }
export const stockApi = {
  balance: (p: { companyId: number; branchId?: number; productId?: number }) => req<StockBalanceRow[]>(`/api/stock/balance?${qstr(p)}`),
  valuation: (p: { companyId: number; branchId?: number; asOf?: string }) => req<{ asOf: string | null; rows: StockValuationRow[]; totalValue: string }>(`/api/stock/valuation?${qstr(p)}`),
};

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
  productHistory: (companyId: number, productId: number, limit = 5) => req<ProductPurchaseRow[]>(`/api/purchase/product-history?${qstr({ companyId, productId, limit })}`),
  billFromChallan: (companyId: number, challanId: number) => req<Record<string, any>>(`/api/purchase/bills/from-challan/${challanId}?companyId=${companyId}`),
};

export interface ImportAssessmentTermInput {
  termId: number; calcType?: "PERCENT" | "AMOUNT"; rate?: string | number | null; inputAmount?: string | number | null;
  isOverridden?: boolean; overrideAmount?: string | number | null; allocationBasis: "VALUE" | "QUANTITY"; capitalizable: boolean;
  againstLedgerId?: number | null; againstSubLedgerId?: number | null; allocationMode?: "AUTO" | "MANUAL"; manualAmounts?: { purchaseBillLineId: number; amount: string }[];
}
export interface ImportAssessmentPreview {
  goodsValue: string; customsValueFromSources: string; cifValue: string; invoicedCapitalizedCosts: string;
  existingPurchaseTermCosts: string; assessedNet: string; capitalizedAssessments: string; totalLandedValue: string;
  lines: { key?: number; id?: number; lineNumber: number; productCode?: string; description?: string; quantity?: string; goodsValue: string; customsValue: string; capitalizedSources: string; existingPurchaseTermCosts: string; capitalizedAssessments: string; landedValue: string; landedRate: string }[];
  [k: string]: any;
}
export const importAssessmentApi = {
  list: (p: { companyId: number; branchId: number; fiscalYear: string; status?: string; search?: string }) =>
    req<{ total: number; rows: Record<string, any>[] }>(`/api/purchase/import-assessments?${qstr(p)}`),
  eligibleImports: (p: { companyId: number; branchId: number; fiscalYear: string }) =>
    req<{ rows: Record<string, any>[] }>(`/api/purchase/import-assessments/eligible-imports?${qstr(p)}`),
  get: (id: number, companyId: number) => req<{ document: Record<string, any> }>(`/api/purchase/import-assessments/${id}?companyId=${companyId}`),
  preview: (body: Record<string, unknown>) => req<{ preview: ImportAssessmentPreview }>('/api/purchase/import-assessments/preview', { method: "POST", body: JSON.stringify(body) }),
  create: (body: Record<string, unknown>) => req<{ document: Record<string, any> }>('/api/purchase/import-assessments', { method: "POST", body: JSON.stringify(body) }),
  update: (id: number, companyId: number, body: Record<string, unknown>) => req<{ document: Record<string, any> }>(`/api/purchase/import-assessments/${id}?companyId=${companyId}`, { method: "PUT", body: JSON.stringify(body) }),
  remove: (id: number, companyId: number, userId: number) => req<{ result: { id: number } }>(`/api/purchase/import-assessments/${id}?${qstr({ companyId, userId })}`, { method: "DELETE" }),
  apply: (id: number, companyId: number, userId: number) => req<{ document: Record<string, any> }>(`/api/purchase/import-assessments/${id}/apply?companyId=${companyId}`, { method: "POST", body: JSON.stringify({ userId }) }),
  reverse: (id: number, companyId: number, userId: number, reason: string) => req<{ document: Record<string, any> }>(`/api/purchase/import-assessments/${id}/reverse?companyId=${companyId}`, { method: "POST", body: JSON.stringify({ userId, reason }) }),
};

// ---- Cash / Bank Voucher: /api/cash-bank-vouchers ----
export interface CbLedger { id: number; code: string; name: string; glType: string; requiresSubLedger: boolean; isCashOrBank: boolean; isActive: boolean }
export interface CbSubLedger { id: number; code: string; name: string; generalLedgerId: number; isActive: boolean }
export interface CbLookups { cashBankLedgers: CbLedger[]; ledgers: CbLedger[]; subLedgers: CbSubLedger[]; fiscalYears: { id: number; code: string; startDate: string; endDate: string; isActive: boolean; isClosed: boolean; isCurrent: boolean }[] }
export type CbStatus = "DRAFT" | "POSTED" | "REVERSED";
export interface CbEntry { id: number; lineNumber: number; generalLedgerId: number; code: string; name: string; glType: string; subLedgerId: number | null; subLedgerCode: string | null; subLedgerName: string | null; receipt: string; payment: string; narration: string }
export type SettleKind = "SALES_INVOICE" | "PURCHASE_BILL";
export interface CbSettlement { id: number; kind: SettleKind; documentId: number; number: string; date: string; generalLedgerId: number; amount: string }
export interface OpenDocument { id: number; kind: SettleKind; number: string; date: string; dueDate: string | null; total: string; settled: string; outstanding: string; overdueDays: number }
export type AgeBucketKey = "current" | "d1_30" | "d31_60" | "d61_90" | "d90";
export type AgeingRow = { generalLedgerId: number; code: string; name: string; bills: number; total: string; advance: string; net: string } & Record<AgeBucketKey, string>;
export interface AgeingReport { asOf: string; rows: AgeingRow[]; totals: Record<AgeBucketKey | "total" | "advance" | "net", string> & { bills: number } }
export interface OpenAdvance { voucherId: number; voucherNumber: string; date: string; amount: string; used: string; available: string }
export interface AdvanceApplied { id: number; voucherId: number; voucherNumber: string; date: string; amount: string }
export interface CbDoc {
  id: number; companyId: number; branchId: number; voucherNumber: string; voucherDate: string; fiscalYear: string; status: CbStatus; isPosted: boolean; isReversal: boolean;
  reversalOfId: number | null; reversedById: number | null; reversedByNumber: string | null; cashBankLedgerId: number | null; cashBankSubLedgerId: number | null; cashBankLedgerCode: string | null; cashBankLedgerName: string | null;
  instrumentType: string | null; chequeNumber: string | null; chequeDate: string | null; payeeReference: string; remarks: string; entries: CbEntry[];
  totalReceipts: string; totalPayments: string; openingBalance: string; closingBalance: string;
  settlements: CbSettlement[];
}
export interface CbListRow { id: number; branchId: number; voucherNumber: string; voucherDate: string; fiscalYear: string; status: CbStatus; isReversal: boolean; cashBankLedgerName: string; payeeReference: string; totalReceipts: string; totalPayments: string }
export interface CbBalance { net: string; side: "DR" | "CR"; amount: string }
export interface CbWrite { result: { id: number; [k: string]: unknown }; document: CbDoc }

export const cashBankApi = {
  lookups: (companyId: number) => req<CbLookups>(`/api/cash-bank-vouchers/lookups?companyId=${companyId}`),
  list: (p: { companyId: number; branchId?: number; fiscalYear?: string; status?: string; search?: string }) => req<{ total: number; rows: CbListRow[] }>(`/api/cash-bank-vouchers?${qstr(p)}`),
  get: (id: number, companyId: number) => req<CbDoc>(`/api/cash-bank-vouchers/${id}?companyId=${companyId}`),
  create: (body: Record<string, unknown>) => req<CbWrite>("/api/cash-bank-vouchers", { method: "POST", body: JSON.stringify(body) }),
  update: (id: number, companyId: number, body: Record<string, unknown>) => req<CbWrite>(`/api/cash-bank-vouchers/${id}?companyId=${companyId}`, { method: "PUT", body: JSON.stringify(body) }),
  remove: (id: number, companyId: number, userId: number) => req<{ result: { id: number } }>(`/api/cash-bank-vouchers/${id}?${qstr({ companyId, userId })}`, { method: "DELETE" }),
  post: (id: number, companyId: number, userId: number) => req<CbWrite>(`/api/cash-bank-vouchers/${id}/post?companyId=${companyId}`, { method: "POST", body: JSON.stringify({ userId }) }),
  reverse: (id: number, companyId: number, userId: number, reason: string, date?: string) =>
    req<CbWrite>(`/api/cash-bank-vouchers/${id}/reverse?companyId=${companyId}`, { method: "POST", body: JSON.stringify({ userId, reason, date }) }),
  ageing: (p: { companyId: number; kind: SettleKind; asOf?: string }) => req<AgeingReport>(`/api/cash-bank-vouchers/ageing?${qstr(p)}`),
  advances: (p: { companyId: number; kind: SettleKind; generalLedgerId: number }) =>
    req<{ rows: OpenAdvance[]; count: number; total: string }>(`/api/cash-bank-vouchers/advances?${qstr(p)}`),
  advanceApplications: (p: { companyId: number; kind: SettleKind; documentId: number }) =>
    req<{ rows: AdvanceApplied[] }>(`/api/cash-bank-vouchers/advances/applications?${qstr(p)}`),
  applyAdvances: (body: { companyId: number; userId: number; kind: SettleKind; documentId: number; date: string; items: { voucherId: number; amount: string }[] }) =>
    req<{ documentId: number; applied: string }>(`/api/cash-bank-vouchers/advances/apply?companyId=${body.companyId}`, { method: "POST", body: JSON.stringify(body) }),
  undoAdvance: (id: number, companyId: number, userId: number, reason: string) =>
    req<{ id: number }>(`/api/cash-bank-vouchers/advances/applications/${id}/undo?companyId=${companyId}`, { method: "POST", body: JSON.stringify({ userId, reason }) }),
  openDocuments: (p: { companyId: number; kind: SettleKind; generalLedgerId: number; all?: boolean }) =>
    req<{ rows: OpenDocument[]; count: number; total: string }>(`/api/cash-bank-vouchers/open-documents?${qstr({ ...p, all: p.all ? 1 : undefined })}`),
  balance: (p: { companyId: number; branchId: number; fiscalYear: string; generalLedgerId: number; date: string; excludeId?: number }) => req<CbBalance>(`/api/cash-bank-vouchers/balance?${qstr(p)}`),
};

// ---- Sales invoices: direct customer invoice flow ----
export interface SalesLookups {
  customers: { id: number; code: string; name: string; requiresSubLedger: boolean; isCashOrBank: boolean; creditLimit: string | null; creditDays: number | null }[];
  subLedgers: { id: number; code: string; name: string; generalLedgerId: number | null }[];
  agents: { id: number; code: string; name: string }[];
  locations: { id: number; code: string; name: string; isActive: boolean }[];
  products: {
    id: number; code: string; description: string; type: "STOCK" | "NON_STOCK" | "SERVICE";
    unitId: number | null; unitCode: string; salesRate: string | null; salesGLId: number | null;
    tracksBatch: boolean; tracksExpiry: boolean; defaultLocationId: number | null;
    alternateUnits: { unitId: number; unitCode: string; conversionFactor: string }[];
  }[];
  units: { id: number; code: string; name: string; decimalPlaces: number }[];
  terms: {
    id: number; code: string; name: string; category: "GENERAL" | "COSTING" | "ROUNDED"; nature: "ADDITIVE" | "DEDUCTIVE";
    isProductwise: boolean; isMandatory: boolean; isEditable: boolean; defaultCalcType: "PERCENT" | "AMOUNT"; defaultValue: string;
    calcBase: "ITEM_VALUE" | "RUNNING_TOTAL" | "SINGLE_TERM"; baseTermId: number | null; sequence: number;
    generalLedgerId: number | null; roundingMethod: "NEAREST" | "UP" | "DOWN" | null;
  }[];
  fiscalYears: { id: number; code: string; startDate: string; endDate: string; isCurrent: boolean; isClosed: boolean }[];
  series: { id: number; name: string; mode: SeriesMode; isDefault: boolean }[];
}
export type SalesInvoiceState = "DRAFT" | "POSTED" | "REVERSED" | "REVERSAL";
export interface SalesInvoiceRow {
  id: number; branchId: number; invoiceNumber: string; invoiceDate: string; fiscalYear: string; invoiceType: "LOCAL" | "EXPORT"; salesType: "GOODS_SALES" | "SERVICE_SALES"; customerGLId: number;
  customerCode: string; customerName: string; dueDate: string | null; isPosted: boolean; reversalOfId: number | null;
  basicAmount: string; termAmount: string; totalAmount: string; state: SalesInvoiceState;
}
export interface SalesInvoiceDoc {
  id: number; companyId: number; branchId: number; invoiceNumber: string; invoiceDate: string; fiscalYear: string; invoiceType: "LOCAL" | "EXPORT"; salesType: "GOODS_SALES" | "SERVICE_SALES";
  customerGLId: number; customerCode: string; customerName: string; subLedgerId: number | null; agentId: number | null;
  dueDays: number; dueDate: string | null; remarks: string | null; isPosted: boolean; state: SalesInvoiceState;
  reversalOfId: number | null; reversedBy: { id: number; invoiceNumber: string } | null;
  basicAmount: string; termAmount: string; totalAmount: string; lines: Record<string, any>[]; terms: Record<string, any>[];
  [key: string]: any;
}
export interface SalesInvoiceWrite { result: Record<string, any>; document: SalesInvoiceDoc }
export const salesInvoiceApi = {
  lookups: (p: { companyId: number; branchId: number; userId?: number }) => req<SalesLookups>(`/api/sales/invoices/lookups?${qstr(p)}`),
  list: (p: { companyId: number; branchId: number; fiscalYear: string; status?: string; search?: string; customerGLId?: number; limit?: number }) =>
    req<{ total: number; rows: SalesInvoiceRow[] }>(`/api/sales/invoices?${qstr(p)}`),
  get: (id: number, companyId: number) => req<SalesInvoiceDoc>(`/api/sales/invoices/${id}?companyId=${companyId}`),
  create: (body: Record<string, unknown>) => req<SalesInvoiceWrite>("/api/sales/invoices", { method: "POST", body: JSON.stringify(body) }),
  update: (id: number, companyId: number, body: Record<string, unknown>) => req<SalesInvoiceWrite>(`/api/sales/invoices/${id}?companyId=${companyId}`, { method: "PUT", body: JSON.stringify(body) }),
  remove: (id: number, companyId: number, userId: number) => req<{ result: { id: number; deleted: boolean } }>(`/api/sales/invoices/${id}?${qstr({ companyId, userId })}`, { method: "DELETE" }),
  post: (id: number, companyId: number, userId: number) => req<SalesInvoiceWrite>(`/api/sales/invoices/${id}/post?companyId=${companyId}`, { method: "POST", body: JSON.stringify({ userId }) }),
  reverse: (id: number, companyId: number, userId: number, reason: string, date?: string) => req<{ result: Record<string, any>; document: SalesInvoiceDoc }>(`/api/sales/invoices/${id}/reverse?companyId=${companyId}`, { method: "POST", body: JSON.stringify({ userId, reason, date }) }),
};

export interface SalesChallanRow {
  id: number; challanNumber: string; challanDate: string; fiscalYear: string; customerGLId: number; customerName: string; isConfirmed: boolean; totalAmount: string; status: "DRAFT" | "CONFIRMED";
}
export interface SalesChallanInvoiceSeed {
  salesChallanId: number; challanNumber: string; customerGLId: number; subLedgerId: number | null; agentId: number | null; branchId: number;
  lines: { challanLineId: number; lineNumber?: number; productId: number; qty: string; unitId: number; rate: string; locationId: number | null; batchNo: string | null; expiryDate: string | null }[];
}
export const salesChallanApi = {
  lookups: (p: { companyId: number; branchId: number; userId?: number }) => req<SalesLookups>(`/api/sales/challans/lookups?${qstr(p)}`),
  list: (p: { companyId: number; branchId: number; fiscalYear: string; status?: string; search?: string; customerGLId?: number; limit?: number }) =>
    req<SalesChallanRow[]>(`/api/sales/challans?${qstr(p)}`).then((rows) => ({ total: rows.length, rows })),
  get: (id: number, companyId: number) => req<Record<string, any>>(`/api/sales/challans/${id}?companyId=${companyId}`),
  create: (body: Record<string, unknown>) => req<{ result: Record<string, any>; document: Record<string, any> }>("/api/sales/challans", { method: "POST", body: JSON.stringify(body) }),
  update: (id: number, companyId: number, body: Record<string, unknown>) => req<{ result: Record<string, any>; document: Record<string, any> }>(`/api/sales/challans/${id}?companyId=${companyId}`, { method: "PUT", body: JSON.stringify(body) }),
  remove: (id: number, companyId: number, userId?: number) => req<{ result: { id: number } }>(`/api/sales/challans/${id}?${qstr({ companyId, userId })}`, { method: "DELETE" }),
  confirm: (id: number, companyId: number, userId?: number) => req<{ result: Record<string, any>; document: Record<string, any> }>(`/api/sales/challans/${id}/confirm?companyId=${companyId}`, { method: "POST", body: JSON.stringify({ userId }) }),
  invoiceSeed: (companyId: number, challanId: number) => req<SalesChallanInvoiceSeed>(`/api/sales/invoices/from-challan/${challanId}?companyId=${companyId}`),
};

export interface StockValuationRow {
  productId: number; code: string; description: string; unit: string; method: "FIFO" | "WEIGHTED_AVERAGE" | "STANDARD_COST";
  qty: string; rate: string; value: string; missingCost: boolean; negative: boolean;
  buckets: { locationId: number | null; locationName: string | null; batchNo: string | null; qty: string; value: string }[];
}


export type FinancialReportKind = "trial-balance" | "profit-loss" | "balance-sheet";
export interface FinancialReportRow {
  generalLedgerId: number; code: string; name: string;
  accountGroupId: number; accountGroupCode: string; accountGroupName: string; accountType: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
  accountSubGroupId: number | null; accountSubGroupCode: string | null; accountSubGroupName: string | null;
  opening: string; debit: string; credit: string; closing: string; net: string; closingDebit: string; closingCredit: string;
}
export interface FinancialReportResult {
  kind: FinancialReportKind; fiscalYear: string; from: string; to: string;
  rows: FinancialReportRow[];
  totals: { opening: number; debit: number; credit: number; closing: number; currentResult: string; balanced?: boolean };
}
export const financialReportsApi = {
  get: (kind: FinancialReportKind, p: { companyId: number; branchId: number; fiscalYear: string; from: string; to: string }) =>
    req<FinancialReportResult>(`/api/financial-reports/${kind}?${qstr(p)}`),
};
export type YearEndClosePreview = {
  fiscalYear: string; from: string; to: string; fiscalYearClosed: boolean;
  existingClose: { id: number; status: string } | null;
  ledger: { id: number; code: string; name: string };
  netResult: string;
  branches: { branchId: number; branchCode: string; branchName: string; netResult: string; lineCount: number }[];
};
export const yearEndCloseApi = {
  preview: (companyId: number, fiscalYear: string) => req<YearEndClosePreview>(`/api/year-end-close/preview?${qstr({ companyId, fiscalYear })}`),
  close: (companyId: number, fiscalYear: string, userId: number) => req<YearEndClosePreview & { closeId: number; closed: true }>("/api/year-end-close/close", { method: "POST", body: JSON.stringify({ companyId, fiscalYear, userId }) }),
  reopen: (companyId: number, fiscalYear: string, userId: number, reason: string) => req<{ fiscalYear: string; reopened: true; reversedVouchers: number }>(`/api/year-end-close/reopen/${encodeURIComponent(fiscalYear)}`, { method: "POST", body: JSON.stringify({ companyId, userId, reason }) }),
  status: (companyId: number, fiscalYear: string) => req<{ fiscalYear: string; isClosed: boolean; close: { id: number; status: string; netResult: string } | null; vouchers: { branchId: number; journalVoucherId: number; netResult: string }[] }>(`/api/year-end-close/status/${encodeURIComponent(fiscalYear)}?${qstr({ companyId })}`),
};
