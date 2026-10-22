-- ERP-016: enforce double-entry balance in PostgreSQL, not only in service code.
-- Draft vouchers may be incomplete/unbalanced. Once a voucher is posted, its final transaction state
-- must contain at least two lines, positive total value, and equal debit/credit totals.
-- Deferred constraint triggers allow header + all lines to be written in one transaction.

CREATE OR REPLACE FUNCTION public.enforce_posted_voucher_balance() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_id integer;
  v_posted boolean;
  v_debits numeric(38, 6);
  v_credits numeric(38, 6);
  v_count integer;
BEGIN
  IF TG_TABLE_NAME = 'JournalVoucher' THEN
    v_id := COALESCE(NEW.id, OLD.id);
  ELSIF TG_TABLE_NAME = 'CashBankVoucher' THEN
    v_id := COALESCE(NEW.id, OLD.id);
  ELSIF TG_TABLE_NAME = 'JournalVoucherLine' THEN
    v_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."journalVoucherId" ELSE NEW."journalVoucherId" END;
  ELSE
    v_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."cashBankVoucherId" ELSE NEW."cashBankVoucherId" END;
  END IF;

  IF TG_TABLE_NAME IN ('JournalVoucher', 'JournalVoucherLine') THEN
    SELECT "isPosted" INTO v_posted FROM public."JournalVoucher" WHERE id = v_id;
    IF NOT FOUND THEN RETURN NULL; END IF;
    IF NOT v_posted THEN RETURN NULL; END IF;
    SELECT COUNT(*), COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
      INTO v_count, v_debits, v_credits
      FROM public."JournalVoucherLine" WHERE "journalVoucherId" = v_id;
  ELSE
    SELECT "isPosted" INTO v_posted FROM public."CashBankVoucher" WHERE id = v_id;
    IF NOT FOUND THEN RETURN NULL; END IF;
    IF NOT v_posted THEN RETURN NULL; END IF;
    SELECT COUNT(*), COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
      INTO v_count, v_debits, v_credits
      FROM public."CashBankVoucherLine" WHERE "cashBankVoucherId" = v_id;
  END IF;

  IF v_count < 2 OR v_debits <= 0 OR v_debits <> v_credits THEN
    RAISE EXCEPTION 'Posted voucher % must have at least two lines and equal positive debit and credit totals (debit %, credit %, lines %)',
      v_id, v_debits, v_credits, v_count
      USING ERRCODE = '23514', CONSTRAINT = 'posted_voucher_balanced';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

-- Each line must represent one side only; negative amounts are not valid journal amounts.
ALTER TABLE public."JournalVoucherLine"
  ADD CONSTRAINT "JournalVoucherLine_nonnegative_one_side"
  CHECK (debit >= 0 AND credit >= 0 AND NOT (debit > 0 AND credit > 0));
--> statement-breakpoint
ALTER TABLE public."CashBankVoucherLine"
  ADD CONSTRAINT "CashBankVoucherLine_nonnegative_one_side"
  CHECK (debit >= 0 AND credit >= 0 AND NOT (debit > 0 AND credit > 0));
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER "JournalVoucher_balance_deferred"
AFTER INSERT OR UPDATE ON public."JournalVoucher"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.enforce_posted_voucher_balance();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "JournalVoucherLine_balance_deferred"
AFTER INSERT OR UPDATE OR DELETE ON public."JournalVoucherLine"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.enforce_posted_voucher_balance();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "CashBankVoucher_balance_deferred"
AFTER INSERT OR UPDATE ON public."CashBankVoucher"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.enforce_posted_voucher_balance();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "CashBankVoucherLine_balance_deferred"
AFTER INSERT OR UPDATE OR DELETE ON public."CashBankVoucherLine"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.enforce_posted_voucher_balance();
