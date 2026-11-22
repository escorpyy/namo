ALTER TABLE "PurchaseBillLine" ADD COLUMN "foreignRate" numeric(18,6);--> statement-breakpoint
ALTER TABLE "PurchaseBillLine" ADD COLUMN "foreignAmount" numeric(18,6);--> statement-breakpoint
-- drafts that already carry a foreign currency: derive what the person typed in it from the NPR figures (posted bills are left as they are)
UPDATE "PurchaseBillLine" l SET
  "foreignRate" = round(l."rate" / d."exchangeRate", 6),
  "foreignAmount" = round(l."qty" * round(l."rate" / d."exchangeRate", 6), 2)
FROM "PurchaseBillImportDetail" d JOIN "PurchaseBill" b ON b.id = d."purchaseBillId"
WHERE l."purchaseBillId" = b.id AND b."isPosted" = false AND d."currencyCode" IS NOT NULL AND d."currencyCode" <> 'NPR' AND d."exchangeRate" > 0;
