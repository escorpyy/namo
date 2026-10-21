import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { DB_READY, uniq } from "./helpers";

// Database-level company consistency for the account hierarchy. These talk to Postgres directly (not the API) because the
// point is that the DATABASE must refuse bad data even if some code path forgets to check. Every test runs in a
// transaction that is always rolled back, so nothing is left behind.
describe.skipIf(!DB_READY)("account hierarchy: company consistency enforced by the database", () => {
  let db: any;
  class Rollback extends Error {}

  beforeAll(async () => {
    ({ db } = await import("../server/db"));
  });

  const run = async (body: (tx: any, f: Fx) => Promise<void>) => {
    try {
      await db.transaction(async (tx: any) => {
        await body(tx, await fixtures(tx));
        throw new Rollback();
      });
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    }
  };

  type Fx = { coA: number; coB: number; sgA: number; sgB: number; grpA: number; glA: number };
  const one = async (tx: any, q: any) => (await tx.execute(q))[0].id as number;
  async function fixtures(tx: any): Promise<Fx> {
    const t = uniq();
    const mk = async (tag: string) => {
      const co = await one(tx, sql`insert into "Company"(code,name,"updatedAt") values (${"T" + t + tag},${"Test " + t + tag},now()) returning id`);
      const grp = await one(tx, sql`insert into "AccountGroup"("companyId",code,description,type,"updatedAt") values (${co},${"G" + tag},${"Grp " + tag},'ASSET',now()) returning id`);
      const sg = await one(tx, sql`insert into "AccountSubGroup"(code,description,"accountGroupId","updatedAt") values (${"S" + tag},${"Sub " + tag},${grp},now()) returning id`);
      return { co, grp, sg };
    };
    const a = await mk("A"), b = await mk("B");
    const glA = await one(tx, sql`insert into "GeneralLedger"("companyId",code,name,"accountSubGroupId","normalBalance","updatedAt") values (${a.co},'L1','Ledger A',${a.sg},'DEBIT',now()) returning id`);
    return { coA: a.co, coB: b.co, sgA: a.sg, sgB: b.sg, grpA: a.grp, glA };
  }

  // Run a statement inside a savepoint; it must be refused with a check violation (SQLSTATE 23514).
  const refused = async (tx: any, q: any, msg: RegExp) => {
    let err: any;
    try { await tx.transaction(async (t: any) => { await t.execute(q); }); } catch (e) { err = e; }
    expect(err, "statement should have been refused").toBeDefined();
    const cause = err.cause ?? err;
    expect(cause.code, cause.message).toBe("23514");
    expect(cause.message).toMatch(msg);
  };
  const gl = (co: number, sg: number, code: string, parent: number | null = null) =>
    sql`insert into "GeneralLedger"("companyId",code,name,"accountSubGroupId","normalBalance","parentId","updatedAt") values (${co},${code},'x',${sg},'DEBIT',${parent},now())`;

  it("control: a consistent ledger and a same-company parent are accepted", async () => {
    await run(async (tx, f) => {
      await tx.execute(gl(f.coA, f.sgA, "L2"));
      await tx.execute(gl(f.coA, f.sgA, "L3", f.glA));
    });
  });

  it("rejects INSERT of a ledger whose company differs from its Account Group's company", async () => {
    await run(async (tx, f) => refused(tx, gl(f.coB, f.sgA, "BAD"), /company/i));
  });

  it("rejects UPDATE that moves a ledger under another company's Sub Group", async () => {
    await run(async (tx, f) => refused(tx, sql`update "GeneralLedger" set "accountSubGroupId" = ${f.sgB} where id = ${f.glA}`, /company/i));
  });

  it("rejects UPDATE that changes a ledger's company", async () => {
    await run(async (tx, f) => refused(tx, sql`update "GeneralLedger" set "companyId" = ${f.coB} where id = ${f.glA}`, /company/i));
  });

  it("rejects a parent ledger from another company (INSERT and UPDATE)", async () => {
    await run(async (tx, f) => {
      const glB = await one(tx, sql`insert into "GeneralLedger"("companyId",code,name,"accountSubGroupId","normalBalance","updatedAt") values (${f.coB},'LB','B',${f.sgB},'DEBIT',now()) returning id`);
      await refused(tx, gl(f.coA, f.sgA, "CH", glB), /parent/i);
      await refused(tx, sql`update "GeneralLedger" set "parentId" = ${glB} where id = ${f.glA}`, /parent/i);
    });
  });

  it("rejects moving an Account Group to another company while it has ledgers", async () => {
    await run(async (tx, f) => refused(tx, sql`update "AccountGroup" set "companyId" = ${f.coB} where id = ${f.grpA}`, /ledger/i));
  });

  it("rejects moving a Sub Group under another company's group while it has ledgers", async () => {
    await run(async (tx, f) => {
      const grpB = await one(tx, sql`select "accountGroupId" as id from "AccountSubGroup" where id = ${f.sgB}`);
      await refused(tx, sql`update "AccountSubGroup" set "accountGroupId" = ${grpB} where id = ${f.sgA}`, /ledger/i);
    });
  });

  it("a record never changes company: even an EMPTY Sub Group or Account Group cannot move (ERP-015)", async () => {
    await run(async (tx, f) => {
      const empty = await one(tx, sql`insert into "AccountSubGroup"(code,description,"accountGroupId","updatedAt") values ('S9','Empty',${f.grpA},now()) returning id`);
      const grpB = await one(tx, sql`select "accountGroupId" as id from "AccountSubGroup" where id = ${f.sgB}`);
      await refused(tx, sql`update "AccountSubGroup" set "accountGroupId" = ${grpB} where id = ${empty}`, /cannot be changed/i);
      const emptyGrp = await one(tx, sql`insert into "AccountGroup"("companyId",code,description,type,"updatedAt") values (${f.coA},'EG9','Empty group','ASSET',now()) returning id`);
      await refused(tx, sql`update "AccountGroup" set "companyId" = ${f.coB} where id = ${emptyGrp}`, /cannot be changed/i);
    });
  });
});
