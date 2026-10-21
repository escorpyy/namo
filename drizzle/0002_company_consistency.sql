-- ERP-015: company consistency for EVERY tenant-scoped table, enforced by the database.
-- Rule: a record and every record it links to must belong to the same company, and a record can never change company.
-- Data-driven: namo.company_source says where each table gets its company; namo.company_link lists the links that must agree.
-- One generic trigger (namo.enforce_company) reads those tables; namo.company_violations() audits existing data at any time.
-- Violations raise SQLSTATE 23514 (check_violation). Tests: tests/db.companyConsistency.test.ts (fails if a new FK between tenant tables is not covered).

CREATE SCHEMA "namo";
--> statement-breakpoint

-- tbl gets its company from: its own "companyId" (via_col NULL), or from the first non-null owner column in `ord` order.
CREATE TABLE "namo"."company_source" (
  tbl     text    NOT NULL,
  ord     integer NOT NULL,
  via_col text,
  via_tbl text,
  PRIMARY KEY (tbl, ord),
  CHECK ((via_col IS NULL) = (via_tbl IS NULL))
);
--> statement-breakpoint

-- tbl.col points at link_tbl.id and both must be in the same company.
CREATE TABLE "namo"."company_link" (
  tbl      text NOT NULL,
  col      text NOT NULL,
  link_tbl text NOT NULL,
  PRIMARY KEY (tbl, col)
);
--> statement-breakpoint

INSERT INTO "namo"."company_source" (tbl, ord, via_col, via_tbl) VALUES
  ('AccountGroup', 1, NULL, NULL),
  ('Agent', 1, NULL, NULL),
  ('Area', 1, NULL, NULL),
  ('Branch', 1, NULL, NULL),
  ('CashBankVoucher', 1, NULL, NULL),
  ('Company', 1, NULL, NULL),
  ('FiscalYear', 1, NULL, NULL),
  ('GeneralLedger', 1, NULL, NULL),
  ('JournalVoucher', 1, NULL, NULL),
  ('Location', 1, NULL, NULL),
  ('OpeningBalance', 1, NULL, NULL),
  ('Party', 1, NULL, NULL),
  ('Product', 1, NULL, NULL),
  ('ProductGroup', 1, NULL, NULL),
  ('ProductUnit', 1, NULL, NULL),
  ('PurchaseDocumentTerm', 1, NULL, NULL),
  ('PurchaseTerm', 1, NULL, NULL),
  ('SalesDocumentTerm', 1, NULL, NULL),
  ('SalesTerm', 1, NULL, NULL),
  ('StockCategory', 1, NULL, NULL),
  ('TaxRate', 1, NULL, NULL),
  ('UserCompanyAccess', 1, NULL, NULL),
  ('AccountSubGroup', 1, 'accountGroupId', 'AccountGroup'),
  ('AlternateUnit', 1, 'stockDetailId', 'StockDetail'),
  ('BundleComponent', 1, 'bundleDetailId', 'BundleDetail'),
  ('BundleDetail', 1, 'productId', 'Product'),
  ('CashBankVoucherLine', 1, 'cashBankVoucherId', 'CashBankVoucher'),
  ('CustomerDetail', 1, 'partyId', 'Party'),
  ('FixedAssetDetail', 1, 'productId', 'Product'),
  ('JournalVoucherLine', 1, 'journalVoucherId', 'JournalVoucher'),
  ('NonStockDetail', 1, 'productId', 'Product'),
  ('ProductSubGroup', 1, 'productGroupId', 'ProductGroup'),
  ('PurchaseDocumentTermAllocation', 1, 'documentTermId', 'PurchaseDocumentTerm'),
  ('PurchaseTermDefault', 1, 'termId', 'PurchaseTerm'),
  ('SalesTermDefault', 1, 'termId', 'SalesTerm'),
  ('ServiceDetail', 1, 'productId', 'Product'),
  ('StockDetail', 1, 'productId', 'Product'),
  ('StockOpeningBalance', 1, 'branchId', 'Branch'),
  ('SubArea', 1, 'areaId', 'Area'),
  ('SubLedger', 1, 'generalLedgerId', 'GeneralLedger'),
  ('VendorDetail', 1, 'partyId', 'Party'),
  ('SubLedger', 2, 'partyId', 'Party');
