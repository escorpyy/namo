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
