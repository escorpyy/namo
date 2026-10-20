import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { createdAt, updatedAt } from "./_helpers";
import {
  billingAllocationBasisEnum,
  billingApplicabilityEnum,
  billingCalculationBasisEnum,
  billingCalculationMethodEnum,
  billingDocumentTypeEnum,
  billingPlacementEnum,
  billingRoundingMethodEnum,
  billingSignEnum,
  billingTaxTreatmentEnum,
  billingTermCategoryEnum,
  billingTermNatureEnum,
  billingTermStatusEnum,
  billingValuationTreatmentEnum,
} from "./enums";
import { company, user } from "./core";
import { generalLedger } from "./accounting";

// ============================================================
// BILLING TERMS
//
// Architecture (see design notes):
//   BillingTerm              reusable calculation-rule master (versioned)
//   BillingTermRule          conditional applicability (JSON AND/OR rules)
//   BillingTermTemplate      reusable, ordered group of terms
//   BillingTermTemplateLine  one term inside a template (+ overrides)
//   DocumentBillingTerm      immutable per-document calculation snapshot
//
// Amount/rate columns use numeric(20, 8) — wider than `money()` — so that
// rates, allocations and FX conversions keep precision. Drizzle returns
// numeric as string; do arithmetic with a decimal library.
//
// Rules that need service-layer enforcement (cannot be expressed here):
//   - `formula` is a structured AST, never executable code; validate
//     operators/variables and reject circular dependencies.
//   - DocumentBillingTerm.documentId is polymorphic (no FK) — validate
//     documentType + documentId in the service layer.
//   - Posted documents must never be recalculated from the live master.
//   - Editing an ACTIVE term should create a new `version` row.
// ============================================================

const amount = () => numeric({ precision: 20, scale: 8 });

// ------------------------------------------------------------
// BILLING TERM (master)
// ------------------------------------------------------------

