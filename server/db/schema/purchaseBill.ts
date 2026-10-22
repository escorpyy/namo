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
import { documentTypeEnum, purchaseInvoiceTypeEnum } from "./enums";
import { branch, company, user } from "./core";
import { generalLedger, subLedger } from "./accounting";
import { agent } from "./parties";
import { product, productUnit } from "./products";

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
//   - an Import bill should carry an import detail row
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
    invoiceType: purchaseInvoiceTypeEnum().notNull().default("LOCAL"),

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
    // closes. Plain references until challan / purchase order tables exist;
    // then they become foreign keys.
    challanNo: varchar({ length: 30 }),
    orderNo: varchar({ length: 30 }),

    // "Due Days" + "Date" next to it
    dueDays: integer().notNull().default(0),
    dueDate: date({ mode: "date" }),

    // Footer. All stored so reports and posting need no recalculation.
    basicAmount: money().notNull().default("0"), // sum of line basicAmount
    termAmount: money().notNull().default("0"), // net of additive/deductive terms
    totalAmount: money().notNull().default("0"),

    remarks: varchar({ length: 1024 }),

    // An additional invoice (freight, clearing charges, ...) can point at the
    // main invoice it belongs to. See the note in billing.ts.
    mainBillId: integer().references((): AnyPgColumn => purchaseBill.id, {
      onDelete: "restrict",
    }),
    reversalOfId: integer().references((): AnyPgColumn => purchaseBill.id, {
      onDelete: "set null",
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

// The grid: S.No, Particular, Alt Qty, Uom, Qty, Uom, Rate, Basic Amt.
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
    // "Particular": defaults to the product description, editable per line.
    particular: varchar({ length: 256 }),

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

    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("PurchaseBillLine_purchaseBillId_lineNumber_key").on(
      t.purchaseBillId,
      t.lineNumber,
    ),
    index("PurchaseBillLine_productId_idx").on(t.productId),
    index("PurchaseBillLine_altUnitId_idx").on(t.altUnitId),
    index("PurchaseBillLine_unitId_idx").on(t.unitId),
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

// "Import/Transport Details" tab. The tab was not visible in the screenshot,
// so these columns are the usual import + transport fields, all optional.
export const purchaseBillImportDetail = pgTable(
  "PurchaseBillImportDetail",
  {
    id: serial().primaryKey(),
    purchaseBillId: integer()
      .notNull()
      .references(() => purchaseBill.id, { onDelete: "cascade" }),

    importPermitNo: varchar({ length: 30 }), // Pragyapan Patra
    importPermitDate: date({ mode: "date" }),
    customsDeclarationNo: varchar({ length: 30 }),
    customsDeclarationDate: date({ mode: "date" }),
    lcNo: varchar({ length: 30 }),

    transporterName: varchar({ length: 100 }),
    vehicleNo: varchar({ length: 30 }),
    lrNo: varchar({ length: 30 }),
    lrDate: date({ mode: "date" }),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("PurchaseBillImportDetail_purchaseBillId_key").on(
      t.purchaseBillId,
    ),
  ],
);
