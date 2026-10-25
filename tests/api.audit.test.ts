import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { DB_READY, startApi, uniq, type Res } from "./helpers";

// ERP-024 part 2: GET /api/audit reads the audit trail, one company at a time, newest first. Read-only.
// Fixtures are committed (the route uses its own connection) in two throw-away INACTIVE companies. The log itself is
// append-only, so its rows stay; the test database is rebuilt on every `pnpm test:db`.
describe.skipIf(!DB_READY)("audit trail API", () => {
  let db: any;
  let call: (m: string, p: string, b?: unknown) => Promise<Res>;
  let close: () => Promise<void>;
  const NOW = sql`now()`;
  const tag = uniq();
  const c = (s: string) => `${s}${tag}`.slice(0, 20);
  let user = 0, coA = 0, coB = 0, brA = 0, brB = 0;
  let vA1 = 0, vA2 = 0, vB1 = 0;
  const made: { table: string; id: number }[] = [];

  const ins = async (tx: any, table: string, vals: Record<string, unknown>) => {
    const keys = Object.keys(vals);
    const q = sql`insert into ${sql.identifier(table)} (${sql.join(keys.map((k) => sql.identifier(k)), sql`, `)}) values (${sql.join(keys.map((k) => sql`${vals[k]}`), sql`, `)}) returning id`;
    const id = (await tx.execute(q))[0].id as number;
    made.push({ table, id });
    return id;
  };
  const acting = (tx: any, userId: number | null, reason: string) =>
    tx.execute(sql`select set_config('namo.actor_user_id', ${userId == null ? "" : String(userId)}, true), set_config('namo.change_reason', ${reason}, true)`);

  beforeAll(async () => {
    ({ db } = await import("../server/db"));
    ({ call, close } = await startApi());
    await db.transaction(async (tx: any) => {
      user = await ins(tx, "User", { name: `Auditor ${tag}`, email: `aud${tag}@test.local` });
      coA = await ins(tx, "Company", { code: c("AA"), name: `Audit A ${tag}`, isActive: false, updatedAt: NOW });
      coB = await ins(tx, "Company", { code: c("AB"), name: `Audit B ${tag}`, isActive: false, updatedAt: NOW });
      brA = await ins(tx, "Branch", { companyId: coA, code: c("BA"), name: "A", updatedAt: NOW });
      brB = await ins(tx, "Branch", { companyId: coB, code: c("BB"), name: "B", updatedAt: NOW });
      const jv = (co: number, br: number, n: string) => ins(tx, "JournalVoucher", { companyId: co, branchId: br, voucherNumber: c(n), voucherDate: "2025-08-01", fiscalYear: "2082/83", updatedAt: NOW });
      await acting(tx, user, "first entry");
      vA1 = await jv(coA, brA, "JA1");
      await acting(tx, null, "");
      vA2 = await jv(coA, brA, "JA2");
      vB1 = await jv(coB, brB, "JB1");
    });
    await db.transaction(async (tx: any) => {
      await acting(tx, user, "typo in remarks");
      await tx.execute(sql`update "JournalVoucher" set remarks = 'rent for Kartik', "updatedAt" = now() + interval '1 second' where id = ${vA1}`);
    });
  });
  afterAll(async () => {
    // Draft vouchers, branches and companies are removed; the audit entries about them stay by design.
    await db.execute(sql`delete from "JournalVoucher" where "companyId" in (${coA}, ${coB})`);
    await db.execute(sql`delete from "Branch" where "companyId" in (${coA}, ${coB})`);
    await db.execute(sql`delete from "Company" where id in (${coA}, ${coB})`);
    await close();
  });

  const get = (qs: string) => call("GET", `/api/audit?${qs}`);

  it("returns only the asked company's entries, newest first, with the user's name, the reason and ids as text", async () => {
    const r = await get(`companyId=${coA}`);
    expect(r.status).toBe(200);
    const rows = r.body.rows as any[];
    expect(rows.length).toBe(3); // INSERT vA1, INSERT vA2, UPDATE vA1
    expect(rows.every((x) => x.companyId === coA)).toBe(true);
    expect(typeof rows[0].id).toBe("string");
    for (let i = 1; i < rows.length; i++) expect(BigInt(rows[i - 1].id) > BigInt(rows[i].id)).toBe(true);
    expect(rows[0]).toMatchObject({ tableName: "JournalVoucher", recordId: String(vA1), action: "UPDATE", changedBy: user, changedByName: `Auditor ${tag}`, reason: "typo in remarks" });
    const last = rows.find((x) => x.recordId === String(vA1) && x.action === "INSERT");
    expect(last).toMatchObject({ reason: "first entry", changedByName: `Auditor ${tag}` });
    const nobody = rows.find((x) => x.recordId === String(vA2));
    expect(nobody).toMatchObject({ changedBy: null, changedByName: null, reason: null });
    expect(rows.some((x) => x.recordId === String(vB1))).toBe(false);
    expect(r.body.nextBefore).toBeNull();
  });

  it("an UPDATE lists the fields that changed (not updatedAt); other actions list none", async () => {
    const rows = (await get(`companyId=${coA}`)).body.rows as any[];
    const upd = rows.find((x) => x.action === "UPDATE");
    expect(upd.changedFields).toEqual(["remarks"]);
    expect(upd.oldData.remarks).toBeNull();
    expect(upd.newData.remarks).toBe("rent for Kartik");
    expect(rows.filter((x) => x.action !== "UPDATE").every((x) => x.changedFields === null)).toBe(true);
  });

  it("filters: one record's history, one table, one user, one action", async () => {
    const hist = (await get(`companyId=${coA}&tableName=JournalVoucher&recordId=${vA1}`)).body.rows as any[];
    expect(hist.map((x) => x.action)).toEqual(["UPDATE", "INSERT"]);
    expect((await get(`companyId=${coA}&tableName=OpeningBalance`)).body.rows).toEqual([]);
    expect(((await get(`companyId=${coA}&changedBy=${user}`)).body.rows as any[]).map((x) => x.recordId)).toEqual([String(vA1), String(vA1)]);
    expect(((await get(`companyId=${coA}&action=INSERT`)).body.rows as any[]).length).toBe(2);
  });

  it("pages with limit and before, without gaps or repeats", async () => {
    const all = (await get(`companyId=${coA}`)).body.rows.map((x: any) => x.id) as string[];
    const p1 = await get(`companyId=${coA}&limit=2`);
    expect(p1.body.rows.map((x: any) => x.id)).toEqual(all.slice(0, 2));
    expect(p1.body.nextBefore).toBe(all[1]);
    const p2 = await get(`companyId=${coA}&limit=2&before=${p1.body.nextBefore}`);
    expect(p2.body.rows.map((x: any) => x.id)).toEqual(all.slice(2));
    expect(p2.body.nextBefore).toBeNull();
  });

  it("a company with no history (or no such company) is an empty list, not an error", async () => {
    expect((await get(`companyId=999999999`)).body).toEqual({ rows: [], nextBefore: null });
  });

  it.each([
    ["no companyId", ""],
    ["companyId not a number", "companyId=abc"],
    ["companyId zero", "companyId=0"],
    ["a table that is not audited", "companyId=1&tableName=User"],
    ["a table name that is SQL", "companyId=1&tableName=JournalVoucher%22%3B%20drop%20table"],
    ["limit zero", "companyId=1&limit=0"],
    ["limit above the maximum", "companyId=1&limit=201"],
    ["limit not a number", "companyId=1&limit=ten"],
    ["unknown action", "companyId=1&action=TRUNCATE"],
    ["before not a number", "companyId=1&before=x"],
    ["changedBy not a number", "companyId=1&changedBy=me"],
    ["companyId above PostgreSQL integer range", "companyId=2147483648"],
    ["changedBy above PostgreSQL integer range", "companyId=1&changedBy=2147483648"],
    ["before above PostgreSQL bigint range", "companyId=1&before=9223372036854775808"],
    ["repeated tableName", "companyId=1&tableName=JournalVoucher&tableName=OpeningBalance"],
    ["repeated action", "companyId=1&action=INSERT&action=DELETE"],
    ["repeated recordId", "companyId=1&recordId=1&recordId=2"],
    ["repeated limit", "companyId=1&limit=10&limit=20"],
  ])("refuses %s with 400", async (_n, qs) => {
    const r = await get(qs);
    expect(r.status).toBe(400);
    expect(String(r.body.message)).not.toMatch(/select |insert |Failed query/i);
  });

  it("the table list the API accepts is exactly the set of tables the database audits", async () => {
    const { AUDITED_TABLES } = await import("../server/db/audit");
    const t = (await db.execute(sql`select c.relname as t from pg_trigger g join pg_class c on c.oid = g.tgrelid where g.tgname = 'Audit_trail' and not g.tgisinternal order by 1`)) as any[];
    expect([...AUDITED_TABLES].sort()).toEqual(t.map((r) => r.t));
  });

  it("is read-only: POST, PUT and DELETE are not routes", async () => {
    for (const m of ["POST", "PUT", "PATCH", "DELETE"]) {
      const r = await call(m, `/api/audit?companyId=${coA}`, {});
      expect(r.status, m).toBe(404);
    }
  });
});
