-- ERP-024 (part 2): a reason is REQUIRED to edit or delete a posted document (owner answer 1 in decision S9, recorded as S11).
--
-- Rule, enforced by the database: an UPDATE or DELETE of a row that belongs to a POSTED document is refused unless the
-- per-transaction setting namo.change_reason holds a non-blank text. New child rows added to a posted document are refused
-- too, except when service code scopes namo.initial_posted_child_table + namo.initial_posted_child_parent_id to the exact
-- child table and parent being created. That is the same text migration 0008's audit trigger stores in AuditLog."reason",
-- so the log always says why. Application code sets it with setAuditContext({ reason }).
--
-- Posted documents and their rows (a child is "posted" when its parent is):
--   JournalVoucher (isPosted) + JournalVoucherLine, CashBankVoucher (isPosted) + CashBankVoucherLine,
--   PurchaseBill (isPosted) + PurchaseBillLine + PurchaseBillImportDetail,
--   PurchaseDocumentTerm (documentType = PURCHASE_BILL, bill isPosted) + PurchaseDocumentTermAllocation (via its term).
-- Never gated:
--   * drafts, and the moment of posting itself (a header was not posted before the statement);
--   * child rows created by a service inside the explicit table-and-parent initial-posting scope;
--   * an UPDATE that changes nothing;
--   * by deliberate policy, any UPDATE of a PurchaseBillLine that changes only allocatedTermAmount, landedAmount and landedRate
--     is exempt, regardless of caller. This supports landed-cost recalculation but is not a system-only permission;
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
  old_j  jsonb;
  new_j  jsonb;
  old_posted boolean := false;
  new_posted boolean := false;
  new_parent_created boolean := false;
  new_parent_id text := null;
  header_table boolean := TG_TABLE_NAME IN ('JournalVoucher', 'CashBankVoucher', 'PurchaseBill');
  why text := nullif(btrim(coalesce(current_setting('namo.change_reason', true), '')), '');
  need_reason boolean := false;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_j := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN new_j := to_jsonb(NEW); END IF;

  -- An UPDATE that changes nothing is not a change.
  IF TG_OP = 'UPDATE' AND old_j = new_j THEN RETURN NEW; END IF;

  -- Landed cost is recalculated by the system on posted bill lines; that alone never needs a reason.
  -- A change to the parent key is not covered by this exception because it remains in both JSON values.
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'PurchaseBillLine'
     AND (new_j - ARRAY['allocatedTermAmount', 'landedAmount', 'landedRate'])
       = (old_j - ARRAY['allocatedTermAmount', 'landedAmount', 'landedRate']) THEN
    RETURN NEW;
  END IF;

  -- Resolve the old and new parent states separately. On UPDATE, either membership in a posted document is enough
  -- to require a reason; this prevents moving a draft row into a posted document as a way around the guard.
  -- A missing old parent on DELETE is the ON DELETE CASCADE case: the parent's own DELETE was already gated.
  IF header_table THEN
    IF old_j IS NOT NULL THEN old_posted := coalesce((old_j ->> 'isPosted')::boolean, false); END IF;
    IF new_j IS NOT NULL THEN new_posted := coalesce((new_j ->> 'isPosted')::boolean, false); END IF;
  ELSIF TG_TABLE_NAME = 'JournalVoucherLine' THEN
    IF old_j IS NOT NULL THEN
      SELECT coalesce(v."isPosted", false) INTO old_posted FROM public."JournalVoucher" v WHERE v.id = (old_j ->> 'journalVoucherId')::integer;
      old_posted := coalesce(old_posted, false);
    END IF;
    IF new_j IS NOT NULL THEN
      SELECT coalesce(v."isPosted", false) INTO new_posted
        FROM public."JournalVoucher" v WHERE v.id = (new_j ->> 'journalVoucherId')::integer;
      new_posted := coalesce(new_posted, false);
      new_parent_id := new_j ->> 'journalVoucherId';
    END IF;
  ELSIF TG_TABLE_NAME = 'CashBankVoucherLine' THEN
    IF old_j IS NOT NULL THEN
      SELECT coalesce(v."isPosted", false) INTO old_posted FROM public."CashBankVoucher" v WHERE v.id = (old_j ->> 'cashBankVoucherId')::integer;
      old_posted := coalesce(old_posted, false);
    END IF;
    IF new_j IS NOT NULL THEN
      SELECT coalesce(v."isPosted", false) INTO new_posted
        FROM public."CashBankVoucher" v WHERE v.id = (new_j ->> 'cashBankVoucherId')::integer;
      new_posted := coalesce(new_posted, false);
      new_parent_id := new_j ->> 'cashBankVoucherId';
    END IF;
  ELSIF TG_TABLE_NAME IN ('PurchaseBillLine', 'PurchaseBillImportDetail') THEN
    IF old_j IS NOT NULL THEN
      SELECT coalesce(b."isPosted", false) INTO old_posted FROM public."PurchaseBill" b WHERE b.id = (old_j ->> 'purchaseBillId')::integer;
      old_posted := coalesce(old_posted, false);
    END IF;
    IF new_j IS NOT NULL THEN
      SELECT coalesce(b."isPosted", false) INTO new_posted
        FROM public."PurchaseBill" b WHERE b.id = (new_j ->> 'purchaseBillId')::integer;
      new_posted := coalesce(new_posted, false);
      new_parent_id := new_j ->> 'purchaseBillId';
    END IF;
  ELSIF TG_TABLE_NAME = 'PurchaseDocumentTerm' THEN
    IF old_j IS NOT NULL AND old_j ->> 'documentType' = 'PURCHASE_BILL' THEN
      SELECT coalesce(b."isPosted", false) INTO old_posted FROM public."PurchaseBill" b WHERE b.id = (old_j ->> 'documentId')::integer;
      old_posted := coalesce(old_posted, false);
    END IF;
    IF new_j IS NOT NULL AND new_j ->> 'documentType' = 'PURCHASE_BILL' THEN
      SELECT coalesce(b."isPosted", false) INTO new_posted
        FROM public."PurchaseBill" b WHERE b.id = (new_j ->> 'documentId')::integer;
      new_posted := coalesce(new_posted, false);
      new_parent_id := new_j ->> 'documentId';
    END IF;
  ELSIF TG_TABLE_NAME = 'PurchaseDocumentTermAllocation' THEN
    IF old_j IS NOT NULL THEN
      SELECT coalesce(b."isPosted", false) INTO old_posted
        FROM public."PurchaseDocumentTerm" t JOIN public."PurchaseBill" b ON b.id = t."documentId"
       WHERE t.id = (old_j ->> 'documentTermId')::integer AND t."documentType" = 'PURCHASE_BILL';
      old_posted := coalesce(old_posted, false);
    END IF;
    IF new_j IS NOT NULL THEN
      SELECT coalesce(b."isPosted", false) INTO new_posted
        FROM public."PurchaseDocumentTerm" t JOIN public."PurchaseBill" b ON b.id = t."documentId"
       WHERE t.id = (new_j ->> 'documentTermId')::integer AND t."documentType" = 'PURCHASE_BILL';
      new_posted := coalesce(new_posted, false);
      new_parent_id := new_j ->> 'documentTermId';
    END IF;
  ELSE
    RAISE EXCEPTION 'namo.require_change_reason is not set up for table %', TG_TABLE_NAME;
  END IF;

  IF NOT header_table AND new_j IS NOT NULL THEN
    new_parent_created :=
      coalesce(current_setting('namo.initial_posted_child_table', true), '') = TG_TABLE_NAME
      AND coalesce(current_setting('namo.initial_posted_child_parent_id', true), '') = coalesce(new_parent_id, '');
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Service code scopes this to the exact child table and just-created parent while initial posting copies/creates rows.
    -- Later inserts into that already-existing document need a reason.
    need_reason := NOT header_table AND new_posted AND NOT new_parent_created;
  ELSIF TG_OP = 'DELETE' THEN
    need_reason := old_posted;
  ELSIF header_table THEN
    -- The header's own draft -> posted transition is the posting action, not a later edit.
    need_reason := old_posted;
  ELSE
    need_reason := old_posted OR new_posted;
  END IF;

  IF need_reason AND why IS NULL THEN
    RAISE EXCEPTION 'A posted document cannot be % without a reason (% #%). Enter why it is being changed, then save again.',
      CASE TG_OP WHEN 'DELETE' THEN 'deleted' WHEN 'INSERT' THEN 'added to' ELSE 'changed' END,
      TG_TABLE_NAME,
      CASE WHEN TG_OP = 'INSERT' THEN new_j ->> 'id' ELSE old_j ->> 'id' END
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
    EXECUTE format('CREATE TRIGGER "Audit_reason" BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION "namo"."require_change_reason"()', t);
  END LOOP;
END
$$;
