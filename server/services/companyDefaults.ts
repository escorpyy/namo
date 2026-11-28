import { and, eq } from "drizzle-orm";
import { GL_SETUP_ROLES, type GlRoleKey } from "../../shared/glSetup";
import * as S from "../db/schema";
import { HttpError } from "../routes/_util";
import { inActorTx, type Actor, type Tx } from "./purchase/common";

// Defaults every company needs, kept apart from demo data. Everything here is idempotent: re-running it only adds what is missing.

export async function seedChartOfAccounts(tx: Tx, companyId: number) {
  // Chart of Accounts: ensure each group/subgroup independently on every run.
  // Codes are stable identifiers; descriptions/types are corrected in place.
  const ensureGroup = async (
    code: string,
    description: string,
    type: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE",
  ) => {
    const [existing] = await tx.select().from(S.accountGroup).where(
      and(eq(S.accountGroup.companyId, companyId), eq(S.accountGroup.code, code)),
    );
    if (!existing && /^AG\d{3}$/.test(code)) {
      const legacyCode = `AG${String(Number(code.slice(2))).padStart(2, "0")}`;
      const [legacy] = await tx.select().from(S.accountGroup).where(
        and(eq(S.accountGroup.companyId, companyId), eq(S.accountGroup.code, legacyCode)),
      );
      if (legacy) {
        const [migrated] = await tx.update(S.accountGroup).set({ code }).where(eq(S.accountGroup.id, legacy.id)).returning();
        return migrated;
      }
    }
    const [nameOwner] = await tx.select().from(S.accountGroup).where(
      and(eq(S.accountGroup.companyId, companyId), eq(S.accountGroup.description, description)),
    );
    if (nameOwner && nameOwner.code !== code) {
      throw new Error(`Cannot seed account group ${code} (${description}): description is already used by ${nameOwner.code}.`);
    }
    if (existing) {
      if (existing.description !== description || existing.type !== type) {
        const [updated] = await tx.update(S.accountGroup)
          .set({ description, type, isActive: true })
          .where(eq(S.accountGroup.id, existing.id))
          .returning();
        return updated;
      }
      return existing;
    }
    return (await tx.insert(S.accountGroup).values({
      companyId: companyId, code, description, type,
    }).returning())[0];
  };

  const groupDefinitions = [
    ["AG001", "Current Assets", "ASSET"],
    ["AG002", "Fixed Assets", "ASSET"],
    ["AG003", "Current Liabilities", "LIABILITY"],
    ["AG004", "Capital", "EQUITY"],
    ["AG005", "Direct Income", "REVENUE"],
    ["AG006", "Indirect Income", "REVENUE"],
    ["AG007", "Direct Expenses", "EXPENSE"],
    ["AG008", "Indirect Expenses", "EXPENSE"],
    ["AG009", "Non-current Liabilities", "LIABILITY"],
    ["AG010", "Provisions", "LIABILITY"],
    ["AG011", "Reserves & Surplus", "EQUITY"],
    ["AG012", "Other Assets", "ASSET"],
    ["AG013", "Non-current Assets", "ASSET"],
  ] as const;

  for (const [code, description, type] of groupDefinitions) {
    await ensureGroup(code, description, type);
  }

  // `named` is the description to give the sub group; without it an existing sub group is left as it is (the ledger catalogue only needs to find it).
  const ensureSub = async (groupCode: string, subCode: string, named?: string) => {
    const description = named ?? subCode;
    const [group] = await tx.select().from(S.accountGroup).where(
      and(eq(S.accountGroup.companyId, companyId), eq(S.accountGroup.code, groupCode)),
    );
    if (!group) throw new Error(`Account group ${groupCode} is missing while seeding ${description}.`);
    const [existing] = await tx.select().from(S.accountSubGroup).where(
      and(eq(S.accountSubGroup.accountGroupId, group.id), eq(S.accountSubGroup.code, subCode)),
    );
    if (!existing && /^AS\d{3}$/.test(subCode)) {
      const legacyCode = `SG${String(Number(subCode.slice(2))).padStart(2, "0")}`;
      const [legacy] = await tx.select().from(S.accountSubGroup).where(
        and(eq(S.accountSubGroup.accountGroupId, group.id), eq(S.accountSubGroup.code, legacyCode)),
      );
      if (legacy) {
        const [migrated] = await tx.update(S.accountSubGroup).set({ code: subCode }).where(eq(S.accountSubGroup.id, legacy.id)).returning();
        return migrated;
      }
    }
    const [nameOwner] = await tx.select().from(S.accountSubGroup).where(
      and(eq(S.accountSubGroup.accountGroupId, group.id), eq(S.accountSubGroup.description, description)),
    );
    if (named && nameOwner && nameOwner.code !== subCode) {
      throw new Error(`Cannot seed subgroup ${groupCode}/${subCode} (${description}): description is already used by ${nameOwner.code}.`);
    }
    if (existing) {
      if (named && existing.description !== description) {
        const [updated] = await tx.update(S.accountSubGroup)
          .set({ description, isActive: true })
          .where(eq(S.accountSubGroup.id, existing.id))
          .returning();
        return updated;
      }
      return existing;
    }
    return (await tx.insert(S.accountSubGroup).values({
      accountGroupId: group.id, code: subCode, description,
    }).returning())[0];
  };

  const subgroupDefinitions = [
    // Current assets
    ["AG001", "AS001", "Cash-in-Hand"],
    ["AG001", "AS002", "Bank Accounts"],
    ["AG001", "AS003", "Stock-in-Hand"],
    ["AG001", "AS004", "Sundry Debtors"],
    ["AG001", "AS005", "Duties & Taxes"],
    ["AG001", "AS006", "Loans & Advances (Asset)"],
    ["AG001", "AS007", "Supplier Advances"],
    ["AG001", "AS008", "Staff Advances"],
    ["AG001", "AS009", "Prepaid Expenses"],
    ["AG001", "AS010", "Short-term Security Deposits"],
    ["AG001", "AS011", "Other Receivables"],
    ["AG001", "AS012", "Cash Equivalents & Short-term Investments"],
    // Fixed assets
    ["AG002", "AS001", "Land & Buildings"],
    ["AG002", "AS002", "Plant & Machinery"],
    ["AG002", "AS003", "Furniture & Fixtures"],
    ["AG002", "AS004", "Vehicles"],
    ["AG002", "AS005", "Computers & Office Equipment"],
    ["AG002", "AS006", "Accumulated Depreciation"],
    ["AG002", "AS007", "Construction in Progress"],
    // Current liabilities
    ["AG003", "AS001", "Sundry Creditors"],
    ["AG003", "AS002", "Duties & Taxes Payable"],
    ["AG003", "AS003", "Outstanding Expenses"],
    ["AG003", "AS004", "Customer Advances"],
    ["AG003", "AS005", "Short-term Borrowings"],
    ["AG003", "AS006", "Tax and Statutory Payables"],
    ["AG003", "AS007", "Deferred Revenue"],
    // Equity
    ["AG004", "AS001", "Owner's Capital"],
    ["AG004", "AS002", "Drawings"],
    ["AG004", "AS003", "Partners' Capital"],
    ["AG004", "AS004", "Share Capital"],
    ["AG004", "AS005", "Retained Earnings"],
    // Income
    ["AG005", "AS001", "Sales Accounts"],
    ["AG005", "AS002", "Sales Returns"],
    ["AG006", "AS001", "Interest Received"],
    ["AG006", "AS002", "Discount Received"],
    ["AG006", "AS003", "Commission Received"],
    ["AG006", "AS004", "Rent Received"],
    ["AG006", "AS005", "Other Operating Income"],
    // Expenses
    ["AG007", "AS001", "Purchase Accounts"],
    ["AG007", "AS002", "Purchase Returns"],
    ["AG007", "AS003", "Direct Wages"],
    ["AG007", "AS004", "Freight Inward"],
    ["AG007", "AS005", "Factory / Production Overheads"],
    ["AG008", "AS001", "Administrative Expenses"],
    ["AG008", "AS002", "Salaries & Wages"],
    ["AG008", "AS003", "Rent & Utilities"],
    ["AG008", "AS004", "Bank Charges"],
    ["AG008", "AS005", "Repairs & Maintenance"],
    ["AG008", "AS006", "Depreciation"],
    ["AG008", "AS007", "Selling & Distribution Expenses"],
    ["AG008", "AS008", "Finance Costs"],
    ["AG008", "AS009", "Professional & Compliance Expenses"],
    // Non-current liabilities
    ["AG009", "AS001", "Long-term Loans"],
    ["AG009", "AS002", "Secured Loans"],
    ["AG009", "AS003", "Unsecured Loans"],
    ["AG009", "AS004", "Lease Liabilities"],
    // Provisions and reserves
    ["AG010", "AS001", "Provision for Income Tax"],
    ["AG010", "AS002", "Employee Benefit Provisions"],
    ["AG010", "AS003", "Other Provisions"],
    ["AG011", "AS001", "General Reserve"],
    ["AG011", "AS002", "Retained Earnings"],
    // Other / non-current assets
    ["AG012", "AS001", "Other Current Assets"],
    ["AG012", "AS002", "Deposits & Margin Money"],
    ["AG013", "AS001", "Long-term Investments"],
    ["AG013", "AS002", "Long-term Security Deposits"],
    ["AG013", "AS003", "Intangible Assets"],
    ["AG013", "AS004", "Long-term Deposits"],
  ] as const;

  for (const [groupCode, subCode, description] of subgroupDefinitions) {
    await ensureSub(groupCode, subCode, description);
  }

  // Demo General Ledgers: stable codes are preserved, while missing ledgers are added on every seed run.
  // The catalogue follows the Class 11/12 pattern: balance-sheet families first, then trading, income and expense heads.
  const ensureLedger = async (
    code: string,
    name: string,
    groupCode: string,
    subCode: string,
    normalBalance: "DEBIT" | "CREDIT",
    flags: Partial<{ isCashOrBank: boolean; postsToCashBook: boolean; requiresSubLedger: boolean }> = {},
  ) => {
    const [existing] = await tx.select().from(S.generalLedger).where(and(eq(S.generalLedger.companyId, companyId), eq(S.generalLedger.code, code)));
    if (existing) return existing; // Never move or rewrite a user's explicit ledger mapping.
    const subgroup = await ensureSub(groupCode, subCode);
    return (await tx.insert(S.generalLedger).values({
      companyId: companyId, code, name, accountGroupId: subgroup.accountGroupId, accountSubGroupId: subgroup.id, normalBalance, ...flags,
    }).returning())[0];
  };

  const ledgerDefinitions: [string, string, string, string, "DEBIT" | "CREDIT", Partial<{ isCashOrBank: boolean; postsToCashBook: boolean; requiresSubLedger: boolean }>][] = [
    // Current assets and control accounts
    ["GL001", "Cash in Hand", "AG001", "AS001", "DEBIT", { isCashOrBank: true, postsToCashBook: true }],
    ["GL002", "Bank Account", "AG001", "AS002", "DEBIT", { isCashOrBank: true }],
    ["GL003", "Stock in Hand", "AG001", "AS003", "DEBIT", {}],
    ["GL004", "Accounts Receivable - Control", "AG001", "AS004", "DEBIT", {}],
    ["GL005", "Supplier Advances", "AG001", "AS007", "DEBIT", {}],
    ["GL006", "Prepaid Expenses", "AG001", "AS009", "DEBIT", {}],
    ["GL007", "Other Receivables", "AG001", "AS011", "DEBIT", {}],
    ["GL008", "Short-term Investments", "AG001", "AS012", "DEBIT", {}],
    // Fixed assets and contra asset
    ["GL060", "Vehicles", "AG002", "AS004", "DEBIT", {}],
    ["GL061", "Accumulated Depreciation - Vehicles", "AG002", "AS006", "CREDIT", {}],
    ["GL063", "Land & Buildings", "AG002", "AS001", "DEBIT", {}],
    ["GL064", "Plant & Machinery", "AG002", "AS002", "DEBIT", {}],
    ["GL065", "Furniture & Fixtures", "AG002", "AS003", "DEBIT", {}],
    ["GL066", "Computers & Office Equipment", "AG002", "AS005", "DEBIT", {}],
    ["GL067", "Construction in Progress", "AG002", "AS007", "DEBIT", {}],
    // Current and non-current liabilities
    ["GL011", "Accounts Payable - Control", "AG003", "AS001", "CREDIT", {}],
    ["GL012", "Outstanding Expenses", "AG003", "AS003", "CREDIT", {}],
    ["GL013", "Customer Advances", "AG003", "AS004", "CREDIT", {}],
    ["GL014", "Short-term Borrowings", "AG003", "AS005", "CREDIT", {}],
    ["GL015", "Long-term Loans", "AG009", "AS001", "CREDIT", {}],
    ["GL016", "Provision for Income Tax", "AG010", "AS001", "CREDIT", {}],
    // Equity
    ["GL010", "Owner's Capital", "AG004", "AS001", "CREDIT", {}],
    ["GL017", "Drawings", "AG004", "AS002", "DEBIT", {}],
    ["GL018", "Retained Earnings", "AG004", "AS005", "CREDIT", {}],
    ["GL019", "Profit & Loss Account", "AG004", "AS005", "CREDIT", {}], // year-end close clears the result here (GL Setup: PROFIT_AND_LOSS)
    // Trading and income
    ["GL020", "Sales", "AG005", "AS001", "CREDIT", {}],
    ["GL021", "Sales Returns", "AG005", "AS002", "DEBIT", {}],
    ["GL022", "Interest Received", "AG006", "AS001", "CREDIT", {}],
    ["GL023", "Discount Received", "AG006", "AS002", "CREDIT", {}],
    ["GL024", "Commission Received", "AG006", "AS003", "CREDIT", {}],
    ["GL025", "Other Operating Income", "AG006", "AS005", "CREDIT", {}],
    // Direct and indirect expenses
    ["GL040", "Purchases", "AG007", "AS001", "DEBIT", {}],
    ["GL041", "Purchase Returns", "AG007", "AS002", "CREDIT", {}],
    ["GL042", "Direct Wages", "AG007", "AS003", "DEBIT", {}],
    ["GL043", "Freight Inward", "AG007", "AS004", "DEBIT", {}],
    ["GL044", "Factory Overheads", "AG007", "AS005", "DEBIT", {}],
    ["GL030", "Rent Expense", "AG008", "AS003", "DEBIT", {}],
    ["GL031", "Salary Expense", "AG008", "AS002", "DEBIT", {}],
    ["GL032", "Other Expenses", "AG008", "AS001", "DEBIT", {}],
    ["GL033", "Bank Charges", "AG008", "AS004", "DEBIT", {}],
    ["GL034", "Repairs & Maintenance", "AG008", "AS005", "DEBIT", {}],
    ["GL035", "Selling & Distribution Expense", "AG008", "AS007", "DEBIT", {}],
    ["GL036", "Interest Expense", "AG008", "AS008", "DEBIT", {}],
    ["GL037", "Professional & Compliance Expense", "AG008", "AS009", "DEBIT", {}],
    ["GL062", "Depreciation Expense", "AG008", "AS006", "DEBIT", {}],
    // Stock-flow and tax ledgers used by product, term and GL setup defaults
    ["GL050", "Opening Stock", "AG007", "AS001", "DEBIT", {}],
    ["GL051", "Closing Stock (P&L)", "AG005", "AS001", "CREDIT", {}],
    ["GL070", "VAT Input (Receivable)", "AG001", "AS005", "DEBIT", {}],
    ["GL071", "VAT Output (Payable)", "AG003", "AS006", "CREDIT", {}],
    ["GL072", "Import VAT Input (Receivable)", "AG001", "AS005", "DEBIT", {}],
    ["GL073", "Customs Duty", "AG007", "AS004", "DEBIT", {}],
    ["GL074", "Excise Duty", "AG007", "AS004", "DEBIT", {}],
  ];
  for (const [code, name, groupCode, subCode, normalBalance, flags] of ledgerDefinitions)
    await ensureLedger(code, name, groupCode, subCode, normalBalance, flags);
}

