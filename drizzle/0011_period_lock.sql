-- ERP-025: company lock (closing) date, enforced by the database. Decision S9 (c) and (d), recorded as S12.
--
-- Rule: while a company has a lock date, a document dated ON OR BEFORE it cannot be created, edited or deleted. Covered
-- documents are the ones migration 0009 treats as posted-document tables: JournalVoucher + Line, CashBankVoucher + Line,
-- PurchaseBill + Line + ImportDetail, and the PURCHASE_BILL rows of PurchaseDocumentTerm + PurchaseDocumentTermAllocation.
-- Orders, challans, opening balances and stock openings are not covered (S9 answer 3). A child row is dated by its parent.
-- Drafts are covered too: a draft dated in a locked period cannot be created or saved, and a draft that is already there can
-- only be moved out or deleted with the override (rare: it needs a lock date set or moved up after the draft was keyed in).
-- An UPDATE that moves a document INTO or OUT OF a locked period is refused (both the old and the new date are checked).
--
-- Override ("one edit at a time", S9 answer 2): the only way through is the per-transaction setting
-- namo.lock_override_company = <company id>, set by the application AFTER it checked the lock password (server/services/periodLock.ts,
-- scrypt hash in CompanyLock), together with a non-blank namo.change_reason. Both end with the transaction, so the next edit asks for
-- the password again; there is no standing unlock window. The change is audit-logged by the existing trail with "lockOverride" = true.
-- Same limit as the other transaction settings (S11 q, r): a role that can run arbitrary SQL can set the setting itself, so this
-- stops application bugs, wrong code paths and ordinary SQL, not a database superuser. Role separation is deployment work (ERP-002).
--
-- Same deliberate carve-out as migration 0009: an UPDATE of a PurchaseBillLine that changes only allocatedTermAmount,
-- landedAmount and landedRate is not a change to the books (landed cost is for stock valuation only, S7) and is never refused, so an
-- additional bill dated after the lock date can still re-value the lines of an older, locked bill. Available to any SQL caller.
--
-- CompanyLock holds the date and a scrypt password hash (never the password). A lock date requires a password (CHECK), so the lock
-- cannot be lifted by just anyone. Lowering or clearing the date, or changing the password, is itself an override: the trigger
-- "CompanyLock_guard" requires the same setting and a reason. Changes to CompanyLock are logged in AuditLog WITHOUT the hash.
--
-- Not done here: admin permission as an alternative to the password (needs login, ERP-002); the lock date does not move
-- FiscalYear.isClosed and the year close does not move the lock date (they are independent until ERP-007, see S12).
-- Tests: tests/db.periodLock.test.ts, tests/api.periodLock.test.ts.

