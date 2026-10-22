CREATE TYPE "public"."ImportTransportMode" AS ENUM('ROAD', 'AIR', 'RAIL', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."PurchaseType" AS ENUM('GOODS_PURCHASE_OTHERS', 'GOODS_PURCHASE_CAPITAL', 'SERVICE_PURCHASE_OTHERS', 'SERVICE_PURCHASE_CAPITAL');--> statement-breakpoint
ALTER TABLE "PurchaseBill" ADD COLUMN "purchaseType" "PurchaseType" DEFAULT 'GOODS_PURCHASE_OTHERS' NOT NULL;--> statement-breakpoint
ALTER TABLE "PurchaseBill" ADD COLUMN "journalVoucherId" integer;--> statement-breakpoint
ALTER TABLE "PurchaseBillImportDetail" ADD COLUMN "customsOffice" varchar(100);--> statement-breakpoint
ALTER TABLE "PurchaseBillImportDetail" ADD COLUMN "countryOfOrigin" varchar(50);--> statement-breakpoint
ALTER TABLE "PurchaseBillImportDetail" ADD COLUMN "assessableValue" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "PurchaseBillImportDetail" ADD COLUMN "customsDuty" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "PurchaseBillImportDetail" ADD COLUMN "exciseDuty" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "PurchaseBillImportDetail" ADD COLUMN "importVat" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "PurchaseBillImportDetail" ADD COLUMN "otherCustomsCharges" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "PurchaseBillImportDetail" ADD COLUMN "lcDate" date;--> statement-breakpoint
ALTER TABLE "PurchaseBillImportDetail" ADD COLUMN "lcBankName" varchar(100);--> statement-breakpoint
ALTER TABLE "PurchaseBillImportDetail" ADD COLUMN "transportMode" "ImportTransportMode";--> statement-breakpoint
ALTER TABLE "PurchaseBillImportDetail" ADD COLUMN "blAwbNo" varchar(30);--> statement-breakpoint
ALTER TABLE "PurchaseBillImportDetail" ADD COLUMN "blAwbDate" date;--> statement-breakpoint
ALTER TABLE "PurchaseBillLine" ADD COLUMN "allocatedTermAmount" numeric(18, 6) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "PurchaseBillLine" ADD COLUMN "landedAmount" numeric(18, 6) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "PurchaseBillLine" ADD COLUMN "landedRate" numeric(18, 6) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "PurchaseBillLine" ADD COLUMN "locationId" integer;--> statement-breakpoint
ALTER TABLE "PurchaseBillLine" ADD COLUMN "batchNo" varchar(50);--> statement-breakpoint
ALTER TABLE "PurchaseBillLine" ADD COLUMN "manufactureDate" date;--> statement-breakpoint
ALTER TABLE "PurchaseBillLine" ADD COLUMN "expiryDate" date;--> statement-breakpoint
ALTER TABLE "PurchaseBill" ADD CONSTRAINT "PurchaseBill_journalVoucherId_JournalVoucher_id_fk" FOREIGN KEY ("journalVoucherId") REFERENCES "public"."JournalVoucher"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseBillLine" ADD CONSTRAINT "PurchaseBillLine_locationId_Location_id_fk" FOREIGN KEY ("locationId") REFERENCES "public"."Location"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "PurchaseBill_purchaseType_idx" ON "PurchaseBill" USING btree ("purchaseType");--> statement-breakpoint
CREATE UNIQUE INDEX "PurchaseBill_journalVoucherId_key" ON "PurchaseBill" USING btree ("journalVoucherId") WHERE "PurchaseBill"."journalVoucherId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "PurchaseBillImportDetail_customsDeclarationNo_idx" ON "PurchaseBillImportDetail" USING btree ("customsDeclarationNo");--> statement-breakpoint
CREATE INDEX "PurchaseBillLine_locationId_idx" ON "PurchaseBillLine" USING btree ("locationId");--> statement-breakpoint
CREATE INDEX "PurchaseBillLine_batchNo_idx" ON "PurchaseBillLine" USING btree ("productId","batchNo");--> statement-breakpoint
ALTER TABLE "PurchaseBill" ADD CONSTRAINT "PurchaseBill_posted_voucher_check" CHECK (NOT "PurchaseBill"."isPosted" OR "PurchaseBill"."journalVoucherId" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "PurchaseBillImportDetail" ADD CONSTRAINT "PurchaseBillImportDetail_amounts_check" CHECK (coalesce("PurchaseBillImportDetail"."assessableValue", 0) >= 0 AND coalesce("PurchaseBillImportDetail"."customsDuty", 0) >= 0 AND coalesce("PurchaseBillImportDetail"."exciseDuty", 0) >= 0 AND coalesce("PurchaseBillImportDetail"."importVat", 0) >= 0 AND coalesce("PurchaseBillImportDetail"."otherCustomsCharges", 0) >= 0);--> statement-breakpoint
ALTER TABLE "PurchaseBillLine" ADD CONSTRAINT "PurchaseBillLine_landed_check" CHECK ("PurchaseBillLine"."landedAmount" >= 0 AND "PurchaseBillLine"."landedRate" >= 0);--> statement-breakpoint
ALTER TABLE "PurchaseBillLine" ADD CONSTRAINT "PurchaseBillLine_expiry_check" CHECK ("PurchaseBillLine"."manufactureDate" IS NULL OR "PurchaseBillLine"."expiryDate" IS NULL OR "PurchaseBillLine"."expiryDate" >= "PurchaseBillLine"."manufactureDate");--> statement-breakpoint

-- Company consistency: register the two new links and rebuild the two triggers whose column lists changed.
INSERT INTO "namo"."company_link" (tbl, col, link_tbl) VALUES
  ('PurchaseBill', 'journalVoucherId', 'JournalVoucher'),
  ('PurchaseBillLine', 'locationId', 'Location');
--> statement-breakpoint
DROP TRIGGER namo_company_consistency ON public."PurchaseBill";
--> statement-breakpoint
CREATE TRIGGER namo_company_consistency BEFORE INSERT OR UPDATE OF "companyId", "branchId", "vendorGLId", "subLedgerId", "agentId", "mainBillId", "reversalOfId", "journalVoucherId" ON public."PurchaseBill" FOR EACH ROW EXECUTE FUNCTION "namo"."enforce_company"();
--> statement-breakpoint
DROP TRIGGER namo_company_consistency ON public."PurchaseBillLine";
--> statement-breakpoint
CREATE TRIGGER namo_company_consistency BEFORE INSERT OR UPDATE OF "purchaseBillId", "productId", "altUnitId", "unitId", "locationId" ON public."PurchaseBillLine" FOR EACH ROW EXECUTE FUNCTION "namo"."enforce_company"();
--> statement-breakpoint

-- Import switch: import/customs details exist only for bills whose invoiceType is IMPORT.
CREATE FUNCTION "namo"."check_import_detail_bill"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t "PurchaseInvoiceType";
BEGIN
  SELECT "invoiceType" INTO t FROM public."PurchaseBill" WHERE id = NEW."purchaseBillId";
  IF t IS NOT NULL AND t <> 'IMPORT' THEN
    RAISE EXCEPTION 'Import details are only allowed on an IMPORT purchase bill (bill % is %).', NEW."purchaseBillId", t
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER namo_import_detail_only_import BEFORE INSERT OR UPDATE OF "purchaseBillId" ON public."PurchaseBillImportDetail" FOR EACH ROW EXECUTE FUNCTION "namo"."check_import_detail_bill"();
--> statement-breakpoint
CREATE FUNCTION "namo"."check_bill_type_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."invoiceType" <> 'IMPORT' AND EXISTS (SELECT 1 FROM public."PurchaseBillImportDetail" WHERE "purchaseBillId" = NEW.id) THEN
    RAISE EXCEPTION 'Purchase bill % has import details; remove them before changing the invoice type to %.', NEW.id, NEW."invoiceType"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER namo_bill_type_change BEFORE UPDATE OF "invoiceType" ON public."PurchaseBill" FOR EACH ROW EXECUTE FUNCTION "namo"."check_bill_type_change"();
