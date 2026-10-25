-- ERP-024 (part 1): an audit trail written by the database. Decisions S9 (a posted document may be edited in an open
-- period, so every change must be traceable) and S11 (AuditLog gets a companyId).
--
-- What this migration does
--   1. AuditLog gets a required companyId and a reason; changedBy stops being "set null" (a user in the log cannot be deleted).
--   2. namo.audit_row(): one generic AFTER INSERT/UPDATE/DELETE row trigger, "Audit_trail", on the financial tables below. It
--      copies the old and new row into AuditLog together with the company (worked out here, never supplied by the application),
--      the user (per-transaction setting namo.actor_user_id) and the reason (namo.change_reason). An UPDATE that changes
--      nothing writes nothing.
--   3. The log is append-only: UPDATE, DELETE and TRUNCATE on AuditLog are refused (SQLSTATE 23514, like the other rules).
--      This stops application bugs and ordinary SQL; a database superuser can still drop the triggers.
--
-- Audited tables: JournalVoucher + Line, CashBankVoucher + Line, PurchaseBill + Line + ImportDetail, PurchaseDocumentTerm +
-- Allocation (these two also hold purchase-ORDER terms), OpeningBalance. History starts at this migration: rows written
-- before it are not back-filled.
-- Not done here (still ERP-024): requiring a reason to edit or delete a POSTED document. Nothing edits a posted document yet
-- (ERP-026), and the service also changes posted bills' landed-cost columns when an additional bill arrives, so that rule is
-- better decided together with the edit path. The reason column and setting are ready for it.
-- Tests: tests/db.auditTrail.test.ts.

-- Pre-flight: nothing wrote to AuditLog before this migration. If rows exist, they have no company to fill the new required column.
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM "AuditLog";
  IF n > 0 THEN
    RAISE EXCEPTION 'Migration refused: AuditLog already holds % rows and none of them has a company. Nothing in this project wrote to that table before, so find out where they came from first.', n;
  END IF;
END
$$;
--> statement-breakpoint

ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_changedBy_User_id_fk";
--> statement-breakpoint
ALTER TABLE "AuditLog" ADD COLUMN "companyId" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "AuditLog" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_changedBy_User_id_fk" FOREIGN KEY ("changedBy") REFERENCES "public"."User"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "AuditLog_companyId_changedAt_idx" ON "AuditLog" USING btree ("companyId","changedAt");--> statement-breakpoint

-- The log can only be added to.
CREATE FUNCTION "namo"."audit_log_guard"() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  RAISE EXCEPTION 'The audit log cannot be changed or deleted (% on AuditLog refused). Entries are only ever added.', TG_OP
    USING ERRCODE = 'check_violation';
END
$fn$;
--> statement-breakpoint
CREATE TRIGGER "AuditLog_append_only"
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION "namo"."audit_log_guard"();
--> statement-breakpoint
CREATE TRIGGER "AuditLog_no_truncate"
  BEFORE TRUNCATE ON "AuditLog"
  FOR EACH STATEMENT EXECUTE FUNCTION "namo"."audit_log_guard"();
--> statement-breakpoint

-- One generic function for every audited table. Who: namo.actor_user_id. Why: namo.change_reason. Both are set per
-- transaction by the application (server/db/audit.ts) with set_config(..., true), so they end with the transaction.
CREATE FUNCTION "namo"."audit_row"() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  old_j     jsonb;
  new_j     jsonb;
  rec       jsonb;
  co        integer;
  s         record;
  v         integer;
  actor_txt text := coalesce(current_setting('namo.actor_user_id', true), '');
  actor     integer;
  why       text := nullif(btrim(coalesce(current_setting('namo.change_reason', true), '')), '');
BEGIN
  IF TG_OP = 'INSERT' THEN
    new_j := to_jsonb(NEW);
    rec := new_j;
  ELSIF TG_OP = 'UPDATE' THEN
    old_j := to_jsonb(OLD);
    new_j := to_jsonb(NEW);
    IF old_j = new_j THEN RETURN NULL; END IF; -- nothing changed: nothing to log
    rec := new_j;
  ELSE
    old_j := to_jsonb(OLD);
    rec := old_j;
  END IF;

  IF actor_txt = '' THEN
    actor := NULL;
  ELSIF actor_txt ~ '^[0-9]{1,10}$' THEN
    actor := actor_txt::integer;
  ELSE
    RAISE EXCEPTION 'namo.actor_user_id must be a user id (digits only), not "%".', actor_txt
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  co := "namo"."company_of"(TG_TABLE_NAME, rec);
  IF co IS NULL THEN
    -- A child row removed in the same statement as its parent (ON DELETE CASCADE): the parent is already gone, but its own
    -- log entry knows the company. That entry is written first because the trigger name "Audit_trail" sorts before the
    -- foreign-key trigger's name ("RI_ConstraintTrigger..."); tests/db.auditTrail.test.ts covers it.
    FOR s IN SELECT via_col, via_tbl FROM "namo"."company_source" WHERE tbl = TG_TABLE_NAME AND via_col IS NOT NULL ORDER BY ord LOOP
      v := (rec ->> s.via_col)::integer;
      CONTINUE WHEN v IS NULL;
      SELECT a."companyId" INTO co FROM public."AuditLog" a
       WHERE a."tableName" = s.via_tbl AND a."recordId" = v::text
       ORDER BY a.id DESC LIMIT 1;
      EXIT;
    END LOOP;
  END IF;
  IF co IS NULL THEN
    RAISE EXCEPTION 'Cannot determine the company of this % record, so the change cannot be logged.', TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public."AuditLog" ("companyId", "tableName", "recordId", "action", "oldData", "newData", "changedBy", "reason")
  VALUES (co, TG_TABLE_NAME, rec ->> 'id', TG_OP::public."AuditAction", old_j, new_j, actor, why);
  RETURN NULL; -- AFTER trigger: the return value is ignored
END
$fn$;
--> statement-breakpoint

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'CashBankVoucher', 'CashBankVoucherLine',
    'JournalVoucher', 'JournalVoucherLine',
    'OpeningBalance',
    'PurchaseBill', 'PurchaseBillImportDetail', 'PurchaseBillLine',
    'PurchaseDocumentTerm', 'PurchaseDocumentTermAllocation'
  ] LOOP
    EXECUTE format('CREATE TRIGGER "Audit_trail" AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION "namo"."audit_row"()', t);
  END LOOP;
END
$$;
