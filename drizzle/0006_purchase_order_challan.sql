CREATE TYPE "public"."PurchaseOrderStatus" AS ENUM('DRAFT', 'APPROVED', 'CLOSED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "PurchaseOrder" (
	"id" serial PRIMARY KEY NOT NULL,
	"companyId" integer NOT NULL,
	"branchId" integer NOT NULL,
	"orderNumber" varchar(30) NOT NULL,
	"orderDate" date NOT NULL,
	"fiscalYear" varchar(15) NOT NULL,
	"vendorGLId" integer NOT NULL,
	"subLedgerId" integer,
	"agentId" integer,
	"vendorRefNo" varchar(30),
	"vendorRefDate" date,
	"expectedDate" date,
	"basicAmount" numeric(18, 6) DEFAULT '0' NOT NULL,
	"termAmount" numeric(18, 6) DEFAULT '0' NOT NULL,
	"totalAmount" numeric(18, 6) DEFAULT '0' NOT NULL,
	"remarks" varchar(1024),
	"status" "PurchaseOrderStatus" DEFAULT 'DRAFT' NOT NULL,
	"approvedAt" timestamp (3),
	"approvedBy" integer,
	"closedAt" timestamp (3),
	"closedBy" integer,
	"createdBy" integer,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	CONSTRAINT "PurchaseOrder_approved_check" CHECK ("PurchaseOrder"."status" = 'DRAFT' OR "PurchaseOrder"."status" = 'CANCELLED' OR "PurchaseOrder"."approvedAt" IS NOT NULL),
	CONSTRAINT "PurchaseOrder_closed_check" CHECK ("PurchaseOrder"."status" <> 'CLOSED' OR "PurchaseOrder"."closedAt" IS NOT NULL),
	CONSTRAINT "PurchaseOrder_expected_check" CHECK ("PurchaseOrder"."expectedDate" IS NULL OR "PurchaseOrder"."expectedDate" >= "PurchaseOrder"."orderDate")
);
--> statement-breakpoint
CREATE TABLE "PurchaseOrderLine" (
	"id" serial PRIMARY KEY NOT NULL,
	"purchaseOrderId" integer NOT NULL,
	"lineNumber" integer NOT NULL,
	"productId" integer NOT NULL,
	"particular" varchar(256),
	"altQty" numeric(18, 6),
	"altUnitId" integer,
	"qty" numeric(18, 6) NOT NULL,
	"unitId" integer NOT NULL,
	"rate" numeric(18, 6) DEFAULT '0' NOT NULL,
	"basicAmount" numeric(18, 6) DEFAULT '0' NOT NULL,
	"expectedDate" date,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "PurchaseOrderLine_lineNumber_check" CHECK ("PurchaseOrderLine"."lineNumber" > 0),
	CONSTRAINT "PurchaseOrderLine_amounts_check" CHECK ("PurchaseOrderLine"."qty" > 0 AND "PurchaseOrderLine"."rate" >= 0 AND "PurchaseOrderLine"."basicAmount" >= 0),
	CONSTRAINT "PurchaseOrderLine_alt_pair_check" CHECK (("PurchaseOrderLine"."altQty" IS NULL) = ("PurchaseOrderLine"."altUnitId" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "PurchaseChallan" (
	"id" serial PRIMARY KEY NOT NULL,
	"companyId" integer NOT NULL,
	"branchId" integer NOT NULL,
	"challanNumber" varchar(30) NOT NULL,
	"challanDate" date NOT NULL,
	"fiscalYear" varchar(15) NOT NULL,
	"vendorGLId" integer NOT NULL,
	"subLedgerId" integer,
	"agentId" integer,
	"purchaseOrderId" integer,
	"vendorChallanNo" varchar(30),
	"vendorChallanDate" date,
	"transporterName" varchar(100),
	"vehicleNo" varchar(30),
	"lrNo" varchar(30),
	"lrDate" date,
	"remarks" varchar(1024),
	"isConfirmed" boolean DEFAULT false NOT NULL,
	"confirmedAt" timestamp (3),
	"confirmedBy" integer,
	"createdBy" integer,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	CONSTRAINT "PurchaseChallan_confirmed_check" CHECK (NOT "PurchaseChallan"."isConfirmed" OR "PurchaseChallan"."confirmedAt" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "PurchaseChallanLine" (
	"id" serial PRIMARY KEY NOT NULL,
	"purchaseChallanId" integer NOT NULL,
	"lineNumber" integer NOT NULL,
	"productId" integer NOT NULL,
	"particular" varchar(256),
	"purchaseOrderLineId" integer,
	"altQty" numeric(18, 6),
	"altUnitId" integer,
	"qty" numeric(18, 6) NOT NULL,
	"unitId" integer NOT NULL,
	"rate" numeric(18, 6) DEFAULT '0' NOT NULL,
	"basicAmount" numeric(18, 6) DEFAULT '0' NOT NULL,
	"locationId" integer,
	"batchNo" varchar(50),
	"manufactureDate" date,
	"expiryDate" date,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "PurchaseChallanLine_lineNumber_check" CHECK ("PurchaseChallanLine"."lineNumber" > 0),
	CONSTRAINT "PurchaseChallanLine_amounts_check" CHECK ("PurchaseChallanLine"."qty" > 0 AND "PurchaseChallanLine"."rate" >= 0 AND "PurchaseChallanLine"."basicAmount" >= 0),
	CONSTRAINT "PurchaseChallanLine_expiry_check" CHECK ("PurchaseChallanLine"."manufactureDate" IS NULL OR "PurchaseChallanLine"."expiryDate" IS NULL OR "PurchaseChallanLine"."expiryDate" >= "PurchaseChallanLine"."manufactureDate"),
	CONSTRAINT "PurchaseChallanLine_alt_pair_check" CHECK (("PurchaseChallanLine"."altQty" IS NULL) = ("PurchaseChallanLine"."altUnitId" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "PurchaseBill" ADD COLUMN "purchaseChallanId" integer;--> statement-breakpoint
ALTER TABLE "PurchaseBill" ADD COLUMN "purchaseOrderId" integer;--> statement-breakpoint
ALTER TABLE "PurchaseBillLine" ADD COLUMN "challanLineId" integer;--> statement-breakpoint
ALTER TABLE "PurchaseBillLine" ADD COLUMN "purchaseOrderLineId" integer;--> statement-breakpoint
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_companyId_Company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_branchId_Branch_id_fk" FOREIGN KEY ("branchId") REFERENCES "public"."Branch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_vendorGLId_GeneralLedger_id_fk" FOREIGN KEY ("vendorGLId") REFERENCES "public"."GeneralLedger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_subLedgerId_SubLedger_id_fk" FOREIGN KEY ("subLedgerId") REFERENCES "public"."SubLedger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_agentId_Agent_id_fk" FOREIGN KEY ("agentId") REFERENCES "public"."Agent"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_approvedBy_User_id_fk" FOREIGN KEY ("approvedBy") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_closedBy_User_id_fk" FOREIGN KEY ("closedBy") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_createdBy_User_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_purchaseOrderId_PurchaseOrder_id_fk" FOREIGN KEY ("purchaseOrderId") REFERENCES "public"."PurchaseOrder"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_productId_Product_id_fk" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_altUnitId_ProductUnit_id_fk" FOREIGN KEY ("altUnitId") REFERENCES "public"."ProductUnit"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_unitId_ProductUnit_id_fk" FOREIGN KEY ("unitId") REFERENCES "public"."ProductUnit"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseChallan" ADD CONSTRAINT "PurchaseChallan_companyId_Company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseChallan" ADD CONSTRAINT "PurchaseChallan_branchId_Branch_id_fk" FOREIGN KEY ("branchId") REFERENCES "public"."Branch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseChallan" ADD CONSTRAINT "PurchaseChallan_vendorGLId_GeneralLedger_id_fk" FOREIGN KEY ("vendorGLId") REFERENCES "public"."GeneralLedger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseChallan" ADD CONSTRAINT "PurchaseChallan_subLedgerId_SubLedger_id_fk" FOREIGN KEY ("subLedgerId") REFERENCES "public"."SubLedger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseChallan" ADD CONSTRAINT "PurchaseChallan_agentId_Agent_id_fk" FOREIGN KEY ("agentId") REFERENCES "public"."Agent"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseChallan" ADD CONSTRAINT "PurchaseChallan_purchaseOrderId_PurchaseOrder_id_fk" FOREIGN KEY ("purchaseOrderId") REFERENCES "public"."PurchaseOrder"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseChallan" ADD CONSTRAINT "PurchaseChallan_confirmedBy_User_id_fk" FOREIGN KEY ("confirmedBy") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseChallan" ADD CONSTRAINT "PurchaseChallan_createdBy_User_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseChallanLine" ADD CONSTRAINT "PurchaseChallanLine_purchaseChallanId_PurchaseChallan_id_fk" FOREIGN KEY ("purchaseChallanId") REFERENCES "public"."PurchaseChallan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseChallanLine" ADD CONSTRAINT "PurchaseChallanLine_productId_Product_id_fk" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseChallanLine" ADD CONSTRAINT "PurchaseChallanLine_purchaseOrderLineId_PurchaseOrderLine_id_fk" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "public"."PurchaseOrderLine"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseChallanLine" ADD CONSTRAINT "PurchaseChallanLine_altUnitId_ProductUnit_id_fk" FOREIGN KEY ("altUnitId") REFERENCES "public"."ProductUnit"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseChallanLine" ADD CONSTRAINT "PurchaseChallanLine_unitId_ProductUnit_id_fk" FOREIGN KEY ("unitId") REFERENCES "public"."ProductUnit"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseChallanLine" ADD CONSTRAINT "PurchaseChallanLine_locationId_Location_id_fk" FOREIGN KEY ("locationId") REFERENCES "public"."Location"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "PurchaseOrder_branchId_fiscalYear_orderNumber_key" ON "PurchaseOrder" USING btree ("branchId","fiscalYear","orderNumber");--> statement-breakpoint
CREATE INDEX "PurchaseOrder_companyId_idx" ON "PurchaseOrder" USING btree ("companyId");--> statement-breakpoint
CREATE INDEX "PurchaseOrder_branchId_idx" ON "PurchaseOrder" USING btree ("branchId");--> statement-breakpoint
CREATE INDEX "PurchaseOrder_vendorGLId_idx" ON "PurchaseOrder" USING btree ("vendorGLId");--> statement-breakpoint
CREATE INDEX "PurchaseOrder_subLedgerId_idx" ON "PurchaseOrder" USING btree ("subLedgerId");--> statement-breakpoint
CREATE INDEX "PurchaseOrder_agentId_idx" ON "PurchaseOrder" USING btree ("agentId");--> statement-breakpoint
CREATE INDEX "PurchaseOrder_status_idx" ON "PurchaseOrder" USING btree ("status");--> statement-breakpoint
CREATE INDEX "PurchaseOrder_fiscalYear_idx" ON "PurchaseOrder" USING btree ("fiscalYear");--> statement-breakpoint
CREATE INDEX "PurchaseOrder_orderDate_idx" ON "PurchaseOrder" USING btree ("orderDate");--> statement-breakpoint
CREATE UNIQUE INDEX "PurchaseOrderLine_purchaseOrderId_lineNumber_key" ON "PurchaseOrderLine" USING btree ("purchaseOrderId","lineNumber");--> statement-breakpoint
CREATE INDEX "PurchaseOrderLine_productId_idx" ON "PurchaseOrderLine" USING btree ("productId");--> statement-breakpoint
CREATE INDEX "PurchaseOrderLine_altUnitId_idx" ON "PurchaseOrderLine" USING btree ("altUnitId");--> statement-breakpoint
CREATE INDEX "PurchaseOrderLine_unitId_idx" ON "PurchaseOrderLine" USING btree ("unitId");--> statement-breakpoint
CREATE UNIQUE INDEX "PurchaseChallan_branchId_fiscalYear_challanNumber_key" ON "PurchaseChallan" USING btree ("branchId","fiscalYear","challanNumber");--> statement-breakpoint
CREATE UNIQUE INDEX "PurchaseChallan_vendor_vendorChallanNo_key" ON "PurchaseChallan" USING btree ("companyId","vendorGLId","vendorChallanNo") WHERE "PurchaseChallan"."vendorChallanNo" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "PurchaseChallan_companyId_idx" ON "PurchaseChallan" USING btree ("companyId");--> statement-breakpoint
CREATE INDEX "PurchaseChallan_branchId_idx" ON "PurchaseChallan" USING btree ("branchId");--> statement-breakpoint
CREATE INDEX "PurchaseChallan_vendorGLId_idx" ON "PurchaseChallan" USING btree ("vendorGLId");--> statement-breakpoint
CREATE INDEX "PurchaseChallan_subLedgerId_idx" ON "PurchaseChallan" USING btree ("subLedgerId");--> statement-breakpoint
CREATE INDEX "PurchaseChallan_agentId_idx" ON "PurchaseChallan" USING btree ("agentId");--> statement-breakpoint
CREATE INDEX "PurchaseChallan_purchaseOrderId_idx" ON "PurchaseChallan" USING btree ("purchaseOrderId");--> statement-breakpoint
CREATE INDEX "PurchaseChallan_fiscalYear_idx" ON "PurchaseChallan" USING btree ("fiscalYear");--> statement-breakpoint
CREATE INDEX "PurchaseChallan_challanDate_idx" ON "PurchaseChallan" USING btree ("challanDate");--> statement-breakpoint
CREATE UNIQUE INDEX "PurchaseChallanLine_purchaseChallanId_lineNumber_key" ON "PurchaseChallanLine" USING btree ("purchaseChallanId","lineNumber");--> statement-breakpoint
CREATE INDEX "PurchaseChallanLine_productId_idx" ON "PurchaseChallanLine" USING btree ("productId");--> statement-breakpoint
CREATE INDEX "PurchaseChallanLine_purchaseOrderLineId_idx" ON "PurchaseChallanLine" USING btree ("purchaseOrderLineId");--> statement-breakpoint
CREATE INDEX "PurchaseChallanLine_altUnitId_idx" ON "PurchaseChallanLine" USING btree ("altUnitId");--> statement-breakpoint
CREATE INDEX "PurchaseChallanLine_unitId_idx" ON "PurchaseChallanLine" USING btree ("unitId");--> statement-breakpoint
CREATE INDEX "PurchaseChallanLine_locationId_idx" ON "PurchaseChallanLine" USING btree ("locationId");--> statement-breakpoint
CREATE INDEX "PurchaseChallanLine_batchNo_idx" ON "PurchaseChallanLine" USING btree ("productId","batchNo");--> statement-breakpoint
ALTER TABLE "PurchaseBill" ADD CONSTRAINT "PurchaseBill_purchaseChallanId_PurchaseChallan_id_fk" FOREIGN KEY ("purchaseChallanId") REFERENCES "public"."PurchaseChallan"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseBill" ADD CONSTRAINT "PurchaseBill_purchaseOrderId_PurchaseOrder_id_fk" FOREIGN KEY ("purchaseOrderId") REFERENCES "public"."PurchaseOrder"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseBillLine" ADD CONSTRAINT "PurchaseBillLine_challanLineId_PurchaseChallanLine_id_fk" FOREIGN KEY ("challanLineId") REFERENCES "public"."PurchaseChallanLine"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseBillLine" ADD CONSTRAINT "PurchaseBillLine_purchaseOrderLineId_PurchaseOrderLine_id_fk" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "public"."PurchaseOrderLine"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "PurchaseBill_purchaseChallanId_idx" ON "PurchaseBill" USING btree ("purchaseChallanId");--> statement-breakpoint
CREATE INDEX "PurchaseBill_purchaseOrderId_idx" ON "PurchaseBill" USING btree ("purchaseOrderId");--> statement-breakpoint
CREATE INDEX "PurchaseBillLine_challanLineId_idx" ON "PurchaseBillLine" USING btree ("challanLineId");--> statement-breakpoint
CREATE INDEX "PurchaseBillLine_purchaseOrderLineId_idx" ON "PurchaseBillLine" USING btree ("purchaseOrderLineId");--> statement-breakpoint
ALTER TABLE "PurchaseBill" DROP COLUMN "challanNo";--> statement-breakpoint
ALTER TABLE "PurchaseBill" DROP COLUMN "orderNo";
--> statement-breakpoint
-- ============================================================
-- PURCHASE ORDER + CHALLAN: hand-written rules (not expressible in the schema code)
-- NOTE: PurchaseBill.challanNo / orderNo (plain text) are replaced by real foreign keys above.
-- ============================================================

-- Company consistency (ERP-015 registry). Headers carry their own companyId; lines get it from their header.
INSERT INTO "namo"."company_source" (tbl, ord, via_col, via_tbl) VALUES
  ('PurchaseOrder', 1, NULL, NULL),
  ('PurchaseOrderLine', 1, 'purchaseOrderId', 'PurchaseOrder'),
  ('PurchaseChallan', 1, NULL, NULL),
  ('PurchaseChallanLine', 1, 'purchaseChallanId', 'PurchaseChallan');
--> statement-breakpoint
INSERT INTO "namo"."company_link" (tbl, col, link_tbl) VALUES
  ('PurchaseOrder', 'branchId', 'Branch'),
  ('PurchaseOrder', 'vendorGLId', 'GeneralLedger'),
  ('PurchaseOrder', 'subLedgerId', 'SubLedger'),
  ('PurchaseOrder', 'agentId', 'Agent'),
  ('PurchaseOrderLine', 'productId', 'Product'),
  ('PurchaseOrderLine', 'altUnitId', 'ProductUnit'),
  ('PurchaseOrderLine', 'unitId', 'ProductUnit'),
  ('PurchaseChallan', 'branchId', 'Branch'),
  ('PurchaseChallan', 'vendorGLId', 'GeneralLedger'),
  ('PurchaseChallan', 'subLedgerId', 'SubLedger'),
  ('PurchaseChallan', 'agentId', 'Agent'),
  ('PurchaseChallan', 'purchaseOrderId', 'PurchaseOrder'),
  ('PurchaseChallanLine', 'productId', 'Product'),
  ('PurchaseChallanLine', 'purchaseOrderLineId', 'PurchaseOrderLine'),
  ('PurchaseChallanLine', 'altUnitId', 'ProductUnit'),
  ('PurchaseChallanLine', 'unitId', 'ProductUnit'),
  ('PurchaseChallanLine', 'locationId', 'Location'),
  ('PurchaseBill', 'purchaseChallanId', 'PurchaseChallan'),
  ('PurchaseBill', 'purchaseOrderId', 'PurchaseOrder'),
  ('PurchaseBillLine', 'challanLineId', 'PurchaseChallanLine'),
  ('PurchaseBillLine', 'purchaseOrderLineId', 'PurchaseOrderLine');
--> statement-breakpoint
CREATE TRIGGER namo_company_consistency BEFORE INSERT OR UPDATE OF "companyId", "branchId", "vendorGLId", "subLedgerId", "agentId" ON public."PurchaseOrder" FOR EACH ROW EXECUTE FUNCTION "namo"."enforce_company"();
--> statement-breakpoint
CREATE TRIGGER namo_company_consistency BEFORE INSERT OR UPDATE OF "purchaseOrderId", "productId", "altUnitId", "unitId" ON public."PurchaseOrderLine" FOR EACH ROW EXECUTE FUNCTION "namo"."enforce_company"();
--> statement-breakpoint
CREATE TRIGGER namo_company_consistency BEFORE INSERT OR UPDATE OF "companyId", "branchId", "vendorGLId", "subLedgerId", "agentId", "purchaseOrderId" ON public."PurchaseChallan" FOR EACH ROW EXECUTE FUNCTION "namo"."enforce_company"();
--> statement-breakpoint
CREATE TRIGGER namo_company_consistency BEFORE INSERT OR UPDATE OF "purchaseChallanId", "productId", "purchaseOrderLineId", "altUnitId", "unitId", "locationId" ON public."PurchaseChallanLine" FOR EACH ROW EXECUTE FUNCTION "namo"."enforce_company"();
--> statement-breakpoint
-- The bill's two tables already have this trigger; rebuild them because their column lists grew.
DROP TRIGGER namo_company_consistency ON public."PurchaseBill";
--> statement-breakpoint
CREATE TRIGGER namo_company_consistency BEFORE INSERT OR UPDATE OF "companyId", "branchId", "vendorGLId", "subLedgerId", "agentId", "mainBillId", "reversalOfId", "journalVoucherId", "purchaseChallanId", "purchaseOrderId" ON public."PurchaseBill" FOR EACH ROW EXECUTE FUNCTION "namo"."enforce_company"();
--> statement-breakpoint
DROP TRIGGER namo_company_consistency ON public."PurchaseBillLine";
--> statement-breakpoint
CREATE TRIGGER namo_company_consistency BEFORE INSERT OR UPDATE OF "purchaseBillId", "productId", "altUnitId", "unitId", "locationId", "challanLineId", "purchaseOrderLineId" ON public."PurchaseBillLine" FOR EACH ROW EXECUTE FUNCTION "namo"."enforce_company"();
--> statement-breakpoint

-- A challan received against an order must come from the order's vendor; each of its lines must fulfil a line of THAT
-- order, for the same product. (Challan without an order: its lines cannot point at order lines.)
CREATE FUNCTION "namo"."check_challan_order"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE po record;
BEGIN
  IF NEW."purchaseOrderId" IS NULL THEN
    IF TG_OP = 'UPDATE' AND EXISTS (SELECT 1 FROM public."PurchaseChallanLine" WHERE "purchaseChallanId" = NEW.id AND "purchaseOrderLineId" IS NOT NULL) THEN
      RAISE EXCEPTION 'Challan % has lines that fulfil order lines; it cannot be detached from its purchase order.', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  SELECT "vendorGLId" INTO po FROM public."PurchaseOrder" WHERE id = NEW."purchaseOrderId";
  IF po."vendorGLId" <> NEW."vendorGLId" THEN
    RAISE EXCEPTION 'Vendor mismatch: challan vendor ledger % differs from purchase order % vendor ledger %.', NEW."vendorGLId", NEW."purchaseOrderId", po."vendorGLId"
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND EXISTS (
    SELECT 1 FROM public."PurchaseChallanLine" l JOIN public."PurchaseOrderLine" ol ON ol.id = l."purchaseOrderLineId"
     WHERE l."purchaseChallanId" = NEW.id AND ol."purchaseOrderId" <> NEW."purchaseOrderId"
  ) THEN
    RAISE EXCEPTION 'Challan % has lines that fulfil lines of another purchase order.', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER namo_challan_order BEFORE INSERT OR UPDATE OF "purchaseOrderId", "vendorGLId" ON public."PurchaseChallan" FOR EACH ROW EXECUTE FUNCTION "namo"."check_challan_order"();
--> statement-breakpoint
CREATE FUNCTION "namo"."check_challan_line_order"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ch record; ol record;
BEGIN
  IF NEW."purchaseOrderLineId" IS NULL THEN RETURN NEW; END IF;
  SELECT "purchaseOrderId" INTO ch FROM public."PurchaseChallan" WHERE id = NEW."purchaseChallanId";
  IF ch."purchaseOrderId" IS NULL THEN
    RAISE EXCEPTION 'Challan % has no purchase order, so its line cannot fulfil an order line.', NEW."purchaseChallanId"
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT "purchaseOrderId", "productId" INTO ol FROM public."PurchaseOrderLine" WHERE id = NEW."purchaseOrderLineId";
  IF ol."purchaseOrderId" <> ch."purchaseOrderId" THEN
    RAISE EXCEPTION 'Order line % belongs to purchase order %, not to the challan''s order %.', NEW."purchaseOrderLineId", ol."purchaseOrderId", ch."purchaseOrderId"
      USING ERRCODE = 'check_violation';
  END IF;
  IF ol."productId" <> NEW."productId" THEN
    RAISE EXCEPTION 'Product mismatch: challan line product % differs from order line % product %.', NEW."productId", NEW."purchaseOrderLineId", ol."productId"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER namo_challan_line_order BEFORE INSERT OR UPDATE OF "purchaseChallanId", "purchaseOrderLineId", "productId" ON public."PurchaseChallanLine" FOR EACH ROW EXECUTE FUNCTION "namo"."check_challan_line_order"();
--> statement-breakpoint

-- A bill that closes a challan and/or an order must come from their vendor, and must agree with itself: when it names
-- both, the challan must have been received against that order. Its lines must bill lines of THOSE documents,
-- for the same product (an order line may also be reached through the challan line).
CREATE FUNCTION "namo"."check_bill_source"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ch_vendor integer; ch_order integer; po record;
BEGIN
  IF NEW."purchaseChallanId" IS NOT NULL THEN
    SELECT "vendorGLId", "purchaseOrderId" INTO ch_vendor, ch_order FROM public."PurchaseChallan" WHERE id = NEW."purchaseChallanId";
    IF ch_vendor <> NEW."vendorGLId" THEN
      RAISE EXCEPTION 'Vendor mismatch: bill vendor ledger % differs from challan % vendor ledger %.', NEW."vendorGLId", NEW."purchaseChallanId", ch_vendor
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."purchaseOrderId" IS NOT NULL AND ch_order IS NOT NULL AND ch_order <> NEW."purchaseOrderId" THEN
      RAISE EXCEPTION 'Challan % was received against purchase order %, not order %.', NEW."purchaseChallanId", ch_order, NEW."purchaseOrderId"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW."purchaseOrderId" IS NOT NULL THEN
    SELECT "vendorGLId" INTO po FROM public."PurchaseOrder" WHERE id = NEW."purchaseOrderId";
    IF po."vendorGLId" <> NEW."vendorGLId" THEN
      RAISE EXCEPTION 'Vendor mismatch: bill vendor ledger % differs from purchase order % vendor ledger %.', NEW."vendorGLId", NEW."purchaseOrderId", po."vendorGLId"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF EXISTS (
      SELECT 1 FROM public."PurchaseBillLine" l JOIN public."PurchaseChallanLine" cl ON cl.id = l."challanLineId"
       WHERE l."purchaseBillId" = NEW.id AND cl."purchaseChallanId" IS DISTINCT FROM NEW."purchaseChallanId"
    ) THEN
      RAISE EXCEPTION 'Bill % has lines that bill lines of another challan.', NEW.id USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public."PurchaseBillLine" l JOIN public."PurchaseOrderLine" ol ON ol.id = l."purchaseOrderLineId"
       WHERE l."purchaseBillId" = NEW.id
         AND ol."purchaseOrderId" IS DISTINCT FROM COALESCE(NEW."purchaseOrderId", ch_order)
    ) THEN
      RAISE EXCEPTION 'Bill % has lines that bill lines of another purchase order.', NEW.id USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER namo_bill_source BEFORE INSERT OR UPDATE OF "purchaseChallanId", "purchaseOrderId", "vendorGLId" ON public."PurchaseBill" FOR EACH ROW EXECUTE FUNCTION "namo"."check_bill_source"();
--> statement-breakpoint
CREATE FUNCTION "namo"."check_bill_line_source"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b record; ch_order integer; cl record; ol record;
BEGIN
  IF NEW."challanLineId" IS NULL AND NEW."purchaseOrderLineId" IS NULL THEN RETURN NEW; END IF;
  SELECT "purchaseChallanId", "purchaseOrderId" INTO b FROM public."PurchaseBill" WHERE id = NEW."purchaseBillId";
  IF NEW."challanLineId" IS NOT NULL THEN
    SELECT "purchaseChallanId", "purchaseOrderLineId", "productId" INTO cl FROM public."PurchaseChallanLine" WHERE id = NEW."challanLineId";
    IF b."purchaseChallanId" IS NULL OR cl."purchaseChallanId" <> b."purchaseChallanId" THEN
      RAISE EXCEPTION 'Challan line % is not a line of the challan this bill closes (%).', NEW."challanLineId", b."purchaseChallanId"
        USING ERRCODE = 'check_violation';
    END IF;
    IF cl."productId" <> NEW."productId" THEN
      RAISE EXCEPTION 'Product mismatch: bill line product % differs from challan line % product %.', NEW."productId", NEW."challanLineId", cl."productId"
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."purchaseOrderLineId" IS NOT NULL AND cl."purchaseOrderLineId" IS NOT NULL AND cl."purchaseOrderLineId" <> NEW."purchaseOrderLineId" THEN
      RAISE EXCEPTION 'Challan line % fulfils order line %, not order line %.', NEW."challanLineId", cl."purchaseOrderLineId", NEW."purchaseOrderLineId"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW."purchaseOrderLineId" IS NOT NULL THEN
    SELECT "purchaseOrderId" INTO ch_order FROM public."PurchaseChallan" WHERE id = b."purchaseChallanId";
    SELECT "purchaseOrderId", "productId" INTO ol FROM public."PurchaseOrderLine" WHERE id = NEW."purchaseOrderLineId";
    IF ol."purchaseOrderId" IS DISTINCT FROM COALESCE(b."purchaseOrderId", ch_order) THEN
      RAISE EXCEPTION 'Order line % is not a line of the purchase order this bill closes.', NEW."purchaseOrderLineId"
        USING ERRCODE = 'check_violation';
    END IF;
    IF ol."productId" <> NEW."productId" THEN
      RAISE EXCEPTION 'Product mismatch: bill line product % differs from order line % product %.', NEW."productId", NEW."purchaseOrderLineId", ol."productId"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER namo_bill_line_source BEFORE INSERT OR UPDATE OF "purchaseBillId", "challanLineId", "purchaseOrderLineId", "productId" ON public."PurchaseBillLine" FOR EACH ROW EXECUTE FUNCTION "namo"."check_bill_line_source"();
--> statement-breakpoint

-- ORDER-LEVEL BILLING TERMS. Same shape as the bill rules (see 0005), extended to documentType = 'PURCHASE_ORDER':
-- a term must belong to a real order of the same company, a line term to a line of that order, an allocation to a line
-- of that order. ADDITIONAL-category terms (import duty, excise, ...) are actual charges: bills only, never orders.
CREATE OR REPLACE FUNCTION "namo"."check_purchase_bill_term"() RETURNS trigger LANGUAGE plpgsql AS $$
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
    IF cat = 'ADDITIONAL' THEN
      RAISE EXCEPTION 'An ADDITIONAL purchase term is an actual charge and can only be entered on an additional purchase bill, not on purchase order %.', o.id
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
  IF cat = 'ADDITIONAL' AND b."mainBillId" IS NULL THEN
    RAISE EXCEPTION 'An ADDITIONAL purchase term can only be entered on an additional purchase bill (bill % is a main bill).', b.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "namo"."check_purchase_bill_allocation"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tm record; ln record; main_id integer;
BEGIN
  SELECT "documentType", "documentId", "documentLineId" INTO tm FROM public."PurchaseDocumentTerm" WHERE id = NEW."documentTermId";
  IF NOT FOUND OR tm."documentType" NOT IN ('PURCHASE_BILL', 'PURCHASE_ORDER') THEN RETURN NEW; END IF;
  IF tm."documentLineId" IS NOT NULL THEN
    RAISE EXCEPTION 'A line-level term is already on its line and cannot be allocated across lines.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF tm."documentType" = 'PURCHASE_ORDER' THEN
    SELECT "purchaseOrderId" INTO ln FROM public."PurchaseOrderLine" WHERE id = NEW."documentLineId";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Allocation points at line % which is not a purchase order line.', NEW."documentLineId"
        USING ERRCODE = 'check_violation';
    END IF;
    IF ln."purchaseOrderId" <> tm."documentId" THEN
      RAISE EXCEPTION 'Line % belongs to purchase order %, not to the order of this term (%).', NEW."documentLineId", ln."purchaseOrderId", tm."documentId"
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  SELECT "purchaseBillId" INTO ln FROM public."PurchaseBillLine" WHERE id = NEW."documentLineId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Allocation points at line % which is not a purchase bill line.', NEW."documentLineId"
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT "mainBillId" INTO main_id FROM public."PurchaseBill" WHERE id = tm."documentId";
  IF ln."purchaseBillId" <> tm."documentId" AND ln."purchaseBillId" IS DISTINCT FROM main_id THEN
    RAISE EXCEPTION 'Line % belongs to purchase bill %, which is neither the bill of this term (%) nor its main bill.', NEW."documentLineId", ln."purchaseBillId", tm."documentId"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

-- Deleting an order removes its terms (their allocations cascade). Deleting an order line removes the terms and
-- allocations that sit on that line. (Challan and bill lines that point at the line are refused by their own foreign keys.)
CREATE FUNCTION "namo"."cleanup_purchase_order_terms"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM public."PurchaseDocumentTerm" WHERE "documentType" = 'PURCHASE_ORDER' AND "documentId" = OLD.id;
  RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER namo_purchase_order_term_cleanup AFTER DELETE ON public."PurchaseOrder" FOR EACH ROW EXECUTE FUNCTION "namo"."cleanup_purchase_order_terms"();
--> statement-breakpoint
CREATE FUNCTION "namo"."guard_order_line_delete"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM public."PurchaseDocumentTermAllocation" a USING public."PurchaseDocumentTerm" t
   WHERE a."documentTermId" = t.id AND t."documentType" = 'PURCHASE_ORDER' AND a."documentLineId" = OLD.id;
  DELETE FROM public."PurchaseDocumentTerm" WHERE "documentType" = 'PURCHASE_ORDER' AND "documentLineId" = OLD.id;
  RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER namo_order_line_delete BEFORE DELETE ON public."PurchaseOrderLine" FOR EACH ROW EXECUTE FUNCTION "namo"."guard_order_line_delete"();
