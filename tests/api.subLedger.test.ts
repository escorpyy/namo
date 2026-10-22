import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DB_READY, seededContext, startApi, uniq, type Res } from "./helpers";

// Sub Ledger = a breakdown under a General Ledger that has "Requires Sub Ledger" turned on (e.g. one bank ledger -> several bank accounts).
// Rules: the ledger must require sub ledgers; the code is unique across the WHOLE system (case-insensitive), not just per company;
// the optional Party must belong to the same company; a sub ledger that has opening balances cannot be deleted;
// the ledger cannot stop requiring sub ledgers (or be deleted) while it still has some.
// Seed (company 1): ledger GL002 "Nabil Bank A/C" requires sub ledgers and has NB-CUR and NB-SAV, both used in the opening balance.
// Company 2 has no master data, so the cross-company tests build a tiny account group / sub group / ledger there and remove it again.
describe.skipIf(!DB_READY)("Sub Ledger master (API)", () => {
  let call: (m: string, p: string, b?: unknown) => Promise<Res>;
  let close: () => Promise<void>;
  let companyId = 0, otherCompanyId = 0;
  let bankSg = 0, glReq = 0, glPlain = 0, otherGl = 0, otherSg = 0, otherGroup = 0, partyId = 0, seededGl = 0;
  const createdSub: number[] = [];
  const createdGl: number[] = [];
  const tag = uniq();

  const rows = async (key: string, cid = companyId) => (await call("GET", `/api/masters/${key}?companyId=${cid}`)).body as any[];
  const subs = (cid = companyId) => rows("sub-ledger", cid);
  const post = async (body: Record<string, unknown>, cid = companyId) => {
    const r = await call("POST", `/api/masters/sub-ledger?companyId=${cid}`, body);
    if (r.status === 201) createdSub.push(r.body.id);
    return r;
  };
  const put = (sid: number, body: Record<string, unknown>) => call("PUT", `/api/masters/sub-ledger/${sid}`, body);
  const base = (over: Record<string, unknown> = {}) => ({ generalLedgerId: glReq, code: `SL${tag}`, name: "Test sub ledger", partyId: null, isActive: true, ...over });
  const glBody = (over: Record<string, unknown> = {}) => ({
    code: `GL${tag}`, name: "Test ledger", accountSubGroupId: bankSg, normalBalance: "DEBIT", glType: "OTHER", isActive: true,
    isCashOrBank: false, postsToCashBook: false, requiresSubLedger: true, allowDocAdjust: false, ...over,
  });
  const makeGl = async (over: Record<string, unknown>) => {
    const r = await call("POST", `/api/masters/general-ledger?companyId=${companyId}`, glBody(over));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    createdGl.push(r.body.id);
    return r.body.id as number;
  };

  beforeAll(async () => {
    ({ call, close } = await startApi());
    ({ companyId } = await seededContext(call));
    const ctx = (await call("GET", "/api/context")).body;
    otherCompanyId = ctx.companies.find((c: any) => c.id !== companyId).id;

    bankSg = (await rows("account-sub-groups")).find((s) => s.description === "Bank Accounts").id;
    partyId = (await rows("party")).find((p) => p.code === "C001").id;
    seededGl = (await rows("general-ledger")).find((g) => g.code === "GL002").id;
    glReq = await makeGl({ code: `GR${tag}`, name: "Test ledger with sub ledgers", requiresSubLedger: true });
    glPlain = await makeGl({ code: `GP${tag}`, name: "Test ledger without sub ledgers", requiresSubLedger: false });

    // Company 2: group -> sub group -> ledger that requires sub ledgers
    const g = await call("POST", `/api/masters/account-groups?companyId=${otherCompanyId}`, { code: `AG${tag}`, description: `Other group ${tag}`, type: "ASSET", isActive: true });
    expect(g.status).toBe(201);
    otherGroup = g.body.id;
    const sg = await call("POST", `/api/masters/account-sub-groups?companyId=${otherCompanyId}`, { accountGroupId: otherGroup, code: `SG${tag}`, description: `Other sub ${tag}`, isActive: true });
    expect(sg.status).toBe(201);
    otherSg = sg.body.id;
    const gl = await call("POST", `/api/masters/general-ledger?companyId=${otherCompanyId}`, glBody({ code: `OG${tag}`, name: "Other company ledger", accountSubGroupId: otherSg }));
    expect(gl.status, JSON.stringify(gl.body)).toBe(201);
    otherGl = gl.body.id;
  });
  afterAll(async () => {
    for (const sid of createdSub.reverse()) await call("DELETE", `/api/masters/sub-ledger/${sid}`);
    await call("DELETE", `/api/masters/general-ledger/${otherGl}`);
    for (const gid of createdGl.reverse()) await call("DELETE", `/api/masters/general-ledger/${gid}`);
    await call("DELETE", `/api/masters/account-sub-groups/${otherSg}`);
    await call("DELETE", `/api/masters/account-groups/${otherGroup}`);
    await close();
  });

  it("lists the seeded sub ledgers of the company, and only those (company 2 sees none of them)", async () => {
    const mine = await subs();
    const byCode = Object.fromEntries(mine.map((s) => [s.code, s]));
    expect(byCode["NB-CUR"].generalLedgerId).toBe(seededGl);
    expect(byCode["NB-SAV"].generalLedgerId).toBe(seededGl);
    expect(byCode["NB-CUR"].openingCount).toBe(1);
    expect((await subs(otherCompanyId)).map((s) => s.code)).not.toContain("NB-CUR");
  });

  it("requires companyId on list and create", async () => {
    expect((await call("GET", "/api/masters/sub-ledger")).status).toBe(400);
    expect((await call("POST", "/api/masters/sub-ledger", base())).status).toBe(400);
  });

  it("creates a sub ledger: code upper-cased, party optional and saved", async () => {
    const plain = await post(base({ code: `sl${tag}`.toLowerCase() }));
    expect(plain.status).toBe(201);
    expect(plain.body.code).toBe(`SL${tag}`);
    expect(plain.body.generalLedgerId).toBe(glReq);
    expect(plain.body.partyId).toBeNull();
    expect(plain.body.openingCount).toBe(0);
    const withParty = await post(base({ code: `SP${tag}`, partyId }));
    expect(withParty.status).toBe(201);
    expect(withParty.body.partyId).toBe(partyId);
  });

  it("validates input: missing name or ledger, over-long code, unknown ledger", async () => {
    expect((await post(base({ code: `V1${tag}`, name: "" }))).status).toBe(400);
    const noGl = await post(base({ code: `V2${tag}`, generalLedgerId: null }));
    expect(noGl.status).toBe(400);
    expect(noGl.body.field).toBe("generalLedgerId");
    expect((await post(base({ code: "X".repeat(21) }))).status).toBe(400);
    expect((await post(base({ code: `V3${tag}`, generalLedgerId: 999999 }))).status).toBe(400);
  });

  it("only a ledger that requires sub ledgers can have them", async () => {
    const r = await post(base({ code: `NR${tag}`, generalLedgerId: glPlain }));
    expect(r.status).toBe(400);
    expect(r.body.field).toBe("generalLedgerId");
    expect(r.body.message).toMatch(/Requires Sub Ledger/);
  });

  it("the ledger and the party must belong to the company", async () => {
    // company 1's ledger used in company 2
    const foreignGl = await post(base({ code: `F1${tag}` }), otherCompanyId);
    expect(foreignGl.status).toBe(400);
    expect(foreignGl.body.field).toBe("generalLedgerId");
    // company 1's party on company 2's ledger, and a party that does not exist
    const foreignParty = await post(base({ code: `F2${tag}`, generalLedgerId: otherGl, partyId }), otherCompanyId);
    expect(foreignParty.status).toBe(400);
    expect(foreignParty.body.field).toBe("partyId");
    const ghostParty = await post(base({ code: `F3${tag}`, partyId: 999999 }));
    expect(ghostParty.status).toBe(400);
    expect(ghostParty.body.field).toBe("partyId");
    // company 2's own ledger works there
    const ok = await post(base({ code: `F4${tag}`, generalLedgerId: otherGl }), otherCompanyId);
    expect(ok.status).toBe(201);
  });

  it("the code is unique across the whole system, case-insensitively (not only per company or per ledger)", async () => {
    const sameLedger = await post(base({ code: `sl${tag}`.toLowerCase(), name: "dup" }));
    expect(sameLedger.status).toBe(409);
    expect(sameLedger.body.field).toBe("code");
    expect(sameLedger.body.message).toMatch(/already exists in this system/);
    const otherLedger = await post(base({ code: `SL${tag}`, generalLedgerId: seededGl }));
    expect(otherLedger.status).toBe(409);
    const otherCompany = await post(base({ code: `SL${tag}`, generalLedgerId: otherGl }), otherCompanyId);
    expect(otherCompany.status).toBe(409);
    const seededCode = await post(base({ code: "nb-cur" }), companyId);
    expect(seededCode.status).toBe(409);
  });

  it("update: unknown id is 404; keeping its own code is fine; taking another code is 409; name and party can change", async () => {
    expect((await put(999999, base())).status).toBe(404);
    const id = (await subs()).find((s) => s.code === `SL${tag}`).id;
    const same = await put(id, base({ name: "Renamed", partyId }));
    expect(same.status).toBe(200);
    expect(same.body.name).toBe("Renamed");
    expect(same.body.partyId).toBe(partyId);
    const cleared = await put(id, base({ name: "Renamed", partyId: null }));
    expect(cleared.body.partyId).toBeNull();
    const clash = await put(id, base({ code: `SP${tag}` }));
    expect(clash.status).toBe(409);
    expect(clash.body.field).toBe("code");
  });

  it("update cannot move a sub ledger to a ledger that does not require them or to another company's ledger", async () => {
    const id = (await subs()).find((s) => s.code === `SL${tag}`).id;
    expect((await put(id, base({ generalLedgerId: glPlain }))).status).toBe(400);
    const foreign = await put(id, base({ generalLedgerId: otherGl }));
    expect(foreign.status).toBe(400);
    expect(foreign.body.field).toBe("generalLedgerId");
    const second = await makeGl({ code: `G2${tag}`, name: "Second ledger with sub ledgers" });
    const moved = await put(id, base({ generalLedgerId: second }));
    expect(moved.status).toBe(200);
    expect(moved.body.generalLedgerId).toBe(second);
    expect((await put(id, base())).status).toBe(200); // and back
  });

  it("the ledger cannot stop requiring sub ledgers, or be deleted, while it still has some", async () => {
    const gl = await makeGl({ code: `G3${tag}`, name: "Ledger to lock" });
    const sub = await post(base({ code: `LK${tag}`, generalLedgerId: gl }));
    expect(sub.status).toBe(201);
    const off = await call("PUT", `/api/masters/general-ledger/${gl}`, glBody({ code: `G3${tag}`, name: "Ledger to lock", requiresSubLedger: false }));
    expect(off.status).toBe(409);
    expect(off.body.field).toBe("requiresSubLedger");
    const del = await call("DELETE", `/api/masters/general-ledger/${gl}`);
    expect(del.status).toBe(409);
    expect(del.body.message).toMatch(/Sub Ledger/);
    expect((await call("DELETE", `/api/masters/sub-ledger/${sub.body.id}`)).status).toBe(200);
    createdSub.splice(createdSub.indexOf(sub.body.id), 1);
    const offNow = await call("PUT", `/api/masters/general-ledger/${gl}`, glBody({ code: `G3${tag}`, name: "Ledger to lock", requiresSubLedger: false }));
    expect(offNow.status).toBe(200);
  });

  it("delete: unknown id is 404; blocked while opening balances use it; otherwise removed", async () => {
    expect((await call("DELETE", "/api/masters/sub-ledger/999999")).status).toBe(404);
    const used = (await subs()).find((s) => s.code === "NB-CUR");
    const blocked = await call("DELETE", `/api/masters/sub-ledger/${used.id}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toMatch(/Opening Balance/);
    expect((await subs()).some((s) => s.code === "NB-CUR")).toBe(true);
    const fresh = await post(base({ code: `DL${tag}` }));
    expect((await call("DELETE", `/api/masters/sub-ledger/${fresh.body.id}`)).status).toBe(200);
    createdSub.splice(createdSub.indexOf(fresh.body.id), 1);
    expect((await subs()).some((s) => s.id === fresh.body.id)).toBe(false);
  });
});
