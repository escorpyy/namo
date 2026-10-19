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
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { createdAt, money, updatedAt } from "./_helpers";
import {
  depreciationMethodEnum,
  productTypeEnum,
  valuationMethodEnum,
} from "./enums";
import { company } from "./core";
import { generalLedger } from "./accounting";
import { party } from "./parties";

// ============================================================
// PRODUCT CATALOG
// Five product types share one Product "header" row plus a type-specific
// 1:1 detail table (cascade on delete of the header). Consistency between
// Product.type and "exactly one matching detail row" is enforced by
// triggers in the migration SQL (fn_check_product_type_match /
// fn_check_product_single_detail) — see README for how to keep those.
// ============================================================

// ------------------------------------------------------------
// PRODUCT GROUP / SUBGROUP
// ------------------------------------------------------------

export const productGroup = pgTable(
  "ProductGroup",
  {
    id: serial().primaryKey(),
    companyId: integer()
      .notNull()
      .references(() => company.id, { onDelete: "restrict" }),

    code: varchar({ length: 10 }).notNull(),
    name: varchar({ length: 50 }).notNull(),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("ProductGroup_companyId_code_key").on(t.companyId, t.code),
    uniqueIndex("ProductGroup_companyId_name_key").on(t.companyId, t.name),
    index("ProductGroup_companyId_idx").on(t.companyId),
  ],
);

export const productSubGroup = pgTable(
  "ProductSubGroup",
  {
    id: serial().primaryKey(),
    code: varchar({ length: 10 }).notNull(),
    name: varchar({ length: 50 }).notNull(),
    productGroupId: integer()
      .notNull()
      .references(() => productGroup.id, { onDelete: "restrict" }),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("ProductSubGroup_productGroupId_code_key").on(
      t.productGroupId,
      t.code,
    ),
    uniqueIndex("ProductSubGroup_productGroupId_name_key").on(
      t.productGroupId,
      t.name,
    ),
  ],
);

// ------------------------------------------------------------
// PRODUCT UNIT — decimalPlaces: PCS should not accept 2.5, KG/LTR should.
// App-layer rule, plus a DB-level 0–6 sanity CHECK.
// ------------------------------------------------------------

export const productUnit = pgTable(
  "ProductUnit",
  {
    id: serial().primaryKey(),
    companyId: integer()
      .notNull()
      .references(() => company.id, { onDelete: "restrict" }),

    code: varchar({ length: 10 }).notNull(), // "PCS", "KG", "BOX"
    name: varchar({ length: 50 }).notNull(),
    decimalPlaces: integer().notNull().default(0),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("ProductUnit_companyId_code_key").on(t.companyId, t.code),
    uniqueIndex("ProductUnit_companyId_name_key").on(t.companyId, t.name),
    index("ProductUnit_companyId_idx").on(t.companyId),
    check(
      "ProductUnit_decimalPlaces_check",
      sql`${t.decimalPlaces} BETWEEN 0 AND 6`,
    ),
  ],
);

// ------------------------------------------------------------
// TAX RATE
// ------------------------------------------------------------

export const taxRate = pgTable(
  "TaxRate",
  {
    id: serial().primaryKey(),
    companyId: integer()
      .notNull()
      .references(() => company.id, { onDelete: "restrict" }),

    code: varchar({ length: 10 }).notNull(),
    name: varchar({ length: 50 }).notNull(), // "GST 13%", "VAT 5%"
    ratePercent: numeric({ precision: 5, scale: 2 }).notNull(),
    hsnSacCode: varchar({ length: 20 }), // HSN for goods, SAC for services
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("TaxRate_companyId_code_key").on(t.companyId, t.code),
    index("TaxRate_companyId_idx").on(t.companyId),
  ],
);

// ------------------------------------------------------------
// STOCK CATEGORY & LOCATION
// ------------------------------------------------------------

