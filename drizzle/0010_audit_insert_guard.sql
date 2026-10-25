-- ERP-024 (part 2, hardening found in review): the audit log must not be forgeable by a plain INSERT.
-- Migration 0008 made the log append-only, but anything with INSERT access could still add an invented entry ("user 7 deleted
-- voucher 12"). Rule: an INSERT into AuditLog is accepted only when it is made BY another trigger (namo.audit_row), never
-- directly by a statement. pg_trigger_depth() is 1 inside a trigger fired by a user statement; the guard fires one level deeper
-- (2) when audit_row writes the entry, and at level 1 when a statement inserts directly.
-- Limit, stated plainly: a database role that may create triggers or functions, or a superuser, can still get around this
-- (and can drop the triggers). The complete answer is role separation (an application role without INSERT on AuditLog, the
-- audit function owned by another role); that belongs to the deployment / login work (ERP-002) and is not assumed here.
-- Tests: tests/db.auditTrail.test.ts.

CREATE FUNCTION "namo"."audit_log_insert_guard"() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'The audit log is written by the database itself; an entry cannot be inserted directly.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;
--> statement-breakpoint
CREATE TRIGGER "AuditLog_insert_guard"
  BEFORE INSERT ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION "namo"."audit_log_insert_guard"();
