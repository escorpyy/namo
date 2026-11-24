-- Cost of one unit of what a purchase document brought in (NPR). Computed live, so a later cost assessment changes the valuation.
--   bill line     : the latest applied import assessment's landed rate for the line, else the bill line's own landed rate;
--                   a reversal bill's line costs what the line it reverses cost
--   challan line  : the qty-weighted cost of the standing bill lines that bill it, else the challan's own (indicative) rate
CREATE OR REPLACE FUNCTION "namo"."purchase_line_cost"(p_line integer) RETURNS numeric LANGUAGE sql STABLE AS $$
  WITH l AS (
    SELECT bl.id, bl."lineNumber", b."reversalOfId" FROM "PurchaseBillLine" bl JOIN "PurchaseBill" b ON b.id = bl."purchaseBillId" WHERE bl.id = p_line
  ), eff AS (
    SELECT COALESCE((SELECT ol.id FROM "PurchaseBillLine" ol WHERE ol."purchaseBillId" = l."reversalOfId" AND ol."lineNumber" = l."lineNumber"), l.id) AS id FROM l
  )
  SELECT COALESCE(
    (SELECT a."landedRate" FROM "PurchaseImportAssessmentLine" a JOIN "PurchaseImportAssessment" pa ON pa.id = a."assessmentId"
      WHERE a."purchaseBillLineId" = eff.id AND pa."isPosted" AND pa."reversedAt" IS NULL ORDER BY pa.id DESC LIMIT 1),
    (SELECT x."landedRate" FROM "PurchaseBillLine" x WHERE x.id = eff.id)
  ) FROM eff
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "namo"."purchase_challan_line_cost"(p_line integer) RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT sum(bl.qty * "namo"."purchase_line_cost"(bl.id)) / NULLIF(sum(bl.qty), 0)
       FROM "PurchaseBillLine" bl JOIN "PurchaseBill" b ON b.id = bl."purchaseBillId"
      WHERE bl."challanLineId" = p_line AND b."isPosted" AND b."reversalOfId" IS NULL
        AND NOT EXISTS (SELECT 1 FROM "PurchaseBill" r WHERE r."reversalOfId" = b.id AND r."isPosted")),
    (SELECT c.rate FROM "PurchaseChallanLine" c WHERE c.id = p_line)
  )
$$;
