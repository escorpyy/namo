import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, pgTable, serial, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { createdAt, money, updatedAt } from "./_helpers";
import { branch, company, user } from "./core";
import { numberSeries } from "./numberSeries";
import { generalLedger, subLedger } from "./accounting";
import { agent } from "./parties";
import { location, product, productUnit } from "./products";

// ============================================================
// SALES CHALLAN  (delivery note)
//
// The physical dispatch of goods to a customer, before (or without) the invoice.
// Confirming a challan is what takes the stock OUT; it posts NOTHING to the ledger.
// The accounting happens when a SalesInvoice bills it (SalesInvoice.salesChallanId /
// SalesInvoiceLine.challanLineId). Invoice lines linked to a challan line do NOT take stock out again.
//
// Not stored on purpose (derived on read): billed qty / pending-to-bill qty per line.
// Rules left to the service layer: confirm = stock covers the goods, batch/expiry present if tracked;
// a confirmed challan is immutable and cannot be deleted.
// ============================================================

export const salesChallan = pgTable(
  "SalesChallan",
  {
    id: serial().primaryKey(),
    companyId: integer().notNull().references(() => company.id, { onDelete: "restrict" }),
    branchId: integer().notNull().references(() => branch.id, { onDelete: "restrict" }),

    challanNumber: varchar({ length: 30 }).notNull(),
    numberSeriesId: integer().references(() => numberSeries.id, { onDelete: "set null" }),
    challanDate: date({ mode: "date" }).notNull(),
    fiscalYear: varchar({ length: 15 }).notNull(),

    customerGLId: integer().notNull().references(() => generalLedger.id, { onDelete: "restrict" }),
    subLedgerId: integer().references(() => subLedger.id, { onDelete: "restrict" }),
    agentId: integer().references(() => agent.id, { onDelete: "set null" }),

    // Delivery: how the goods went out.
    transporterName: varchar({ length: 100 }),
    vehicleNo: varchar({ length: 30 }),
    lrNo: varchar({ length: 30 }),
    lrDate: date({ mode: "date" }),

    remarks: varchar({ length: 1024 }),

    // Confirmed = goods dispatched and stock taken out. Set together.
    isConfirmed: boolean().notNull().default(false),
    confirmedAt: timestamp({ precision: 3 }),
    confirmedBy: integer().references(() => user.id, { onDelete: "set null" }),

    createdBy: integer().references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("SalesChallan_branchId_fiscalYear_challanNumber_key").on(t.branchId, t.fiscalYear, t.challanNumber),
    index("SalesChallan_companyId_idx").on(t.companyId),
    index("SalesChallan_branchId_idx").on(t.branchId),
    index("SalesChallan_customerGLId_idx").on(t.customerGLId),
    index("SalesChallan_subLedgerId_idx").on(t.subLedgerId),
    index("SalesChallan_agentId_idx").on(t.agentId),
    index("SalesChallan_fiscalYear_idx").on(t.fiscalYear),
    index("SalesChallan_challanDate_idx").on(t.challanDate),
    check("SalesChallan_confirmed_check", sql`NOT ${t.isConfirmed} OR ${t.confirmedAt} IS NOT NULL`),
  ],
);

export const salesChallanLine = pgTable(
  "SalesChallanLine",
  {
    id: serial().primaryKey(),
    salesChallanId: integer().notNull().references(() => salesChallan.id, { onDelete: "cascade" }),

    lineNumber: integer().notNull(),
    productId: integer().notNull().references(() => product.id, { onDelete: "restrict" }),

    altQty: money(),
    altUnitId: integer().references(() => productUnit.id, { onDelete: "restrict" }),
    qty: money().notNull(),
    unitId: integer().notNull().references(() => productUnit.id, { onDelete: "restrict" }),

    // Indicative price, so goods delivered but not yet invoiced can be valued. The invoice's rate is what counts.
    rate: money().notNull().default("0"),
    basicAmount: money().notNull().default("0"),

    // Where the goods are taken from and which batch.
    locationId: integer().references(() => location.id, { onDelete: "restrict" }),
    batchNo: varchar({ length: 50 }),
    expiryDate: date({ mode: "date" }),

    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("SalesChallanLine_salesChallanId_lineNumber_key").on(t.salesChallanId, t.lineNumber),
    index("SalesChallanLine_productId_idx").on(t.productId),
    index("SalesChallanLine_altUnitId_idx").on(t.altUnitId),
    index("SalesChallanLine_unitId_idx").on(t.unitId),
    index("SalesChallanLine_locationId_idx").on(t.locationId),
    check("SalesChallanLine_lineNumber_check", sql`${t.lineNumber} > 0`),
    check("SalesChallanLine_amounts_check", sql`${t.qty} > 0 AND ${t.rate} >= 0 AND ${t.basicAmount} >= 0`),
    check("SalesChallanLine_alt_pair_check", sql`(${t.altQty} IS NULL) = (${t.altUnitId} IS NULL)`),
  ],
);
