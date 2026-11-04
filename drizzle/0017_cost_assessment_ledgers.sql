ALTER TABLE "PurchaseTerm" ADD COLUMN "affectsStockValue" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "PurchaseTerm" ADD COLUMN "defaultAgainstLedgerId" integer;--> statement-breakpoint
ALTER TABLE "PurchaseImportAssessment" ADD COLUMN "glPosted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "PurchaseImportAssessment" ADD COLUMN "journalVoucherId" integer;--> statement-breakpoint
ALTER TABLE "PurchaseImportAssessment" ADD COLUMN "reversalVoucherId" integer;--> statement-breakpoint
ALTER TABLE "PurchaseImportAssessmentTerm" ADD COLUMN "generalLedgerId" integer;--> statement-breakpoint
ALTER TABLE "PurchaseImportAssessmentTerm" ADD COLUMN "againstLedgerId" integer;--> statement-breakpoint
ALTER TABLE "PurchaseImportAssessmentTerm" ADD COLUMN "againstSubLedgerId" integer;--> statement-breakpoint
ALTER TABLE "PurchaseImportAssessmentTerm" ADD COLUMN "allocationMode" varchar(10) DEFAULT 'AUTO' NOT NULL;--> statement-breakpoint
ALTER TABLE "PurchaseTerm" ADD CONSTRAINT "PurchaseTerm_defaultAgainstLedgerId_GeneralLedger_id_fk" FOREIGN KEY ("defaultAgainstLedgerId") REFERENCES "public"."GeneralLedger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseImportAssessment" ADD CONSTRAINT "PurchaseImportAssessment_journalVoucherId_JournalVoucher_id_fk" FOREIGN KEY ("journalVoucherId") REFERENCES "public"."JournalVoucher"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseImportAssessment" ADD CONSTRAINT "PurchaseImportAssessment_reversalVoucherId_JournalVoucher_id_fk" FOREIGN KEY ("reversalVoucherId") REFERENCES "public"."JournalVoucher"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseImportAssessmentTerm" ADD CONSTRAINT "PurchaseImportAssessmentTerm_generalLedgerId_GeneralLedger_id_fk" FOREIGN KEY ("generalLedgerId") REFERENCES "public"."GeneralLedger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseImportAssessmentTerm" ADD CONSTRAINT "PurchaseImportAssessmentTerm_againstLedgerId_GeneralLedger_id_fk" FOREIGN KEY ("againstLedgerId") REFERENCES "public"."GeneralLedger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseImportAssessmentTerm" ADD CONSTRAINT "PurchaseImportAssessmentTerm_againstSubLedgerId_SubLedger_id_fk" FOREIGN KEY ("againstSubLedgerId") REFERENCES "public"."SubLedger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "PurchaseTerm_defaultAgainstLedgerId_idx" ON "PurchaseTerm" USING btree ("defaultAgainstLedgerId");--> statement-breakpoint
CREATE UNIQUE INDEX "PurchaseImportAssessment_journalVoucherId_key" ON "PurchaseImportAssessment" USING btree ("journalVoucherId") WHERE "PurchaseImportAssessment"."journalVoucherId" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "PurchaseImportAssessment_reversalVoucherId_key" ON "PurchaseImportAssessment" USING btree ("reversalVoucherId") WHERE "PurchaseImportAssessment"."reversalVoucherId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "PurchaseImportAssessmentTerm_against_idx" ON "PurchaseImportAssessmentTerm" USING btree ("againstLedgerId");--> statement-breakpoint
ALTER TABLE "PurchaseImportAssessment" ADD CONSTRAINT "PurchaseImportAssessment_gl_posted_check" CHECK ("PurchaseImportAssessment"."glPosted" = ("PurchaseImportAssessment"."journalVoucherId" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "PurchaseImportAssessment" ADD CONSTRAINT "PurchaseImportAssessment_reversal_voucher_check" CHECK ("PurchaseImportAssessment"."reversalVoucherId" IS NULL OR ("PurchaseImportAssessment"."glPosted" AND "PurchaseImportAssessment"."reversedAt" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "PurchaseImportAssessmentTerm" ADD CONSTRAINT "PurchaseImportAssessmentTerm_allocation_mode_check" CHECK ("PurchaseImportAssessmentTerm"."allocationMode" IN ('AUTO', 'MANUAL'));--> statement-breakpoint
ALTER TABLE "PurchaseImportAssessmentTerm" ADD CONSTRAINT "PurchaseImportAssessmentTerm_against_differs_check" CHECK ("PurchaseImportAssessmentTerm"."againstLedgerId" IS NULL OR "PurchaseImportAssessmentTerm"."generalLedgerId" IS NULL OR "PurchaseImportAssessmentTerm"."againstLedgerId" <> "PurchaseImportAssessmentTerm"."generalLedgerId");--> statement-breakpoint

-- ============================================================
-- Cost assessment, part 2: ledgers, valuation flag, local goods bills.
--   * every assessed term has its own ledger and an "against" ledger; applying posts Dr own ledger / Cr against ledger
--   * the term master says whether a term affects stock value (import VAT that can be claimed does not)
--   * an assessment (and a linked service cost) may now target a LOCAL goods bill as well as an IMPORT one
-- ============================================================

-- Company isolation for the new ledger / voucher links.
INSERT INTO "namo"."company_link" (tbl, col, link_tbl) VALUES
  ('PurchaseTerm', 'defaultAgainstLedgerId', 'GeneralLedger'),
  ('PurchaseImportAssessment', 'journalVoucherId', 'JournalVoucher'),
  ('PurchaseImportAssessment', 'reversalVoucherId', 'JournalVoucher'),
  ('PurchaseImportAssessmentTerm', 'generalLedgerId', 'GeneralLedger'),
  ('PurchaseImportAssessmentTerm', 'againstLedgerId', 'GeneralLedger'),
  ('PurchaseImportAssessmentTerm', 'againstSubLedgerId', 'SubLedger');
--> statement-breakpoint
DROP TRIGGER namo_company_consistency ON public."PurchaseTerm";
--> statement-breakpoint
CREATE TRIGGER namo_company_consistency BEFORE INSERT OR UPDATE OF "baseTermId", "companyId", "generalLedgerId", "defaultAgainstLedgerId" ON public."PurchaseTerm" FOR EACH ROW EXECUTE FUNCTION "namo"."enforce_company"();
--> statement-breakpoint
DROP TRIGGER namo_company_consistency ON public."PurchaseImportAssessment";
--> statement-breakpoint
CREATE TRIGGER namo_company_consistency BEFORE INSERT OR UPDATE OF "companyId", "branchId", "importBillId", "journalVoucherId", "reversalVoucherId" ON public."PurchaseImportAssessment" FOR EACH ROW EXECUTE FUNCTION "namo"."enforce_company"();
--> statement-breakpoint
DROP TRIGGER namo_company_consistency ON public."PurchaseImportAssessmentTerm";
--> statement-breakpoint
CREATE TRIGGER namo_company_consistency BEFORE INSERT OR UPDATE OF "companyId", "assessmentId", "termId", "generalLedgerId", "againstLedgerId", "againstSubLedgerId" ON public."PurchaseImportAssessmentTerm" FOR EACH ROW EXECUTE FUNCTION "namo"."enforce_company"();
--> statement-breakpoint

-- One-time default for terms that already exist: assessed VAT does not go into stock value (the owner can change any term in the master).
UPDATE "PurchaseTerm" SET "affectsStockValue" = false
 WHERE "category" = 'ADDITIONAL' AND ("code" ILIKE '%vat%' OR "name" ILIKE '%vat%' OR "name" ILIKE '%value added%');
--> statement-breakpoint

-- An assessment may target a posted, active main goods bill, local or import.
CREATE OR REPLACE FUNCTION "namo"."check_import_assessment_target"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target record;
BEGIN
  SELECT "companyId", "branchId", "invoiceType", "purchaseType", "mainBillId", "reversalOfId", "isPosted"
    INTO target FROM public."PurchaseBill" WHERE id = NEW."importBillId" FOR UPDATE;
  IF NOT FOUND OR target."companyId" <> NEW."companyId" OR target."branchId" <> NEW."branchId"
     OR target."purchaseType" NOT IN ('GOODS_PURCHASE_OTHERS','GOODS_PURCHASE_CAPITAL')
     OR target."mainBillId" IS NOT NULL OR target."reversalOfId" IS NOT NULL OR NOT target."isPosted"
     OR EXISTS (SELECT 1 FROM public."PurchaseBill" r WHERE r."reversalOfId" = NEW."importBillId" AND r."isPosted") THEN
    RAISE EXCEPTION 'A cost assessment must point to an active, posted main goods bill in the same company and branch.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

-- A linked service cost may point at a posted, active main goods bill, local or import.
CREATE OR REPLACE FUNCTION "namo"."check_import_cost_source"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target record;
BEGIN
  IF NEW."importCostForBillId" IS NULL THEN RETURN NEW; END IF;
  IF NEW."mainBillId" IS NOT NULL OR NEW."purchaseType" NOT IN ('SERVICE_PURCHASE_OTHERS', 'SERVICE_PURCHASE_CAPITAL') THEN
    RAISE EXCEPTION 'Only a normal service purchase bill can be linked as a cost source.'
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT "companyId", "branchId", "invoiceType", "purchaseType", "mainBillId", "reversalOfId", "isPosted"
    INTO target FROM public."PurchaseBill" WHERE id = NEW."importCostForBillId" FOR UPDATE;
  IF NOT FOUND
     OR target."companyId" <> NEW."companyId"
     OR target."branchId" <> NEW."branchId"
     OR target."purchaseType" NOT IN ('GOODS_PURCHASE_OTHERS', 'GOODS_PURCHASE_CAPITAL')
     OR target."mainBillId" IS NOT NULL
     OR target."reversalOfId" IS NOT NULL
     OR NOT target."isPosted" THEN
    RAISE EXCEPTION 'A cost source must point to an active, posted goods bill in the same company and branch.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "namo"."guard_assessment_basis_change"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_target integer; main_target integer; target_lock_id integer;
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    IF NEW."reversalOfId" IS NOT NULL THEN
      PERFORM 1 FROM public."PurchaseBill" WHERE id = NEW."reversalOfId" FOR UPDATE;
      SELECT "importCostForBillId", "mainBillId" INTO source_target, main_target FROM public."PurchaseBill" WHERE id = NEW."reversalOfId";
      FOR target_lock_id IN
        SELECT DISTINCT link.target_id FROM unnest(ARRAY[source_target, main_target]) AS link(target_id)
         WHERE link.target_id IS NOT NULL ORDER BY link.target_id
      LOOP
        PERFORM 1 FROM public."PurchaseBill" WHERE id = target_lock_id FOR UPDATE;
      END LOOP;
      IF EXISTS (SELECT 1 FROM public."PurchaseImportAssessment" a WHERE a."importBillId" = NEW."reversalOfId" AND a."reversedAt" IS NULL)
         OR (source_target IS NOT NULL AND EXISTS (SELECT 1 FROM public."PurchaseImportAssessment" a WHERE a."importBillId" = source_target AND a."reversedAt" IS NULL))
         OR (main_target IS NOT NULL AND EXISTS (SELECT 1 FROM public."PurchaseImportAssessment" a WHERE a."importBillId" = main_target AND a."reversedAt" IS NULL)) THEN
        RAISE EXCEPTION 'Delete the draft or reverse the active cost assessment before reversing its goods, service, or additional bill.' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    IF TG_OP = 'INSERT' AND NEW."isPosted" AND NEW."importCostForBillId" IS NOT NULL THEN
      PERFORM 1 FROM public."PurchaseBill" WHERE id = NEW."importCostForBillId" FOR UPDATE;
      IF EXISTS (SELECT 1 FROM public."PurchaseImportAssessment" a WHERE a."importBillId" = NEW."importCostForBillId" AND a."isPosted" AND a."reversedAt" IS NULL) THEN
        RAISE EXCEPTION 'Reverse the applied import assessment before inserting a posted linked service invoice.' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    IF TG_OP = 'INSERT' AND NEW."isPosted" AND NEW."mainBillId" IS NOT NULL THEN
      PERFORM 1 FROM public."PurchaseBill" WHERE id = NEW."mainBillId" FOR UPDATE;
      IF EXISTS (SELECT 1 FROM public."PurchaseImportAssessment" a WHERE a."importBillId" = NEW."mainBillId" AND a."isPosted" AND a."reversedAt" IS NULL) THEN
        RAISE EXCEPTION 'Reverse the applied import assessment before inserting a posted additional bill.' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD."isPosted" IS DISTINCT FROM NEW."isPosted" THEN
      FOR target_lock_id IN
        SELECT DISTINCT link.target_id FROM unnest(ARRAY[
          OLD."importCostForBillId", NEW."importCostForBillId", OLD."mainBillId", NEW."mainBillId",
          CASE WHEN OLD."purchaseType" IN ('GOODS_PURCHASE_OTHERS', 'GOODS_PURCHASE_CAPITAL') AND OLD."mainBillId" IS NULL THEN OLD.id END,
          CASE WHEN NEW."purchaseType" IN ('GOODS_PURCHASE_OTHERS', 'GOODS_PURCHASE_CAPITAL') AND NEW."mainBillId" IS NULL THEN NEW.id END
        ]) AS link(target_id)
         WHERE link.target_id IS NOT NULL ORDER BY link.target_id
      LOOP
        PERFORM 1 FROM public."PurchaseBill" WHERE id = target_lock_id FOR UPDATE;
      END LOOP;
      IF EXISTS (SELECT 1 FROM public."PurchaseImportAssessment" a WHERE a."importBillId" IN (
        OLD."importCostForBillId", NEW."importCostForBillId", OLD."mainBillId", NEW."mainBillId",
        CASE WHEN OLD."purchaseType" IN ('GOODS_PURCHASE_OTHERS', 'GOODS_PURCHASE_CAPITAL') AND OLD."mainBillId" IS NULL THEN OLD.id END,
        CASE WHEN NEW."purchaseType" IN ('GOODS_PURCHASE_OTHERS', 'GOODS_PURCHASE_CAPITAL') AND NEW."mainBillId" IS NULL THEN NEW.id END
      ) AND a."isPosted" AND a."reversedAt" IS NULL) THEN
        RAISE EXCEPTION 'Reverse the applied import assessment before changing the posted status of a linked cost-basis bill.' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD."isPosted" AND (
      OLD."mainBillId" IS DISTINCT FROM NEW."mainBillId"
      OR OLD."importCostForBillId" IS DISTINCT FROM NEW."importCostForBillId"
      OR OLD."importCostAllocationBasis" IS DISTINCT FROM NEW."importCostAllocationBasis"
      OR OLD."importCostTreatment" IS DISTINCT FROM NEW."importCostTreatment"
      OR OLD."invoiceType" IS DISTINCT FROM NEW."invoiceType"
      OR OLD."purchaseType" IS DISTINCT FROM NEW."purchaseType"
    ) THEN
      FOR target_lock_id IN
        SELECT DISTINCT link.target_id FROM unnest(ARRAY[
          OLD."importCostForBillId", NEW."importCostForBillId", OLD."mainBillId", NEW."mainBillId",
          CASE WHEN OLD."purchaseType" IN ('GOODS_PURCHASE_OTHERS', 'GOODS_PURCHASE_CAPITAL') AND OLD."mainBillId" IS NULL THEN OLD.id END,
          CASE WHEN NEW."purchaseType" IN ('GOODS_PURCHASE_OTHERS', 'GOODS_PURCHASE_CAPITAL') AND NEW."mainBillId" IS NULL THEN NEW.id END
        ]) AS link(target_id)
         WHERE link.target_id IS NOT NULL ORDER BY link.target_id
      LOOP
        PERFORM 1 FROM public."PurchaseBill" WHERE id = target_lock_id FOR UPDATE;
      END LOOP;
      IF EXISTS (SELECT 1 FROM public."PurchaseImportAssessment" a WHERE a."importBillId" IN (
        OLD."importCostForBillId", NEW."importCostForBillId", OLD."mainBillId", NEW."mainBillId",
        CASE WHEN OLD."purchaseType" IN ('GOODS_PURCHASE_OTHERS', 'GOODS_PURCHASE_CAPITAL') AND OLD."mainBillId" IS NULL THEN OLD.id END,
        CASE WHEN NEW."purchaseType" IN ('GOODS_PURCHASE_OTHERS', 'GOODS_PURCHASE_CAPITAL') AND NEW."mainBillId" IS NULL THEN NEW.id END
      ) AND a."reversedAt" IS NULL) THEN
        RAISE EXCEPTION 'Reverse the active import assessment before changing a posted cost-basis bill or source link.' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "namo"."guard_assessment_header"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."isPosted" THEN
    IF OLD."reversedAt" IS NOT NULL AND (to_jsonb(NEW) - ARRAY['updatedAt']) <> (to_jsonb(OLD) - ARRAY['updatedAt']) THEN
      RAISE EXCEPTION 'A reversed import assessment is immutable.' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD."reversedAt" IS NULL AND (to_jsonb(NEW) - ARRAY['reversedAt','reversedBy','reversalReason','reversalVoucherId','updatedAt'])
       <> (to_jsonb(OLD) - ARRAY['reversedAt','reversedBy','reversalReason','reversalVoucherId','updatedAt']) THEN
      RAISE EXCEPTION 'An applied import assessment cannot be edited; reverse it and create a corrected assessment.' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD."reversedAt" IS NULL AND NEW."reversedAt" IS NOT NULL AND OLD."glPosted" AND NEW."reversalVoucherId" IS NULL THEN
      RAISE EXCEPTION 'Reversing an assessment that posted a voucher needs the reversal voucher.' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD."reversedAt" IS NULL AND NEW."reversedAt" IS NOT NULL AND nullif(btrim(coalesce(NEW."reversalReason",'')), '') IS NULL THEN
      RAISE EXCEPTION 'A reason is required to reverse an applied import assessment.' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF TG_OP = 'UPDATE' AND NOT OLD."isPosted" AND (NEW."reversedAt" IS NOT NULL OR NEW."reversedBy" IS NOT NULL OR NEW."reversalReason" IS NOT NULL) THEN
    RAISE EXCEPTION 'A draft assessment cannot be marked as reversed.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

-- Applying an assessment: every term that carries an amount needs its own ledger and an against ledger, and the assessment must
-- have posted its voucher. (An assessment whose terms are all zero posts nothing.)
CREATE FUNCTION "namo"."check_assessment_apply"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."isPosted" AND NOT OLD."isPosted" THEN
    IF EXISTS (SELECT 1 FROM public."PurchaseImportAssessmentTerm" t
                WHERE t."assessmentId" = NEW.id AND t."finalAmount" > 0 AND (t."generalLedgerId" IS NULL OR t."againstLedgerId" IS NULL)) THEN
      RAISE EXCEPTION 'Every charge with an amount needs its own ledger and an against ledger before the assessment is applied.' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT NEW."glPosted" AND EXISTS (SELECT 1 FROM public."PurchaseImportAssessmentTerm" t WHERE t."assessmentId" = NEW.id AND t."finalAmount" > 0) THEN
      RAISE EXCEPTION 'An applied assessment with charges must post its journal voucher.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER Import_assessment_apply BEFORE UPDATE OF "isPosted", "glPosted" ON public."PurchaseImportAssessment"
  FOR EACH ROW EXECUTE FUNCTION "namo"."check_assessment_apply"();