// GL Setup role -> ledger code. The codes are the ones seedChartOfAccounts creates, so keep the two in step.
export const DEFAULT_GL_SETUP: Record<GlRoleKey, string> = {
  PROFIT_AND_LOSS: "GL019",
  CASH_BOOK: "GL001",
  SALES_ACCOUNT: "GL020",
  SALES_RETURN_ACCOUNT: "GL021",
  PURCHASE_ACCOUNT: "GL040",
  PURCHASE_RETURN_ACCOUNT: "GL041",
  INPUT_VAT: "GL070",
  OUTPUT_VAT: "GL071",
  IMPORT_INPUT_VAT: "GL072",
  OPENING_STOCK_PL: "GL050",
  CLOSING_STOCK_PL: "GL051",
  CLOSING_STOCK_BS: "GL003",
};

export async function seedGlSetup(tx: Tx, companyId: number) {
  const ledgers = await tx.select({ id: S.generalLedger.id, code: S.generalLedger.code })
    .from(S.generalLedger).where(eq(S.generalLedger.companyId, companyId));
  const idByCode = new Map(ledgers.map((l) => [l.code, l.id]));
  for (const role of GL_SETUP_ROLES) {
    const code = DEFAULT_GL_SETUP[role.key];
    const generalLedgerId = idByCode.get(code);
    if (!generalLedgerId) throw new Error(`GL Setup: ledger ${code} is missing for role ${role.key}.`);
    await tx.insert(S.generalLedgerSetup)
      .values({ companyId, role: role.key, generalLedgerId, ...role.defaults })
      // A role the user already mapped is left alone, so this is safe to re-run on an existing company.
      .onConflictDoNothing({ target: [S.generalLedgerSetup.companyId, S.generalLedgerSetup.role] });
  }
}

