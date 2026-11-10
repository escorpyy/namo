CREATE TABLE "CodeRule" (
	"id" serial PRIMARY KEY NOT NULL,
	"companyId" integer NOT NULL,
	"masterKey" varchar(40) NOT NULL,
	"mode" varchar(10) NOT NULL,
	"template" varchar(60) NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"updatedBy" integer,
	CONSTRAINT "CodeRule_mode_check" CHECK ("CodeRule"."mode" IN ('MANUAL', 'SUGGESTED'))
);
--> statement-breakpoint
ALTER TABLE "CodeRule" ADD CONSTRAINT "CodeRule_companyId_Company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "CodeRule" ADD CONSTRAINT "CodeRule_updatedBy_User_id_fk" FOREIGN KEY ("updatedBy") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "CodeRule_companyId_masterKey_key" ON "CodeRule" USING btree ("companyId","masterKey");
--> statement-breakpoint
-- CodeRule is a tenant table: register it so its company can never change and the registry completeness test stays green.
INSERT INTO "namo"."company_source" (tbl, ord, via_col, via_tbl) VALUES ('CodeRule', 1, NULL, NULL);
--> statement-breakpoint
CREATE TRIGGER namo_company_consistency BEFORE INSERT OR UPDATE OF "companyId" ON public."CodeRule"
  FOR EACH ROW EXECUTE FUNCTION "namo"."enforce_company"();