--> statement-breakpoint

INSERT INTO "namo"."company_link" (tbl, col, link_tbl) VALUES
  ('AlternateUnit', 'unitId', 'ProductUnit'),
  ('BundleComponent', 'componentProductId', 'Product'),
  ('BundleDetail', 'salesGLId', 'GeneralLedger'),
  ('CashBankVoucher', 'branchId', 'Branch'),
  ('CashBankVoucher', 'reversalOfId', 'CashBankVoucher'),
  ('CashBankVoucherLine', 'agentId', 'Agent'),
  ('CashBankVoucherLine', 'generalLedgerId', 'GeneralLedger'),
  ('Company', 'retainedEarningsGLId', 'GeneralLedger'),
  ('FixedAssetDetail', 'accumulatedDeprGLId', 'GeneralLedger'),
  ('FixedAssetDetail', 'assetGLId', 'GeneralLedger'),
  ('FixedAssetDetail', 'depreciationExpenseGLId', 'GeneralLedger'),
  ('FixedAssetDetail', 'locationId', 'Location'),
  ('GeneralLedger', 'accountSubGroupId', 'AccountSubGroup'),
  ('GeneralLedger', 'agentId', 'Agent'),
  ('GeneralLedger', 'parentId', 'GeneralLedger'),
  ('GeneralLedger', 'subAreaId', 'SubArea'),
  ('JournalVoucher', 'branchId', 'Branch'),
  ('JournalVoucher', 'reversalOfId', 'JournalVoucher'),
  ('JournalVoucherLine', 'agentId', 'Agent'),
  ('JournalVoucherLine', 'generalLedgerId', 'GeneralLedger'),
  ('Location', 'parentId', 'Location'),
  ('NonStockDetail', 'purchaseGLId', 'GeneralLedger'),
  ('NonStockDetail', 'salesGLId', 'GeneralLedger'),
  ('NonStockDetail', 'taxRateId', 'TaxRate'),
  ('NonStockDetail', 'unitId', 'ProductUnit'),
  ('OpeningBalance', 'branchId', 'Branch'),
  ('OpeningBalance', 'carriedForwardFromId', 'OpeningBalance'),
  ('OpeningBalance', 'fiscalYearId', 'FiscalYear'),
  ('OpeningBalance', 'generalLedgerId', 'GeneralLedger'),
  ('OpeningBalance', 'subLedgerId', 'SubLedger'),
  ('Party', 'agentId', 'Agent'),
  ('Party', 'generalLedgerId', 'GeneralLedger'),
  ('Party', 'subAreaId', 'SubArea'),
  ('Product', 'productSubGroupId', 'ProductSubGroup'),
  ('PurchaseDocumentTerm', 'generalLedgerId', 'GeneralLedger'),
  ('PurchaseDocumentTerm', 'termId', 'PurchaseTerm'),
  ('PurchaseTerm', 'baseTermId', 'PurchaseTerm'),
  ('PurchaseTerm', 'generalLedgerId', 'GeneralLedger'),
  ('PurchaseTermDefault', 'partyId', 'Party'),
  ('PurchaseTermDefault', 'productId', 'Product'),
  ('SalesDocumentTerm', 'generalLedgerId', 'GeneralLedger'),
  ('SalesDocumentTerm', 'termId', 'SalesTerm'),
  ('SalesTerm', 'baseTermId', 'SalesTerm'),
  ('SalesTerm', 'generalLedgerId', 'GeneralLedger'),
  ('SalesTermDefault', 'partyId', 'Party'),
  ('SalesTermDefault', 'productId', 'Product'),
  ('ServiceDetail', 'purchaseGLId', 'GeneralLedger'),
  ('ServiceDetail', 'salesGLId', 'GeneralLedger'),
  ('ServiceDetail', 'taxRateId', 'TaxRate'),
  ('ServiceDetail', 'unitId', 'ProductUnit'),
  ('StockDetail', 'baseUnitId', 'ProductUnit'),
  ('StockDetail', 'closingBSGLId', 'GeneralLedger'),
  ('StockDetail', 'closingPLGLId', 'GeneralLedger'),
  ('StockDetail', 'defaultLocationId', 'Location'),
  ('StockDetail', 'defaultVendorId', 'Party'),
  ('StockDetail', 'openingGLId', 'GeneralLedger'),
  ('StockDetail', 'purchaseGLId', 'GeneralLedger'),
  ('StockDetail', 'purchaseReturnGLId', 'GeneralLedger'),
  ('StockDetail', 'salesGLId', 'GeneralLedger'),
  ('StockDetail', 'salesReturnGLId', 'GeneralLedger'),
  ('StockDetail', 'stockCategoryId', 'StockCategory'),
  ('StockDetail', 'taxRateId', 'TaxRate'),
  ('StockOpeningBalance', 'carriedForwardFromId', 'StockOpeningBalance'),
  ('StockOpeningBalance', 'fiscalYearId', 'FiscalYear'),
  ('StockOpeningBalance', 'locationId', 'Location'),
  ('StockOpeningBalance', 'stockDetailId', 'StockDetail'),
  ('SubLedger', 'partyId', 'Party'),
  ('UserCompanyAccess', 'branchId', 'Branch');
