CREATE TYPE "public"."RoundingMethod" AS ENUM('NEAREST', 'UP', 'DOWN');--> statement-breakpoint
ALTER TABLE "PurchaseTerm" ADD COLUMN "roundingMethod" "RoundingMethod" DEFAULT 'NEAREST' NOT NULL;--> statement-breakpoint
ALTER TABLE "SalesTerm" ADD COLUMN "roundingMethod" "RoundingMethod" DEFAULT 'NEAREST' NOT NULL;