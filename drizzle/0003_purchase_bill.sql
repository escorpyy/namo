CREATE TYPE "public"."PurchaseInvoiceType" AS ENUM('LOCAL', 'IMPORT', 'TAXABLE_CAPITAL');--> statement-breakpoint
CREATE TABLE "PurchaseBill" (
	"id" serial PRIMARY KEY NOT NULL,
	"companyId" integer NOT NULL,
	"branchId" integer NOT NULL,
	"documentType" "DocumentType" DEFAULT 'PURCHASE_BILL' NOT NULL,
	"invoiceType" "PurchaseInvoiceType" DEFAULT 'LOCAL' NOT NULL,
	"invoiceNumber" varchar(30) NOT NULL,
	"invoiceDate" date NOT NULL,
	"fiscalYear" varchar(15) NOT NULL,
	"vendorGLId" integer NOT NULL,
	"subLedgerId" integer,
	"agentId" integer,
	"vendorInvoiceNo" varchar(30),
	"vendorInvoiceDate" date,
	"challanNo" varchar(30),
	"orderNo" varchar(30),
	"dueDays" integer DEFAULT 0 NOT NULL,
	"dueDate" date,
	"basicAmount" numeric(18, 6) DEFAULT '0' NOT NULL,
	"termAmount" numeric(18, 6) DEFAULT '0' NOT NULL,
	"totalAmount" numeric(18, 6) DEFAULT '0' NOT NULL,
	"remarks" varchar(1024),
	"mainBillId" integer,
	"reversalOfId" integer,
	"isPosted" boolean DEFAULT false NOT NULL,
	"postedAt" timestamp (3),
	"postedBy" integer,
	"createdBy" integer,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	CONSTRAINT "PurchaseBill_dueDays_check" CHECK ("PurchaseBill"."dueDays" >= 0),
	CONSTRAINT "PurchaseBill_not_own_main_check" CHECK ("PurchaseBill"."mainBillId" IS NULL OR "PurchaseBill"."mainBillId" <> "PurchaseBill"."id"),
	CONSTRAINT "PurchaseBill_documentType_check" CHECK ("PurchaseBill"."documentType" = 'PURCHASE_BILL')
);
--> statement-breakpoint
CREATE TABLE "PurchaseBillImportDetail" (
	"id" serial PRIMARY KEY NOT NULL,
	"purchaseBillId" integer NOT NULL,
	"importPermitNo" varchar(30),
	"importPermitDate" date,
	"customsDeclarationNo" varchar(30),
	"customsDeclarationDate" date,
	"lcNo" varchar(30),
	"transporterName" varchar(100),
	"vehicleNo" varchar(30),
	"lrNo" varchar(30),
	"lrDate" date,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "PurchaseBillLine" (
	"id" serial PRIMARY KEY NOT NULL,
	"purchaseBillId" integer NOT NULL,
	"lineNumber" integer NOT NULL,
	"productId" integer NOT NULL,
	"particular" varchar(256),
	"altQty" numeric(18, 6),
	"altUnitId" integer,
	"qty" numeric(18, 6) NOT NULL,
	"unitId" integer NOT NULL,
	"rate" numeric(18, 6) DEFAULT '0' NOT NULL,
	"basicAmount" numeric(18, 6) DEFAULT '0' NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "PurchaseBillLine_lineNumber_check" CHECK ("PurchaseBillLine"."lineNumber" > 0),
	CONSTRAINT "PurchaseBillLine_amounts_check" CHECK ("PurchaseBillLine"."qty" >= 0 AND "PurchaseBillLine"."rate" >= 0 AND "PurchaseBillLine"."basicAmount" >= 0),
	CONSTRAINT "PurchaseBillLine_alt_pair_check" CHECK (("PurchaseBillLine"."altQty" IS NULL) = ("PurchaseBillLine"."altUnitId" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "PurchaseBill" ADD CONSTRAINT "PurchaseBill_companyId_Company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseBill" ADD CONSTRAINT "PurchaseBill_branchId_Branch_id_fk" FOREIGN KEY ("branchId") REFERENCES "public"."Branch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseBill" ADD CONSTRAINT "PurchaseBill_vendorGLId_GeneralLedger_id_fk" FOREIGN KEY ("vendorGLId") REFERENCES "public"."GeneralLedger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseBill" ADD CONSTRAINT "PurchaseBill_subLedgerId_SubLedger_id_fk" FOREIGN KEY ("subLedgerId") REFERENCES "public"."SubLedger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseBill" ADD CONSTRAINT "PurchaseBill_agentId_Agent_id_fk" FOREIGN KEY ("agentId") REFERENCES "public"."Agent"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseBill" ADD CONSTRAINT "PurchaseBill_mainBillId_PurchaseBill_id_fk" FOREIGN KEY ("mainBillId") REFERENCES "public"."PurchaseBill"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseBill" ADD CONSTRAINT "PurchaseBill_reversalOfId_PurchaseBill_id_fk" FOREIGN KEY ("reversalOfId") REFERENCES "public"."PurchaseBill"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseBill" ADD CONSTRAINT "PurchaseBill_postedBy_User_id_fk" FOREIGN KEY ("postedBy") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseBill" ADD CONSTRAINT "PurchaseBill_createdBy_User_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseBillImportDetail" ADD CONSTRAINT "PurchaseBillImportDetail_purchaseBillId_PurchaseBill_id_fk" FOREIGN KEY ("purchaseBillId") REFERENCES "public"."PurchaseBill"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseBillLine" ADD CONSTRAINT "PurchaseBillLine_purchaseBillId_PurchaseBill_id_fk" FOREIGN KEY ("purchaseBillId") REFERENCES "public"."PurchaseBill"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseBillLine" ADD CONSTRAINT "PurchaseBillLine_productId_Product_id_fk" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseBillLine" ADD CONSTRAINT "PurchaseBillLine_altUnitId_ProductUnit_id_fk" FOREIGN KEY ("altUnitId") REFERENCES "public"."ProductUnit"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseBillLine" ADD CONSTRAINT "PurchaseBillLine_unitId_ProductUnit_id_fk" FOREIGN KEY ("unitId") REFERENCES "public"."ProductUnit"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "PurchaseBill_branchId_fiscalYear_invoiceNumber_key" ON "PurchaseBill" USING btree ("branchId","fiscalYear","invoiceNumber");--> statement-breakpoint
CREATE UNIQUE INDEX "PurchaseBill_vendor_vendorInvoiceNo_key" ON "PurchaseBill" USING btree ("companyId","vendorGLId","vendorInvoiceNo") WHERE "PurchaseBill"."vendorInvoiceNo" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "PurchaseBill_companyId_idx" ON "PurchaseBill" USING btree ("companyId");--> statement-breakpoint
CREATE INDEX "PurchaseBill_branchId_idx" ON "PurchaseBill" USING btree ("branchId");--> statement-breakpoint
CREATE INDEX "PurchaseBill_vendorGLId_idx" ON "PurchaseBill" USING btree ("vendorGLId");--> statement-breakpoint
CREATE INDEX "PurchaseBill_subLedgerId_idx" ON "PurchaseBill" USING btree ("subLedgerId");--> statement-breakpoint
CREATE INDEX "PurchaseBill_agentId_idx" ON "PurchaseBill" USING btree ("agentId");--> statement-breakpoint
CREATE INDEX "PurchaseBill_mainBillId_idx" ON "PurchaseBill" USING btree ("mainBillId");--> statement-breakpoint
CREATE INDEX "PurchaseBill_fiscalYear_idx" ON "PurchaseBill" USING btree ("fiscalYear");--> statement-breakpoint
CREATE INDEX "PurchaseBill_invoiceDate_idx" ON "PurchaseBill" USING btree ("invoiceDate");--> statement-breakpoint
CREATE UNIQUE INDEX "PurchaseBillImportDetail_purchaseBillId_key" ON "PurchaseBillImportDetail" USING btree ("purchaseBillId");--> statement-breakpoint
CREATE UNIQUE INDEX "PurchaseBillLine_purchaseBillId_lineNumber_key" ON "PurchaseBillLine" USING btree ("purchaseBillId","lineNumber");--> statement-breakpoint
CREATE INDEX "PurchaseBillLine_productId_idx" ON "PurchaseBillLine" USING btree ("productId");--> statement-breakpoint
CREATE INDEX "PurchaseBillLine_altUnitId_idx" ON "PurchaseBillLine" USING btree ("altUnitId");--> statement-breakpoint
CREATE INDEX "PurchaseBillLine_unitId_idx" ON "PurchaseBillLine" USING btree ("unitId");
--> statement-breakpoint

-- Company consistency (ERP-015 registry) for the new tenant-scoped tables.
-- PurchaseBill carries its own companyId; lines and import detail get their company from the bill.
INSERT INTO "namo"."company_source" (tbl, ord, via_col, via_tbl) VALUES
  ('PurchaseBill', 1, NULL, NULL),
  ('PurchaseBillLine', 1, 'purchaseBillId', 'PurchaseBill'),
  ('PurchaseBillImportDetail', 1, 'purchaseBillId', 'PurchaseBill');
--> statement-breakpoint
INSERT INTO "namo"."company_link" (tbl, col, link_tbl) VALUES
  ('PurchaseBill', 'branchId', 'Branch'),
  ('PurchaseBill', 'vendorGLId', 'GeneralLedger'),
  ('PurchaseBill', 'subLedgerId', 'SubLedger'),
  ('PurchaseBill', 'agentId', 'Agent'),
  ('PurchaseBill', 'mainBillId', 'PurchaseBill'),
  ('PurchaseBill', 'reversalOfId', 'PurchaseBill'),
  ('PurchaseBillLine', 'productId', 'Product'),
  ('PurchaseBillLine', 'altUnitId', 'ProductUnit'),
  ('PurchaseBillLine', 'unitId', 'ProductUnit');
--> statement-breakpoint
CREATE TRIGGER namo_company_consistency BEFORE INSERT OR UPDATE OF "companyId", "branchId", "vendorGLId", "subLedgerId", "agentId", "mainBillId", "reversalOfId" ON public."PurchaseBill" FOR EACH ROW EXECUTE FUNCTION "namo"."enforce_company"();
--> statement-breakpoint
CREATE TRIGGER namo_company_consistency BEFORE INSERT OR UPDATE OF "purchaseBillId", "productId", "altUnitId", "unitId" ON public."PurchaseBillLine" FOR EACH ROW EXECUTE FUNCTION "namo"."enforce_company"();
--> statement-breakpoint
CREATE TRIGGER namo_company_consistency BEFORE INSERT OR UPDATE OF "purchaseBillId" ON public."PurchaseBillImportDetail" FOR EACH ROW EXECUTE FUNCTION "namo"."enforce_company"();
