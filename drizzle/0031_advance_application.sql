CREATE TABLE "AdvanceApplication" (
	"id" serial PRIMARY KEY NOT NULL,
	"companyId" integer NOT NULL,
	"cashBankVoucherId" integer NOT NULL,
	"generalLedgerId" integer NOT NULL,
	"salesInvoiceId" integer,
	"purchaseBillId" integer,
	"amount" numeric(18, 6) NOT NULL,
	"appliedDate" date NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "AdvanceApplication_one_document_check" CHECK (("AdvanceApplication"."salesInvoiceId" IS NOT NULL)::int + ("AdvanceApplication"."purchaseBillId" IS NOT NULL)::int = 1),
	CONSTRAINT "AdvanceApplication_amount_check" CHECK ("AdvanceApplication"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "AdvanceApplication" ADD CONSTRAINT "AdvanceApplication_companyId_Company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "AdvanceApplication" ADD CONSTRAINT "AdvanceApplication_cashBankVoucherId_CashBankVoucher_id_fk" FOREIGN KEY ("cashBankVoucherId") REFERENCES "public"."CashBankVoucher"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "AdvanceApplication" ADD CONSTRAINT "AdvanceApplication_generalLedgerId_GeneralLedger_id_fk" FOREIGN KEY ("generalLedgerId") REFERENCES "public"."GeneralLedger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "AdvanceApplication" ADD CONSTRAINT "AdvanceApplication_salesInvoiceId_SalesInvoice_id_fk" FOREIGN KEY ("salesInvoiceId") REFERENCES "public"."SalesInvoice"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "AdvanceApplication" ADD CONSTRAINT "AdvanceApplication_purchaseBillId_PurchaseBill_id_fk" FOREIGN KEY ("purchaseBillId") REFERENCES "public"."PurchaseBill"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "AdvanceApplication_companyId_idx" ON "AdvanceApplication" USING btree ("companyId");--> statement-breakpoint
CREATE INDEX "AdvanceApplication_cashBankVoucherId_idx" ON "AdvanceApplication" USING btree ("cashBankVoucherId");--> statement-breakpoint
CREATE INDEX "AdvanceApplication_salesInvoiceId_idx" ON "AdvanceApplication" USING btree ("salesInvoiceId");--> statement-breakpoint
CREATE INDEX "AdvanceApplication_purchaseBillId_idx" ON "AdvanceApplication" USING btree ("purchaseBillId");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "namo"."document_date"(p_tbl text, p_row jsonb) RETURNS date
LANGUAGE plpgsql
AS $fn$
DECLARE d date;
BEGIN
  IF p_row IS NULL THEN RETURN NULL; END IF;
  IF p_tbl IN ('JournalVoucher', 'CashBankVoucher') THEN
    RETURN (p_row ->> 'voucherDate')::date;
  ELSIF p_tbl = 'PurchaseBill' THEN
    RETURN (p_row ->> 'invoiceDate')::date;
  ELSIF p_tbl = 'SalesInvoice' THEN
    RETURN (p_row ->> 'invoiceDate')::date;
  ELSIF p_tbl = 'JournalVoucherLine' THEN
    SELECT v."voucherDate" INTO d FROM public."JournalVoucher" v WHERE v.id = (p_row ->> 'journalVoucherId')::integer;
  ELSIF p_tbl = 'CashBankVoucherLine' THEN
    SELECT v."voucherDate" INTO d FROM public."CashBankVoucher" v WHERE v.id = (p_row ->> 'cashBankVoucherId')::integer;
  ELSIF p_tbl IN ('PurchaseBillLine', 'PurchaseBillImportDetail') THEN
    SELECT b."invoiceDate" INTO d FROM public."PurchaseBill" b WHERE b.id = (p_row ->> 'purchaseBillId')::integer;
  ELSIF p_tbl = 'AdvanceApplication' THEN
    d := (p_row ->> 'appliedDate')::date;
  ELSIF p_tbl = 'BillSettlement' THEN
    SELECT v."voucherDate" INTO d FROM public."CashBankVoucher" v WHERE v.id = (p_row ->> 'cashBankVoucherId')::integer;
  ELSIF p_tbl = 'SalesInvoiceLine' THEN
    SELECT i."invoiceDate" INTO d FROM public."SalesInvoice" i WHERE i.id = (p_row ->> 'salesInvoiceId')::integer;
  ELSIF p_tbl = 'PurchaseDocumentTerm' THEN
    IF p_row ->> 'documentType' = 'PURCHASE_BILL' THEN
      SELECT b."invoiceDate" INTO d FROM public."PurchaseBill" b WHERE b.id = (p_row ->> 'documentId')::integer;
    END IF;
  ELSIF p_tbl = 'SalesDocumentTerm' THEN
    IF p_row ->> 'documentType' = 'SALES_INVOICE' THEN
      SELECT i."invoiceDate" INTO d FROM public."SalesInvoice" i WHERE i.id = (p_row ->> 'documentId')::integer;
    END IF;
  ELSIF p_tbl = 'PurchaseDocumentTermAllocation' THEN
    SELECT b."invoiceDate" INTO d
      FROM public."PurchaseDocumentTerm" t JOIN public."PurchaseBill" b ON b.id = t."documentId"
     WHERE t.id = (p_row ->> 'documentTermId')::integer AND t."documentType" = 'PURCHASE_BILL';
  ELSIF p_tbl = 'PurchaseImportAssessment' THEN
    RETURN (p_row ->> 'assessmentDate')::date;
  ELSIF p_tbl IN ('PurchaseImportAssessmentTerm', 'PurchaseImportAssessmentAllocation', 'PurchaseImportAssessmentLine') THEN
    SELECT a."assessmentDate" INTO d FROM public."PurchaseImportAssessment" a WHERE a.id = (p_row ->> 'assessmentId')::integer;
  ELSE
    RAISE EXCEPTION 'namo.document_date is not set up for table %', p_tbl;
  END IF;
  RETURN d;
END
$fn$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "namo"."locked_by"(p_tbl text, p_old jsonb, p_new jsonb) RETURNS date
LANGUAGE plpgsql
AS $fn$
DECLARE co integer; ld date; d_old date; d_new date;
BEGIN
  IF p_tbl <> ALL (ARRAY['CashBankVoucher', 'CashBankVoucherLine', 'JournalVoucher', 'JournalVoucherLine',
                         'PurchaseBill', 'PurchaseBillImportDetail', 'PurchaseBillLine', 'PurchaseDocumentTerm', 'PurchaseDocumentTermAllocation',
                         'PurchaseImportAssessment', 'PurchaseImportAssessmentTerm', 'PurchaseImportAssessmentAllocation', 'PurchaseImportAssessmentLine',
                         'SalesInvoice', 'SalesInvoiceLine', 'SalesDocumentTerm', 'BillSettlement', 'AdvanceApplication']) THEN
    RETURN NULL;
  END IF;
  IF p_old IS NOT NULL AND p_new IS NOT NULL AND p_old = p_new THEN RETURN NULL; END IF;
  IF p_tbl = 'PurchaseBillLine' AND p_old IS NOT NULL AND p_new IS NOT NULL
     AND (p_new - ARRAY['allocatedTermAmount', 'landedAmount', 'landedRate'])
       = (p_old - ARRAY['allocatedTermAmount', 'landedAmount', 'landedRate']) THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM public."CompanyLock" WHERE "lockDate" IS NOT NULL) THEN RETURN NULL; END IF;
  co := "namo"."company_of"(p_tbl, coalesce(p_new, p_old));
  IF co IS NULL THEN RETURN NULL; END IF;
  SELECT l."lockDate" INTO ld FROM public."CompanyLock" l WHERE l."companyId" = co;
  IF ld IS NULL THEN RETURN NULL; END IF;
  d_old := "namo"."document_date"(p_tbl, p_old);
  d_new := "namo"."document_date"(p_tbl, p_new);
  IF (d_old IS NOT NULL AND d_old <= ld) OR (d_new IS NOT NULL AND d_new <= ld) THEN RETURN ld; END IF;
  RETURN NULL;
END
$fn$;
--> statement-breakpoint
DO $$
BEGIN
  EXECUTE 'CREATE TRIGGER "Audit_lock" BEFORE INSERT OR UPDATE OR DELETE ON public."AdvanceApplication" FOR EACH ROW EXECUTE FUNCTION "namo"."enforce_lock_date"()';
  EXECUTE 'CREATE TRIGGER "Audit_trail" AFTER INSERT OR UPDATE OR DELETE ON public."AdvanceApplication" FOR EACH ROW EXECUTE FUNCTION "namo"."audit_row"()';
END
$$;
--> statement-breakpoint
INSERT INTO "namo"."company_source" (tbl, ord, via_col, via_tbl) VALUES ('AdvanceApplication', 1, NULL, NULL);
--> statement-breakpoint
INSERT INTO "namo"."company_link" (tbl, col, link_tbl) VALUES
  ('AdvanceApplication', 'cashBankVoucherId', 'CashBankVoucher'),
  ('AdvanceApplication', 'generalLedgerId', 'GeneralLedger'),
  ('AdvanceApplication', 'salesInvoiceId', 'SalesInvoice'),
  ('AdvanceApplication', 'purchaseBillId', 'PurchaseBill');
--> statement-breakpoint
CREATE TRIGGER namo_company_consistency BEFORE INSERT OR UPDATE OF "companyId", "cashBankVoucherId", "generalLedgerId", "salesInvoiceId", "purchaseBillId" ON public."AdvanceApplication" FOR EACH ROW EXECUTE FUNCTION "namo"."enforce_company"();
--> statement-breakpoint
-- Applications are never edited. They may only be added against a posted receipt / payment and a posted document, and undone (deleted) with a reason.
CREATE FUNCTION "namo"."advance_application_guard"() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE v_posted boolean; d_posted boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'An advance application cannot be edited; undo it and apply again (AdvanceApplication #%).', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF nullif(btrim(coalesce(current_setting('namo.change_reason', true), '')), '') IS NULL THEN
      RAISE EXCEPTION 'A reason is required to undo an advance application (AdvanceApplication #%).', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  SELECT "isPosted" INTO v_posted FROM public."CashBankVoucher" WHERE id = NEW."cashBankVoucherId";
  IF NOT coalesce(v_posted, false) THEN
    RAISE EXCEPTION 'An advance can only come from a posted voucher.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."salesInvoiceId" IS NOT NULL THEN
    SELECT "isPosted" INTO d_posted FROM public."SalesInvoice" WHERE id = NEW."salesInvoiceId";
  ELSE
    SELECT "isPosted" INTO d_posted FROM public."PurchaseBill" WHERE id = NEW."purchaseBillId";
  END IF;
  IF NOT coalesce(d_posted, false) THEN
    RAISE EXCEPTION 'An advance can only be applied to a posted invoice or bill.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;
--> statement-breakpoint
CREATE TRIGGER "AdvanceApplication_guard" BEFORE INSERT OR UPDATE OR DELETE ON public."AdvanceApplication" FOR EACH ROW EXECUTE FUNCTION "namo"."advance_application_guard"();
