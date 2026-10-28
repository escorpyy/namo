import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  serial,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { createdAt, money, updatedAt } from "./_helpers";
import {
  documentTypeEnum,
  importTransportModeEnum,
  purchaseInvoiceTypeEnum,
  purchaseTypeEnum,
} from "./enums";
import { branch, company, user } from "./core";
import { generalLedger, subLedger } from "./accounting";
import { journalVoucher } from "./vouchers";
import { agent } from "./parties";
import { location, product, productUnit } from "./products";
import { purchaseOrder, purchaseOrderLine } from "./purchaseOrder";
import { purchaseChallan, purchaseChallanLine } from "./purchaseChallan";

// ============================================================
// PURCHASE BILL  (legacy screen: "Purchase Invoice")
//
// Header -> PurchaseBill, grid rows -> PurchaseBillLine, the
// "Import/Transport Details" tab -> PurchaseBillImportDetail (1:1).
//
// Billing terms (VAT, discount, freight, ...) are NOT columns here. They live
// in PurchaseDocumentTerm with documentType = 'PURCHASE_BILL' and
// documentId = PurchaseBill.id (line terms also carry documentLineId).
// PurchaseBill.termAmount is the stored sum of those terms.
//
// Not stored on purpose (the screen shows them, but they are derived):
//   Credit Limit / Current Balance / Outstanding Challan / Total Outstanding
//     -> vendor ledger + CustomerDetail/VendorDetail, computed on read
//   Stock Qty / Alt Stock Qty -> stock ledger, computed on read
//   Total Qty / Total Alt Qty -> sums of the lines, computed on read
//
// Rules left to the service layer:
//   - totals (basicAmount, termAmount, totalAmount) = sum of lines / terms
//   - Dr = Cr when the bill posts its journal; posted bills are immutable
//   - dueDate = billDate + dueDays unless the user overrides it
//   - qty = altQty * AlternateUnit.conversionFactor when an alt unit is used
//   - fiscalYear must exist and be open for the company
//   - an Import bill should carry an import detail row (the reverse is DB-enforced)
//   - isPosted and journalVoucherId are set together by the posting service
//   - landed cost: allocations are computed by the service, stored on lines
//   - billed qty may not exceed the challan / order line's pending qty
//   - serial numbers are not modelled: StockDetail has no tracksSerial yet
//
// Drizzle returns numeric as string; use shared/decimal.ts for arithmetic.
// ============================================================

