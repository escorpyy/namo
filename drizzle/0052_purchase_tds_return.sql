-- TDS flag on the bill: the bill only says "tax is to be deducted when this bill is paid". The rate and the deduction itself belong to the TDS app / the payment.
ALTER TABLE "PurchaseBill" ADD COLUMN "tdsApplicable" boolean DEFAULT false NOT NULL;--> statement-breakpoint

-- Purchase return (debit note): a bill of its own that points at the posted bill it sends goods back from. Each of its lines points at the original line.
ALTER TABLE "PurchaseBill" ADD COLUMN "returnOfBillId" integer;--> statement-breakpoint
ALTER TABLE "PurchaseBill" ADD CONSTRAINT "PurchaseBill_returnOfBillId_PurchaseBill_id_fk" FOREIGN KEY ("returnOfBillId") REFERENCES "public"."PurchaseBill"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "PurchaseBill_returnOfBillId_idx" ON "PurchaseBill" USING btree ("returnOfBillId");--> statement-breakpoint
ALTER TABLE "PurchaseBill" ADD CONSTRAINT "PurchaseBill_return_check" CHECK ("PurchaseBill"."returnOfBillId" IS NULL OR ("PurchaseBill"."returnOfBillId" <> "PurchaseBill"."id" AND "PurchaseBill"."mainBillId" IS NULL AND "PurchaseBill"."reversalOfId" IS NULL AND "PurchaseBill"."importCostForBillId" IS NULL));--> statement-breakpoint
INSERT INTO "namo"."company_link" (tbl, col, link_tbl) VALUES ('PurchaseBill', 'returnOfBillId', 'PurchaseBill');--> statement-breakpoint

ALTER TABLE "PurchaseBillLine" ADD COLUMN "returnOfLineId" integer;--> statement-breakpoint
ALTER TABLE "PurchaseBillLine" ADD CONSTRAINT "PurchaseBillLine_returnOfLineId_PurchaseBillLine_id_fk" FOREIGN KEY ("returnOfLineId") REFERENCES "public"."PurchaseBillLine"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "PurchaseBillLine_returnOfLineId_idx" ON "PurchaseBillLine" USING btree ("returnOfLineId");--> statement-breakpoint
INSERT INTO "namo"."company_link" (tbl, col, link_tbl) VALUES ('PurchaseBillLine', 'returnOfLineId', 'PurchaseBillLine');
