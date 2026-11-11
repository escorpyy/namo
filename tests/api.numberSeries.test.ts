import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { DB_READY, seededContext, startApi, uniq, type Res } from "./helpers";

// Number series over HTTP: create / edit / list, who may use a series, and the picker a document form reads.
describe.skipIf(!DB_READY)("Number series (API)", () => {
  let call: (m: string, p: string, b?: unknown) => Promise<Res>;
  let close: () => Promise<void>;
  let companyId = 0, branchId = 0, fiscalYear = "";
  let db: any, S: any;
  const tag = uniq();

  beforeAll(async () => {
    ({ call, close } = await startApi());
    ({ companyId, branchId } = await seededContext(call));
    ({ db } = await import("../server/db"));
    S = await import("../server/db/schema");
    const ctx = (await call("GET", "/api/context")).body.companies[0];
    fiscalYear = (ctx.fiscalYears.find((f: any) => f.isCurrent) ?? ctx.fiscalYears[0]).code;
  });
  afterAll(async () => {
    await db.delete(S.numberSeries).where(eq(S.numberSeries.companyId, companyId));
    await close();
  });

  const body = (over: Record<string, unknown> = {}) => ({ companyId, documentType: "PURCHASE_BILL", name: `Local ${tag}`, prefix: "LP-", padding: 2, mode: "AUTOMATIC", ...over });
  const available = () => call("GET", `/api/number-series/available?companyId=${companyId}&documentType=PURCHASE_BILL&branchId=${branchId}&fiscalYear=${encodeURIComponent(fiscalYear)}`);

  it("creates a series, lists it with an example and offers it on the form with the next number", async () => {
    const r = await call("POST", "/api/number-series", body({ isDefault: true }));
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ name: `Local ${tag}`, isDefault: true, allUsers: true, allBranches: true, used: 0 });
    expect(r.body.example[0]).toBe("LP-01");
    const l = await call("GET", `/api/number-series?companyId=${companyId}`);
    expect(l.body.some((x: any) => x.id === r.body.id)).toBe(true);
    const a = await available();
    expect(a.body[0]).toMatchObject({ id: r.body.id, next: "LP-01", isDefault: true });
    expect((await available()).body[0].next).toBe("LP-01"); // looking uses nothing up
  });

  it("keeps a second series for the same kind of document and moves the default", async () => {
    const first = (await call("GET", `/api/number-series?companyId=${companyId}`)).body.find((x: any) => x.name === `Local ${tag}`);
    const imp = await call("POST", "/api/number-series", body({ name: `Import ${tag}`, prefix: "IP-", isDefault: true }));
    expect(imp.status).toBe(201);
    const all = (await call("GET", `/api/number-series?companyId=${companyId}`)).body;
    expect(all.find((x: any) => x.id === first.id).isDefault).toBe(false);
    expect((await available()).body[0].name).toBe(`Import ${tag}`);
  });

  it("an edit changes the rule for future numbers; a name taken or a bad rule is refused", async () => {
    const s = (await call("GET", `/api/number-series?companyId=${companyId}`)).body.find((x: any) => x.name === `Local ${tag}`);
    const e = await call("PUT", `/api/number-series/${s.id}`, body({ prefix: "LB-", padding: 3, startNumber: 100 }));
    expect(e.status).toBe(200);
    expect(e.body.example[0]).toBe("LB-100");
    expect((await call("PUT", `/api/number-series/${s.id}`, body({ name: `Import ${tag}` }))).status).toBe(409);
    expect((await call("POST", "/api/number-series", body({ name: "x", prefix: "A B" }))).status).toBe(400);
    expect((await call("POST", "/api/number-series", body({ name: "y", mode: "WHATEVER" }))).status).toBe(400);
    expect((await call("PUT", `/api/number-series/${s.id}`, body({ documentType: "PURCHASE_ORDER" }))).status).toBe(409);
  });

  it("a series for chosen branches only is offered in those branches only", async () => {
    const r = await call("POST", "/api/number-series", body({ name: `Branch ${tag}`, allBranches: false, branchIds: [] }));
    expect(r.status).toBe(400);
    const ok = await call("POST", "/api/number-series", body({ name: `Branch ${tag}`, prefix: "BR-", allBranches: false, branchIds: [branchId] }));
    expect(ok.status).toBe(201);
    expect(ok.body.branchIds).toEqual([branchId]);
    expect((await available()).body.map((x: any) => x.name)).toContain(`Branch ${tag}`);
    const none = await call("GET", `/api/number-series/available?companyId=${companyId}&documentType=PURCHASE_BILL&branchId=999999&fiscalYear=x`);
    expect(none.body.map((x: any) => x.name)).not.toContain(`Branch ${tag}`);
  });

  it("a manual series offers no next number; an unknown kind of document is refused", async () => {
    await call("POST", "/api/number-series", body({ name: `Manual ${tag}`, mode: "MANUAL", prefix: "" }));
    expect((await available()).body.find((x: any) => x.name === `Manual ${tag}`)).toMatchObject({ mode: "MANUAL", next: null });
    expect((await call("GET", `/api/number-series/available?companyId=${companyId}&documentType=NOPE&branchId=${branchId}&fiscalYear=x`)).status).toBe(400);
  });
});
