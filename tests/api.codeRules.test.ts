import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { CODE_SPECS } from "../shared/codeRules";
import { DB_READY, seededContext, startApi, uniq, type Res } from "./helpers";

// Code numbering over HTTP: the rule list with its built-in defaults, saving a rule, and the code suggested for a new record.
describe.skipIf(!DB_READY)("Code numbering (API)", () => {
  let call: (m: string, p: string, b?: unknown) => Promise<Res>;
  let close: () => Promise<void>;
  let companyId = 0;
  let db: any, S: any;
  const tag = uniq();
  const touched = new Set<string>();

  beforeAll(async () => {
    ({ call, close } = await startApi());
    ({ companyId } = await seededContext(call));
    ({ db } = await import("../server/db"));
    S = await import("../server/db/schema");
  });
  afterAll(async () => {
    if (touched.size) await db.delete(S.codeRule).where(and(eq(S.codeRule.companyId, companyId), inArray(S.codeRule.masterKey, [...touched])));
    await close();
  });

  const rules = () => call("GET", `/api/code-rules?companyId=${companyId}`);
  const suggest = (key: string, body: Record<string, unknown>) => call("POST", `/api/code-rules/${key}/suggest`, { companyId, ...body });
  const save = (key: string, body: Record<string, unknown>) => { touched.add(key); return call("PUT", `/api/code-rules/${key}`, { companyId, ...body }); };

  it("lists every master with its rule, an example, and says which are still the built-in default", async () => {
    const r = await rules();
    expect(r.status).toBe(200);
    expect(r.body.map((x: any) => x.key)).toEqual(CODE_SPECS.map((s) => s.key));
    const party = r.body.find((x: any) => x.key === "party");
    expect(party).toMatchObject({ mode: "SUGGESTED", template: "{NAME2}{TYPE}{SEQ:3}", isDefault: true, usesType: true, usesName: true });
    expect(party.example).toMatch(/^[A-Z0-9]{2}[A-Z]001$/);
    expect(r.body.find((x: any) => x.key === "areas")).toMatchObject({ mode: "MANUAL" });
  });

  it("refuses a bad template, an unknown master and a bad mode", async () => {
    expect((await save("party", { mode: "SUGGESTED", template: "{PARENT}{SEQ:3}" })).status).toBe(400);
    expect((await save("party", { mode: "SUGGESTED", template: "{NAME2}" })).status).toBe(400);
    expect((await save("party", { mode: "AUTO", template: "{NAME2}{SEQ:3}" })).status).toBe(400);
    expect((await save("nope", { mode: "MANUAL", template: "{SEQ:3}" })).status).toBe(404);
    expect((await suggest("nope", {})).status).toBe(404);
    expect((await call("GET", "/api/code-rules")).status).toBe(400);
  });

  it("suggests parent code + 3 digits and moves on once a code is used; says what is missing", async () => {
    const group = `Z${tag}`.slice(0, 4);
    const g = await call("POST", `/api/masters/product-groups?companyId=${companyId}`, { code: group, name: `Group ${tag}`, isActive: true });
    expect(g.status, JSON.stringify(g.body)).toBe(201);

    expect(await suggest("product-sub-groups", {}).then((r) => r.body)).toMatchObject({ code: null, reason: expect.stringMatching(/Choose the Product Group/) });

    // product sub-groups default to {PARENT}{SEQ:2}; make it 3 digits like the products
    expect((await save("product-sub-groups", { mode: "SUGGESTED", template: "{PARENT}{SEQ:3}" })).status).toBe(200);
    const first = await suggest("product-sub-groups", { parentId: g.body.id });
    expect(first.body).toEqual({ mode: "SUGGESTED", code: `${group}001` });

    const made = await call("POST", `/api/masters/product-sub-groups?companyId=${companyId}`, { productGroupId: g.body.id, code: first.body.code, name: `Sub ${tag}`, isActive: true });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect((await suggest("product-sub-groups", { parentId: g.body.id })).body.code).toBe(`${group}002`);
    // a code typed by hand under the same prefix counts too
    await call("POST", `/api/masters/product-sub-groups?companyId=${companyId}`, { productGroupId: g.body.id, code: `${group}007`, name: `Sub7 ${tag}`, isActive: true });
    expect((await suggest("product-sub-groups", { parentId: g.body.id })).body.code).toBe(`${group}008`);
  });

  it("a name + type rule keeps a separate count for each prefix", async () => {
    const a = await suggest("party", { name: `${tag}Traders`, type: "VENDOR" });
    const b = await suggest("party", { name: `${tag}Traders`, type: "CUSTOMER" });
    expect(a.body.code).toMatch(new RegExp(`^${tag.slice(0, 2)}V\\d{3,}$`));
    expect(b.body.code).toMatch(new RegExp(`^${tag.slice(0, 2)}C\\d{3,}$`));
    expect((await suggest("party", { name: "", type: "VENDOR" })).body).toMatchObject({ code: null, reason: expect.stringMatching(/name/) });
    expect((await suggest("party", { name: "Ramesh" })).body).toMatchObject({ code: null, reason: expect.stringMatching(/type/) });
  });

  it("MANUAL gives no suggestion, and a saved rule replaces the default", async () => {
    expect((await suggest("areas", { name: "North" })).body).toEqual({ mode: "MANUAL", code: null });
    expect((await save("areas", { mode: "SUGGESTED", template: "a-{NAME2}{SEQ:2}" })).body).toMatchObject({ mode: "SUGGESTED", template: "A-{NAME2}{SEQ:2}", isDefault: false });
    expect((await suggest("areas", { name: `${tag}North` })).body.code).toBe(`A-${tag.slice(0, 2)}01`);
    expect((await save("areas", { mode: "MANUAL", template: "{NAME2}{SEQ:2}" })).body).toMatchObject({ mode: "MANUAL" });
    expect((await suggest("areas", { name: "North" })).body.code).toBeNull();
  });
});
