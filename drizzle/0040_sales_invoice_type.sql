CREATE TYPE "public"."SalesInvoiceType" AS ENUM('LOCAL', 'EXPORT');--> statement-breakpoint
CREATE TYPE "public"."SalesType" AS ENUM('GOODS_SALES', 'SERVICE_SALES');--> statement-breakpoint
ALTER TABLE "SalesInvoice" ADD COLUMN "invoiceType" "SalesInvoiceType" DEFAULT 'LOCAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "SalesInvoice" ADD COLUMN "salesType" "SalesType" DEFAULT 'GOODS_SALES' NOT NULL;--> statement-breakpoint
-- invoices made before this column: an invoice whose lines are all service products is a service sale
UPDATE "SalesInvoice" i SET "salesType" = 'SERVICE_SALES'
WHERE EXISTS (SELECT 1 FROM "SalesInvoiceLine" l WHERE l."salesInvoiceId" = i.id)
  AND NOT EXISTS (SELECT 1 FROM "SalesInvoiceLine" l JOIN "Product" p ON p.id = l."productId" WHERE l."salesInvoiceId" = i.id AND p."type" <> 'SERVICE');
