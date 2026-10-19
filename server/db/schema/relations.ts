import { relations } from "drizzle-orm";
import { company, branch, user, userCompanyAccess, fiscalYear, auditLog } from "./core";
import { accountGroup, accountSubGroup, generalLedger, subLedger } from "./accounting";
import { area, subArea, agent, party, customerDetail, vendorDetail } from "./parties";
import {
  journalVoucher,
  journalVoucherLine,
  cashBankVoucher,
  cashBankVoucherLine,
} from "./vouchers";
import { openingBalance, stockOpeningBalance } from "./openingBalances";
import {
  productGroup,
  productSubGroup,
  productUnit,
  taxRate,
  stockCategory,
  location,
  product,
  stockDetail,
  alternateUnit,
  nonStockDetail,
  serviceDetail,
  fixedAssetDetail,
  bundleDetail,
  bundleComponent,
} from "./products";

// Relation names mirror the Prisma @relation("...") names so the intent of
// each link stays readable. Drizzle needs a name whenever two tables are
// joined by more than one foreign key.

// ============================================================
// CORE
// ============================================================

export const companyRelations = relations(company, ({ one, many }) => ({
  retainedEarningsGL: one(generalLedger, {
    fields: [company.retainedEarningsGLId],
    references: [generalLedger.id],
    relationName: "CompanyRetainedEarningsGL",
  }),
  branches: many(branch),
  fiscalYears: many(fiscalYear),
  userAccess: many(userCompanyAccess),

  accountGroups: many(accountGroup),
  generalLedgers: many(generalLedger, { relationName: "GLCompany" }),
  parties: many(party),
  areas: many(area),
  agents: many(agent),

  productGroups: many(productGroup),
  productUnits: many(productUnit),
  taxRates: many(taxRate),
  stockCategories: many(stockCategory),
  locations: many(location),
  products: many(product),

  journalVouchers: many(journalVoucher),
  cashBankVouchers: many(cashBankVoucher),
  openingBalances: many(openingBalance),
}));

export const branchRelations = relations(branch, ({ one, many }) => ({
  company: one(company, {
    fields: [branch.companyId],
    references: [company.id],
  }),
  userAccess: many(userCompanyAccess),
  journalVouchers: many(journalVoucher),
  cashBankVouchers: many(cashBankVoucher),
  openingBalances: many(openingBalance),
  stockOpeningBalances: many(stockOpeningBalance),
}));

export const userRelations = relations(user, ({ many }) => ({
  companyAccess: many(userCompanyAccess),
  auditLogs: many(auditLog),
  journalVouchersPosted: many(journalVoucher, { relationName: "JVPostedBy" }),
  journalVouchersCreated: many(journalVoucher, { relationName: "JVCreatedBy" }),
  cashBankVouchersPosted: many(cashBankVoucher, { relationName: "CBPostedBy" }),
  cashBankVouchersCreated: many(cashBankVoucher, { relationName: "CBCreatedBy" }),
  cashBankLinesCleared: many(cashBankVoucherLine, {
    relationName: "CBLineClearedBy",
  }),
  fiscalYearsClosed: many(fiscalYear, { relationName: "FYClosedBy" }),
  fiscalYearsOBLocked: many(fiscalYear, { relationName: "FYOBLockedBy" }),
  openingBalancesCreated: many(openingBalance, { relationName: "OBCreatedBy" }),
}));

export const userCompanyAccessRelations = relations(
  userCompanyAccess,
  ({ one }) => ({
    user: one(user, {
      fields: [userCompanyAccess.userId],
      references: [user.id],
    }),
    company: one(company, {
      fields: [userCompanyAccess.companyId],
      references: [company.id],
    }),
    branch: one(branch, {
      fields: [userCompanyAccess.branchId],
      references: [branch.id],
    }),
  }),
);

export const fiscalYearRelations = relations(fiscalYear, ({ one, many }) => ({
  company: one(company, {
    fields: [fiscalYear.companyId],
    references: [company.id],
  }),
  closedByUser: one(user, {
    fields: [fiscalYear.closedBy],
    references: [user.id],
    relationName: "FYClosedBy",
  }),
  openingBalanceLockedByUser: one(user, {
    fields: [fiscalYear.openingBalanceLockedBy],
    references: [user.id],
    relationName: "FYOBLockedBy",
  }),
  openingBalances: many(openingBalance),
  stockOpeningBalances: many(stockOpeningBalance),
}));

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  user: one(user, {
    fields: [auditLog.changedBy],
    references: [user.id],
  }),
}));

