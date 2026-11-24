CREATE TABLE "FiscalYearClose" (
	"id" serial PRIMARY KEY NOT NULL,
	"companyId" integer NOT NULL,
	"fiscalYearId" integer NOT NULL,
	"profitAndLossGLId" integer NOT NULL,
	"netResult" numeric(18, 6) NOT NULL,
	"status" varchar(16) DEFAULT 'CLOSED' NOT NULL,
	"closedAt" timestamp (3) DEFAULT now() NOT NULL,
	"closedBy" integer,
	"reopenedAt" timestamp (3),
	"reopenedBy" integer,
	"reopenReason" varchar(500),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "FiscalYearClose_status_check" CHECK ("FiscalYearClose"."status" in ('CLOSED','REOPENING','REOPENED')),
	CONSTRAINT "FiscalYearClose_reopen_fields_check" CHECK (("FiscalYearClose"."status" = 'REOPENED') = ("FiscalYearClose"."reopenedAt" is not null and "FiscalYearClose"."reopenReason" is not null))
);
--> statement-breakpoint
CREATE TABLE "FiscalYearCloseVoucher" (
	"id" serial PRIMARY KEY NOT NULL,
	"fiscalYearCloseId" integer NOT NULL,
	"branchId" integer NOT NULL,
	"journalVoucherId" integer NOT NULL,
	"netResult" numeric(18, 6) NOT NULL,
	CONSTRAINT "FiscalYearCloseVoucher_journalVoucherId_unique" UNIQUE("journalVoucherId")
);
--> statement-breakpoint
ALTER TABLE "FiscalYearClose" ADD CONSTRAINT "FiscalYearClose_companyId_Company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "FiscalYearClose" ADD CONSTRAINT "FiscalYearClose_fiscalYearId_FiscalYear_id_fk" FOREIGN KEY ("fiscalYearId") REFERENCES "public"."FiscalYear"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "FiscalYearClose" ADD CONSTRAINT "FiscalYearClose_profitAndLossGLId_GeneralLedger_id_fk" FOREIGN KEY ("profitAndLossGLId") REFERENCES "public"."GeneralLedger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "FiscalYearClose" ADD CONSTRAINT "FiscalYearClose_closedBy_User_id_fk" FOREIGN KEY ("closedBy") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "FiscalYearClose" ADD CONSTRAINT "FiscalYearClose_reopenedBy_User_id_fk" FOREIGN KEY ("reopenedBy") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "FiscalYearCloseVoucher" ADD CONSTRAINT "FiscalYearCloseVoucher_fiscalYearCloseId_FiscalYearClose_id_fk" FOREIGN KEY ("fiscalYearCloseId") REFERENCES "public"."FiscalYearClose"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "FiscalYearCloseVoucher" ADD CONSTRAINT "FiscalYearCloseVoucher_branchId_Branch_id_fk" FOREIGN KEY ("branchId") REFERENCES "public"."Branch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "FiscalYearCloseVoucher" ADD CONSTRAINT "FiscalYearCloseVoucher_journalVoucherId_JournalVoucher_id_fk" FOREIGN KEY ("journalVoucherId") REFERENCES "public"."JournalVoucher"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "FiscalYearClose_companyId_idx" ON "FiscalYearClose" USING btree ("companyId");--> statement-breakpoint
CREATE INDEX "FiscalYearClose_fiscalYearId_idx" ON "FiscalYearClose" USING btree ("fiscalYearId");--> statement-breakpoint
CREATE INDEX "FiscalYearClose_profitAndLossGLId_idx" ON "FiscalYearClose" USING btree ("profitAndLossGLId");--> statement-breakpoint
CREATE UNIQUE INDEX "FiscalYearClose_one_active_per_year_key" ON "FiscalYearClose" USING btree ("fiscalYearId") WHERE "FiscalYearClose"."status" in ('CLOSED','REOPENING');--> statement-breakpoint
CREATE UNIQUE INDEX "FiscalYearCloseVoucher_close_branch_key" ON "FiscalYearCloseVoucher" USING btree ("fiscalYearCloseId","branchId");--> statement-breakpoint
CREATE INDEX "FiscalYearCloseVoucher_branchId_idx" ON "FiscalYearCloseVoucher" USING btree ("branchId");

--> statement-breakpoint
INSERT INTO "namo"."company_source" (tbl, ord, via_col, via_tbl) VALUES ('FiscalYearClose', 1, NULL, NULL);
--> statement-breakpoint
INSERT INTO "namo"."company_link" (tbl, col, link_tbl) VALUES ('FiscalYearClose', 'fiscalYearId', 'FiscalYear'), ('FiscalYearClose', 'profitAndLossGLId', 'GeneralLedger');
--> statement-breakpoint
CREATE TRIGGER namo_company_consistency BEFORE INSERT OR UPDATE OF "companyId", "fiscalYearId", "profitAndLossGLId" ON public."FiscalYearClose" FOR EACH ROW EXECUTE FUNCTION "namo"."enforce_company"();
--> statement-breakpoint
INSERT INTO "namo"."company_source" (tbl, ord, via_col, via_tbl) VALUES ('FiscalYearCloseVoucher', 1, 'fiscalYearCloseId', 'FiscalYearClose');
--> statement-breakpoint
INSERT INTO "namo"."company_link" (tbl, col, link_tbl) VALUES ('FiscalYearCloseVoucher', 'branchId', 'Branch'), ('FiscalYearCloseVoucher', 'journalVoucherId', 'JournalVoucher');
--> statement-breakpoint
CREATE TRIGGER namo_company_consistency BEFORE INSERT OR UPDATE OF "fiscalYearCloseId", "branchId", "journalVoucherId" ON public."FiscalYearCloseVoucher" FOR EACH ROW EXECUTE FUNCTION "namo"."enforce_company"();
--> statement-breakpoint
CREATE TRIGGER "Audit_trail" AFTER INSERT OR UPDATE OR DELETE ON public."FiscalYearClose" FOR EACH ROW EXECUTE FUNCTION "namo"."audit_row"();
--> statement-breakpoint
CREATE TRIGGER "Audit_trail" AFTER INSERT OR UPDATE OR DELETE ON public."FiscalYearCloseVoucher" FOR EACH ROW EXECUTE FUNCTION "namo"."audit_row"();
