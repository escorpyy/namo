CREATE TYPE "public"."AccountType" AS ENUM('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');--> statement-breakpoint
CREATE TYPE "public"."AuditAction" AS ENUM('INSERT', 'UPDATE', 'DELETE');--> statement-breakpoint
CREATE TYPE "public"."BillingAllocationBasis" AS ENUM('QUANTITY', 'VALUE');--> statement-breakpoint
CREATE TYPE "public"."BillingCalcBase" AS ENUM('ITEM_VALUE', 'RUNNING_TOTAL', 'SINGLE_TERM');--> statement-breakpoint
CREATE TYPE "public"."BillingCalcType" AS ENUM('PERCENT', 'AMOUNT');--> statement-breakpoint
CREATE TYPE "public"."BillingTermCategory" AS ENUM('GENERAL', 'ADDITIONAL', 'ROUNDED');--> statement-breakpoint
CREATE TYPE "public"."BillingTermNature" AS ENUM('ADDITIVE', 'DEDUCTIVE');--> statement-breakpoint
CREATE TYPE "public"."BusinessType" AS ENUM('SOLE_PROPRIETORSHIP', 'PARTNERSHIP', 'PRIVATE_LIMITED', 'PUBLIC_LIMITED', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."CalendarPreference" AS ENUM('BS', 'AD');--> statement-breakpoint
CREATE TYPE "public"."CompanyRole" AS ENUM('ADMIN', 'ACCOUNTANT', 'VIEWER');--> statement-breakpoint
CREATE TYPE "public"."DepreciationMethod" AS ENUM('STRAIGHT_LINE', 'WRITTEN_DOWN_VALUE');--> statement-breakpoint
CREATE TYPE "public"."DocumentType" AS ENUM('CASH_BANK_VOUCHER', 'JOURNAL_VOUCHER', 'SALES_INVOICE', 'PURCHASE_BILL');--> statement-breakpoint
CREATE TYPE "public"."GLType" AS ENUM('CUSTOMER', 'VENDOR', 'BOTH', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."InstrumentType" AS ENUM('CHEQUE', 'RTGS', 'ONLINE_TRANSFER', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."NormalBalance" AS ENUM('DEBIT', 'CREDIT');--> statement-breakpoint
CREATE TYPE "public"."ProductType" AS ENUM('STOCK', 'NON_STOCK', 'SERVICE', 'FIXED_ASSET', 'BUNDLE');--> statement-breakpoint
CREATE TYPE "public"."PurchaseTermDocType" AS ENUM('PURCHASE_ORDER', 'PURCHASE_BILL', 'PURCHASE_RETURN');--> statement-breakpoint
CREATE TYPE "public"."SalesTermDocType" AS ENUM('SALES_ORDER', 'SALES_INVOICE', 'SALES_RETURN');--> statement-breakpoint
CREATE TYPE "public"."ValuationMethod" AS ENUM('FIFO', 'WEIGHTED_AVERAGE', 'STANDARD_COST');--> statement-breakpoint
CREATE TABLE "AuditLog" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tableName" varchar(63) NOT NULL,
	"recordId" text NOT NULL,
	"action" "AuditAction" NOT NULL,
	"oldData" jsonb,
	"newData" jsonb,
	"changedBy" integer,
	"changedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Branch" (
	"id" serial PRIMARY KEY NOT NULL,
	"companyId" integer NOT NULL,
	"code" varchar(15) NOT NULL,
	"name" varchar(100) NOT NULL,
	"isHeadOffice" boolean DEFAULT false NOT NULL,
	"address" varchar(300),
	"phone" varchar(20),
	"email" varchar(255),
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Company" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(15) NOT NULL,
	"name" varchar(200) NOT NULL,
	"legalName" varchar(200),
	"businessType" "BusinessType" DEFAULT 'OTHER' NOT NULL,
	"registrationNo" varchar(50),
	"panNo" varchar(25),
	"vatNo" varchar(25),
	"isVatRegistered" boolean DEFAULT false NOT NULL,
	"taxOfficeName" varchar(100),
	"address" varchar(300),
	"city" varchar(50),
	"district" varchar(50),
	"province" varchar(50),
	"country" varchar(50) DEFAULT 'Nepal',
	"phone" varchar(20),
	"email" varchar(255),
	"website" varchar(255),
	"logoUrl" varchar(500),
	"baseCurrency" varchar(3) DEFAULT 'NPR' NOT NULL,
	"defaultCalendarPref" "CalendarPreference" DEFAULT 'BS' NOT NULL,
	"retainedEarningsGLId" integer,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "FiscalYear" (
	"id" serial PRIMARY KEY NOT NULL,
	"companyId" integer NOT NULL,
	"code" varchar(15) NOT NULL,
	"startDate" date NOT NULL,
	"endDate" date NOT NULL,
	"isCurrent" boolean DEFAULT false NOT NULL,
	"isClosed" boolean DEFAULT false NOT NULL,
	"closedAt" timestamp (3),
	"closedBy" integer,
	"isOpeningBalanceLocked" boolean DEFAULT false NOT NULL,
	"openingBalanceLockedAt" timestamp (3),
	"openingBalanceLockedBy" integer,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "User" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"email" varchar(255) NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"calendarPreference" "CalendarPreference" DEFAULT 'BS' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "UserCompanyAccess" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"companyId" integer NOT NULL,
	"branchId" integer,
	"role" "CompanyRole" DEFAULT 'VIEWER' NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "AccountGroup" (
	"id" serial PRIMARY KEY NOT NULL,
	"companyId" integer NOT NULL,
	"code" varchar(10) NOT NULL,
	"description" varchar(50) NOT NULL,
	"type" "AccountType" NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "AccountSubGroup" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(10) NOT NULL,
	"description" varchar(50) NOT NULL,
	"accountGroupId" integer NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "GeneralLedger" (
	"id" serial PRIMARY KEY NOT NULL,
	"companyId" integer NOT NULL,
	"code" varchar(20) NOT NULL,
	"name" varchar(100) NOT NULL,
	"accountSubGroupId" integer NOT NULL,
	"normalBalance" "NormalBalance" NOT NULL,
	"glType" "GLType" DEFAULT 'OTHER' NOT NULL,
	"parentId" integer,
	"isCashOrBank" boolean DEFAULT false NOT NULL,
	"postsToCashBook" boolean DEFAULT false NOT NULL,
	"requiresSubLedger" boolean DEFAULT false NOT NULL,
	"allowDocAdjust" boolean DEFAULT false NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"subAreaId" integer,
	"agentId" integer
);
--> statement-breakpoint
CREATE TABLE "SubLedger" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(20) NOT NULL,
	"name" varchar(100) NOT NULL,
	"generalLedgerId" integer,
	"partyId" integer,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Agent" (
	"id" serial PRIMARY KEY NOT NULL,
	"companyId" integer NOT NULL,
	"code" varchar(10) NOT NULL,
	"name" varchar(100) NOT NULL,
	"phone" varchar(25),
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Area" (
	"id" serial PRIMARY KEY NOT NULL,
	"companyId" integer NOT NULL,
	"code" varchar(10) NOT NULL,
	"name" varchar(50) NOT NULL,
	"shortName" varchar(10) NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "CustomerDetail" (
	"id" serial PRIMARY KEY NOT NULL,
	"partyId" integer NOT NULL,
	"creditLimit" numeric(18, 6),
	"creditDays" integer,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Party" (
	"id" serial PRIMARY KEY NOT NULL,
	"companyId" integer NOT NULL,
	"generalLedgerId" integer NOT NULL,
	"address" varchar(255),
	"city" varchar(50),
	"state" varchar(50),
	"country" varchar(50),
	"phone" varchar(25),
	"mobile" varchar(15),
	"email" varchar(255),
	"contactPerson" varchar(50),
	"panNo" varchar(25),
	"isVatRegistered" boolean DEFAULT false NOT NULL,
	"bankReconcileDate" timestamp (3),
	"subAreaId" integer,
	"agentId" integer,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "SubArea" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(10) NOT NULL,
	"name" varchar(50) NOT NULL,
	"shortName" varchar(10) NOT NULL,
	"areaId" integer NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "VendorDetail" (
	"id" serial PRIMARY KEY NOT NULL,
	"partyId" integer NOT NULL,
	"paymentTermDays" integer,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "CashBankVoucher" (
	"id" serial PRIMARY KEY NOT NULL,
	"companyId" integer NOT NULL,
	"branchId" integer NOT NULL,
	"documentType" "DocumentType" DEFAULT 'CASH_BANK_VOUCHER' NOT NULL,
	"voucherNumber" varchar(30) NOT NULL,
	"voucherDate" date NOT NULL,
	"fiscalYear" varchar(15) NOT NULL,
	"remarks" varchar(1024),
	"reversalOfId" integer,
	"isPosted" boolean DEFAULT false NOT NULL,
	"postedAt" timestamp (3),
	"postedBy" integer,
	"createdBy" integer,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "CashBankVoucherLine" (
	"id" serial PRIMARY KEY NOT NULL,
	"cashBankVoucherId" integer NOT NULL,
	"lineNumber" integer NOT NULL,
	"generalLedgerId" integer NOT NULL,
	"debit" numeric(18, 6) DEFAULT '0' NOT NULL,
	"credit" numeric(18, 6) DEFAULT '0' NOT NULL,
	"narration" varchar(500),
	"instrumentType" "InstrumentType",
	"chequeNumber" varchar(30),
	"chequeDate" date,
	"chequeBankName" varchar(50),
	"chequeBankBranch" varchar(50),
	"isCleared" boolean DEFAULT false NOT NULL,
	"clearedDate" date,
	"clearedBy" integer,
	"agentId" integer,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "JournalVoucher" (
	"id" serial PRIMARY KEY NOT NULL,
	"companyId" integer NOT NULL,
	"branchId" integer NOT NULL,
	"documentType" "DocumentType" DEFAULT 'JOURNAL_VOUCHER' NOT NULL,
	"voucherNumber" varchar(30) NOT NULL,
	"voucherDate" date NOT NULL,
	"fiscalYear" varchar(15) NOT NULL,
	"remarks" varchar(1024),
	"reversalOfId" integer,
	"isPosted" boolean DEFAULT false NOT NULL,
	"postedAt" timestamp (3),
	"postedBy" integer,
	"createdBy" integer,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "JournalVoucherLine" (
	"id" serial PRIMARY KEY NOT NULL,
	"journalVoucherId" integer NOT NULL,
	"lineNumber" integer NOT NULL,
	"generalLedgerId" integer NOT NULL,
	"debit" numeric(18, 6) DEFAULT '0' NOT NULL,
	"credit" numeric(18, 6) DEFAULT '0' NOT NULL,
	"narration" varchar(500),
	"agentId" integer,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "OpeningBalance" (
	"id" serial PRIMARY KEY NOT NULL,
	"companyId" integer NOT NULL,
	"branchId" integer NOT NULL,
	"fiscalYearId" integer NOT NULL,
	"generalLedgerId" integer NOT NULL,
	"subLedgerId" integer,
	"debit" numeric(18, 6) DEFAULT '0' NOT NULL,
	"credit" numeric(18, 6) DEFAULT '0' NOT NULL,
	"remarks" varchar(500),
	"carriedForwardFromId" integer,
	"createdBy" integer,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "StockOpeningBalance" (
	"id" serial PRIMARY KEY NOT NULL,
	"branchId" integer NOT NULL,
	"fiscalYearId" integer NOT NULL,
	"stockDetailId" integer NOT NULL,
	"locationId" integer,
	"batchNo" varchar(50),
	"expiryDate" date,
	"quantity" numeric(18, 6) NOT NULL,
	"rate" numeric(18, 6) NOT NULL,
	"value" numeric(18, 6) NOT NULL,
	"carriedForwardFromId" integer,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "AlternateUnit" (
	"id" serial PRIMARY KEY NOT NULL,
	"stockDetailId" integer NOT NULL,
	"unitId" integer NOT NULL,
	"conversionFactor" numeric(18, 6) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "BundleComponent" (
	"id" serial PRIMARY KEY NOT NULL,
	"bundleDetailId" integer NOT NULL,
	"componentProductId" integer NOT NULL,
	"quantity" numeric(18, 6) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "BundleDetail" (
	"id" serial PRIMARY KEY NOT NULL,
	"productId" integer NOT NULL,
	"salesGLId" integer NOT NULL,
	"bundlePrice" numeric(18, 6),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "FixedAssetDetail" (
	"id" serial PRIMARY KEY NOT NULL,
	"productId" integer NOT NULL,
	"assetGLId" integer NOT NULL,
	"accumulatedDeprGLId" integer NOT NULL,
	"depreciationExpenseGLId" integer NOT NULL,
	"locationId" integer,
	"purchaseDate" date,
	"originalCost" numeric(18, 6),
	"salvageValue" numeric(18, 6) DEFAULT '0' NOT NULL,
	"usefulLifeYears" integer,
	"depreciationMethod" "DepreciationMethod" DEFAULT 'STRAIGHT_LINE' NOT NULL,
	"depreciationRatePercent" numeric(5, 2),
	"accumulatedDepreciation" numeric(18, 6) DEFAULT '0' NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Location" (
	"id" serial PRIMARY KEY NOT NULL,
	"companyId" integer NOT NULL,
	"code" varchar(10) NOT NULL,
	"name" varchar(50) NOT NULL,
	"parentId" integer,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "NonStockDetail" (
	"id" serial PRIMARY KEY NOT NULL,
	"productId" integer NOT NULL,
	"unitId" integer NOT NULL,
	"taxRateId" integer,
	"salesGLId" integer NOT NULL,
	"purchaseGLId" integer NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Product" (
	"id" serial PRIMARY KEY NOT NULL,
	"companyId" integer NOT NULL,
	"code" varchar(10) NOT NULL,
	"description" varchar(256) NOT NULL,
	"shortName" varchar(30),
	"barcode" varchar(64),
	"type" "ProductType" NOT NULL,
	"productSubGroupId" integer NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ProductGroup" (
	"id" serial PRIMARY KEY NOT NULL,
	"companyId" integer NOT NULL,
	"code" varchar(10) NOT NULL,
	"name" varchar(50) NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ProductSubGroup" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(10) NOT NULL,
	"name" varchar(50) NOT NULL,
	"productGroupId" integer NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ProductUnit" (
	"id" serial PRIMARY KEY NOT NULL,
	"companyId" integer NOT NULL,
	"code" varchar(10) NOT NULL,
	"name" varchar(50) NOT NULL,
	"decimalPlaces" integer DEFAULT 0 NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	CONSTRAINT "ProductUnit_decimalPlaces_check" CHECK ("ProductUnit"."decimalPlaces" BETWEEN 0 AND 6)
);
--> statement-breakpoint
CREATE TABLE "ServiceDetail" (
	"id" serial PRIMARY KEY NOT NULL,
	"productId" integer NOT NULL,
	"unitId" integer,
	"taxRateId" integer,
	"salesGLId" integer NOT NULL,
	"purchaseGLId" integer NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "StockCategory" (
	"id" serial PRIMARY KEY NOT NULL,
	"companyId" integer NOT NULL,
	"code" varchar(10) NOT NULL,
	"name" varchar(50) NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "StockDetail" (
	"id" serial PRIMARY KEY NOT NULL,
	"productId" integer NOT NULL,
	"baseUnitId" integer NOT NULL,
	"stockCategoryId" integer,
	"defaultLocationId" integer,
	"taxRateId" integer,
	"valuationMethod" "ValuationMethod" DEFAULT 'WEIGHTED_AVERAGE' NOT NULL,
	"tracksBatch" boolean DEFAULT false NOT NULL,
	"tracksExpiry" boolean DEFAULT false NOT NULL,
	"purchaseRate" numeric(18, 6),
	"salesRate" numeric(18, 6),
	"mrp" numeric(18, 6),
	"tradePrice" numeric(18, 6),
	"minStock" numeric(18, 6),
	"maxStock" numeric(18, 6),
	"reorderLevel" numeric(18, 6),
	"reorderQty" numeric(18, 6),
	"openingGLId" integer,
	"closingPLGLId" integer,
	"closingBSGLId" integer,
	"purchaseGLId" integer,
	"purchaseReturnGLId" integer,
	"salesGLId" integer,
	"salesReturnGLId" integer,
	"defaultVendorId" integer,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "TaxRate" (
	"id" serial PRIMARY KEY NOT NULL,
	"companyId" integer NOT NULL,
	"code" varchar(10) NOT NULL,
	"name" varchar(50) NOT NULL,
	"ratePercent" numeric(5, 2) NOT NULL,
	"hsnSacCode" varchar(20),
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "PurchaseDocumentTerm" (
	"id" serial PRIMARY KEY NOT NULL,
	"companyId" integer NOT NULL,
	"documentType" "PurchaseTermDocType" NOT NULL,
	"documentId" integer NOT NULL,
	"documentLineId" integer,
	"termId" integer NOT NULL,
	"sequence" integer NOT NULL,
	"nature" "BillingTermNature" NOT NULL,
	"calcBase" "BillingCalcBase" NOT NULL,
	"generalLedgerId" integer,
	"distributeToLines" boolean DEFAULT false NOT NULL,
	"allocationBasis" "BillingAllocationBasis",
	"calcType" "BillingCalcType" NOT NULL,
	"rate" numeric(9, 4),
	"inputAmount" numeric(18, 6),
	"baseAmount" numeric(18, 6) DEFAULT '0' NOT NULL,
	"calculatedAmount" numeric(18, 6) DEFAULT '0' NOT NULL,
	"isOverridden" boolean DEFAULT false NOT NULL,
	"finalAmount" numeric(18, 6) DEFAULT '0' NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	CONSTRAINT "PurchaseDocumentTerm_value_check" CHECK (("PurchaseDocumentTerm"."calcType" = 'PERCENT' AND "PurchaseDocumentTerm"."rate" IS NOT NULL) OR ("PurchaseDocumentTerm"."calcType" = 'AMOUNT' AND "PurchaseDocumentTerm"."inputAmount" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "PurchaseDocumentTermAllocation" (
	"id" serial PRIMARY KEY NOT NULL,
	"documentTermId" integer NOT NULL,
	"documentLineId" integer NOT NULL,
	"allocatedAmount" numeric(18, 6) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "PurchaseTerm" (
	"id" serial PRIMARY KEY NOT NULL,
	"companyId" integer NOT NULL,
	"code" varchar(20) NOT NULL,
	"name" varchar(100) NOT NULL,
	"category" "BillingTermCategory" DEFAULT 'GENERAL' NOT NULL,
	"nature" "BillingTermNature" NOT NULL,
	"isProductwise" boolean DEFAULT false NOT NULL,
	"isMandatory" boolean DEFAULT false NOT NULL,
	"sequence" integer DEFAULT 100 NOT NULL,
	"defaultCalcType" "BillingCalcType" DEFAULT 'PERCENT' NOT NULL,
	"defaultValue" numeric(18, 6) DEFAULT '0' NOT NULL,
	"calcBase" "BillingCalcBase" DEFAULT 'ITEM_VALUE' NOT NULL,
	"baseTermId" integer,
	"distributeToLines" boolean DEFAULT false NOT NULL,
	"allocationBasis" "BillingAllocationBasis",
	"generalLedgerId" integer,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	CONSTRAINT "PurchaseTerm_base_term_check" CHECK (("PurchaseTerm"."calcBase" = 'SINGLE_TERM') = ("PurchaseTerm"."baseTermId" IS NOT NULL)),
	CONSTRAINT "PurchaseTerm_distribute_check" CHECK (NOT "PurchaseTerm"."distributeToLines" OR (NOT "PurchaseTerm"."isProductwise" AND "PurchaseTerm"."allocationBasis" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "PurchaseTermDefault" (
	"id" serial PRIMARY KEY NOT NULL,
	"termId" integer NOT NULL,
	"partyId" integer,
	"productId" integer,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "PurchaseTermDefault_one_target_check" CHECK (num_nonnulls("PurchaseTermDefault"."partyId", "PurchaseTermDefault"."productId") = 1)
);
--> statement-breakpoint
CREATE TABLE "SalesDocumentTerm" (
	"id" serial PRIMARY KEY NOT NULL,
	"companyId" integer NOT NULL,
	"documentType" "SalesTermDocType" NOT NULL,
	"documentId" integer NOT NULL,
	"documentLineId" integer,
	"termId" integer NOT NULL,
	"sequence" integer NOT NULL,
	"nature" "BillingTermNature" NOT NULL,
	"calcBase" "BillingCalcBase" NOT NULL,
	"generalLedgerId" integer,
	"calcType" "BillingCalcType" NOT NULL,
	"rate" numeric(9, 4),
	"inputAmount" numeric(18, 6),
	"baseAmount" numeric(18, 6) DEFAULT '0' NOT NULL,
	"calculatedAmount" numeric(18, 6) DEFAULT '0' NOT NULL,
	"isOverridden" boolean DEFAULT false NOT NULL,
	"finalAmount" numeric(18, 6) DEFAULT '0' NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	CONSTRAINT "SalesDocumentTerm_value_check" CHECK (("SalesDocumentTerm"."calcType" = 'PERCENT' AND "SalesDocumentTerm"."rate" IS NOT NULL) OR ("SalesDocumentTerm"."calcType" = 'AMOUNT' AND "SalesDocumentTerm"."inputAmount" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "SalesTerm" (
	"id" serial PRIMARY KEY NOT NULL,
	"companyId" integer NOT NULL,
	"code" varchar(20) NOT NULL,
	"name" varchar(100) NOT NULL,
	"category" "BillingTermCategory" DEFAULT 'GENERAL' NOT NULL,
	"nature" "BillingTermNature" NOT NULL,
	"isProductwise" boolean DEFAULT false NOT NULL,
	"isMandatory" boolean DEFAULT false NOT NULL,
	"sequence" integer DEFAULT 100 NOT NULL,
	"defaultCalcType" "BillingCalcType" DEFAULT 'PERCENT' NOT NULL,
	"defaultValue" numeric(18, 6) DEFAULT '0' NOT NULL,
	"calcBase" "BillingCalcBase" DEFAULT 'ITEM_VALUE' NOT NULL,
	"baseTermId" integer,
	"generalLedgerId" integer,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	CONSTRAINT "SalesTerm_base_term_check" CHECK (("SalesTerm"."calcBase" = 'SINGLE_TERM') = ("SalesTerm"."baseTermId" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "SalesTermDefault" (
	"id" serial PRIMARY KEY NOT NULL,
	"termId" integer NOT NULL,
	"partyId" integer,
	"productId" integer,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "SalesTermDefault_one_target_check" CHECK (num_nonnulls("SalesTermDefault"."partyId", "SalesTermDefault"."productId") = 1)
);
--> statement-breakpoint
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_changedBy_User_id_fk" FOREIGN KEY ("changedBy") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_companyId_Company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Company" ADD CONSTRAINT "Company_retainedEarningsGLId_GeneralLedger_id_fk" FOREIGN KEY ("retainedEarningsGLId") REFERENCES "public"."GeneralLedger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "FiscalYear" ADD CONSTRAINT "FiscalYear_companyId_Company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "FiscalYear" ADD CONSTRAINT "FiscalYear_closedBy_User_id_fk" FOREIGN KEY ("closedBy") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "FiscalYear" ADD CONSTRAINT "FiscalYear_openingBalanceLockedBy_User_id_fk" FOREIGN KEY ("openingBalanceLockedBy") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "UserCompanyAccess" ADD CONSTRAINT "UserCompanyAccess_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "UserCompanyAccess" ADD CONSTRAINT "UserCompanyAccess_companyId_Company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "UserCompanyAccess" ADD CONSTRAINT "UserCompanyAccess_branchId_Branch_id_fk" FOREIGN KEY ("branchId") REFERENCES "public"."Branch"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "AccountGroup" ADD CONSTRAINT "AccountGroup_companyId_Company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "AccountSubGroup" ADD CONSTRAINT "AccountSubGroup_accountGroupId_AccountGroup_id_fk" FOREIGN KEY ("accountGroupId") REFERENCES "public"."AccountGroup"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "GeneralLedger" ADD CONSTRAINT "GeneralLedger_companyId_Company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "GeneralLedger" ADD CONSTRAINT "GeneralLedger_accountSubGroupId_AccountSubGroup_id_fk" FOREIGN KEY ("accountSubGroupId") REFERENCES "public"."AccountSubGroup"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "GeneralLedger" ADD CONSTRAINT "GeneralLedger_parentId_GeneralLedger_id_fk" FOREIGN KEY ("parentId") REFERENCES "public"."GeneralLedger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "GeneralLedger" ADD CONSTRAINT "GeneralLedger_subAreaId_SubArea_id_fk" FOREIGN KEY ("subAreaId") REFERENCES "public"."SubArea"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "GeneralLedger" ADD CONSTRAINT "GeneralLedger_agentId_Agent_id_fk" FOREIGN KEY ("agentId") REFERENCES "public"."Agent"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SubLedger" ADD CONSTRAINT "SubLedger_generalLedgerId_GeneralLedger_id_fk" FOREIGN KEY ("generalLedgerId") REFERENCES "public"."GeneralLedger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SubLedger" ADD CONSTRAINT "SubLedger_partyId_Party_id_fk" FOREIGN KEY ("partyId") REFERENCES "public"."Party"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_companyId_Company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Area" ADD CONSTRAINT "Area_companyId_Company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "CustomerDetail" ADD CONSTRAINT "CustomerDetail_partyId_Party_id_fk" FOREIGN KEY ("partyId") REFERENCES "public"."Party"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Party" ADD CONSTRAINT "Party_companyId_Company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Party" ADD CONSTRAINT "Party_generalLedgerId_GeneralLedger_id_fk" FOREIGN KEY ("generalLedgerId") REFERENCES "public"."GeneralLedger"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Party" ADD CONSTRAINT "Party_subAreaId_SubArea_id_fk" FOREIGN KEY ("subAreaId") REFERENCES "public"."SubArea"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Party" ADD CONSTRAINT "Party_agentId_Agent_id_fk" FOREIGN KEY ("agentId") REFERENCES "public"."Agent"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SubArea" ADD CONSTRAINT "SubArea_areaId_Area_id_fk" FOREIGN KEY ("areaId") REFERENCES "public"."Area"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "VendorDetail" ADD CONSTRAINT "VendorDetail_partyId_Party_id_fk" FOREIGN KEY ("partyId") REFERENCES "public"."Party"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "CashBankVoucher" ADD CONSTRAINT "CashBankVoucher_companyId_Company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "CashBankVoucher" ADD CONSTRAINT "CashBankVoucher_branchId_Branch_id_fk" FOREIGN KEY ("branchId") REFERENCES "public"."Branch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "CashBankVoucher" ADD CONSTRAINT "CashBankVoucher_reversalOfId_CashBankVoucher_id_fk" FOREIGN KEY ("reversalOfId") REFERENCES "public"."CashBankVoucher"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "CashBankVoucher" ADD CONSTRAINT "CashBankVoucher_postedBy_User_id_fk" FOREIGN KEY ("postedBy") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "CashBankVoucher" ADD CONSTRAINT "CashBankVoucher_createdBy_User_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "CashBankVoucherLine" ADD CONSTRAINT "CashBankVoucherLine_cashBankVoucherId_CashBankVoucher_id_fk" FOREIGN KEY ("cashBankVoucherId") REFERENCES "public"."CashBankVoucher"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "CashBankVoucherLine" ADD CONSTRAINT "CashBankVoucherLine_generalLedgerId_GeneralLedger_id_fk" FOREIGN KEY ("generalLedgerId") REFERENCES "public"."GeneralLedger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "CashBankVoucherLine" ADD CONSTRAINT "CashBankVoucherLine_clearedBy_User_id_fk" FOREIGN KEY ("clearedBy") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "CashBankVoucherLine" ADD CONSTRAINT "CashBankVoucherLine_agentId_Agent_id_fk" FOREIGN KEY ("agentId") REFERENCES "public"."Agent"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "JournalVoucher" ADD CONSTRAINT "JournalVoucher_companyId_Company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "JournalVoucher" ADD CONSTRAINT "JournalVoucher_branchId_Branch_id_fk" FOREIGN KEY ("branchId") REFERENCES "public"."Branch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "JournalVoucher" ADD CONSTRAINT "JournalVoucher_reversalOfId_JournalVoucher_id_fk" FOREIGN KEY ("reversalOfId") REFERENCES "public"."JournalVoucher"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "JournalVoucher" ADD CONSTRAINT "JournalVoucher_postedBy_User_id_fk" FOREIGN KEY ("postedBy") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "JournalVoucher" ADD CONSTRAINT "JournalVoucher_createdBy_User_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "JournalVoucherLine" ADD CONSTRAINT "JournalVoucherLine_journalVoucherId_JournalVoucher_id_fk" FOREIGN KEY ("journalVoucherId") REFERENCES "public"."JournalVoucher"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "JournalVoucherLine" ADD CONSTRAINT "JournalVoucherLine_generalLedgerId_GeneralLedger_id_fk" FOREIGN KEY ("generalLedgerId") REFERENCES "public"."GeneralLedger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "JournalVoucherLine" ADD CONSTRAINT "JournalVoucherLine_agentId_Agent_id_fk" FOREIGN KEY ("agentId") REFERENCES "public"."Agent"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "OpeningBalance" ADD CONSTRAINT "OpeningBalance_companyId_Company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "OpeningBalance" ADD CONSTRAINT "OpeningBalance_branchId_Branch_id_fk" FOREIGN KEY ("branchId") REFERENCES "public"."Branch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "OpeningBalance" ADD CONSTRAINT "OpeningBalance_fiscalYearId_FiscalYear_id_fk" FOREIGN KEY ("fiscalYearId") REFERENCES "public"."FiscalYear"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "OpeningBalance" ADD CONSTRAINT "OpeningBalance_generalLedgerId_GeneralLedger_id_fk" FOREIGN KEY ("generalLedgerId") REFERENCES "public"."GeneralLedger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "OpeningBalance" ADD CONSTRAINT "OpeningBalance_subLedgerId_SubLedger_id_fk" FOREIGN KEY ("subLedgerId") REFERENCES "public"."SubLedger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "OpeningBalance" ADD CONSTRAINT "OpeningBalance_carriedForwardFromId_OpeningBalance_id_fk" FOREIGN KEY ("carriedForwardFromId") REFERENCES "public"."OpeningBalance"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "OpeningBalance" ADD CONSTRAINT "OpeningBalance_createdBy_User_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "StockOpeningBalance" ADD CONSTRAINT "StockOpeningBalance_branchId_Branch_id_fk" FOREIGN KEY ("branchId") REFERENCES "public"."Branch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "StockOpeningBalance" ADD CONSTRAINT "StockOpeningBalance_fiscalYearId_FiscalYear_id_fk" FOREIGN KEY ("fiscalYearId") REFERENCES "public"."FiscalYear"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "StockOpeningBalance" ADD CONSTRAINT "StockOpeningBalance_stockDetailId_StockDetail_id_fk" FOREIGN KEY ("stockDetailId") REFERENCES "public"."StockDetail"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "StockOpeningBalance" ADD CONSTRAINT "StockOpeningBalance_locationId_Location_id_fk" FOREIGN KEY ("locationId") REFERENCES "public"."Location"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "StockOpeningBalance" ADD CONSTRAINT "StockOpeningBalance_carriedForwardFromId_fkey" FOREIGN KEY ("carriedForwardFromId") REFERENCES "public"."StockOpeningBalance"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "AlternateUnit" ADD CONSTRAINT "AlternateUnit_stockDetailId_StockDetail_id_fk" FOREIGN KEY ("stockDetailId") REFERENCES "public"."StockDetail"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "AlternateUnit" ADD CONSTRAINT "AlternateUnit_unitId_ProductUnit_id_fk" FOREIGN KEY ("unitId") REFERENCES "public"."ProductUnit"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "BundleComponent" ADD CONSTRAINT "BundleComponent_bundleDetailId_BundleDetail_id_fk" FOREIGN KEY ("bundleDetailId") REFERENCES "public"."BundleDetail"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "BundleComponent" ADD CONSTRAINT "BundleComponent_componentProductId_Product_id_fk" FOREIGN KEY ("componentProductId") REFERENCES "public"."Product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "BundleDetail" ADD CONSTRAINT "BundleDetail_productId_Product_id_fk" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "BundleDetail" ADD CONSTRAINT "BundleDetail_salesGLId_GeneralLedger_id_fk" FOREIGN KEY ("salesGLId") REFERENCES "public"."GeneralLedger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "FixedAssetDetail" ADD CONSTRAINT "FixedAssetDetail_productId_Product_id_fk" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "FixedAssetDetail" ADD CONSTRAINT "FixedAssetDetail_assetGLId_GeneralLedger_id_fk" FOREIGN KEY ("assetGLId") REFERENCES "public"."GeneralLedger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "FixedAssetDetail" ADD CONSTRAINT "FixedAssetDetail_accumulatedDeprGLId_GeneralLedger_id_fk" FOREIGN KEY ("accumulatedDeprGLId") REFERENCES "public"."GeneralLedger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "FixedAssetDetail" ADD CONSTRAINT "FixedAssetDetail_depreciationExpenseGLId_GeneralLedger_id_fk" FOREIGN KEY ("depreciationExpenseGLId") REFERENCES "public"."GeneralLedger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "FixedAssetDetail" ADD CONSTRAINT "FixedAssetDetail_locationId_Location_id_fk" FOREIGN KEY ("locationId") REFERENCES "public"."Location"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Location" ADD CONSTRAINT "Location_companyId_Company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Location" ADD CONSTRAINT "Location_parentId_Location_id_fk" FOREIGN KEY ("parentId") REFERENCES "public"."Location"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "NonStockDetail" ADD CONSTRAINT "NonStockDetail_productId_Product_id_fk" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "NonStockDetail" ADD CONSTRAINT "NonStockDetail_unitId_ProductUnit_id_fk" FOREIGN KEY ("unitId") REFERENCES "public"."ProductUnit"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "NonStockDetail" ADD CONSTRAINT "NonStockDetail_taxRateId_TaxRate_id_fk" FOREIGN KEY ("taxRateId") REFERENCES "public"."TaxRate"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "NonStockDetail" ADD CONSTRAINT "NonStockDetail_salesGLId_GeneralLedger_id_fk" FOREIGN KEY ("salesGLId") REFERENCES "public"."GeneralLedger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "NonStockDetail" ADD CONSTRAINT "NonStockDetail_purchaseGLId_GeneralLedger_id_fk" FOREIGN KEY ("purchaseGLId") REFERENCES "public"."GeneralLedger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Product" ADD CONSTRAINT "Product_companyId_Company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Product" ADD CONSTRAINT "Product_productSubGroupId_ProductSubGroup_id_fk" FOREIGN KEY ("productSubGroupId") REFERENCES "public"."ProductSubGroup"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ProductGroup" ADD CONSTRAINT "ProductGroup_companyId_Company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ProductSubGroup" ADD CONSTRAINT "ProductSubGroup_productGroupId_ProductGroup_id_fk" FOREIGN KEY ("productGroupId") REFERENCES "public"."ProductGroup"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ProductUnit" ADD CONSTRAINT "ProductUnit_companyId_Company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ServiceDetail" ADD CONSTRAINT "ServiceDetail_productId_Product_id_fk" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ServiceDetail" ADD CONSTRAINT "ServiceDetail_unitId_ProductUnit_id_fk" FOREIGN KEY ("unitId") REFERENCES "public"."ProductUnit"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ServiceDetail" ADD CONSTRAINT "ServiceDetail_taxRateId_TaxRate_id_fk" FOREIGN KEY ("taxRateId") REFERENCES "public"."TaxRate"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ServiceDetail" ADD CONSTRAINT "ServiceDetail_salesGLId_GeneralLedger_id_fk" FOREIGN KEY ("salesGLId") REFERENCES "public"."GeneralLedger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ServiceDetail" ADD CONSTRAINT "ServiceDetail_purchaseGLId_GeneralLedger_id_fk" FOREIGN KEY ("purchaseGLId") REFERENCES "public"."GeneralLedger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "StockCategory" ADD CONSTRAINT "StockCategory_companyId_Company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "StockDetail" ADD CONSTRAINT "StockDetail_productId_Product_id_fk" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "StockDetail" ADD CONSTRAINT "StockDetail_baseUnitId_ProductUnit_id_fk" FOREIGN KEY ("baseUnitId") REFERENCES "public"."ProductUnit"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "StockDetail" ADD CONSTRAINT "StockDetail_stockCategoryId_StockCategory_id_fk" FOREIGN KEY ("stockCategoryId") REFERENCES "public"."StockCategory"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "StockDetail" ADD CONSTRAINT "StockDetail_defaultLocationId_Location_id_fk" FOREIGN KEY ("defaultLocationId") REFERENCES "public"."Location"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "StockDetail" ADD CONSTRAINT "StockDetail_taxRateId_TaxRate_id_fk" FOREIGN KEY ("taxRateId") REFERENCES "public"."TaxRate"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "StockDetail" ADD CONSTRAINT "StockDetail_openingGLId_GeneralLedger_id_fk" FOREIGN KEY ("openingGLId") REFERENCES "public"."GeneralLedger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "StockDetail" ADD CONSTRAINT "StockDetail_closingPLGLId_GeneralLedger_id_fk" FOREIGN KEY ("closingPLGLId") REFERENCES "public"."GeneralLedger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "StockDetail" ADD CONSTRAINT "StockDetail_closingBSGLId_GeneralLedger_id_fk" FOREIGN KEY ("closingBSGLId") REFERENCES "public"."GeneralLedger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "StockDetail" ADD CONSTRAINT "StockDetail_purchaseGLId_GeneralLedger_id_fk" FOREIGN KEY ("purchaseGLId") REFERENCES "public"."GeneralLedger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "StockDetail" ADD CONSTRAINT "StockDetail_purchaseReturnGLId_GeneralLedger_id_fk" FOREIGN KEY ("purchaseReturnGLId") REFERENCES "public"."GeneralLedger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "StockDetail" ADD CONSTRAINT "StockDetail_salesGLId_GeneralLedger_id_fk" FOREIGN KEY ("salesGLId") REFERENCES "public"."GeneralLedger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "StockDetail" ADD CONSTRAINT "StockDetail_salesReturnGLId_GeneralLedger_id_fk" FOREIGN KEY ("salesReturnGLId") REFERENCES "public"."GeneralLedger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "StockDetail" ADD CONSTRAINT "StockDetail_defaultVendorId_Party_id_fk" FOREIGN KEY ("defaultVendorId") REFERENCES "public"."Party"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "TaxRate" ADD CONSTRAINT "TaxRate_companyId_Company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseDocumentTerm" ADD CONSTRAINT "PurchaseDocumentTerm_companyId_Company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseDocumentTerm" ADD CONSTRAINT "PurchaseDocumentTerm_termId_PurchaseTerm_id_fk" FOREIGN KEY ("termId") REFERENCES "public"."PurchaseTerm"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseDocumentTerm" ADD CONSTRAINT "PurchaseDocumentTerm_generalLedgerId_GeneralLedger_id_fk" FOREIGN KEY ("generalLedgerId") REFERENCES "public"."GeneralLedger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseDocumentTermAllocation" ADD CONSTRAINT "PurchaseDocTermAlloc_documentTermId_fk" FOREIGN KEY ("documentTermId") REFERENCES "public"."PurchaseDocumentTerm"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseTerm" ADD CONSTRAINT "PurchaseTerm_companyId_Company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseTerm" ADD CONSTRAINT "PurchaseTerm_baseTermId_PurchaseTerm_id_fk" FOREIGN KEY ("baseTermId") REFERENCES "public"."PurchaseTerm"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseTerm" ADD CONSTRAINT "PurchaseTerm_generalLedgerId_GeneralLedger_id_fk" FOREIGN KEY ("generalLedgerId") REFERENCES "public"."GeneralLedger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseTermDefault" ADD CONSTRAINT "PurchaseTermDefault_termId_PurchaseTerm_id_fk" FOREIGN KEY ("termId") REFERENCES "public"."PurchaseTerm"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseTermDefault" ADD CONSTRAINT "PurchaseTermDefault_partyId_Party_id_fk" FOREIGN KEY ("partyId") REFERENCES "public"."Party"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PurchaseTermDefault" ADD CONSTRAINT "PurchaseTermDefault_productId_Product_id_fk" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SalesDocumentTerm" ADD CONSTRAINT "SalesDocumentTerm_companyId_Company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SalesDocumentTerm" ADD CONSTRAINT "SalesDocumentTerm_termId_SalesTerm_id_fk" FOREIGN KEY ("termId") REFERENCES "public"."SalesTerm"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SalesDocumentTerm" ADD CONSTRAINT "SalesDocumentTerm_generalLedgerId_GeneralLedger_id_fk" FOREIGN KEY ("generalLedgerId") REFERENCES "public"."GeneralLedger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SalesTerm" ADD CONSTRAINT "SalesTerm_companyId_Company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SalesTerm" ADD CONSTRAINT "SalesTerm_baseTermId_SalesTerm_id_fk" FOREIGN KEY ("baseTermId") REFERENCES "public"."SalesTerm"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SalesTerm" ADD CONSTRAINT "SalesTerm_generalLedgerId_GeneralLedger_id_fk" FOREIGN KEY ("generalLedgerId") REFERENCES "public"."GeneralLedger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SalesTermDefault" ADD CONSTRAINT "SalesTermDefault_termId_SalesTerm_id_fk" FOREIGN KEY ("termId") REFERENCES "public"."SalesTerm"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SalesTermDefault" ADD CONSTRAINT "SalesTermDefault_partyId_Party_id_fk" FOREIGN KEY ("partyId") REFERENCES "public"."Party"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SalesTermDefault" ADD CONSTRAINT "SalesTermDefault_productId_Product_id_fk" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "AuditLog_tableName_recordId_idx" ON "AuditLog" USING btree ("tableName","recordId");--> statement-breakpoint
CREATE INDEX "AuditLog_changedAt_idx" ON "AuditLog" USING btree ("changedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "Branch_companyId_code_key" ON "Branch" USING btree ("companyId","code");--> statement-breakpoint
CREATE UNIQUE INDEX "Branch_companyId_name_key" ON "Branch" USING btree ("companyId","name");--> statement-breakpoint
CREATE INDEX "Branch_companyId_idx" ON "Branch" USING btree ("companyId");--> statement-breakpoint
CREATE UNIQUE INDEX "Branch_companyId_headOffice_key" ON "Branch" USING btree ("companyId") WHERE "Branch"."isHeadOffice" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "Company_code_key" ON "Company" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "Company_retainedEarningsGLId_key" ON "Company" USING btree ("retainedEarningsGLId");--> statement-breakpoint
CREATE INDEX "Company_isActive_idx" ON "Company" USING btree ("isActive");--> statement-breakpoint
CREATE UNIQUE INDEX "FiscalYear_companyId_code_key" ON "FiscalYear" USING btree ("companyId","code");--> statement-breakpoint
CREATE INDEX "FiscalYear_companyId_idx" ON "FiscalYear" USING btree ("companyId");--> statement-breakpoint
CREATE INDEX "FiscalYear_companyId_isCurrent_idx" ON "FiscalYear" USING btree ("companyId","isCurrent");--> statement-breakpoint
CREATE INDEX "FiscalYear_isClosed_idx" ON "FiscalYear" USING btree ("isClosed");--> statement-breakpoint
CREATE UNIQUE INDEX "FiscalYear_companyId_current_key" ON "FiscalYear" USING btree ("companyId") WHERE "FiscalYear"."isCurrent" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "User_email_key" ON "User" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "UserCompanyAccess_userId_companyId_branchId_key" ON "UserCompanyAccess" USING btree ("userId","companyId","branchId");--> statement-breakpoint
CREATE INDEX "UserCompanyAccess_companyId_idx" ON "UserCompanyAccess" USING btree ("companyId");--> statement-breakpoint
CREATE INDEX "UserCompanyAccess_branchId_idx" ON "UserCompanyAccess" USING btree ("branchId");--> statement-breakpoint
CREATE UNIQUE INDEX "AccountGroup_companyId_code_key" ON "AccountGroup" USING btree ("companyId","code");--> statement-breakpoint
CREATE UNIQUE INDEX "AccountGroup_companyId_description_key" ON "AccountGroup" USING btree ("companyId","description");--> statement-breakpoint
CREATE INDEX "AccountGroup_companyId_idx" ON "AccountGroup" USING btree ("companyId");--> statement-breakpoint
CREATE UNIQUE INDEX "AccountSubGroup_accountGroupId_code_key" ON "AccountSubGroup" USING btree ("accountGroupId","code");--> statement-breakpoint
CREATE UNIQUE INDEX "AccountSubGroup_accountGroupId_description_key" ON "AccountSubGroup" USING btree ("accountGroupId","description");--> statement-breakpoint
CREATE UNIQUE INDEX "GeneralLedger_companyId_code_key" ON "GeneralLedger" USING btree ("companyId","code");--> statement-breakpoint
CREATE INDEX "GeneralLedger_companyId_idx" ON "GeneralLedger" USING btree ("companyId");--> statement-breakpoint
CREATE INDEX "GeneralLedger_accountSubGroupId_idx" ON "GeneralLedger" USING btree ("accountSubGroupId");--> statement-breakpoint
CREATE INDEX "GeneralLedger_parentId_idx" ON "GeneralLedger" USING btree ("parentId");--> statement-breakpoint
CREATE INDEX "GeneralLedger_glType_idx" ON "GeneralLedger" USING btree ("glType");--> statement-breakpoint
CREATE INDEX "GeneralLedger_subAreaId_idx" ON "GeneralLedger" USING btree ("subAreaId");--> statement-breakpoint
CREATE INDEX "GeneralLedger_agentId_idx" ON "GeneralLedger" USING btree ("agentId");--> statement-breakpoint
CREATE UNIQUE INDEX "SubLedger_code_key" ON "SubLedger" USING btree ("code");--> statement-breakpoint
CREATE INDEX "SubLedger_generalLedgerId_idx" ON "SubLedger" USING btree ("generalLedgerId");--> statement-breakpoint
CREATE INDEX "SubLedger_partyId_idx" ON "SubLedger" USING btree ("partyId");--> statement-breakpoint
CREATE UNIQUE INDEX "Agent_companyId_code_key" ON "Agent" USING btree ("companyId","code");--> statement-breakpoint
CREATE INDEX "Agent_companyId_idx" ON "Agent" USING btree ("companyId");--> statement-breakpoint
CREATE UNIQUE INDEX "Area_companyId_code_key" ON "Area" USING btree ("companyId","code");--> statement-breakpoint
CREATE UNIQUE INDEX "Area_companyId_name_key" ON "Area" USING btree ("companyId","name");--> statement-breakpoint
CREATE UNIQUE INDEX "Area_companyId_shortName_key" ON "Area" USING btree ("companyId","shortName");--> statement-breakpoint
CREATE INDEX "Area_companyId_idx" ON "Area" USING btree ("companyId");--> statement-breakpoint
CREATE UNIQUE INDEX "CustomerDetail_partyId_key" ON "CustomerDetail" USING btree ("partyId");--> statement-breakpoint
CREATE UNIQUE INDEX "Party_generalLedgerId_key" ON "Party" USING btree ("generalLedgerId");--> statement-breakpoint
CREATE UNIQUE INDEX "Party_companyId_panNo_key" ON "Party" USING btree ("companyId","panNo");--> statement-breakpoint
CREATE INDEX "Party_companyId_idx" ON "Party" USING btree ("companyId");--> statement-breakpoint
CREATE INDEX "Party_panNo_idx" ON "Party" USING btree ("panNo");--> statement-breakpoint
CREATE INDEX "Party_subAreaId_idx" ON "Party" USING btree ("subAreaId");--> statement-breakpoint
CREATE INDEX "Party_agentId_idx" ON "Party" USING btree ("agentId");--> statement-breakpoint
CREATE UNIQUE INDEX "SubArea_areaId_code_key" ON "SubArea" USING btree ("areaId","code");--> statement-breakpoint
CREATE UNIQUE INDEX "SubArea_areaId_name_key" ON "SubArea" USING btree ("areaId","name");--> statement-breakpoint
CREATE UNIQUE INDEX "SubArea_areaId_shortName_key" ON "SubArea" USING btree ("areaId","shortName");--> statement-breakpoint
CREATE UNIQUE INDEX "VendorDetail_partyId_key" ON "VendorDetail" USING btree ("partyId");--> statement-breakpoint
CREATE UNIQUE INDEX "CashBankVoucher_branchId_voucherNumber_key" ON "CashBankVoucher" USING btree ("branchId","voucherNumber");--> statement-breakpoint
CREATE INDEX "CashBankVoucher_companyId_idx" ON "CashBankVoucher" USING btree ("companyId");--> statement-breakpoint
CREATE INDEX "CashBankVoucher_branchId_idx" ON "CashBankVoucher" USING btree ("branchId");--> statement-breakpoint
CREATE INDEX "CashBankVoucher_documentType_idx" ON "CashBankVoucher" USING btree ("documentType");--> statement-breakpoint
CREATE INDEX "CashBankVoucher_fiscalYear_idx" ON "CashBankVoucher" USING btree ("fiscalYear");--> statement-breakpoint
CREATE UNIQUE INDEX "CashBankVoucherLine_cashBankVoucherId_lineNumber_key" ON "CashBankVoucherLine" USING btree ("cashBankVoucherId","lineNumber");--> statement-breakpoint
CREATE INDEX "CashBankVoucherLine_generalLedgerId_idx" ON "CashBankVoucherLine" USING btree ("generalLedgerId");--> statement-breakpoint
CREATE INDEX "CashBankVoucherLine_agentId_idx" ON "CashBankVoucherLine" USING btree ("agentId");--> statement-breakpoint
CREATE INDEX "CashBankVoucherLine_chequeNumber_idx" ON "CashBankVoucherLine" USING btree ("chequeNumber");--> statement-breakpoint
CREATE UNIQUE INDEX "JournalVoucher_branchId_voucherNumber_key" ON "JournalVoucher" USING btree ("branchId","voucherNumber");--> statement-breakpoint
CREATE INDEX "JournalVoucher_companyId_idx" ON "JournalVoucher" USING btree ("companyId");--> statement-breakpoint
CREATE INDEX "JournalVoucher_branchId_idx" ON "JournalVoucher" USING btree ("branchId");--> statement-breakpoint
CREATE INDEX "JournalVoucher_documentType_idx" ON "JournalVoucher" USING btree ("documentType");--> statement-breakpoint
CREATE INDEX "JournalVoucher_fiscalYear_idx" ON "JournalVoucher" USING btree ("fiscalYear");--> statement-breakpoint
CREATE UNIQUE INDEX "JournalVoucherLine_journalVoucherId_lineNumber_key" ON "JournalVoucherLine" USING btree ("journalVoucherId","lineNumber");--> statement-breakpoint
CREATE INDEX "JournalVoucherLine_generalLedgerId_idx" ON "JournalVoucherLine" USING btree ("generalLedgerId");--> statement-breakpoint
CREATE INDEX "JournalVoucherLine_agentId_idx" ON "JournalVoucherLine" USING btree ("agentId");--> statement-breakpoint
CREATE INDEX "OpeningBalance_companyId_idx" ON "OpeningBalance" USING btree ("companyId");--> statement-breakpoint
CREATE INDEX "OpeningBalance_branchId_idx" ON "OpeningBalance" USING btree ("branchId");--> statement-breakpoint
CREATE INDEX "OpeningBalance_fy_branch_gl_subledger_idx" ON "OpeningBalance" USING btree ("fiscalYearId","branchId","generalLedgerId","subLedgerId");--> statement-breakpoint
CREATE INDEX "OpeningBalance_generalLedgerId_idx" ON "OpeningBalance" USING btree ("generalLedgerId");--> statement-breakpoint
CREATE INDEX "OpeningBalance_subLedgerId_idx" ON "OpeningBalance" USING btree ("subLedgerId");--> statement-breakpoint
CREATE UNIQUE INDEX "OpeningBalance_fy_branch_gl_nosub_key" ON "OpeningBalance" USING btree ("fiscalYearId","branchId","generalLedgerId") WHERE "OpeningBalance"."subLedgerId" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "OpeningBalance_fy_branch_gl_sub_key" ON "OpeningBalance" USING btree ("fiscalYearId","branchId","generalLedgerId","subLedgerId") WHERE "OpeningBalance"."subLedgerId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "StockOpeningBalance_branchId_idx" ON "StockOpeningBalance" USING btree ("branchId");--> statement-breakpoint
CREATE INDEX "StockOpeningBalance_fiscalYearId_branchId_stockDetailId_idx" ON "StockOpeningBalance" USING btree ("fiscalYearId","branchId","stockDetailId");--> statement-breakpoint
CREATE INDEX "StockOpeningBalance_stockDetailId_idx" ON "StockOpeningBalance" USING btree ("stockDetailId");--> statement-breakpoint
CREATE UNIQUE INDEX "StockOpeningBalance_unique_row_key" ON "StockOpeningBalance" USING btree ("fiscalYearId","branchId","stockDetailId",COALESCE("locationId", 0),COALESCE("batchNo", ''));--> statement-breakpoint
CREATE UNIQUE INDEX "AlternateUnit_stockDetailId_unitId_key" ON "AlternateUnit" USING btree ("stockDetailId","unitId");--> statement-breakpoint
CREATE INDEX "AlternateUnit_unitId_idx" ON "AlternateUnit" USING btree ("unitId");--> statement-breakpoint
CREATE UNIQUE INDEX "BundleComponent_bundleDetailId_componentProductId_key" ON "BundleComponent" USING btree ("bundleDetailId","componentProductId");--> statement-breakpoint
CREATE INDEX "BundleComponent_componentProductId_idx" ON "BundleComponent" USING btree ("componentProductId");--> statement-breakpoint
CREATE UNIQUE INDEX "BundleDetail_productId_key" ON "BundleDetail" USING btree ("productId");--> statement-breakpoint
CREATE INDEX "BundleDetail_salesGLId_idx" ON "BundleDetail" USING btree ("salesGLId");--> statement-breakpoint
CREATE UNIQUE INDEX "FixedAssetDetail_productId_key" ON "FixedAssetDetail" USING btree ("productId");--> statement-breakpoint
CREATE INDEX "FixedAssetDetail_locationId_idx" ON "FixedAssetDetail" USING btree ("locationId");--> statement-breakpoint
CREATE INDEX "FixedAssetDetail_assetGLId_idx" ON "FixedAssetDetail" USING btree ("assetGLId");--> statement-breakpoint
CREATE INDEX "FixedAssetDetail_accumulatedDeprGLId_idx" ON "FixedAssetDetail" USING btree ("accumulatedDeprGLId");--> statement-breakpoint
CREATE INDEX "FixedAssetDetail_depreciationExpenseGLId_idx" ON "FixedAssetDetail" USING btree ("depreciationExpenseGLId");--> statement-breakpoint
CREATE UNIQUE INDEX "Location_companyId_code_key" ON "Location" USING btree ("companyId","code");--> statement-breakpoint
CREATE INDEX "Location_companyId_idx" ON "Location" USING btree ("companyId");--> statement-breakpoint
CREATE INDEX "Location_parentId_idx" ON "Location" USING btree ("parentId");--> statement-breakpoint
CREATE UNIQUE INDEX "NonStockDetail_productId_key" ON "NonStockDetail" USING btree ("productId");--> statement-breakpoint
CREATE INDEX "NonStockDetail_unitId_idx" ON "NonStockDetail" USING btree ("unitId");--> statement-breakpoint
CREATE INDEX "NonStockDetail_taxRateId_idx" ON "NonStockDetail" USING btree ("taxRateId");--> statement-breakpoint
CREATE INDEX "NonStockDetail_salesGLId_idx" ON "NonStockDetail" USING btree ("salesGLId");--> statement-breakpoint
CREATE INDEX "NonStockDetail_purchaseGLId_idx" ON "NonStockDetail" USING btree ("purchaseGLId");--> statement-breakpoint
CREATE UNIQUE INDEX "Product_companyId_code_key" ON "Product" USING btree ("companyId","code");--> statement-breakpoint
CREATE UNIQUE INDEX "Product_companyId_barcode_key" ON "Product" USING btree ("companyId","barcode");--> statement-breakpoint
CREATE INDEX "Product_companyId_idx" ON "Product" USING btree ("companyId");--> statement-breakpoint
CREATE INDEX "Product_productSubGroupId_idx" ON "Product" USING btree ("productSubGroupId");--> statement-breakpoint
CREATE INDEX "Product_type_idx" ON "Product" USING btree ("type");--> statement-breakpoint
CREATE INDEX "Product_type_isActive_idx" ON "Product" USING btree ("type","isActive");--> statement-breakpoint
CREATE INDEX "Product_description_idx" ON "Product" USING btree ("description");--> statement-breakpoint
CREATE UNIQUE INDEX "ProductGroup_companyId_code_key" ON "ProductGroup" USING btree ("companyId","code");--> statement-breakpoint
CREATE UNIQUE INDEX "ProductGroup_companyId_name_key" ON "ProductGroup" USING btree ("companyId","name");--> statement-breakpoint
CREATE INDEX "ProductGroup_companyId_idx" ON "ProductGroup" USING btree ("companyId");--> statement-breakpoint
CREATE UNIQUE INDEX "ProductSubGroup_productGroupId_code_key" ON "ProductSubGroup" USING btree ("productGroupId","code");--> statement-breakpoint
CREATE UNIQUE INDEX "ProductSubGroup_productGroupId_name_key" ON "ProductSubGroup" USING btree ("productGroupId","name");--> statement-breakpoint
CREATE UNIQUE INDEX "ProductUnit_companyId_code_key" ON "ProductUnit" USING btree ("companyId","code");--> statement-breakpoint
CREATE UNIQUE INDEX "ProductUnit_companyId_name_key" ON "ProductUnit" USING btree ("companyId","name");--> statement-breakpoint
CREATE INDEX "ProductUnit_companyId_idx" ON "ProductUnit" USING btree ("companyId");--> statement-breakpoint
CREATE UNIQUE INDEX "ServiceDetail_productId_key" ON "ServiceDetail" USING btree ("productId");--> statement-breakpoint
CREATE INDEX "ServiceDetail_unitId_idx" ON "ServiceDetail" USING btree ("unitId");--> statement-breakpoint
CREATE INDEX "ServiceDetail_taxRateId_idx" ON "ServiceDetail" USING btree ("taxRateId");--> statement-breakpoint
CREATE INDEX "ServiceDetail_salesGLId_idx" ON "ServiceDetail" USING btree ("salesGLId");--> statement-breakpoint
CREATE INDEX "ServiceDetail_purchaseGLId_idx" ON "ServiceDetail" USING btree ("purchaseGLId");--> statement-breakpoint
CREATE UNIQUE INDEX "StockCategory_companyId_code_key" ON "StockCategory" USING btree ("companyId","code");--> statement-breakpoint
CREATE UNIQUE INDEX "StockCategory_companyId_name_key" ON "StockCategory" USING btree ("companyId","name");--> statement-breakpoint
CREATE INDEX "StockCategory_companyId_idx" ON "StockCategory" USING btree ("companyId");--> statement-breakpoint
CREATE UNIQUE INDEX "StockDetail_productId_key" ON "StockDetail" USING btree ("productId");--> statement-breakpoint
CREATE INDEX "StockDetail_baseUnitId_idx" ON "StockDetail" USING btree ("baseUnitId");--> statement-breakpoint
CREATE INDEX "StockDetail_stockCategoryId_idx" ON "StockDetail" USING btree ("stockCategoryId");--> statement-breakpoint
CREATE INDEX "StockDetail_defaultLocationId_idx" ON "StockDetail" USING btree ("defaultLocationId");--> statement-breakpoint
CREATE INDEX "StockDetail_defaultVendorId_idx" ON "StockDetail" USING btree ("defaultVendorId");--> statement-breakpoint
CREATE INDEX "StockDetail_taxRateId_idx" ON "StockDetail" USING btree ("taxRateId");--> statement-breakpoint
CREATE INDEX "StockDetail_openingGLId_idx" ON "StockDetail" USING btree ("openingGLId");--> statement-breakpoint
CREATE INDEX "StockDetail_closingPLGLId_idx" ON "StockDetail" USING btree ("closingPLGLId");--> statement-breakpoint
CREATE INDEX "StockDetail_closingBSGLId_idx" ON "StockDetail" USING btree ("closingBSGLId");--> statement-breakpoint
CREATE INDEX "StockDetail_purchaseGLId_idx" ON "StockDetail" USING btree ("purchaseGLId");--> statement-breakpoint
CREATE INDEX "StockDetail_purchaseReturnGLId_idx" ON "StockDetail" USING btree ("purchaseReturnGLId");--> statement-breakpoint
CREATE INDEX "StockDetail_salesGLId_idx" ON "StockDetail" USING btree ("salesGLId");--> statement-breakpoint
CREATE INDEX "StockDetail_salesReturnGLId_idx" ON "StockDetail" USING btree ("salesReturnGLId");--> statement-breakpoint
CREATE UNIQUE INDEX "TaxRate_companyId_code_key" ON "TaxRate" USING btree ("companyId","code");--> statement-breakpoint
CREATE INDEX "TaxRate_companyId_idx" ON "TaxRate" USING btree ("companyId");--> statement-breakpoint
CREATE UNIQUE INDEX "PurchaseDocumentTerm_header_key" ON "PurchaseDocumentTerm" USING btree ("documentType","documentId","termId") WHERE "PurchaseDocumentTerm"."documentLineId" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "PurchaseDocumentTerm_line_key" ON "PurchaseDocumentTerm" USING btree ("documentType","documentId","documentLineId","termId") WHERE "PurchaseDocumentTerm"."documentLineId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "PurchaseDocumentTerm_document_idx" ON "PurchaseDocumentTerm" USING btree ("documentType","documentId","sequence");--> statement-breakpoint
CREATE INDEX "PurchaseDocumentTerm_termId_idx" ON "PurchaseDocumentTerm" USING btree ("termId");--> statement-breakpoint
CREATE INDEX "PurchaseDocumentTerm_companyId_idx" ON "PurchaseDocumentTerm" USING btree ("companyId");--> statement-breakpoint
CREATE UNIQUE INDEX "PurchaseDocumentTermAllocation_term_line_key" ON "PurchaseDocumentTermAllocation" USING btree ("documentTermId","documentLineId");--> statement-breakpoint
CREATE INDEX "PurchaseDocumentTermAllocation_documentLineId_idx" ON "PurchaseDocumentTermAllocation" USING btree ("documentLineId");--> statement-breakpoint
CREATE UNIQUE INDEX "PurchaseTerm_companyId_code_key" ON "PurchaseTerm" USING btree ("companyId","code");--> statement-breakpoint
CREATE INDEX "PurchaseTerm_companyId_idx" ON "PurchaseTerm" USING btree ("companyId");--> statement-breakpoint
CREATE INDEX "PurchaseTerm_generalLedgerId_idx" ON "PurchaseTerm" USING btree ("generalLedgerId");--> statement-breakpoint
CREATE UNIQUE INDEX "PurchaseTermDefault_term_party_key" ON "PurchaseTermDefault" USING btree ("termId","partyId") WHERE "PurchaseTermDefault"."partyId" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "PurchaseTermDefault_term_product_key" ON "PurchaseTermDefault" USING btree ("termId","productId") WHERE "PurchaseTermDefault"."productId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "PurchaseTermDefault_partyId_idx" ON "PurchaseTermDefault" USING btree ("partyId");--> statement-breakpoint
CREATE INDEX "PurchaseTermDefault_productId_idx" ON "PurchaseTermDefault" USING btree ("productId");--> statement-breakpoint
CREATE UNIQUE INDEX "SalesDocumentTerm_header_key" ON "SalesDocumentTerm" USING btree ("documentType","documentId","termId") WHERE "SalesDocumentTerm"."documentLineId" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "SalesDocumentTerm_line_key" ON "SalesDocumentTerm" USING btree ("documentType","documentId","documentLineId","termId") WHERE "SalesDocumentTerm"."documentLineId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "SalesDocumentTerm_document_idx" ON "SalesDocumentTerm" USING btree ("documentType","documentId","sequence");--> statement-breakpoint
CREATE INDEX "SalesDocumentTerm_termId_idx" ON "SalesDocumentTerm" USING btree ("termId");--> statement-breakpoint
CREATE INDEX "SalesDocumentTerm_companyId_idx" ON "SalesDocumentTerm" USING btree ("companyId");--> statement-breakpoint
CREATE UNIQUE INDEX "SalesTerm_companyId_code_key" ON "SalesTerm" USING btree ("companyId","code");--> statement-breakpoint
CREATE INDEX "SalesTerm_companyId_idx" ON "SalesTerm" USING btree ("companyId");--> statement-breakpoint
CREATE INDEX "SalesTerm_generalLedgerId_idx" ON "SalesTerm" USING btree ("generalLedgerId");--> statement-breakpoint
CREATE UNIQUE INDEX "SalesTermDefault_term_party_key" ON "SalesTermDefault" USING btree ("termId","partyId") WHERE "SalesTermDefault"."partyId" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "SalesTermDefault_term_product_key" ON "SalesTermDefault" USING btree ("termId","productId") WHERE "SalesTermDefault"."productId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "SalesTermDefault_partyId_idx" ON "SalesTermDefault" USING btree ("partyId");--> statement-breakpoint
CREATE INDEX "SalesTermDefault_productId_idx" ON "SalesTermDefault" USING btree ("productId");