CREATE TABLE "CompanyLock" (
	"id" serial PRIMARY KEY NOT NULL,
	"companyId" integer NOT NULL,
	"lockDate" date,
	"passwordHash" text,
	"updatedAt" timestamp (3) NOT NULL,
	"updatedBy" integer,
	CONSTRAINT "CompanyLock_date_needs_password_check" CHECK ("CompanyLock"."lockDate" IS NULL OR "CompanyLock"."passwordHash" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "AuditLog" ADD COLUMN "lockOverride" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "CompanyLock" ADD CONSTRAINT "CompanyLock_companyId_Company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "CompanyLock" ADD CONSTRAINT "CompanyLock_updatedBy_User_id_fk" FOREIGN KEY ("updatedBy") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "CompanyLock_companyId_key" ON "CompanyLock" USING btree ("companyId");
--> statement-breakpoint

-- CompanyLock is a tenant table (S4): register it so its company can never change and the completeness test stays green.
INSERT INTO "namo"."company_source" (tbl, ord, via_col, via_tbl) VALUES ('CompanyLock', 1, NULL, NULL);
--> statement-breakpoint
CREATE TRIGGER namo_company_consistency BEFORE INSERT OR UPDATE OF "companyId" ON public."CompanyLock"
  FOR EACH ROW EXECUTE FUNCTION "namo"."enforce_company"();
--> statement-breakpoint

-- The date that places a row in a period (NULL = not a covered document, or its parent is already gone).
CREATE FUNCTION "namo"."document_date"(p_tbl text, p_row jsonb) RETURNS date
LANGUAGE plpgsql
AS $fn$
DECLARE d date;
BEGIN
  IF p_row IS NULL THEN RETURN NULL; END IF;
  IF p_tbl IN ('JournalVoucher', 'CashBankVoucher') THEN
    RETURN (p_row ->> 'voucherDate')::date;
  ELSIF p_tbl = 'PurchaseBill' THEN
    RETURN (p_row ->> 'invoiceDate')::date;
  ELSIF p_tbl = 'JournalVoucherLine' THEN
    SELECT v."voucherDate" INTO d FROM public."JournalVoucher" v WHERE v.id = (p_row ->> 'journalVoucherId')::integer;
  ELSIF p_tbl = 'CashBankVoucherLine' THEN
    SELECT v."voucherDate" INTO d FROM public."CashBankVoucher" v WHERE v.id = (p_row ->> 'cashBankVoucherId')::integer;
  ELSIF p_tbl IN ('PurchaseBillLine', 'PurchaseBillImportDetail') THEN
    SELECT b."invoiceDate" INTO d FROM public."PurchaseBill" b WHERE b.id = (p_row ->> 'purchaseBillId')::integer;
  ELSIF p_tbl = 'PurchaseDocumentTerm' THEN
    IF p_row ->> 'documentType' = 'PURCHASE_BILL' THEN
      SELECT b."invoiceDate" INTO d FROM public."PurchaseBill" b WHERE b.id = (p_row ->> 'documentId')::integer;
    END IF;
  ELSIF p_tbl = 'PurchaseDocumentTermAllocation' THEN
    SELECT b."invoiceDate" INTO d
      FROM public."PurchaseDocumentTerm" t JOIN public."PurchaseBill" b ON b.id = t."documentId"
     WHERE t.id = (p_row ->> 'documentTermId')::integer AND t."documentType" = 'PURCHASE_BILL';
  ELSE
    RAISE EXCEPTION 'namo.document_date is not set up for table %', p_tbl;
  END IF;
  RETURN d;
END
$fn$;
--> statement-breakpoint

-- The company's lock date when this change touches a locked period, otherwise NULL. One definition for both the guard (BEFORE) and
-- the audit trail (AFTER), so the "lockOverride" flag in the log always agrees with what the guard let through.
-- p_old is NULL for an INSERT, p_new is NULL for a DELETE. An UPDATE of a child row that moves it to another parent checks both parents.
CREATE FUNCTION "namo"."locked_by"(p_tbl text, p_old jsonb, p_new jsonb) RETURNS date
LANGUAGE plpgsql
AS $fn$
DECLARE
  co integer;
  ld date;
  d_old date;
  d_new date;
BEGIN
  IF p_tbl <> ALL (ARRAY['CashBankVoucher', 'CashBankVoucherLine', 'JournalVoucher', 'JournalVoucherLine',
                         'PurchaseBill', 'PurchaseBillImportDetail', 'PurchaseBillLine',
                         'PurchaseDocumentTerm', 'PurchaseDocumentTermAllocation']) THEN
    RETURN NULL; -- not a covered document (opening balances, orders, ...)
  END IF;
  -- An UPDATE that changes nothing is not a change.
  IF p_old IS NOT NULL AND p_new IS NOT NULL AND p_old = p_new THEN RETURN NULL; END IF;
  -- Landed cost is recalculated by the system on bill lines for stock valuation; that alone is not a change to the books (same
  -- policy carve-out as migration 0009). A change to the parent key stays in both values, so it is not covered by this.
  IF p_tbl = 'PurchaseBillLine' AND p_old IS NOT NULL AND p_new IS NOT NULL
     AND (p_new - ARRAY['allocatedTermAmount', 'landedAmount', 'landedRate'])
       = (p_old - ARRAY['allocatedTermAmount', 'landedAmount', 'landedRate']) THEN
    RETURN NULL;
  END IF;
  -- Cheap exit for the usual case: no company has a lock date at all.
  IF NOT EXISTS (SELECT 1 FROM public."CompanyLock" WHERE "lockDate" IS NOT NULL) THEN RETURN NULL; END IF;

  co := "namo"."company_of"(p_tbl, coalesce(p_new, p_old));
  IF co IS NULL THEN RETURN NULL; END IF; -- a child removed by ON DELETE CASCADE: its parent's own DELETE was the gated step
  SELECT l."lockDate" INTO ld FROM public."CompanyLock" l WHERE l."companyId" = co;
  IF ld IS NULL THEN RETURN NULL; END IF;

  d_old := "namo"."document_date"(p_tbl, p_old);
  d_new := "namo"."document_date"(p_tbl, p_new);
  IF (d_old IS NOT NULL AND d_old <= ld) OR (d_new IS NOT NULL AND d_new <= ld) THEN RETURN ld; END IF;
  RETURN NULL;
END
$fn$;
--> statement-breakpoint

CREATE FUNCTION "namo"."enforce_lock_date"() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  old_j jsonb;
  new_j jsonb;
  ld    date;
  co    integer;
  why   text := nullif(btrim(coalesce(current_setting('namo.change_reason', true), '')), '');
  ov    text := coalesce(current_setting('namo.lock_override_company', true), '');
BEGIN
  IF TG_OP <> 'INSERT' THEN old_j := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN new_j := to_jsonb(NEW); END IF;

  ld := "namo"."locked_by"(TG_TABLE_NAME, old_j, new_j);
  IF ld IS NOT NULL THEN
    co := "namo"."company_of"(TG_TABLE_NAME, coalesce(new_j, old_j));
    IF ov = co::text THEN
      -- The application checked the lock password for this company in this transaction. A reason is still required.
      IF why IS NULL THEN
        RAISE EXCEPTION 'A reason is required to change a document in a locked period (% #%). Enter why it is being changed, then save again.',
          TG_TABLE_NAME, coalesce(new_j ->> 'id', old_j ->> 'id')
          USING ERRCODE = 'check_violation';
      END IF;
    ELSE
      RAISE EXCEPTION 'The books are locked up to %: a document dated on or before that day cannot be % (% #%). Use the lock password and a reason to change it.',
        to_char(ld, 'YYYY-MM-DD'),
        CASE TG_OP WHEN 'DELETE' THEN 'deleted' WHEN 'INSERT' THEN 'created' ELSE 'changed' END,
        TG_TABLE_NAME, coalesce(new_j ->> 'id', old_j ->> 'id')
        USING ERRCODE = 'check_violation';
    END IF;
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
    -- BEFORE: refuse before anything is written. The name sorts ahead of "Audit_reason" (migration 0009), so in a locked period the
    -- lock message wins over "a reason is required", and ahead of namo_company_consistency.
    EXECUTE format('CREATE TRIGGER "Audit_lock" BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION "namo"."enforce_lock_date"()', t);
  END LOOP;
END
$$;
--> statement-breakpoint

-- The lock settings themselves. Lowering or clearing the lock date, changing the password, or deleting the row all lift or weaken
-- the lock, so they need the same override (password already checked by the application) and a reason. Raising the date, setting
-- it for the first time, or setting the first password needs neither. The hash is never part of any message.
CREATE FUNCTION "namo"."guard_company_lock"() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  weakening boolean;
  pw_change boolean;
  why text := nullif(btrim(coalesce(current_setting('namo.change_reason', true), '')), '');
  ov  text := coalesce(current_setting('namo.lock_override_company', true), '');
BEGIN
  IF TG_OP <> 'INSERT' THEN
    weakening := OLD."lockDate" IS NOT NULL
      AND (TG_OP = 'DELETE' OR NEW."lockDate" IS NULL OR NEW."lockDate" < OLD."lockDate");
    pw_change := OLD."passwordHash" IS NOT NULL
      AND (TG_OP = 'DELETE' OR NEW."passwordHash" IS DISTINCT FROM OLD."passwordHash");
    IF weakening OR pw_change THEN
      IF ov <> OLD."companyId"::text THEN
        RAISE EXCEPTION 'The lock password is needed to lower or remove the lock date, or to change the lock password.'
          USING ERRCODE = 'check_violation';
      END IF;
      IF why IS NULL THEN
        RAISE EXCEPTION 'A reason is required to lower or remove the lock date, or to change the lock password.'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$fn$;
--> statement-breakpoint
CREATE TRIGGER "CompanyLock_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "CompanyLock"
  FOR EACH ROW EXECUTE FUNCTION "namo"."guard_company_lock"();
--> statement-breakpoint

-- Audit entry for a lock-setting change, WITHOUT the hash (a hash in a log that can never be edited is still an offline-guessing
-- target). The entry says whether a password is set and, when it was changed, passwordChanged = true. Trigger name "Audit_trail"
-- like the other audited tables (the audit API lists CompanyLock among AUDITED_TABLES), but this function, not audit_row.
CREATE FUNCTION "namo"."audit_company_lock"() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  old_j     jsonb;
  new_j     jsonb;
  co        integer;
  rid       text;
  actor_txt text := coalesce(current_setting('namo.actor_user_id', true), '');
  actor     integer;
  why       text := nullif(btrim(coalesce(current_setting('namo.change_reason', true), '')), '');
  ov        text := coalesce(current_setting('namo.lock_override_company', true), '');
BEGIN
  IF TG_OP = 'UPDATE' AND to_jsonb(OLD) = to_jsonb(NEW) THEN RETURN NULL; END IF;

  IF actor_txt = '' THEN
    actor := NULL;
  ELSIF actor_txt ~ '^[0-9]{1,10}$' THEN
    actor := actor_txt::integer;
  ELSE
    RAISE EXCEPTION 'namo.actor_user_id must be a user id (digits only), not "%".', actor_txt
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF TG_OP <> 'INSERT' THEN
    co := OLD."companyId";
    rid := OLD.id::text;
    old_j := (to_jsonb(OLD) - 'passwordHash') || jsonb_build_object('passwordSet', OLD."passwordHash" IS NOT NULL);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    co := NEW."companyId";
    rid := NEW.id::text;
    new_j := (to_jsonb(NEW) - 'passwordHash') || jsonb_build_object('passwordSet', NEW."passwordHash" IS NOT NULL);
    IF TG_OP = 'INSERT' OR OLD."passwordHash" IS DISTINCT FROM NEW."passwordHash" THEN
      new_j := new_j || jsonb_build_object('passwordChanged', true);
    END IF;
  END IF;

  INSERT INTO public."AuditLog" ("companyId", "tableName", "recordId", "action", "oldData", "newData", "changedBy", "reason", "lockOverride")
  VALUES (co, TG_TABLE_NAME, rid, TG_OP::public."AuditAction", old_j, new_j, actor, why, ov = co::text);
  RETURN NULL; -- AFTER trigger: the return value is ignored
END
$fn$;
--> statement-breakpoint
CREATE TRIGGER "Audit_trail"
  AFTER INSERT OR UPDATE OR DELETE ON "CompanyLock"
  FOR EACH ROW EXECUTE FUNCTION "namo"."audit_company_lock"();
--> statement-breakpoint

-- audit_row (migration 0008) with ONE addition: the new AuditLog."lockOverride" column is true when the audited change touched a
-- locked period. The guard has already let it through, so that can only have happened with the override. Everything else is the
-- 0008 body unchanged.
CREATE OR REPLACE FUNCTION "namo"."audit_row"() RETURNS trigger
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
  locked    date;
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

  locked := "namo"."locked_by"(TG_TABLE_NAME, old_j, new_j);

  INSERT INTO public."AuditLog" ("companyId", "tableName", "recordId", "action", "oldData", "newData", "changedBy", "reason", "lockOverride")
  VALUES (co, TG_TABLE_NAME, rec ->> 'id', TG_OP::public."AuditAction", old_j, new_j, actor, why, locked IS NOT NULL);
  RETURN NULL; -- AFTER trigger: the return value is ignored
END
$fn$;