export const stockCategory = pgTable(
  "StockCategory",
  {
    id: serial().primaryKey(),
    companyId: integer()
      .notNull()
      .references(() => company.id, { onDelete: "restrict" }),

    code: varchar({ length: 10 }).notNull(),
    name: varchar({ length: 50 }).notNull(),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("StockCategory_companyId_code_key").on(t.companyId, t.code),
    uniqueIndex("StockCategory_companyId_name_key").on(t.companyId, t.name),
    index("StockCategory_companyId_idx").on(t.companyId),
  ],
);

// Company-wide warehouse/shelf lookup, independent of Branch. Branch-wise
// stock reporting is driven by StockOpeningBalance.branchId.
export const location = pgTable(
  "Location",
  {
    id: serial().primaryKey(),
    companyId: integer()
      .notNull()
      .references(() => company.id, { onDelete: "restrict" }),

    code: varchar({ length: 10 }).notNull(),
    name: varchar({ length: 50 }).notNull(),

    parentId: integer().references((): AnyPgColumn => location.id, {
      onDelete: "restrict",
    }),

    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("Location_companyId_code_key").on(t.companyId, t.code),
    index("Location_companyId_idx").on(t.companyId),
    index("Location_parentId_idx").on(t.parentId),
  ],
);

// ------------------------------------------------------------
// PRODUCT — parent header for all five types
// ------------------------------------------------------------

export const product = pgTable(
  "Product",
  {
    id: serial().primaryKey(),
    companyId: integer()
      .notNull()
      .references(() => company.id, { onDelete: "restrict" }),

    code: varchar({ length: 10 }).notNull(),
    description: varchar({ length: 256 }).notNull(), // not globally unique
    shortName: varchar({ length: 30 }),
    barcode: varchar({ length: 64 }),
    type: productTypeEnum().notNull(),

    productSubGroupId: integer()
      .notNull()
      .references(() => productSubGroup.id, { onDelete: "restrict" }),

    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("Product_companyId_code_key").on(t.companyId, t.code),
    uniqueIndex("Product_companyId_barcode_key").on(t.companyId, t.barcode),
    index("Product_companyId_idx").on(t.companyId),
    index("Product_productSubGroupId_idx").on(t.productSubGroupId),
    index("Product_type_idx").on(t.type),
    index("Product_type_isActive_idx").on(t.type, t.isActive),
    index("Product_description_idx").on(t.description),
  ],
);

// ------------------------------------------------------------
// STOCK DETAIL
// ------------------------------------------------------------

export const stockDetail = pgTable(
  "StockDetail",
  {
    id: serial().primaryKey(),
    productId: integer()
      .notNull()
      .references(() => product.id, { onDelete: "cascade" }),

    baseUnitId: integer()
      .notNull()
      .references(() => productUnit.id, { onDelete: "restrict" }),

    stockCategoryId: integer().references(() => stockCategory.id, {
      onDelete: "set null",
    }),
    defaultLocationId: integer().references(() => location.id, {
      onDelete: "set null",
    }),
    taxRateId: integer().references(() => taxRate.id, { onDelete: "set null" }),

    valuationMethod: valuationMethodEnum().notNull().default("WEIGHTED_AVERAGE"),
    tracksBatch: boolean().notNull().default(false),
    tracksExpiry: boolean().notNull().default(false),

    purchaseRate: money(),
    salesRate: money(),
    mrp: money(),
    tradePrice: money(),

    minStock: money(),
    maxStock: money(),
    reorderLevel: money(),
    reorderQty: money(),

    openingGLId: integer().references(() => generalLedger.id, {
      onDelete: "restrict",
    }),
    closingPLGLId: integer().references(() => generalLedger.id, {
      onDelete: "restrict",
    }),
    closingBSGLId: integer().references(() => generalLedger.id, {
      onDelete: "restrict",
    }),

    purchaseGLId: integer().references(() => generalLedger.id, {
      onDelete: "restrict",
    }),
    purchaseReturnGLId: integer().references(() => generalLedger.id, {
      onDelete: "restrict",
    }),
    salesGLId: integer().references(() => generalLedger.id, {
      onDelete: "restrict",
    }),
    salesReturnGLId: integer().references(() => generalLedger.id, {
      onDelete: "restrict",
    }),

    defaultVendorId: integer().references(() => party.id, {
      onDelete: "set null",
    }),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("StockDetail_productId_key").on(t.productId),
    index("StockDetail_baseUnitId_idx").on(t.baseUnitId),
    index("StockDetail_stockCategoryId_idx").on(t.stockCategoryId),
    index("StockDetail_defaultLocationId_idx").on(t.defaultLocationId),
    index("StockDetail_defaultVendorId_idx").on(t.defaultVendorId),
    index("StockDetail_taxRateId_idx").on(t.taxRateId),
    index("StockDetail_openingGLId_idx").on(t.openingGLId),
    index("StockDetail_closingPLGLId_idx").on(t.closingPLGLId),
    index("StockDetail_closingBSGLId_idx").on(t.closingBSGLId),
    index("StockDetail_purchaseGLId_idx").on(t.purchaseGLId),
    index("StockDetail_purchaseReturnGLId_idx").on(t.purchaseReturnGLId),
    index("StockDetail_salesGLId_idx").on(t.salesGLId),
    index("StockDetail_salesReturnGLId_idx").on(t.salesReturnGLId),
  ],
);