--> statement-breakpoint

-- The company a row belongs to (NULL if it has no owner yet).
CREATE FUNCTION "namo"."company_of"(p_tbl text, p_row jsonb) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE s record; v integer; owner jsonb; known boolean := false;
BEGIN
  IF p_tbl = 'Company' THEN RETURN (p_row->>'id')::integer; END IF;
  FOR s IN SELECT via_col, via_tbl FROM "namo"."company_source" WHERE tbl = p_tbl ORDER BY ord LOOP
    known := true;
    IF s.via_col IS NULL THEN RETURN (p_row->>'companyId')::integer; END IF;
    v := (p_row->>s.via_col)::integer;
    IF v IS NOT NULL THEN
      EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE t.id = $1', s.via_tbl) INTO owner USING v;
      IF owner IS NULL THEN RETURN NULL; END IF;
      RETURN "namo"."company_of"(s.via_tbl, owner);
    END IF;
  END LOOP;
  IF NOT known THEN RAISE EXCEPTION 'Table % is not registered in namo.company_source', p_tbl; END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint

-- Audit: every existing row that breaks a rule, or whose company cannot be determined. Empty result = consistent.
CREATE FUNCTION "namo"."company_violations"() RETURNS TABLE (tbl text, row_id integer, col text, detail text) LANGUAGE plpgsql AS $$
DECLARE l record;
BEGIN
  FOR l IN SELECT DISTINCT s.tbl AS t FROM "namo"."company_source" s ORDER BY 1 LOOP
    RETURN QUERY EXECUTE format(
      'SELECT %L::text, t.id, %L::text, %L::text FROM public.%I t WHERE "namo"."company_of"(%L, to_jsonb(t)) IS NULL',
      l.t, '(owner)', 'company cannot be determined', l.t, l.t);
  END LOOP;
  FOR l IN SELECT k.tbl AS t, k.col AS c, k.link_tbl AS p FROM "namo"."company_link" k ORDER BY 1, 2 LOOP
    RETURN QUERY EXECUTE format(
      'SELECT %L::text, t.id, %L::text, ''company ''||coalesce("namo"."company_of"(%L, to_jsonb(t))::text, ''?'')||'' vs linked record company ''||coalesce("namo"."company_of"(%L, to_jsonb(x))::text, ''?'')
         FROM public.%I t JOIN public.%I x ON x.id = t.%I
        WHERE "namo"."company_of"(%L, to_jsonb(t)) IS DISTINCT FROM "namo"."company_of"(%L, to_jsonb(x))',
      l.t, l.c, l.t, l.p, l.t, l.p, l.c, l.t, l.p);
  END LOOP;