// ============================================================
// CHART OF ACCOUNTS
// ============================================================

export const accountGroupRelations = relations(accountGroup, ({ one, many }) => ({
  company: one(company, {
    fields: [accountGroup.companyId],
    references: [company.id],
  }),
  subGroups: many(accountSubGroup),
}));

export const accountSubGroupRelations = relations(
  accountSubGroup,
  ({ one, many }) => ({
    accountGroup: one(accountGroup, {
      fields: [accountSubGroup.accountGroupId],
      references: [accountGroup.id],
    }),
    generalLedgers: many(generalLedger),
  }),
);

export const generalLedgerRelations = relations(generalLedger, ({ one, many }) => ({
  company: one(company, {
    fields: [generalLedger.companyId],
    references: [company.id],
    relationName: "GLCompany",
  }),
  accountSubGroup: one(accountSubGroup, {
    fields: [generalLedger.accountSubGroupId],
    references: [accountSubGroup.id],
  }),
  parent: one(generalLedger, {
    fields: [generalLedger.parentId],
    references: [generalLedger.id],
    relationName: "GLHierarchy",
  }),
  children: many(generalLedger, { relationName: "GLHierarchy" }),
  subArea: one(subArea, {
    fields: [generalLedger.subAreaId],
    references: [subArea.id],
  }),
  agent: one(agent, {
    fields: [generalLedger.agentId],
    references: [agent.id],
  }),

  party: one(party), // inverse side of Party.generalLedgerId (1:1)
  // Inverse of Company.retainedEarningsGLId. Drizzle's one() can't carry a
  // bare relationName on the inverse side, so this is many() — it returns
  // at most one row because Company.retainedEarningsGLId is unique.
  retainedEarningsFor: many(company, {
    relationName: "CompanyRetainedEarningsGL",
  }),

  journalVoucherLines: many(journalVoucherLine),
  cashBankVoucherLines: many(cashBankVoucherLine),
  openingBalances: many(openingBalance),
  subLedgers: many(subLedger),

  // Product-catalog GL roles — one relation per accounting role
  stockOpeningFor: many(stockDetail, { relationName: "StockOpeningGL" }),
  stockClosingPLFor: many(stockDetail, { relationName: "StockClosingPLGL" }),
  stockClosingBSFor: many(stockDetail, { relationName: "StockClosingBSGL" }),
  stockPurchaseFor: many(stockDetail, { relationName: "StockPurchaseGL" }),
  stockPurchaseReturnFor: many(stockDetail, {
    relationName: "StockPurchaseReturnGL",
  }),
  stockSalesFor: many(stockDetail, { relationName: "StockSalesGL" }),
  stockSalesReturnFor: many(stockDetail, { relationName: "StockSalesReturnGL" }),
  nonStockSalesFor: many(nonStockDetail, { relationName: "NonStockSalesGL" }),
  nonStockPurchaseFor: many(nonStockDetail, {
    relationName: "NonStockPurchaseGL",
  }),
  serviceSalesFor: many(serviceDetail, { relationName: "ServiceSalesGL" }),
  servicePurchaseFor: many(serviceDetail, { relationName: "ServicePurchaseGL" }),
  fixedAssetFor: many(fixedAssetDetail, { relationName: "FixedAssetGL" }),
  fixedAssetAccumDeprFor: many(fixedAssetDetail, {
    relationName: "FixedAssetAccumDeprGL",
  }),
  fixedAssetDeprExpenseFor: many(fixedAssetDetail, {
    relationName: "FixedAssetDeprExpenseGL",
  }),
  bundleSalesFor: many(bundleDetail, { relationName: "BundleSalesGL" }),
}));

export const subLedgerRelations = relations(subLedger, ({ one, many }) => ({
  generalLedger: one(generalLedger, {
    fields: [subLedger.generalLedgerId],
    references: [generalLedger.id],
  }),
  party: one(party, {
    fields: [subLedger.partyId],
    references: [party.id],
  }),
  openingBalances: many(openingBalance),
}));

