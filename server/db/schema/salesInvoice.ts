import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  serial,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { createdAt, money, updatedAt } from "./_helpers";
import { documentTypeEnum, salesInvoiceTypeEnum, salesTypeEnum } from "./enums";
import { branch, company, user } from "./core";
import { numberSeries } from "./numberSeries";
import { generalLedger, subLedger } from "./accounting";
import { journalVoucher } from "./vouchers";
import { agent } from "./parties";
import { location, product, productUnit } from "./products";

// ============================================================
// SALES INVOICE  (direct customer invoice: no challan / order yet)
//
// Header -> SalesInvoice, grid rows -> SalesInvoiceLine.
// Billing terms (VAT, discount, freight, ...) are NOT columns here. They live
// in SalesDocumentTerm with documentType = 'SALES_INVOICE' and
// documentId = SalesInvoice.id (line terms also carry documentLineId).
// SalesInvoice.termAmount is the stored sum of those terms.
//
// Rules left to the service layer (services/salesInvoice.ts):
//   - totals (basicAmount, termAmount, totalAmount) = sum of lines / terms
//   - Dr = Cr when the invoice posts its journal; posted invoices are immutable
//   - dueDate = invoiceDate + dueDays unless the user overrides it
//   - qty = altQty * AlternateUnit.conversionFactor when an alt unit is used
//   - isPosted and journalVoucherId are set together by the posting service
//
// Drizzle returns numeric as string; use shared/decimal.ts for arithmetic.
// ============================================================

export const salesInvoice = pgTable(
  "SalesInvoice",
  {
    id: serial().primaryKey(),
    companyId: integer()
      .notNull()
      .references(() => company.id, { onDelete: "restrict" }),
    branchId: integer()
      .notNull()
      .references(() => branch.id, { onDelete: "restrict" }),

    documentType: documentTypeEnum().notNull().default("SALES_INVOICE"),

    // Domestic (LOCAL) or EXPORT, and goods or service: the VAT sales-book classification.
    invoiceType: salesInvoiceTypeEnum().notNull().default("LOCAL"),
    salesType: salesTypeEnum().notNull().default("GOODS_SALES"),

    // Numbering restarts every fiscal year, so unique per branch + fiscal year.
    invoiceNumber: varchar({ length: 30 }).notNull(),
    // the number series this document's number came from (null = typed with none)
    numberSeriesId: integer().references(() => numberSeries.id, { onDelete: "set null" }),
    // AD is the only source of truth; BS is derived for display.
    invoiceDate: date({ mode: "date" }).notNull(),
    fiscalYear: varchar({ length: 15 }).notNull(),

    // "Customer" is a ledger on the screen (e.g. CASH SALES), not always a Party.
    customerGLId: integer()
      .notNull()
      .references(() => generalLedger.id, { onDelete: "restrict" }),
    subLedgerId: integer().references(() => subLedger.id, { onDelete: "restrict" }),
    agentId: integer().references(() => agent.id, { onDelete: "set null" }),

    dueDays: integer().notNull().default(0),
    dueDate: date({ mode: "date" }),

    // Footer. All stored so reports and posting need no recalculation.
    basicAmount: money().notNull().default("0"), // sum of line basicAmount
    termAmount: money().notNull().default("0"), // net of additive/deductive terms
    totalAmount: money().notNull().default("0"),

    remarks: varchar({ length: 1024 }),

    // EXPORT invoices only (all optional; the service layer clears them on a LOCAL invoice).
    // Money on an export is entered in exportCurrency when it is not NPR: each line keeps its foreignRate, the NPR rate/amount are
    // foreignRate x exportExchangeRate (Nepal Rastra Bank rate of the day), and only the NPR figures are posted.
    exportCurrency: varchar({ length: 3 }),
    exportExchangeRate: numeric({ precision: 18, scale: 6 }),
    exportForeignTotal: numeric({ precision: 18, scale: 6 }),
    salesContractNo: varchar({ length: 40 }),
    salesContractDate: date({ mode: "date" }),
    notifyParty: varchar({ length: 200 }),
    buyerOrderNo: varchar({ length: 40 }),
    buyerOrderDate: date({ mode: "date" }),
    buyerTaxId: varchar({ length: 40 }),
    customsDeclarationNo: varchar({ length: 30 }),
    customsDeclarationDate: date({ mode: "date" }),
    customsOfficeExit: varchar({ length: 100 }),
    certificateOfOriginNo: varchar({ length: 40 }),
    preferentialScheme: varchar({ length: 60 }),
    incoterm: varchar({ length: 10 }),
    incotermPlace: varchar({ length: 60 }),
    transportMode: varchar({ length: 10 }),
    pointOfLoading: varchar({ length: 60 }),
    pointOfDischarge: varchar({ length: 60 }),
    finalDestination: varchar({ length: 60 }),
    vehicleNo: varchar({ length: 40 }),
    transportDocNo: varchar({ length: 40 }),
    transportDocDate: date({ mode: "date" }),
    packagesMarks: varchar({ length: 200 }),
    grossWeight: numeric({ precision: 18, scale: 6 }),
    netWeight: numeric({ precision: 18, scale: 6 }),
    paymentTerms: varchar({ length: 60 }),
    fxReference: varchar({ length: 60 }),
    bankAccountName: varchar({ length: 100 }),
    bankAccountNo: varchar({ length: 40 }),
    bankName: varchar({ length: 100 }),
    bankSwift: varchar({ length: 20 }),

    reversalOfId: integer().references((): AnyPgColumn => salesInvoice.id, {
      onDelete: "set null",
    }),

    // The journal voucher this invoice posted. Set together with isPosted; a
    // reversal invoice posts its own voucher.
    journalVoucherId: integer().references(() => journalVoucher.id, {
      onDelete: "restrict",
    }),

    isPosted: boolean().notNull().default(false),
    postedAt: timestamp({ precision: 3 }),
    postedBy: integer().references(() => user.id, { onDelete: "set null" }),

    createdBy: integer().references(() => user.id, { onDelete: "set null" }),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("SalesInvoice_branchId_fiscalYear_invoiceNumber_key").on(
      t.branchId,
      t.fiscalYear,
      t.invoiceNumber,
    ),
    // One voucher belongs to at most one invoice.
    uniqueIndex("SalesInvoice_journalVoucherId_key")
      .on(t.journalVoucherId)
      .where(sql`${t.journalVoucherId} IS NOT NULL`),
    // An invoice can be reversed by at most one posted reversal.
    uniqueIndex("SalesInvoice_posted_reversalOfId_key")
      .on(t.reversalOfId)
      .where(sql`${t.reversalOfId} IS NOT NULL AND ${t.isPosted} = true`),
    index("SalesInvoice_companyId_idx").on(t.companyId),
    index("SalesInvoice_branchId_idx").on(t.branchId),
    index("SalesInvoice_customerGLId_idx").on(t.customerGLId),
    index("SalesInvoice_subLedgerId_idx").on(t.subLedgerId),
    index("SalesInvoice_agentId_idx").on(t.agentId),
    index("SalesInvoice_fiscalYear_idx").on(t.fiscalYear),
    index("SalesInvoice_invoiceDate_idx").on(t.invoiceDate),
    check("SalesInvoice_dueDays_check", sql`${t.dueDays} >= 0`),
    check(
      "SalesInvoice_not_own_reversal_check",
      sql`${t.reversalOfId} IS NULL OR ${t.reversalOfId} <> ${t.id}`,
    ),
    check("SalesInvoice_export_only_check", sql`${t.invoiceType} = 'EXPORT' OR (${t.exportCurrency} IS NULL AND ${t.customsDeclarationNo} IS NULL AND ${t.finalDestination} IS NULL)`),
    check("SalesInvoice_export_currency_check", sql`(${t.exportCurrency} IS NULL AND ${t.exportExchangeRate} IS NULL AND ${t.exportForeignTotal} IS NULL) OR (${t.exportCurrency} ~ '^[A-Z]{3}$' AND ${t.exportExchangeRate} > 0)`),
    check("SalesInvoice_documentType_check", sql`${t.documentType} = 'SALES_INVOICE'`),
    // A posted invoice must say which voucher it posted.
    check(
      "SalesInvoice_posted_voucher_check",
      sql`NOT ${t.isPosted} OR ${t.journalVoucherId} IS NOT NULL`,
    ),
  ],
);

