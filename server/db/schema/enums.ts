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
// BILLING TERMS
// ============================================================

export const billingTermCategoryEnum = pgEnum("BillingTermCategory", [
  "GENERAL",
  "ADDITIONAL",
  "ROUNDED",
  "TAX",
  "DISCOUNT",
  "WITHHOLDING",
  "RETENTION",
]);

export const billingTermNatureEnum = pgEnum("BillingTermNature", [
  "CHARGE",
  "DISCOUNT",
  "TAX",
  "WITHHOLDING",
  "RETENTION",
  "ROUNDING",
  "ADJUSTMENT",
]);

export const billingApplicabilityEnum = pgEnum("BillingApplicability", [
  "PURCHASE",
  "SALES",
  "BOTH",
]);

export const billingDocumentTypeEnum = pgEnum("BillingDocumentType", [
  "PURCHASE_ORDER",
  "PURCHASE_RECEIPT",
  "PURCHASE_INVOICE",
  "PURCHASE_RETURN",
  "PURCHASE_DEBIT_NOTE",
  "SALES_QUOTATION",
  "SALES_ORDER",
  "DELIVERY_NOTE",
  "SALES_INVOICE",
  "SALES_RETURN",
  "SALES_CREDIT_NOTE",
  "DEBIT_NOTE",
  "CREDIT_NOTE",
  "EXPENSE_CLAIM",
  "LANDED_COST",
  "OTHER",
]);

export const billingPlacementEnum = pgEnum("BillingPlacement", [
  "HEADER",
  "LINE",
]);

export const billingCalculationMethodEnum = pgEnum("BillingCalculationMethod", [
  "PERCENTAGE",
  "FIXED_AMOUNT",
  "QUANTITY_RATE",
  "ACTUAL_AMOUNT",
  "PREVIOUS_ROW_PERCENTAGE",
  "PREVIOUS_ROW_AMOUNT",
  "FORMULA",
  "BALANCE_ADJUSTMENT",
]);

export const billingCalculationBasisEnum = pgEnum("BillingCalculationBasis", [
  "QUANTITY",
  "NET_VALUE",
  "GROSS_VALUE",
  "TAXABLE_VALUE",
  "PREVIOUS_TERM",
  "DOCUMENT_TOTAL",
  "SELECTED_LINES",
  "WEIGHT",
  "VOLUME",
  "MANUAL",
]);

export const billingSignEnum = pgEnum("BillingSign", ["ADD", "DEDUCT"]);

export const billingValuationTreatmentEnum = pgEnum("BillingValuationTreatment", [
  "NONE",
  "CAPITALIZE",
  "ALLOCATE_TO_STOCK",
  "REDUCE_STOCK_COST",
]);

export const billingAllocationBasisEnum = pgEnum("BillingAllocationBasis", [
  "VALUE",
  "QUANTITY",
  "WEIGHT",
  "VOLUME",
  "EQUAL",
  "MANUAL",
]);

export const billingTaxTreatmentEnum = pgEnum("BillingTaxTreatment", [
  "NOT_APPLICABLE",
  "RECOVERABLE",
  "NON_RECOVERABLE",
  "PARTIALLY_RECOVERABLE",
]);

export const billingRoundingMethodEnum = pgEnum("BillingRoundingMethod", [
  "HALF_UP",
  "HALF_EVEN",
  "DOWN",
  "UP",
  "FLOOR",
  "CEIL",
]);

export const billingTermStatusEnum = pgEnum("BillingTermStatus", [
  "DRAFT",
  "ACTIVE",
  "INACTIVE",
  "ARCHIVED",
]);
