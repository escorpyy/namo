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
        companyId: co.id, code: "2082/083", startDate: new Date("2025-07-16"), endDate: new Date("2026-07-15"), isCurrent: true,
      });
    }
    if (c.code !== "ABC") continue; // demo master data sirf ABC me

    if (!(await hasRows(S.accountGroup, co.id))) {
      const groups = await db.insert(S.accountGroup).values([
        { companyId: co.id, code: "AG01", description: "Current Assets", type: "ASSET" },
        { companyId: co.id, code: "AG02", description: "Fixed Assets", type: "ASSET" },
        { companyId: co.id, code: "AG03", description: "Sundry Creditors", type: "LIABILITY" },
        { companyId: co.id, code: "AG04", description: "Capital", type: "EQUITY" },
        { companyId: co.id, code: "AG05", description: "Direct Income", type: "REVENUE" },
        { companyId: co.id, code: "AG06", description: "Indirect Income", type: "REVENUE" },
        { companyId: co.id, code: "AG07", description: "Direct Expenses", type: "EXPENSE" },
        { companyId: co.id, code: "AG08", description: "Indirect Expenses", type: "EXPENSE" },
        { companyId: co.id, code: "AG09", description: "Loans & Advances", type: "LIABILITY" },
        { companyId: co.id, code: "AG10", description: "Provisions", type: "LIABILITY" },
        { companyId: co.id, code: "AG11", description: "Reserves & Surplus", type: "EQUITY" },
        { companyId: co.id, code: "AG12", description: "Other Assets", type: "ASSET" },
      ]).returning();
      const ag01 = groups.find((g) => g.code === "AG01")!;
      await db.insert(S.accountSubGroup).values([
        { accountGroupId: ag01.id, code: "SG01", description: "Cash-in-Hand" },
        { accountGroupId: ag01.id, code: "SG02", description: "Bank Accounts" },
        { accountGroupId: ag01.id, code: "SG03", description: "Stock-in-Hand" },
      ]);
    }

    // Demo General Ledgers (pehle zaroori sub groups ensure karte hain, purani DB me bhi chalega)
    if (!(await hasRows(S.generalLedger, co.id))) {
      const ensureSub = async (groupCode: string, subCode: string, description: string) => {
        const [g] = await db.select().from(S.accountGroup).where(and(eq(S.accountGroup.companyId, co.id), eq(S.accountGroup.code, groupCode)));
        const [ex] = await db.select().from(S.accountSubGroup).where(and(eq(S.accountSubGroup.accountGroupId, g.id), eq(S.accountSubGroup.code, subCode)));
        return ex ?? (await db.insert(S.accountSubGroup).values({ accountGroupId: g.id, code: subCode, description }).returning())[0];
      };
      const cash = await ensureSub("AG01", "SG01", "Cash-in-Hand");
      const bank = await ensureSub("AG01", "SG02", "Bank Accounts");
      const stock = await ensureSub("AG01", "SG03", "Stock-in-Hand");
      const cap = await ensureSub("AG04", "SG01", "Owner's Capital");
      const sales = await ensureSub("AG05", "SG01", "Sales Accounts");
      const adm = await ensureSub("AG08", "SG01", "Administrative Expenses");
      await db.insert(S.generalLedger).values([
        { companyId: co.id, code: "GL001", name: "Cash in Hand", accountSubGroupId: cash.id, normalBalance: "DEBIT", isCashOrBank: true, postsToCashBook: true },
        { companyId: co.id, code: "GL002", name: "Nabil Bank A/C", accountSubGroupId: bank.id, normalBalance: "DEBIT", isCashOrBank: true },
        { companyId: co.id, code: "GL003", name: "Stock in Hand", accountSubGroupId: stock.id, normalBalance: "DEBIT" },
        { companyId: co.id, code: "GL010", name: "Owner's Capital", accountSubGroupId: cap.id, normalBalance: "CREDIT" },
        { companyId: co.id, code: "GL020", name: "Sales", accountSubGroupId: sales.id, normalBalance: "CREDIT" },
        { companyId: co.id, code: "GL030", name: "Rent Expense", accountSubGroupId: adm.id, normalBalance: "DEBIT" },
        { companyId: co.id, code: "GL031", name: "Salary Expense", accountSubGroupId: adm.id, normalBalance: "DEBIT" },
      ]);
    }

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
      const [g1] = await db.select().from(S.accountGroup).where(and(eq(S.accountGroup.companyId, co.id), eq(S.accountGroup.code, "AG01")));
      const [g3] = await db.select().from(S.accountGroup).where(and(eq(S.accountGroup.companyId, co.id), eq(S.accountGroup.code, "AG03")));
      const sub = async (groupId: number, code: string, description: string) => {
        const [ex] = await db.select().from(S.accountSubGroup).where(and(eq(S.accountSubGroup.accountGroupId, groupId), eq(S.accountSubGroup.code, code)));
        return ex ?? (await db.insert(S.accountSubGroup).values({ accountGroupId: groupId, code, description }).returning())[0];
      };
      const debtors = await sub(g1.id, "SG04", "Sundry Debtors");
      const creditors = await sub(g3.id, "SG01", "Sundry Creditors");
      const [ktm] = await db.select().from(S.subArea).where(eq(S.subArea.shortName, "KTM"));
      const [agt] = await db.select().from(S.agent).where(and(eq(S.agent.companyId, co.id), eq(S.agent.code, "AGT1")));
      const demo: { code: string; name: string; type: "CUSTOMER" | "VENDOR" | "BOTH"; sub: { id: number }; city: string; pan: string; credit?: [string, number]; terms?: number }[] = [
        { code: "C001", name: "Ram Traders", type: "CUSTOMER", sub: debtors, city: "Kathmandu", pan: "600123456", credit: ["100000.00", 30] },
        { code: "V001", name: "Sita Suppliers", type: "VENDOR", sub: creditors, city: "Birgunj", pan: "600654321", terms: 45 },
        { code: "B001", name: "Himalayan Mart", type: "BOTH", sub: debtors, city: "Pokhara", pan: "600111222", credit: ["50000.00", 15], terms: 30 },
      ];
      for (const d of demo) {
        const [gl] = await db.insert(S.generalLedger).values({
          companyId: co.id, code: d.code, name: d.name, accountSubGroupId: d.sub.id, glType: d.type,
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

    if (!(await hasRows(S.taxRate, co.id)))
      await db.insert(S.taxRate).values([
        { companyId: co.id, code: "VAT13", name: "VAT 13%", ratePercent: "13.00" },
        { companyId: co.id, code: "VAT0", name: "VAT 0% (Exempt)", ratePercent: "0.00" },
      ]);

    if (!(await hasRows(S.stockCategory, co.id)))
      await db.insert(S.stockCategory).values([
        { companyId: co.id, code: "RAW", name: "Raw Material" },
        { companyId: co.id, code: "FIN", name: "Finished Goods" },
        { companyId: co.id, code: "TRD", name: "Trading Goods" },
      ]);

    if (!(await hasRows(S.location, co.id))) {
      const [godown] = await db.insert(S.location).values({ companyId: co.id, code: "GD1", name: "Main Godown" }).returning();
      await db.insert(S.location).values([
        { companyId: co.id, code: "GD1-A", name: "Rack A", parentId: godown.id },
        { companyId: co.id, code: "GD1-B", name: "Rack B", parentId: godown.id },
      ]);
    }
  }

  console.log("Seed done.");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