// Flattened — one hop to base unit, no traversal, no cycle risk.
// 1 unit (e.g. Box) = conversionFactor * baseUnit (e.g. 12 Pcs).
// A trigger blocks unitId == the parent StockDetail's baseUnitId.
export const alternateUnit = pgTable(
  "AlternateUnit",
  {
    id: serial().primaryKey(),
    stockDetailId: integer()
      .notNull()
      .references(() => stockDetail.id, { onDelete: "cascade" }),
    unitId: integer()
      .notNull()
      .references(() => productUnit.id, { onDelete: "restrict" }),

    conversionFactor: money().notNull(),
  },
  (t) => [
    uniqueIndex("AlternateUnit_stockDetailId_unitId_key").on(
      t.stockDetailId,
      t.unitId,
    ),
    index("AlternateUnit_unitId_idx").on(t.unitId),
  ],
);

// ------------------------------------------------------------
// NON-STOCK DETAIL — buy/sell, quantity not tracked
// ------------------------------------------------------------

export const nonStockDetail = pgTable(
  "NonStockDetail",
  {
    id: serial().primaryKey(),
    productId: integer()
      .notNull()
      .references(() => product.id, { onDelete: "cascade" }),

    unitId: integer()
      .notNull()
      .references(() => productUnit.id, { onDelete: "restrict" }),
    taxRateId: integer().references(() => taxRate.id, { onDelete: "set null" }),

    salesGLId: integer()
      .notNull()
      .references(() => generalLedger.id, { onDelete: "restrict" }),
    purchaseGLId: integer()
      .notNull()
      .references(() => generalLedger.id, { onDelete: "restrict" }),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("NonStockDetail_productId_key").on(t.productId),
    index("NonStockDetail_unitId_idx").on(t.unitId),
    index("NonStockDetail_taxRateId_idx").on(t.taxRateId),
    index("NonStockDetail_salesGLId_idx").on(t.salesGLId),
    index("NonStockDetail_purchaseGLId_idx").on(t.purchaseGLId),
  ],
);

// ------------------------------------------------------------
// SERVICE DETAIL
// ------------------------------------------------------------

