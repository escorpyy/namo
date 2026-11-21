-- The masters that decide WHERE an amount posts are now in the audit trail: a billing term's ledger, and a ledger or sub-group (its group
-- decides which side of the balance sheet it sits on). Until now changing "Trade Discount" from one ledger to another left no trace.
-- The same generic row trigger as every other audited table (migration 0008): old and new row, company, user, reason.
-- History starts here. Every one of these tables is already registered in namo.company_source (migration 0002).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['PurchaseTerm', 'SalesTerm', 'GeneralLedger', 'AccountSubGroup'] LOOP
    EXECUTE format('CREATE TRIGGER "Audit_trail" AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION "namo"."audit_row"()', t);
  END LOOP;
END
$$;
