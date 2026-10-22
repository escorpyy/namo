ALTER TABLE "PurchaseBillImportDetail" DROP CONSTRAINT "PurchaseBillImportDetail_amounts_check";--> statement-breakpoint
-- The watching trigger must go before the column can be retyped; it is recreated below.
DROP TRIGGER namo_bill_type_change ON public."PurchaseBill";
--> statement-breakpoint
ALTER TABLE "PurchaseBill" ALTER COLUMN "invoiceType" SET DATA TYPE text;
--> statement-breakpoint
-- "Taxable Capital" is retired: such a bill is a domestic purchase of capital goods.
UPDATE "PurchaseBill" SET "invoiceType" = 'LOCAL', "purchaseType" = 'GOODS_PURCHASE_CAPITAL' WHERE "invoiceType" = 'TAXABLE_CAPITAL';--> statement-breakpoint
ALTER TABLE "PurchaseBill" ALTER COLUMN "invoiceType" SET DEFAULT 'LOCAL'::text;--> statement-breakpoint
DROP TYPE "public"."PurchaseInvoiceType";--> statement-breakpoint
CREATE TYPE "public"."PurchaseInvoiceType" AS ENUM('LOCAL', 'IMPORT');--> statement-breakpoint
ALTER TABLE "PurchaseBill" ALTER COLUMN "invoiceType" SET DEFAULT 'LOCAL'::"public"."PurchaseInvoiceType";--> statement-breakpoint
ALTER TABLE "PurchaseBill" ALTER COLUMN "invoiceType" SET DATA TYPE "public"."PurchaseInvoiceType" USING "invoiceType"::"public"."PurchaseInvoiceType";--> statement-breakpoint
ALTER TABLE "PurchaseBillImportDetail" DROP COLUMN "assessableValue";--> statement-breakpoint
ALTER TABLE "PurchaseBillImportDetail" DROP COLUMN "customsDuty";--> statement-breakpoint
ALTER TABLE "PurchaseBillImportDetail" DROP COLUMN "exciseDuty";--> statement-breakpoint
ALTER TABLE "PurchaseBillImportDetail" DROP COLUMN "importVat";--> statement-breakpoint
ALTER TABLE "PurchaseBillImportDetail" DROP COLUMN "otherCustomsCharges";
--> statement-breakpoint
CREATE TRIGGER namo_bill_type_change BEFORE UPDATE OF "invoiceType" ON public."PurchaseBill" FOR EACH ROW EXECUTE FUNCTION "namo"."check_bill_type_change"();
--> statement-breakpoint

-- ============================================================
-- ADDITIONAL PURCHASE + TERMS
-- PurchaseDocumentTerm / Allocation point at documents by (documentType, documentId); that has no foreign key.
-- Now that bills exist, the database checks it for PURCHASE_BILL.
-- ============================================================

-- One level only: an additional bill points at a main bill, and a main bill cannot itself be additional.
CREATE FUNCTION "namo"."check_additional_bill"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE m integer;
BEGIN
  IF NEW."mainBillId" IS NULL THEN RETURN NEW; END IF;
  SELECT "mainBillId" INTO m FROM public."PurchaseBill" WHERE id = NEW."mainBillId";
  IF m IS NOT NULL THEN
    RAISE EXCEPTION 'Purchase bill % is itself an additional bill; an additional bill must point at a main bill.', NEW."mainBillId"
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM public."PurchaseBill" WHERE "mainBillId" = NEW.id) THEN
    RAISE EXCEPTION 'Purchase bill % already has additional bills, so it cannot become an additional bill.', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER namo_additional_bill_one_level BEFORE INSERT OR UPDATE OF "mainBillId" ON public."PurchaseBill" FOR EACH ROW EXECUTE FUNCTION "namo"."check_additional_bill"();
--> statement-breakpoint

