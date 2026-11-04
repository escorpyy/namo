import { sql } from "drizzle-orm";
import { boolean, check, date, foreignKey, index, integer, numeric, pgTable, serial, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { createdAt, updatedAt } from "./_helpers";
import { billingAllocationBasisEnum, billingCalcBaseEnum, billingCalcTypeEnum, billingTermNatureEnum } from "./enums";
import { branch, company, user } from "./core";
import { generalLedger, subLedger } from "./accounting";
import { journalVoucher } from "./vouchers";
import { purchaseBill, purchaseBillLine } from "./purchaseBill";
import { purchaseTerm } from "./billing";

const money = () => numeric({ precision: 18, scale: 6 });
const rate = () => numeric({ precision: 9, scale: 4 });

export const purchaseImportAssessment = pgTable("PurchaseImportAssessment", {
  id: serial().primaryKey(),
  companyId: integer().notNull().references(() => company.id, { onDelete: "restrict" }),
  branchId: integer().notNull().references(() => branch.id, { onDelete: "restrict" }),
  importBillId: integer().notNull().references(() => purchaseBill.id, { onDelete: "restrict" }),
  assessmentNumber: varchar({ length: 30 }).notNull(),
  assessmentDate: date({ mode: "date" }).notNull(),
  fiscalYear: varchar({ length: 15 }).notNull(),
  referenceNo: varchar({ length: 100 }),
  remarks: varchar({ length: 1024 }),
  goodsValue: money().notNull().default("0"),
  customsValueFromSources: money().notNull().default("0"),
  cifValue: money().notNull().default("0"),
  invoicedCapitalizedCosts: money().notNull().default("0"),
  assessedNet: money().notNull().default("0"),
  capitalizedAssessments: money().notNull().default("0"),
  totalLandedValue: money().notNull().default("0"),
  isPosted: boolean().notNull().default(false),
  // Applying posts one journal voucher (Dr each term's ledger / Cr its against ledger); reversing posts the mirror voucher.
  // glPosted is false only for an assessment applied before vouchers existed, or one whose terms all came to zero.
  glPosted: boolean().notNull().default(false),
  journalVoucherId: integer().references(() => journalVoucher.id, { onDelete: "restrict" }),
  reversalVoucherId: integer().references(() => journalVoucher.id, { onDelete: "restrict" }),
  appliedAt: timestamp({ precision: 3 }),
  appliedBy: integer().references(() => user.id, { onDelete: "set null" }),
  reversedAt: timestamp({ precision: 3 }),
  reversedBy: integer().references(() => user.id, { onDelete: "set null" }),
  reversalReason: varchar({ length: 500 }),
  createdBy: integer().references(() => user.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("PurchaseImportAssessment_branch_fy_number_key").on(t.branchId, t.fiscalYear, t.assessmentNumber),
  uniqueIndex("PurchaseImportAssessment_active_bill_key").on(t.importBillId).where(sql`${t.reversedAt} IS NULL`),
  index("PurchaseImportAssessment_company_branch_fy_idx").on(t.companyId, t.branchId, t.fiscalYear),
  index("PurchaseImportAssessment_importBillId_idx").on(t.importBillId),
  uniqueIndex("PurchaseImportAssessment_journalVoucherId_key").on(t.journalVoucherId).where(sql`${t.journalVoucherId} IS NOT NULL`),
  uniqueIndex("PurchaseImportAssessment_reversalVoucherId_key").on(t.reversalVoucherId).where(sql`${t.reversalVoucherId} IS NOT NULL`),
  check("PurchaseImportAssessment_gl_posted_check", sql`${t.glPosted} = (${t.journalVoucherId} IS NOT NULL)`),
  check("PurchaseImportAssessment_reversal_voucher_check", sql`${t.reversalVoucherId} IS NULL OR (${t.glPosted} AND ${t.reversedAt} IS NOT NULL)`),
]);

export const purchaseImportAssessmentTerm = pgTable("PurchaseImportAssessmentTerm", {
  id: serial().primaryKey(),
  companyId: integer().notNull().references(() => company.id, { onDelete: "restrict" }),
  assessmentId: integer().notNull().references(() => purchaseImportAssessment.id, { onDelete: "cascade" }),
  termId: integer().notNull().references(() => purchaseTerm.id, { onDelete: "restrict" }),
  code: varchar({ length: 20 }).notNull(),
  name: varchar({ length: 100 }).notNull(),
  nature: billingTermNatureEnum().notNull(),
  calcBase: billingCalcBaseEnum().notNull(),
  baseTermId: integer(),
  sequence: integer().notNull(),
  calcType: billingCalcTypeEnum().notNull(),
  rate: rate(),
  inputAmount: money(),
  isOverridden: boolean().notNull().default(false),
  overrideAmount: money(),
  baseAmount: money().notNull().default("0"),
  calculatedAmount: money().notNull().default("0"),
  finalAmount: money().notNull().default("0"),
  allocationBasis: billingAllocationBasisEnum().notNull(),
  // "Affects stock value": defaults from the term master, may be overridden on the row.
  capitalizable: boolean().notNull().default(true),
  // The term's own ledger, copied from the master when the row is saved, and the other side of the entry, chosen per case.
  generalLedgerId: integer().references(() => generalLedger.id, { onDelete: "restrict" }),
  againstLedgerId: integer().references(() => generalLedger.id, { onDelete: "restrict" }),
  againstSubLedgerId: integer().references(() => subLedger.id, { onDelete: "restrict" }),
  // AUTO splits the amount over the goods lines by value or quantity; MANUAL uses the per-line amounts the user typed.
  allocationMode: varchar({ length: 10 }).notNull().default("AUTO"),
  createdAt: createdAt(),
}, (t) => [
  check("PurchaseImportAssessmentTerm_allocation_mode_check", sql`${t.allocationMode} IN ('AUTO', 'MANUAL')`),
  check("PurchaseImportAssessmentTerm_against_differs_check", sql`${t.againstLedgerId} IS NULL OR ${t.generalLedgerId} IS NULL OR ${t.againstLedgerId} <> ${t.generalLedgerId}`),
  index("PurchaseImportAssessmentTerm_against_idx").on(t.againstLedgerId),
  index("PurchaseImportAssessmentTerm_assessment_idx").on(t.assessmentId, t.sequence, t.id),
  uniqueIndex("PurchaseImportAssessmentTerm_assessment_term_key").on(t.assessmentId, t.termId),
]);

export const purchaseImportAssessmentAllocation = pgTable("PurchaseImportAssessmentAllocation", {
  id: serial().primaryKey(),
  companyId: integer().notNull().references(() => company.id, { onDelete: "restrict" }),
  assessmentId: integer().notNull().references(() => purchaseImportAssessment.id, { onDelete: "cascade" }),
  assessmentTermId: integer().notNull(),
  purchaseBillLineId: integer().notNull().references(() => purchaseBillLine.id, { onDelete: "restrict" }),
  allocatedAmount: money().notNull(),
}, (t) => [
  foreignKey({ name: "PurchaseImportAssessmentAlloc_term_fk", columns: [t.assessmentTermId], foreignColumns: [purchaseImportAssessmentTerm.id] }).onDelete("cascade"),
  uniqueIndex("PurchaseImportAssessmentAllocation_term_line_key").on(t.assessmentTermId, t.purchaseBillLineId),
  index("PurchaseImportAssessmentAllocation_line_idx").on(t.purchaseBillLineId),
]);

export const purchaseImportAssessmentLine = pgTable("PurchaseImportAssessmentLine", {
  id: serial().primaryKey(),
  companyId: integer().notNull().references(() => company.id, { onDelete: "restrict" }),
  assessmentId: integer().notNull().references(() => purchaseImportAssessment.id, { onDelete: "cascade" }),
  purchaseBillLineId: integer().notNull().references(() => purchaseBillLine.id, { onDelete: "restrict" }),
  goodsValue: money().notNull(),
  customsValue: money().notNull(),
  capitalizedSources: money().notNull(),
  existingPurchaseTermCosts: money().notNull().default("0"),
  capitalizedAssessments: money().notNull(),
  landedValue: money().notNull(),
  landedRate: money().notNull(),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("PurchaseImportAssessmentLine_assessment_line_key").on(t.assessmentId, t.purchaseBillLineId),
  index("PurchaseImportAssessmentLine_purchaseBillLineId_idx").on(t.purchaseBillLineId),
]);