// The grid: S.No, Product, Alt Qty, Uom, Qty, Uom, Rate, Basic Amt.
export const salesInvoiceLine = pgTable(
  "SalesInvoiceLine",
  {
    id: serial().primaryKey(),
    salesInvoiceId: integer()
      .notNull()
      .references(() => salesInvoice.id, { onDelete: "cascade" }),

    lineNumber: integer().notNull(), // S.No
    productId: integer()
      .notNull()
      .references(() => product.id, { onDelete: "restrict" }),

    // Alternate quantity and unit come as a pair (both or neither).
    altQty: numeric({ precision: 18, scale: 6 }),
    altUnitId: integer().references(() => productUnit.id, { onDelete: "restrict" }),
    qty: numeric({ precision: 18, scale: 6 }).notNull(),
    unitId: integer()
      .notNull()
      .references(() => productUnit.id, { onDelete: "restrict" }),
    rate: numeric({ precision: 18, scale: 6 }).notNull(),
    basicAmount: numeric({ precision: 18, scale: 6 }).notNull(),
    // export invoice in a foreign currency: the rate and amount as typed, in that currency (rate/basicAmount above stay NPR)
    foreignRate: numeric({ precision: 18, scale: 6 }),
    foreignAmount: numeric({ precision: 18, scale: 6 }),
    // stock products: where the goods are taken from. Posting takes this qty out of stock in this location and batch.
    locationId: integer().references(() => location.id, { onDelete: "restrict" }),
    batchNo: varchar({ length: 50 }),
    expiryDate: date({ mode: "date" }),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("SalesInvoiceLine_invoice_lineNumber_key").on(t.salesInvoiceId, t.lineNumber),
    index("SalesInvoiceLine_productId_idx").on(t.productId),
    index("SalesInvoiceLine_unitId_idx").on(t.unitId),
    index("SalesInvoiceLine_altUnitId_idx").on(t.altUnitId),
    index("SalesInvoiceLine_locationId_idx").on(t.locationId),
    check("SalesInvoiceLine_lineNumber_check", sql`${t.lineNumber} > 0`),
    check(
      "SalesInvoiceLine_amounts_check",
      sql`${t.qty} > 0 AND ${t.rate} >= 0 AND ${t.basicAmount} >= 0`,
    ),
    check(
      "SalesInvoiceLine_alt_pair_check",
      sql`(${t.altQty} IS NULL) = (${t.altUnitId} IS NULL)`,
    ),
  ],
);
