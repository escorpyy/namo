ALTER TABLE "Company" ADD COLUMN "deletedAt" timestamp with time zone;--> statement-breakpoint

-- The statement template tables (0059) were never registered as tenant tables. Register them: the purge below finds a company's rows
-- through this registry, and the database then keeps their links inside one company like everywhere else.
INSERT INTO "namo"."company_source" (tbl, ord, via_col, via_tbl) VALUES
  ('StatementTemplate', 1, NULL, NULL),
  ('StatementLine', 1, 'templateId', 'StatementTemplate'),
  ('StatementLineFormula', 1, 'templateId', 'StatementTemplate'),
  ('StatementLineMapping', 1, 'templateId', 'StatementTemplate');
--> statement-breakpoint
INSERT INTO "namo"."company_link" (tbl, col, link_tbl) VALUES
  ('StatementLine', 'parentLineId', 'StatementLine'),
  ('StatementLineMapping', 'accountGroupId', 'AccountGroup'),
  ('StatementLineMapping', 'accountSubGroupId', 'AccountSubGroup'),
  ('StatementLineMapping', 'generalLedgerId', 'GeneralLedger'),
  ('StatementLineMapping', 'fallbackGeneralLedgerId', 'GeneralLedger');
--> statement-breakpoint
CREATE TRIGGER namo_company_consistency BEFORE INSERT OR UPDATE OF "companyId" ON public."StatementTemplate" FOR EACH ROW EXECUTE FUNCTION "namo"."enforce_company"();
--> statement-breakpoint
CREATE TRIGGER namo_company_consistency BEFORE INSERT OR UPDATE OF "templateId", "parentLineId" ON public."StatementLine" FOR EACH ROW EXECUTE FUNCTION "namo"."enforce_company"();
--> statement-breakpoint
CREATE TRIGGER namo_company_consistency BEFORE INSERT OR UPDATE OF "templateId" ON public."StatementLineFormula" FOR EACH ROW EXECUTE FUNCTION "namo"."enforce_company"();
--> statement-breakpoint
CREATE TRIGGER namo_company_consistency BEFORE INSERT OR UPDATE OF "templateId", "accountGroupId", "accountSubGroupId", "generalLedgerId", "fallbackGeneralLedgerId" ON public."StatementLineMapping" FOR EACH ROW EXECUTE FUNCTION "namo"."enforce_company"();
--> statement-breakpoint

-- Permanent delete of ONE company and everything that belongs to it, including posted and period-locked documents and its audit history.
-- Only a company that is already in the Trash can be purged. The guard triggers (audit log is append-only, locks, posted documents) are
-- switched off for the tables involved INSIDE this transaction only: ALTER TABLE holds a lock that keeps other writers out until it ends,
-- and any error rolls everything back, triggers included. Foreign keys stay on, so nothing can be left dangling.
CREATE FUNCTION "namo"."purge_company"(p_company integer) RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  tables text[];
  pending text[];
  t text;
  ids integer[];
  progressed boolean;
BEGIN
  PERFORM 1 FROM public."Company" WHERE id = p_company AND "deletedAt" IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only a company in the Trash can be deleted permanently.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT array_agg(DISTINCT s.tbl) INTO tables FROM "namo"."company_source" s WHERE s.tbl <> 'Company';

  -- Collect the company's rows first, while every owner row they are reached through still exists.
  CREATE TEMP TABLE namo_purge (tbl text PRIMARY KEY, ids integer[]) ON COMMIT DROP;
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('SELECT array_agg(x.id) FROM public.%I x WHERE "namo"."company_of"(%L, to_jsonb(x)) = $1', t, t) INTO ids USING p_company;
    IF ids IS NOT NULL THEN INSERT INTO namo_purge VALUES (t, ids); END IF;
  END LOOP;

  FOR t IN SELECT p.tbl FROM namo_purge p UNION SELECT 'AuditLog' LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER USER', t);
  END LOOP;

  -- Delete in whatever order the foreign keys allow: a table that is still referenced waits for the next round.
  SELECT coalesce(array_agg(p.tbl), '{}') INTO pending FROM namo_purge p;
  WHILE cardinality(pending) > 0 LOOP
    progressed := false;
    FOREACH t IN ARRAY pending LOOP
      BEGIN
        EXECUTE format('DELETE FROM public.%I WHERE id = ANY($1)', t) USING (SELECT p.ids FROM namo_purge p WHERE p.tbl = t);
        pending := array_remove(pending, t);
        progressed := true;
      EXCEPTION WHEN integrity_constraint_violation OR foreign_key_violation OR restrict_violation OR unique_violation THEN -- all of class 23: try again later
        NULL;
      END;
    END LOOP;
    IF NOT progressed THEN
      RAISE EXCEPTION 'The company cannot be deleted: records in % are still referenced.', array_to_string(pending, ', ') USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  DELETE FROM public."AuditLog" WHERE "companyId" = p_company;
  DELETE FROM public."Company" WHERE id = p_company;

  FOR t IN SELECT p.tbl FROM namo_purge p UNION SELECT 'AuditLog' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER USER', t);
  END LOOP;
  DROP TABLE namo_purge;
END
$fn$;