export const billingTerm = pgTable(
  "BillingTerm",
  {
    id: serial().primaryKey(),
    companyId: integer()
      .notNull()
      .references(() => company.id, { onDelete: "restrict" }),

    code: varchar({ length: 30 }).notNull(), // FREIGHT_IN
    name: varchar({ length: 100 }).notNull(), // Inbound Freight
    description: varchar({ length: 500 }),

    category: billingTermCategoryEnum().notNull().default("GENERAL"),
    nature: billingTermNatureEnum().notNull().default("CHARGE"),
    applicability: billingApplicabilityEnum().notNull().default("BOTH"),
    status: billingTermStatusEnum().notNull().default("DRAFT"),

    // --- Calculation ---------------------------------------------------
    calculationMethod: billingCalculationMethodEnum().notNull(),
    calculationBasis: billingCalculationBasisEnum().notNull().default("NET_VALUE"),
    rate: amount(),
    fixedAmount: amount(),
    currencyCode: varchar({ length: 3 }),
    formula: jsonb(), // structured AST, validated by the formula engine
    formulaVersion: integer().notNull().default(1),

    // --- Sign & calculation behaviour ---------------------------------
    sign: billingSignEnum().notNull().default("ADD"),
    isTaxInclusive: boolean().notNull().default(false),
    applyBeforeDiscount: boolean().notNull().default(true),
    allowManualAmount: boolean().notNull().default(false),
    allowManualRate: boolean().notNull().default(false),
    isOptional: boolean().notNull().default(true),
    isCompound: boolean().notNull().default(false),

    // --- Placement & sequence -----------------------------------------
    defaultPlacement: billingPlacementEnum().notNull().default("HEADER"),
    defaultSequence: integer().notNull().default(100),
    dependsOnPrevious: boolean().notNull().default(false),
    previousTermCode: varchar({ length: 30 }),

    // --- Accounting ----------------------------------------------------
    ledgerId: integer().references(() => generalLedger.id, {
      onDelete: "restrict",
    }),
    taxLedgerId: integer().references(() => generalLedger.id, {
      onDelete: "restrict",
    }),
    debitLedgerId: integer().references(() => generalLedger.id, {
      onDelete: "restrict",
    }),
    creditLedgerId: integer().references(() => generalLedger.id, {
      onDelete: "restrict",
    }),
    taxTreatment: billingTaxTreatmentEnum().notNull().default("NOT_APPLICABLE"),

    // --- Tax dependency -----------------------------------------------
    isTaxable: boolean().notNull().default(false),
    taxGroupCode: varchar({ length: 20 }),
    taxDependsOnPreviousTerm: boolean().notNull().default(false),
    compoundTax: boolean().notNull().default(false),

    // --- Discount behaviour -------------------------------------------
    discountAffectsTax: boolean().notNull().default(true),
    discountAllocationBasis: billingAllocationBasisEnum(),
    discountAppliesToPreviousDiscount: boolean().notNull().default(false),

    // --- Stock valuation ----------------------------------------------
    valuationTreatment: billingValuationTreatmentEnum().notNull().default("NONE"),
    allocationBasis: billingAllocationBasisEnum(),
    allocateToStockOnly: boolean().notNull().default(false),
    excludeServiceItems: boolean().notNull().default(false),
    excludeNonStockItems: boolean().notNull().default(false),
    excludeFreeItems: boolean().notNull().default(false),
    allocationRemainderToLastLine: boolean().notNull().default(true),

    // --- Limits & precision -------------------------------------------
    minBaseAmount: amount(),
    maxBaseAmount: amount(),
    minTermAmount: amount(),
    maxTermAmount: amount(),
    minQuantity: amount(),
    maxQuantity: amount(),
    minimumRate: amount(),
    maximumRate: amount(),
    calculationPriority: integer().notNull().default(100),
    decimalPlaces: integer().notNull().default(2),
    roundingMethod: billingRoundingMethodEnum().notNull().default("HALF_UP"),

    // --- Controls ------------------------------------------------------
    allowNegativeResult: boolean().notNull().default(false),
    stopIfBaseIsZero: boolean().notNull().default(true),
    requireApprovalOnOverride: boolean().notNull().default(false),

    // --- Document & display behaviour ---------------------------------
    showOnDocument: boolean().notNull().default(true),
    showInPrint: boolean().notNull().default(true),
    includeInSubtotal: boolean().notNull().default(true),
    affectsGrandTotal: boolean().notNull().default(true),
    affectsReceivablePayable: boolean().notNull().default(true),

    // --- Governance ----------------------------------------------------
    effectiveFrom: timestamp({ precision: 3 }),
    effectiveTo: timestamp({ precision: 3 }),
    version: integer().notNull().default(1),
    isSystem: boolean().notNull().default(false),
    createdBy: integer().references(() => user.id, { onDelete: "set null" }),
    updatedBy: integer().references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp({ precision: 3 }),
  },
  (t) => [
    uniqueIndex("BillingTerm_companyId_code_version_key").on(
      t.companyId,
      t.code,
      t.version,
    ),
    index("BillingTerm_companyId_status_applicability_idx").on(
      t.companyId,
      t.status,
      t.applicability,
    ),
    index("BillingTerm_companyId_category_idx").on(t.companyId, t.category),
    index("BillingTerm_ledgerId_idx").on(t.ledgerId),
    index("BillingTerm_effective_idx").on(t.effectiveFrom, t.effectiveTo),
    check("BillingTerm_decimalPlaces_check", sql`${t.decimalPlaces} BETWEEN 0 AND 8`),
    check(
      "BillingTerm_effective_range_check",
      sql`${t.effectiveTo} IS NULL OR ${t.effectiveFrom} IS NULL OR ${t.effectiveTo} >= ${t.effectiveFrom}`,
    ),
    check(
      "BillingTerm_rate_range_check",
      sql`${t.minimumRate} IS NULL OR ${t.maximumRate} IS NULL OR ${t.maximumRate} >= ${t.minimumRate}`,
    ),
  ],
);

