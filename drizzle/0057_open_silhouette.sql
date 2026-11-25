CREATE TYPE "public"."BillingVatTreatment" AS ENUM('NONE', 'INPUT_VAT', 'OUTPUT_VAT', 'IMPORT_INPUT_VAT', 'NON_RECOVERABLE_VAT');--> statement-breakpoint
ALTER TABLE "PurchaseDocumentTerm" ADD COLUMN "vatTreatment" "BillingVatTreatment" DEFAULT 'NONE' NOT NULL;--> statement-breakpoint
ALTER TABLE "PurchaseTerm" ADD COLUMN "vatTreatment" "BillingVatTreatment" DEFAULT 'NONE' NOT NULL;--> statement-breakpoint
ALTER TABLE "SalesDocumentTerm" ADD COLUMN "vatTreatment" "BillingVatTreatment" DEFAULT 'NONE' NOT NULL;--> statement-breakpoint
ALTER TABLE "SalesTerm" ADD COLUMN "vatTreatment" "BillingVatTreatment" DEFAULT 'NONE' NOT NULL;--> statement-breakpoint
ALTER TABLE "PurchaseImportAssessmentTerm" ADD COLUMN "vatTreatment" "BillingVatTreatment" DEFAULT 'NONE' NOT NULL;