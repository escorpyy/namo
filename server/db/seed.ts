import { and, eq } from "drizzle-orm";
import { db } from "./index";
import * as S from "./schema";

// Idempotent: dobara chalane par sirf wahi data banta hai jo abhi missing hai.
const hasRows = async (table: any, companyId: number) =>
  (await db.select({ id: table.id }).from(table).where(eq(table.companyId, companyId)).limit(1)).length > 0;

async function main() {
  const [anyUser] = await db.select().from(S.user).limit(1);
  if (!anyUser) await db.insert(S.user).values({ name: "Neeraj Sharma", email: "neeraj@namoerp.local" });

  for (const c of [
    { code: "ABC", name: "ABC Traders Pvt. Ltd.", businessType: "PRIVATE_LIMITED" as const },
    { code: "XYZ", name: "XYZ Enterprises", businessType: "PARTNERSHIP" as const },
  ]) {
    let [co] = await db.select().from(S.company).where(eq(S.company.code, c.code));
    if (!co) {
      [co] = await db.insert(S.company).values(c).returning();
      await db.insert(S.branch).values([
        { companyId: co.id, code: "HO", name: "Main Branch", isHeadOffice: true },
        ...(c.code === "ABC" ? [{ companyId: co.id, code: "BR1", name: "Birgunj Branch" }] : []),
      ]);
      await db.insert(S.fiscalYear).values({
        companyId: co.id, code: "2082/083", startDate: new Date("2025-07-17"), endDate: new Date("2026-07-16"), isCurrent: true,
      });
    }
    // Demo user access: Neeraj = Admin (sab branches), Sita = Accountant (sirf Head Office, ABC)
    if (!(await hasRows(S.userCompanyAccess, co.id))) {
      const [neeraj] = await db.select().from(S.user).where(eq(S.user.email, "neeraj@namoerp.local"));
      if (neeraj) await db.insert(S.userCompanyAccess).values({ userId: neeraj.id, companyId: co.id, branchId: null, role: "ADMIN" });
      if (c.code === "ABC") {
        let [sita] = await db.select().from(S.user).where(eq(S.user.email, "sita@namoerp.local"));
        if (!sita) [sita] = await db.insert(S.user).values({ name: "Sita Karki", email: "sita@namoerp.local" }).returning();
        const [ho] = await db.select().from(S.branch).where(and(eq(S.branch.companyId, co.id), eq(S.branch.code, "HO")));
        if (sita && ho) await db.insert(S.userCompanyAccess).values({ userId: sita.id, companyId: co.id, branchId: ho.id, role: "ACCOUNTANT" });
      }
    }

    if (c.code !== "ABC") continue; // demo master data sirf ABC me

    // Chart of Accounts: ensure each group/subgroup independently on every run.
    // Codes are stable identifiers; descriptions/types are corrected in place.
    const ensureGroup = async (
      code: string,
      description: string,
      type: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE",
    ) => {
      const [existing] = await db.select().from(S.accountGroup).where(
        and(eq(S.accountGroup.companyId, co.id), eq(S.accountGroup.code, code)),
      );
      if (!existing && /^AG\d{3}$/.test(code)) {
        const legacyCode = `AG${String(Number(code.slice(2))).padStart(2, "0")}`;
        const [legacy] = await db.select().from(S.accountGroup).where(
          and(eq(S.accountGroup.companyId, co.id), eq(S.accountGroup.code, legacyCode)),
        );
        if (legacy) {
          const [migrated] = await db.update(S.accountGroup).set({ code }).where(eq(S.accountGroup.id, legacy.id)).returning();
          return migrated;
        }
      }
      const [nameOwner] = await db.select().from(S.accountGroup).where(
        and(eq(S.accountGroup.companyId, co.id), eq(S.accountGroup.description, description)),
      );
      if (nameOwner && nameOwner.code !== code) {
        throw new Error(`Cannot seed account group ${code} (${description}): description is already used by ${nameOwner.code}.`);
      }
      if (existing) {
        if (existing.description !== description || existing.type !== type) {
          const [updated] = await db.update(S.accountGroup)
            .set({ description, type, isActive: true })
            .where(eq(S.accountGroup.id, existing.id))
            .returning();
          return updated;
        }
        return existing;
      }
      return (await db.insert(S.accountGroup).values({
        companyId: co.id, code, description, type,
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
      const [group] = await db.select().from(S.accountGroup).where(
        and(eq(S.accountGroup.companyId, co.id), eq(S.accountGroup.code, groupCode)),
      );
      if (!group) throw new Error(`Account group ${groupCode} is missing while seeding ${description}.`);
      const [existing] = await db.select().from(S.accountSubGroup).where(
        and(eq(S.accountSubGroup.accountGroupId, group.id), eq(S.accountSubGroup.code, subCode)),
      );
      if (!existing && /^AS\d{3}$/.test(subCode)) {
        const legacyCode = `SG${String(Number(subCode.slice(2))).padStart(2, "0")}`;
        const [legacy] = await db.select().from(S.accountSubGroup).where(
          and(eq(S.accountSubGroup.accountGroupId, group.id), eq(S.accountSubGroup.code, legacyCode)),
        );
        if (legacy) {
          const [migrated] = await db.update(S.accountSubGroup).set({ code: subCode }).where(eq(S.accountSubGroup.id, legacy.id)).returning();
          return migrated;
        }
      }
      const [nameOwner] = await db.select().from(S.accountSubGroup).where(
        and(eq(S.accountSubGroup.accountGroupId, group.id), eq(S.accountSubGroup.description, description)),
      );
      if (named && nameOwner && nameOwner.code !== subCode) {
        throw new Error(`Cannot seed subgroup ${groupCode}/${subCode} (${description}): description is already used by ${nameOwner.code}.`);
      }
      if (existing) {
        if (named && existing.description !== description) {
          const [updated] = await db.update(S.accountSubGroup)
            .set({ description, isActive: true })
            .where(eq(S.accountSubGroup.id, existing.id))
            .returning();
          return updated;
        }
        return existing;
      }
      return (await db.insert(S.accountSubGroup).values({
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
      const [existing] = await db.select().from(S.generalLedger).where(and(eq(S.generalLedger.companyId, co.id), eq(S.generalLedger.code, code)));
      if (existing) return existing; // Never move or rewrite a user's explicit ledger mapping.
      const subgroup = await ensureSub(groupCode, subCode);
      return (await db.insert(S.generalLedger).values({
        companyId: co.id, code, name, accountGroupId: subgroup.accountGroupId, accountSubGroupId: subgroup.id, normalBalance, ...flags,
      }).returning())[0];
    };

    const ledgerDefinitions: [string, string, string, string, "DEBIT" | "CREDIT", Partial<{ isCashOrBank: boolean; postsToCashBook: boolean; requiresSubLedger: boolean }>][] = [
      // Current assets and control accounts
      ["GL001", "Cash in Hand", "AG001", "AS001", "DEBIT", { isCashOrBank: true, postsToCashBook: true }],
      ["GL002", "Nabil Bank A/C", "AG001", "AS002", "DEBIT", { isCashOrBank: true }],
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

    if (!(await hasRows(S.area, co.id))) {
      const areas = await db.insert(S.area).values([
        { companyId: co.id, code: "A01", name: "Bagmati", shortName: "BAG" },
        { companyId: co.id, code: "A02", name: "Gandaki", shortName: "GAN" },
        { companyId: co.id, code: "A03", name: "Lumbini", shortName: "LUM" },
      ]).returning();
      const [bag, gan] = [areas[0], areas[1]];
      await db.insert(S.subArea).values([
        { areaId: bag.id, code: "S01", name: "Kathmandu", shortName: "KTM" },
        { areaId: bag.id, code: "S02", name: "Lalitpur", shortName: "LTP" },
        { areaId: gan.id, code: "S01", name: "Pokhara", shortName: "PKR" },
      ]);
    }

    if (!(await hasRows(S.agent, co.id)))
      await db.insert(S.agent).values([
        { companyId: co.id, code: "AGT1", name: "Ramesh Karki", phone: "9800000001" },
        { companyId: co.id, code: "AGT2", name: "Sita Thapa", phone: "9800000002" },
      ]);

    // Demo parties: har party = GL + Party + Customer/Vendor detail
    if (!(await hasRows(S.party, co.id))) {
      const [g1] = await db.select().from(S.accountGroup).where(and(eq(S.accountGroup.companyId, co.id), eq(S.accountGroup.code, "AG001")));
      const [g3] = await db.select().from(S.accountGroup).where(and(eq(S.accountGroup.code, "AG003"), eq(S.accountGroup.companyId, co.id)));
      const sub = async (groupId: number, code: string, description: string) => {
        const [ex] = await db.select().from(S.accountSubGroup).where(and(eq(S.accountSubGroup.accountGroupId, groupId), eq(S.accountSubGroup.code, code)));
        return ex ?? (await db.insert(S.accountSubGroup).values({ accountGroupId: groupId, code, description }).returning())[0];
      };
      const debtors = await sub(g1.id, "AS004", "Sundry Debtors");
      const creditors = await sub(g3.id, "AS001", "Sundry Creditors");
      const [ktm] = await db.select().from(S.subArea).where(eq(S.subArea.shortName, "KTM"));
      const [agt] = await db.select().from(S.agent).where(and(eq(S.agent.companyId, co.id), eq(S.agent.code, "AGT1")));
      const demo: { code: string; name: string; type: "CUSTOMER" | "VENDOR" | "BOTH"; sub: { id: number; accountGroupId: number }; city: string; pan: string; credit?: [string, number]; terms?: number }[] = [
        { code: "C001", name: "Ram Traders", type: "CUSTOMER", sub: debtors, city: "Kathmandu", pan: "600123456", credit: ["100000.00", 30] },
        { code: "V001", name: "Sita Suppliers", type: "VENDOR", sub: creditors, city: "Birgunj", pan: "600654321", terms: 45 },
        { code: "B001", name: "Himalayan Mart", type: "BOTH", sub: debtors, city: "Pokhara", pan: "600111222", credit: ["50000.00", 15], terms: 30 },
      ];
      for (const d of demo) {
        const [gl] = await db.insert(S.generalLedger).values({
          companyId: co.id, code: d.code, name: d.name, accountGroupId: d.sub.accountGroupId, accountSubGroupId: d.sub.id, glType: d.type,
          normalBalance: d.sub === debtors ? "DEBIT" : "CREDIT", subAreaId: ktm?.id ?? null, agentId: agt?.id ?? null,
        }).returning();
        const [p] = await db.insert(S.party).values({
          companyId: co.id, generalLedgerId: gl.id, city: d.city, country: "Nepal", panNo: d.pan, isVatRegistered: true,
          subAreaId: ktm?.id ?? null, agentId: agt?.id ?? null,
        }).returning();
        if (d.credit) await db.insert(S.customerDetail).values({ partyId: p.id, creditLimit: d.credit[0], creditDays: d.credit[1] });
        if (d.terms != null) await db.insert(S.vendorDetail).values({ partyId: p.id, paymentTermDays: d.terms });
      }
    }

    // Demo opening balance (ABC, Head Office, FY 2082/083): balanced. Bank ledger me Sub Ledger breakdown ka demo.
    if (!(await hasRows(S.openingBalance, co.id))) {
      const [ho] = await db.select().from(S.branch).where(and(eq(S.branch.companyId, co.id), eq(S.branch.code, "HO")));
      const [fy] = await db.select().from(S.fiscalYear).where(and(eq(S.fiscalYear.companyId, co.id), eq(S.fiscalYear.code, "2082/083")));
      const gl = async (code: string) => (await db.select().from(S.generalLedger).where(and(eq(S.generalLedger.companyId, co.id), eq(S.generalLedger.code, code))))[0];
      const stockGl = await gl("GL003");
      const [cash, bank, cap, ram, sita] = [await gl("GL001"), await gl("GL002"), await gl("GL010"), await gl("C001"), await gl("V001")];
      if (ho && fy && cash && bank && cap && ram && sita) {
        await db.update(S.generalLedger).set({ requiresSubLedger: true }).where(eq(S.generalLedger.id, bank.id));
        const subs = await db.insert(S.subLedger).values([
          { generalLedgerId: bank.id, code: "NB-CUR", name: "Nabil Current A/C" },
          { generalLedgerId: bank.id, code: "NB-SAV", name: "Nabil Savings A/C" },
        ]).onConflictDoNothing().returning();
        const base = { companyId: co.id, branchId: ho.id, fiscalYearId: fy.id };
        await db.insert(S.openingBalance).values([
          { ...base, generalLedgerId: cash.id, debit: "50000.00" },
          ...(subs.length === 2 ? [{ ...base, generalLedgerId: bank.id, subLedgerId: subs[0].id, debit: "200000.00" }, { ...base, generalLedgerId: bank.id, subLedgerId: subs[1].id, debit: "100000.00" }] : []),
          { ...base, generalLedgerId: ram.id, debit: "100000.00" },
          { ...base, generalLedgerId: cap.id, credit: "660000.00" },
          ...(stockGl ? [{ ...base, generalLedgerId: stockGl.id, debit: "310000.00" }] : []),
          { ...base, generalLedgerId: sita.id, credit: "100000.00" },
        ]);
      }
    }

    if (!(await hasRows(S.productGroup, co.id))) {
      const pgs = await db.insert(S.productGroup).values([
        { companyId: co.id, code: "PG01", name: "Groceries" },
        { companyId: co.id, code: "PG02", name: "Electronics" },
      ]).returning();
      await db.insert(S.productSubGroup).values([
        { productGroupId: pgs[0].id, code: "PS01", name: "Rice & Grains" },
        { productGroupId: pgs[0].id, code: "PS02", name: "Oil & Ghee" },
        { productGroupId: pgs[1].id, code: "PS01", name: "Mobiles" },
      ]);
    }

    if (!(await hasRows(S.productUnit, co.id)))
      await db.insert(S.productUnit).values([
        { companyId: co.id, code: "PCS", name: "Pieces", decimalPlaces: 0 },
        { companyId: co.id, code: "KG", name: "Kilogram", decimalPlaces: 3 },
        { companyId: co.id, code: "LTR", name: "Litre", decimalPlaces: 2 },
        { companyId: co.id, code: "BOX", name: "Box", decimalPlaces: 0 },
      ]);

    if (!(await hasRows(S.stockCategory, co.id)))
      await db.insert(S.stockCategory).values([
        { companyId: co.id, code: "RAW", name: "Raw Material" },
        { companyId: co.id, code: "FIN", name: "Finished Goods" },
        { companyId: co.id, code: "TRD", name: "Trading Goods" },
      ]);

    if (!(await hasRows(S.narration, co.id)))
      await db.insert(S.narration).values([
        { companyId: co.id, code: "CASHDEP", narration: "Being cash deposited in bank" },
        { companyId: co.id, code: "CASHWD", narration: "Being cash withdrawn from bank for office use" },
        { companyId: co.id, code: "ELEC", narration: "Being electricity bill paid" },
        { companyId: co.id, code: "RENT", narration: "Being office rent paid for the month" },
        { companyId: co.id, code: "SALARY", narration: "Being staff salary paid for the month" },
        { companyId: co.id, code: "PURCASH", narration: "Being goods purchased in cash" },
      ]);

    if (!(await hasRows(S.location, co.id))) {
      const [godown] = await db.insert(S.location).values({ companyId: co.id, code: "GD1", name: "Main Godown" }).returning();
      await db.insert(S.location).values([
        { companyId: co.id, code: "GD1-A", name: "Rack A", parentId: godown.id },
        { companyId: co.id, code: "GD1-B", name: "Rack B", parentId: godown.id },
      ]);
    }

    // Demo products: 5 types (Stock, Service, Non-stock, Fixed Asset, Bundle) + zaroori GLs
    if (!(await hasRows(S.product, co.id))) {
      const grp = async (code: string) => (await db.select().from(S.accountGroup).where(and(eq(S.accountGroup.companyId, co.id), eq(S.accountGroup.code, code))))[0];
      const sub = async (groupCode: string, subCode: string, description: string) => {
        const g = await grp(groupCode);
        const [ex] = await db.select().from(S.accountSubGroup).where(and(eq(S.accountSubGroup.accountGroupId, g.id), eq(S.accountSubGroup.code, subCode)));
        return ex ?? (await db.insert(S.accountSubGroup).values({ accountGroupId: g.id, code: subCode, description }).returning())[0];
      };
      const gl = async (code: string, name: string, sub: { id: number; accountGroupId: number }, nb: "DEBIT" | "CREDIT") => {
        const [ex] = await db.select().from(S.generalLedger).where(and(eq(S.generalLedger.companyId, co.id), eq(S.generalLedger.code, code)));
        return ex ?? (await db.insert(S.generalLedger).values({ companyId: co.id, code, name, accountGroupId: sub.accountGroupId, accountSubGroupId: sub.id, normalBalance: nb }).returning())[0];
      };
      const purchSub = await sub("AG007", "AS001", "Purchase Accounts");
      const salesSub = await sub("AG005", "AS001", "Sales Accounts");
      const vehSub = await sub("AG002", "AS004", "Vehicles");
      const accDepSub = await sub("AG002", "AS006", "Accumulated Depreciation");
      const admSub = await sub("AG008", "AS006", "Depreciation");
      const stockSub = await sub("AG001", "AS003", "Stock-in-Hand");
      const sales = await gl("GL020", "Sales", salesSub, "CREDIT");
      const purchases = await gl("GL040", "Purchases", purchSub, "DEBIT");
      const purchRet = await gl("GL041", "Purchase Returns", purchSub, "CREDIT");
      const salesRet = await gl("GL021", "Sales Returns", salesSub, "DEBIT");
      const openStock = await gl("GL050", "Opening Stock", purchSub, "DEBIT");
      const closePL = await gl("GL051", "Closing Stock (P&L)", salesSub, "CREDIT");
      const closeBS = await gl("GL003", "Stock in Hand", stockSub, "DEBIT");
      const vehicles = await gl("GL060", "Vehicles", vehSub, "DEBIT");
      const accDep = await gl("GL061", "Accumulated Depreciation - Vehicles", accDepSub, "CREDIT");
      const depExp = await gl("GL062", "Depreciation Expense", admSub, "DEBIT");

      const unit = async (c: string) => (await db.select().from(S.productUnit).where(and(eq(S.productUnit.companyId, co.id), eq(S.productUnit.code, c))))[0];
      const [kg, ltr, pcs, box] = [await unit("KG"), await unit("LTR"), await unit("PCS"), await unit("BOX")];
      const [trd] = await db.select().from(S.stockCategory).where(and(eq(S.stockCategory.companyId, co.id), eq(S.stockCategory.code, "TRD")));
      const [gd1] = await db.select().from(S.location).where(and(eq(S.location.companyId, co.id), eq(S.location.code, "GD1")));
      const [vend] = await db.select({ id: S.party.id }).from(S.party).innerJoin(S.generalLedger, eq(S.party.generalLedgerId, S.generalLedger.id)).where(and(eq(S.party.companyId, co.id), eq(S.generalLedger.code, "V001")));
      const psg = async (name: string) => (await db.select({ id: S.productSubGroup.id }).from(S.productSubGroup).innerJoin(S.productGroup, eq(S.productSubGroup.productGroupId, S.productGroup.id)).where(and(eq(S.productGroup.companyId, co.id), eq(S.productSubGroup.name, name))))[0];
      const rice = await psg("Rice & Grains"), oil = await psg("Oil & Ghee"), mob = await psg("Mobiles");
      const mk = async (code: string, description: string, type: "STOCK" | "NON_STOCK" | "SERVICE" | "FIXED_ASSET" | "BUNDLE", sg: { id: number }, barcode?: string) =>
        (await db.insert(S.product).values({ companyId: co.id, code, description, type, productSubGroupId: sg.id, barcode: barcode ?? null }).returning())[0];

      const p1 = await mk("P001", "Basmati Rice", "STOCK", rice, "8901000000011");
      const sd1 = (await db.insert(S.stockDetail).values({
        productId: p1.id, baseUnitId: kg.id, stockCategoryId: trd?.id, defaultLocationId: gd1?.id, valuationMethod: "WEIGHTED_AVERAGE",
        purchaseRate: "110.00", salesRate: "125.00", mrp: "140.00", minStock: "50", maxStock: "1000", reorderLevel: "100", reorderQty: "200",
        openingGLId: openStock.id, closingPLGLId: closePL.id, closingBSGLId: closeBS.id, purchaseGLId: purchases.id, purchaseReturnGLId: purchRet.id,
        salesGLId: sales.id, salesReturnGLId: salesRet.id, defaultVendorId: vend?.id,
      }).returning())[0];
      await db.insert(S.alternateUnit).values({ stockDetailId: sd1.id, unitId: box.id, conversionFactor: "25" });

      const p2 = await mk("P002", "Sunflower Oil 1L", "STOCK", oil, "8901000000028");
      const sd2 = (await db.insert(S.stockDetail).values({
        productId: p2.id, baseUnitId: ltr.id, stockCategoryId: trd?.id, tracksBatch: true, tracksExpiry: true,
        purchaseRate: "180.00", salesRate: "210.00", openingGLId: openStock.id, closingPLGLId: closePL.id, closingBSGLId: closeBS.id,
        purchaseGLId: purchases.id, salesGLId: sales.id,
      }).returning())[0];

      const p3 = await mk("P003", "Delivery Charge", "SERVICE", mob);
      await db.insert(S.serviceDetail).values({ productId: p3.id, salesGLId: sales.id, purchaseGLId: purchases.id });
      const p4 = await mk("P004", "Packing Material", "NON_STOCK", mob);
      await db.insert(S.nonStockDetail).values({ productId: p4.id, unitId: pcs.id, salesGLId: sales.id, purchaseGLId: purchases.id });
      const p5 = await mk("P005", "Delivery Truck", "FIXED_ASSET", mob);
      await db.insert(S.fixedAssetDetail).values({
        productId: p5.id, assetGLId: vehicles.id, accumulatedDeprGLId: accDep.id, depreciationExpenseGLId: depExp.id, locationId: gd1?.id,
        purchaseDate: new Date("2024-01-15"), originalCost: "4500000.00", salvageValue: "450000.00", usefulLifeYears: 8, depreciationMethod: "STRAIGHT_LINE",
      });
      const p6 = await mk("P006", "Festival Pack", "BUNDLE", rice);
      const bd = (await db.insert(S.bundleDetail).values({ productId: p6.id, salesGLId: sales.id, bundlePrice: "1500.00" }).returning())[0];
      await db.insert(S.bundleComponent).values([
        { bundleDetailId: bd.id, componentProductId: p1.id, quantity: "5" },
        { bundleDetailId: bd.id, componentProductId: p2.id, quantity: "2" },
      ]);

      const [ho] = await db.select().from(S.branch).where(and(eq(S.branch.companyId, co.id), eq(S.branch.code, "HO")));
      const [fy] = await db.select().from(S.fiscalYear).where(and(eq(S.fiscalYear.companyId, co.id), eq(S.fiscalYear.code, "2082/083")));
      const [rackA] = await db.select().from(S.location).where(and(eq(S.location.companyId, co.id), eq(S.location.code, "GD1-A")));
      if (ho && fy) {
        await db.insert(S.stockOpeningBalance).values([
          { branchId: ho.id, fiscalYearId: fy.id, stockDetailId: sd1.id, locationId: rackA?.id, quantity: "2000", rate: "110", value: "220000.00" },
          { branchId: ho.id, fiscalYearId: fy.id, stockDetailId: sd2.id, locationId: gd1?.id, batchNo: "B-2082-01", expiryDate: new Date("2027-03-31"), quantity: "500", rate: "180", value: "90000.00" },
        ]);
      }
    }

    // Demo billing terms (purchase + sales)
    if (!(await hasRows(S.purchaseTerm, co.id))) {
      const gl = async (code: string) => (await db.select().from(S.generalLedger).where(and(eq(S.generalLedger.companyId, co.id), eq(S.generalLedger.code, code))))[0];
      const purchases = await gl("GL040");
      const otherExpenses = (await gl("GL032")) ?? (await gl("GL030")); // an older seeded database has no Other Expenses ledger
      await db.insert(S.purchaseTerm).values([
        { companyId: co.id, code: "DISC", name: "Trade Discount", category: "GENERAL", nature: "DEDUCTIVE", sequence: 10, isProductwise: true, defaultCalcType: "PERCENT", defaultValue: "5", calcBase: "ITEM_VALUE", generalLedgerId: purchases?.id ?? null },
        { companyId: co.id, code: "FREIGHT", name: "Freight Inward", category: "COSTING", nature: "ADDITIVE", sequence: 50, isProductwise: false, defaultCalcType: "AMOUNT", defaultValue: "0", calcBase: "ITEM_VALUE", distributeToLines: true, allocationBasis: "VALUE", generalLedgerId: purchases?.id ?? null },
        { companyId: co.id, code: "ROUND", name: "Round Off", category: "ROUNDED", nature: "ADDITIVE", sequence: 900, isProductwise: false, defaultCalcType: "AMOUNT", defaultValue: "0", calcBase: "RUNNING_TOTAL", isMandatory: true, isEditable: false, generalLedgerId: otherExpenses?.id ?? null },
      ]);
    }
    // Charges for trying out cost assessments and service bills: customs duty and excise (COSTING, so a cost assessment can use them; each posts
    // Dr Purchases / Cr the against ledger chosen on the assessment) and an input VAT for service bills. Added one by code, so `pnpm db:seed`
    // also adds them to a database that already has terms.
    {
      const gl = async (code: string) => (await db.select().from(S.generalLedger).where(and(eq(S.generalLedger.companyId, co.id), eq(S.generalLedger.code, code))))[0];
      const purchases = await gl("GL040");
      let vatInput = await gl("GL070");
      if (!vatInput) {
        const [group] = await db.select().from(S.accountGroup).where(and(eq(S.accountGroup.companyId, co.id), eq(S.accountGroup.code, "AG001")));
        const [existingSub] = await db.select().from(S.accountSubGroup).where(and(eq(S.accountSubGroup.accountGroupId, group.id), eq(S.accountSubGroup.code, "AS005")));
        const taxSub = existingSub ?? (await db.insert(S.accountSubGroup).values({ accountGroupId: group.id, code: "AS005", description: "Duties & Taxes" }).returning())[0];
        vatInput = (await db.insert(S.generalLedger).values({ companyId: co.id, code: "GL070", name: "VAT Input (Receivable)", accountGroupId: taxSub.accountGroupId, accountSubGroupId: taxSub.id, normalBalance: "DEBIT" }).returning())[0];
      }
      const ensureTerm = async (t: typeof S.purchaseTerm.$inferInsert) => {
        const [ex] = await db.select({ id: S.purchaseTerm.id }).from(S.purchaseTerm).where(and(eq(S.purchaseTerm.companyId, co.id), eq(S.purchaseTerm.code, t.code)));
        if (!ex) await db.insert(S.purchaseTerm).values(t);
      };
      await ensureTerm({ companyId: co.id, code: "CUSTOMS", name: "Customs Duty", category: "COSTING", nature: "ADDITIVE", sequence: 10, isProductwise: false, defaultCalcType: "PERCENT", defaultValue: "10", calcBase: "ITEM_VALUE", distributeToLines: true, allocationBasis: "VALUE", generalLedgerId: purchases?.id ?? null });
      await ensureTerm({ companyId: co.id, code: "EXCISE", name: "Excise Duty", category: "COSTING", nature: "ADDITIVE", sequence: 20, isProductwise: false, defaultCalcType: "AMOUNT", defaultValue: "0", calcBase: "ITEM_VALUE", distributeToLines: true, allocationBasis: "QUANTITY", generalLedgerId: purchases?.id ?? null });
      await ensureTerm({ companyId: co.id, code: "VAT", name: "Input VAT", category: "GENERAL", nature: "ADDITIVE", sequence: 90, isProductwise: false, defaultCalcType: "PERCENT", defaultValue: "13", vatTreatment: "INPUT_VAT", generalLedgerId: vatInput.id });
      const importVat = await gl("GL072");
      await ensureTerm({ companyId: co.id, code: "IMPORT_VAT", name: "Import Input VAT", category: "GENERAL", nature: "ADDITIVE", sequence: 95, isProductwise: false, defaultCalcType: "PERCENT", defaultValue: "13", calcBase: "ITEM_VALUE", vatTreatment: "INPUT_VAT", generalLedgerId: importVat?.id ?? vatInput.id });
      // Older demo databases already have this term; only classify the known seeded VAT row and leave custom mappings untouched.
      await db.update(S.purchaseTerm).set({ vatTreatment: "INPUT_VAT" }).where(and(eq(S.purchaseTerm.companyId, co.id), eq(S.purchaseTerm.code, "VAT"), eq(S.purchaseTerm.name, "Input VAT"), eq(S.purchaseTerm.vatTreatment, "NONE")));
    }
    if (!(await hasRows(S.salesTerm, co.id))) {
      const gl = async (code: string) => (await db.select().from(S.generalLedger).where(and(eq(S.generalLedger.companyId, co.id), eq(S.generalLedger.code, code))))[0];
      const sales = await gl("GL020");
      const otherExpenses = (await gl("GL032")) ?? sales; // an older seeded database has no Other Expenses ledger
      await db.insert(S.salesTerm).values([
        { companyId: co.id, code: "DISC", name: "Trade Discount", category: "GENERAL", nature: "DEDUCTIVE", sequence: 10, isProductwise: true, defaultCalcType: "PERCENT", defaultValue: "5", calcBase: "ITEM_VALUE", generalLedgerId: sales?.id ?? null },
        { companyId: co.id, code: "PACK", name: "Packing Charges", category: "COSTING", nature: "ADDITIVE", sequence: 40, isProductwise: false, defaultCalcType: "AMOUNT", defaultValue: "0", calcBase: "ITEM_VALUE", generalLedgerId: sales?.id ?? null },
        { companyId: co.id, code: "ROUND", name: "Round Off", category: "ROUNDED", nature: "ADDITIVE", sequence: 900, isProductwise: false, defaultCalcType: "AMOUNT", defaultValue: "0", calcBase: "RUNNING_TOTAL", isMandatory: true, isEditable: false, generalLedgerId: otherExpenses?.id ?? null },
      ]);
    }
    // Output VAT is a liability, so keep it separate from sales and make the default available
    // even when an older company already has its original sales-term rows.
    {
      const [existing] = await db.select({ id: S.salesTerm.id }).from(S.salesTerm).where(and(eq(S.salesTerm.companyId, co.id), eq(S.salesTerm.code, "VAT")));
      if (!existing) {
        const [outputVat] = await db.select().from(S.generalLedger).where(and(eq(S.generalLedger.companyId, co.id), eq(S.generalLedger.code, "GL071")));
        if (outputVat) await db.insert(S.salesTerm).values({
          companyId: co.id, code: "VAT", name: "Output VAT", category: "GENERAL", nature: "ADDITIVE", sequence: 90,
          isProductwise: false, defaultCalcType: "PERCENT", defaultValue: "13", calcBase: "ITEM_VALUE",
          vatTreatment: "OUTPUT_VAT", generalLedgerId: outputVat.id,
        });
      }
      await db.update(S.salesTerm).set({ vatTreatment: "OUTPUT_VAT" }).where(and(eq(S.salesTerm.companyId, co.id), eq(S.salesTerm.code, "VAT"), eq(S.salesTerm.name, "Output VAT"), eq(S.salesTerm.vatTreatment, "NONE")));
    }
  }

  console.log("Seed done.");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