-- A PURCHASE_BILL term must belong to a real bill of the same company; a line term to a line of that bill.
-- ADDITIONAL-category terms (import duty, excise, CSF, ...) are entered on additional bills only.
CREATE FUNCTION "namo"."check_purchase_bill_term"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b record; ln record; cat "BillingTermCategory";
BEGIN
  IF NEW."documentType" <> 'PURCHASE_BILL' THEN RETURN NEW; END IF;
  SELECT id, "companyId", "mainBillId" INTO b FROM public."PurchaseBill" WHERE id = NEW."documentId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase document term points at purchase bill % which does not exist.', NEW."documentId"
      USING ERRCODE = 'check_violation';
  END IF;
  IF b."companyId" <> NEW."companyId" THEN
    RAISE EXCEPTION 'Company mismatch: this term is company % but purchase bill % is company %.', NEW."companyId", b.id, b."companyId"
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."documentLineId" IS NOT NULL THEN
    SELECT "purchaseBillId" INTO ln FROM public."PurchaseBillLine" WHERE id = NEW."documentLineId";
    IF NOT FOUND OR ln."purchaseBillId" <> b.id THEN
      RAISE EXCEPTION 'Line % is not a line of purchase bill %.', NEW."documentLineId", b.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  SELECT category INTO cat FROM public."PurchaseTerm" WHERE id = NEW."termId";
  IF cat = 'ADDITIONAL' AND b."mainBillId" IS NULL THEN
    RAISE EXCEPTION 'An ADDITIONAL purchase term can only be entered on an additional purchase bill (bill % is a main bill).', b.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER namo_purchase_bill_term BEFORE INSERT OR UPDATE OF "documentType", "documentId", "documentLineId", "termId", "companyId" ON public."PurchaseDocumentTerm" FOR EACH ROW EXECUTE FUNCTION "namo"."check_purchase_bill_term"();
--> statement-breakpoint

-- Landed cost: a term's allocation goes to a line of its own bill, or (additional bill) to a line of its MAIN bill.
-- That is how an additional purchase changes the stock value of the main bill's items.
CREATE FUNCTION "namo"."check_purchase_bill_allocation"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tm record; ln record; main_id integer;
BEGIN
  SELECT "documentType", "documentId", "documentLineId" INTO tm FROM public."PurchaseDocumentTerm" WHERE id = NEW."documentTermId";
  IF NOT FOUND OR tm."documentType" <> 'PURCHASE_BILL' THEN RETURN NEW; END IF;
  IF tm."documentLineId" IS NOT NULL THEN
    RAISE EXCEPTION 'A line-level term is already on its line and cannot be allocated across lines.'
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT "purchaseBillId" INTO ln FROM public."PurchaseBillLine" WHERE id = NEW."documentLineId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Allocation points at line % which is not a purchase bill line.', NEW."documentLineId"
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT "mainBillId" INTO main_id FROM public."PurchaseBill" WHERE id = tm."documentId";
  IF ln."purchaseBillId" <> tm."documentId" AND ln."purchaseBillId" IS DISTINCT FROM main_id THEN
    RAISE EXCEPTION 'Line % belongs to purchase bill %, which is neither the bill of this term (%) nor its main bill.', NEW."documentLineId", ln."purchaseBillId", tm."documentId"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER namo_purchase_bill_allocation BEFORE INSERT OR UPDATE OF "documentTermId", "documentLineId" ON public."PurchaseDocumentTermAllocation" FOR EACH ROW EXECUTE FUNCTION "namo"."check_purchase_bill_allocation"();
--> statement-breakpoint

-- Deleting a bill removes its terms (their allocations cascade). Deleting a bill line removes its own bill's
-- allocations to it, but is refused while an ADDITIONAL bill's term still allocates cost to it.
CREATE FUNCTION "namo"."cleanup_purchase_bill_terms"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM public."PurchaseDocumentTerm" WHERE "documentType" = 'PURCHASE_BILL' AND "documentId" = OLD.id;
  RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER namo_purchase_bill_term_cleanup AFTER DELETE ON public."PurchaseBill" FOR EACH ROW EXECUTE FUNCTION "namo"."cleanup_purchase_bill_terms"();
--> statement-breakpoint
CREATE FUNCTION "namo"."guard_bill_line_delete"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public."PurchaseDocumentTermAllocation" a
      JOIN public."PurchaseDocumentTerm" t ON t.id = a."documentTermId"
     WHERE a."documentLineId" = OLD.id AND t."documentType" = 'PURCHASE_BILL' AND t."documentId" <> OLD."purchaseBillId"
  ) THEN
    RAISE EXCEPTION 'Line % still carries cost allocated by an additional purchase bill; remove that allocation first.', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  DELETE FROM public."PurchaseDocumentTermAllocation" WHERE "documentLineId" = OLD.id;
  RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER namo_bill_line_delete BEFORE DELETE ON public."PurchaseBillLine" FOR EACH ROW EXECUTE FUNCTION "namo"."guard_bill_line_delete"();