export const purchaseBill = pgTable(
  "PurchaseBill",
  {
    id: serial().primaryKey(),
    companyId: integer()
      .notNull()
      .references(() => company.id, { onDelete: "restrict" }),
    branchId: integer()
      .notNull()
      .references(() => branch.id, { onDelete: "restrict" }),

    documentType: documentTypeEnum().notNull().default("PURCHASE_BILL"),
    // Domestic (LOCAL) or IMPORT, chosen when the bill is issued.
    // IMPORT is the switch that enables PurchaseBillImportDetail.
    invoiceType: purchaseInvoiceTypeEnum().notNull().default("LOCAL"),
    // Goods or service, capital or other (VAT purchase book classification).
    purchaseType: purchaseTypeEnum().notNull().default("GOODS_PURCHASE_OTHERS"),

    // "Invoice No". Numbering restarts every fiscal year, so unique per
    // branch + fiscal year (vouchers are unique per branch only).
    invoiceNumber: varchar({ length: 30 }).notNull(),
    // "Date". AD is the only source of truth; BS is derived for display.
    invoiceDate: date({ mode: "date" }).notNull(),
    fiscalYear: varchar({ length: 15 }).notNull(),

    // "Vendor" is a ledger on the screen (e.g. CASH A/C), not always a Party.
    // The Party, when there is one, is reachable through Party.generalLedgerId.
    vendorGLId: integer()
      .notNull()
      .references(() => generalLedger.id, { onDelete: "restrict" }),
    subLedgerId: integer().references(() => subLedger.id, {
      onDelete: "restrict",
    }),
    agentId: integer().references(() => agent.id, { onDelete: "set null" }),

    // "P. Inv No" + "Date": the vendor's own invoice, needed for the VAT
    // purchase book.
    vendorInvoiceNo: varchar({ length: 30 }),
    vendorInvoiceDate: date({ mode: "date" }),

    // "Ch No" / "O/A No": the challan (goods receipt) and order this bill
    // closes. Both optional: a service or cash purchase has neither. The line
    // level links (challanLineId / purchaseOrderLineId) say which lines.
    purchaseChallanId: integer().references(() => purchaseChallan.id, {
      onDelete: "restrict",
    }),
    purchaseOrderId: integer().references(() => purchaseOrder.id, {
      onDelete: "restrict",
    }),

    // "Due Days" + "Date" next to it
    dueDays: integer().notNull().default(0),
    dueDate: date({ mode: "date" }),

    // Footer. All stored so reports and posting need no recalculation.
    basicAmount: money().notNull().default("0"), // sum of line basicAmount
    termAmount: money().notNull().default("0"), // net of additive/deductive terms
    totalAmount: money().notNull().default("0"),

    remarks: varchar({ length: 1024 }),

    // ADDITIONAL PURCHASE. When set, this bill is an additional invoice of the
    // main bill: it carries the actual additional charges (import duty, excise,
    // exchange charges, rounding variance, CSF, CVF, ...) as ADDITIONAL-category
    // purchase terms. Terms that distribute to lines re-value the MAIN bill's
    // stock (see the allocation rules in migration 0005). One level only: a main
    // bill cannot itself be additional.
    mainBillId: integer().references((): AnyPgColumn => purchaseBill.id, {
      onDelete: "restrict",
    }),
    reversalOfId: integer().references((): AnyPgColumn => purchaseBill.id, {
      onDelete: "set null",
    }),

    // The journal voucher this bill posted. Set together with isPosted; a
    // reversal bill posts its own voucher. Needed to trace and reverse a bill.
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
    uniqueIndex("PurchaseBill_branchId_fiscalYear_invoiceNumber_key").on(
      t.branchId,
      t.fiscalYear,
      t.invoiceNumber,
    ),
    // Catches the same vendor bill being keyed in twice.
    uniqueIndex("PurchaseBill_vendor_vendorInvoiceNo_key")
      .on(t.companyId, t.vendorGLId, t.vendorInvoiceNo)
      .where(sql`${t.vendorInvoiceNo} IS NOT NULL`),
    index("PurchaseBill_companyId_idx").on(t.companyId),
    index("PurchaseBill_branchId_idx").on(t.branchId),
    index("PurchaseBill_vendorGLId_idx").on(t.vendorGLId),
    index("PurchaseBill_subLedgerId_idx").on(t.subLedgerId),
    index("PurchaseBill_agentId_idx").on(t.agentId),
    index("PurchaseBill_mainBillId_idx").on(t.mainBillId),
    index("PurchaseBill_purchaseChallanId_idx").on(t.purchaseChallanId),
    index("PurchaseBill_purchaseOrderId_idx").on(t.purchaseOrderId),
    index("PurchaseBill_purchaseType_idx").on(t.purchaseType),
    // One voucher belongs to at most one bill.
    uniqueIndex("PurchaseBill_journalVoucherId_key")
      .on(t.journalVoucherId)
      .where(sql`${t.journalVoucherId} IS NOT NULL`),
    // A posted bill must say which voucher it posted.
    check(
      "PurchaseBill_posted_voucher_check",
      sql`NOT ${t.isPosted} OR ${t.journalVoucherId} IS NOT NULL`,
    ),
    index("PurchaseBill_fiscalYear_idx").on(t.fiscalYear),
    index("PurchaseBill_invoiceDate_idx").on(t.invoiceDate),
    check("PurchaseBill_dueDays_check", sql`${t.dueDays} >= 0`),
    check(
      "PurchaseBill_not_own_main_check",
      sql`${t.mainBillId} IS NULL OR ${t.mainBillId} <> ${t.id}`,
    ),
    check(
      "PurchaseBill_documentType_check",
      sql`${t.documentType} = 'PURCHASE_BILL'`,
    ),
  ],
);

