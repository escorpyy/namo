import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DB_READY, seededContext, startApi, uniq, type Res } from "./helpers";

// Party = one screen, four tables (GeneralLedger + Party + CustomerDetail + VendorDetail) saved in one transaction.
// Seed: company 1 has Sub Group 'Sundry Debtors' (ASSET -> DEBIT) and 'Sundry Creditors' (LIABILITY -> CREDIT); company 2 has no groups.
describe.skipIf(!DB_READY)("Party master (API)", () => {
  let call: (m: string, p: string, b?: unknown) => Promise<Res>;
  let close: () => Promise<void>;
  let companyId = 0;
  let otherCompanyId = 0;
  let debtorsSg = 0;
  let creditorsSg = 0;
  const created: number[] = []; // party ids, deleted in afterAll
  const tag = uniq();

  beforeAll(async () => {
    ({ call, close } = await startApi());
    ({ companyId } = await seededContext(call));
    const ctx = (await call("GET", "/api/context")).body;
    otherCompanyId = ctx.companies.find((c: any) => c.id !== companyId).id;
    const parties = (await call("GET", `/api/masters/party?companyId=${companyId}`)).body;
    debtorsSg = parties.find((p: any) => p.code === "C001").accountSubGroupId;
    creditorsSg = parties.find((p: any) => p.code === "V001").accountSubGroupId;
  });
  afterAll(async () => {
    for (const id of created.reverse()) await call("DELETE", `/api/masters/party/${id}`);
    await close();
  });

  const list = async () => (await call("GET", `/api/masters/party?companyId=${companyId}`)).body as any[];
  const glById = async (id: number) =>
    ((await call("GET", `/api/masters/general-ledger?companyId=${companyId}`)).body as any[]).find((g) => g.id === id);
  const base = (over: Record<string, unknown> = {}) => ({
    code: `P${tag}`, name: "Test Party", accountSubGroupId: debtorsSg, glType: "CUSTOMER", isActive: true, isVatRegistered: false, ...over,
  });
  const post = async (body: Record<string, unknown>, cid = companyId) => {
    const r = await call("POST", `/api/masters/party?companyId=${cid}`, body);
    if (r.status === 201) created.push(r.body.id);
    return r;
  };

  it("lists the seeded parties with their customer/vendor details", async () => {
    const rows = await list();
    const byCode = Object.fromEntries(rows.map((r) => [r.code, r]));
    expect(byCode.C001.glType).toBe("CUSTOMER");
    expect(byCode.V001.glType).toBe("VENDOR");
    expect(byCode.B001.glType).toBe("BOTH");
    expect(byCode.B001.creditDays).toBe(15);
    expect(byCode.B001.paymentTermDays).toBe(30);
    expect(Number(byCode.B001.creditLimit)).toBe(50000);
  });

  it("requires companyId on list and create", async () => {
    expect((await call("GET", "/api/masters/party")).status).toBe(400);
    expect((await call("POST", "/api/masters/party", base())).status).toBe(400);
  });

  it("creates a CUSTOMER: code upper-cased, customer detail saved, no vendor detail, normal balance DEBIT", async () => {
    const r = await post(base({ code: `p${tag}`.toLowerCase(), creditLimit: 5000.5, creditDays: 30, paymentTermDays: 99 }));
    expect(r.status).toBe(201);
    expect(r.body.code).toBe(`P${tag}`);
    expect(Number(r.body.creditLimit)).toBe(5000.5);
    expect(r.body.creditDays).toBe(30);
    expect(r.body.paymentTermDays).toBeNull(); // sent, but a CUSTOMER has no vendor detail
    expect((await glById(r.body.generalLedgerId)).normalBalance).toBe("DEBIT");
  });

  it("creates a VENDOR: vendor detail only, normal balance CREDIT", async () => {
    const r = await post(base({ code: `V${tag}`, glType: "VENDOR", accountSubGroupId: creditorsSg, paymentTermDays: 45, creditLimit: 777 }));
    expect(r.status).toBe(201);
    expect(r.body.paymentTermDays).toBe(45);
    expect(r.body.creditLimit).toBeNull();
    expect((await glById(r.body.generalLedgerId)).normalBalance).toBe("CREDIT");
  });

  it("creates a BOTH party with both detail rows", async () => {
    const r = await post(base({ code: `B${tag}`, glType: "BOTH", creditLimit: 100, creditDays: 7, paymentTermDays: 14 }));
    expect(r.status).toBe(201);
    expect(Number(r.body.creditLimit)).toBe(100);
    expect(r.body.creditDays).toBe(7);
    expect(r.body.paymentTermDays).toBe(14);
  });

  it("rejects a duplicate code (case-insensitive) with 409", async () => {
    const r = await post(base({ code: `p${tag}`.toLowerCase(), name: "Dup" }));
    expect(r.status).toBe(409);
    expect(r.body.field).toBe("code");
  });

  it("rejects a code that already belongs to a non-party ledger (codes are unique across ALL ledgers) with 409", async () => {
    const r = await post(base({ code: "GL001" }));
    expect(r.status).toBe(409);
  });

  it("rejects a duplicate PAN (case-insensitive) in the same company, and a failed create leaves no orphan ledger", async () => {
    const ok = await post(base({ code: `N${tag}`, panNo: `pan${tag}` }));
    expect(ok.status).toBe(201);
    const dup = await post(base({ code: `M${tag}`, panNo: `PAN${tag}` }));
    expect(dup.status).toBe(409);
    expect(dup.body.field).toBe("panNo");
    const gls = (await call("GET", `/api/masters/general-ledger?companyId=${companyId}`)).body as any[];
    expect(gls.some((g) => g.code === `M${tag}`)).toBe(false);
  });

  it("validates input: missing name, bad email, negative credit limit, unknown party type", async () => {
    expect((await post(base({ code: `X1${tag}`, name: "" }))).status).toBe(400);
    expect((await post(base({ code: `X2${tag}`, email: "not-an-email" }))).status).toBe(400);
    expect((await post(base({ code: `X3${tag}`, creditLimit: -1 }))).status).toBe(400);
    expect((await post(base({ code: `X4${tag}`, glType: "NOBODY" }))).status).toBe(400);
  });

  it("rejects links that do not exist or belong to another company (400, with the field named)", async () => {
    const other = await post(base({ code: `O${tag}` }), otherCompanyId); // company 1's Sub Group used in company 2
    expect(other.status).toBe(400);
    expect(other.body.field).toBe("accountSubGroupId");
    expect((await post(base({ code: `O2${tag}`, accountSubGroupId: 999999 }))).status).toBe(400);
    const sa = await post(base({ code: `O3${tag}`, subAreaId: 999999 }));
    expect(sa.status).toBe(400);
    expect(sa.body.field).toBe("subAreaId");
    const ag = await post(base({ code: `O4${tag}`, agentId: 999999 }));
    expect(ag.status).toBe(400);
    expect(ag.body.field).toBe("agentId");
  });

  it("updates name and contact details", async () => {
    const id = (await list()).find((p) => p.code === `P${tag}`).id;
    const r = await call("PUT", `/api/masters/party/${id}`, base({ name: "Renamed", phone: "01-555", creditLimit: 9000, creditDays: 10 }));
    expect(r.status).toBe(200);
    expect(r.body.name).toBe("Renamed");
    expect(r.body.phone).toBe("01-555");
    expect(Number(r.body.creditLimit)).toBe(9000);
  });

  it("PUT: unknown id is 404; keeping its own code/PAN is fine; taking another party's code or PAN is 409", async () => {
    expect((await call("PUT", "/api/masters/party/999999", base())).status).toBe(404);
    const rows = await list();
    const n = rows.find((p) => p.code === `N${tag}`);
    expect((await call("PUT", `/api/masters/party/${n.id}`, base({ code: `N${tag}`, panNo: `PAN${tag}`, name: "Same keys" }))).status).toBe(200);
    expect((await call("PUT", `/api/masters/party/${n.id}`, base({ code: `P${tag}`, panNo: `PAN${tag}` }))).status).toBe(409);
    expect((await call("PUT", `/api/masters/party/${n.id}`, base({ code: `N${tag}`, panNo: "600123456" }))).status).toBe(409); // seeded C001's PAN
  });

  it("changing the type keeps the old detail row (no data loss); changing the Sub Group re-derives the normal balance", async () => {
    const id = (await list()).find((p) => p.code === `P${tag}`).id;
    const toVendor = await call("PUT", `/api/masters/party/${id}`, base({ glType: "VENDOR", accountSubGroupId: creditorsSg, paymentTermDays: 21 }));
    expect(toVendor.status).toBe(200);
    expect(toVendor.body.paymentTermDays).toBe(21);
    expect(Number(toVendor.body.creditLimit)).toBe(9000); // customer detail from the previous test survives
    expect((await glById(toVendor.body.generalLedgerId)).normalBalance).toBe("CREDIT");
    const back = await call("PUT", `/api/masters/party/${id}`, base({ glType: "CUSTOMER" }));
    expect(back.status).toBe(200);
    expect((await glById(back.body.generalLedgerId)).normalBalance).toBe("DEBIT");
  });

  it("delete: unknown id is 404; blocked while a child ledger exists; then removes the party AND its ledger", async () => {
    expect((await call("DELETE", "/api/masters/party/999999")).status).toBe(404);
    const p = await post(base({ code: `D${tag}` }));
    expect(p.status).toBe(201);
    const child = await call("POST", `/api/masters/general-ledger?companyId=${companyId}`, {
      code: `DC${tag}`, name: "Child", accountSubGroupId: debtorsSg, normalBalance: "DEBIT", glType: "OTHER", parentId: p.body.generalLedgerId, isActive: true,
      isCashOrBank: false, postsToCashBook: false, requiresSubLedger: false, allowDocAdjust: false,
    });
    expect(child.status).toBe(201);
    const blocked = await call("DELETE", `/api/masters/party/${p.body.id}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toMatch(/Child Ledger/);
    expect((await call("DELETE", `/api/masters/general-ledger/${child.body.id}`)).status).toBe(200);
    expect((await call("DELETE", `/api/masters/party/${p.body.id}`)).status).toBe(200);
    expect((await list()).some((x) => x.id === p.body.id)).toBe(false);
    expect(await glById(p.body.generalLedgerId)).toBeUndefined();
    created.splice(created.indexOf(p.body.id), 1);
  });
});
