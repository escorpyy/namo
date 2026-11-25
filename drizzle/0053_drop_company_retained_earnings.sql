-- Company.retainedEarningsGLId was never used: the year-end close clears P&L into the GL Setup "Profit and Loss Account", and moving it on to
-- Reserves / Retained Earnings is a manual journal. The column, its link registry row and its guard trigger go.
DELETE FROM "namo"."company_link" WHERE tbl = 'Company' AND col = 'retainedEarningsGLId';
--> statement-breakpoint
DROP TRIGGER IF EXISTS namo_company_consistency ON public."Company";
--> statement-breakpoint
ALTER TABLE "Company" DROP CONSTRAINT IF EXISTS "Company_retainedEarningsGLId_GeneralLedger_id_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "Company_retainedEarningsGLId_key";
--> statement-breakpoint
ALTER TABLE "Company" DROP COLUMN IF EXISTS "retainedEarningsGLId";
