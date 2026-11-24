-- Add OPENING_STOCK to the StockSourceType enum by replacing the type (a freshly added enum value cannot be used in the same migration run).
ALTER TYPE "public"."StockSourceType" RENAME TO "StockSourceType_old";--> statement-breakpoint
CREATE TYPE "public"."StockSourceType" AS ENUM('PURCHASE_CHALLAN', 'PURCHASE_BILL', 'SALES_CHALLAN', 'SALES_INVOICE', 'OPENING_STOCK');--> statement-breakpoint
ALTER TABLE "StockMovement" ALTER COLUMN "sourceType" TYPE "public"."StockSourceType" USING "sourceType"::text::"public"."StockSourceType";--> statement-breakpoint
DROP TYPE "public"."StockSourceType_old";
