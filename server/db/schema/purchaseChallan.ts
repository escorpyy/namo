import { sql } from "drizzle-orm";
import {
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
import { branch, company, user } from "./core";
import { generalLedger, subLedger } from "./accounting";
import { agent } from "./parties";
import { location, product, productUnit } from "./products";
import { purchaseOrder, purchaseOrderLine } from "./purchaseOrder";

// ============================================================
// PURCHASE CHALLAN  (goods receipt note / "Ch No")
//
// The physical receipt of goods from a vendor, before (or without) the vendor's
// invoice. Confirming a challan is what brings the stock in; it posts NOTHING
// to the ledger. The accounting happens later, when a PurchaseBill closes the
// challan (PurchaseBill.purchaseChallanId / PurchaseBillLine.challanLineId).
//
// Header -> PurchaseChallan, grid rows -> PurchaseChallanLine.
//
// A challan may be raised against a purchase order (purchaseOrderId, and per
// line purchaseOrderLineId) or stand alone (goods arrived with no order).
// It carries no billing terms: terms are priced on the order and the bill.
//
// Not stored on purpose (derived, computed on read):
//   billed qty / pending-to-bill qty per line -> sum of linked bill lines
//   received qty per order line               -> sum of linked challan lines
//
// Rules left to the service layer:
//   - confirming sets isConfirmed, confirmedAt and confirmedBy together, and
//     adds the stock; a confirmed challan is immutable
//   - received qty may not exceed the order line's pending qty (plus tolerance)
//   - batch / expiry are required when the product tracks them
//   - qty = altQty * AlternateUnit.conversionFactor when an alt unit is used
//   - fiscalYear must exist and be open for the company
//
// Drizzle returns numeric as string; use shared/decimal.ts for arithmetic.
// ============================================================

export const purchaseChallan = pgTable(
  "PurchaseChallan",
  {
    id: serial().primaryKey(),
    companyId: integer()
      .notNull()
      .references(() => company.id, { onDelete: "restrict" }),
    branchId: integer()
      .notNull()
      .references(() => branch.id, { onDelete: "restrict" }),

    // "Challan No". Numbering restarts every fiscal year.
    challanNumber: varchar({ length: 30 }).notNull(),
    challanDate: date({ mode: "date" }).notNull(),
    fiscalYear: varchar({ length: 15 }).notNull(),

    vendorGLId: integer()
      .notNull()
      .references(() => generalLedger.id, { onDelete: "restrict" }),
    subLedgerId: integer().references(() => subLedger.id, {
      onDelete: "restrict",
    }),
    agentId: integer().references(() => agent.id, { onDelete: "set null" }),

    // The order this challan receives against; null = goods with no order.
    // A challan belongs to at most one order.
    purchaseOrderId: integer().references(() => purchaseOrder.id, {
      onDelete: "restrict",
    }),

    // The vendor's own delivery challan / gate pass.
    vendorChallanNo: varchar({ length: 30 }),
    vendorChallanDate: date({ mode: "date" }),

    // Delivery: how the goods arrived.
    transporterName: varchar({ length: 100 }),
    vehicleNo: varchar({ length: 30 }),
    lrNo: varchar({ length: 30 }),
    lrDate: date({ mode: "date" }),

    remarks: varchar({ length: 1024 }),

    // Confirmed = goods received and stock added. Set together.
    isConfirmed: boolean().notNull().default(false),
    confirmedAt: timestamp({ precision: 3 }),
    confirmedBy: integer().references(() => user.id, { onDelete: "set null" }),

    createdBy: integer().references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("PurchaseChallan_branchId_fiscalYear_challanNumber_key").on(
      t.branchId,
      t.fiscalYear,
      t.challanNumber,
    ),
    // Catches the same vendor challan being keyed in twice.
    uniqueIndex("PurchaseChallan_vendor_vendorChallanNo_key")
      .on(t.companyId, t.vendorGLId, t.vendorChallanNo)
      .where(sql`${t.vendorChallanNo} IS NOT NULL`),
    index("PurchaseChallan_companyId_idx").on(t.companyId),
    index("PurchaseChallan_branchId_idx").on(t.branchId),
    index("PurchaseChallan_vendorGLId_idx").on(t.vendorGLId),
    index("PurchaseChallan_subLedgerId_idx").on(t.subLedgerId),
    index("PurchaseChallan_agentId_idx").on(t.agentId),
    index("PurchaseChallan_purchaseOrderId_idx").on(t.purchaseOrderId),
    index("PurchaseChallan_fiscalYear_idx").on(t.fiscalYear),
    index("PurchaseChallan_challanDate_idx").on(t.challanDate),
    // A confirmed challan must say when it was confirmed.
    check(
      "PurchaseChallan_confirmed_check",
      sql`NOT ${t.isConfirmed} OR ${t.confirmedAt} IS NOT NULL`,
    ),
  ],
);

// The grid: S.No, Particular, Alt Qty, Uom, Qty, Uom, Rate, Basic Amt, plus
// where the goods went in and which batch.
export const purchaseChallanLine = pgTable(
  "PurchaseChallanLine",
  {
    id: serial().primaryKey(),
    purchaseChallanId: integer()
      .notNull()
      .references(() => purchaseChallan.id, { onDelete: "cascade" }),

    lineNumber: integer().notNull(), // S.No
    productId: integer()
      .notNull()
      .references(() => product.id, { onDelete: "restrict" }),
    particular: varchar({ length: 256 }),

    // The order line this receipt fulfils. Must belong to the challan's own
    // order and be for the same product (enforced by the database).
    purchaseOrderLineId: integer().references(() => purchaseOrderLine.id, {
      onDelete: "restrict",
    }),

    // First Uom pair: the alternate unit the goods arrived in.
    altQty: money(),
    altUnitId: integer().references(() => productUnit.id, {
      onDelete: "restrict",
    }),

    // Second Uom pair: received quantity in the unit stock is kept in.
    qty: money().notNull(),
    unitId: integer()
      .notNull()
      .references(() => productUnit.id, { onDelete: "restrict" }),

    // Indicative price (usually copied from the order) so goods received but
    // not yet billed can be valued. The bill's landed rate is what finally counts.
    rate: money().notNull().default("0"),
    basicAmount: money().notNull().default("0"), // qty * rate

    // Stock receipt data. Required only when the product tracks batch / expiry:
    // service layer.
    locationId: integer().references(() => location.id, {
      onDelete: "set null",
    }),
    batchNo: varchar({ length: 50 }),
    manufactureDate: date({ mode: "date" }),
    expiryDate: date({ mode: "date" }),

    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("PurchaseChallanLine_purchaseChallanId_lineNumber_key").on(
      t.purchaseChallanId,
      t.lineNumber,
    ),
    index("PurchaseChallanLine_productId_idx").on(t.productId),
    index("PurchaseChallanLine_purchaseOrderLineId_idx").on(
      t.purchaseOrderLineId,
    ),
    index("PurchaseChallanLine_altUnitId_idx").on(t.altUnitId),
    index("PurchaseChallanLine_unitId_idx").on(t.unitId),
    index("PurchaseChallanLine_locationId_idx").on(t.locationId),
    index("PurchaseChallanLine_batchNo_idx").on(t.productId, t.batchNo),
    check("PurchaseChallanLine_lineNumber_check", sql`${t.lineNumber} > 0`),
    // A received line of nothing is not a receipt.
    check(
      "PurchaseChallanLine_amounts_check",
      sql`${t.qty} > 0 AND ${t.rate} >= 0 AND ${t.basicAmount} >= 0`,
    ),
    check(
      "PurchaseChallanLine_expiry_check",
      sql`${t.manufactureDate} IS NULL OR ${t.expiryDate} IS NULL OR ${t.expiryDate} >= ${t.manufactureDate}`,
    ),
    // Alt qty and alt unit come as a pair.
    check(
      "PurchaseChallanLine_alt_pair_check",
      sql`(${t.altQty} IS NULL) = (${t.altUnitId} IS NULL)`,
    ),
  ],
);
