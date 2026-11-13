CREATE TABLE "Narration" (
	"id" serial PRIMARY KEY NOT NULL,
	"companyId" integer NOT NULL,
	"code" varchar(10) NOT NULL,
	"narration" varchar(500) NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "Narration" ADD CONSTRAINT "Narration_companyId_Company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "Narration_companyId_code_key" ON "Narration" USING btree ("companyId","code");--> statement-breakpoint
CREATE UNIQUE INDEX "Narration_companyId_narration_key" ON "Narration" USING btree ("companyId","narration");--> statement-breakpoint
CREATE INDEX "Narration_companyId_idx" ON "Narration" USING btree ("companyId");
--> statement-breakpoint
-- Narration is a tenant table: register it so its company can never change and the registry completeness test stays green.
INSERT INTO "namo"."company_source" (tbl, ord, via_col, via_tbl) VALUES ('Narration', 1, NULL, NULL);
--> statement-breakpoint
CREATE TRIGGER namo_company_consistency BEFORE INSERT OR UPDATE OF "companyId" ON public."Narration"
  FOR EACH ROW EXECUTE FUNCTION "namo"."enforce_company"();
