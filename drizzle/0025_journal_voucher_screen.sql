ALTER TABLE "JournalVoucher" ADD COLUMN "numberSeriesId" integer;--> statement-breakpoint
ALTER TABLE "JournalVoucherLine" ADD COLUMN "subLedgerId" integer;--> statement-breakpoint
ALTER TABLE "JournalVoucher" ADD CONSTRAINT "JournalVoucher_numberSeriesId_NumberSeries_id_fk" FOREIGN KEY ("numberSeriesId") REFERENCES "public"."NumberSeries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "JournalVoucherLine" ADD CONSTRAINT "JournalVoucherLine_subLedgerId_SubLedger_id_fk" FOREIGN KEY ("subLedgerId") REFERENCES "public"."SubLedger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "JournalVoucherLine_subLedgerId_idx" ON "JournalVoucherLine" USING btree ("subLedgerId");--> statement-breakpoint
-- Tenant registry: a voucher's number series and a line's sub-ledger must belong to the voucher's company.
INSERT INTO "namo"."company_link" (tbl, col, link_tbl) VALUES
  ('JournalVoucher', 'numberSeriesId', 'NumberSeries'),
  ('JournalVoucherLine', 'subLedgerId', 'SubLedger');
--> statement-breakpoint
-- Rebuild the consistency trigger of the two tables (same rule as migration 0002).
DO $$
DECLARE r record; cols text;
BEGIN
  FOR r IN SELECT unnest(ARRAY['JournalVoucher','JournalVoucherLine']) AS t LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS namo_company_consistency ON public.%I', r.t);
    SELECT string_agg(DISTINCT quote_ident(c), ', ') INTO cols FROM (
      SELECT 'companyId'::text AS c FROM "namo"."company_source" WHERE tbl = r.t AND via_col IS NULL
      UNION SELECT via_col FROM "namo"."company_source" WHERE tbl = r.t AND via_col IS NOT NULL
      UNION SELECT col FROM "namo"."company_link" WHERE tbl = r.t
    ) q;
    EXECUTE format('CREATE TRIGGER namo_company_consistency BEFORE INSERT OR UPDATE OF %s ON public.%I FOR EACH ROW EXECUTE FUNCTION "namo"."enforce_company"()', cols, r.t);
  END LOOP;
END $$;