// ============================================================
// AREA / AGENT / PARTY
// ============================================================

export const areaRelations = relations(area, ({ one, many }) => ({
  company: one(company, {
    fields: [area.companyId],
    references: [company.id],
  }),
  subAreas: many(subArea),
}));

export const subAreaRelations = relations(subArea, ({ one, many }) => ({
  area: one(area, {
    fields: [subArea.areaId],
    references: [area.id],
  }),
  generalLedgers: many(generalLedger),
  parties: many(party),
}));

export const agentRelations = relations(agent, ({ one, many }) => ({
  company: one(company, {
    fields: [agent.companyId],
    references: [company.id],
  }),
  generalLedgers: many(generalLedger),
  parties: many(party),
  journalVoucherLines: many(journalVoucherLine),
  cashBankVoucherLines: many(cashBankVoucherLine),
}));

export const partyRelations = relations(party, ({ one, many }) => ({
  company: one(company, {
    fields: [party.companyId],
    references: [company.id],
  }),
  generalLedger: one(generalLedger, {
    fields: [party.generalLedgerId],
    references: [generalLedger.id],
  }),
  subArea: one(subArea, {
    fields: [party.subAreaId],
    references: [subArea.id],
  }),
  agent: one(agent, {
    fields: [party.agentId],
    references: [agent.id],
  }),
  customerDetail: one(customerDetail), // inverse of CustomerDetail.partyId (1:1)
  vendorDetail: one(vendorDetail), // inverse of VendorDetail.partyId (1:1)
  subLedgers: many(subLedger),
  stockDefaultVendorFor: many(stockDetail, {
    relationName: "StockDefaultVendor",
  }),
}));

export const customerDetailRelations = relations(customerDetail, ({ one }) => ({
  party: one(party, {
    fields: [customerDetail.partyId],
    references: [party.id],
  }),
}));

export const vendorDetailRelations = relations(vendorDetail, ({ one }) => ({
  party: one(party, {
    fields: [vendorDetail.partyId],
    references: [party.id],
  }),
}));

// ============================================================
// VOUCHERS
// ============================================================

export const journalVoucherRelations = relations(
  journalVoucher,
  ({ one, many }) => ({
    company: one(company, {
      fields: [journalVoucher.companyId],
      references: [company.id],
    }),
    branch: one(branch, {
      fields: [journalVoucher.branchId],
      references: [branch.id],
    }),
    reversalOf: one(journalVoucher, {
      fields: [journalVoucher.reversalOfId],
      references: [journalVoucher.id],
      relationName: "JVReversal",
    }),
    reversedBy: many(journalVoucher, { relationName: "JVReversal" }),
    postedByUser: one(user, {
      fields: [journalVoucher.postedBy],
      references: [user.id],
      relationName: "JVPostedBy",
    }),
    createdByUser: one(user, {
      fields: [journalVoucher.createdBy],
      references: [user.id],
      relationName: "JVCreatedBy",
    }),
    lines: many(journalVoucherLine),
  }),
);

export const journalVoucherLineRelations = relations(
  journalVoucherLine,
  ({ one }) => ({
    journalVoucher: one(journalVoucher, {
      fields: [journalVoucherLine.journalVoucherId],
      references: [journalVoucher.id],
    }),
    generalLedger: one(generalLedger, {
      fields: [journalVoucherLine.generalLedgerId],
      references: [generalLedger.id],
    }),
    agent: one(agent, {
      fields: [journalVoucherLine.agentId],
      references: [agent.id],
    }),
  }),
);

export const cashBankVoucherRelations = relations(
  cashBankVoucher,
  ({ one, many }) => ({
    company: one(company, {
      fields: [cashBankVoucher.companyId],
      references: [company.id],
    }),
    branch: one(branch, {
      fields: [cashBankVoucher.branchId],
      references: [branch.id],
    }),
    reversalOf: one(cashBankVoucher, {
      fields: [cashBankVoucher.reversalOfId],
      references: [cashBankVoucher.id],
      relationName: "CBReversal",
    }),
    reversedBy: many(cashBankVoucher, { relationName: "CBReversal" }),
    postedByUser: one(user, {
      fields: [cashBankVoucher.postedBy],
      references: [user.id],
      relationName: "CBPostedBy",
    }),
    createdByUser: one(user, {
      fields: [cashBankVoucher.createdBy],
      references: [user.id],
      relationName: "CBCreatedBy",
    }),
    lines: many(cashBankVoucherLine),
  }),
);

