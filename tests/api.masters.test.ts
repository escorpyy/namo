import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MASTERS } from "../shared/masters";
import { DB_READY, seededContext, startApi, uniq, type Res } from "./helpers";

describe.skipIf(!DB_READY)("Master engine (API)", () => {
  let call: (m: string, p: string, b?: unknown) => Promise<Res>;
  let close: () => Promise<void>;
  let companyId = 0;

  beforeAll(async () => {
    ({ call, close } = await startApi());
    ({ companyId } = await seededContext(call));
  });
  afterAll(async () => { await close(); });

  it("health endpoint reaches the database", async () => {
    const r = await call("GET", "/api/health");
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });

  it("every master in shared/masters.ts has a working server route", async () => {
    const bad: string[] = [];
    for (const key of Object.keys(MASTERS)) {
      const r = await call("GET", `/api/masters/${key}?companyId=${companyId}`);
      if (r.status !== 200 || !Array.isArray(r.body)) bad.push(`${key}: HTTP ${r.status}`);
    }
    expect(bad).toEqual([]);
  });

  describe("CRUD cycle on Stock Category", () => {
    const code = `T${uniq()}`.slice(0, 8);
    const url = `/api/masters/stock-categories`;
    let id = 0;

    it("create", async () => {
      const r = await call("POST", `${url}?companyId=${companyId}`, { code: code.toLowerCase(), name: `Cat ${code}`, isActive: true });
      expect(r.status).toBe(201);
      expect(r.body.code).toBe(code); // auto upper-case
      id = r.body.id;
    });
    it("duplicate code or name is rejected (409), case-insensitive", async () => {
      expect((await call("POST", `${url}?companyId=${companyId}`, { code: code.toLowerCase(), name: "Other", isActive: true })).status).toBe(409);
      expect((await call("POST", `${url}?companyId=${companyId}`, { code: `Z${uniq()}`.slice(0, 8), name: `cat ${code.toLowerCase()}`, isActive: true })).status).toBe(409);
    });
    it("validation errors name the field", async () => {
      const missing = await call("POST", `${url}?companyId=${companyId}`, { code: "", name: "x", isActive: true });
      expect(missing.status).toBe(400);
      expect(missing.body.field).toBe("code");
      const tooLong = await call("POST", `${url}?companyId=${companyId}`, { code: "ABCDEFGHIJK", name: "x", isActive: true });
      expect(tooLong.status).toBe(400);
    });
    it("update", async () => {
      const r = await call("PUT", `${url}/${id}`, { code, name: `Cat ${code} v2`, isActive: false });
      expect(r.status).toBe(200);
      const list = (await call("GET", `${url}?companyId=${companyId}`)).body;
      const row = list.find((x: any) => x.id === id);
      expect(row.name).toBe(`Cat ${code} v2`);
      expect(row.isActive).toBe(false);
    });
    it("delete, then it is gone", async () => {
      expect((await call("DELETE", `${url}/${id}`)).status).toBe(200);
      const list = (await call("GET", `${url}?companyId=${companyId}`)).body;
      expect(list.some((x: any) => x.id === id)).toBe(false);
      expect((await call("DELETE", `${url}/${id}`)).status).toBe(404);
    });
  });

  it("an Account Group that has Sub Groups cannot be deleted", async () => {
    const groups = (await call("GET", `/api/masters/account-groups?companyId=${companyId}`)).body;
    const withKids = groups.find((g: any) => g.subGroupCount > 0);
    expect(withKids, "seed should contain a group with sub groups").toBeDefined();
    const r = await call("DELETE", `/api/masters/account-groups/${withKids.id}`);
    expect(r.status).toBe(409);
    expect((await call("GET", `/api/masters/account-groups?companyId=${companyId}`)).body.some((g: any) => g.id === withKids.id)).toBe(true);
  });
});
