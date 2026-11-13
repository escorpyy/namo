import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MASTERS } from "../shared/masters";
import { MAX_NARRATION } from "../shared/cashBankVoucher";
import { DB_READY, seededContext, startApi, uniq, type Res } from "./helpers";

// Narration Master: ready-made narration / remarks texts that the voucher and purchase screens offer on the Down arrow.
describe.skipIf(!DB_READY)("Narration Master (API)", () => {
  let call: (m: string, p: string, b?: unknown) => Promise<Res>;
  let close: () => Promise<void>;
  let companyId = 0;
  const url = "/api/masters/narrations";
  const made: number[] = [];

  const create = async (body: Record<string, unknown>) => {
    const r = await call("POST", `${url}?companyId=${companyId}`, { isActive: true, ...body });
    if (r.status === 201) made.push(r.body.id);
    return r;
  };
  const codeOf = () => `N${uniq()}`.slice(0, 8);

  beforeAll(async () => {
    ({ call, close } = await startApi());
    ({ companyId } = await seededContext(call));
  });
  afterAll(async () => {
    for (const id of made) await call("DELETE", `${url}/${id}?companyId=${companyId}`);
    await close();
  });

  it("is defined with a code and a narration text no longer than a voucher line takes", () => {
    const def = MASTERS["narrations"];
    expect(def).toBeDefined();
    expect(def.fields.find((f) => f.name === "code")?.upper).toBe(true);
    expect(def.fields.find((f) => f.name === "narration")?.max).toBe(MAX_NARRATION);
  });

  it("the seeded company already has narrations to pick from", async () => {
    const r = await call("GET", `${url}?companyId=${companyId}`);
    expect(r.status).toBe(200);
    expect(r.body.length).toBeGreaterThan(0);
    expect(r.body.every((x: any) => typeof x.narration === "string" && x.narration.length > 0)).toBe(true);
  });

  it("creates a narration, upper-casing the code and trimming the text", async () => {
    const c = codeOf();
    const r = await create({ code: c.toLowerCase(), narration: `  Being rent paid ${c}  ` });
    expect(r.status).toBe(201);
    expect(r.body.code).toBe(c);
    expect(r.body.narration).toBe(`Being rent paid ${c}`);
  });

  it("takes exactly 500 characters and refuses 501", async () => {
    const tag = uniq();
    const ok = await create({ code: codeOf(), narration: tag + "x".repeat(MAX_NARRATION - tag.length) });
    expect(ok.status).toBe(201);
    const over = await create({ code: codeOf(), narration: "y".repeat(MAX_NARRATION + 1) });
    expect(over.status).toBe(400);
    expect(over.body.field).toBe("narration");
  });

  it("keeps Nepali (Devanagari) text as typed", async () => {
    const text = `नगद बैंकमा जम्मा गरियो ${uniq()}`;
    const r = await create({ code: codeOf(), narration: text });
    expect(r.status).toBe(201);
    expect(r.body.narration).toBe(text);
  });

  it("requires a code and a narration, and names the field", async () => {
    const noCode = await create({ code: "", narration: "Something" });
    expect(noCode.status).toBe(400);
    expect(noCode.body.field).toBe("code");
    const noText = await create({ code: codeOf(), narration: "" });
    expect(noText.status).toBe(400);
    expect(noText.body.field).toBe("narration");
  });

  it("refuses a duplicate code or a duplicate text, ignoring letter case", async () => {
    const c = codeOf(), text = `Being fuel bought ${c}`;
    expect((await create({ code: c, narration: text })).status).toBe(201);
    const sameCode = await create({ code: c.toLowerCase(), narration: `Another ${c}` });
    expect(sameCode.status).toBe(409);
    const sameText = await create({ code: codeOf(), narration: text.toUpperCase() });
    expect(sameText.status).toBe(409);
    expect(sameText.body.field).toBe("narration");
  });

  it("updates a narration, including switching it off (inactive ones stay in the master)", async () => {
    const c = codeOf();
    const { body } = await create({ code: c, narration: `Before ${c}` });
    const r = await call("PUT", `${url}/${body.id}?companyId=${companyId}`, { code: c, narration: `After ${c}`, isActive: false });
    expect(r.status).toBe(200);
    const row = (await call("GET", `${url}?companyId=${companyId}`)).body.find((x: any) => x.id === body.id);
    expect(row.narration).toBe(`After ${c}`);
    expect(row.isActive).toBe(false);
  });

  it("another company cannot change or delete it", async () => {
    const c = codeOf();
    const { body } = await create({ code: c, narration: `Mine ${c}` });
    const other = companyId + 1_000_000;
    expect((await call("PUT", `${url}/${body.id}?companyId=${other}`, { code: c, narration: "Hijacked", isActive: true })).status).toBeGreaterThanOrEqual(400);
    expect((await call("DELETE", `${url}/${body.id}?companyId=${other}`)).status).toBeGreaterThanOrEqual(400);
    const row = (await call("GET", `${url}?companyId=${companyId}`)).body.find((x: any) => x.id === body.id);
    expect(row.narration).toBe(`Mine ${c}`);
  });

  it("deletes a narration", async () => {
    const c = codeOf();
    const { body } = await create({ code: c, narration: `Temporary ${c}` });
    expect((await call("DELETE", `${url}/${body.id}?companyId=${companyId}`)).status).toBe(200);
    made.splice(made.indexOf(body.id), 1);
    const list = (await call("GET", `${url}?companyId=${companyId}`)).body;
    expect(list.some((x: any) => x.id === body.id)).toBe(false);
  });
});