END $$;
--> statement-breakpoint

-- Pre-flight: refuse to install over data that already breaks the rules (the whole migration rolls back; nothing changes).
DO $$
DECLARE n integer; sample text;
BEGIN
  SELECT count(*), string_agg(tbl || '#' || row_id || '.' || col, ', ') INTO n, sample
    FROM (SELECT * FROM "namo"."company_violations"() LIMIT 10) v;
  IF n > 0 THEN
    RAISE EXCEPTION 'Cannot install company-consistency triggers: existing data breaks the rule (first rows: %). Fix this data first.', sample
      USING ERRCODE = 'check_violation';
  END IF;
END $$;
--> statement-breakpoint

CREATE FUNCTION "namo"."enforce_company"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  new_row jsonb := to_jsonb(NEW);
  new_co integer; old_co integer; l record; v integer; target jsonb; target_co integer;
BEGIN
  new_co := "namo"."company_of"(TG_TABLE_NAME, new_row);
  IF new_co IS NULL THEN
    RAISE EXCEPTION 'Cannot determine the company of this % record: no company or owner is set.', TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    old_co := "namo"."company_of"(TG_TABLE_NAME, to_jsonb(OLD));
    IF old_co IS DISTINCT FROM new_co THEN
      RAISE EXCEPTION 'The company of a % record cannot be changed (company % -> %).', TG_TABLE_NAME, old_co, new_co
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  FOR l IN SELECT k.col, k.link_tbl FROM "namo"."company_link" k WHERE k.tbl = TG_TABLE_NAME LOOP
    v := (new_row->>l.col)::integer;
    CONTINUE WHEN v IS NULL;
    EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE t.id = $1', l.link_tbl) INTO target USING v;
    CONTINUE WHEN target IS NULL;  -- dangling id: the foreign key reports that
    target_co := "namo"."company_of"(l.link_tbl, target);
    IF target_co IS DISTINCT FROM new_co THEN
      RAISE EXCEPTION 'Company mismatch: %.% points to a record of company % but this % record belongs to company %.', TG_TABLE_NAME, l.col, target_co, TG_TABLE_NAME, new_co
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
--> statement-breakpoint

-- One trigger per registered table, firing only when a company-relevant column is written.
-- Named with a lowercase prefix so it runs AFTER the more specific ERP-003 triggers (their messages win).
DO $$
DECLARE r record; cols text;
BEGIN
  FOR r IN SELECT DISTINCT x.t FROM (SELECT tbl AS t FROM "namo"."company_source" UNION SELECT tbl FROM "namo"."company_link") x ORDER BY 1 LOOP
    SELECT string_agg(DISTINCT quote_ident(c), ', ') INTO cols FROM (
      SELECT 'companyId'::text AS c FROM "namo"."company_source" WHERE tbl = r.t AND via_col IS NULL AND r.t <> 'Company'
      UNION SELECT via_col FROM "namo"."company_source" WHERE tbl = r.t AND via_col IS NOT NULL
      UNION SELECT col FROM "namo"."company_link" WHERE tbl = r.t
    ) q;
    EXECUTE format('CREATE TRIGGER namo_company_consistency BEFORE INSERT OR UPDATE OF %s ON public.%I FOR EACH ROW EXECUTE FUNCTION "namo"."enforce_company"()', cols, r.t);
  END LOOP;
END $$;
