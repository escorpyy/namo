CREATE TABLE "PurchaseImportAssessment" (
	"id" serial PRIMARY KEY NOT NULL,
	"companyId" integer NOT NULL,
	"branchId" integer NOT NULL,
	"importBillId" integer NOT NULL,
	"assessmentNumber" varchar(30) NOT NULL,
	"assessmentDate" date NOT NULL,
	"fiscalYear" varchar(15) NOT NULL,
	"referenceNo" varchar(100),
	"remarks" varchar(1024),
	"goodsValue" numeric(18, 6) DEFAULT '0' NOT NULL,
	"customsValueFromSources" numeric(18, 6) DEFAULT '0' NOT NULL,
	"cifValue" numeric(18, 6) DEFAULT '0' NOT NULL,
	"invoicedCapitalizedCosts" numeric(18, 6) DEFAULT '0' NOT NULL,
	"assessedNet" numeric(18, 6) DEFAULT '0' NOT NULL,
	"capitalizedAssessments" numeric(18, 6) DEFAULT '0' NOT NULL,
	"totalLandedValue" numeric(18, 6) DEFAULT '0' NOT NULL,
	"isPosted" boolean DEFAULT false NOT NULL,
	"appliedAt" timestamp (3),
	"appliedBy" integer,
	"reversedAt" timestamp (3),
	"reversedBy" integer,
	"reversalReason" varchar(500),
	"createdBy" integer,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "PurchaseImportAssessmentAllocation" (
	"id" serial PRIMARY KEY NOT NULL,
	"companyId" integer NOT NULL,
	"assessmentId" integer NOT NULL,
	"assessmentTermId" integer NOT NULL,
	"purchaseBillLineId" integer NOT NULL,
	"allocatedAmount" numeric(18, 6) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "PurchaseImportAssessmentLine" (
	"id" serial PRIMARY KEY NOT NULL,
	"companyId" integer NOT NULL,
	"assessmentId" integer NOT NULL,
	"purchaseBillLineId" integer NOT NULL,
	"goodsValue" numeric(18, 6) NOT NULL,
	"customsValue" numeric(18, 6) NOT NULL,
	"capitalizedSources" numeric(18, 6) NOT NULL,
	"capitalizedAssessments" numeric(18, 6) NOT NULL,
	"landedValue" numeric(18, 6) NOT NULL,
	"landedRate" numeric(18, 6) NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "PurchaseImportAssessmentTerm" (
	"id" serial PRIMARY KEY NOT NULL,
	"companyId" integer NOT NULL,
	"assessmentId" integer NOT NULL,
	"termId" integer NOT NULL,
	"code" varchar(20) NOT NULL,
	"name" varchar(100) NOT NULL,
	"nature" "BillingTermNature" NOT NULL,
	"calcBase" "BillingCalcBase" NOT NULL,
	"baseTermId" integer,
	"sequence" integer NOT NULL,
	"calcType" "BillingCalcType" NOT NULL,
	"rate" numeric(9, 4),
	"inputAmount" numeric(18, 6),
	"isOverridden" boolean DEFAULT false NOT NULL,
	"overrideAmount" numeric(18, 6),
	"baseAmount" numeric(18, 6) DEFAULT '0' NOT NULL,
	"calculatedAmount" numeric(18, 6) DEFAULT '0' NOT NULL,
	"finalAmount" numeric(18, 6) DEFAULT '0' NOT NULL,
	"allocationBasis" "BillingAllocationBasis" NOT NULL,
	"capitalizable" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "PurchaseImportAssessment" ADD CONSTRAINT "PurchaseImportAssessment_companyId_Company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseImportAssessment" ADD CONSTRAINT "PurchaseImportAssessment_branchId_Branch_id_fk" FOREIGN KEY ("branchId") REFERENCES "public"."Branch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseImportAssessment" ADD CONSTRAINT "PurchaseImportAssessment_importBillId_PurchaseBill_id_fk" FOREIGN KEY ("importBillId") REFERENCES "public"."PurchaseBill"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseImportAssessment" ADD CONSTRAINT "PurchaseImportAssessment_appliedBy_User_id_fk" FOREIGN KEY ("appliedBy") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseImportAssessment" ADD CONSTRAINT "PurchaseImportAssessment_reversedBy_User_id_fk" FOREIGN KEY ("reversedBy") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseImportAssessment" ADD CONSTRAINT "PurchaseImportAssessment_createdBy_User_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseImportAssessmentAllocation" ADD CONSTRAINT "PurchaseImportAssessmentAllocation_companyId_Company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseImportAssessmentAllocation" ADD CONSTRAINT "PurchaseImportAssessmentAllocation_assessmentId_PurchaseImportAssessment_id_fk" FOREIGN KEY ("assessmentId") REFERENCES "public"."PurchaseImportAssessment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseImportAssessmentAllocation" ADD CONSTRAINT "PurchaseImportAssessmentAllocation_purchaseBillLineId_PurchaseBillLine_id_fk" FOREIGN KEY ("purchaseBillLineId") REFERENCES "public"."PurchaseBillLine"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseImportAssessmentAllocation" ADD CONSTRAINT "PurchaseImportAssessmentAlloc_term_fk" FOREIGN KEY ("assessmentTermId") REFERENCES "public"."PurchaseImportAssessmentTerm"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseImportAssessmentLine" ADD CONSTRAINT "PurchaseImportAssessmentLine_companyId_Company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseImportAssessmentLine" ADD CONSTRAINT "PurchaseImportAssessmentLine_assessmentId_PurchaseImportAssessment_id_fk" FOREIGN KEY ("assessmentId") REFERENCES "public"."PurchaseImportAssessment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseImportAssessmentLine" ADD CONSTRAINT "PurchaseImportAssessmentLine_purchaseBillLineId_PurchaseBillLine_id_fk" FOREIGN KEY ("purchaseBillLineId") REFERENCES "public"."PurchaseBillLine"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseImportAssessmentTerm" ADD CONSTRAINT "PurchaseImportAssessmentTerm_companyId_Company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseImportAssessmentTerm" ADD CONSTRAINT "PurchaseImportAssessmentTerm_assessmentId_PurchaseImportAssessment_id_fk" FOREIGN KEY ("assessmentId") REFERENCES "public"."PurchaseImportAssessment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseImportAssessmentTerm" ADD CONSTRAINT "PurchaseImportAssessmentTerm_termId_PurchaseTerm_id_fk" FOREIGN KEY ("termId") REFERENCES "public"."PurchaseTerm"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "PurchaseImportAssessment_branch_fy_number_key" ON "PurchaseImportAssessment" USING btree ("branchId","fiscalYear","assessmentNumber");--> statement-breakpoint
CREATE UNIQUE INDEX "PurchaseImportAssessment_active_bill_key" ON "PurchaseImportAssessment" USING btree ("importBillId") WHERE "PurchaseImportAssessment"."reversedAt" IS NULL;--> statement-breakpoint
CREATE INDEX "PurchaseImportAssessment_company_branch_fy_idx" ON "PurchaseImportAssessment" USING btree ("companyId","branchId","fiscalYear");--> statement-breakpoint
CREATE INDEX "PurchaseImportAssessment_importBillId_idx" ON "PurchaseImportAssessment" USING btree ("importBillId");--> statement-breakpoint
CREATE UNIQUE INDEX "PurchaseImportAssessmentAllocation_term_line_key" ON "PurchaseImportAssessmentAllocation" USING btree ("assessmentTermId","purchaseBillLineId");--> statement-breakpoint
CREATE INDEX "PurchaseImportAssessmentAllocation_line_idx" ON "PurchaseImportAssessmentAllocation" USING btree ("purchaseBillLineId");--> statement-breakpoint
CREATE UNIQUE INDEX "PurchaseImportAssessmentLine_assessment_line_key" ON "PurchaseImportAssessmentLine" USING btree ("assessmentId","purchaseBillLineId");--> statement-breakpoint
CREATE INDEX "PurchaseImportAssessmentLine_purchaseBillLineId_idx" ON "PurchaseImportAssessmentLine" USING btree ("purchaseBillLineId");--> statement-breakpoint
CREATE INDEX "PurchaseImportAssessmentTerm_assessment_idx" ON "PurchaseImportAssessmentTerm" USING btree ("assessmentId","sequence","id");--> statement-breakpoint
CREATE UNIQUE INDEX "PurchaseImportAssessmentTerm_assessment_term_key" ON "PurchaseImportAssessmentTerm" USING btree ("assessmentId","termId");
--> statement-breakpoint

-- Company isolation for the separate, non-GL import cost assessment document and its immutable snapshots.
INSERT INTO "namo"."company_source" (tbl, ord, via_col, via_tbl) VALUES
  ('PurchaseImportAssessment', 1, NULL, NULL),
  ('PurchaseImportAssessmentTerm', 1, NULL, NULL),
  ('PurchaseImportAssessmentAllocation', 1, NULL, NULL),
  ('PurchaseImportAssessmentLine', 1, NULL, NULL);
--> statement-breakpoint
INSERT INTO "namo"."company_link" (tbl, col, link_tbl) VALUES
  ('PurchaseImportAssessment', 'branchId', 'Branch'),
  ('PurchaseImportAssessment', 'importBillId', 'PurchaseBill'),
  ('PurchaseImportAssessmentTerm', 'assessmentId', 'PurchaseImportAssessment'),
  ('PurchaseImportAssessmentTerm', 'termId', 'PurchaseTerm'),
  ('PurchaseImportAssessmentAllocation', 'assessmentId', 'PurchaseImportAssessment'),
  ('PurchaseImportAssessmentAllocation', 'assessmentTermId', 'PurchaseImportAssessmentTerm'),
  ('PurchaseImportAssessmentAllocation', 'purchaseBillLineId', 'PurchaseBillLine'),
  ('PurchaseImportAssessmentLine', 'assessmentId', 'PurchaseImportAssessment'),
  ('PurchaseImportAssessmentLine', 'purchaseBillLineId', 'PurchaseBillLine');
--> statement-breakpoint
CREATE TRIGGER namo_company_consistency BEFORE INSERT OR UPDATE OF "companyId", "branchId", "importBillId" ON public."PurchaseImportAssessment" FOR EACH ROW EXECUTE FUNCTION "namo"."enforce_company"();
--> statement-breakpoint
CREATE TRIGGER namo_company_consistency BEFORE INSERT OR UPDATE OF "companyId", "assessmentId", "termId" ON public."PurchaseImportAssessmentTerm" FOR EACH ROW EXECUTE FUNCTION "namo"."enforce_company"();
--> statement-breakpoint
CREATE TRIGGER namo_company_consistency BEFORE INSERT OR UPDATE OF "companyId", "assessmentId", "assessmentTermId", "purchaseBillLineId" ON public."PurchaseImportAssessmentAllocation" FOR EACH ROW EXECUTE FUNCTION "namo"."enforce_company"();
--> statement-breakpoint
CREATE TRIGGER namo_company_consistency BEFORE INSERT OR UPDATE OF "companyId", "assessmentId", "purchaseBillLineId" ON public."PurchaseImportAssessmentLine" FOR EACH ROW EXECUTE FUNCTION "namo"."enforce_company"();
--> statement-breakpoint

-- An assessment can only use a posted, unreversed main IMPORT goods bill in the same branch. FOR UPDATE serializes
-- assessment creation/application against source invoice posting and bill reversals.
CREATE FUNCTION "namo"."check_import_assessment_target"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target record;
BEGIN
  SELECT "companyId", "branchId", "invoiceType", "purchaseType", "mainBillId", "reversalOfId", "isPosted"
    INTO target FROM public."PurchaseBill" WHERE id = NEW."importBillId" FOR UPDATE;
  IF NOT FOUND OR target."companyId" <> NEW."companyId" OR target."branchId" <> NEW."branchId"
     OR target."invoiceType" <> 'IMPORT' OR target."purchaseType" NOT IN ('GOODS_PURCHASE_OTHERS','GOODS_PURCHASE_CAPITAL')
     OR target."mainBillId" IS NOT NULL OR target."reversalOfId" IS NOT NULL OR NOT target."isPosted"
     OR EXISTS (SELECT 1 FROM public."PurchaseBill" r WHERE r."reversalOfId" = NEW."importBillId" AND r."isPosted") THEN
    RAISE EXCEPTION 'Import assessment must point to an active, posted main import goods bill in the same company and branch.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER Import_assessment_target BEFORE INSERT OR UPDATE OF "companyId", "branchId", "importBillId", "isPosted" ON public."PurchaseImportAssessment"
  FOR EACH ROW EXECUTE FUNCTION "namo"."check_import_assessment_target"();
--> statement-breakpoint

-- Do not let an applied assessment silently go stale. Reverse it first, then post/reverse a linked source or additional bill,
-- or reverse the target goods bill, and create a new assessment from the revised cost basis.
CREATE FUNCTION "namo"."guard_assessment_basis_change"() RETURNS trigger LANGUAGE plpgsql AS $$
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
        RAISE EXCEPTION 'Delete the draft or reverse the active import assessment before reversing its goods, service, or additional bill.' USING ERRCODE = 'check_violation';
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
          CASE WHEN OLD."invoiceType" = 'IMPORT' AND OLD."purchaseType" IN ('GOODS_PURCHASE_OTHERS', 'GOODS_PURCHASE_CAPITAL') AND OLD."mainBillId" IS NULL THEN OLD.id END,
          CASE WHEN NEW."invoiceType" = 'IMPORT' AND NEW."purchaseType" IN ('GOODS_PURCHASE_OTHERS', 'GOODS_PURCHASE_CAPITAL') AND NEW."mainBillId" IS NULL THEN NEW.id END
        ]) AS link(target_id)
         WHERE link.target_id IS NOT NULL ORDER BY link.target_id
      LOOP
        PERFORM 1 FROM public."PurchaseBill" WHERE id = target_lock_id FOR UPDATE;
      END LOOP;
      IF EXISTS (SELECT 1 FROM public."PurchaseImportAssessment" a WHERE a."importBillId" IN (
        OLD."importCostForBillId", NEW."importCostForBillId", OLD."mainBillId", NEW."mainBillId",
        CASE WHEN OLD."invoiceType" = 'IMPORT' AND OLD."purchaseType" IN ('GOODS_PURCHASE_OTHERS', 'GOODS_PURCHASE_CAPITAL') AND OLD."mainBillId" IS NULL THEN OLD.id END,
        CASE WHEN NEW."invoiceType" = 'IMPORT' AND NEW."purchaseType" IN ('GOODS_PURCHASE_OTHERS', 'GOODS_PURCHASE_CAPITAL') AND NEW."mainBillId" IS NULL THEN NEW.id END
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
          CASE WHEN OLD."invoiceType" = 'IMPORT' AND OLD."purchaseType" IN ('GOODS_PURCHASE_OTHERS', 'GOODS_PURCHASE_CAPITAL') AND OLD."mainBillId" IS NULL THEN OLD.id END,
          CASE WHEN NEW."invoiceType" = 'IMPORT' AND NEW."purchaseType" IN ('GOODS_PURCHASE_OTHERS', 'GOODS_PURCHASE_CAPITAL') AND NEW."mainBillId" IS NULL THEN NEW.id END
        ]) AS link(target_id)
         WHERE link.target_id IS NOT NULL ORDER BY link.target_id
      LOOP
        PERFORM 1 FROM public."PurchaseBill" WHERE id = target_lock_id FOR UPDATE;
      END LOOP;
      IF EXISTS (SELECT 1 FROM public."PurchaseImportAssessment" a WHERE a."importBillId" IN (
        OLD."importCostForBillId", NEW."importCostForBillId", OLD."mainBillId", NEW."mainBillId",
        CASE WHEN OLD."invoiceType" = 'IMPORT' AND OLD."purchaseType" IN ('GOODS_PURCHASE_OTHERS', 'GOODS_PURCHASE_CAPITAL') AND OLD."mainBillId" IS NULL THEN OLD.id END,
        CASE WHEN NEW."invoiceType" = 'IMPORT' AND NEW."purchaseType" IN ('GOODS_PURCHASE_OTHERS', 'GOODS_PURCHASE_CAPITAL') AND NEW."mainBillId" IS NULL THEN NEW.id END
      ) AND a."reversedAt" IS NULL) THEN
        RAISE EXCEPTION 'Reverse the active import assessment before changing a posted cost-basis bill or source link.' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER Import_assessment_basis_guard BEFORE INSERT OR UPDATE OF "reversalOfId", "isPosted", "importCostForBillId", "importCostAllocationBasis", "importCostTreatment", "mainBillId", "invoiceType", "purchaseType" ON public."PurchaseBill"
  FOR EACH ROW EXECUTE FUNCTION "namo"."guard_assessment_basis_change"();
--> statement-breakpoint

CREATE FUNCTION "namo"."guard_assessment_header"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."isPosted" THEN
    IF OLD."reversedAt" IS NOT NULL AND (to_jsonb(NEW) - ARRAY['updatedAt']) <> (to_jsonb(OLD) - ARRAY['updatedAt']) THEN
      RAISE EXCEPTION 'A reversed import assessment is immutable.' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD."reversedAt" IS NULL AND (to_jsonb(NEW) - ARRAY['reversedAt','reversedBy','reversalReason','updatedAt'])
       <> (to_jsonb(OLD) - ARRAY['reversedAt','reversedBy','reversalReason','updatedAt']) THEN
      RAISE EXCEPTION 'An applied import assessment cannot be edited; reverse it and create a corrected assessment.' USING ERRCODE = 'check_violation';
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
CREATE TRIGGER Import_assessment_header_guard BEFORE UPDATE ON public."PurchaseImportAssessment" FOR EACH ROW EXECUTE FUNCTION "namo"."guard_assessment_header"();
--> statement-breakpoint

CREATE FUNCTION "namo"."guard_assessment_children"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_id integer; posted boolean;
BEGIN
  parent_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."assessmentId" ELSE NEW."assessmentId" END;
  SELECT "isPosted" INTO posted FROM public."PurchaseImportAssessment" WHERE id = parent_id;
  IF coalesce(posted, false) THEN RAISE EXCEPTION 'Rows of an applied import assessment are immutable; reverse the assessment first.' USING ERRCODE = 'check_violation'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER Import_assessment_term_guard BEFORE INSERT OR UPDATE OR DELETE ON public."PurchaseImportAssessmentTerm" FOR EACH ROW EXECUTE FUNCTION "namo"."guard_assessment_children"();
--> statement-breakpoint
CREATE TRIGGER Import_assessment_allocation_guard BEFORE INSERT OR UPDATE OR DELETE ON public."PurchaseImportAssessmentAllocation" FOR EACH ROW EXECUTE FUNCTION "namo"."guard_assessment_children"();
--> statement-breakpoint
CREATE TRIGGER Import_assessment_line_guard BEFORE INSERT OR UPDATE OR DELETE ON public."PurchaseImportAssessmentLine" FOR EACH ROW EXECUTE FUNCTION "namo"."guard_assessment_children"();
--> statement-breakpoint
CREATE FUNCTION "namo"."check_import_assessment_child"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected_bill integer; term_parent integer;
BEGIN
  IF TG_TABLE_NAME = 'PurchaseImportAssessmentTerm' THEN RETURN NEW; END IF;
  SELECT "importBillId" INTO expected_bill FROM public."PurchaseImportAssessment" WHERE id = NEW."assessmentId";
  IF expected_bill IS NULL THEN RAISE EXCEPTION 'Assessment row has no parent assessment.' USING ERRCODE = 'check_violation'; END IF;
  IF TG_TABLE_NAME = 'PurchaseImportAssessmentAllocation' THEN
    SELECT "assessmentId" INTO term_parent FROM public."PurchaseImportAssessmentTerm" WHERE id = NEW."assessmentTermId";
    IF term_parent IS DISTINCT FROM NEW."assessmentId" THEN RAISE EXCEPTION 'Assessment allocation term belongs to a different assessment.' USING ERRCODE = 'check_violation'; END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public."PurchaseBillLine" l WHERE l.id = NEW."purchaseBillLineId" AND l."purchaseBillId" = expected_bill) THEN
    RAISE EXCEPTION 'Assessment allocation must point to a line of its linked import goods bill.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER Import_assessment_allocation_line BEFORE INSERT OR UPDATE OF "assessmentId", "assessmentTermId", "purchaseBillLineId" ON public."PurchaseImportAssessmentAllocation"
  FOR EACH ROW EXECUTE FUNCTION "namo"."check_import_assessment_child"();
--> statement-breakpoint
CREATE TRIGGER Import_assessment_snapshot_line BEFORE INSERT OR UPDATE OF "assessmentId", "purchaseBillLineId" ON public."PurchaseImportAssessmentLine"
  FOR EACH ROW EXECUTE FUNCTION "namo"."check_import_assessment_child"();
--> statement-breakpoint

-- Assessment rows are audited like other financial documents; apply is the draft-to-posted transition and reverse requires a reason.
CREATE OR REPLACE FUNCTION "namo"."require_change_reason"() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  old_j jsonb; new_j jsonb; old_posted boolean := false; new_posted boolean := false;
  new_parent_created boolean := false; new_parent_id text := null;
  header_table boolean := TG_TABLE_NAME IN ('JournalVoucher', 'CashBankVoucher', 'PurchaseBill', 'PurchaseImportAssessment');
  why text := nullif(btrim(coalesce(current_setting('namo.change_reason', true), '')), '');
  need_reason boolean := false;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_j := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN new_j := to_jsonb(NEW); END IF;
  IF TG_OP = 'UPDATE' AND old_j = new_j THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'PurchaseBillLine'
     AND (new_j - ARRAY['allocatedTermAmount', 'landedAmount', 'landedRate']) = (old_j - ARRAY['allocatedTermAmount', 'landedAmount', 'landedRate']) THEN RETURN NEW; END IF;
  IF header_table THEN
    IF old_j IS NOT NULL THEN old_posted := coalesce((old_j ->> 'isPosted')::boolean, false); END IF;
    IF new_j IS NOT NULL THEN new_posted := coalesce((new_j ->> 'isPosted')::boolean, false); END IF;
  ELSIF TG_TABLE_NAME = 'JournalVoucherLine' THEN
    IF old_j IS NOT NULL THEN SELECT coalesce(v."isPosted", false) INTO old_posted FROM public."JournalVoucher" v WHERE v.id = (old_j ->> 'journalVoucherId')::integer; old_posted := coalesce(old_posted, false); END IF;
    IF new_j IS NOT NULL THEN SELECT coalesce(v."isPosted", false) INTO new_posted FROM public."JournalVoucher" v WHERE v.id = (new_j ->> 'journalVoucherId')::integer; new_posted := coalesce(new_posted, false); new_parent_id := new_j ->> 'journalVoucherId'; END IF;
  ELSIF TG_TABLE_NAME = 'CashBankVoucherLine' THEN
    IF old_j IS NOT NULL THEN SELECT coalesce(v."isPosted", false) INTO old_posted FROM public."CashBankVoucher" v WHERE v.id = (old_j ->> 'cashBankVoucherId')::integer; old_posted := coalesce(old_posted, false); END IF;
    IF new_j IS NOT NULL THEN SELECT coalesce(v."isPosted", false) INTO new_posted FROM public."CashBankVoucher" v WHERE v.id = (new_j ->> 'cashBankVoucherId')::integer; new_posted := coalesce(new_posted, false); new_parent_id := new_j ->> 'cashBankVoucherId'; END IF;
  ELSIF TG_TABLE_NAME IN ('PurchaseBillLine', 'PurchaseBillImportDetail') THEN
    IF old_j IS NOT NULL THEN SELECT coalesce(b."isPosted", false) INTO old_posted FROM public."PurchaseBill" b WHERE b.id = (old_j ->> 'purchaseBillId')::integer; old_posted := coalesce(old_posted, false); END IF;
    IF new_j IS NOT NULL THEN SELECT coalesce(b."isPosted", false) INTO new_posted FROM public."PurchaseBill" b WHERE b.id = (new_j ->> 'purchaseBillId')::integer; new_posted := coalesce(new_posted, false); new_parent_id := new_j ->> 'purchaseBillId'; END IF;
  ELSIF TG_TABLE_NAME = 'PurchaseDocumentTerm' THEN
    IF old_j IS NOT NULL AND old_j ->> 'documentType' = 'PURCHASE_BILL' THEN SELECT coalesce(b."isPosted", false) INTO old_posted FROM public."PurchaseBill" b WHERE b.id = (old_j ->> 'documentId')::integer; END IF;
    IF new_j IS NOT NULL AND new_j ->> 'documentType' = 'PURCHASE_BILL' THEN SELECT coalesce(b."isPosted", false) INTO new_posted FROM public."PurchaseBill" b WHERE b.id = (new_j ->> 'documentId')::integer; new_parent_id := new_j ->> 'documentId'; END IF;
    old_posted := coalesce(old_posted, false); new_posted := coalesce(new_posted, false);
  ELSIF TG_TABLE_NAME = 'PurchaseDocumentTermAllocation' THEN
    IF old_j IS NOT NULL THEN SELECT coalesce(b."isPosted", false) INTO old_posted FROM public."PurchaseDocumentTerm" t JOIN public."PurchaseBill" b ON b.id = t."documentId" WHERE t.id = (old_j ->> 'documentTermId')::integer AND t."documentType" = 'PURCHASE_BILL'; END IF;
    IF new_j IS NOT NULL THEN SELECT coalesce(b."isPosted", false) INTO new_posted FROM public."PurchaseDocumentTerm" t JOIN public."PurchaseBill" b ON b.id = t."documentId" WHERE t.id = (new_j ->> 'documentTermId')::integer AND t."documentType" = 'PURCHASE_BILL'; new_parent_id := new_j ->> 'documentTermId'; END IF;
    old_posted := coalesce(old_posted, false); new_posted := coalesce(new_posted, false);
  ELSIF TG_TABLE_NAME IN ('PurchaseImportAssessmentTerm', 'PurchaseImportAssessmentAllocation', 'PurchaseImportAssessmentLine') THEN
    IF old_j IS NOT NULL THEN SELECT coalesce(a."isPosted", false) INTO old_posted FROM public."PurchaseImportAssessment" a WHERE a.id = (old_j ->> 'assessmentId')::integer; END IF;
    IF new_j IS NOT NULL THEN SELECT coalesce(a."isPosted", false) INTO new_posted FROM public."PurchaseImportAssessment" a WHERE a.id = (new_j ->> 'assessmentId')::integer; new_parent_id := new_j ->> 'assessmentId'; END IF;
    old_posted := coalesce(old_posted, false); new_posted := coalesce(new_posted, false);
  ELSE
    RAISE EXCEPTION 'namo.require_change_reason is not set up for table %', TG_TABLE_NAME USING ERRCODE = 'check_violation';
  END IF;
  IF NOT header_table AND new_j IS NOT NULL THEN
    new_parent_created := coalesce(current_setting('namo.initial_posted_child_table', true), '') = TG_TABLE_NAME
      AND coalesce(current_setting('namo.initial_posted_child_parent_id', true), '') = coalesce(new_parent_id, '');
  END IF;
  IF TG_OP = 'INSERT' THEN need_reason := NOT header_table AND new_posted AND NOT new_parent_created;
  ELSIF TG_OP = 'DELETE' THEN need_reason := old_posted;
  ELSIF header_table THEN need_reason := old_posted;
  ELSE need_reason := old_posted OR new_posted; END IF;
  IF need_reason AND why IS NULL THEN
    RAISE EXCEPTION 'A posted document cannot be % without a reason (% #%). Enter why it is being changed, then save again.',
      CASE TG_OP WHEN 'DELETE' THEN 'deleted' WHEN 'INSERT' THEN 'added to' ELSE 'changed' END, TG_TABLE_NAME,
      CASE WHEN TG_OP = 'INSERT' THEN new_j ->> 'id' ELSE old_j ->> 'id' END USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$fn$;
--> statement-breakpoint

-- A document's date controls the company-period lock for its header, terms and allocation snapshots.
CREATE OR REPLACE FUNCTION "namo"."document_date"(p_tbl text, p_row jsonb) RETURNS date LANGUAGE plpgsql AS $fn$
DECLARE d date;
BEGIN
  IF p_row IS NULL THEN RETURN NULL; END IF;
  IF p_tbl IN ('JournalVoucher', 'CashBankVoucher') THEN RETURN (p_row ->> 'voucherDate')::date;
  ELSIF p_tbl = 'PurchaseBill' THEN RETURN (p_row ->> 'invoiceDate')::date;
  ELSIF p_tbl = 'JournalVoucherLine' THEN SELECT v."voucherDate" INTO d FROM public."JournalVoucher" v WHERE v.id = (p_row ->> 'journalVoucherId')::integer;
  ELSIF p_tbl = 'CashBankVoucherLine' THEN SELECT v."voucherDate" INTO d FROM public."CashBankVoucher" v WHERE v.id = (p_row ->> 'cashBankVoucherId')::integer;
  ELSIF p_tbl IN ('PurchaseBillLine', 'PurchaseBillImportDetail') THEN SELECT b."invoiceDate" INTO d FROM public."PurchaseBill" b WHERE b.id = (p_row ->> 'purchaseBillId')::integer;
  ELSIF p_tbl = 'PurchaseDocumentTerm' THEN
    IF p_row ->> 'documentType' = 'PURCHASE_BILL' THEN SELECT b."invoiceDate" INTO d FROM public."PurchaseBill" b WHERE b.id = (p_row ->> 'documentId')::integer; END IF;
  ELSIF p_tbl = 'PurchaseDocumentTermAllocation' THEN
    SELECT b."invoiceDate" INTO d FROM public."PurchaseDocumentTerm" t JOIN public."PurchaseBill" b ON b.id = t."documentId"
      WHERE t.id = (p_row ->> 'documentTermId')::integer AND t."documentType" = 'PURCHASE_BILL';
  ELSIF p_tbl = 'PurchaseImportAssessment' THEN RETURN (p_row ->> 'assessmentDate')::date;
  ELSIF p_tbl IN ('PurchaseImportAssessmentTerm', 'PurchaseImportAssessmentAllocation', 'PurchaseImportAssessmentLine') THEN
    SELECT a."assessmentDate" INTO d FROM public."PurchaseImportAssessment" a WHERE a.id = (p_row ->> 'assessmentId')::integer;
  ELSE RAISE EXCEPTION 'namo.document_date is not set up for table %', p_tbl;
  END IF;
  RETURN d;
END
$fn$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "namo"."locked_by"(p_tbl text, p_old jsonb, p_new jsonb) RETURNS date LANGUAGE plpgsql AS $fn$
DECLARE co integer; ld date; d_old date; d_new date;
BEGIN
  IF p_tbl <> ALL (ARRAY['CashBankVoucher', 'CashBankVoucherLine', 'JournalVoucher', 'JournalVoucherLine', 'PurchaseBill', 'PurchaseBillImportDetail', 'PurchaseBillLine', 'PurchaseDocumentTerm', 'PurchaseDocumentTermAllocation', 'PurchaseImportAssessment', 'PurchaseImportAssessmentTerm', 'PurchaseImportAssessmentAllocation', 'PurchaseImportAssessmentLine']) THEN RETURN NULL; END IF;
  IF p_old IS NOT NULL AND p_new IS NOT NULL AND p_old = p_new THEN RETURN NULL; END IF;
  IF p_tbl = 'PurchaseBillLine' AND p_old IS NOT NULL AND p_new IS NOT NULL AND (p_new - ARRAY['allocatedTermAmount', 'landedAmount', 'landedRate']) = (p_old - ARRAY['allocatedTermAmount', 'landedAmount', 'landedRate']) THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM public."CompanyLock" WHERE "lockDate" IS NOT NULL) THEN RETURN NULL; END IF;
  co := "namo"."company_of"(p_tbl, coalesce(p_new, p_old));
  IF co IS NULL THEN RETURN NULL; END IF;
  SELECT l."lockDate" INTO ld FROM public."CompanyLock" l WHERE l."companyId" = co;
  IF ld IS NULL THEN RETURN NULL; END IF;
  d_old := "namo"."document_date"(p_tbl, p_old); d_new := "namo"."document_date"(p_tbl, p_new);
  IF (d_old IS NOT NULL AND d_old <= ld) OR (d_new IS NOT NULL AND d_new <= ld) THEN RETURN ld; END IF;
  RETURN NULL;
END
$fn$;
--> statement-breakpoint

-- Register each new table with the existing audit, reason and lock trigger families.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['PurchaseImportAssessment','PurchaseImportAssessmentTerm','PurchaseImportAssessmentAllocation','PurchaseImportAssessmentLine'] LOOP
    EXECUTE format('CREATE TRIGGER "Audit_trail" AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION "namo"."audit_row"()', t);
    EXECUTE format('CREATE TRIGGER "Audit_reason" BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION "namo"."require_change_reason"()', t);
    EXECUTE format('CREATE TRIGGER "Audit_lock" BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION "namo"."enforce_lock_date"()', t);
  END LOOP;
END $$;
