ALTER TABLE "CashBankVoucher" ADD COLUMN "cashBankLedgerId" integer;--> statement-breakpoint
ALTER TABLE "CashBankVoucher" ADD COLUMN "payeeReference" varchar(100);--> statement-breakpoint
ALTER TABLE "CashBankVoucherLine" ADD COLUMN "subLedgerId" integer;--> statement-breakpoint
ALTER TABLE "CashBankVoucherLine" ADD COLUMN "isCashBankLine" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "CashBankVoucher" ADD CONSTRAINT "CashBankVoucher_cashBankLedgerId_GeneralLedger_id_fk" FOREIGN KEY ("cashBankLedgerId") REFERENCES "public"."GeneralLedger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "CashBankVoucherLine" ADD CONSTRAINT "CashBankVoucherLine_subLedgerId_SubLedger_id_fk" FOREIGN KEY ("subLedgerId") REFERENCES "public"."SubLedger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "CashBankVoucher_cashBankLedgerId_idx" ON "CashBankVoucher" USING btree ("cashBankLedgerId");--> statement-breakpoint
CREATE INDEX "CashBankVoucherLine_subLedgerId_idx" ON "CashBankVoucherLine" USING btree ("subLedgerId");--> statement-breakpoint
-- ============================================================
-- Cash / Bank Voucher screen (ERP-006).
--   * the voucher header names the cash/bank ledger it is made through, plus a payee / reference
--   * a line may carry a sub-ledger, and says whether it is the cash/bank movement the service wrote (isCashBankLine) or a keyed entry
-- Dr = Cr per voucher stays enforced by the deferred trigger of migration 0007; nothing here changes it.
-- ============================================================

-- Company isolation for the two new links (S4: every new FK between tenant tables is registered; a test fails CI otherwise).
INSERT INTO "namo"."company_link" (tbl, col, link_tbl) VALUES
  ('CashBankVoucher', 'cashBankLedgerId', 'GeneralLedger'),
  ('CashBankVoucherLine', 'subLedgerId', 'SubLedger');
--> statement-breakpoint
-- Rebuild the consistency trigger of both tables from the registry (same rule as migrations 0002 and 0023).
DO $$
DECLARE r record; cols text;
BEGIN
  FOR r IN SELECT unnest(ARRAY['CashBankVoucher','CashBankVoucherLine']) AS t LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS namo_company_consistency ON public.%I', r.t);
    SELECT string_agg(DISTINCT quote_ident(c), ', ') INTO cols FROM (
      SELECT 'companyId'::text AS c FROM "namo"."company_source" WHERE tbl = r.t AND via_col IS NULL
      UNION SELECT via_col FROM "namo"."company_source" WHERE tbl = r.t AND via_col IS NOT NULL
      UNION SELECT col FROM "namo"."company_link" WHERE tbl = r.t
    ) q;
    EXECUTE format('CREATE TRIGGER namo_company_consistency BEFORE INSERT OR UPDATE OF %s ON public.%I FOR EACH ROW EXECUTE FUNCTION "namo"."enforce_company"()', cols, r.t);
  END LOOP;
END $$;
