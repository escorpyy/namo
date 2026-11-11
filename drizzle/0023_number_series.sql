CREATE TABLE "NumberCounter" (
	"id" serial PRIMARY KEY NOT NULL,
	"seriesId" integer NOT NULL,
	"branchId" integer DEFAULT 0 NOT NULL,
	"fiscalYear" varchar(15) DEFAULT '' NOT NULL,
	"lastNumber" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "NumberSeries" (
	"id" serial PRIMARY KEY NOT NULL,
	"companyId" integer NOT NULL,
	"documentType" varchar(30) NOT NULL,
	"name" varchar(60) NOT NULL,
	"prefix" varchar(20) DEFAULT '' NOT NULL,
	"suffix" varchar(20) DEFAULT '' NOT NULL,
	"padding" integer DEFAULT 4 NOT NULL,
	"startNumber" integer DEFAULT 1 NOT NULL,
	"endNumber" integer,
	"increment" integer DEFAULT 1 NOT NULL,
	"mode" varchar(10) DEFAULT 'AUTOMATIC' NOT NULL,
	"assignAt" varchar(5) DEFAULT 'DRAFT' NOT NULL,
	"resetPerFy" boolean DEFAULT true NOT NULL,
	"perBranch" boolean DEFAULT true NOT NULL,
	"isDefault" boolean DEFAULT false NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"allUsers" boolean DEFAULT true NOT NULL,
	"allBranches" boolean DEFAULT true NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"updatedBy" integer,
	CONSTRAINT "NumberSeries_mode_check" CHECK ("NumberSeries"."mode" IN ('AUTOMATIC', 'SUGGESTED', 'MANUAL')),
	CONSTRAINT "NumberSeries_assignAt_check" CHECK ("NumberSeries"."assignAt" IN ('DRAFT', 'POST')),
	CONSTRAINT "NumberSeries_range_check" CHECK ("NumberSeries"."padding" BETWEEN 1 AND 10 AND "NumberSeries"."startNumber" >= 0 AND "NumberSeries"."increment" BETWEEN 1 AND 1000 AND ("NumberSeries"."endNumber" IS NULL OR "NumberSeries"."endNumber" >= "NumberSeries"."startNumber"))
);
--> statement-breakpoint
CREATE TABLE "NumberSeriesBranch" (
	"id" serial PRIMARY KEY NOT NULL,
	"seriesId" integer NOT NULL,
	"branchId" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "NumberSeriesUser" (
	"id" serial PRIMARY KEY NOT NULL,
	"seriesId" integer NOT NULL,
	"userId" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "PurchaseOrder" ADD COLUMN "numberSeriesId" integer;--> statement-breakpoint
ALTER TABLE "PurchaseChallan" ADD COLUMN "numberSeriesId" integer;--> statement-breakpoint
ALTER TABLE "PurchaseBill" ADD COLUMN "numberSeriesId" integer;--> statement-breakpoint
ALTER TABLE "NumberCounter" ADD CONSTRAINT "NumberCounter_seriesId_NumberSeries_id_fk" FOREIGN KEY ("seriesId") REFERENCES "public"."NumberSeries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "NumberSeries" ADD CONSTRAINT "NumberSeries_companyId_Company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "NumberSeries" ADD CONSTRAINT "NumberSeries_updatedBy_User_id_fk" FOREIGN KEY ("updatedBy") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "NumberSeriesBranch" ADD CONSTRAINT "NumberSeriesBranch_seriesId_NumberSeries_id_fk" FOREIGN KEY ("seriesId") REFERENCES "public"."NumberSeries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "NumberSeriesBranch" ADD CONSTRAINT "NumberSeriesBranch_branchId_Branch_id_fk" FOREIGN KEY ("branchId") REFERENCES "public"."Branch"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "NumberSeriesUser" ADD CONSTRAINT "NumberSeriesUser_seriesId_NumberSeries_id_fk" FOREIGN KEY ("seriesId") REFERENCES "public"."NumberSeries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "NumberSeriesUser" ADD CONSTRAINT "NumberSeriesUser_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "NumberCounter_seriesId_branchId_fiscalYear_key" ON "NumberCounter" USING btree ("seriesId","branchId","fiscalYear");--> statement-breakpoint
CREATE UNIQUE INDEX "NumberSeries_companyId_documentType_name_key" ON "NumberSeries" USING btree ("companyId","documentType","name");--> statement-breakpoint
CREATE UNIQUE INDEX "NumberSeries_default_key" ON "NumberSeries" USING btree ("companyId","documentType") WHERE "NumberSeries"."isDefault";--> statement-breakpoint
CREATE INDEX "NumberSeries_companyId_idx" ON "NumberSeries" USING btree ("companyId");--> statement-breakpoint
CREATE UNIQUE INDEX "NumberSeriesBranch_seriesId_branchId_key" ON "NumberSeriesBranch" USING btree ("seriesId","branchId");--> statement-breakpoint
CREATE UNIQUE INDEX "NumberSeriesUser_seriesId_userId_key" ON "NumberSeriesUser" USING btree ("seriesId","userId");--> statement-breakpoint
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_numberSeriesId_NumberSeries_id_fk" FOREIGN KEY ("numberSeriesId") REFERENCES "public"."NumberSeries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseChallan" ADD CONSTRAINT "PurchaseChallan_numberSeriesId_NumberSeries_id_fk" FOREIGN KEY ("numberSeriesId") REFERENCES "public"."NumberSeries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseBill" ADD CONSTRAINT "PurchaseBill_numberSeriesId_NumberSeries_id_fk" FOREIGN KEY ("numberSeriesId") REFERENCES "public"."NumberSeries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Tenant registry: a series carries its company; its users, branches and counters get it from the series.
INSERT INTO "namo"."company_source" (tbl, ord, via_col, via_tbl) VALUES
  ('NumberSeries', 1, NULL, NULL),
  ('NumberSeriesUser', 1, 'seriesId', 'NumberSeries'),
  ('NumberSeriesBranch', 1, 'seriesId', 'NumberSeries'),
  ('NumberCounter', 1, 'seriesId', 'NumberSeries');
--> statement-breakpoint
INSERT INTO "namo"."company_link" (tbl, col, link_tbl) VALUES
  ('NumberSeriesBranch', 'branchId', 'Branch'),
  ('PurchaseOrder', 'numberSeriesId', 'NumberSeries'),
  ('PurchaseChallan', 'numberSeriesId', 'NumberSeries'),
  ('PurchaseBill', 'numberSeriesId', 'NumberSeries');
--> statement-breakpoint
-- Rebuild the consistency trigger of every table the registry touches here (same rule as migration 0002).
DO $$
DECLARE r record; cols text;
BEGIN
  FOR r IN SELECT unnest(ARRAY['NumberSeries','NumberSeriesUser','NumberSeriesBranch','NumberCounter','PurchaseOrder','PurchaseChallan','PurchaseBill']) AS t LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS namo_company_consistency ON public.%I', r.t);
    SELECT string_agg(DISTINCT quote_ident(c), ', ') INTO cols FROM (
      SELECT 'companyId'::text AS c FROM "namo"."company_source" WHERE tbl = r.t AND via_col IS NULL
      UNION SELECT via_col FROM "namo"."company_source" WHERE tbl = r.t AND via_col IS NOT NULL
      UNION SELECT col FROM "namo"."company_link" WHERE tbl = r.t
    ) q;
    EXECUTE format('CREATE TRIGGER namo_company_consistency BEFORE INSERT OR UPDATE OF %s ON public.%I FOR EACH ROW EXECUTE FUNCTION "namo"."enforce_company"()', cols, r.t);
  END LOOP;
END $$;