export const cashBankVoucherLineRelations = relations(
  cashBankVoucherLine,
  ({ one }) => ({
    cashBankVoucher: one(cashBankVoucher, {
      fields: [cashBankVoucherLine.cashBankVoucherId],
      references: [cashBankVoucher.id],
    }),
    generalLedger: one(generalLedger, {
      fields: [cashBankVoucherLine.generalLedgerId],
      references: [generalLedger.id],
    }),
    clearedByUser: one(user, {
      fields: [cashBankVoucherLine.clearedBy],
      references: [user.id],
      relationName: "CBLineClearedBy",
    }),
    agent: one(agent, {
      fields: [cashBankVoucherLine.agentId],
      references: [agent.id],
    }),
  }),
);

// ============================================================
// OPENING BALANCES
// ============================================================

export const openingBalanceRelations = relations(
  openingBalance,
  ({ one, many }) => ({
    company: one(company, {
      fields: [openingBalance.companyId],
      references: [company.id],
    }),
    branch: one(branch, {
      fields: [openingBalance.branchId],
      references: [branch.id],
    }),
    fiscalYear: one(fiscalYear, {
      fields: [openingBalance.fiscalYearId],
      references: [fiscalYear.id],
    }),
    generalLedger: one(generalLedger, {
      fields: [openingBalance.generalLedgerId],
      references: [generalLedger.id],
    }),
    subLedger: one(subLedger, {
      fields: [openingBalance.subLedgerId],
      references: [subLedger.id],
    }),
    carriedForwardFrom: one(openingBalance, {
      fields: [openingBalance.carriedForwardFromId],
      references: [openingBalance.id],
      relationName: "OBCarryForward",
    }),
    carriedForwardTo: many(openingBalance, { relationName: "OBCarryForward" }),
    createdByUser: one(user, {
      fields: [openingBalance.createdBy],
      references: [user.id],
      relationName: "OBCreatedBy",
    }),
  }),
);

export const stockOpeningBalanceRelations = relations(
  stockOpeningBalance,
  ({ one, many }) => ({
    branch: one(branch, {
      fields: [stockOpeningBalance.branchId],
      references: [branch.id],
    }),
    fiscalYear: one(fiscalYear, {
      fields: [stockOpeningBalance.fiscalYearId],
      references: [fiscalYear.id],
    }),
    stockDetail: one(stockDetail, {
      fields: [stockOpeningBalance.stockDetailId],
      references: [stockDetail.id],
    }),
    location: one(location, {
      fields: [stockOpeningBalance.locationId],
      references: [location.id],
      relationName: "StockOpeningBalanceLocation",
    }),
    carriedForwardFrom: one(stockOpeningBalance, {
      fields: [stockOpeningBalance.carriedForwardFromId],
      references: [stockOpeningBalance.id],
      relationName: "SOBCarryForward",
    }),
    carriedForwardTo: many(stockOpeningBalance, {
      relationName: "SOBCarryForward",
    }),
  }),
);

// ============================================================
// PRODUCT CATALOG
// ============================================================

export const productGroupRelations = relations(productGroup, ({ one, many }) => ({
  company: one(company, {
    fields: [productGroup.companyId],
    references: [company.id],
  }),
  subGroups: many(productSubGroup),
}));

export const productSubGroupRelations = relations(
  productSubGroup,
  ({ one, many }) => ({
    productGroup: one(productGroup, {
      fields: [productSubGroup.productGroupId],
      references: [productGroup.id],
    }),
    products: many(product),
  }),
);

