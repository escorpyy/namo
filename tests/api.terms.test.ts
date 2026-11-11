import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DB_READY, seededContext, startApi, uniq, type Res } from "./helpers";

describe.skipIf(!DB_READY)("Purchase / Sales Term masters (API)", () => {
  let call: (m: string, p: string, b?: unknown) => Promise<Res>;
  let close: () => Promise<void>;
  let companyId = 0;
  let glA = 0;
  let glB = 0;
  const created: { key: string; id: number }[] = [];

  beforeAll(async () => {
    ({ call, close } = await startApi());
    ({ companyId } = await seededContext(call));
    // A purchase term must have its own ledger; the seeded demo company has ledgers to pick from.
    const gls = (await call("GET", `/api/masters/general-ledger?companyId=${companyId}`)).body as { id: number }[];
    glA = gls[0].id;
    glB = gls[1].id;
    purchase.generalLedgerId = glA;
  });
  afterAll(async () => {
    for (const c of created.reverse()) await call("DELETE", `/api/masters/${c.key}/${c.id}`);
    await close();
  });

  const base = { category: "GENERAL", nature: "ADDITIVE", isProductwise: false, isMandatory: false, isEditable: true, defaultCalcType: "PERCENT", defaultValue: 13, calcBase: "ITEM_VALUE", baseTermId: null, generalLedgerId: null, isActive: true };
  const purchase: Record<string, unknown> = { ...base, distributeToLines: false, allocationBasis: null, affectsStockValue: true, defaultAgainstLedgerId: null };
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

  it("a purchase term must have its own general ledger", async () => {
    const r = await post(P, { ...purchase, code: `L${tag}`, name: "No ledger", sequence: 602, generalLedgerId: null });
    expect(r.status).toBe(400);
  });

  it("saves the stock-value flag and a default against ledger, and the against ledger must differ from the term's own ledger", async () => {
    const ok = await post(P, { ...purchase, code: `V${tag}`, name: "Import VAT", category: "COSTING", sequence: 603, affectsStockValue: false, defaultAgainstLedgerId: glB });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.affectsStockValue).toBe(false);
    expect(ok.body.defaultAgainstLedgerId).toBe(glB);
    const same = await post(P, { ...purchase, code: `W${tag}`, name: "Same ledger", category: "COSTING", sequence: 604, defaultAgainstLedgerId: glA });
    expect(same.status).toBe(400);
  });

  it("Always show and Editable are saved, and Always show is refused on a Costing term", async () => {
    const ok = await post(P, { ...purchase, code: `S${tag}`, name: "Always there", sequence: 605, isMandatory: true, isEditable: false });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body).toMatchObject({ isMandatory: true, isEditable: false });
    const plain = await post(P, { ...purchase, code: `T${tag}`, name: "Plain", sequence: 606 });
    expect(plain.body.isEditable).toBe(true); // editable unless the master says otherwise
    const bad = await post(P, { ...purchase, code: `U${tag}`, name: "Costing always", category: "COSTING", sequence: 607, isMandatory: true });
    expect(bad.status).toBe(400);
    const sales = await post("sales-terms", { ...base, code: `X${tag}`, name: "Sales costing", category: "COSTING", sequence: 608, isMandatory: true, generalLedgerId: glA });
    expect(sales.status).toBe(400);
  });

  it("a Rounded term is document-wise, on the running total, not distributed, and there is only one active", async () => {
    const round = { ...purchase, category: "ROUNDED", calcBase: "RUNNING_TOTAL", defaultCalcType: "AMOUNT", defaultValue: 0, isProductwise: false };
    const list = (await call("GET", `/api/masters/${P}?companyId=${companyId}`)).body;
    const seeded = list.find((t: any) => t.category === "ROUNDED" && t.isActive);
    if (seeded) { const off = await call("PUT", `/api/masters/${P}/${seeded.id}?companyId=${companyId}`, { ...seeded, defaultValue: Number(seeded.defaultValue), isActive: false }); expect(off.status, JSON.stringify(off.body)).toBe(200); } // make room for this test's own
    try {
      expect((await post(P, { ...round, code: `R1${tag}`, name: "r", sequence: 900, isProductwise: true })).status).toBe(400);
      expect((await post(P, { ...round, code: `R2${tag}`, name: "r", sequence: 900, calcBase: "ITEM_VALUE" })).status).toBe(400);
      expect((await post(P, { ...round, code: `R3${tag}`, name: "r", sequence: 900, distributeToLines: true, allocationBasis: "VALUE" })).status).toBe(400);
      const ok = await post(P, { ...round, code: `R4${tag}`, name: "Round Off", sequence: 900 });
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
      const second = await post(P, { ...round, code: `R5${tag}`, name: "Second", sequence: 901 });
      expect(second.status).toBe(409);
      // an inactive one is fine, and the active one can still be edited
      expect((await post(P, { ...round, code: `R6${tag}`, name: "Spare", sequence: 902, isActive: false })).status).toBe(201);
      expect((await call("PUT", `/api/masters/${P}/${ok.body.id}?companyId=${companyId}`, { ...ok.body, defaultValue: Number(ok.body.defaultValue), name: "Round Off 2" })).status).toBe(200);
    } finally {
      if (seeded) await call("PUT", `/api/masters/${P}/${seeded.id}?companyId=${companyId}`, { ...seeded, defaultValue: Number(seeded.defaultValue), isActive: true });
    }
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
