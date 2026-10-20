import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
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
  billingAllocationBasisEnum,
  billingCalcBaseEnum,
  billingCalcTypeEnum,
  billingTermCategoryEnum,
  billingTermNatureEnum,
  purchaseTermDocTypeEnum,
  salesTermDocTypeEnum,
} from "./enums";
import { company } from "./core";
import { generalLedger } from "./accounting";
import { party } from "./parties";
import { product } from "./products";

// ============================================================
// BILLING TERMS
//
// Purchase and sales terms are deliberately SEPARATE schemas.
//
//   *Term                  master: how a term is calculated
//   *TermDefault           which terms are suggested for a vendor/customer
//                          or an item (PO/SO terms are copied by the app)
//   *DocumentTerm          a term as entered on a document (snapshot)
//   PurchaseDocumentTermAllocation   landed-cost split of a header term
//
// Rules enforced here:
//   - isProductwise = true  -> line level, false -> header level
//   - nature is fixed in the master
//   - a term appears once per document (once per line for line terms)
//   - allocation (distribute to lines) is purchase header terms only
//
// Rules left to the service layer:
//   - calculating in `sequence` order, with SINGLE_TERM bases pointing at an
//     EARLIER term (no cycles)
//   - 'mandatory' terms must be present before a document is posted
//   - polymorphic documentId has no FK (invoice tables don't exist yet)
//   - linking an additional invoice to a main invoice: add a nullable
//     self-FK on the invoice header when those tables are built
//
// Drizzle returns numeric as string; use shared/decimal.ts for arithmetic.
// ============================================================

const rate = () => numeric({ precision: 9, scale: 4 });

// ============================================================
// PURCHASE
// ============================================================

export const purchaseTerm = pgTable(
  "PurchaseTerm",
  {
    id: serial().primaryKey(),
    companyId: integer()
      .notNull()
      .references(() => company.id, { onDelete: "restrict" }),

    code: varchar({ length: 20 }).notNull(),
    name: varchar({ length: 100 }).notNull(),
    category: billingTermCategoryEnum().notNull().default("GENERAL"),
    nature: billingTermNatureEnum().notNull(),

    // true = line level, false = header level
    isProductwise: boolean().notNull().default(false),
    isMandatory: boolean().notNull().default(false),
    sequence: integer().notNull().default(100),

    // Starting values; the user may change type and value on the document.
    defaultCalcType: billingCalcTypeEnum().notNull().default("PERCENT"),
    defaultValue: money().notNull().default("0"),
    calcBase: billingCalcBaseEnum().notNull().default("ITEM_VALUE"),
    baseTermId: integer().references((): AnyPgColumn => purchaseTerm.id, {
      onDelete: "restrict",
    }),

    // Landed cost: spread a header term over item lines for valuation.
    distributeToLines: boolean().notNull().default(false),
    allocationBasis: billingAllocationBasisEnum(),

    generalLedgerId: integer().references(() => generalLedger.id, {
      onDelete: "restrict",
    }),

    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("PurchaseTerm_companyId_code_key").on(t.companyId, t.code),
    index("PurchaseTerm_companyId_idx").on(t.companyId),
    index("PurchaseTerm_generalLedgerId_idx").on(t.generalLedgerId),
    check(
      "PurchaseTerm_base_term_check",
      sql`(${t.calcBase} = 'SINGLE_TERM') = (${t.baseTermId} IS NOT NULL)`,
    ),
    check(
      "PurchaseTerm_distribute_check",
      sql`NOT ${t.distributeToLines} OR (NOT ${t.isProductwise} AND ${t.allocationBasis} IS NOT NULL)`,
    ),
  ],
);