export const productUnitRelations = relations(productUnit, ({ one, many }) => ({
  company: one(company, {
    fields: [productUnit.companyId],
    references: [company.id],
  }),
  stockBaseFor: many(stockDetail, { relationName: "StockBaseUnit" }),
  nonStockUnitFor: many(nonStockDetail, { relationName: "NonStockUnit" }),
  serviceUnitFor: many(serviceDetail, { relationName: "ServiceUnit" }),
  alternateUnitFor: many(alternateUnit, { relationName: "AltUnit" }),
}));

export const taxRateRelations = relations(taxRate, ({ one, many }) => ({
  company: one(company, {
    fields: [taxRate.companyId],
    references: [company.id],
  }),
  stockDetails: many(stockDetail),
  nonStockDetails: many(nonStockDetail),
  serviceDetails: many(serviceDetail),
}));

export const stockCategoryRelations = relations(
  stockCategory,
  ({ one, many }) => ({
    company: one(company, {
      fields: [stockCategory.companyId],
      references: [company.id],
    }),
    stockDetails: many(stockDetail),
  }),
);

export const locationRelations = relations(location, ({ one, many }) => ({
  company: one(company, {
    fields: [location.companyId],
    references: [company.id],
  }),
  parent: one(location, {
    fields: [location.parentId],
    references: [location.id],
    relationName: "LocationHierarchy",
  }),
  children: many(location, { relationName: "LocationHierarchy" }),
  stockDetails: many(stockDetail, { relationName: "StockDefaultLocation" }),
  fixedAssetDetails: many(fixedAssetDetail, {
    relationName: "FixedAssetLocation",
  }),
  stockOpeningBalances: many(stockOpeningBalance, {
    relationName: "StockOpeningBalanceLocation",
  }),
}));

export const productRelations = relations(product, ({ one, many }) => ({
  company: one(company, {
    fields: [product.companyId],
    references: [company.id],
  }),
  productSubGroup: one(productSubGroup, {
    fields: [product.productSubGroupId],
    references: [productSubGroup.id],
  }),
  // inverse sides of the 1:1 detail tables
  stockDetail: one(stockDetail),
  nonStockDetail: one(nonStockDetail),
  serviceDetail: one(serviceDetail),
  fixedAssetDetail: one(fixedAssetDetail),
  bundleDetail: one(bundleDetail),
  bundleComponentOf: many(bundleComponent, {
    relationName: "BundleComponentProduct",
  }),
}));

export const stockDetailRelations = relations(stockDetail, ({ one, many }) => ({
  product: one(product, {
    fields: [stockDetail.productId],
    references: [product.id],
  }),
  baseUnit: one(productUnit, {
    fields: [stockDetail.baseUnitId],
    references: [productUnit.id],
    relationName: "StockBaseUnit",
  }),
  stockCategory: one(stockCategory, {
    fields: [stockDetail.stockCategoryId],
    references: [stockCategory.id],
  }),
  defaultLocation: one(location, {
    fields: [stockDetail.defaultLocationId],
    references: [location.id],
    relationName: "StockDefaultLocation",
  }),
  taxRate: one(taxRate, {
    fields: [stockDetail.taxRateId],
    references: [taxRate.id],
  }),

  openingGL: one(generalLedger, {
    fields: [stockDetail.openingGLId],
    references: [generalLedger.id],
    relationName: "StockOpeningGL",
  }),
  closingPLGL: one(generalLedger, {
    fields: [stockDetail.closingPLGLId],
    references: [generalLedger.id],
    relationName: "StockClosingPLGL",
  }),
  closingBSGL: one(generalLedger, {
    fields: [stockDetail.closingBSGLId],
    references: [generalLedger.id],
    relationName: "StockClosingBSGL",
  }),
  purchaseGL: one(generalLedger, {
    fields: [stockDetail.purchaseGLId],
    references: [generalLedger.id],
    relationName: "StockPurchaseGL",
  }),
  purchaseReturnGL: one(generalLedger, {
    fields: [stockDetail.purchaseReturnGLId],
    references: [generalLedger.id],
    relationName: "StockPurchaseReturnGL",
  }),
  salesGL: one(generalLedger, {
    fields: [stockDetail.salesGLId],
    references: [generalLedger.id],
    relationName: "StockSalesGL",
  }),
  salesReturnGL: one(generalLedger, {
    fields: [stockDetail.salesReturnGLId],
    references: [generalLedger.id],
    relationName: "StockSalesReturnGL",
  }),

  defaultVendor: one(party, {
    fields: [stockDetail.defaultVendorId],
    references: [party.id],
    relationName: "StockDefaultVendor",
  }),

  alternateUnits: many(alternateUnit),
  openingBalances: many(stockOpeningBalance),
}));

