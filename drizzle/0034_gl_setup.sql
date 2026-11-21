-- Company-level GL role mappings and entry-control permissions.
CREATE TABLE "GeneralLedgerSetup" (
  "id" serial PRIMARY KEY,
  "companyId" integer NOT NULL REFERENCES "Company"("id") ON DELETE RESTRICT,
  "role" varchar(32) NOT NULL,
  "generalLedgerId" integer REFERENCES "GeneralLedger"("id") ON DELETE RESTRICT,
  "allowJournal" boolean NOT NULL DEFAULT false,
  "allowCashBank" boolean NOT NULL DEFAULT false,
  "allowSalesInvoice" boolean NOT NULL DEFAULT false,
  "allowSalesReturn" boolean NOT NULL DEFAULT false,
  "allowPurchaseBill" boolean NOT NULL DEFAULT false,
  "allowPurchaseReturn" boolean NOT NULL DEFAULT false,
  "allowOpeningBalance" boolean NOT NULL DEFAULT false,
  "allowStockOpening" boolean NOT NULL DEFAULT false,
  "isLocked" boolean NOT NULL DEFAULT false,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "GeneralLedgerSetup_role_check" CHECK ("role" IN ('PROFIT_AND_LOSS','CASH_BOOK','SALES_ACCOUNT','SALES_RETURN_ACCOUNT','PURCHASE_ACCOUNT','PURCHASE_RETURN_ACCOUNT','OPENING_STOCK_PL','CLOSING_STOCK_PL','CLOSING_STOCK_BS'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "GeneralLedgerSetup_companyId_role_key" ON "GeneralLedgerSetup" USING btree ("companyId", "role");
--> statement-breakpoint
CREATE INDEX "GeneralLedgerSetup_companyId_idx" ON "GeneralLedgerSetup" USING btree ("companyId");
--> statement-breakpoint
CREATE INDEX "GeneralLedgerSetup_generalLedgerId_idx" ON "GeneralLedgerSetup" USING btree ("generalLedgerId");
--> statement-breakpoint
INSERT INTO "namo"."company_source" (tbl, ord, via_col, via_tbl) VALUES ('GeneralLedgerSetup', 1, NULL, NULL);
--> statement-breakpoint
INSERT INTO "namo"."company_link" (tbl, col, link_tbl) VALUES ('GeneralLedgerSetup', 'generalLedgerId', 'GeneralLedger');
--> statement-breakpoint
CREATE TRIGGER namo_company_consistency
  BEFORE INSERT OR UPDATE OF "companyId", "generalLedgerId" ON public."GeneralLedgerSetup"
  FOR EACH ROW EXECUTE FUNCTION "namo"."enforce_company"();
--> statement-breakpoint
CREATE TRIGGER "Audit_trail"
  AFTER INSERT OR UPDATE OR DELETE ON public."GeneralLedgerSetup"
  FOR EACH ROW EXECUTE FUNCTION "namo"."audit_row"();