// ------------------------------------------------------------
// BILLING TERM RULE — conditional applicability
// `conditions` holds a structured AND/OR tree (supplier group, product
// group, quantity threshold, currency, warehouse, ...), validated by the
// rule engine. Real master records should still be referenced by FK
// elsewhere; JSON only holds the flexible condition structure.
// ------------------------------------------------------------

export const billingTermRule = pgTable(
  "BillingTermRule",
  {
    id: serial().primaryKey(),
    companyId: integer()
      .notNull()
      .references(() => company.id, { onDelete: "restrict" }),
    termId: integer()
      .notNull()
      .references(() => billingTerm.id, { onDelete: "cascade" }),

    name: varchar({ length: 100 }).notNull(),
    priority: integer().notNull().default(100),
    isActive: boolean().notNull().default(true),
    conditions: jsonb().notNull(),

    effectiveFrom: timestamp({ precision: 3 }),
    effectiveTo: timestamp({ precision: 3 }),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("BillingTermRule_companyId_termId_active_priority_idx").on(
      t.companyId,
      t.termId,
      t.isActive,
      t.priority,
    ),
    index("BillingTermRule_effective_idx").on(t.effectiveFrom, t.effectiveTo),
  ],
);

// ------------------------------------------------------------
// BILLING TERM TEMPLATE
// ------------------------------------------------------------

export const billingTermTemplate = pgTable(
  "BillingTermTemplate",
  {
    id: serial().primaryKey(),
    companyId: integer()
      .notNull()
      .references(() => company.id, { onDelete: "restrict" }),

    code: varchar({ length: 30 }).notNull(),
    name: varchar({ length: 100 }).notNull(),
    description: varchar({ length: 500 }),

    applicability: billingApplicabilityEnum().notNull().default("BOTH"),
    status: billingTermStatusEnum().notNull().default("DRAFT"),

    isDefault: boolean().notNull().default(false),
    currencyCode: varchar({ length: 3 }),
    effectiveFrom: timestamp({ precision: 3 }),
    effectiveTo: timestamp({ precision: 3 }),

    // Array of BillingDocumentType values this template may be used on.
    appliesToDocuments: jsonb(),
    priority: integer().notNull().default(100),

    createdBy: integer().references(() => user.id, { onDelete: "set null" }),
    updatedBy: integer().references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("BillingTermTemplate_companyId_code_key").on(t.companyId, t.code),
    index("BillingTermTemplate_companyId_status_applicability_idx").on(
      t.companyId,
      t.status,
      t.applicability,
    ),
    index("BillingTermTemplate_companyId_isDefault_priority_idx").on(
      t.companyId,
      t.isDefault,
      t.priority,
    ),
  ],
);

export const billingTermTemplateLine = pgTable(
  "BillingTermTemplateLine",
  {
    id: serial().primaryKey(),
    templateId: integer()
      .notNull()
      .references(() => billingTermTemplate.id, { onDelete: "cascade" }),
    termId: integer()
      .notNull()
      .references(() => billingTerm.id, { onDelete: "restrict" }),

    sequence: integer().notNull().default(100),
    placement: billingPlacementEnum(),

    // Optional template-level overrides of the master term
    calculationMethod: billingCalculationMethodEnum(),
    calculationBasis: billingCalculationBasisEnum(),
    rate: amount(),
    fixedAmount: amount(),
    sign: billingSignEnum(),
    ledgerId: integer().references(() => generalLedger.id, {
      onDelete: "restrict",
    }),
    isEnabled: boolean().notNull().default(true),
    isMandatory: boolean().notNull().default(false),

    // Dependency on another line in the same template
    dependsOnLineId: integer().references(
      (): AnyPgColumn => billingTermTemplateLine.id,
      { onDelete: "set null" },
    ),
    settings: jsonb(),
  },
  (t) => [
    uniqueIndex("BillingTermTemplateLine_templateId_termId_key").on(
      t.templateId,
      t.termId,
    ),
    uniqueIndex("BillingTermTemplateLine_templateId_sequence_key").on(
      t.templateId,
      t.sequence,
    ),
    index("BillingTermTemplateLine_termId_idx").on(t.termId),
    index("BillingTermTemplateLine_dependsOnLineId_idx").on(t.dependsOnLineId),
  ],
);