// One call for a new (or existing) company: chart of accounts first, then the GL Setup that points into it.
export async function seedCompanyDefaults(tx: Tx, companyId: number) {
  await seedChartOfAccounts(tx, companyId);
  await seedGlSetup(tx, companyId);
}

// ---------------------------------------------------------------------------------------------------------------------
// Creating a company: the company, its Head Office, its first fiscal year and the creator's access, all in ONE transaction,
// then the default data only when the user chose it. A failure anywhere leaves nothing half-created.
// ---------------------------------------------------------------------------------------------------------------------
export type CompanySetup = "DEFAULT" | "BLANK";
export type NewCompanyInput = {
  code: string; name: string; businessType: (typeof S.company.$inferInsert)["businessType"];
  fiscalYearCode: string; startDate: string; endDate: string; setup: CompanySetup;
};

export async function createCompany(input: NewCompanyInput, actor: Actor) {
  return inActorTx(actor, undefined, async (tx) => {
    const [taken] = await tx.select({ id: S.company.id }).from(S.company).where(eq(S.company.code, input.code));
    if (taken) throw new HttpError(409, `Company code ${input.code} is already in use.`, "code");

    const [company] = await tx.insert(S.company).values({ code: input.code, name: input.name, businessType: input.businessType }).returning();
    await tx.insert(S.branch).values({ companyId: company.id, code: "HO", name: "Head Office", isHeadOffice: true });
    await tx.insert(S.fiscalYear).values({
      companyId: company.id, code: input.fiscalYearCode, startDate: new Date(input.startDate), endDate: new Date(input.endDate), isCurrent: true,
    });
    // The creator becomes the company's Admin (all branches), like the seeded companies.
    if (actor.userId) await tx.insert(S.userCompanyAccess).values({ userId: actor.userId, companyId: company.id, branchId: null, role: "ADMIN" });

    if (input.setup === "DEFAULT") await seedCompanyDefaults(tx, company.id);
    return { id: company.id, code: company.code, name: company.name, setup: input.setup };
  });
}
