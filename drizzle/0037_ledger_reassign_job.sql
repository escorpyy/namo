CREATE TABLE "LedgerReassignJob" (
	"id" serial PRIMARY KEY NOT NULL,
	"companyId" integer NOT NULL,
	"kind" varchar(30) NOT NULL,
	"masterId" integer NOT NULL,
	"masterName" varchar(200) NOT NULL,
	"fromLedgerId" integer NOT NULL,
	"toLedgerId" integer NOT NULL,
	"status" varchar(10) DEFAULT 'QUEUED' NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"processed" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"message" text,
	"createdBy" integer,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"startedAt" timestamp (3),
	"finishedAt" timestamp (3),
	"seenAt" timestamp (3),
	CONSTRAINT "LedgerReassignJob_status_check" CHECK ("LedgerReassignJob"."status" IN ('QUEUED', 'RUNNING', 'DONE', 'FAILED')),
	CONSTRAINT "LedgerReassignJob_ledgers_check" CHECK ("LedgerReassignJob"."fromLedgerId" <> "LedgerReassignJob"."toLedgerId")
);
--> statement-breakpoint
ALTER TABLE "LedgerReassignJob" ADD CONSTRAINT "LedgerReassignJob_companyId_Company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "LedgerReassignJob" ADD CONSTRAINT "LedgerReassignJob_fromLedgerId_GeneralLedger_id_fk" FOREIGN KEY ("fromLedgerId") REFERENCES "public"."GeneralLedger"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "LedgerReassignJob" ADD CONSTRAINT "LedgerReassignJob_toLedgerId_GeneralLedger_id_fk" FOREIGN KEY ("toLedgerId") REFERENCES "public"."GeneralLedger"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "LedgerReassignJob" ADD CONSTRAINT "LedgerReassignJob_createdBy_User_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "LedgerReassignJob_companyId_idx" ON "LedgerReassignJob" USING btree ("companyId");
--> statement-breakpoint
CREATE INDEX "LedgerReassignJob_status_idx" ON "LedgerReassignJob" USING btree ("status");
--> statement-breakpoint
-- registry for the company-consistency checks, and the audit trail
INSERT INTO "namo"."company_source" (tbl, ord, via_col, via_tbl) VALUES ('LedgerReassignJob', 1, NULL, NULL);
--> statement-breakpoint
INSERT INTO "namo"."company_link" (tbl, col, link_tbl) VALUES
  ('LedgerReassignJob', 'fromLedgerId', 'GeneralLedger'),
  ('LedgerReassignJob', 'toLedgerId', 'GeneralLedger');
--> statement-breakpoint
CREATE TRIGGER namo_company_consistency BEFORE INSERT OR UPDATE OF "companyId", "fromLedgerId", "toLedgerId" ON public."LedgerReassignJob" FOR EACH ROW EXECUTE FUNCTION "namo"."enforce_company"();
