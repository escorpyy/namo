ALTER TABLE "BillSettlement" ALTER COLUMN "cashBankVoucherId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "BillSettlement" ADD COLUMN "journalVoucherId" integer;--> statement-breakpoint
ALTER TABLE "BillSettlement" ADD CONSTRAINT "BillSettlement_journalVoucherId_JournalVoucher_id_fk" FOREIGN KEY ("journalVoucherId") REFERENCES "public"."JournalVoucher"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "BillSettlement_journal_invoice_key" ON "BillSettlement" USING btree ("journalVoucherId","salesInvoiceId") WHERE "BillSettlement"."journalVoucherId" IS NOT NULL AND "BillSettlement"."salesInvoiceId" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "BillSettlement_journal_bill_key" ON "BillSettlement" USING btree ("journalVoucherId","purchaseBillId") WHERE "BillSettlement"."journalVoucherId" IS NOT NULL AND "BillSettlement"."purchaseBillId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "BillSettlement_journalVoucherId_idx" ON "BillSettlement" USING btree ("journalVoucherId");--> statement-breakpoint
ALTER TABLE "BillSettlement" ADD CONSTRAINT "BillSettlement_one_source_check" CHECK (("BillSettlement"."cashBankVoucherId" IS NOT NULL)::int + ("BillSettlement"."journalVoucherId" IS NOT NULL)::int = 1);

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
    IF (p_row ->> 'cashBankVoucherId') IS NOT NULL THEN
      SELECT v."voucherDate" INTO d FROM public."CashBankVoucher" v WHERE v.id = (p_row ->> 'cashBankVoucherId')::integer;
    ELSE
      SELECT v."voucherDate" INTO d FROM public."JournalVoucher" v WHERE v.id = (p_row ->> 'journalVoucherId')::integer;
    END IF;
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
--> statement-breakpoint
INSERT INTO "namo"."company_link" (tbl, col, link_tbl) VALUES ('BillSettlement', 'journalVoucherId', 'JournalVoucher');
--> statement-breakpoint
DROP TRIGGER namo_company_consistency ON public."BillSettlement";
--> statement-breakpoint
CREATE TRIGGER namo_company_consistency BEFORE INSERT OR UPDATE OF "companyId", "cashBankVoucherId", "journalVoucherId", "salesInvoiceId", "purchaseBillId" ON public."BillSettlement" FOR EACH ROW EXECUTE FUNCTION "namo"."enforce_company"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "namo"."bill_settlement_guard"() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE why text := nullif(btrim(coalesce(current_setting('namo.change_reason', true), '')), ''); v_posted boolean; d_posted boolean;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    IF OLD."cashBankVoucherId" IS NOT NULL THEN SELECT "isPosted" INTO v_posted FROM public."CashBankVoucher" WHERE id = OLD."cashBankVoucherId";
    ELSE SELECT "isPosted" INTO v_posted FROM public."JournalVoucher" WHERE id = OLD."journalVoucherId"; END IF;
    IF coalesce(v_posted, false) AND why IS NULL THEN
      RAISE EXCEPTION 'A reason is required to change the settlements of a posted voucher (BillSettlement #%).', OLD.id USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    IF NEW."cashBankVoucherId" IS NOT NULL THEN SELECT "isPosted" INTO v_posted FROM public."CashBankVoucher" WHERE id = NEW."cashBankVoucherId";
    ELSE SELECT "isPosted" INTO v_posted FROM public."JournalVoucher" WHERE id = NEW."journalVoucherId"; END IF;
    IF coalesce(v_posted, false) AND why IS NULL THEN
      RAISE EXCEPTION 'A reason is required to add settlements to a posted voucher (BillSettlement #%).', NEW.id USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."salesInvoiceId" IS NOT NULL THEN
      SELECT "isPosted" INTO d_posted FROM public."SalesInvoice" WHERE id = NEW."salesInvoiceId";
    ELSE
      SELECT "isPosted" INTO d_posted FROM public."PurchaseBill" WHERE id = NEW."purchaseBillId";
    END IF;
    IF NOT coalesce(d_posted, false) THEN
      RAISE EXCEPTION 'Only a posted invoice or bill can be settled.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$fn$;
