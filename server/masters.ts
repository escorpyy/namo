import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { MASTERS } from "../shared/masters";
import { db } from "./db";
import * as S from "./db/schema";
import { masterRouter, type ServerCfg } from "./routes/masterFactory";
import { HttpError } from "./routes/_util";
import { assertAgent, assertSubArea, assertSubGroup } from "./routes/links";
import { partyRouter } from "./routes/party";
import { productRouter } from "./routes/product";

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
      // Sub Ledger band karne se pehle unhe hatana padega (warna opening balance ka breakdown orphan ho jaata)
      if (ctx.id != null && !data.requiresSubLedger) {
        const [n] = await db.select({ n: sql<number>`count(*)::int` }).from(S.subLedger).where(eq(S.subLedger.generalLedgerId, ctx.id));
        if (n.n > 0) throw new HttpError(409, `This ledger has ${n.n} Sub Ledger(s). Remove them before turning off 'Requires Sub Ledger'.`, "requiresSubLedger");
      }
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
  // ---------------- Admin masters ----------------
  companies: {
    table: S.company,
    scope: "global",
    counts: {
      branchCount: { table: S.branch, column: "companyId" },
      fiscalYearCount: { table: S.fiscalYear, column: "companyId" },
      accountGroupCount: { table: S.accountGroup, column: "companyId" },
      ledgerCount: { table: S.generalLedger, column: "companyId" },
    },
    // ctx.id = is company ki id (create me undefined)
    validate: async (data, { id }) => {
      if (data.isVatRegistered && !data.vatNo) throw new HttpError(400, "VAT No is required for a VAT-registered company.", "vatNo");
      if (data.retainedEarningsGLId != null) {
        const [gl] = await db.select({ c: S.generalLedger.companyId }).from(S.generalLedger).where(eq(S.generalLedger.id, data.retainedEarningsGLId));
        if (!id || gl?.c !== id) throw new HttpError(400, "Retained Earnings GL must be a ledger of this company.", "retainedEarningsGLId");
      }
    },
  },
  branches: {
    table: S.branch,
    counts: {
      voucherCount: [{ table: S.journalVoucher, column: "branchId" }, { table: S.cashBankVoucher, column: "branchId" }],
      openingCount: [{ table: S.openingBalance, column: "branchId" }, { table: S.stockOpeningBalance, column: "branchId" }],
      // UserCompanyAccess.branchId ON DELETE CASCADE hai: branch delete par access rows chupchap udd jaate, isliye block
      accessCount: { table: S.userCompanyAccess, column: "branchId" },
    },
    // Ek company me sirf ek Head Office (DB me partial unique index hai; yahan saaf message)
    validate: async (data, { companyId, id }) => {
      if (!data.isHeadOffice) return;
      const [h] = await db.select({ name: S.branch.name }).from(S.branch)
        .where(and(eq(S.branch.companyId, companyId), eq(S.branch.isHeadOffice, true), id != null ? ne(S.branch.id, id) : undefined)).limit(1);
      if (h) throw new HttpError(409, `'${h.name}' is already the Head Office. Unmark it first.`, "isHeadOffice");
    },
  },
  "fiscal-years": {
    table: S.fiscalYear,
    orderBy: (t) => desc(t.startDate),
    counts: {
      openingCount: { table: S.openingBalance, column: "fiscalYearId" },
      stockOpeningCount: { table: S.stockOpeningBalance, column: "fiscalYearId" },
    },
    validate: async (data, { companyId, id }) => {
      if (id != null) {
        const [ex] = await db.select({ isClosed: S.fiscalYear.isClosed }).from(S.fiscalYear).where(eq(S.fiscalYear.id, id));
        if (ex?.isClosed) throw new HttpError(409, "This fiscal year is closed and cannot be edited.");
      }
      if (data.endDate <= data.startDate) throw new HttpError(400, "End Date must be after Start Date.", "endDate");
      const others = await db.select().from(S.fiscalYear).where(and(eq(S.fiscalYear.companyId, companyId), id != null ? ne(S.fiscalYear.id, id) : undefined));
      const iso = (d: Date) => d.toISOString().slice(0, 10);
      // Do fiscal years ki dates overlap nahi ho sakti (accuracy: ek tarikh ek hi saal me)
      const clash = others.find((o) => iso(o.startDate) <= data.endDate && iso(o.endDate) >= data.startDate);
      if (clash) throw new HttpError(409, `Dates overlap with fiscal year ${clash.code} (${iso(clash.startDate)} to ${iso(clash.endDate)}).`, "startDate");
      if (data.isCurrent) {
        const cur = others.find((o) => o.isCurrent);
        if (cur) throw new HttpError(409, `${cur.code} is already the current fiscal year. Unmark it first.`, "isCurrent");
      }
    },
    beforeDelete: async (row) => {
      if (row.isClosed) throw new HttpError(409, "A closed fiscal year cannot be deleted.");
    },
  },
  users: {
    table: S.user,
    scope: "global",
    orderBy: (t) => asc(t.name),
    counts: { accessCount: { table: S.userCompanyAccess, column: "userId" } },
  },
  "user-access": {
    table: S.userCompanyAccess,
    refs: {
      userName: { table: S.user, column: "name", via: "userId" },
      branchName: { table: S.branch, column: "name", via: "branchId" },
    },
    orderBy: (_t, x) => asc(x.userName),
    // DB ka unique index NULL branch ("all branches") ko distinct maanta hai, isliye duplicate yahan pakadte hain
    validate: async (data, { companyId, id }) => {
      const [u] = await db.select({ id: S.user.id }).from(S.user).where(eq(S.user.id, data.userId));
      if (!u) throw new HttpError(400, "User not found.", "userId");
      if (data.branchId != null) {
        const [b] = await db.select({ c: S.branch.companyId }).from(S.branch).where(eq(S.branch.id, data.branchId));
        if (b?.c !== companyId) throw new HttpError(400, "Branch not found in this company.", "branchId");
      }
      const rows = await db.select().from(S.userCompanyAccess)
        .where(and(eq(S.userCompanyAccess.userId, data.userId), eq(S.userCompanyAccess.companyId, companyId), id != null ? ne(S.userCompanyAccess.id, id) : undefined));
      const want = data.branchId ?? null;
      if (rows.some((x) => (x.branchId ?? null) === want))
        throw new HttpError(409, want == null ? "This user already has access to all branches of this company." : "This user already has access to this branch.", "branchId");
      if (want == null && rows.length) throw new HttpError(409, "This user already has branch-specific access. Remove those rows first.", "branchId");
      if (want != null && rows.some((x) => x.branchId == null)) throw new HttpError(409, "This user already has access to all branches of this company.", "branchId");
    },
  },
  "sub-ledger": {
    table: S.subLedger,
    parent: { column: "generalLedgerId", table: S.generalLedger },
    counts: { openingCount: { table: S.openingBalance, column: "subLedgerId" } },
    validate: async (data, { companyId }) => {
      const [g] = await db.select({ r: S.generalLedger.requiresSubLedger }).from(S.generalLedger).where(eq(S.generalLedger.id, data.generalLedgerId));
      if (!g?.r) throw new HttpError(400, "This ledger does not use Sub Ledgers. Turn on 'Requires Sub Ledger' on the ledger first.", "generalLedgerId");
      if (data.partyId != null) {
        const [p] = await db.select({ c: S.party.companyId }).from(S.party).where(eq(S.party.id, data.partyId));
        if (p?.c !== companyId) throw new HttpError(400, "Party not found in this company.", "partyId");
      }
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
  { key: "products", router: productRouter(MASTERS.products) },
];