// The grid: S.No, Alt Qty, Uom, Qty, Uom, Rate, Basic Amt.
export const purchaseBillLine = pgTable(
  "PurchaseBillLine",
  {
    id: serial().primaryKey(),
    purchaseBillId: integer()
      .notNull()
      .references(() => purchaseBill.id, { onDelete: "cascade" }),

    lineNumber: integer().notNull(), // S.No
    productId: integer()
      .notNull()
      .references(() => product.id, { onDelete: "restrict" }),

    // What this line bills. The challan line must belong to the bill's own
    // challan, the order line to the bill's own order, and the product must
    // match (enforced by the database). Quantity left to bill on a challan /
    // order line is derived from these links, not stored.
    challanLineId: integer().references(() => purchaseChallanLine.id, {
      onDelete: "restrict",
    }),
    purchaseOrderLineId: integer().references(() => purchaseOrderLine.id, {
      onDelete: "restrict",
    }),

    // First Uom pair: the alternate unit the goods were bought in.
    altQty: money(),
    altUnitId: integer().references(() => productUnit.id, {
      onDelete: "restrict",
    }),

    // Second Uom pair: quantity in the unit stock is kept in.
    qty: money().notNull(),
    unitId: integer()
      .notNull()
      .references(() => productUnit.id, { onDelete: "restrict" }),

    rate: money().notNull().default("0"),
    basicAmount: money().notNull().default("0"), // qty * rate

    // Landed cost result (item 8). Header terms flagged distributeToLines are
    // split over the lines in PurchaseDocumentTermAllocation; the sums are
    // stored here so stock valuation does not recalculate them.
    //   allocatedTermAmount = additive allocations - deductive allocations
    //   landedAmount        = basicAmount + allocatedTermAmount
    //   landedRate          = landedAmount / qty   (cost per stock unit)
    allocatedTermAmount: money().notNull().default("0"),
    landedAmount: money().notNull().default("0"),
    landedRate: money().notNull().default("0"),

    // Stock receipt data (item 7). Where the goods went in, and which batch.
    // Required only when the product tracks batch / expiry: service layer.
    locationId: integer().references(() => location.id, {
      onDelete: "set null",
    }),
    batchNo: varchar({ length: 50 }),
    manufactureDate: date({ mode: "date" }),
    expiryDate: date({ mode: "date" }),

    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("PurchaseBillLine_purchaseBillId_lineNumber_key").on(
      t.purchaseBillId,
      t.lineNumber,
    ),
    index("PurchaseBillLine_productId_idx").on(t.productId),
    index("PurchaseBillLine_challanLineId_idx").on(t.challanLineId),
    index("PurchaseBillLine_purchaseOrderLineId_idx").on(t.purchaseOrderLineId),
    index("PurchaseBillLine_altUnitId_idx").on(t.altUnitId),
    index("PurchaseBillLine_unitId_idx").on(t.unitId),
    index("PurchaseBillLine_locationId_idx").on(t.locationId),
    index("PurchaseBillLine_batchNo_idx").on(t.productId, t.batchNo),
    check(
      "PurchaseBillLine_landed_check",
      sql`${t.landedAmount} >= 0 AND ${t.landedRate} >= 0`,
    ),
    check(
      "PurchaseBillLine_expiry_check",
      sql`${t.manufactureDate} IS NULL OR ${t.expiryDate} IS NULL OR ${t.expiryDate} >= ${t.manufactureDate}`,
    ),
    check("PurchaseBillLine_lineNumber_check", sql`${t.lineNumber} > 0`),
    check(
      "PurchaseBillLine_amounts_check",
      sql`${t.qty} >= 0 AND ${t.rate} >= 0 AND ${t.basicAmount} >= 0`,
    ),
    // Alt qty and alt unit come as a pair.
    check(
      "PurchaseBillLine_alt_pair_check",
      sql`(${t.altQty} IS NULL) = (${t.altUnitId} IS NULL)`,
    ),
  ],
);

// "Import/Transport Details" tab.
//
// SWITCH: this row may exist only while PurchaseBill.invoiceType = 'IMPORT'.
// The database enforces it (triggers in migration 0003): inserting a detail for
// a non-import bill, or switching a bill away from IMPORT while a detail
// exists, is rejected. The UI shows the tab only for import bills.
//
// Based on the Nepal import flow: the importer (or clearing agent) files the
// customs declaration (Pragyapan Patra) at a customs office, pays customs duty,
// excise and VAT, and customs certifies the import. The declaration number and
// date are what the VAT purchase book and the import VAT claim refer to. The
// customs charges themselves are entered on the additional purchase as terms. Goods
// normally also have a letter of credit (opened through a bank) and a bill of
// lading / airway bill. A permit is needed only for restricted goods, so it is
// optional here. Everything is optional except the switch: required fields
// before posting are a service-layer rule (customsDeclarationNo for IMPORT).
//
// One declaration per bill. A bill cleared in several consignments, or one
// declaration covering several bills, needs a separate declaration table later.
export const purchaseBillImportDetail = pgTable(
  "PurchaseBillImportDetail",
  {
    id: serial().primaryKey(),
    purchaseBillId: integer()
      .notNull()
      .references(() => purchaseBill.id, { onDelete: "cascade" }),

    // Customs declaration = Pragyapan Patra
    customsDeclarationNo: varchar({ length: 30 }),
    customsDeclarationDate: date({ mode: "date" }),
    customsOffice: varchar({ length: 100 }), // entry point, e.g. Birgunj
    countryOfOrigin: varchar({ length: 50 }),

    // No duty / excise / VAT amounts here: those are purchase terms on the
    // additional purchase (PurchaseDocumentTerm), not columns.

    // Payment: letter of credit
    lcNo: varchar({ length: 30 }),
    lcDate: date({ mode: "date" }),
    lcBankName: varchar({ length: 100 }),

    // Shipment: bill of lading / airway bill / lorry receipt
    transportMode: importTransportModeEnum(),
    blAwbNo: varchar({ length: 30 }),
    blAwbDate: date({ mode: "date" }),
    transporterName: varchar({ length: 100 }),
    vehicleNo: varchar({ length: 30 }),
    lrNo: varchar({ length: 30 }),
    lrDate: date({ mode: "date" }),

    // Only for restricted goods
    importPermitNo: varchar({ length: 30 }),
    importPermitDate: date({ mode: "date" }),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("PurchaseBillImportDetail_purchaseBillId_key").on(
      t.purchaseBillId,
    ),
    // The same declaration cannot be used by two bills of one company twice
    // over: lookup index for the purchase book and duplicate checks.
    index("PurchaseBillImportDetail_customsDeclarationNo_idx").on(
      t.customsDeclarationNo,
    ),
  ],
);
