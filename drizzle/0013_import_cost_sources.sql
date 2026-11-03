ALTER TABLE "PurchaseBill" ADD COLUMN "importCostForBillId" integer;--> statement-breakpoint
ALTER TABLE "PurchaseBill" ADD COLUMN "importCostAllocationBasis" "BillingAllocationBasis" DEFAULT 'VALUE' NOT NULL;--> statement-breakpoint
ALTER TABLE "PurchaseBill" ADD CONSTRAINT "PurchaseBill_importCostForBillId_PurchaseBill_id_fk" FOREIGN KEY ("importCostForBillId") REFERENCES "public"."PurchaseBill"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "PurchaseBill_importCostForBillId_idx" ON "PurchaseBill" USING btree ("importCostForBillId");--> statement-breakpoint
ALTER TABLE "PurchaseBill" ADD CONSTRAINT "PurchaseBill_import_cost_source_check" CHECK ("PurchaseBill"."importCostForBillId" IS NULL OR ("PurchaseBill"."mainBillId" IS NULL AND "PurchaseBill"."importCostForBillId" <> "PurchaseBill"."id" AND "PurchaseBill"."purchaseType" IN ('SERVICE_PURCHASE_OTHERS', 'SERVICE_PURCHASE_CAPITAL')));--> statement-breakpoint

-- The link is company-scoped even though it is a self-FK on PurchaseBill.
INSERT INTO "namo"."company_link" (tbl, col, link_tbl) VALUES ('PurchaseBill', 'importCostForBillId', 'PurchaseBill');--> statement-breakpoint

-- A service-cost source must point at an already-posted, active import goods bill. This prevents local-service
-- invoices, additional bills, and bills from a different business workflow from becoming import CIF sources.
CREATE FUNCTION "namo"."check_import_cost_source"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target record;
BEGIN
  IF NEW."importCostForBillId" IS NULL THEN RETURN NEW; END IF;
  IF NEW."mainBillId" IS NOT NULL OR NEW."purchaseType" NOT IN ('SERVICE_PURCHASE_OTHERS', 'SERVICE_PURCHASE_CAPITAL') THEN
    RAISE EXCEPTION 'Only a normal service purchase bill can be linked as an import-cost source.'
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT "companyId", "branchId", "invoiceType", "purchaseType", "mainBillId", "reversalOfId", "isPosted"
    INTO target FROM public."PurchaseBill" WHERE id = NEW."importCostForBillId" FOR UPDATE;
  IF NOT FOUND
     OR target."companyId" <> NEW."companyId"
     OR target."branchId" <> NEW."branchId"
     OR target."invoiceType" <> 'IMPORT'
     OR target."purchaseType" NOT IN ('GOODS_PURCHASE_OTHERS', 'GOODS_PURCHASE_CAPITAL')
     OR target."mainBillId" IS NOT NULL
     OR target."reversalOfId" IS NOT NULL
     OR NOT target."isPosted" THEN
    RAISE EXCEPTION 'Import-cost source must point to an active, posted import goods bill in the same company and branch.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER namo_import_cost_source BEFORE INSERT OR UPDATE OF "importCostForBillId", "mainBillId", "purchaseType", "companyId", "isPosted"
  ON public."PurchaseBill" FOR EACH ROW EXECUTE FUNCTION "namo"."check_import_cost_source"();
