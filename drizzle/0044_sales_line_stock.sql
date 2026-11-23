ALTER TABLE "SalesInvoiceLine" ADD COLUMN "locationId" integer REFERENCES "Location"("id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "SalesInvoiceLine" ADD COLUMN "batchNo" varchar(50);--> statement-breakpoint
ALTER TABLE "SalesInvoiceLine" ADD COLUMN "expiryDate" date;--> statement-breakpoint
CREATE INDEX "SalesInvoiceLine_locationId_idx" ON "SalesInvoiceLine" USING btree ("locationId");--> statement-breakpoint
INSERT INTO "namo"."company_link" (tbl, col, link_tbl) VALUES ('SalesInvoiceLine', 'locationId', 'Location');--> statement-breakpoint
DROP TRIGGER namo_company_consistency ON public."SalesInvoiceLine";--> statement-breakpoint
CREATE TRIGGER namo_company_consistency BEFORE INSERT OR UPDATE OF "salesInvoiceId", "productId", "altUnitId", "unitId", "locationId" ON public."SalesInvoiceLine" FOR EACH ROW EXECUTE FUNCTION "namo"."enforce_company"();
