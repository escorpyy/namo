CREATE TYPE "public"."StatementAccountFlag" AS ENUM('IS_CASH_OR_BANK');--> statement-breakpoint
CREATE TYPE "public"."StatementCfsSource" AS ENUM('BS_MOVEMENT', 'PL_ADDBACK', 'CASH_FLAG');--> statement-breakpoint
CREATE TYPE "public"."StatementDrillDepth" AS ENUM('NONE', 'GROUP', 'SUBGROUP', 'LEDGER');--> statement-breakpoint
CREATE TYPE "public"."StatementKind" AS ENUM('PL', 'BS', 'CFS', 'SCOE');--> statement-breakpoint
CREATE TYPE "public"."StatementLineAxis" AS ENUM('LINE', 'ROW', 'COLUMN');--> statement-breakpoint
CREATE TYPE "public"."StatementLineNature" AS ENUM('DEBIT', 'CREDIT');--> statement-breakpoint
CREATE TYPE "public"."StatementLineType" AS ENUM('HEADING', 'MAPPED', 'COMPUTED');--> statement-breakpoint
CREATE TYPE "public"."StatementMovementKind" AS ENUM('DRAWINGS', 'DIVIDENDS', 'CAPITAL_INTRODUCED', 'TRANSFER', 'OTHER');--> statement-breakpoint
CREATE TABLE "StatementLine" (
	"id" serial PRIMARY KEY NOT NULL,
	"templateId" integer NOT NULL,
	"statement" "StatementKind" NOT NULL,
	"code" varchar(64) NOT NULL,
	"label" varchar(160) NOT NULL,
	"parentLineId" integer,
	"axis" "StatementLineAxis" DEFAULT 'LINE' NOT NULL,
	"sortOrder" integer NOT NULL,
	"lineType" "StatementLineType" NOT NULL,
	"nature" "StatementLineNature",
	"role" varchar(48),
	"allowedTypes" "AccountType"[] DEFAULT ARRAY[]::"AccountType"[] NOT NULL,
	"noteNo" varchar(16),
	"drillDepth" "StatementDrillDepth" DEFAULT 'NONE' NOT NULL,
	"showWhenZero" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	CONSTRAINT "StatementLine_role_check" CHECK ("StatementLine"."role" IS NULL OR "StatementLine"."role" IN ('PROFIT_FOR_PERIOD', 'GROSS_PROFIT', 'CASH_AND_EQUIVALENTS', 'TOTAL_ASSETS', 'TOTAL_EQUITY', 'TOTAL_EQUITY_AND_LIABILITIES', 'TOTAL_CURRENT_ASSETS', 'TOTAL_NONCURRENT_ASSETS', 'TOTAL_CURRENT_LIABILITIES', 'TOTAL_NONCURRENT_LIABILITIES', 'CFS_OPERATING', 'CFS_INVESTING', 'CFS_FINANCING', 'SCOE_COLUMN', 'SCOE_MOVEMENT_OPENING', 'SCOE_MOVEMENT_PROFIT', 'SCOE_MOVEMENT_OTHER', 'SCOE_MOVEMENT_CLOSING')),
	CONSTRAINT "StatementLine_shape_check" CHECK (("StatementLine"."lineType" = 'HEADING' AND "StatementLine"."nature" IS NULL AND "StatementLine"."role" IS NULL AND cardinality("StatementLine"."allowedTypes") = 0)
        OR ("StatementLine"."lineType" = 'MAPPED' AND "StatementLine"."nature" IS NOT NULL AND cardinality("StatementLine"."allowedTypes") > 0)
        OR ("StatementLine"."lineType" = 'COMPUTED' AND "StatementLine"."nature" IS NULL AND cardinality("StatementLine"."allowedTypes") = 0)),
	CONSTRAINT "StatementLine_axis_check" CHECK ((("StatementLine"."statement" IN ('PL', 'BS', 'CFS')) AND "StatementLine"."axis" = 'LINE')
        OR ("StatementLine"."statement" = 'SCOE' AND "StatementLine"."axis" IN ('ROW', 'COLUMN'))),
	CONSTRAINT "StatementLine_not_own_parent_check" CHECK ("StatementLine"."parentLineId" IS NULL OR "StatementLine"."parentLineId" <> "StatementLine"."id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "StatementLine_id_templateId_statement_key" ON "StatementLine" USING btree ("id","templateId","statement");--> statement-breakpoint
CREATE TABLE "StatementLineFormula" (
	"id" serial PRIMARY KEY NOT NULL,
	"templateId" integer NOT NULL,
	"statement" "StatementKind" NOT NULL,
	"lineId" integer NOT NULL,
	"termLineId" integer NOT NULL,
	"sign" smallint NOT NULL,
	"sortOrder" integer NOT NULL,
	CONSTRAINT "StatementLineFormula_sign_check" CHECK ("StatementLineFormula"."sign" IN (-1, 1)),
	CONSTRAINT "StatementLineFormula_distinct_lines_check" CHECK ("StatementLineFormula"."lineId" <> "StatementLineFormula"."termLineId")
);
--> statement-breakpoint
CREATE TABLE "StatementLineMapping" (
	"id" serial PRIMARY KEY NOT NULL,
	"templateId" integer NOT NULL,
	"statement" "StatementKind" NOT NULL,
	"lineId" integer NOT NULL,
	"accountGroupId" integer,
	"accountSubGroupId" integer,
	"generalLedgerId" integer,
	"glSetupRole" varchar(32),
	"fallbackGeneralLedgerId" integer,
	"accountFlag" "StatementAccountFlag",
	"cfsSource" "StatementCfsSource",
	"movementKind" "StatementMovementKind",
	"sortOrder" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "StatementLineMapping_one_target_check" CHECK (num_nonnulls("StatementLineMapping"."accountGroupId", "StatementLineMapping"."accountSubGroupId", "StatementLineMapping"."generalLedgerId", "StatementLineMapping"."glSetupRole", "StatementLineMapping"."accountFlag") = 1),
	CONSTRAINT "StatementLineMapping_role_fallback_check" CHECK ("StatementLineMapping"."fallbackGeneralLedgerId" IS NULL OR "StatementLineMapping"."glSetupRole" IS NOT NULL),
	CONSTRAINT "StatementLineMapping_glSetupRole_check" CHECK ("StatementLineMapping"."glSetupRole" IS NULL OR "StatementLineMapping"."glSetupRole" IN ('PROFIT_AND_LOSS', 'CASH_BOOK', 'SALES_ACCOUNT', 'SALES_RETURN_ACCOUNT', 'PURCHASE_ACCOUNT', 'PURCHASE_RETURN_ACCOUNT', 'INPUT_VAT', 'OUTPUT_VAT', 'IMPORT_INPUT_VAT', 'OPENING_STOCK_PL', 'CLOSING_STOCK_PL', 'CLOSING_STOCK_BS')),
	CONSTRAINT "StatementLineMapping_cfs_source_check" CHECK (("StatementLineMapping"."statement" = 'CFS' AND "StatementLineMapping"."cfsSource" IS NOT NULL)
        OR ("StatementLineMapping"."statement" <> 'CFS' AND "StatementLineMapping"."cfsSource" IS NULL)),
	CONSTRAINT "StatementLineMapping_movement_kind_check" CHECK ("StatementLineMapping"."movementKind" IS NULL OR "StatementLineMapping"."statement" IN ('CFS', 'SCOE')),
	CONSTRAINT "StatementLineMapping_account_flag_check" CHECK ("StatementLineMapping"."accountFlag" IS NULL OR "StatementLineMapping"."statement" IN ('BS', 'CFS'))
);
--> statement-breakpoint
CREATE TABLE "StatementTemplate" (
	"id" serial PRIMARY KEY NOT NULL,
	"companyId" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" varchar(500),
	"isSystem" boolean DEFAULT false NOT NULL,
	"isDefault" boolean DEFAULT false NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdBy" integer,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	CONSTRAINT "StatementTemplate_default_active_check" CHECK (NOT "StatementTemplate"."isDefault" OR "StatementTemplate"."isActive")
);
--> statement-breakpoint
ALTER TABLE "StatementLine" ADD CONSTRAINT "StatementLine_templateId_StatementTemplate_id_fk" FOREIGN KEY ("templateId") REFERENCES "public"."StatementTemplate"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "StatementLine" ADD CONSTRAINT "StatementLine_parentLineId_StatementLine_id_fk" FOREIGN KEY ("parentLineId") REFERENCES "public"."StatementLine"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "StatementLineFormula" ADD CONSTRAINT "StatementLineFormula_templateId_StatementTemplate_id_fk" FOREIGN KEY ("templateId") REFERENCES "public"."StatementTemplate"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "StatementLineFormula" ADD CONSTRAINT "StatementLineFormula_line_scope_fk" FOREIGN KEY ("lineId","templateId","statement") REFERENCES "public"."StatementLine"("id","templateId","statement") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "StatementLineFormula" ADD CONSTRAINT "StatementLineFormula_term_scope_fk" FOREIGN KEY ("termLineId","templateId","statement") REFERENCES "public"."StatementLine"("id","templateId","statement") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "StatementLineMapping" ADD CONSTRAINT "StatementLineMapping_templateId_StatementTemplate_id_fk" FOREIGN KEY ("templateId") REFERENCES "public"."StatementTemplate"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "StatementLineMapping" ADD CONSTRAINT "StatementLineMapping_accountGroupId_AccountGroup_id_fk" FOREIGN KEY ("accountGroupId") REFERENCES "public"."AccountGroup"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "StatementLineMapping" ADD CONSTRAINT "StatementLineMapping_accountSubGroupId_AccountSubGroup_id_fk" FOREIGN KEY ("accountSubGroupId") REFERENCES "public"."AccountSubGroup"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "StatementLineMapping" ADD CONSTRAINT "StatementLineMapping_generalLedgerId_GeneralLedger_id_fk" FOREIGN KEY ("generalLedgerId") REFERENCES "public"."GeneralLedger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "StatementLineMapping" ADD CONSTRAINT "StatementLineMapping_fallbackGeneralLedgerId_GeneralLedger_id_fk" FOREIGN KEY ("fallbackGeneralLedgerId") REFERENCES "public"."GeneralLedger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "StatementLineMapping" ADD CONSTRAINT "StatementLineMapping_line_scope_fk" FOREIGN KEY ("lineId","templateId","statement") REFERENCES "public"."StatementLine"("id","templateId","statement") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "StatementTemplate" ADD CONSTRAINT "StatementTemplate_companyId_Company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "StatementTemplate" ADD CONSTRAINT "StatementTemplate_createdBy_User_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "StatementLine_id_templateId_key" ON "StatementLine" USING btree ("id","templateId");--> statement-breakpoint
CREATE UNIQUE INDEX "StatementLine_templateId_statement_code_key" ON "StatementLine" USING btree ("templateId","statement","code");--> statement-breakpoint
CREATE UNIQUE INDEX "StatementLine_templateId_role_singleton_key" ON "StatementLine" USING btree ("templateId","role") WHERE "StatementLine"."role" IS NOT NULL AND "StatementLine"."role" <> 'SCOE_COLUMN';--> statement-breakpoint
CREATE INDEX "StatementLine_templateId_statement_sortOrder_idx" ON "StatementLine" USING btree ("templateId","statement","sortOrder");--> statement-breakpoint
CREATE INDEX "StatementLine_parentLineId_idx" ON "StatementLine" USING btree ("parentLineId");--> statement-breakpoint
CREATE UNIQUE INDEX "StatementLineFormula_line_term_key" ON "StatementLineFormula" USING btree ("lineId","termLineId");--> statement-breakpoint
CREATE INDEX "StatementLineFormula_line_sortOrder_idx" ON "StatementLineFormula" USING btree ("lineId","sortOrder");--> statement-breakpoint
CREATE INDEX "StatementLineMapping_template_statement_line_idx" ON "StatementLineMapping" USING btree ("templateId","statement","lineId");--> statement-breakpoint
CREATE INDEX "StatementLineMapping_fallbackGeneralLedgerId_idx" ON "StatementLineMapping" USING btree ("fallbackGeneralLedgerId");--> statement-breakpoint
CREATE UNIQUE INDEX "StatementLineMapping_group_target_key" ON "StatementLineMapping" USING btree ("templateId","statement","accountGroupId") WHERE "StatementLineMapping"."accountGroupId" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "StatementLineMapping_subgroup_target_key" ON "StatementLineMapping" USING btree ("templateId","statement","accountSubGroupId") WHERE "StatementLineMapping"."accountSubGroupId" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "StatementLineMapping_ledger_target_key" ON "StatementLineMapping" USING btree ("templateId","statement","generalLedgerId") WHERE "StatementLineMapping"."generalLedgerId" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "StatementLineMapping_glSetupRole_target_key" ON "StatementLineMapping" USING btree ("templateId","statement","glSetupRole") WHERE "StatementLineMapping"."glSetupRole" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "StatementLineMapping_fallbackLedger_target_key" ON "StatementLineMapping" USING btree ("templateId","statement","fallbackGeneralLedgerId") WHERE "StatementLineMapping"."fallbackGeneralLedgerId" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "StatementLineMapping_accountFlag_target_key" ON "StatementLineMapping" USING btree ("templateId","statement","accountFlag") WHERE "StatementLineMapping"."accountFlag" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "StatementTemplate_id_companyId_key" ON "StatementTemplate" USING btree ("id","companyId");--> statement-breakpoint
CREATE UNIQUE INDEX "StatementTemplate_companyId_name_key" ON "StatementTemplate" USING btree ("companyId",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "StatementTemplate_companyId_default_key" ON "StatementTemplate" USING btree ("companyId") WHERE "StatementTemplate"."isDefault" = true AND "StatementTemplate"."isActive" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "StatementTemplate_companyId_system_key" ON "StatementTemplate" USING btree ("companyId") WHERE "StatementTemplate"."isSystem" = true AND "StatementTemplate"."isActive" = true;--> statement-breakpoint
CREATE INDEX "StatementTemplate_companyId_idx" ON "StatementTemplate" USING btree ("companyId");
