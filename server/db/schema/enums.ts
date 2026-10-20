import { pgEnum } from "drizzle-orm/pg-core";

// Postgres type names match what Prisma created ("AccountType", etc.)

export const accountTypeEnum = pgEnum("AccountType", [
  "ASSET",
  "LIABILITY",
  "EQUITY",
  "REVENUE",
  "EXPENSE",
]);

export const normalBalanceEnum = pgEnum("NormalBalance", ["DEBIT", "CREDIT"]);

export const glTypeEnum = pgEnum("GLType", [
  "CUSTOMER",
  "VENDOR",
  "BOTH",
  "OTHER",
]);

export const auditActionEnum = pgEnum("AuditAction", [
  "INSERT",
  "UPDATE",
  "DELETE",
]);

export const documentTypeEnum = pgEnum("DocumentType", [
  "CASH_BANK_VOUCHER",
  "JOURNAL_VOUCHER",
  "SALES_INVOICE",
  "PURCHASE_BILL",
]);

export const calendarPreferenceEnum = pgEnum("CalendarPreference", [
  "BS",
  "AD",
]);

export const instrumentTypeEnum = pgEnum("InstrumentType", [
  "CHEQUE",
  "RTGS",
  "ONLINE_TRANSFER",
  "OTHER",
]);

export const businessTypeEnum = pgEnum("BusinessType", [
  "SOLE_PROPRIETORSHIP",
  "PARTNERSHIP",
  "PRIVATE_LIMITED",
  "PUBLIC_LIMITED",
  "OTHER",
]);

// Access level a user has within a company. Simple enum on purpose —
// fine-grained per-screen permissions are out of scope until needed.
export const companyRoleEnum = pgEnum("CompanyRole", [
  "ADMIN",
  "ACCOUNTANT",
  "VIEWER",
]);

export const productTypeEnum = pgEnum("ProductType", [
  "STOCK",
  "NON_STOCK",
  "SERVICE",
  "FIXED_ASSET",
  "BUNDLE",
]);

export const valuationMethodEnum = pgEnum("ValuationMethod", [
  "FIFO",
  "WEIGHTED_AVERAGE",
  "STANDARD_COST",
]);

export const depreciationMethodEnum = pgEnum("DepreciationMethod", [
  "STRAIGHT_LINE",
  "WRITTEN_DOWN_VALUE",
]);

// ============================================================
// BILLING TERMS (purchase & sales share these enums, not tables)
// ============================================================

export const billingTermCategoryEnum = pgEnum("BillingTermCategory", [
  "GENERAL",
  "ADDITIONAL",
  "ROUNDED",
]);

// Fixed in the term master; users cannot flip it on a document.
export const billingTermNatureEnum = pgEnum("BillingTermNature", [
  "ADDITIVE",
  "DEDUCTIVE",
]);

// Users may switch between % and amount while entering a term on a document.
export const billingCalcTypeEnum = pgEnum("BillingCalcType", [
  "PERCENT",
  "AMOUNT",
]);

// What a percentage is applied to. Chosen once, in the term master.
//   ITEM_VALUE    - gross value of the item line(s)
//   RUNNING_TOTAL - items plus all earlier terms (by sequence)
//   SINGLE_TERM   - the result of one specific earlier term (baseTermId)
export const billingCalcBaseEnum = pgEnum("BillingCalcBase", [
  "ITEM_VALUE",
  "RUNNING_TOTAL",
  "SINGLE_TERM",
]);

export const billingAllocationBasisEnum = pgEnum("BillingAllocationBasis", [
  "QUANTITY",
  "VALUE",
]);

export const purchaseTermDocTypeEnum = pgEnum("PurchaseTermDocType", [
  "PURCHASE_ORDER",
  "PURCHASE_BILL",
  "PURCHASE_RETURN",
]);

export const salesTermDocTypeEnum = pgEnum("SalesTermDocType", [
  "SALES_ORDER",
  "SALES_INVOICE",
  "SALES_RETURN",
]);
