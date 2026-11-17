-- Register the new tables in the same company-consistency registry that guards every tenant foreign key.
INSERT INTO "namo"."company_source" (tbl, ord, via_col, via_tbl) VALUES
  ('SalesInvoice', 1, NULL, NULL),
  ('SalesInvoiceLine', 1, 'salesInvoiceId', 'SalesInvoice');
--> statement-breakpoint
INSERT INTO "namo"."company_link" (tbl, col, link_tbl) VALUES
  ('SalesInvoice', 'branchId', 'Branch'),
  ('SalesInvoice', 'numberSeriesId', 'NumberSeries'),
  ('SalesInvoice', 'customerGLId', 'GeneralLedger'),
  ('SalesInvoice', 'subLedgerId', 'SubLedger'),
  ('SalesInvoice', 'agentId', 'Agent'),
  ('SalesInvoice', 'reversalOfId', 'SalesInvoice'),
  ('SalesInvoice', 'journalVoucherId', 'JournalVoucher'),
  ('SalesInvoiceLine', 'productId', 'Product'),
  ('SalesInvoiceLine', 'altUnitId', 'ProductUnit'),
  ('SalesInvoiceLine', 'unitId', 'ProductUnit');
--> statement-breakpoint
CREATE TRIGGER namo_company_consistency BEFORE INSERT OR UPDATE OF "companyId", "branchId", "numberSeriesId", "customerGLId", "subLedgerId", "agentId", "reversalOfId", "journalVoucherId" ON public."SalesInvoice" FOR EACH ROW EXECUTE FUNCTION "namo"."enforce_company"();
--> statement-breakpoint
CREATE TRIGGER namo_company_consistency BEFORE INSERT OR UPDATE OF "salesInvoiceId", "productId", "altUnitId", "unitId" ON public."SalesInvoiceLine" FOR EACH ROW EXECUTE FUNCTION "namo"."enforce_company"();
--> statement-breakpoint
-- SalesDocumentTerm is polymorphic and has no invoice FK. When the type is SALES_INVOICE, bind both its header and optional line to the invoice.
CREATE FUNCTION "namo"."enforce_sales_invoice_term"() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE co integer; line_invoice integer;
BEGIN
  IF NEW."documentType" <> 'SALES_INVOICE' THEN RETURN NEW; END IF;
  SELECT i."companyId" INTO co FROM public."SalesInvoice" i WHERE i.id = NEW."documentId";
  IF co IS NULL THEN
    RAISE EXCEPTION 'Sales term references a missing SalesInvoice (#%).', NEW."documentId" USING ERRCODE = 'check_violation';
  END IF;
  IF co <> NEW."companyId" THEN
    RAISE EXCEPTION 'SalesDocumentTerm company does not match SalesInvoice (#%).', NEW."documentId" USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."documentLineId" IS NOT NULL THEN
    SELECT l."salesInvoiceId" INTO line_invoice FROM public."SalesInvoiceLine" l WHERE l.id = NEW."documentLineId";
    IF line_invoice IS NULL OR line_invoice <> NEW."documentId" THEN
      RAISE EXCEPTION 'Sales term line must belong to the referenced SalesInvoice (#%).', NEW."documentId" USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$fn$;
--> statement-breakpoint
CREATE TRIGGER "Sales_invoice_term_guard" BEFORE INSERT OR UPDATE OF "companyId", "documentType", "documentId", "documentLineId" ON public."SalesDocumentTerm" FOR EACH ROW EXECUTE FUNCTION "namo"."enforce_sales_invoice_term"();
--> statement-breakpoint
-- Extend the existing database audit row-date/lock helpers without changing their purchase behavior.
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
                         'SalesInvoice', 'SalesInvoiceLine', 'SalesDocumentTerm']) THEN
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
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['SalesInvoice', 'SalesInvoiceLine', 'SalesDocumentTerm'] LOOP
    EXECUTE format('CREATE TRIGGER "Audit_lock" BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION "namo"."enforce_lock_date"()', t);
    EXECUTE format('CREATE TRIGGER "Audit_trail" AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION "namo"."audit_row"()', t);
  END LOOP;
END
$$;
--> statement-breakpoint
-- Posted sales documents and all their children require a reason for subsequent changes. Initial draft entry and the draft->posted transition do not.
CREATE FUNCTION "namo"."sales_audit_reason"() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE old_j jsonb; new_j jsonb; why text := nullif(btrim(coalesce(current_setting('namo.change_reason', true), '')), '');
        old_posted boolean := false; new_posted boolean := false; need_reason boolean := false; parent_id integer;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_j := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN new_j := to_jsonb(NEW); END IF;
  IF TG_OP = 'UPDATE' AND old_j = new_j THEN RETURN NULL; END IF;
  IF TG_TABLE_NAME = 'SalesInvoice' THEN
    old_posted := coalesce((old_j ->> 'isPosted')::boolean, false);
    new_posted := coalesce((new_j ->> 'isPosted')::boolean, false);
    need_reason := old_posted OR (TG_OP = 'INSERT' AND new_posted);
  ELSIF TG_TABLE_NAME = 'SalesInvoiceLine' THEN
    IF old_j IS NOT NULL THEN
      SELECT i."isPosted" INTO old_posted FROM public."SalesInvoice" i WHERE i.id = (old_j ->> 'salesInvoiceId')::integer;
    END IF;
    IF new_j IS NOT NULL THEN
      SELECT i."isPosted" INTO new_posted FROM public."SalesInvoice" i WHERE i.id = (new_j ->> 'salesInvoiceId')::integer;
    END IF;
    need_reason := coalesce(old_posted, false) OR coalesce(new_posted, false);
  ELSIF TG_TABLE_NAME = 'SalesDocumentTerm' THEN
    IF old_j IS NOT NULL AND old_j ->> 'documentType' = 'SALES_INVOICE' THEN
      SELECT i."isPosted" INTO old_posted FROM public."SalesInvoice" i WHERE i.id = (old_j ->> 'documentId')::integer;
    END IF;
    IF new_j IS NOT NULL AND new_j ->> 'documentType' = 'SALES_INVOICE' THEN
      SELECT i."isPosted" INTO new_posted FROM public."SalesInvoice" i WHERE i.id = (new_j ->> 'documentId')::integer;
    END IF;
    need_reason := coalesce(old_posted, false) OR coalesce(new_posted, false);
  END IF;
  IF need_reason AND why IS NULL THEN
    RAISE EXCEPTION 'A reason is required to change a posted sales invoice or one of its lines/terms (% #%).', TG_TABLE_NAME, coalesce(new_j ->> 'id', old_j ->> 'id')
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$fn$;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['SalesInvoice', 'SalesInvoiceLine', 'SalesDocumentTerm'] LOOP
    EXECUTE format('CREATE TRIGGER "Sales_audit_reason" BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION "namo"."sales_audit_reason"()', t);
  END LOOP;
END
$$;
