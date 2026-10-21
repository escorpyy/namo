-- Company consistency for the account hierarchy, enforced by the database.
-- GeneralLedger.companyId is denormalized from AccountSubGroup -> AccountGroup -> Company (see schema/accounting.ts).
-- The API already checks this; these triggers make Postgres refuse inconsistent data from ANY code path.
-- Violations raise SQLSTATE 23514 (check_violation).

-- Pre-flight: refuse to install if existing rows already break the rule (never leave a database half-protected).
DO $$
DECLARE bad_company integer; bad_parent integer;
BEGIN
  SELECT count(*) INTO bad_company
    FROM "GeneralLedger" gl
    JOIN "AccountSubGroup" sg ON sg.id = gl."accountSubGroupId"
    JOIN "AccountGroup" g ON g.id = sg."accountGroupId"
   WHERE gl."companyId" <> g."companyId";
  SELECT count(*) INTO bad_parent
    FROM "GeneralLedger" gl
    JOIN "GeneralLedger" p ON p.id = gl."parentId"
   WHERE gl."companyId" <> p."companyId";
  IF bad_company > 0 OR bad_parent > 0 THEN
    RAISE EXCEPTION 'Cannot install company-integrity triggers: % ledger(s) disagree with their Account Group company, % ledger(s) have a parent in another company. Fix this data first.', bad_company, bad_parent
      USING ERRCODE = 'check_violation';
  END IF;
END $$;
--> statement-breakpoint

-- A ledger must belong to the same company as its Account Group, and its parent ledger (if any) to the same company.
-- FOR SHARE locks the parent rows so a concurrent change to them waits until this statement commits.
CREATE FUNCTION "namo_gl_company_check"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE grp_company integer; parent_company integer;
BEGIN
  SELECT g."companyId" INTO grp_company
    FROM "AccountSubGroup" sg
    JOIN "AccountGroup" g ON g.id = sg."accountGroupId"
   WHERE sg.id = NEW."accountSubGroupId"
     FOR SHARE OF sg, g;
  IF grp_company IS DISTINCT FROM NEW."companyId" THEN
    RAISE EXCEPTION 'General Ledger company (%) does not match the company (%) of its Account Group.', NEW."companyId", grp_company
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW."parentId" IS NOT NULL THEN
    SELECT p."companyId" INTO parent_company FROM "GeneralLedger" p WHERE p.id = NEW."parentId" FOR SHARE;
    IF parent_company IS DISTINCT FROM NEW."companyId" THEN
      RAISE EXCEPTION 'Parent ledger must belong to the same company as the ledger (company % vs %).', parent_company, NEW."companyId"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE TRIGGER "GeneralLedger_company_check"
  BEFORE INSERT OR UPDATE OF "companyId", "accountSubGroupId", "parentId" ON "GeneralLedger"
  FOR EACH ROW EXECUTE FUNCTION "namo_gl_company_check"();
--> statement-breakpoint

-- An Account Group cannot change company while ledgers still hang under it.
CREATE FUNCTION "namo_group_company_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "AccountSubGroup" sg
      JOIN "GeneralLedger" gl ON gl."accountSubGroupId" = sg.id
     WHERE sg."accountGroupId" = NEW.id AND gl."companyId" <> NEW."companyId"
  ) THEN
    RAISE EXCEPTION 'Cannot change the company of an Account Group that still has ledgers under it.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE TRIGGER "AccountGroup_company_guard"
  BEFORE UPDATE OF "companyId" ON "AccountGroup"
  FOR EACH ROW EXECUTE FUNCTION "namo_group_company_guard"();
--> statement-breakpoint

-- A Sub Group cannot move under a group of another company while ledgers hang under it.
CREATE FUNCTION "namo_subgroup_company_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE new_company integer;
BEGIN
  SELECT g."companyId" INTO new_company FROM "AccountGroup" g WHERE g.id = NEW."accountGroupId";
  IF EXISTS (
    SELECT 1 FROM "GeneralLedger" gl WHERE gl."accountSubGroupId" = NEW.id AND gl."companyId" <> new_company
  ) THEN
    RAISE EXCEPTION 'Cannot move a Sub Group to another company while it still has ledgers under it.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE TRIGGER "AccountSubGroup_company_guard"
  BEFORE UPDATE OF "accountGroupId" ON "AccountSubGroup"
  FOR EACH ROW EXECUTE FUNCTION "namo_subgroup_company_guard"();
