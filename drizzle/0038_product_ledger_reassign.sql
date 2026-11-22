-- A product's purchase / sales / asset ledger decides where its bills and invoices post. Those masters (and the product header) are now in the audit trail,
-- and the background ledger move is bounded to the periods the old ledger was in force and remember which documents it already moved.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Product', 'StockDetail', 'NonStockDetail', 'ServiceDetail', 'FixedAssetDetail', 'BundleDetail'] LOOP
    EXECUTE format('CREATE TRIGGER "Audit_trail" AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION "namo"."audit_row"()', t);
  END LOOP;
END
$$;
--> statement-breakpoint
ALTER TABLE "LedgerReassignJob" ADD COLUMN "windows" jsonb;
--> statement-breakpoint
CREATE TABLE "LedgerReassignItem" (
	"id" serial PRIMARY KEY NOT NULL,
	"jobId" integer NOT NULL,
	"documentType" varchar(20) NOT NULL,
	"documentId" integer NOT NULL,
	CONSTRAINT "LedgerReassignItem_type_check" CHECK ("LedgerReassignItem"."documentType" IN ('PURCHASE_BILL', 'SALES_INVOICE'))
);
--> statement-breakpoint
ALTER TABLE "LedgerReassignItem" ADD CONSTRAINT "LedgerReassignItem_jobId_LedgerReassignJob_id_fk" FOREIGN KEY ("jobId") REFERENCES "public"."LedgerReassignJob"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "LedgerReassignItem_job_document_key" ON "LedgerReassignItem" USING btree ("jobId","documentType","documentId");
--> statement-breakpoint
INSERT INTO "namo"."company_source" (tbl, ord, via_col, via_tbl) VALUES ('LedgerReassignItem', 1, 'jobId', 'LedgerReassignJob');
