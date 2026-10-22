import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DB_READY, seededContext, startApi, uniq, type Res } from "./helpers";

// Company, Branch and Fiscal Year masters.
// Company is global (no companyId): unique code, VAT No required when VAT-registered, Retained Earnings GL must be a ledger of the company itself
// (and can only be set when editing), cannot be deleted while it has branches, fiscal years or ledger data.
// Branch: unique code and name per company, ONE Head Office per company, cannot be deleted while it has openings, vouchers or user access.
// Fiscal Year: End after Start, no overlapping dates within a company, ONE current year, a closed year is frozen (no edit, no delete),
// Closed / Opening-Balance-Locked cannot be set through the form, cannot be deleted while it has opening data.
// Everything below is built in a throw-away INACTIVE company (so it never shows up in the header switcher) and removed again; the seeded companies are only read.
describe.skipIf(!DB_READY)("Company, Branch and Fiscal Year masters (API)", () => {
  let call: (m: string, p: string, b?: unknown) => Promise<Res>;
  let close: () => Promise<void>;
  let companyId = 0, otherCompanyId = 0, seededFy = 0, seededHo = 0;
  let tc = 0; // the throw-away company
  let reGl = 0, reSg = 0; // the throw-away company's Retained Earnings ledger and its sub group
  let tcGroup = 0; // account group of the throw-away company, left in place until the company-delete test has seen it block
  let setClosed: (id: number, v: boolean) => Promise<void>;
  const tag = uniq();

  const companies = async () => (await call("GET", "/api/masters/companies")).body as any[];
  const tcRow = async () => (await companies()).find((c) => c.id === tc);
  const rows = async (key: string, cid: number) => (await call("GET", `/api/masters/${key}?companyId=${cid}`)).body as any[];
  const coBody = (over: Record<string, unknown> = {}) => ({
    code: `TC${tag}`, name: `ZZ Test Co ${tag}`, businessType: "OTHER", isVatRegistered: false, isActive: false, baseCurrency: "NPR", defaultCalendarPref: "BS", ...over,
  });
  const brBody = (over: Record<string, unknown> = {}) => ({ code: `B${tag}`, name: `Branch ${tag}`, isHeadOffice: false, isActive: true, ...over });
  const fyBody = (over: Record<string, unknown> = {}) => ({ code: `FY${tag}`, startDate: "2090-04-14", endDate: "2091-04-13", isCurrent: false, isActive: true, ...over });
  const postBranch = (body: Record<string, unknown>, cid = tc) => call("POST", `/api/masters/branches?companyId=${cid}`, body);
  const postFy = (body: Record<string, unknown>, cid = tc) => call("POST", `/api/masters/fiscal-years?companyId=${cid}`, body);
  const del = (key: string, id: number) => call("DELETE", `/api/masters/${key}/${id}`);

  beforeAll(async () => {
    ({ call, close } = await startApi());
    ({ companyId } = await seededContext(call));
    const ctx = (await call("GET", "/api/context")).body;
    otherCompanyId = ctx.companies.find((c: any) => c.id !== companyId).id;
    const co = ctx.companies.find((c: any) => c.id === companyId);
    seededHo = co.branches.find((b: any) => b.isHeadOffice).id;
    seededFy = co.fiscalYears[0].id;

    const { db } = await import("../server/db");
    const { fiscalYear } = await import("../server/db/schema");
    const { eq } = await import("drizzle-orm");
    setClosed = async (id, v) => { await db.update(fiscalYear).set({ isClosed: v }).where(eq(fiscalYear.id, id)); };

    const c = await call("POST", "/api/masters/companies", coBody());
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    tc = c.body.id;
  });
  afterAll(async () => {
    if (tc) {
      if (tcGroup) await del("account-groups", tcGroup);
      for (const f of await rows("fiscal-years", tc)) { await setClosed(f.id, false); await del("fiscal-years", f.id); }
      for (const b of await rows("branches", tc)) await del("branches", b.id);
      await del("companies", tc);
    }
    await close();
  });

  // ------------------------------------------------------------------------------------------------ Company
  describe("Company", () => {
    it("lists all companies without a companyId, sorted by code, with child counts", async () => {
      const list = await companies();
      const codes = list.map((c) => c.code);
      expect(codes).toEqual([...codes].sort());
      const abc = list.find((c) => c.code === "ABC");
      expect([abc.branchCount, abc.fiscalYearCount]).toEqual([2, 1]);
      const xyz = list.find((c) => c.code === "XYZ");
      expect([xyz.branchCount, xyz.fiscalYearCount]).toEqual([1, 1]);
    });

    it("the company created in setup: code and currency upper-cased, blanks become null, flags and counts saved", async () => {
      const row = await tcRow();
      expect(row.code).toBe(`TC${tag}`);
      expect([row.isActive, row.isVatRegistered, row.baseCurrency, row.defaultCalendarPref, row.businessType]).toEqual([false, false, "NPR", "BS", "OTHER"]);
      expect([row.legalName, row.vatNo, row.email]).toEqual([null, null, null]);
      expect([row.branchCount, row.fiscalYearCount, row.accountGroupCount, row.ledgerCount]).toEqual([0, 0, 0, 0]);
      const lower = await call("POST", "/api/masters/companies", coBody({ code: `lc${tag}`.toLowerCase(), name: `ZZ Lower ${tag}`, baseCurrency: "usd", legalName: "  Legal Name  ", email: "" }));
      expect(lower.status).toBe(201);
      expect([lower.body.code, lower.body.baseCurrency, lower.body.legalName, lower.body.email]).toEqual([`LC${tag}`, "USD", "Legal Name", null]);
      expect((await del("companies", lower.body.id)).status).toBe(200);
    });

    it("validates input: name, e-mail, currency length, business type, code length", async () => {
      const bad: [string, Record<string, unknown>][] = [
        ["name", { code: `V1${tag}`, name: "" }],
        ["email", { code: `V2${tag}`, email: "nope" }],
        ["baseCurrency", { code: `V3${tag}`, baseCurrency: "NPRS" }],
        ["baseCurrency", { code: `V4${tag}`, baseCurrency: "" }],
        ["businessType", { code: `V5${tag}`, businessType: "CHARITY" }],
        ["code", { code: "X".repeat(16) }],
        ["defaultCalendarPref", { code: `V6${tag}`, defaultCalendarPref: "XX" }],
      ];
      for (const [field, over] of bad) {
        const r = await call("POST", "/api/masters/companies", coBody(over));
        expect(r.status, JSON.stringify(over)).toBe(400);
        expect(r.body.field).toBe(field);
      }
    });

    it("a VAT-registered company needs a VAT No", async () => {
      const r = await call("POST", "/api/masters/companies", coBody({ code: `VT${tag}`, name: `ZZ Vat ${tag}`, isVatRegistered: true }));
      expect(r.status).toBe(400);
      expect(r.body.field).toBe("vatNo");
      const ok = await call("POST", "/api/masters/companies", coBody({ code: `VT${tag}`, name: `ZZ Vat ${tag}`, isVatRegistered: true, vatNo: "600999888" }));
      expect(ok.status).toBe(201);
      expect(ok.body.vatNo).toBe("600999888");
      expect((await call("PUT", `/api/masters/companies/${ok.body.id}`, coBody({ code: `VT${tag}`, name: `ZZ Vat ${tag}`, isVatRegistered: true, vatNo: null }))).status).toBe(400); // also on update
      expect((await del("companies", ok.body.id)).status).toBe(200);
    });

    it("the code is unique across the system, case-insensitively", async () => {
      const dup = await call("POST", "/api/masters/companies", coBody({ code: `tc${tag}`.toLowerCase(), name: `ZZ Dup ${tag}` }));
      expect(dup.status).toBe(409);
      expect(dup.body.field).toBe("code");
      expect((await call("POST", "/api/masters/companies", coBody({ code: "abc", name: `ZZ Dup2 ${tag}` }))).status).toBe(409); // seeded ABC
    });

    it("update: unknown id is 404; keeping its own code is fine; taking another company's code is 409", async () => {
      expect((await call("PUT", "/api/masters/companies/999999", coBody())).status).toBe(404);
      const r = await call("PUT", `/api/masters/companies/${tc}`, coBody({ name: `ZZ Renamed ${tag}`, city: "Nepalgunj" }));
      expect(r.status).toBe(200);
      expect([r.body.name, r.body.city]).toEqual([`ZZ Renamed ${tag}`, "Nepalgunj"]);
      const clash = await call("PUT", `/api/masters/companies/${tc}`, coBody({ code: "XYZ" }));
      expect(clash.status).toBe(409);
      expect(clash.body.field).toBe("code");
      expect((await tcRow()).code).toBe(`TC${tag}`);
    });

    it("Retained Earnings GL: not on create, only a ledger of this company on edit", async () => {
      const seededGl = (await rows("general-ledger", companyId)).find((g) => g.code === "GL010").id;
      const onCreate = await call("POST", "/api/masters/companies", coBody({ code: `RE${tag}`, name: `ZZ Re ${tag}`, retainedEarningsGLId: seededGl }));
      expect(onCreate.status).toBe(400);
      expect(onCreate.body.field).toBe("retainedEarningsGLId");
      const foreign = await call("PUT", `/api/masters/companies/${tc}`, coBody({ retainedEarningsGLId: seededGl })); // company 1's ledger
      expect(foreign.status).toBe(400);
      expect(foreign.body.field).toBe("retainedEarningsGLId");
      expect((await call("PUT", `/api/masters/companies/${tc}`, coBody({ retainedEarningsGLId: 999999 }))).status).toBe(400);

      // the company's own ledger: group -> sub group -> ledger
      const g = await call("POST", `/api/masters/account-groups?companyId=${tc}`, { code: `EQ${tag}`, description: `Equity ${tag}`, type: "EQUITY", isActive: true });
      const sg = await call("POST", `/api/masters/account-sub-groups?companyId=${tc}`, { accountGroupId: g.body.id, code: `S1${tag}`, description: `Reserves ${tag}`, isActive: true });
      const gl = await call("POST", `/api/masters/general-ledger?companyId=${tc}`, {
        code: `RE${tag}`, name: "Retained earnings", accountSubGroupId: sg.body.id, normalBalance: "CREDIT", glType: "OTHER", isActive: true,
        isCashOrBank: false, postsToCashBook: false, requiresSubLedger: false, allowDocAdjust: false,
      });
      expect([g.status, sg.status, gl.status]).toEqual([201, 201, 201]);
      const ok = await call("PUT", `/api/masters/companies/${tc}`, coBody({ retainedEarningsGLId: gl.body.id }));
      expect(ok.status).toBe(200);
      expect(ok.body.retainedEarningsGLId).toBe(gl.body.id);
      expect([ok.body.accountGroupCount, ok.body.ledgerCount]).toEqual([1, 1]);

      reGl = gl.body.id;
      reSg = sg.body.id;
      tcGroup = g.body.id;
    });

    it("a ledger that is the company's Retained Earnings GL is not deleted (the database refuses it)", async () => {
      const inUse = await del("general-ledger", reGl);
      expect(inUse.status).not.toBe(200);
      expect((await rows("general-ledger", tc)).some((x) => x.id === reGl)).toBe(true);
      expect((await tcRow()).retainedEarningsGLId).toBe(reGl);
    });

    // KNOWN ISSUE (PROJECT_TRACKER ERP-018): drizzle-orm 0.44 wraps every database error in a DrizzleQueryError, so the Postgres code is on err.cause.code,
    // but app.ts reads err.code. The 23505 / 23503 / 23514 "safety net" therefore never matches: the client gets 500 plus the SQL text instead of a clear 409.
    // `it.fails` keeps CI green and starts FAILING once this is fixed: then change it to a plain `it`.
    it.fails("deleting that ledger answers a clear 409, not a 500 with the SQL text", async () => {
      const inUse = await del("general-ledger", reGl);
      expect(inUse.status).toBe(409);
      expect(String(inUse.body.message)).not.toMatch(/Failed query/);
    });

    it("once the company no longer points at it, the ledger and its sub group can be deleted", async () => {
      expect((await call("PUT", `/api/masters/companies/${tc}`, coBody({ retainedEarningsGLId: null }))).status).toBe(200);
      expect((await del("general-ledger", reGl)).status).toBe(200);
      expect((await del("account-sub-groups", reSg)).status).toBe(200);
    });
  });

  // ------------------------------------------------------------------------------------------------ Branch
  describe("Branch", () => {
    it("requires companyId, and lists each company's own branches", async () => {
      expect((await call("GET", "/api/masters/branches")).status).toBe(400);
      expect((await call("POST", "/api/masters/branches", brBody())).status).toBe(400);
      expect((await rows("branches", companyId)).map((b) => b.code).sort()).toEqual(["BR1", "HO"]);
      expect((await rows("branches", otherCompanyId)).map((b) => b.code)).toEqual(["HO"]);
      expect(await rows("branches", tc)).toEqual([]);
    });

    it("creates branches; code upper-cased; only ONE Head Office per company", async () => {
      const ho = await postBranch(brBody({ code: `ho${tag}`.toLowerCase(), name: `Main ${tag}`, isHeadOffice: true, phone: "01-4000000" }));
      expect(ho.status).toBe(201);
      expect([ho.body.code, ho.body.isHeadOffice, ho.body.phone]).toEqual([`HO${tag}`, true, "01-4000000"]);
      expect((await postBranch(brBody({ code: `B1${tag}`, name: `Second ${tag}` }))).status).toBe(201);
      const second = await postBranch(brBody({ code: `B2${tag}`, name: `Third ${tag}`, isHeadOffice: true }));
      expect(second.status).toBe(409);
      expect(second.body.field).toBe("isHeadOffice");
      expect(second.body.message).toMatch(new RegExp(`'Main ${tag}' is already the Head Office`));
    });

    it("the Head Office can be moved: it can keep its flag, a second branch cannot take it until it is unmarked", async () => {
      const [ho, b1] = [(await rows("branches", tc)).find((b) => b.isHeadOffice), (await rows("branches", tc)).find((b) => b.code === `B1${tag}`)];
      expect((await call("PUT", `/api/masters/branches/${ho.id}`, brBody({ code: ho.code, name: `Main ${tag}`, isHeadOffice: true, address: "Somewhere" }))).status).toBe(200);
      expect((await call("PUT", `/api/masters/branches/${b1.id}`, brBody({ code: b1.code, name: b1.name, isHeadOffice: true }))).status).toBe(409);
      expect((await call("PUT", `/api/masters/branches/${ho.id}`, brBody({ code: ho.code, name: ho.name, isHeadOffice: false }))).status).toBe(200);
      const moved = await call("PUT", `/api/masters/branches/${b1.id}`, brBody({ code: b1.code, name: b1.name, isHeadOffice: true }));
      expect(moved.status).toBe(200);
      expect(moved.body.isHeadOffice).toBe(true);
      expect((await rows("branches", tc)).filter((b) => b.isHeadOffice)).toHaveLength(1);
    });

    it("code and name are unique per company, case-insensitively; the same code is fine in another company", async () => {
      const dupCode = await postBranch(brBody({ code: `b1${tag}`.toLowerCase(), name: `Fresh ${tag}` }));
      expect(dupCode.status).toBe(409);
      expect(dupCode.body.field).toBe("code");
      const dupName = await postBranch(brBody({ code: `B9${tag}`, name: `SECOND ${tag}` }));
      expect(dupName.status).toBe(409);
      expect(dupName.body.field).toBe("name");
      const other = await postBranch(brBody({ code: `B1${tag}`, name: `Elsewhere ${tag}` }), otherCompanyId);
      expect(other.status).toBe(201);
      expect((await del("branches", other.body.id)).status).toBe(200);
    });

    it("validates input and returns 404 for an unknown id on update and delete", async () => {
      expect((await postBranch(brBody({ code: `V1${tag}`, name: "" }))).status).toBe(400);
      expect((await postBranch(brBody({ code: `V2${tag}`, email: "bad" }))).status).toBe(400);
      expect((await postBranch(brBody({ code: "X".repeat(16) }))).status).toBe(400);
      expect((await call("PUT", "/api/masters/branches/999999", brBody())).status).toBe(404);
      expect((await del("branches", 999999)).status).toBe(404);
    });

    it("cannot be deleted while it has opening data (seeded head office) or user access; then it can", async () => {
      const seeded = await del("branches", seededHo);
      expect(seeded.status).toBe(409);
      expect(seeded.body.message).toMatch(/Opening Balance/);
      const b = (await rows("branches", tc)).find((x) => x.code === `B1${tag}`);
      const sita = (await rows("user-access", companyId)).find((a) => a.userName === "Sita Karki").userId;
      const access = await call("POST", `/api/masters/user-access?companyId=${tc}`, { userId: sita, branchId: b.id, role: "VIEWER", isActive: true });
      expect(access.status).toBe(201);
      const blocked = await del("branches", b.id);
      expect(blocked.status).toBe(409);
      expect(blocked.body.message).toMatch(/User Access row/);
      expect((await del("user-access", access.body.id)).status).toBe(200);
      expect((await del("branches", b.id)).status).toBe(200);
      for (const rest of await rows("branches", tc)) expect((await del("branches", rest.id)).status).toBe(200);
      expect(await rows("branches", tc)).toEqual([]);
    });
  });

  // ------------------------------------------------------------------------------------------------ Fiscal Year
  describe("Fiscal Year", () => {
    const fys = (cid = tc) => rows("fiscal-years", cid);
    const byCode = async (code: string) => (await fys()).find((f) => f.code === code);
    const dateOf = (v: unknown) => String(v).slice(0, 10);

    it("requires companyId, and lists a company's years newest first", async () => {
      expect((await call("GET", "/api/masters/fiscal-years")).status).toBe(400);
      const seeded = await fys(companyId);
      expect(seeded.map((f) => f.code)).toEqual(["2082/083"]);
      expect([seeded[0].isCurrent, seeded[0].isClosed, seeded[0].isOpeningBalanceLocked]).toEqual([true, false, false]);
    });

    it("creates a year: code upper-cased, dates stored, Closed / Locked cannot be set from the form", async () => {
      const r = await postFy(fyBody({ code: `fy${tag}`.toLowerCase(), isClosed: true, isOpeningBalanceLocked: true }));
      expect(r.status).toBe(201);
      expect(r.body.code).toBe(`FY${tag}`);
      expect([dateOf(r.body.startDate), dateOf(r.body.endDate)]).toEqual(["2090-04-14", "2091-04-13"]);
      expect([r.body.isCurrent, r.body.isClosed, r.body.isOpeningBalanceLocked]).toEqual([false, false, false]);
      expect([r.body.openingCount, r.body.stockOpeningCount]).toEqual([0, 0]);
    });

    it("validates dates: End must be after Start, real calendar dates only, code required", async () => {
      const same = await postFy(fyBody({ code: `D1${tag}`, startDate: "2100-01-01", endDate: "2100-01-01" }));
      expect(same.status).toBe(400);
      expect(same.body.field).toBe("endDate");
      expect((await postFy(fyBody({ code: `D2${tag}`, startDate: "2100-06-01", endDate: "2100-01-01" }))).status).toBe(400);
      const feb30 = await postFy(fyBody({ code: `D3${tag}`, startDate: "2100-02-30", endDate: "2100-12-31" }));
      expect(feb30.status).toBe(400);
      expect(feb30.body.field).toBe("startDate");
      expect((await postFy(fyBody({ code: `D4${tag}`, startDate: "01/01/2100" }))).status).toBe(400);
      expect((await postFy(fyBody({ code: "" }))).status).toBe(400);
      expect((await postFy(fyBody({ code: "X".repeat(16) }))).status).toBe(400);
    });

    it("dates of two years in one company cannot overlap (boundary days included); the next day is fine; another company is independent", async () => {
      const overlap = await postFy(fyBody({ code: `O1${tag}`, startDate: "2090-12-01", endDate: "2091-12-31" }));
      expect(overlap.status).toBe(409);
      expect(overlap.body.field).toBe("startDate");
      expect(overlap.body.message).toMatch(new RegExp(`overlap with fiscal year FY${tag} \\(2090-04-14 to 2091-04-13\\)`));
      expect((await postFy(fyBody({ code: `O2${tag}`, startDate: "2091-04-13", endDate: "2092-04-12" }))).status).toBe(409); // starts on the last day of FY
      expect((await postFy(fyBody({ code: `O3${tag}`, startDate: "2089-04-14", endDate: "2090-04-14" }))).status).toBe(409); // ends on the first day
      expect((await postFy(fyBody({ code: `O4${tag}`, startDate: "2080-01-01", endDate: "2095-01-01" }))).status).toBe(409); // swallows it
      const next = await postFy(fyBody({ code: `N1${tag}`, startDate: "2091-04-14", endDate: "2092-04-13" }));
      expect(next.status).toBe(201);
      const prev = await postFy(fyBody({ code: `P1${tag}`, startDate: "2089-04-14", endDate: "2090-04-13" }));
      expect(prev.status).toBe(201);
      const otherCo = await postFy(fyBody({ code: `X1${tag}`, startDate: "2090-04-14", endDate: "2091-04-13" }), otherCompanyId);
      expect(otherCo.status).toBe(201);
      expect((await del("fiscal-years", otherCo.body.id)).status).toBe(200);
      expect((await fys()).map((f) => f.code)).toEqual([`N1${tag}`, `FY${tag}`, `P1${tag}`]); // newest first
    });

    it("the code is unique within a company, case-insensitively, but may repeat in another company", async () => {
      const dup = await postFy(fyBody({ code: `fy${tag}`.toLowerCase(), startDate: "2200-01-01", endDate: "2200-12-31" }));
      expect(dup.status).toBe(409);
      expect(dup.body.field).toBe("code");
      const same = await postFy(fyBody({ code: "2082/083", startDate: "2300-01-01", endDate: "2300-12-31" })); // same code as company 1's year, different company
      expect(same.status).toBe(201);
      expect((await del("fiscal-years", same.body.id)).status).toBe(200);
    });

    it("only one year per company can be current; the current year can keep its flag; the flag can be moved", async () => {
      const a = await byCode(`FY${tag}`), n = await byCode(`N1${tag}`);
      expect((await call("PUT", `/api/masters/fiscal-years/${a.id}`, fyBody({ isCurrent: true }))).status).toBe(200);
      const second = await call("PUT", `/api/masters/fiscal-years/${n.id}`, fyBody({ code: n.code, startDate: "2091-04-14", endDate: "2092-04-13", isCurrent: true }));
      expect(second.status).toBe(409);
      expect(second.body.field).toBe("isCurrent");
      expect(second.body.message).toMatch(new RegExp(`FY${tag} is already the current fiscal year`));
      const create = await postFy(fyBody({ code: `C1${tag}`, startDate: "2095-01-01", endDate: "2095-12-31", isCurrent: true }));
      expect(create.status).toBe(409);
      expect((await call("PUT", `/api/masters/fiscal-years/${a.id}`, fyBody({ isCurrent: false }))).status).toBe(200);
      expect((await call("PUT", `/api/masters/fiscal-years/${n.id}`, fyBody({ code: n.code, startDate: "2091-04-14", endDate: "2092-04-13", isCurrent: true }))).status).toBe(200);
      expect((await fys()).filter((f) => f.isCurrent).map((f) => f.code)).toEqual([`N1${tag}`]);
    });

    it("update: dates can change inside the free space, but not into another year; unknown id is 404", async () => {
      const a = await byCode(`FY${tag}`);
      const shrink = await call("PUT", `/api/masters/fiscal-years/${a.id}`, fyBody({ startDate: "2090-05-01", endDate: "2091-03-31" }));
      expect(shrink.status).toBe(200);
      expect([dateOf(shrink.body.startDate), dateOf(shrink.body.endDate)]).toEqual(["2090-05-01", "2091-03-31"]);
      const clash = await call("PUT", `/api/masters/fiscal-years/${a.id}`, fyBody({ startDate: "2090-05-01", endDate: "2091-06-30" })); // runs into N1
      expect(clash.status).toBe(409);
      expect(dateOf((await byCode(`FY${tag}`)).endDate)).toBe("2091-03-31");
      expect((await call("PUT", "/api/masters/fiscal-years/999999", fyBody())).status).toBe(404);
    });

    it("a closed year is frozen: no edit, no delete; reopening it (directly in the DB) makes it editable again", async () => {
      const a = await byCode(`P1${tag}`);
      await setClosed(a.id, true);
      try {
        const edit = await call("PUT", `/api/masters/fiscal-years/${a.id}`, fyBody({ code: a.code, startDate: "2089-04-14", endDate: "2090-04-13", isActive: false }));
        expect(edit.status).toBe(409);
        expect(edit.body.message).toMatch(/closed and cannot be edited/);
        const gone = await del("fiscal-years", a.id);
        expect(gone.status).toBe(409);
        expect(gone.body.message).toMatch(/closed/);
        expect((await byCode(`P1${tag}`)).isActive).toBe(true);
      } finally {
        await setClosed(a.id, false);
      }
      expect((await call("PUT", `/api/masters/fiscal-years/${a.id}`, fyBody({ code: a.code, startDate: "2089-04-14", endDate: "2090-04-13", isActive: false }))).status).toBe(200);
    });

    it("cannot be deleted while it has opening data (seeded year); unknown id is 404; the rest can be deleted", async () => {
      const seeded = await del("fiscal-years", seededFy);
      expect(seeded.status).toBe(409);
      expect(seeded.body.message).toMatch(/Opening Balance/);
      expect((await del("fiscal-years", 999999)).status).toBe(404);
      for (const f of await fys()) expect((await del("fiscal-years", f.id)).status).toBe(200);
      expect(await fys()).toEqual([]);
    });
  });

  // ------------------------------------------------------------------------------------------------ Company delete
  describe("Company delete", () => {
    it("is blocked while the company has branches, fiscal years or account data, and works once it is empty", async () => {
      expect((await del("companies", 999999)).status).toBe(404);
      const b = await postBranch(brBody({ code: `DB${tag}`, name: `Del branch ${tag}` }));
      const blockedBranch = await del("companies", tc);
      expect(blockedBranch.status).toBe(409);
      expect(blockedBranch.body.message).toMatch(/Branch\(es\)/);
      expect((await del("branches", b.body.id)).status).toBe(200);

      const f = await postFy(fyBody({ code: `DF${tag}` }));
      const blockedFy = await del("companies", tc);
      expect(blockedFy.status).toBe(409);
      expect(blockedFy.body.message).toMatch(/Fiscal Year\(s\)/);
      expect((await del("fiscal-years", f.body.id)).status).toBe(200);

      const blockedGroup = await del("companies", tc);
      expect(blockedGroup.status).toBe(409);
      expect(blockedGroup.body.message).toMatch(/Account Group\(s\)/);
      expect((await del("account-groups", tcGroup)).status).toBe(200);
      tcGroup = 0;

      expect((await del("companies", tc)).status).toBe(200);
      expect((await companies()).some((c) => c.id === tc)).toBe(false);
      tc = 0; // afterAll has nothing left to remove
    });
  });
});
