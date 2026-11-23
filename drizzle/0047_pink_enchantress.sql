CREATE TYPE "public"."SalesInvoiceType" AS ENUM('LOCAL', 'EXPORT');--> statement-breakpoint
CREATE TYPE "public"."SalesType" AS ENUM('GOODS_SALES', 'SERVICE_SALES');--> statement-breakpoint
CREATE TYPE "public"."StockSourceType" AS ENUM('PURCHASE_CHALLAN', 'PURCHASE_BILL', 'SALES_CHALLAN', 'SALES_INVOICE');--> statement-breakpoint
CREATE TABLE "GeneralLedgerSetup" (
	"id" serial PRIMARY KEY NOT NULL,
	"companyId" integer NOT NULL,
	"role" varchar(32) NOT NULL,
	"generalLedgerId" integer,
	"allowJournal" boolean DEFAULT false NOT NULL,
	"allowCashBank" boolean DEFAULT false NOT NULL,
	"allowSalesInvoice" boolean DEFAULT false NOT NULL,
	"allowSalesReturn" boolean DEFAULT false NOT NULL,
	"allowPurchaseBill" boolean DEFAULT false NOT NULL,
	"allowPurchaseReturn" boolean DEFAULT false NOT NULL,
	"allowOpeningBalance" boolean DEFAULT false NOT NULL,
	"allowStockOpening" boolean DEFAULT false NOT NULL,
	"isLocked" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	CONSTRAINT "GeneralLedgerSetup_role_check" CHECK ("GeneralLedgerSetup"."role" in ('PROFIT_AND_LOSS','CASH_BOOK','SALES_ACCOUNT','SALES_RETURN_ACCOUNT','PURCHASE_ACCOUNT','PURCHASE_RETURN_ACCOUNT','OPENING_STOCK_PL','CLOSING_STOCK_PL','CLOSING_STOCK_BS'))
);
--> statement-breakpoint
CREATE TABLE "SalesChallan" (
	"id" serial PRIMARY KEY NOT NULL,
	"companyId" integer NOT NULL,
	"branchId" integer NOT NULL,
	"challanNumber" varchar(30) NOT NULL,
	"numberSeriesId" integer,
	"challanDate" date NOT NULL,
	"fiscalYear" varchar(15) NOT NULL,
	"customerGLId" integer NOT NULL,
	"subLedgerId" integer,
	"agentId" integer,
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
	CONSTRAINT "SalesChallan_confirmed_check" CHECK (NOT "SalesChallan"."isConfirmed" OR "SalesChallan"."confirmedAt" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "SalesChallanLine" (
	"id" serial PRIMARY KEY NOT NULL,
	"salesChallanId" integer NOT NULL,
	"lineNumber" integer NOT NULL,
	"productId" integer NOT NULL,
	"altQty" numeric(18, 6),
	"altUnitId" integer,
	"qty" numeric(18, 6) NOT NULL,
	"unitId" integer NOT NULL,
	"rate" numeric(18, 6) DEFAULT '0' NOT NULL,
	"basicAmount" numeric(18, 6) DEFAULT '0' NOT NULL,
	"locationId" integer,
	"batchNo" varchar(50),
	"expiryDate" date,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "SalesChallanLine_lineNumber_check" CHECK ("SalesChallanLine"."lineNumber" > 0),
	CONSTRAINT "SalesChallanLine_amounts_check" CHECK ("SalesChallanLine"."qty" > 0 AND "SalesChallanLine"."rate" >= 0 AND "SalesChallanLine"."basicAmount" >= 0),
	CONSTRAINT "SalesChallanLine_alt_pair_check" CHECK (("SalesChallanLine"."altQty" IS NULL) = ("SalesChallanLine"."altUnitId" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "LedgerReassignItem" (
	"id" serial PRIMARY KEY NOT NULL,
	"jobId" integer NOT NULL,
	"documentType" varchar(20) NOT NULL,
	"documentId" integer NOT NULL,
	CONSTRAINT "LedgerReassignItem_type_check" CHECK ("LedgerReassignItem"."documentType" IN ('PURCHASE_BILL', 'SALES_INVOICE'))
);
--> statement-breakpoint
CREATE TABLE "LedgerReassignJob" (
	"id" serial PRIMARY KEY NOT NULL,
	"companyId" integer NOT NULL,
	"kind" varchar(30) NOT NULL,
	"masterId" integer NOT NULL,
	"masterName" varchar(200) NOT NULL,
	"fromLedgerId" integer NOT NULL,
	"toLedgerId" integer NOT NULL,
	"status" varchar(10) DEFAULT 'QUEUED' NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"processed" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"message" text,
	"createdBy" integer,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"startedAt" timestamp (3),
	"finishedAt" timestamp (3),
	"seenAt" timestamp (3),
	"windows" jsonb,
	CONSTRAINT "LedgerReassignJob_status_check" CHECK ("LedgerReassignJob"."status" IN ('QUEUED', 'RUNNING', 'DONE', 'FAILED')),
	CONSTRAINT "LedgerReassignJob_ledgers_check" CHECK ("LedgerReassignJob"."fromLedgerId" <> "LedgerReassignJob"."toLedgerId")
);
--> statement-breakpoint
CREATE TABLE "StockMovement" (
	"id" serial PRIMARY KEY NOT NULL,
	"companyId" integer NOT NULL,
	"branchId" integer NOT NULL,
	"productId" integer NOT NULL,
	"locationId" integer,
	"batchNo" varchar(50),
	"expiryDate" date,
	"movementDate" date NOT NULL,
	"qty" numeric(18, 6) NOT NULL,
	"sourceType" "StockSourceType" NOT NULL,
	"sourceId" integer NOT NULL,
	"sourceLineId" integer NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "StockMovement_qty_check" CHECK ("StockMovement"."qty" <> 0)
);
--> statement-breakpoint
ALTER TABLE "GeneralLedger" ALTER COLUMN "accountSubGroupId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "GeneralLedger" ADD COLUMN "accountGroupId" integer;--> statement-breakpoint
ALTER TABLE "NonStockDetail" ADD COLUMN "salesGLDefaulted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "NonStockDetail" ADD COLUMN "purchaseGLDefaulted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "StockDetail" ADD COLUMN "openingGLDefaulted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "StockDetail" ADD COLUMN "closingPLGLDefaulted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "StockDetail" ADD COLUMN "closingBSGLDefaulted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "StockDetail" ADD COLUMN "purchaseGLDefaulted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "StockDetail" ADD COLUMN "purchaseReturnGLDefaulted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "StockDetail" ADD COLUMN "salesGLDefaulted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "StockDetail" ADD COLUMN "salesReturnGLDefaulted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "PurchaseBillLine" ADD COLUMN "foreignRate" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "PurchaseBillLine" ADD COLUMN "foreignAmount" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "SalesInvoice" ADD COLUMN "invoiceType" "SalesInvoiceType" DEFAULT 'LOCAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "SalesInvoice" ADD COLUMN "salesType" "SalesType" DEFAULT 'GOODS_SALES' NOT NULL;--> statement-breakpoint
ALTER TABLE "SalesInvoice" ADD COLUMN "exportCurrency" varchar(3);--> statement-breakpoint
ALTER TABLE "SalesInvoice" ADD COLUMN "exportExchangeRate" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "SalesInvoice" ADD COLUMN "exportForeignTotal" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "SalesInvoice" ADD COLUMN "salesContractNo" varchar(40);--> statement-breakpoint
ALTER TABLE "SalesInvoice" ADD COLUMN "salesContractDate" date;--> statement-breakpoint
ALTER TABLE "SalesInvoice" ADD COLUMN "notifyParty" varchar(200);--> statement-breakpoint
ALTER TABLE "SalesInvoice" ADD COLUMN "buyerOrderNo" varchar(40);--> statement-breakpoint
ALTER TABLE "SalesInvoice" ADD COLUMN "buyerOrderDate" date;--> statement-breakpoint
ALTER TABLE "SalesInvoice" ADD COLUMN "buyerTaxId" varchar(40);--> statement-breakpoint
ALTER TABLE "SalesInvoice" ADD COLUMN "customsDeclarationNo" varchar(30);--> statement-breakpoint
ALTER TABLE "SalesInvoice" ADD COLUMN "customsDeclarationDate" date;--> statement-breakpoint
ALTER TABLE "SalesInvoice" ADD COLUMN "customsOfficeExit" varchar(100);--> statement-breakpoint
ALTER TABLE "SalesInvoice" ADD COLUMN "certificateOfOriginNo" varchar(40);--> statement-breakpoint
ALTER TABLE "SalesInvoice" ADD COLUMN "preferentialScheme" varchar(60);--> statement-breakpoint
ALTER TABLE "SalesInvoice" ADD COLUMN "incoterm" varchar(10);--> statement-breakpoint
ALTER TABLE "SalesInvoice" ADD COLUMN "incotermPlace" varchar(60);--> statement-breakpoint
ALTER TABLE "SalesInvoice" ADD COLUMN "transportMode" varchar(10);--> statement-breakpoint
ALTER TABLE "SalesInvoice" ADD COLUMN "pointOfLoading" varchar(60);--> statement-breakpoint
ALTER TABLE "SalesInvoice" ADD COLUMN "pointOfDischarge" varchar(60);--> statement-breakpoint
ALTER TABLE "SalesInvoice" ADD COLUMN "finalDestination" varchar(60);--> statement-breakpoint
ALTER TABLE "SalesInvoice" ADD COLUMN "vehicleNo" varchar(40);--> statement-breakpoint
ALTER TABLE "SalesInvoice" ADD COLUMN "transportDocNo" varchar(40);--> statement-breakpoint
ALTER TABLE "SalesInvoice" ADD COLUMN "transportDocDate" date;--> statement-breakpoint
ALTER TABLE "SalesInvoice" ADD COLUMN "packagesMarks" varchar(200);--> statement-breakpoint
ALTER TABLE "SalesInvoice" ADD COLUMN "grossWeight" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "SalesInvoice" ADD COLUMN "netWeight" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "SalesInvoice" ADD COLUMN "paymentTerms" varchar(60);--> statement-breakpoint
ALTER TABLE "SalesInvoice" ADD COLUMN "fxReference" varchar(60);--> statement-breakpoint
ALTER TABLE "SalesInvoice" ADD COLUMN "bankAccountName" varchar(100);--> statement-breakpoint
ALTER TABLE "SalesInvoice" ADD COLUMN "bankAccountNo" varchar(40);--> statement-breakpoint
ALTER TABLE "SalesInvoice" ADD COLUMN "bankName" varchar(100);--> statement-breakpoint
ALTER TABLE "SalesInvoice" ADD COLUMN "bankSwift" varchar(20);--> statement-breakpoint
ALTER TABLE "SalesInvoice" ADD COLUMN "salesChallanId" integer;--> statement-breakpoint
ALTER TABLE "SalesInvoiceLine" ADD COLUMN "foreignRate" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "SalesInvoiceLine" ADD COLUMN "foreignAmount" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "SalesInvoiceLine" ADD COLUMN "locationId" integer;--> statement-breakpoint
ALTER TABLE "SalesInvoiceLine" ADD COLUMN "batchNo" varchar(50);--> statement-breakpoint
ALTER TABLE "SalesInvoiceLine" ADD COLUMN "expiryDate" date;--> statement-breakpoint
ALTER TABLE "SalesInvoiceLine" ADD COLUMN "challanLineId" integer;--> statement-breakpoint
UPDATE "GeneralLedger" gl SET "accountGroupId" = sg."accountGroupId"
FROM "AccountSubGroup" sg WHERE sg.id = gl."accountSubGroupId" AND gl."accountGroupId" IS NULL;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "GeneralLedger" WHERE "accountGroupId" IS NULL) THEN
    RAISE EXCEPTION 'Cannot make GeneralLedger.accountGroupId mandatory: existing ledger has no Account Group.';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "GeneralLedger" ALTER COLUMN "accountGroupId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "GeneralLedgerSetup" ADD CONSTRAINT "GeneralLedgerSetup_companyId_Company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "GeneralLedgerSetup" ADD CONSTRAINT "GeneralLedgerSetup_generalLedgerId_GeneralLedger_id_fk" FOREIGN KEY ("generalLedgerId") REFERENCES "public"."GeneralLedger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SalesChallan" ADD CONSTRAINT "SalesChallan_companyId_Company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SalesChallan" ADD CONSTRAINT "SalesChallan_branchId_Branch_id_fk" FOREIGN KEY ("branchId") REFERENCES "public"."Branch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SalesChallan" ADD CONSTRAINT "SalesChallan_numberSeriesId_NumberSeries_id_fk" FOREIGN KEY ("numberSeriesId") REFERENCES "public"."NumberSeries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SalesChallan" ADD CONSTRAINT "SalesChallan_customerGLId_GeneralLedger_id_fk" FOREIGN KEY ("customerGLId") REFERENCES "public"."GeneralLedger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SalesChallan" ADD CONSTRAINT "SalesChallan_subLedgerId_SubLedger_id_fk" FOREIGN KEY ("subLedgerId") REFERENCES "public"."SubLedger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SalesChallan" ADD CONSTRAINT "SalesChallan_agentId_Agent_id_fk" FOREIGN KEY ("agentId") REFERENCES "public"."Agent"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SalesChallan" ADD CONSTRAINT "SalesChallan_confirmedBy_User_id_fk" FOREIGN KEY ("confirmedBy") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SalesChallan" ADD CONSTRAINT "SalesChallan_createdBy_User_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SalesChallanLine" ADD CONSTRAINT "SalesChallanLine_salesChallanId_SalesChallan_id_fk" FOREIGN KEY ("salesChallanId") REFERENCES "public"."SalesChallan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SalesChallanLine" ADD CONSTRAINT "SalesChallanLine_productId_Product_id_fk" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SalesChallanLine" ADD CONSTRAINT "SalesChallanLine_altUnitId_ProductUnit_id_fk" FOREIGN KEY ("altUnitId") REFERENCES "public"."ProductUnit"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SalesChallanLine" ADD CONSTRAINT "SalesChallanLine_unitId_ProductUnit_id_fk" FOREIGN KEY ("unitId") REFERENCES "public"."ProductUnit"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SalesChallanLine" ADD CONSTRAINT "SalesChallanLine_locationId_Location_id_fk" FOREIGN KEY ("locationId") REFERENCES "public"."Location"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "LedgerReassignItem" ADD CONSTRAINT "LedgerReassignItem_jobId_LedgerReassignJob_id_fk" FOREIGN KEY ("jobId") REFERENCES "public"."LedgerReassignJob"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "LedgerReassignJob" ADD CONSTRAINT "LedgerReassignJob_companyId_Company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "LedgerReassignJob" ADD CONSTRAINT "LedgerReassignJob_fromLedgerId_GeneralLedger_id_fk" FOREIGN KEY ("fromLedgerId") REFERENCES "public"."GeneralLedger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "LedgerReassignJob" ADD CONSTRAINT "LedgerReassignJob_toLedgerId_GeneralLedger_id_fk" FOREIGN KEY ("toLedgerId") REFERENCES "public"."GeneralLedger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "LedgerReassignJob" ADD CONSTRAINT "LedgerReassignJob_createdBy_User_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_companyId_Company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_branchId_Branch_id_fk" FOREIGN KEY ("branchId") REFERENCES "public"."Branch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productId_Product_id_fk" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_locationId_Location_id_fk" FOREIGN KEY ("locationId") REFERENCES "public"."Location"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "GeneralLedgerSetup_companyId_role_key" ON "GeneralLedgerSetup" USING btree ("companyId","role");--> statement-breakpoint
CREATE INDEX "GeneralLedgerSetup_companyId_idx" ON "GeneralLedgerSetup" USING btree ("companyId");--> statement-breakpoint
CREATE INDEX "GeneralLedgerSetup_generalLedgerId_idx" ON "GeneralLedgerSetup" USING btree ("generalLedgerId");--> statement-breakpoint
CREATE UNIQUE INDEX "SalesChallan_branchId_fiscalYear_challanNumber_key" ON "SalesChallan" USING btree ("branchId","fiscalYear","challanNumber");--> statement-breakpoint
CREATE INDEX "SalesChallan_companyId_idx" ON "SalesChallan" USING btree ("companyId");--> statement-breakpoint
CREATE INDEX "SalesChallan_branchId_idx" ON "SalesChallan" USING btree ("branchId");--> statement-breakpoint
CREATE INDEX "SalesChallan_customerGLId_idx" ON "SalesChallan" USING btree ("customerGLId");--> statement-breakpoint
CREATE INDEX "SalesChallan_subLedgerId_idx" ON "SalesChallan" USING btree ("subLedgerId");--> statement-breakpoint
CREATE INDEX "SalesChallan_agentId_idx" ON "SalesChallan" USING btree ("agentId");--> statement-breakpoint
CREATE INDEX "SalesChallan_fiscalYear_idx" ON "SalesChallan" USING btree ("fiscalYear");--> statement-breakpoint
CREATE INDEX "SalesChallan_challanDate_idx" ON "SalesChallan" USING btree ("challanDate");--> statement-breakpoint
CREATE UNIQUE INDEX "SalesChallanLine_salesChallanId_lineNumber_key" ON "SalesChallanLine" USING btree ("salesChallanId","lineNumber");--> statement-breakpoint
CREATE INDEX "SalesChallanLine_productId_idx" ON "SalesChallanLine" USING btree ("productId");--> statement-breakpoint
CREATE INDEX "SalesChallanLine_altUnitId_idx" ON "SalesChallanLine" USING btree ("altUnitId");--> statement-breakpoint
CREATE INDEX "SalesChallanLine_unitId_idx" ON "SalesChallanLine" USING btree ("unitId");--> statement-breakpoint
CREATE INDEX "SalesChallanLine_locationId_idx" ON "SalesChallanLine" USING btree ("locationId");--> statement-breakpoint
CREATE UNIQUE INDEX "LedgerReassignItem_job_document_key" ON "LedgerReassignItem" USING btree ("jobId","documentType","documentId");--> statement-breakpoint
CREATE INDEX "LedgerReassignJob_companyId_idx" ON "LedgerReassignJob" USING btree ("companyId");--> statement-breakpoint
CREATE INDEX "LedgerReassignJob_status_idx" ON "LedgerReassignJob" USING btree ("status");--> statement-breakpoint
CREATE INDEX "StockMovement_company_branch_product_idx" ON "StockMovement" USING btree ("companyId","branchId","productId");--> statement-breakpoint
CREATE INDEX "StockMovement_source_idx" ON "StockMovement" USING btree ("sourceType","sourceId");--> statement-breakpoint
CREATE INDEX "StockMovement_locationId_idx" ON "StockMovement" USING btree ("locationId");--> statement-breakpoint
ALTER TABLE "GeneralLedger" ADD CONSTRAINT "GeneralLedger_accountGroupId_AccountGroup_id_fk" FOREIGN KEY ("accountGroupId") REFERENCES "public"."AccountGroup"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SalesInvoice" ADD CONSTRAINT "SalesInvoice_salesChallanId_SalesChallan_id_fk" FOREIGN KEY ("salesChallanId") REFERENCES "public"."SalesChallan"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SalesInvoiceLine" ADD CONSTRAINT "SalesInvoiceLine_locationId_Location_id_fk" FOREIGN KEY ("locationId") REFERENCES "public"."Location"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SalesInvoiceLine" ADD CONSTRAINT "SalesInvoiceLine_challanLineId_SalesChallanLine_id_fk" FOREIGN KEY ("challanLineId") REFERENCES "public"."SalesChallanLine"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "GeneralLedger_accountGroupId_idx" ON "GeneralLedger" USING btree ("accountGroupId");--> statement-breakpoint
CREATE INDEX "SalesInvoice_salesChallanId_idx" ON "SalesInvoice" USING btree ("salesChallanId");--> statement-breakpoint
CREATE INDEX "SalesInvoiceLine_locationId_idx" ON "SalesInvoiceLine" USING btree ("locationId");--> statement-breakpoint
CREATE INDEX "SalesInvoiceLine_challanLineId_idx" ON "SalesInvoiceLine" USING btree ("challanLineId");--> statement-breakpoint
ALTER TABLE "SalesInvoice" ADD CONSTRAINT "SalesInvoice_export_only_check" CHECK ("SalesInvoice"."invoiceType" = 'EXPORT' OR ("SalesInvoice"."exportCurrency" IS NULL AND "SalesInvoice"."customsDeclarationNo" IS NULL AND "SalesInvoice"."finalDestination" IS NULL));--> statement-breakpoint
ALTER TABLE "SalesInvoice" ADD CONSTRAINT "SalesInvoice_export_currency_check" CHECK (("SalesInvoice"."exportCurrency" IS NULL AND "SalesInvoice"."exportExchangeRate" IS NULL AND "SalesInvoice"."exportForeignTotal" IS NULL) OR ("SalesInvoice"."exportCurrency" ~ '^[A-Z]{3}$' AND "SalesInvoice"."exportExchangeRate" > 0));

-- GeneralLedger now owns its mandatory Account Group directly; the subgroup is optional.
DROP TRIGGER IF EXISTS "GeneralLedger_company_check" ON "GeneralLedger";
DROP FUNCTION IF EXISTS "namo_gl_company_check"();
CREATE FUNCTION "namo_gl_company_check"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE grp_company integer; parent_company integer;
BEGIN
  SELECT g."companyId" INTO grp_company FROM "AccountGroup" g WHERE g.id = NEW."accountGroupId" FOR SHARE;
  IF grp_company IS DISTINCT FROM NEW."companyId" THEN
    RAISE EXCEPTION 'General Ledger company (%) does not match the company (%) of its Account Group.', NEW."companyId", grp_company USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."accountSubGroupId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "AccountSubGroup" sg WHERE sg.id = NEW."accountSubGroupId" AND sg."accountGroupId" = NEW."accountGroupId"
  ) THEN
    RAISE EXCEPTION 'General Ledger subgroup must belong to its Account Group.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."parentId" IS NOT NULL THEN
    SELECT p."companyId" INTO parent_company FROM "GeneralLedger" p WHERE p.id = NEW."parentId" FOR SHARE;
    IF parent_company IS DISTINCT FROM NEW."companyId" THEN
      RAISE EXCEPTION 'Parent ledger must belong to the same company as the ledger.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "GeneralLedger_company_check"
  BEFORE INSERT OR UPDATE OF "companyId", "accountGroupId", "accountSubGroupId", "parentId" ON "GeneralLedger"
  FOR EACH ROW EXECUTE FUNCTION "namo_gl_company_check"();
--> statement-breakpoint
INSERT INTO "namo"."company_link" (tbl, col, link_tbl)
VALUES ('GeneralLedger', 'accountGroupId', 'AccountGroup')
ON CONFLICT (tbl, col) DO NOTHING;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION "namo_group_company_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "GeneralLedger" gl WHERE gl."accountGroupId" = NEW.id AND gl."companyId" <> NEW."companyId"
  ) THEN
    RAISE EXCEPTION 'Cannot change the company of an Account Group that still has ledgers under it.' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "AccountSubGroup" sg JOIN "GeneralLedger" gl ON gl."accountSubGroupId" = sg.id
    WHERE sg."accountGroupId" = NEW.id AND gl."companyId" <> NEW."companyId"
  ) THEN
    RAISE EXCEPTION 'Cannot change the company of an Account Group that still has ledgers under it.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
