-- ERP-024 (part 2): a reason is REQUIRED to edit or delete a posted document (owner answer 1 in decision S9, recorded as S11).
--
-- Rule, enforced by the database: an UPDATE or DELETE of a row that belongs to a POSTED document is refused unless the
-- per-transaction setting namo.change_reason holds a non-blank text. That is the same text migration 0008's audit trigger
-- stores in AuditLog."reason", so the log always says why. Application code sets it with setAuditContext({ reason }).
--
-- Posted documents and their rows (a child is "posted" when its parent is):
--   JournalVoucher (isPosted) + JournalVoucherLine, CashBankVoucher (isPosted) + CashBankVoucherLine,
--   PurchaseBill (isPosted) + PurchaseBillLine + PurchaseBillImportDetail,
--   PurchaseDocumentTerm (documentType = PURCHASE_BILL, bill isPosted) + PurchaseDocumentTermAllocation (via its term).
-- Never gated:
--   * drafts, and the moment of posting itself (the row was not posted before the statement);
--   * an UPDATE that changes nothing;
--   * an UPDATE of a PurchaseBillLine that touches only allocatedTermAmount, landedAmount and landedRate: that is the system
--     recalculating landed cost when an additional bill arrives or is reversed, not a person editing the bill;
--   * rows removed because their parent was deleted (the parent's own delete is the gated step);
--   * OpeningBalance (it has its own lock and the fiscal-year close), orders and challans (not accounting entries, S9).
-- Violations raise SQLSTATE 23514 with a message written for people; the API answers 409 (ERP-018, S8).
-- Nothing in the application edits or deletes a posted document today (the purchase service refuses; ERP-026 will add that path
-- and must pass a reason). Until then this rule only stops other code paths, manual SQL and mistakes.
-- Tests: tests/db.auditReason.test.ts.

CREATE FUNCTION "namo"."require_change_reason"() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  old_j  jsonb := to_jsonb(OLD);
  posted boolean := false;
  why    text := nullif(btrim(coalesce(current_setting('namo.change_reason', true), '')), '');
BEGIN
  -- An UPDATE that changes nothing is not a change.
  IF TG_OP = 'UPDATE' AND old_j = to_jsonb(NEW) THEN RETURN NEW; END IF;

  -- Landed cost is recalculated by the system on posted bill lines; that alone never needs a reason.
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'PurchaseBillLine'
     AND (to_jsonb(NEW) - ARRAY['allocatedTermAmount', 'landedAmount', 'landedRate'])
       = (old_j         - ARRAY['allocatedTermAmount', 'landedAmount', 'landedRate']) THEN
    RETURN NEW;
  END IF;

  -- Is the document this row belongs to posted? (A parent that is already gone, because it was deleted in the same
  -- statement, counts as not posted: the parent's own DELETE was the step that needed the reason.)
  IF TG_TABLE_NAME IN ('JournalVoucher', 'CashBankVoucher', 'PurchaseBill') THEN
    posted := coalesce((old_j ->> 'isPosted')::boolean, false);
  ELSIF TG_TABLE_NAME = 'JournalVoucherLine' THEN
    SELECT coalesce(v."isPosted", false) INTO posted FROM public."JournalVoucher" v WHERE v.id = (old_j ->> 'journalVoucherId')::integer;
  ELSIF TG_TABLE_NAME = 'CashBankVoucherLine' THEN
    SELECT coalesce(v."isPosted", false) INTO posted FROM public."CashBankVoucher" v WHERE v.id = (old_j ->> 'cashBankVoucherId')::integer;
  ELSIF TG_TABLE_NAME IN ('PurchaseBillLine', 'PurchaseBillImportDetail') THEN
    SELECT coalesce(b."isPosted", false) INTO posted FROM public."PurchaseBill" b WHERE b.id = (old_j ->> 'purchaseBillId')::integer;
  ELSIF TG_TABLE_NAME = 'PurchaseDocumentTerm' THEN
    IF old_j ->> 'documentType' = 'PURCHASE_BILL' THEN
      SELECT coalesce(b."isPosted", false) INTO posted FROM public."PurchaseBill" b WHERE b.id = (old_j ->> 'documentId')::integer;
    END IF;
  ELSIF TG_TABLE_NAME = 'PurchaseDocumentTermAllocation' THEN
    SELECT coalesce(b."isPosted", false) INTO posted
      FROM public."PurchaseDocumentTerm" t JOIN public."PurchaseBill" b ON b.id = t."documentId"
     WHERE t.id = (old_j ->> 'documentTermId')::integer AND t."documentType" = 'PURCHASE_BILL';
  ELSE
    RAISE EXCEPTION 'namo.require_change_reason is not set up for table %', TG_TABLE_NAME;
  END IF;

  IF coalesce(posted, false) AND why IS NULL THEN
    RAISE EXCEPTION 'A posted document cannot be % without a reason (% #%). Enter why it is being changed, then save again.',
      CASE TG_OP WHEN 'DELETE' THEN 'deleted' ELSE 'changed' END, TG_TABLE_NAME, old_j ->> 'id'
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
  FOREACH t IN ARRAY ARRAY[
    'CashBankVoucher', 'CashBankVoucherLine',
    'JournalVoucher', 'JournalVoucherLine',
    'PurchaseBill', 'PurchaseBillImportDetail', 'PurchaseBillLine',
    'PurchaseDocumentTerm', 'PurchaseDocumentTermAllocation'
  ] LOOP
    -- BEFORE: refuse before anything is written (and so before the audit row). The name sorts ahead of namo_company_consistency.
    EXECUTE format('CREATE TRIGGER "Audit_reason" BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION "namo"."require_change_reason"()', t);
  END LOOP;
END
$$;
