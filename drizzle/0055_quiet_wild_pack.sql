CREATE TABLE "EntryControl" (
	"id" serial PRIMARY KEY NOT NULL,
	"companyId" integer NOT NULL,
	"module" varchar(40) NOT NULL,
	"feature" varchar(40) NOT NULL,
	"isShown" boolean DEFAULT true NOT NULL,
	"isEditable" boolean DEFAULT true NOT NULL,
	"isMandatory" boolean DEFAULT false NOT NULL,
	"ruleLevel" varchar(6) DEFAULT 'WARN' NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	CONSTRAINT "EntryControl_ruleLevel_check" CHECK ("EntryControl"."ruleLevel" in ('IGNORE','WARN','BLOCK'))
);
--> statement-breakpoint
ALTER TABLE "EntryControl" ADD CONSTRAINT "EntryControl_companyId_Company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "EntryControl_companyId_module_feature_key" ON "EntryControl" USING btree ("companyId","module","feature");--> statement-breakpoint
INSERT INTO "namo"."company_source" (tbl, ord, via_col, via_tbl) VALUES ('EntryControl', 1, NULL, NULL);