// Suggest a term for a vendor OR for an item (exactly one is set).
export const purchaseTermDefault = pgTable(
  "PurchaseTermDefault",
  {
    id: serial().primaryKey(),
    termId: integer()
      .notNull()
      .references(() => purchaseTerm.id, { onDelete: "cascade" }),
    partyId: integer().references(() => party.id, { onDelete: "cascade" }),
    productId: integer().references(() => product.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("PurchaseTermDefault_term_party_key")
      .on(t.termId, t.partyId)
      .where(sql`${t.partyId} IS NOT NULL`),
    uniqueIndex("PurchaseTermDefault_term_product_key")
      .on(t.termId, t.productId)
      .where(sql`${t.productId} IS NOT NULL`),
    index("PurchaseTermDefault_partyId_idx").on(t.partyId),
    index("PurchaseTermDefault_productId_idx").on(t.productId),
    check(
      "PurchaseTermDefault_one_target_check",
      sql`num_nonnulls(${t.partyId}, ${t.productId}) = 1`,
    ),
  ],
);

export const purchaseDocumentTerm = pgTable(
  "PurchaseDocumentTerm",
  {
    id: serial().primaryKey(),
    companyId: integer()
      .notNull()
      .references(() => company.id, { onDelete: "restrict" }),

    documentType: purchaseTermDocTypeEnum().notNull(),
    documentId: integer().notNull(),
    // Set for productwise (line-level) terms, null for header terms.
    documentLineId: integer(),

    termId: integer()
      .notNull()
      .references(() => purchaseTerm.id, { onDelete: "restrict" }),

    // Snapshot of the master at entry time
    sequence: integer().notNull(),
    nature: billingTermNatureEnum().notNull(),
    calcBase: billingCalcBaseEnum().notNull(),
    generalLedgerId: integer().references(() => generalLedger.id, {
      onDelete: "restrict",
    }),
    distributeToLines: boolean().notNull().default(false),
    allocationBasis: billingAllocationBasisEnum(),

    // As entered by the user
    calcType: billingCalcTypeEnum().notNull(),
    rate: rate(), // used when calcType = PERCENT
    inputAmount: money(), // used when calcType = AMOUNT

    // Results
    baseAmount: money().notNull().default("0"),
    calculatedAmount: money().notNull().default("0"), // always positive
    isOverridden: boolean().notNull().default(false),
    // Amount actually used; equals calculatedAmount unless overridden.
    finalAmount: money().notNull().default("0"), // always positive

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Once per document (header terms) / once per line (line terms).
    uniqueIndex("PurchaseDocumentTerm_header_key")
      .on(t.documentType, t.documentId, t.termId)
      .where(sql`${t.documentLineId} IS NULL`),
    uniqueIndex("PurchaseDocumentTerm_line_key")
      .on(t.documentType, t.documentId, t.documentLineId, t.termId)
      .where(sql`${t.documentLineId} IS NOT NULL`),
    index("PurchaseDocumentTerm_document_idx").on(
      t.documentType,
      t.documentId,
      t.sequence,
    ),
    index("PurchaseDocumentTerm_termId_idx").on(t.termId),
    index("PurchaseDocumentTerm_companyId_idx").on(t.companyId),
    check(
      "PurchaseDocumentTerm_value_check",
      sql`(${t.calcType} = 'PERCENT' AND ${t.rate} IS NOT NULL) OR (${t.calcType} = 'AMOUNT' AND ${t.inputAmount} IS NOT NULL)`,
    ),
  ],
);

// Landed cost: how a header term was split across item lines.
export const purchaseDocumentTermAllocation = pgTable(
  "PurchaseDocumentTermAllocation",
  {
    id: serial().primaryKey(),
    documentTermId: integer()
      .notNull()
      .references(() => purchaseDocumentTerm.id, { onDelete: "cascade" }),
    documentLineId: integer().notNull(),
    allocatedAmount: money().notNull(),
  },
  (t) => [
    uniqueIndex("PurchaseDocumentTermAllocation_term_line_key").on(
      t.documentTermId,
      t.documentLineId,
    ),
    index("PurchaseDocumentTermAllocation_documentLineId_idx").on(
      t.documentLineId,
    ),
  ],
);

// ============================================================
// SALES  (same shape as purchase, minus landed-cost allocation)
// ============================================================

export const salesTerm = pgTable(
  "SalesTerm",
  {
    id: serial().primaryKey(),
    companyId: integer()
      .notNull()
      .references(() => company.id, { onDelete: "restrict" }),

    code: varchar({ length: 20 }).notNull(),
    name: varchar({ length: 100 }).notNull(),
    category: billingTermCategoryEnum().notNull().default("GENERAL"),
    nature: billingTermNatureEnum().notNull(),

    isProductwise: boolean().notNull().default(false),
    isMandatory: boolean().notNull().default(false),
    sequence: integer().notNull().default(100),

    defaultCalcType: billingCalcTypeEnum().notNull().default("PERCENT"),
    defaultValue: money().notNull().default("0"),
    calcBase: billingCalcBaseEnum().notNull().default("ITEM_VALUE"),
    baseTermId: integer().references((): AnyPgColumn => salesTerm.id, {
      onDelete: "restrict",
    }),

    generalLedgerId: integer().references(() => generalLedger.id, {
      onDelete: "restrict",
    }),

    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("SalesTerm_companyId_code_key").on(t.companyId, t.code),
    index("SalesTerm_companyId_idx").on(t.companyId),
    index("SalesTerm_generalLedgerId_idx").on(t.generalLedgerId),
    check(
      "SalesTerm_base_term_check",
      sql`(${t.calcBase} = 'SINGLE_TERM') = (${t.baseTermId} IS NOT NULL)`,
    ),
  ],
);

export const salesTermDefault = pgTable(
  "SalesTermDefault",
  {
    id: serial().primaryKey(),
    termId: integer()
      .notNull()
      .references(() => salesTerm.id, { onDelete: "cascade" }),
    partyId: integer().references(() => party.id, { onDelete: "cascade" }),
    productId: integer().references(() => product.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("SalesTermDefault_term_party_key")
      .on(t.termId, t.partyId)
      .where(sql`${t.partyId} IS NOT NULL`),
    uniqueIndex("SalesTermDefault_term_product_key")
      .on(t.termId, t.productId)
      .where(sql`${t.productId} IS NOT NULL`),
    index("SalesTermDefault_partyId_idx").on(t.partyId),
    index("SalesTermDefault_productId_idx").on(t.productId),
    check(
      "SalesTermDefault_one_target_check",
      sql`num_nonnulls(${t.partyId}, ${t.productId}) = 1`,
    ),
  ],
);

export const salesDocumentTerm = pgTable(
  "SalesDocumentTerm",
  {
    id: serial().primaryKey(),
    companyId: integer()
      .notNull()
      .references(() => company.id, { onDelete: "restrict" }),

    documentType: salesTermDocTypeEnum().notNull(),
    documentId: integer().notNull(),
    documentLineId: integer(),

    termId: integer()
      .notNull()
      .references(() => salesTerm.id, { onDelete: "restrict" }),

    sequence: integer().notNull(),
    nature: billingTermNatureEnum().notNull(),
    calcBase: billingCalcBaseEnum().notNull(),
    generalLedgerId: integer().references(() => generalLedger.id, {
      onDelete: "restrict",
    }),

    calcType: billingCalcTypeEnum().notNull(),
    rate: rate(),
    inputAmount: money(),

    baseAmount: money().notNull().default("0"),
    calculatedAmount: money().notNull().default("0"),
    isOverridden: boolean().notNull().default(false),
    finalAmount: money().notNull().default("0"),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("SalesDocumentTerm_header_key")
      .on(t.documentType, t.documentId, t.termId)
      .where(sql`${t.documentLineId} IS NULL`),
    uniqueIndex("SalesDocumentTerm_line_key")
      .on(t.documentType, t.documentId, t.documentLineId, t.termId)
      .where(sql`${t.documentLineId} IS NOT NULL`),
    index("SalesDocumentTerm_document_idx").on(
      t.documentType,
      t.documentId,
      t.sequence,
    ),
    index("SalesDocumentTerm_termId_idx").on(t.termId),
    index("SalesDocumentTerm_companyId_idx").on(t.companyId),
    check(
      "SalesDocumentTerm_value_check",
      sql`(${t.calcType} = 'PERCENT' AND ${t.rate} IS NOT NULL) OR (${t.calcType} = 'AMOUNT' AND ${t.inputAmount} IS NOT NULL)`,
    ),
  ],
);
