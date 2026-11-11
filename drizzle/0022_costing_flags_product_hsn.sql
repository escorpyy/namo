ALTER TYPE "public"."BillingTermCategory" RENAME VALUE 'ADDITIONAL' TO 'COSTING';--> statement-breakpoint
CREATE OR REPLACE FUNCTION namo.check_purchase_bill_term()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE b record; o record; ln record; cat "BillingTermCategory";
BEGIN
  IF NEW."documentType" = 'PURCHASE_ORDER' THEN
    SELECT id, "companyId" INTO o FROM public."PurchaseOrder" WHERE id = NEW."documentId";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Purchase document term points at purchase order % which does not exist.', NEW."documentId"
        USING ERRCODE = 'check_violation';
    END IF;
    IF o."companyId" <> NEW."companyId" THEN
      RAISE EXCEPTION 'Company mismatch: this term is company % but purchase order % is company %.', NEW."companyId", o.id, o."companyId"
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."documentLineId" IS NOT NULL THEN
      SELECT "purchaseOrderId" INTO ln FROM public."PurchaseOrderLine" WHERE id = NEW."documentLineId";
      IF NOT FOUND OR ln."purchaseOrderId" <> o.id THEN
        RAISE EXCEPTION 'Line % is not a line of purchase order %.', NEW."documentLineId", o.id
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    SELECT category INTO cat FROM public."PurchaseTerm" WHERE id = NEW."termId";
    IF cat = 'COSTING' THEN
      RAISE EXCEPTION 'A COSTING purchase term is an actual charge and can only be entered on an additional purchase bill, not on purchase order %.', o.id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."documentType" <> 'PURCHASE_BILL' THEN RETURN NEW; END IF;
  SELECT id, "companyId", "mainBillId" INTO b FROM public."PurchaseBill" WHERE id = NEW."documentId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase document term points at purchase bill % which does not exist.', NEW."documentId"
      USING ERRCODE = 'check_violation';
  END IF;
  IF b."companyId" <> NEW."companyId" THEN
    RAISE EXCEPTION 'Company mismatch: this term is company % but purchase bill % is company %.', NEW."companyId", b.id, b."companyId"
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."documentLineId" IS NOT NULL THEN
    SELECT "purchaseBillId" INTO ln FROM public."PurchaseBillLine" WHERE id = NEW."documentLineId";
    IF NOT FOUND OR ln."purchaseBillId" <> b.id THEN
      RAISE EXCEPTION 'Line % is not a line of purchase bill %.', NEW."documentLineId", b.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  SELECT category INTO cat FROM public."PurchaseTerm" WHERE id = NEW."termId";
  IF cat = 'COSTING' AND b."mainBillId" IS NULL THEN
    RAISE EXCEPTION 'A COSTING purchase term can only be entered on an additional purchase bill (bill % is a main bill).', b.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $function$;
--> statement-breakpoint
ALTER TABLE "PurchaseTerm" ADD COLUMN "isEditable" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "SalesTerm" ADD COLUMN "isEditable" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
-- Tax Rate master removed: VAT/exempt is decided by the bill terms. HSN/SAC moves to the product as one optional code.
ALTER TABLE "Product" ADD COLUMN "hsnSacCode" varchar(20);--> statement-breakpoint

-- Keep the codes people already entered: each product takes the HSN/SAC of the tax rate it pointed to.
UPDATE "Product" p SET "hsnSacCode" = t."hsnSacCode"
  FROM "StockDetail" d JOIN "TaxRate" t ON t.id = d."taxRateId"
 WHERE d."productId" = p.id AND t."hsnSacCode" IS NOT NULL;--> statement-breakpoint
UPDATE "Product" p SET "hsnSacCode" = t."hsnSacCode"
  FROM "NonStockDetail" d JOIN "TaxRate" t ON t.id = d."taxRateId"
 WHERE d."productId" = p.id AND t."hsnSacCode" IS NOT NULL;--> statement-breakpoint
UPDATE "Product" p SET "hsnSacCode" = t."hsnSacCode"
  FROM "ServiceDetail" d JOIN "TaxRate" t ON t.id = d."taxRateId"
 WHERE d."productId" = p.id AND t."hsnSacCode" IS NOT NULL;--> statement-breakpoint

-- Company-consistency registry: forget TaxRate and the links to it, and rebuild the detail-table triggers without the column.
DROP TRIGGER namo_company_consistency ON "StockDetail";--> statement-breakpoint
DROP TRIGGER namo_company_consistency ON "NonStockDetail";--> statement-breakpoint
DROP TRIGGER namo_company_consistency ON "ServiceDetail";--> statement-breakpoint
DELETE FROM "namo"."company_link" WHERE link_tbl = 'TaxRate' OR tbl = 'TaxRate';--> statement-breakpoint
DELETE FROM "namo"."company_source" WHERE tbl = 'TaxRate';--> statement-breakpoint

ALTER TABLE "NonStockDetail" DROP CONSTRAINT "NonStockDetail_taxRateId_TaxRate_id_fk";--> statement-breakpoint
ALTER TABLE "ServiceDetail" DROP CONSTRAINT "ServiceDetail_taxRateId_TaxRate_id_fk";--> statement-breakpoint
ALTER TABLE "StockDetail" DROP CONSTRAINT "StockDetail_taxRateId_TaxRate_id_fk";--> statement-breakpoint
DROP INDEX "NonStockDetail_taxRateId_idx";--> statement-breakpoint
DROP INDEX "ServiceDetail_taxRateId_idx";--> statement-breakpoint
DROP INDEX "StockDetail_taxRateId_idx";--> statement-breakpoint
ALTER TABLE "NonStockDetail" DROP COLUMN "taxRateId";--> statement-breakpoint
ALTER TABLE "ServiceDetail" DROP COLUMN "taxRateId";--> statement-breakpoint
ALTER TABLE "StockDetail" DROP COLUMN "taxRateId";--> statement-breakpoint
ALTER TABLE "TaxRate" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "TaxRate" CASCADE;--> statement-breakpoint

DO $$
DECLARE r text; cols text;
BEGIN
  FOREACH r IN ARRAY ARRAY['StockDetail','NonStockDetail','ServiceDetail'] LOOP
    SELECT string_agg(DISTINCT quote_ident(c), ', ') INTO cols FROM (
      SELECT via_col AS c FROM "namo"."company_source" WHERE tbl = r AND via_col IS NOT NULL
      UNION SELECT col FROM "namo"."company_link" WHERE tbl = r
    ) q;
    EXECUTE format('CREATE TRIGGER namo_company_consistency BEFORE INSERT OR UPDATE OF %s ON public.%I FOR EACH ROW EXECUTE FUNCTION "namo"."enforce_company"()', cols, r);
  END LOOP;
END $$;