// ------------------------------------------------------------
// DOCUMENT BILLING TERM — immutable calculation snapshot
// Stores the term definition + result as used on a specific document so
// later master edits never silently change posted documents.
// ------------------------------------------------------------

export const documentBillingTerm = pgTable(
  "DocumentBillingTerm",
  {
    id: serial().primaryKey(),
    companyId: integer()
      .notNull()
      .references(() => company.id, { onDelete: "restrict" }),

    // Polymorphic link to the transaction header/line — no FK (see above).
    documentType: billingDocumentTypeEnum().notNull(),
    documentId: integer().notNull(),
    documentLineId: integer(),

    // Master references; nullable for ad-hoc terms. Set null so deleting a
    // master never destroys history (snapshot columns below remain).
    termId: integer().references(() => billingTerm.id, { onDelete: "set null" }),
    templateId: integer().references(() => billingTermTemplate.id, {
      onDelete: "set null",
    }),
    templateLineId: integer().references(() => billingTermTemplateLine.id, {
      onDelete: "set null",
    }),

    // --- Snapshot of definition at calculation time -------------------
    termCode: varchar({ length: 30 }).notNull(),
    termName: varchar({ length: 100 }).notNull(),
    category: billingTermCategoryEnum().notNull(),
    nature: billingTermNatureEnum().notNull(),
    placement: billingPlacementEnum().notNull(),
    sequence: integer().notNull(),
    calculationMethod: billingCalculationMethodEnum().notNull(),
    calculationBasis: billingCalculationBasisEnum().notNull(),
    sign: billingSignEnum().notNull(),
    rate: amount(),
    formulaSnapshot: jsonb(),

    // --- Calculation result -------------------------------------------
    quantity: amount(),
    baseAmount: amount().notNull().default("0"),
    taxableBase: amount().notNull().default("0"),
    calculatedAmount: amount().notNull().default("0"), // positive magnitude
    signedAmount: amount().notNull().default("0"), // after sign applied
    taxAmount: amount().notNull().default("0"),

    // --- Currency ------------------------------------------------------
    currencyCode: varchar({ length: 3 }),
    exchangeRate: numeric({ precision: 20, scale: 10 }),
    baseCurrencyAmount: amount(),

    // --- Accounting & valuation snapshots -----------------------------
    ledgerId: integer().references(() => generalLedger.id, {
      onDelete: "restrict",
    }),
    taxLedgerId: integer().references(() => generalLedger.id, {
      onDelete: "restrict",
    }),
    taxTreatment: billingTaxTreatmentEnum().notNull(),
    valuationTreatment: billingValuationTreatmentEnum().notNull(),
    allocatedStockAmount: amount().notNull().default("0"),

    // --- Audit & calculation trace ------------------------------------
    calculationInputs: jsonb(),
    calculationTrace: jsonb(),
    isManualOverride: boolean().notNull().default(false),
    overrideReason: varchar({ length: 500 }),
    calculatedAt: timestamp({ precision: 3 }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    index("DocumentBillingTerm_document_idx").on(
      t.documentType,
      t.documentId,
      t.sequence,
    ),
    index("DocumentBillingTerm_companyId_idx").on(t.companyId),
    index("DocumentBillingTerm_documentLineId_idx").on(t.documentLineId),
    index("DocumentBillingTerm_termId_idx").on(t.termId),
    index("DocumentBillingTerm_ledgerId_idx").on(t.ledgerId),
    check(
      "DocumentBillingTerm_override_reason_check",
      sql`NOT ${t.isManualOverride} OR ${t.overrideReason} IS NOT NULL`,
    ),
  ],
);
