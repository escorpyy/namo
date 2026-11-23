ALTER TABLE "StockDetail"
  ADD COLUMN "openingGLDefaulted" boolean NOT NULL DEFAULT false,
  ADD COLUMN "closingPLGLDefaulted" boolean NOT NULL DEFAULT false,
  ADD COLUMN "closingBSGLDefaulted" boolean NOT NULL DEFAULT false,
  ADD COLUMN "purchaseGLDefaulted" boolean NOT NULL DEFAULT false,
  ADD COLUMN "purchaseReturnGLDefaulted" boolean NOT NULL DEFAULT false,
  ADD COLUMN "salesGLDefaulted" boolean NOT NULL DEFAULT false,
  ADD COLUMN "salesReturnGLDefaulted" boolean NOT NULL DEFAULT false;

ALTER TABLE "NonStockDetail"
  ADD COLUMN "salesGLDefaulted" boolean NOT NULL DEFAULT false,
  ADD COLUMN "purchaseGLDefaulted" boolean NOT NULL DEFAULT false;