export const serviceDetail = pgTable(
  "ServiceDetail",
  {
    id: serial().primaryKey(),
    productId: integer()
      .notNull()
      .references(() => product.id, { onDelete: "cascade" }),

    // usually "per hour"/"per visit" — optional, many services are lump-sum
    unitId: integer().references(() => productUnit.id, {
      onDelete: "set null",
    }),
    taxRateId: integer().references(() => taxRate.id, { onDelete: "set null" }),

    salesGLId: integer()
      .notNull()
      .references(() => generalLedger.id, { onDelete: "restrict" }),
    purchaseGLId: integer()
      .notNull()
      .references(() => generalLedger.id, { onDelete: "restrict" }),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("ServiceDetail_productId_key").on(t.productId),
    index("ServiceDetail_unitId_idx").on(t.unitId),
    index("ServiceDetail_taxRateId_idx").on(t.taxRateId),
    index("ServiceDetail_salesGLId_idx").on(t.salesGLId),
    index("ServiceDetail_purchaseGLId_idx").on(t.purchaseGLId),
  ],
);

// ------------------------------------------------------------
// FIXED ASSET DETAIL — three GLs needed for depreciation accounting:
// the asset, accumulated depreciation (contra-asset) and depreciation
// expense (P&L). accumulatedDepreciation is a quick-reference running
// total only; the authoritative trail is a future schedule/posting table.
// ------------------------------------------------------------

export const fixedAssetDetail = pgTable(
  "FixedAssetDetail",
  {
    id: serial().primaryKey(),
    productId: integer()
      .notNull()
      .references(() => product.id, { onDelete: "cascade" }),

    assetGLId: integer()
      .notNull()
      .references(() => generalLedger.id, { onDelete: "restrict" }),
    accumulatedDeprGLId: integer()
      .notNull()
      .references(() => generalLedger.id, { onDelete: "restrict" }),
    depreciationExpenseGLId: integer()
      .notNull()
      .references(() => generalLedger.id, { onDelete: "restrict" }),

    locationId: integer().references(() => location.id, {
      onDelete: "set null",
    }),

    purchaseDate: date({ mode: "date" }),
    originalCost: money(),
    salvageValue: money().notNull().default("0"),
    usefulLifeYears: integer(),

    depreciationMethod: depreciationMethodEnum()
      .notNull()
      .default("STRAIGHT_LINE"),
    depreciationRatePercent: numeric({ precision: 5, scale: 2 }), // WDV or manual override

    accumulatedDepreciation: money().notNull().default("0"),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("FixedAssetDetail_productId_key").on(t.productId),
    index("FixedAssetDetail_locationId_idx").on(t.locationId),
    index("FixedAssetDetail_assetGLId_idx").on(t.assetGLId),
    index("FixedAssetDetail_accumulatedDeprGLId_idx").on(t.accumulatedDeprGLId),
    index("FixedAssetDetail_depreciationExpenseGLId_idx").on(
      t.depreciationExpenseGLId,
    ),
  ],
);

// ------------------------------------------------------------
// BUNDLE DETAIL + COMPONENTS
// No nested bundles and no self-reference — both enforced by trigger.
// ------------------------------------------------------------

export const bundleDetail = pgTable(
  "BundleDetail",
  {
    id: serial().primaryKey(),
    productId: integer()
      .notNull()
      .references(() => product.id, { onDelete: "cascade" }),

    salesGLId: integer()
      .notNull()
      .references(() => generalLedger.id, { onDelete: "restrict" }),

    bundlePrice: money(), // override; else sum of components

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("BundleDetail_productId_key").on(t.productId),
    index("BundleDetail_salesGLId_idx").on(t.salesGLId),
  ],
);

export const bundleComponent = pgTable(
  "BundleComponent",
  {
    id: serial().primaryKey(),
    bundleDetailId: integer()
      .notNull()
      .references(() => bundleDetail.id, { onDelete: "cascade" }),
    componentProductId: integer()
      .notNull()
      .references(() => product.id, { onDelete: "restrict" }),

    quantity: money().notNull(),
  },
  (t) => [
    uniqueIndex("BundleComponent_bundleDetailId_componentProductId_key").on(
      t.bundleDetailId,
      t.componentProductId,
    ),
    index("BundleComponent_componentProductId_idx").on(t.componentProductId),
  ],
);
