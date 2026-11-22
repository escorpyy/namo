-- Term ledger correction by a separate voucher was replaced: changing a term's ledger in the master now moves the posted vouchers themselves.
DROP TABLE IF EXISTS public."TermLedgerCorrection";
--> statement-breakpoint
DROP FUNCTION IF EXISTS "namo"."term_ledger_correction_guard"();
--> statement-breakpoint
DELETE FROM "namo"."company_link" WHERE tbl = 'TermLedgerCorrection';
--> statement-breakpoint
DELETE FROM "namo"."company_source" WHERE tbl = 'TermLedgerCorrection';
