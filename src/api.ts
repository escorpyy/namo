import type { ContextData } from "./types";
import type { Row } from "./lib/form";
import type { CodeMode, CodeRuleRow, CodeSuggestion } from "../shared/codeRules";
import type { SeriesMode, SeriesRow } from "../shared/numberSeries";

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
  update: (id: number, companyId: number, v: Record<string, unknown>) => req<Row>(`/api/masters/${key}/${id}?companyId=${companyId}`, { method: "PUT", body: JSON.stringify(v) }),
  remove: (id: number, companyId: number) => req<{ ok: true }>(`/api/masters/${key}/${id}?companyId=${companyId}`, { method: "DELETE" }),
});

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
  vendors: { id: number; code: string; name: string; requiresSubLedger: boolean; isActive: boolean; paymentTermDays: number | null }[];
  subLedgers: { id: number; code: string; name: string; generalLedgerId: number | null; isActive: boolean }[];
  agents: { id: number; code: string; name: string; isActive: boolean }[];
  locations: { id: number; code: string; name: string; isActive: boolean }[];
  units: { id: number; code: string; name: string; decimalPlaces: number }[];
  products: {
    id: number; code: string; description: string; type: "STOCK" | "NON_STOCK" | "SERVICE" | "FIXED_ASSET"; isActive: boolean; baseUnitId: number | null;
    tracksBatch: boolean; tracksExpiry: boolean; defaultLocationId: number | null; purchaseRate: string | null; alternateUnits: { unitId: number; conversionFactor: string }[];
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

export interface AccountBalance { generalLedgerId: number; subLedgerId: number | null; debit: string; credit: string }
export const accountBalancesApi = {
  get: (p: { companyId: number; branchId: number; fiscalYear: string; date: string; excludeJournalVoucherId?: number; excludeCashBankVoucherId?: number }) =>
    req<{ rows: AccountBalance[] }>(`/api/account-balances?${qstr(p)}`),
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
  totalDebit: string; totalCredit: string; editable: boolean; deletable: boolean; reversible: boolean; lines: JDocLine[];
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
export interface CbDoc {
  id: number; companyId: number; branchId: number; voucherNumber: string; voucherDate: string; fiscalYear: string; status: CbStatus; isPosted: boolean; isReversal: boolean;
  reversalOfId: number | null; reversedById: number | null; reversedByNumber: string | null; cashBankLedgerId: number | null; cashBankSubLedgerId: number | null; cashBankLedgerCode: string | null; cashBankLedgerName: string | null;
  instrumentType: string | null; chequeNumber: string | null; chequeDate: string | null; payeeReference: string; remarks: string; entries: CbEntry[];
  totalReceipts: string; totalPayments: string; openingBalance: string; closingBalance: string;
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
  balance: (p: { companyId: number; branchId: number; fiscalYear: string; generalLedgerId: number; date: string; excludeId?: number }) => req<CbBalance>(`/api/cash-bank-vouchers/balance?${qstr(p)}`),
};
