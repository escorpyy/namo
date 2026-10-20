import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DB_READY, seededContext, startApi, uniq, type Res } from "./helpers";

describe.skipIf(!DB_READY)("Purchase / Sales Term masters (API)", () => {
  let call: (m: string, p: string, b?: unknown) => Promise<Res>;
  let close: () => Promise<void>;
  let companyId = 0;
  const created: { key: string; id: number }[] = [];

  beforeAll(async () => {
    ({ call, close } = await startApi());
    ({ companyId } = await seededContext(call));
  });
  afterAll(async () => {
    for (const c of created.reverse()) await call("DELETE", `/api/masters/${c.key}/${c.id}`);
    await close();
  });

  const base = { category: "GENERAL", nature: "ADDITIVE", isProductwise: false, isMandatory: false, defaultCalcType: "PERCENT", defaultValue: 13, calcBase: "ITEM_VALUE", baseTermId: null, generalLedgerId: null, isActive: true };
  const purchase = { ...base, distributeToLines: false, allocationBasis: null };
  const post = async (key: string, body: Record<string, unknown>) => {
    const r = await call("POST", `/api/masters/${key}?companyId=${companyId}`, body);
    if (r.status === 201) created.push({ key, id: r.body.id });
    return r;
  };
  const tag = uniq();
  const P = "purchase-terms";

  it("seed provides both term masters", async () => {
    for (const k of [P, "sales-terms"]) {
      const r = await call("GET", `/api/masters/${k}?companyId=${companyId}`);
      expect(r.status).toBe(200);
      expect(r.body.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("creates a term and upper-cases the code", async () => {
    const r = await post(P, { ...purchase, code: `i${tag}`.toLowerCase(), name: "Insurance", sequence: 600 });
    expect(r.status).toBe(201);
    expect(r.body.code).toBe(`I${tag}`);
  });

  it("rejects a duplicate code (case-insensitive) with 409", async () => {
    const r = await post(P, { ...purchase, code: `I${tag}`, name: "Dup", sequence: 601 });
    expect(r.status).toBe(409);
  });

  it("SINGLE_TERM requires a base term, and a base term requires SINGLE_TERM", async () => {
    expect((await post(P, { ...purchase, code: `A${tag}`, name: "x", sequence: 610, calcBase: "SINGLE_TERM" })).status).toBe(400);
    const list = (await call("GET", `/api/masters/${P}?companyId=${companyId}`)).body;
    const baseId = list.find((t: any) => t.code === `I${tag}`).id;
    expect((await post(P, { ...purchase, code: `B${tag}`, name: "x", sequence: 611, baseTermId: baseId })).status).toBe(400);
  });

  it("base term must run earlier (lower sequence)", async () => {
    const list = (await call("GET", `/api/masters/${P}?companyId=${companyId}`)).body;
    const baseId = list.find((t: any) => t.code === `I${tag}`).id; // sequence 600
    const bad = await post(P, { ...purchase, code: `C${tag}`, name: "x", sequence: 500, calcBase: "SINGLE_TERM", baseTermId: baseId });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toMatch(/lower Sequence/);
    const ok = await post(P, { ...purchase, code: `D${tag}`, name: "x", sequence: 700, calcBase: "SINGLE_TERM", baseTermId: baseId });
    expect(ok.status).toBe(201);
  });

  it("cannot delete a term that another term uses as its base", async () => {
    const list = (await call("GET", `/api/masters/${P}?companyId=${companyId}`)).body;
    const base = list.find((t: any) => t.code === `I${tag}`);
    const r = await call("DELETE", `/api/masters/${P}/${base.id}`);
    expect(r.status).toBe(409);
  });

  it("landed-cost distribution: needs a basis, and is header-level only", async () => {
    expect((await post(P, { ...purchase, code: `E${tag}`, name: "x", sequence: 710, distributeToLines: true })).status).toBe(400);
    expect((await post(P, { ...purchase, code: `F${tag}`, name: "x", sequence: 711, isProductwise: true, distributeToLines: true, allocationBasis: "VALUE" })).status).toBe(400);
    expect((await post(P, { ...purchase, code: `G${tag}`, name: "Clearing", sequence: 712, distributeToLines: true, allocationBasis: "QUANTITY" })).status).toBe(201);
  });

  it("rejects negative default values and General Ledgers that are not in the company", async () => {
    expect((await post(P, { ...purchase, code: `H${tag}`, name: "x", sequence: 720, defaultValue: -1 })).status).toBe(400);
    expect((await post(P, { ...purchase, code: `J${tag}`, name: "x", sequence: 721, generalLedgerId: 999999 })).status).toBe(400);
  });

  it("sales terms: same rules, no landed-cost fields", async () => {
    const S = "sales-terms";
    expect((await post(S, { ...base, code: `S${tag}`, name: "Insurance", sequence: 600 })).status).toBe(201);
    expect((await post(S, { ...base, code: `T${tag}`, name: "x", sequence: 610, calcBase: "SINGLE_TERM" })).status).toBe(400);
    // landed-cost fields are not part of the sales schema; they must be ignored, not stored or rejected
    const r = await post(S, { ...base, code: `U${tag}`, name: "x", sequence: 611, distributeToLines: true, allocationBasis: "VALUE" });
    expect(r.status).toBe(201);
    expect(r.body.distributeToLines).toBeUndefined();
  });
});
