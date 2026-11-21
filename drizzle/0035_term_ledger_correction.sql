CREATE TABLE "TermLedgerCorrection" (
	"id" serial PRIMARY KEY NOT NULL,
	"companyId" integer NOT NULL,
	"journalVoucherId" integer NOT NULL,
	"documentType" varchar(20) NOT NULL,
	"documentId" integer NOT NULL,
	"documentTermId" integer NOT NULL,
	"fromLedgerId" integer NOT NULL,
	"toLedgerId" integer NOT NULL,
	"side" varchar(2) NOT NULL,
	"amount" numeric(18, 6) NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "TermLedgerCorrection_type_check" CHECK ("TermLedgerCorrection"."documentType" IN ('PURCHASE_BILL', 'SALES_INVOICE')),
	CONSTRAINT "TermLedgerCorrection_side_check" CHECK ("TermLedgerCorrection"."side" IN ('DR', 'CR')),
	CONSTRAINT "TermLedgerCorrection_amount_check" CHECK ("TermLedgerCorrection"."amount" > 0),
	CONSTRAINT "TermLedgerCorrection_ledgers_check" CHECK ("TermLedgerCorrection"."fromLedgerId" <> "TermLedgerCorrection"."toLedgerId")
);
--> statement-breakpoint
ALTER TABLE "TermLedgerCorrection" ADD CONSTRAINT "TermLedgerCorrection_companyId_Company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "TermLedgerCorrection" ADD CONSTRAINT "TermLedgerCorrection_journalVoucherId_JournalVoucher_id_fk" FOREIGN KEY ("journalVoucherId") REFERENCES "public"."JournalVoucher"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "TermLedgerCorrection" ADD CONSTRAINT "TermLedgerCorrection_fromLedgerId_GeneralLedger_id_fk" FOREIGN KEY ("fromLedgerId") REFERENCES "public"."GeneralLedger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "TermLedgerCorrection" ADD CONSTRAINT "TermLedgerCorrection_toLedgerId_GeneralLedger_id_fk" FOREIGN KEY ("toLedgerId") REFERENCES "public"."GeneralLedger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "TermLedgerCorrection_companyId_idx" ON "TermLedgerCorrection" USING btree ("companyId");--> statement-breakpoint
CREATE INDEX "TermLedgerCorrection_journalVoucherId_idx" ON "TermLedgerCorrection" USING btree ("journalVoucherId");--> statement-breakpoint
CREATE INDEX "TermLedgerCorrection_document_idx" ON "TermLedgerCorrection" USING btree ("documentType","documentId");--> statement-breakpoint
CREATE INDEX "TermLedgerCorrection_term_idx" ON "TermLedgerCorrection" USING btree ("documentType","documentTermId");
--> statement-breakpoint
-- Same company as everything it points at, in the audit trail, and never edited: a correction is undone by reversing the document (or by
-- another correction), not by changing this row.
INSERT INTO "namo"."company_source" (tbl, ord, via_col, via_tbl) VALUES ('TermLedgerCorrection', 1, NULL, NULL);
--> statement-breakpoint
INSERT INTO "namo"."company_link" (tbl, col, link_tbl) VALUES
  ('TermLedgerCorrection', 'journalVoucherId', 'JournalVoucher'),
  ('TermLedgerCorrection', 'fromLedgerId', 'GeneralLedger'),
  ('TermLedgerCorrection', 'toLedgerId', 'GeneralLedger');
--> statement-breakpoint
CREATE TRIGGER namo_company_consistency BEFORE INSERT OR UPDATE OF "companyId", "journalVoucherId", "fromLedgerId", "toLedgerId" ON public."TermLedgerCorrection" FOR EACH ROW EXECUTE FUNCTION "namo"."enforce_company"();
--> statement-breakpoint
CREATE TRIGGER "Audit_trail" AFTER INSERT OR UPDATE OR DELETE ON public."TermLedgerCorrection" FOR EACH ROW EXECUTE FUNCTION "namo"."audit_row"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "namo"."term_ledger_correction_guard"() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  RAISE EXCEPTION 'A term ledger correction cannot be edited or deleted (TermLedgerCorrection #%).', OLD.id USING ERRCODE = 'check_violation';
END
$fn$;
--> statement-breakpoint
CREATE TRIGGER "TermLedgerCorrection_guard" BEFORE UPDATE OR DELETE ON public."TermLedgerCorrection" FOR EACH ROW EXECUTE FUNCTION "namo"."term_ledger_correction_guard"();
