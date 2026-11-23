ALTER TABLE "GeneralLedger" ALTER COLUMN "accountSubGroupId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "GeneralLedger" ADD COLUMN "accountGroupId" integer;--> statement-breakpoint
UPDATE "GeneralLedger" gl SET "accountGroupId" = sg."accountGroupId"
FROM "AccountSubGroup" sg WHERE sg.id = gl."accountSubGroupId" AND gl."accountGroupId" IS NULL;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "GeneralLedger" WHERE "accountGroupId" IS NULL) THEN
    RAISE EXCEPTION 'Cannot make GeneralLedger.accountGroupId mandatory: existing ledger has no Account Group.';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "GeneralLedger" ALTER COLUMN "accountGroupId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "GeneralLedger" ADD CONSTRAINT "GeneralLedger_accountGroupId_AccountGroup_id_fk" FOREIGN KEY ("accountGroupId") REFERENCES "public"."AccountGroup"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "GeneralLedger_accountGroupId_idx" ON "GeneralLedger" USING btree ("accountGroupId");--> statement-breakpoint

-- GeneralLedger now owns its mandatory Account Group directly; the subgroup is optional.
DROP TRIGGER IF EXISTS "GeneralLedger_company_check" ON "GeneralLedger";--> statement-breakpoint
DROP FUNCTION IF EXISTS "namo_gl_company_check"();--> statement-breakpoint
CREATE FUNCTION "namo_gl_company_check"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE grp_company integer; parent_company integer;
BEGIN
  SELECT g."companyId" INTO grp_company FROM "AccountGroup" g WHERE g.id = NEW."accountGroupId" FOR SHARE;
  IF grp_company IS DISTINCT FROM NEW."companyId" THEN
    RAISE EXCEPTION 'General Ledger company (%) does not match the company (%) of its Account Group.', NEW."companyId", grp_company USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."accountSubGroupId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "AccountSubGroup" sg WHERE sg.id = NEW."accountSubGroupId" AND sg."accountGroupId" = NEW."accountGroupId"
  ) THEN
    RAISE EXCEPTION 'General Ledger subgroup must belong to its Account Group.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."parentId" IS NOT NULL THEN
    SELECT p."companyId" INTO parent_company FROM "GeneralLedger" p WHERE p.id = NEW."parentId" FOR SHARE;
    IF parent_company IS DISTINCT FROM NEW."companyId" THEN
      RAISE EXCEPTION 'Parent ledger must belong to the same company as the ledger.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "GeneralLedger_company_check"
  BEFORE INSERT OR UPDATE OF "companyId", "accountGroupId", "accountSubGroupId", "parentId" ON "GeneralLedger"
  FOR EACH ROW EXECUTE FUNCTION "namo_gl_company_check"();--> statement-breakpoint

INSERT INTO "namo"."company_link" (tbl, col, link_tbl)
VALUES ('GeneralLedger', 'accountGroupId', 'AccountGroup')
ON CONFLICT (tbl, col) DO NOTHING;--> statement-breakpoint

CREATE OR REPLACE FUNCTION "namo_group_company_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "GeneralLedger" gl WHERE gl."accountGroupId" = NEW.id AND gl."companyId" <> NEW."companyId"
  ) OR EXISTS (
    SELECT 1 FROM "AccountSubGroup" sg JOIN "GeneralLedger" gl ON gl."accountSubGroupId" = sg.id
    WHERE sg."accountGroupId" = NEW.id AND gl."companyId" <> NEW."companyId"
  ) THEN
    RAISE EXCEPTION 'Cannot change the company of an Account Group that still has ledgers under it.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
