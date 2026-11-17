CREATE TABLE "SalesInvoice" (
	"id" serial PRIMARY KEY NOT NULL,
	"companyId" integer NOT NULL,
	"branchId" integer NOT NULL,
	"documentType" "DocumentType" DEFAULT 'SALES_INVOICE' NOT NULL,
	"invoiceNumber" varchar(30) NOT NULL,
	"numberSeriesId" integer,
	"invoiceDate" date NOT NULL,
	"fiscalYear" varchar(15) NOT NULL,
	"customerGLId" integer NOT NULL,
	"subLedgerId" integer,
	"agentId" integer,
	"dueDays" integer DEFAULT 0 NOT NULL,
	"dueDate" date,
	"basicAmount" numeric(18, 6) DEFAULT '0' NOT NULL,
	"termAmount" numeric(18, 6) DEFAULT '0' NOT NULL,
	"totalAmount" numeric(18, 6) DEFAULT '0' NOT NULL,
	"remarks" varchar(1024),
	"reversalOfId" integer,
	"journalVoucherId" integer,
	"isPosted" boolean DEFAULT false NOT NULL,
	"postedAt" timestamp (3),
	"postedBy" integer,
	"createdBy" integer,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	CONSTRAINT "SalesInvoice_dueDays_check" CHECK ("SalesInvoice"."dueDays" >= 0),
	CONSTRAINT "SalesInvoice_not_own_reversal_check" CHECK ("SalesInvoice"."reversalOfId" IS NULL OR "SalesInvoice"."reversalOfId" <> "SalesInvoice"."id"),
	CONSTRAINT "SalesInvoice_documentType_check" CHECK ("SalesInvoice"."documentType" = 'SALES_INVOICE'),
	CONSTRAINT "SalesInvoice_posted_voucher_check" CHECK (NOT "SalesInvoice"."isPosted" OR "SalesInvoice"."journalVoucherId" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "SalesInvoiceLine" (
	"id" serial PRIMARY KEY NOT NULL,
	"salesInvoiceId" integer NOT NULL,
	"lineNumber" integer NOT NULL,
	"productId" integer NOT NULL,
	"altQty" numeric(18, 6),
	"altUnitId" integer,
	"qty" numeric(18, 6) NOT NULL,
	"unitId" integer NOT NULL,
	"rate" numeric(18, 6) NOT NULL,
	"basicAmount" numeric(18, 6) NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	CONSTRAINT "SalesInvoiceLine_lineNumber_check" CHECK ("SalesInvoiceLine"."lineNumber" > 0),
	CONSTRAINT "SalesInvoiceLine_amounts_check" CHECK ("SalesInvoiceLine"."qty" > 0 AND "SalesInvoiceLine"."rate" >= 0 AND "SalesInvoiceLine"."basicAmount" >= 0),
	CONSTRAINT "SalesInvoiceLine_alt_pair_check" CHECK (("SalesInvoiceLine"."altQty" IS NULL) = ("SalesInvoiceLine"."altUnitId" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "SalesInvoice" ADD CONSTRAINT "SalesInvoice_companyId_Company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SalesInvoice" ADD CONSTRAINT "SalesInvoice_branchId_Branch_id_fk" FOREIGN KEY ("branchId") REFERENCES "public"."Branch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SalesInvoice" ADD CONSTRAINT "SalesInvoice_numberSeriesId_NumberSeries_id_fk" FOREIGN KEY ("numberSeriesId") REFERENCES "public"."NumberSeries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SalesInvoice" ADD CONSTRAINT "SalesInvoice_customerGLId_GeneralLedger_id_fk" FOREIGN KEY ("customerGLId") REFERENCES "public"."GeneralLedger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SalesInvoice" ADD CONSTRAINT "SalesInvoice_subLedgerId_SubLedger_id_fk" FOREIGN KEY ("subLedgerId") REFERENCES "public"."SubLedger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SalesInvoice" ADD CONSTRAINT "SalesInvoice_agentId_Agent_id_fk" FOREIGN KEY ("agentId") REFERENCES "public"."Agent"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SalesInvoice" ADD CONSTRAINT "SalesInvoice_reversalOfId_SalesInvoice_id_fk" FOREIGN KEY ("reversalOfId") REFERENCES "public"."SalesInvoice"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SalesInvoice" ADD CONSTRAINT "SalesInvoice_journalVoucherId_JournalVoucher_id_fk" FOREIGN KEY ("journalVoucherId") REFERENCES "public"."JournalVoucher"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SalesInvoice" ADD CONSTRAINT "SalesInvoice_postedBy_User_id_fk" FOREIGN KEY ("postedBy") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SalesInvoice" ADD CONSTRAINT "SalesInvoice_createdBy_User_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SalesInvoiceLine" ADD CONSTRAINT "SalesInvoiceLine_salesInvoiceId_SalesInvoice_id_fk" FOREIGN KEY ("salesInvoiceId") REFERENCES "public"."SalesInvoice"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SalesInvoiceLine" ADD CONSTRAINT "SalesInvoiceLine_productId_Product_id_fk" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SalesInvoiceLine" ADD CONSTRAINT "SalesInvoiceLine_altUnitId_ProductUnit_id_fk" FOREIGN KEY ("altUnitId") REFERENCES "public"."ProductUnit"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SalesInvoiceLine" ADD CONSTRAINT "SalesInvoiceLine_unitId_ProductUnit_id_fk" FOREIGN KEY ("unitId") REFERENCES "public"."ProductUnit"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "SalesInvoice_branchId_fiscalYear_invoiceNumber_key" ON "SalesInvoice" USING btree ("branchId","fiscalYear","invoiceNumber");--> statement-breakpoint
CREATE UNIQUE INDEX "SalesInvoice_journalVoucherId_key" ON "SalesInvoice" USING btree ("journalVoucherId") WHERE "SalesInvoice"."journalVoucherId" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "SalesInvoice_posted_reversalOfId_key" ON "SalesInvoice" USING btree ("reversalOfId") WHERE "SalesInvoice"."reversalOfId" IS NOT NULL AND "SalesInvoice"."isPosted" = true;--> statement-breakpoint
CREATE INDEX "SalesInvoice_companyId_idx" ON "SalesInvoice" USING btree ("companyId");--> statement-breakpoint
CREATE INDEX "SalesInvoice_branchId_idx" ON "SalesInvoice" USING btree ("branchId");--> statement-breakpoint
CREATE INDEX "SalesInvoice_customerGLId_idx" ON "SalesInvoice" USING btree ("customerGLId");--> statement-breakpoint
CREATE INDEX "SalesInvoice_subLedgerId_idx" ON "SalesInvoice" USING btree ("subLedgerId");--> statement-breakpoint
CREATE INDEX "SalesInvoice_agentId_idx" ON "SalesInvoice" USING btree ("agentId");--> statement-breakpoint
CREATE INDEX "SalesInvoice_fiscalYear_idx" ON "SalesInvoice" USING btree ("fiscalYear");--> statement-breakpoint
CREATE INDEX "SalesInvoice_invoiceDate_idx" ON "SalesInvoice" USING btree ("invoiceDate");--> statement-breakpoint
CREATE UNIQUE INDEX "SalesInvoiceLine_invoice_lineNumber_key" ON "SalesInvoiceLine" USING btree ("salesInvoiceId","lineNumber");--> statement-breakpoint
CREATE INDEX "SalesInvoiceLine_productId_idx" ON "SalesInvoiceLine" USING btree ("productId");--> statement-breakpoint
CREATE INDEX "SalesInvoiceLine_unitId_idx" ON "SalesInvoiceLine" USING btree ("unitId");--> statement-breakpoint
CREATE INDEX "SalesInvoiceLine_altUnitId_idx" ON "SalesInvoiceLine" USING btree ("altUnitId");