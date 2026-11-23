CREATE TYPE "public"."StockSourceType" AS ENUM('PURCHASE_CHALLAN', 'PURCHASE_BILL', 'SALES_CHALLAN', 'SALES_INVOICE');--> statement-breakpoint
CREATE TABLE "StockMovement" (
  "id" serial PRIMARY KEY NOT NULL,
  "companyId" integer NOT NULL REFERENCES "Company"("id") ON DELETE restrict,
  "branchId" integer NOT NULL REFERENCES "Branch"("id") ON DELETE restrict,
  "productId" integer NOT NULL REFERENCES "Product"("id") ON DELETE restrict,
  "locationId" integer REFERENCES "Location"("id") ON DELETE restrict,
  "batchNo" varchar(50),
  "expiryDate" date,
  "movementDate" date NOT NULL,
  "qty" numeric(18,6) NOT NULL,
  "sourceType" "StockSourceType" NOT NULL,
  "sourceId" integer NOT NULL,
  "sourceLineId" integer NOT NULL,
  "createdAt" timestamp(3) DEFAULT now() NOT NULL,
  CONSTRAINT "StockMovement_qty_check" CHECK ("qty" <> 0)
);--> statement-breakpoint
CREATE INDEX "StockMovement_company_branch_product_idx" ON "StockMovement" USING btree ("companyId","branchId","productId");--> statement-breakpoint
CREATE INDEX "StockMovement_source_idx" ON "StockMovement" USING btree ("sourceType","sourceId");--> statement-breakpoint
CREATE INDEX "StockMovement_locationId_idx" ON "StockMovement" USING btree ("locationId");--> statement-breakpoint
-- company consistency: the product, location and branch must belong to the movement's company
INSERT INTO "namo"."company_source" (tbl, ord, via_col, via_tbl) VALUES ('StockMovement', 1, NULL, NULL);--> statement-breakpoint
INSERT INTO "namo"."company_link" (tbl, col, link_tbl) VALUES
  ('StockMovement', 'branchId', 'Branch'),
  ('StockMovement', 'productId', 'Product'),
  ('StockMovement', 'locationId', 'Location');--> statement-breakpoint
CREATE TRIGGER namo_company_consistency BEFORE INSERT OR UPDATE OF "companyId", "branchId", "productId", "locationId" ON public."StockMovement" FOR EACH ROW EXECUTE FUNCTION "namo"."enforce_company"();--> statement-breakpoint
-- append-only: a wrong movement is corrected by an opposite one, never edited
CREATE OR REPLACE FUNCTION "namo"."stock_movement_append_only"() RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN
  RAISE EXCEPTION 'Stock movements cannot be edited or deleted; add an opposite movement instead.' USING ERRCODE = 'check_violation';
END $f$;--> statement-breakpoint
CREATE TRIGGER stock_movement_append_only BEFORE UPDATE ON public."StockMovement" FOR EACH ROW EXECUTE FUNCTION "namo"."stock_movement_append_only"();--> statement-breakpoint
-- goods already received: confirmed challans, and posted bills' lines that no challan received (stock products only)
INSERT INTO "StockMovement" ("companyId","branchId","productId","locationId","batchNo","expiryDate","movementDate","qty","sourceType","sourceId","sourceLineId")
SELECT c."companyId", c."branchId", l."productId", l."locationId", l."batchNo", l."expiryDate", c."challanDate", l."qty", 'PURCHASE_CHALLAN', c.id, l.id
  FROM "PurchaseChallanLine" l JOIN "PurchaseChallan" c ON c.id = l."purchaseChallanId" JOIN "Product" p ON p.id = l."productId"
 WHERE c."isConfirmed" AND p."type" = 'STOCK' AND l."qty" <> 0;--> statement-breakpoint
INSERT INTO "StockMovement" ("companyId","branchId","productId","locationId","batchNo","expiryDate","movementDate","qty","sourceType","sourceId","sourceLineId")
SELECT b."companyId", b."branchId", l."productId", l."locationId", l."batchNo", l."expiryDate", b."invoiceDate", l."qty", 'PURCHASE_BILL', b.id, l.id
  FROM "PurchaseBillLine" l JOIN "PurchaseBill" b ON b.id = l."purchaseBillId" JOIN "Product" p ON p.id = l."productId"
 WHERE b."isPosted" AND b."reversalOfId" IS NULL AND l."challanLineId" IS NULL AND p."type" = 'STOCK' AND l."qty" <> 0;--> statement-breakpoint
-- a reversal bill copies its original's lines (without the challan link); the original's IN is cancelled by an OUT on the reversal's line
INSERT INTO "StockMovement" ("companyId","branchId","productId","locationId","batchNo","expiryDate","movementDate","qty","sourceType","sourceId","sourceLineId")
SELECT rb."companyId", rb."branchId", rl."productId", rl."locationId", rl."batchNo", rl."expiryDate", rb."invoiceDate", -rl."qty", 'PURCHASE_BILL', rb.id, rl.id
  FROM "PurchaseBill" rb
  JOIN "PurchaseBillLine" rl ON rl."purchaseBillId" = rb.id
  JOIN "PurchaseBillLine" ol ON ol."purchaseBillId" = rb."reversalOfId" AND ol."lineNumber" = rl."lineNumber"
 WHERE rb."isPosted" AND rb."reversalOfId" IS NOT NULL AND ol."challanLineId" IS NULL AND rl."qty" <> 0
   AND EXISTS (SELECT 1 FROM "StockMovement" m WHERE m."sourceType" = 'PURCHASE_BILL' AND m."sourceLineId" = ol.id);
