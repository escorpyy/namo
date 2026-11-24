-- Opening stock enters the stock ledger (dated the first day of its fiscal year), so sales can draw on it and valuation counts it.
-- One movement per StockOpeningBalance row: sourceId = fiscalYearId, sourceLineId = the StockOpeningBalance id. The row's rate is the cost.
INSERT INTO "StockMovement" ("companyId", "branchId", "productId", "locationId", "batchNo", "expiryDate", "movementDate", "qty", "sourceType", "sourceId", "sourceLineId")
SELECT b."companyId", o."branchId", sd."productId", o."locationId", o."batchNo", o."expiryDate", fy."startDate", o."quantity", 'OPENING_STOCK', o."fiscalYearId", o."id"
  FROM "StockOpeningBalance" o
  JOIN "Branch" b ON b.id = o."branchId"
  JOIN "StockDetail" sd ON sd.id = o."stockDetailId"
  JOIN "FiscalYear" fy ON fy.id = o."fiscalYearId"
 WHERE o."quantity" > 0;
