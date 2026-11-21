import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DB_READY, seededContext, startApi, uniq, type Res } from "./helpers";

// The masters that decide where an amount posts (billing terms, ledgers) are in the audit trail: who changed a term's ledger, from which to which.
describe.skipIf(!DB_READY)("audit trail of term and ledger masters (API)", () => {
  let call: (m: string, p: string, b?: unknown) => Promise<Res>;
  let close: () => Promise<void>;
  let companyId = 0, userId = 0, glA = 0, glB = 0;
  const made: { key: string; id: number }[] = [];
  const tag = uniq();

  beforeAll(async () => {
    ({ call, close } = await startApi());
    ({ companyId } = await seededContext(call));
    const gls = (await call("GET", `/api/masters/general-ledger?companyId=${companyId}`)).body as { id: number }[];
    glA = gls[0].id; glB = gls[1].id;
    const { db } = await import("../server/db");
    const { sql } = await import("drizzle-orm");
    userId = ((await db.execute(sql`select id from "User" where "isActive" order by id limit 1`)) as any[])[0].id;
  });
  afterAll(async () => {
    for (const m of made.reverse()) await call("DELETE", `/api/masters/${m.key}/${m.id}?companyId=${companyId}&userId=${userId}`);
    await close();
  });

  const term = (code: string, gl: number) => ({
    code, name: "Audit probe", category: "GENERAL", nature: "DEDUCTIVE", isProductwise: false, isMandatory: false, isEditable: true, sequence: 650,
    defaultCalcType: "PERCENT", defaultValue: 5, calcBase: "ITEM_VALUE", baseTermId: null, generalLedgerId: gl, isActive: true,
    distributeToLines: false, allocationBasis: null, affectsStockValue: true, defaultAgainstLedgerId: null,
  });
  const logOf = async (table: string, id: number) =>
    (await call("GET", `/api/audit?companyId=${companyId}&tableName=${table}&recordId=${id}&limit=20`)).body.rows as any[];

  it.each(["purchase-terms", "sales-terms"])("%s: changing the ledger is logged with who, old and new ledger", async (key) => {
    const table = key === "purchase-terms" ? "PurchaseTerm" : "SalesTerm";
    const created = await call("POST", `/api/masters/${key}?companyId=${companyId}&userId=${userId}`, term(`A${tag}${key[0]}`, glA));
    expect(created.status).toBe(201);
    made.push({ key, id: created.body.id });
    const upd = await call("PUT", `/api/masters/${key}/${created.body.id}?companyId=${companyId}&userId=${userId}`, term(`A${tag}${key[0]}`, glB));
    expect(upd.status).toBe(200);

    const rows = await logOf(table, created.body.id);
    expect(rows.map((r) => r.action)).toEqual(["UPDATE", "INSERT"]);
    const [u, i] = rows;
    expect(i.changedBy).toBe(userId);
    expect(u.changedBy).toBe(userId);
    expect(u.changedFields).toContain("generalLedgerId");
    expect(u.oldData.generalLedgerId).toBe(glA);
    expect(u.newData.generalLedgerId).toBe(glB);
  });

  it("a master changed without a user is still logged (user unknown)", async () => {
    const created = await call("POST", `/api/masters/purchase-terms?companyId=${companyId}`, term(`B${tag}`, glA));
    expect(created.status).toBe(201);
    made.push({ key: "purchase-terms", id: created.body.id });
    const [row] = await logOf("PurchaseTerm", created.body.id);
    expect(row.action).toBe("INSERT");
    expect(row.changedBy).toBeNull();
  });

  it("a ledger and its sub-group are audited too", async () => {
    const gl = (await call("GET", `/api/masters/general-ledger?companyId=${companyId}`)).body.find((g: any) => g.glType === "OTHER");
    const created = await call("POST", `/api/masters/general-ledger?companyId=${companyId}&userId=${userId}`, { ...gl, id: undefined, code: `Z${tag}`.slice(0, 10), name: `Probe ${tag}` });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    made.push({ key: "general-ledger", id: created.body.id });
    const rows = await logOf("GeneralLedger", created.body.id);
    expect(rows[0].action).toBe("INSERT");
    expect(rows[0].changedBy).toBe(userId);
    const upd = await call("PUT", `/api/masters/general-ledger/${created.body.id}?companyId=${companyId}&userId=${userId}`, { ...gl, id: undefined, code: `Z${tag}`.slice(0, 10), name: `Probe ${tag} 2` });
    expect(upd.status).toBe(200);
    const after = await logOf("GeneralLedger", created.body.id);
    expect(after[0].action).toBe("UPDATE");
    expect(after[0].changedFields).toContain("name");
  });
});
