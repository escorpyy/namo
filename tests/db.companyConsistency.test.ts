import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { DB_READY, uniq } from "./helpers";

// ERP-015: every link between tenant-scoped records must stay inside ONE company, enforced by the database itself.
// Registry: namo.company_source (where each table gets its company) + namo.company_link (links that must agree).
// All behaviour tests run inside a transaction that is always rolled back.
describe.skipIf(!DB_READY)("company consistency across all tenant-scoped tables (database level)", () => {
  let db: any;
  class Rollback extends Error {}
  const NOW = sql`now()`;
  // Not in the company registry on purpose. User is global. AuditLog (ERP-024, S11) does carry a companyId, but it is an
  // append-only history that outlives a company, so it has no foreign key and no "must still match" rule; the audit trigger
  // fills the company from the audited row (tests/db.auditTrail.test.ts).
  const GLOBAL_TABLES = ["User", "AuditLog"];

  beforeAll(async () => {
    ({ db } = await import("../server/db"));
  });

  const rows = async (q: any) => (await db.execute(q)) as any[];

  // ---------- registry completeness (catalog-driven: a NEW link added later without a rule fails here) ----------
  describe("registry covers the schema", () => {
    it("every table is registered or explicitly global", async () => {
      const tables = (await rows(sql`select table_name as t from information_schema.tables where table_schema='public' and table_type='BASE TABLE'`)).map((r) => r.t as string);
      const reg = new Set((await rows(sql`select distinct tbl from namo.company_source`)).map((r) => r.tbl as string));
      const missing = tables.filter((t) => !reg.has(t) && !GLOBAL_TABLES.includes(t) && !t.startsWith("__"));
      expect(missing, "register these in namo.company_source (or add to GLOBAL_TABLES if truly global)").toEqual([]);
    });

    it("every foreign key between registered tables is a rule (or the table's own owner link)", async () => {
      const fks = await rows(sql`
        select c.conrelid::regclass::text as child, a.attname as col, c.confrelid::regclass::text as parent
          from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
         where c.contype = 'f' and array_length(c.conkey, 1) = 1 and c.connamespace = 'public'::regnamespace`);
      const reg = new Set((await rows(sql`select distinct tbl from namo.company_source`)).map((r) => r.tbl as string));
      const links = new Set((await rows(sql`select tbl||'.'||col as k from namo.company_link`)).map((r) => r.k as string));
      const owners = new Set((await rows(sql`select tbl||'.'||via_col as k from namo.company_source where via_col is not null`)).map((r) => r.k as string));
      const clean = (s: string) => s.replace(/"/g, "");
      const unprotected = fks
        .map((f) => ({ child: clean(f.child), col: f.col as string, parent: clean(f.parent) }))
        .filter((f) => reg.has(f.child) && reg.has(f.parent) && !(f.parent === "Company" && f.col === "companyId"))
        .filter((f) => !links.has(`${f.child}.${f.col}`) && !owners.has(`${f.child}.${f.col}`))
        .map((f) => `${f.child}.${f.col} -> ${f.parent}`);
      expect(unprotected).toEqual([]);
    });

    it("the audit finds no existing violations in the seeded data", async () => {
      const v = await rows(sql`select * from namo.company_violations()`);
      expect(v).toEqual([]);
    });
  });

  // ---------- fixtures ----------
  const run = async (body: (tx: any, w: World) => Promise<void>) => {
    try {
      await db.transaction(async (tx: any) => {
        await body(tx, await world(tx));
        throw new Rollback();
      });
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    }
  };
  const ins = async (tx: any, table: string, vals: Record<string, unknown>) => {
    const keys = Object.keys(vals);
    const q = sql`insert into ${sql.identifier(table)} (${sql.join(keys.map((k) => sql.identifier(k)), sql`, `)}) values (${sql.join(keys.map((k) => sql`${vals[k]}`), sql`, `)}) returning id`;
    return (await tx.execute(q))[0].id as number;
  };
  type Co = { co: number; br: number; fy: number; gl: number; gl2: number; agent: number; party: number; unit: number; tax: number; product: number; stock: number; loc: number; term: number; term2: number; area: number; subArea: number; jv: number; ob: number; sub: number; vendorGl: number };
  type World = { A: Co; B: Co; tag: string };

  async function company(tx: any, tag: string, side: string): Promise<Co> {
    const c = (s: string) => `${s}${side}${tag}`.slice(0, 20);
    const co = await ins(tx, "Company", { code: c("T"), name: `Test ${side}${tag}`, updatedAt: NOW });
    const br = await ins(tx, "Branch", { companyId: co, code: c("B"), name: `Branch ${side}${tag}`, updatedAt: NOW });
    const fy = await ins(tx, "FiscalYear", { companyId: co, code: c("F"), startDate: "2025-07-16", endDate: "2026-07-15", updatedAt: NOW });
    const grp = await ins(tx, "AccountGroup", { companyId: co, code: c("G"), description: "Grp", type: "ASSET", updatedAt: NOW });
    const sg = await ins(tx, "AccountSubGroup", { code: c("S"), description: "Sub", accountGroupId: grp, updatedAt: NOW });
    const gl = await ins(tx, "GeneralLedger", { companyId: co, code: c("L1"), name: "L1", accountSubGroupId: sg, normalBalance: "DEBIT", updatedAt: NOW });
    const gl2 = await ins(tx, "GeneralLedger", { companyId: co, code: c("L2"), name: "L2", accountSubGroupId: sg, normalBalance: "DEBIT", updatedAt: NOW });
    const vendorGl = await ins(tx, "GeneralLedger", { companyId: co, code: c("L3"), name: "L3", accountSubGroupId: sg, normalBalance: "CREDIT", updatedAt: NOW });
    const agent = await ins(tx, "Agent", { companyId: co, code: c("AG"), name: "Agent", updatedAt: NOW });
    const party = await ins(tx, "Party", { companyId: co, generalLedgerId: vendorGl, updatedAt: NOW });
    const unit = await ins(tx, "ProductUnit", { companyId: co, code: c("U"), name: "Unit", updatedAt: NOW });
    const tax = await ins(tx, "TaxRate", { companyId: co, code: c("TX"), name: "Tax", ratePercent: 13, updatedAt: NOW });
    const pg = await ins(tx, "ProductGroup", { companyId: co, code: c("PG"), name: "PG", updatedAt: NOW });
    const psg = await ins(tx, "ProductSubGroup", { code: c("PS"), name: "PSG", productGroupId: pg, updatedAt: NOW });
    const product = await ins(tx, "Product", { companyId: co, code: c("P"), description: "Prod", type: "STOCK", productSubGroupId: psg, updatedAt: NOW });
    const stock = await ins(tx, "StockDetail", { productId: product, baseUnitId: unit, updatedAt: NOW });
    const loc = await ins(tx, "Location", { companyId: co, code: c("LC"), name: "Loc", updatedAt: NOW });
    const term = await ins(tx, "PurchaseTerm", { companyId: co, code: c("T1"), name: "T1", nature: "ADDITIVE", updatedAt: NOW });
    const term2 = await ins(tx, "PurchaseTerm", { companyId: co, code: c("T2"), name: "T2", nature: "ADDITIVE", updatedAt: NOW });
    const area = await ins(tx, "Area", { companyId: co, code: c("AR"), name: "Area", shortName: "AR", updatedAt: NOW });
    const subArea = await ins(tx, "SubArea", { code: c("SA"), name: "SubArea", shortName: "SA", areaId: area, updatedAt: NOW });
    const jv = await ins(tx, "JournalVoucher", { companyId: co, branchId: br, voucherNumber: c("JV"), voucherDate: "2025-08-01", fiscalYear: "2082/83", updatedAt: NOW });
    await ins(tx, "JournalVoucherLine", { journalVoucherId: jv, lineNumber: 1, generalLedgerId: gl });
    const ob = await ins(tx, "OpeningBalance", { companyId: co, branchId: br, fiscalYearId: fy, generalLedgerId: gl, updatedAt: NOW });
    const sub = await ins(tx, "SubLedger", { code: c("SL"), name: "Sub", generalLedgerId: gl, updatedAt: NOW });
    return { co, br, fy, gl, gl2, agent, party, unit, tax, product, stock, loc, term, term2, area, subArea, jv, ob, sub, vendorGl };
  }
  async function world(tx: any): Promise<World> {
    const tag = uniq();
    return { tag, A: await company(tx, tag, "A"), B: await company(tx, tag, "B") };
  }

  // The statement must be refused with a check violation (23514) that talks about the company.
  const refused = async (tx: any, run: () => Promise<unknown>, msg: RegExp = /company/i) => {
    let err: any;
    try { await tx.transaction(async () => { await run(); }); } catch (e) { err = e; }
    expect(err, "statement should have been refused").toBeDefined();
    const cause = err.cause ?? err;
    expect(cause.code, cause.message).toBe("23514");
    expect(cause.message).toMatch(msg);
  };
  const upd = (tx: any, table: string, id: number, col: string, val: unknown) =>
    tx.execute(sql`update ${sql.identifier(table)} set ${sql.identifier(col)} = ${val} where id = ${id}`);

  it("control: two fully consistent companies are accepted (no false positives)", async () => {
    await run(async (tx, w) => {
      expect(w.A.co).not.toBe(w.B.co);
      const v = (await tx.execute(sql`select * from namo.company_violations()`)) as any[];
      expect(v).toEqual([]);
    });
  });

  describe("direct links (table has its own companyId)", () => {
    it("OpeningBalance: ledger, branch, fiscal year, sub ledger and carry-forward must be the same company", async () => {
      await run(async (tx, { A, B }) => {
        const ob = (over: Record<string, unknown>) => ins(tx, "OpeningBalance", { companyId: A.co, branchId: A.br, fiscalYearId: A.fy, generalLedgerId: A.gl2, updatedAt: NOW, ...over });
        await refused(tx, () => ob({ generalLedgerId: B.gl }));
        await refused(tx, () => ob({ branchId: B.br }));
        await refused(tx, () => ob({ fiscalYearId: B.fy }));
        await refused(tx, () => ob({ subLedgerId: B.sub }));
        await refused(tx, () => ob({ carriedForwardFromId: B.ob }));
        await ob({ subLedgerId: A.sub }); // control
      });
    });
    it("JournalVoucher: branch and reversal-of must be the same company", async () => {
      await run(async (tx, { A, B }) => {
        const jv = (over: Record<string, unknown>) => ins(tx, "JournalVoucher", { companyId: A.co, branchId: A.br, voucherNumber: `X${uniq()}`, voucherDate: "2025-08-02", fiscalYear: "2082/83", updatedAt: NOW, ...over });
        await refused(tx, () => jv({ branchId: B.br }));
        await refused(tx, () => jv({ reversalOfId: B.jv }));
        await jv({ reversalOfId: A.jv }); // control
      });
    });
    it("Party / GeneralLedger / PurchaseTerm links", async () => {
      await run(async (tx, { A, B }) => {
        await refused(tx, () => ins(tx, "Party", { companyId: A.co, generalLedgerId: B.gl, updatedAt: NOW }));
        await refused(tx, () => upd(tx, "GeneralLedger", A.gl, "agentId", B.agent));
        await refused(tx, () => upd(tx, "PurchaseTerm", A.term, "generalLedgerId", B.gl));
        await refused(tx, () => upd(tx, "PurchaseTerm", A.term, "baseTermId", B.term));
        // control (the table's own check requires calcBase = SINGLE_TERM whenever a base term is set)
        await tx.execute(sql`update "PurchaseTerm" set "calcBase" = 'SINGLE_TERM', "baseTermId" = ${A.term2} where id = ${A.term}`);
      });
    });
    it("Company.retainedEarningsGLId must be one of that company's own ledgers", async () => {
      await run(async (tx, { A, B }) => {
        await refused(tx, () => upd(tx, "Company", A.co, "retainedEarningsGLId", B.gl));
        await upd(tx, "Company", A.co, "retainedEarningsGLId", A.gl); // control
      });
    });
  });

  describe("derived links (child table has no companyId; company comes from its owner)", () => {
    it("JournalVoucherLine: ledger must match the voucher's company", async () => {
      await run(async (tx, { A, B }) => {
        await refused(tx, () => ins(tx, "JournalVoucherLine", { journalVoucherId: A.jv, lineNumber: 2, generalLedgerId: B.gl }));
        await ins(tx, "JournalVoucherLine", { journalVoucherId: A.jv, lineNumber: 2, generalLedgerId: A.gl2 }); // control
      });
    });
    it("StockDetail: ledgers, units and the product must all be one company", async () => {
      await run(async (tx, { A, B }) => {
        await refused(tx, () => upd(tx, "StockDetail", A.stock, "purchaseGLId", B.gl));
        await refused(tx, () => upd(tx, "StockDetail", A.stock, "baseUnitId", B.unit));
        await refused(tx, () => upd(tx, "StockDetail", A.stock, "taxRateId", B.tax));
        await upd(tx, "StockDetail", A.stock, "taxRateId", A.tax); // control
      });
    });
    it("SubLedger: ledger and party must agree; party-only is allowed; owner-less is not", async () => {
      await run(async (tx, { A, B }) => {
        await refused(tx, () => ins(tx, "SubLedger", { code: `Q${uniq()}`, name: "x", generalLedgerId: A.gl, partyId: B.party, updatedAt: NOW }));
        await ins(tx, "SubLedger", { code: `R${uniq()}`, name: "party only", partyId: A.party, updatedAt: NOW }); // control
        await refused(tx, () => ins(tx, "SubLedger", { code: `S${uniq()}`, name: "no owner", updatedAt: NOW }));
      });
    });
    it("GeneralLedger.subAreaId must be an area of the same company", async () => {
      await run(async (tx, { A, B }) => {
        await refused(tx, () => upd(tx, "GeneralLedger", A.gl, "subAreaId", B.subArea));
        await upd(tx, "GeneralLedger", A.gl, "subAreaId", A.subArea); // control
      });
    });
  });

  describe("a record can never change company", () => {
    it("direct: companyId is immutable", async () => {
      await run(async (tx, { A, B }) => {
        await refused(tx, () => upd(tx, "Branch", A.br, "companyId", B.co), /cannot be changed|company/i);
        await refused(tx, () => upd(tx, "Agent", A.agent, "companyId", B.co), /cannot be changed|company/i);
        await refused(tx, () => upd(tx, "OpeningBalance", A.ob, "companyId", B.co), /cannot be changed|company/i);
      });
    });
    it("derived: moving a child under an owner of another company is refused", async () => {
      await run(async (tx, { A, B }) => {
        // fresh targets in company B (no existing child), so a refusal can only come from the company rule, not a unique key
        const [psg] = (await tx.execute(sql`select "productSubGroupId" as id from "Product" where id = ${B.product}`)) as any[];
        const bProduct = await ins(tx, "Product", { companyId: B.co, code: `PX${uniq()}`, description: "B2", type: "STOCK", productSubGroupId: psg.id, updatedAt: NOW });
        await refused(tx, () => upd(tx, "StockDetail", A.stock, "productId", bProduct));
        const bJv = await ins(tx, "JournalVoucher", { companyId: B.co, branchId: B.br, voucherNumber: `JX${uniq()}`, voucherDate: "2025-08-03", fiscalYear: "2082/83", updatedAt: NOW });
        const [line] = (await tx.execute(sql`select id from "JournalVoucherLine" where "journalVoucherId" = ${A.jv}`)) as any[];
        await refused(tx, () => upd(tx, "JournalVoucherLine", line.id, "journalVoucherId", bJv));
      });
    });
  });

  describe("the audit", () => {
    it("reports a violation that was planted while the trigger was off", async () => {
      await run(async (tx, { A, B }) => {
        await tx.execute(sql`alter table "OpeningBalance" disable trigger namo_company_consistency`);
        const id = await ins(tx, "OpeningBalance", { companyId: A.co, branchId: A.br, fiscalYearId: A.fy, generalLedgerId: B.gl, updatedAt: NOW });
        const v = (await tx.execute(sql`select * from namo.company_violations()`)) as any[];
        expect(v.some((r) => r.tbl === "OpeningBalance" && r.row_id === id && r.col === "generalLedgerId")).toBe(true);
      });
    });
  });
});
