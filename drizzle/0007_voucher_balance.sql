-- ERP-016: enforce double-entry balance in PostgreSQL, not only in service code.
-- Draft vouchers may be incomplete/unbalanced. Once a voucher is posted, its final transaction state
-- must contain at least two lines, positive total value, and equal debit/credit totals.
-- Deferred constraint triggers allow header + all lines to be written in one transaction.

CREATE OR REPLACE FUNCTION public.enforce_posted_voucher_balance() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_ids integer[];
  v_id integer;
  v_posted boolean;
  v_debits numeric(38, 6);
  v_credits numeric(38, 6);
  v_count integer;
  v_header_table text;
  v_line_table text;
  v_fk text;
BEGIN
  IF TG_TABLE_NAME = 'JournalVoucher' THEN
    v_ids := ARRAY[COALESCE(NEW.id, OLD.id)];
    v_header_table := 'JournalVoucher';
    v_line_table := 'JournalVoucherLine';
    v_fk := 'journalVoucherId';
  ELSIF TG_TABLE_NAME = 'CashBankVoucher' THEN
    v_ids := ARRAY[COALESCE(NEW.id, OLD.id)];
    v_header_table := 'CashBankVoucher';
    v_line_table := 'CashBankVoucherLine';
    v_fk := 'cashBankVoucherId';
  ELSIF TG_TABLE_NAME = 'JournalVoucherLine' THEN
    v_header_table := 'JournalVoucher';
    v_line_table := 'JournalVoucherLine';
    v_fk := 'journalVoucherId';
    IF TG_OP = 'DELETE' THEN
      v_ids := ARRAY[OLD."journalVoucherId"];
    ELSIF TG_OP = 'UPDATE' THEN
      v_ids := ARRAY[OLD."journalVoucherId", NEW."journalVoucherId"];
    ELSE
      v_ids := ARRAY[NEW."journalVoucherId"];
    END IF;
  ELSE
    v_header_table := 'CashBankVoucher';
    v_line_table := 'CashBankVoucherLine';
    v_fk := 'cashBankVoucherId';
    IF TG_OP = 'DELETE' THEN
      v_ids := ARRAY[OLD."cashBankVoucherId"];
    ELSIF TG_OP = 'UPDATE' THEN
      v_ids := ARRAY[OLD."cashBankVoucherId", NEW."cashBankVoucherId"];
    ELSE
      v_ids := ARRAY[NEW."cashBankVoucherId"];
    END IF;
  END IF;

  FOREACH v_id IN ARRAY v_ids LOOP
    EXECUTE format('SELECT "isPosted" FROM public.%I WHERE id = $1', v_header_table)
      INTO v_posted USING v_id;
    IF v_posted IS DISTINCT FROM TRUE THEN CONTINUE; END IF;

    EXECUTE format(
      'SELECT COUNT(*), COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0) FROM public.%I WHERE %I = $1',
      v_line_table, v_fk)
      INTO v_count, v_debits, v_credits USING v_id;

    IF v_count < 2 OR v_debits <= 0 OR v_debits <> v_credits THEN
      RAISE EXCEPTION 'Posted voucher % must have at least two lines and equal positive debit and credit totals (debit %, credit %, lines %)',
        v_id, v_debits, v_credits, v_count
        USING ERRCODE = '23514', CONSTRAINT = 'posted_voucher_balanced';
    END IF;
  END LOOP;
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
