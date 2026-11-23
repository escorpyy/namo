import { sql } from "drizzle-orm";
import { check, date, index, integer, pgTable, serial, timestamp, varchar } from "drizzle-orm/pg-core";
import { stockSourceTypeEnum } from "./enums";
import { money } from "./_helpers";
import { branch, company } from "./core";
import { location, product } from "./products";

// STOCK LEDGER. One row per quantity that came in (qty > 0) or went out (qty < 0) of a branch's stock, for a product, in a location, in a batch.
// Stock on hand = the sum of qty. Rows are only ever added: a reversal adds the opposite row, so history stays visible.
//   Purchase challan confirmed            -> IN (the goods are physically received)
//   Purchase bill posted, line has no challan -> IN (a bill with no challan is also the receipt)
//   Purchase bill reversed                -> OUT for the lines that were IN on the bill
// sourceType + sourceId + sourceLineId say which document line wrote the row (polymorphic, so no foreign key).
export const stockMovement = pgTable(
  "StockMovement",
  {
    id: serial().primaryKey().notNull(),
    companyId: integer().notNull().references(() => company.id, { onDelete: "restrict" }),
    branchId: integer().notNull().references(() => branch.id, { onDelete: "restrict" }),
    productId: integer().notNull().references(() => product.id, { onDelete: "restrict" }),
    locationId: integer().references(() => location.id, { onDelete: "restrict" }),
    batchNo: varchar({ length: 50 }),
    expiryDate: date({ mode: "date" }),
    movementDate: date({ mode: "date" }).notNull(),
    qty: money().notNull(),
    sourceType: stockSourceTypeEnum().notNull(),
    sourceId: integer().notNull(),
    sourceLineId: integer().notNull(),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
  },
  (t) => [
    index("StockMovement_company_branch_product_idx").on(t.companyId, t.branchId, t.productId),
    index("StockMovement_source_idx").on(t.sourceType, t.sourceId),
    index("StockMovement_locationId_idx").on(t.locationId),
    check("StockMovement_qty_check", sql`${t.qty} <> 0`),
  ],
);
