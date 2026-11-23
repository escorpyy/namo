CREATE TABLE "SalesChallan" (
  "id" serial PRIMARY KEY NOT NULL,
  "companyId" integer NOT NULL REFERENCES "Company"("id") ON DELETE restrict,
  "branchId" integer NOT NULL REFERENCES "Branch"("id") ON DELETE restrict,
  "challanNumber" varchar(30) NOT NULL,
  "numberSeriesId" integer REFERENCES "NumberSeries"("id") ON DELETE set null,
  "challanDate" date NOT NULL,
  "fiscalYear" varchar(15) NOT NULL,
  "customerGLId" integer NOT NULL REFERENCES "GeneralLedger"("id") ON DELETE restrict,
  "subLedgerId" integer REFERENCES "SubLedger"("id") ON DELETE restrict,
  "agentId" integer REFERENCES "Agent"("id") ON DELETE set null,
  "transporterName" varchar(100),
  "vehicleNo" varchar(30),
  "lrNo" varchar(30),
  "lrDate" date,
  "remarks" varchar(1024),
  "isConfirmed" boolean DEFAULT false NOT NULL,
  "confirmedAt" timestamp(3),
  "confirmedBy" integer REFERENCES "User"("id") ON DELETE set null,
  "createdBy" integer REFERENCES "User"("id") ON DELETE set null,
  "createdAt" timestamp(3) DEFAULT now() NOT NULL,
  "updatedAt" timestamp(3) DEFAULT now() NOT NULL,
  CONSTRAINT "SalesChallan_confirmed_check" CHECK (NOT "isConfirmed" OR "confirmedAt" IS NOT NULL)
);--> statement-breakpoint
CREATE UNIQUE INDEX "SalesChallan_branchId_fiscalYear_challanNumber_key" ON "SalesChallan" USING btree ("branchId","fiscalYear","challanNumber");--> statement-breakpoint
CREATE INDEX "SalesChallan_companyId_idx" ON "SalesChallan" USING btree ("companyId");--> statement-breakpoint
CREATE INDEX "SalesChallan_branchId_idx" ON "SalesChallan" USING btree ("branchId");--> statement-breakpoint
CREATE INDEX "SalesChallan_customerGLId_idx" ON "SalesChallan" USING btree ("customerGLId");--> statement-breakpoint
CREATE INDEX "SalesChallan_subLedgerId_idx" ON "SalesChallan" USING btree ("subLedgerId");--> statement-breakpoint
CREATE INDEX "SalesChallan_agentId_idx" ON "SalesChallan" USING btree ("agentId");--> statement-breakpoint
CREATE INDEX "SalesChallan_fiscalYear_idx" ON "SalesChallan" USING btree ("fiscalYear");--> statement-breakpoint
CREATE INDEX "SalesChallan_challanDate_idx" ON "SalesChallan" USING btree ("challanDate");--> statement-breakpoint
CREATE TABLE "SalesChallanLine" (
  "id" serial PRIMARY KEY NOT NULL,
  "salesChallanId" integer NOT NULL REFERENCES "SalesChallan"("id") ON DELETE cascade,
  "lineNumber" integer NOT NULL,
  "productId" integer NOT NULL REFERENCES "Product"("id") ON DELETE restrict,
  "altQty" numeric(18,6),
  "altUnitId" integer REFERENCES "ProductUnit"("id") ON DELETE restrict,
  "qty" numeric(18,6) NOT NULL,
  "unitId" integer NOT NULL REFERENCES "ProductUnit"("id") ON DELETE restrict,
  "rate" numeric(18,6) DEFAULT '0' NOT NULL,
  "basicAmount" numeric(18,6) DEFAULT '0' NOT NULL,
  "locationId" integer REFERENCES "Location"("id") ON DELETE restrict,
  "batchNo" varchar(50),
  "expiryDate" date,
  "createdAt" timestamp(3) DEFAULT now() NOT NULL,
  CONSTRAINT "SalesChallanLine_lineNumber_check" CHECK ("lineNumber" > 0),
  CONSTRAINT "SalesChallanLine_amounts_check" CHECK ("qty" > 0 AND "rate" >= 0 AND "basicAmount" >= 0),
  CONSTRAINT "SalesChallanLine_alt_pair_check" CHECK (("altQty" IS NULL) = ("altUnitId" IS NULL))
);--> statement-breakpoint
CREATE UNIQUE INDEX "SalesChallanLine_salesChallanId_lineNumber_key" ON "SalesChallanLine" USING btree ("salesChallanId","lineNumber");--> statement-breakpoint
CREATE INDEX "SalesChallanLine_productId_idx" ON "SalesChallanLine" USING btree ("productId");--> statement-breakpoint
CREATE INDEX "SalesChallanLine_altUnitId_idx" ON "SalesChallanLine" USING btree ("altUnitId");--> statement-breakpoint
CREATE INDEX "SalesChallanLine_unitId_idx" ON "SalesChallanLine" USING btree ("unitId");--> statement-breakpoint
CREATE INDEX "SalesChallanLine_locationId_idx" ON "SalesChallanLine" USING btree ("locationId");--> statement-breakpoint
ALTER TABLE "SalesInvoice" ADD COLUMN "salesChallanId" integer REFERENCES "SalesChallan"("id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "SalesInvoiceLine" ADD COLUMN "challanLineId" integer REFERENCES "SalesChallanLine"("id") ON DELETE restrict;--> statement-breakpoint
CREATE INDEX "SalesInvoice_salesChallanId_idx" ON "SalesInvoice" USING btree ("salesChallanId");--> statement-breakpoint
CREATE INDEX "SalesInvoiceLine_challanLineId_idx" ON "SalesInvoiceLine" USING btree ("challanLineId");--> statement-breakpoint
INSERT INTO "namo"."company_source" (tbl, ord, via_col, via_tbl) VALUES
  ('SalesChallan', 1, NULL, NULL),
  ('SalesChallanLine', 1, 'salesChallanId', 'SalesChallan');--> statement-breakpoint
INSERT INTO "namo"."company_link" (tbl, col, link_tbl) VALUES
  ('SalesChallan', 'branchId', 'Branch'),
  ('SalesChallan', 'numberSeriesId', 'NumberSeries'),
  ('SalesChallan', 'customerGLId', 'GeneralLedger'),
  ('SalesChallan', 'subLedgerId', 'SubLedger'),
  ('SalesChallan', 'agentId', 'Agent'),
  ('SalesChallanLine', 'productId', 'Product'),
  ('SalesChallanLine', 'altUnitId', 'ProductUnit'),
  ('SalesChallanLine', 'unitId', 'ProductUnit'),
  ('SalesChallanLine', 'locationId', 'Location'),
  ('SalesInvoice', 'salesChallanId', 'SalesChallan'),
  ('SalesInvoiceLine', 'challanLineId', 'SalesChallanLine');--> statement-breakpoint
DROP TRIGGER namo_company_consistency ON public."SalesInvoice";--> statement-breakpoint
CREATE TRIGGER namo_company_consistency BEFORE INSERT OR UPDATE OF "companyId", "branchId", "numberSeriesId", "customerGLId", "subLedgerId", "agentId", "reversalOfId", "journalVoucherId", "salesChallanId" ON public."SalesInvoice" FOR EACH ROW EXECUTE FUNCTION "namo"."enforce_company"();--> statement-breakpoint
DROP TRIGGER namo_company_consistency ON public."SalesInvoiceLine";--> statement-breakpoint
CREATE TRIGGER namo_company_consistency BEFORE INSERT OR UPDATE OF "salesInvoiceId", "productId", "altUnitId", "unitId", "locationId", "challanLineId" ON public."SalesInvoiceLine" FOR EACH ROW EXECUTE FUNCTION "namo"."enforce_company"();--> statement-breakpoint
CREATE TRIGGER namo_company_consistency BEFORE INSERT OR UPDATE OF "companyId", "branchId", "numberSeriesId", "customerGLId", "subLedgerId", "agentId" ON public."SalesChallan" FOR EACH ROW EXECUTE FUNCTION "namo"."enforce_company"();--> statement-breakpoint
CREATE TRIGGER namo_company_consistency BEFORE INSERT OR UPDATE OF "salesChallanId", "productId", "altUnitId", "unitId", "locationId" ON public."SalesChallanLine" FOR EACH ROW EXECUTE FUNCTION "namo"."enforce_company"();
