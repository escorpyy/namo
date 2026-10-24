-- ERP-016: every voucher must balance (total debit = total credit), enforced by the database at COMMIT time.
-- Why deferred: decision S9 allows editing a posted voucher in an open period, and an edit rewrites lines inside one
-- transaction (delete the old lines, insert the new ones, or change both sides one after the other). Only the state at
-- commit has to balance; the lines of one voucher may be one-sided while the transaction is still running.
-- Scope: JournalVoucher + JournalVoucherLine and CashBankVoucher + CashBankVoucherLine (purchase bills post through
-- JournalVoucher). A voucher with no lines yet (a draft being built) is balanced (0 = 0) and is allowed.
-- Violations raise SQLSTATE 23514 (check_violation) with a message written for people; the API answers 409 (ERP-018).
-- Tests: tests/db.voucherBalance.test.ts.

-- Pre-flight: refuse to install over data that already violates the rule, and name the vouchers.
DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(label, ', ' ORDER BY label) INTO bad FROM (
    SELECT 'JournalVoucher#' || l."journalVoucherId" AS label
      FROM "JournalVoucherLine" l
     GROUP BY l."journalVoucherId"
    HAVING sum(l."debit") <> sum(l."credit")
     LIMIT 20
  ) x;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Migration refused: these journal vouchers are not balanced: %. Correct them, then run the migration again.', bad;
  END IF;

  SELECT string_agg(label, ', ' ORDER BY label) INTO bad FROM (
    SELECT 'CashBankVoucher#' || l."cashBankVoucherId" AS label
      FROM "CashBankVoucherLine" l
     GROUP BY l."cashBankVoucherId"
    HAVING sum(l."debit") <> sum(l."credit")
     LIMIT 20
  ) x;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Migration refused: these cash/bank vouchers are not balanced: %. Correct them, then run the migration again.', bad;
  END IF;
END
$$;
--> statement-breakpoint

-- One generic function for both line tables. Trigger arguments: (1) the line table's voucher column, (2) the line
-- table, (3) the voucher's display name used in the message.
CREATE FUNCTION namo.check_voucher_balance() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  fk_col   text := TG_ARGV[0];
  line_tbl text := TG_ARGV[1];
  label    text := TG_ARGV[2];
  ids      integer[] := ARRAY[]::integer[];
  v_id     integer;
  dr       numeric;
  cr       numeric;
BEGIN
  -- Which voucher(s) did this row change? A line moved between vouchers changes two.
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    ids := ids || (to_jsonb(NEW) ->> fk_col)::integer;
  END IF;
  IF TG_OP IN ('DELETE', 'UPDATE') THEN
    v_id := (to_jsonb(OLD) ->> fk_col)::integer;
    IF NOT (v_id = ANY (ids)) THEN
      ids := ids || v_id;
    END IF;
  END IF;

  FOREACH v_id IN ARRAY ids LOOP
    -- Reads the state at commit (the trigger is deferred). A voucher that no longer exists has no lines: 0 = 0.
    EXECUTE format('SELECT coalesce(sum(debit), 0), coalesce(sum(credit), 0) FROM %I WHERE %I = $1', line_tbl, fk_col)
      INTO dr, cr
      USING v_id;
    IF dr <> cr THEN
      RAISE EXCEPTION '% #% is not balanced: total debit % does not equal total credit %. Make debit and credit equal before saving.',
        label, v_id, trim_scale(dr), trim_scale(cr)
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  RETURN NULL; -- AFTER trigger: the return value is ignored
END
$fn$;
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER "JournalVoucherLine_balance"
  AFTER INSERT OR DELETE OR UPDATE OF "journalVoucherId", "debit", "credit" ON "JournalVoucherLine"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION namo.check_voucher_balance('journalVoucherId', 'JournalVoucherLine', 'Journal voucher');
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER "CashBankVoucherLine_balance"
  AFTER INSERT OR DELETE OR UPDATE OF "cashBankVoucherId", "debit", "credit" ON "CashBankVoucherLine"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION namo.check_voucher_balance('cashBankVoucherId', 'CashBankVoucherLine', 'Cash/bank voucher');
