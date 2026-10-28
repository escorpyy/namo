import { sql } from "drizzle-orm";
import {
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
import { purchaseOrderStatusEnum } from "./enums";
import { branch, company, user } from "./core";
import { generalLedger, subLedger } from "./accounting";
import { agent } from "./parties";
import { product, productUnit } from "./products";

// ============================================================
// PURCHASE ORDER  (legacy screen: "Purchase Order" / "O/A No")
//
// A commitment to buy. It posts NOTHING to the ledger and moves NO stock; it
// only records what was ordered so challans (goods received) and bills
// (invoices) can be matched against it.
//
// Header -> PurchaseOrder, grid rows -> PurchaseOrderLine.
//
// Billing terms (VAT, discount, freight, ...) are not columns: they live in
// PurchaseDocumentTerm with documentType = 'PURCHASE_ORDER' and
// documentId = PurchaseOrder.id. PurchaseOrder.termAmount is their stored sum.
// ADDITIONAL-category terms (import duty, excise, ...) are actual charges and
// belong on additional purchase bills only; the database refuses them here.
//
// Not stored on purpose (derived from challans / bills, computed on read):
//   received qty, pending qty, billed qty, "fully received" / "fully billed".
//
// Rules left to the service layer:
//   - totals (basicAmount, termAmount, totalAmount) = sum of lines / terms
//   - status changes: DRAFT -> APPROVED -> CLOSED, or CANCELLED. Lines and
//     terms are editable only in DRAFT; an order with challans cannot be
//     cancelled
//   - received / billed qty may not exceed ordered qty (plus any tolerance)
//   - qty = altQty * AlternateUnit.conversionFactor when an alt unit is used
//   - fiscalYear must exist and be open for the company
//
// Drizzle returns numeric as string; use shared/decimal.ts for arithmetic.
// ============================================================

export const purchaseOrder = pgTable(
  "PurchaseOrder",
  {
    id: serial().primaryKey(),
    companyId: integer()
      .notNull()
      .references(() => company.id, { onDelete: "restrict" }),
    branchId: integer()
      .notNull()
      .references(() => branch.id, { onDelete: "restrict" }),

    // "Order No". Numbering restarts every fiscal year.
    orderNumber: varchar({ length: 30 }).notNull(),
    orderDate: date({ mode: "date" }).notNull(),
    fiscalYear: varchar({ length: 15 }).notNull(),

    // The vendor is a ledger on the screen, not always a Party (as on the bill).
    vendorGLId: integer()
      .notNull()
      .references(() => generalLedger.id, { onDelete: "restrict" }),
    subLedgerId: integer().references(() => subLedger.id, {
      onDelete: "restrict",
    }),
    agentId: integer().references(() => agent.id, { onDelete: "set null" }),

    // The vendor's quotation / proforma this order was placed against.
    vendorRefNo: varchar({ length: 30 }),
    vendorRefDate: date({ mode: "date" }),

    // When the whole order is expected. Lines may carry their own date.
    expectedDate: date({ mode: "date" }),

    basicAmount: money().notNull().default("0"), // sum of line basicAmount
    termAmount: money().notNull().default("0"), // net of additive/deductive terms
    totalAmount: money().notNull().default("0"),

    remarks: varchar({ length: 1024 }),

    status: purchaseOrderStatusEnum().notNull().default("DRAFT"),
    approvedAt: timestamp({ precision: 3 }),
    approvedBy: integer().references(() => user.id, { onDelete: "set null" }),
    closedAt: timestamp({ precision: 3 }),
    closedBy: integer().references(() => user.id, { onDelete: "set null" }),

    createdBy: integer().references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("PurchaseOrder_branchId_fiscalYear_orderNumber_key").on(
      t.branchId,
      t.fiscalYear,
      t.orderNumber,
    ),
    index("PurchaseOrder_companyId_idx").on(t.companyId),
    index("PurchaseOrder_branchId_idx").on(t.branchId),
    index("PurchaseOrder_vendorGLId_idx").on(t.vendorGLId),
    index("PurchaseOrder_subLedgerId_idx").on(t.subLedgerId),
    index("PurchaseOrder_agentId_idx").on(t.agentId),
    index("PurchaseOrder_status_idx").on(t.status),
    index("PurchaseOrder_fiscalYear_idx").on(t.fiscalYear),
    index("PurchaseOrder_orderDate_idx").on(t.orderDate),
    // An approved order must say when it was approved.
    check(
      "PurchaseOrder_approved_check",
      sql`${t.status} = 'DRAFT' OR ${t.status} = 'CANCELLED' OR ${t.approvedAt} IS NOT NULL`,
    ),
    // A closed order must say when it was closed.
    check(
      "PurchaseOrder_closed_check",
      sql`${t.status} <> 'CLOSED' OR ${t.closedAt} IS NOT NULL`,
    ),
    check(
      "PurchaseOrder_expected_check",
      sql`${t.expectedDate} IS NULL OR ${t.expectedDate} >= ${t.orderDate}`,
    ),
  ],
);

// The grid: S.No, Alt Qty, Uom, Qty, Uom, Rate, Basic Amt.
export const purchaseOrderLine = pgTable(
  "PurchaseOrderLine",
  {
    id: serial().primaryKey(),
    purchaseOrderId: integer()
      .notNull()
      .references(() => purchaseOrder.id, { onDelete: "cascade" }),

    lineNumber: integer().notNull(), // S.No
    productId: integer()
      .notNull()
      .references(() => product.id, { onDelete: "restrict" }),

    // First Uom pair: the alternate unit the goods are ordered in.
    altQty: money(),
    altUnitId: integer().references(() => productUnit.id, {
      onDelete: "restrict",
    }),

    // Second Uom pair: ordered quantity in the unit stock is kept in.
    qty: money().notNull(),
    unitId: integer()
      .notNull()
      .references(() => productUnit.id, { onDelete: "restrict" }),

    rate: money().notNull().default("0"),
    basicAmount: money().notNull().default("0"), // qty * rate

    // Delivery date for this line, when it differs from the header's.
    expectedDate: date({ mode: "date" }),

    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("PurchaseOrderLine_purchaseOrderId_lineNumber_key").on(
      t.purchaseOrderId,
      t.lineNumber,
    ),
    index("PurchaseOrderLine_productId_idx").on(t.productId),
    index("PurchaseOrderLine_altUnitId_idx").on(t.altUnitId),
    index("PurchaseOrderLine_unitId_idx").on(t.unitId),
    check("PurchaseOrderLine_lineNumber_check", sql`${t.lineNumber} > 0`),
    // An order for nothing is not an order.
    check(
      "PurchaseOrderLine_amounts_check",
      sql`${t.qty} > 0 AND ${t.rate} >= 0 AND ${t.basicAmount} >= 0`,
    ),
    // Alt qty and alt unit come as a pair.
    check(
      "PurchaseOrderLine_alt_pair_check",
      sql`(${t.altQty} IS NULL) = (${t.altUnitId} IS NULL)`,
    ),
  ],
);