export const alternateUnitRelations = relations(alternateUnit, ({ one }) => ({
  stockDetail: one(stockDetail, {
    fields: [alternateUnit.stockDetailId],
    references: [stockDetail.id],
  }),
  unit: one(productUnit, {
    fields: [alternateUnit.unitId],
    references: [productUnit.id],
    relationName: "AltUnit",
  }),
}));

export const nonStockDetailRelations = relations(nonStockDetail, ({ one }) => ({
  product: one(product, {
    fields: [nonStockDetail.productId],
    references: [product.id],
  }),
  unit: one(productUnit, {
    fields: [nonStockDetail.unitId],
    references: [productUnit.id],
    relationName: "NonStockUnit",
  }),
  taxRate: one(taxRate, {
    fields: [nonStockDetail.taxRateId],
    references: [taxRate.id],
  }),
  salesGL: one(generalLedger, {
    fields: [nonStockDetail.salesGLId],
    references: [generalLedger.id],
    relationName: "NonStockSalesGL",
  }),
  purchaseGL: one(generalLedger, {
    fields: [nonStockDetail.purchaseGLId],
    references: [generalLedger.id],
    relationName: "NonStockPurchaseGL",
  }),
}));

export const serviceDetailRelations = relations(serviceDetail, ({ one }) => ({
  product: one(product, {
    fields: [serviceDetail.productId],
    references: [product.id],
  }),
  unit: one(productUnit, {
    fields: [serviceDetail.unitId],
    references: [productUnit.id],
    relationName: "ServiceUnit",
  }),
  taxRate: one(taxRate, {
    fields: [serviceDetail.taxRateId],
    references: [taxRate.id],
  }),
  salesGL: one(generalLedger, {
    fields: [serviceDetail.salesGLId],
    references: [generalLedger.id],
    relationName: "ServiceSalesGL",
  }),
  purchaseGL: one(generalLedger, {
    fields: [serviceDetail.purchaseGLId],
    references: [generalLedger.id],
    relationName: "ServicePurchaseGL",
  }),
}));

export const fixedAssetDetailRelations = relations(
  fixedAssetDetail,
  ({ one }) => ({
    product: one(product, {
      fields: [fixedAssetDetail.productId],
      references: [product.id],
    }),
    assetGL: one(generalLedger, {
      fields: [fixedAssetDetail.assetGLId],
      references: [generalLedger.id],
      relationName: "FixedAssetGL",
    }),
    accumulatedDeprGL: one(generalLedger, {
      fields: [fixedAssetDetail.accumulatedDeprGLId],
      references: [generalLedger.id],
      relationName: "FixedAssetAccumDeprGL",
    }),
    depreciationExpenseGL: one(generalLedger, {
      fields: [fixedAssetDetail.depreciationExpenseGLId],
      references: [generalLedger.id],
      relationName: "FixedAssetDeprExpenseGL",
    }),
    location: one(location, {
      fields: [fixedAssetDetail.locationId],
      references: [location.id],
      relationName: "FixedAssetLocation",
    }),
  }),
);

export const bundleDetailRelations = relations(bundleDetail, ({ one, many }) => ({
  product: one(product, {
    fields: [bundleDetail.productId],
    references: [product.id],
  }),
  salesGL: one(generalLedger, {
    fields: [bundleDetail.salesGLId],
    references: [generalLedger.id],
    relationName: "BundleSalesGL",
  }),
  components: many(bundleComponent),
}));

export const bundleComponentRelations = relations(bundleComponent, ({ one }) => ({
  bundleDetail: one(bundleDetail, {
    fields: [bundleComponent.bundleDetailId],
    references: [bundleDetail.id],
  }),
  componentProduct: one(product, {
    fields: [bundleComponent.componentProductId],
    references: [product.id],
    relationName: "BundleComponentProduct",
  }),
}));
