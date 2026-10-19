import { eq } from "drizzle-orm";
import { MASTERS } from "../shared/masters";
import { db } from "./db";
import * as S from "./db/schema";
import { masterRouter, type ServerCfg } from "./routes/masterFactory";
import { HttpError } from "./routes/_util";
import { assertAgent, assertSubArea, assertSubGroup } from "./routes/links";
import { partyRouter } from "./routes/party";

// Hierarchy (parent) check: same company, khud ya apne child ke andar nahi
async function checkHierarchy(table: any, parentId: number | null, ctx: { companyId: number; id?: number }, label: string) {
  let cur = parentId;
  for (let i = 0; i < 100 && cur != null; i++) {
    if (ctx.id != null && cur === ctx.id) throw new HttpError(400, `A ${label} cannot be inside itself or its own children.`, "parentId");
    const [p] = await db.select({ parentId: table.parentId, companyId: table.companyId }).from(table).where(eq(table.id, cur));
    if (!p || p.companyId !== ctx.companyId) throw new HttpError(400, `Parent ${label} not found in this company.`, "parentId");
    cur = p.parentId;
  }
}

// Har master ke liye: kaunsi table, parent kaun, aur "kitne child hain" ki counts
const CFG: Record<string, ServerCfg> = {
  "account-groups": { table: S.accountGroup, counts: { subGroupCount: { table: S.accountSubGroup, column: "accountGroupId" } } },
  "account-sub-groups": {
    table: S.accountSubGroup,
    parent: { column: "accountGroupId", table: S.accountGroup },
    counts: { ledgerCount: { table: S.generalLedger, column: "accountSubGroupId" } },
  },
  areas: { table: S.area, counts: { subAreaCount: { table: S.subArea, column: "areaId" } } },
  "sub-areas": { table: S.subArea, parent: { column: "areaId", table: S.area } },
  agents: { table: S.agent },
  "product-groups": { table: S.productGroup, counts: { subGroupCount: { table: S.productSubGroup, column: "productGroupId" } } },
  "product-sub-groups": {
    table: S.productSubGroup,
    parent: { column: "productGroupId", table: S.productGroup },
    counts: { productCount: { table: S.product, column: "productSubGroupId" } },
  },
  "product-units": { table: S.productUnit },
  "tax-rates": { table: S.taxRate },
  "stock-categories": { table: S.stockCategory },
  "general-ledger": {
    table: S.generalLedger,
    counts: {
      childCount: { table: S.generalLedger, column: "parentId" },
      subLedgerCount: { table: S.subLedger, column: "generalLedgerId" },
      voucherLineCount: [{ table: S.journalVoucherLine, column: "generalLedgerId" }, { table: S.cashBankVoucherLine, column: "generalLedgerId" }],
      openingCount: { table: S.openingBalance, column: "generalLedgerId" },
      // Party.generalLedgerId ON DELETE CASCADE hai: GL delete karne par party bhi chupchap delete ho jaati, isliye block
      partyCount: { table: S.party, column: "generalLedgerId" },
    },
    // GL.companyId denormalized hai (schema comment: trigger chahiye) — yahan API me hi enforce karte hain
    validate: async (data, ctx) => {
      await assertSubGroup(data.accountSubGroupId, ctx.companyId);
      await assertSubArea(data.subAreaId, ctx.companyId);
      await assertAgent(data.agentId, ctx.companyId);
      await checkHierarchy(S.generalLedger, data.parentId ?? null, ctx, "ledger");
      // Customer/Vendor ledger sirf Party screen se bante hain (Party row ke bina orphan GL na bane)
      const partyType = ["CUSTOMER", "VENDOR", "BOTH"].includes(data.glType);
      const [p] = ctx.id != null ? await db.select({ id: S.party.id }).from(S.party).where(eq(S.party.generalLedgerId, ctx.id)) : [];
      if (partyType && !p) throw new HttpError(400, "Customer / Vendor ledgers are created from the Party screen.", "glType");
      if (p && !partyType) throw new HttpError(400, "This ledger belongs to a Party, so GL Type cannot be OTHER.", "glType");
    },
    // Party ke GL me sub area / agent badle to Party row me bhi sync (dono jagah store hota hai)
    afterWrite: async (data, id) => {
      await db.update(S.party).set({ subAreaId: data.subAreaId ?? null, agentId: data.agentId ?? null }).where(eq(S.party.generalLedgerId, id));
    },
  },
  locations: {
    table: S.location,
    counts: { childCount: { table: S.location, column: "parentId" } },
    // Location hierarchy: khud ka parent ya cycle nahi banna chahiye
    validate: (data, ctx) => checkHierarchy(S.location, data.parentId ?? null, ctx, "location"),
  },
};

export const masterRouters = [
  ...Object.entries(CFG).map(([key, cfg]) => ({ key, router: masterRouter(MASTERS[key], cfg) })),
  { key: "party", router: partyRouter(MASTERS.party) },
];
