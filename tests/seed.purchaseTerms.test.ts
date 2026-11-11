import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { DB_READY } from "./helpers";

// The demo company's charge terms, so a cost assessment (COSTING terms) and a service bill (VAT) can be tried right after `pnpm db:seed` / `pnpm db:reset`.
describe.skipIf(!DB_READY)("Seeded purchase terms (demo company)", () => {
  let terms: any[] = [];
  beforeAll(async () => {
    const { db } = await import("../server/db");
    terms = await db.execute(sql`
      select t.code, t.category, t.nature, t."distributeToLines" as distribute, t."allocationBasis" as basis, g.code as ledger
        from "PurchaseTerm" t join "Company" c on c.id = t."companyId" left join "GeneralLedger" g on g.id = t."generalLedgerId"
       where c.code = 'ABC'`) as any[];
  });
  const term = (code: string) => terms.find((t) => t.code === code);

  it("has customs duty and excise as COSTING charges that are capitalised into the lines and post to a ledger", () => {
    expect(terms.length, "the demo company is not seeded: run pnpm db:seed").toBeGreaterThan(0);
    expect(term("CUSTOMS")).toMatchObject({ category: "COSTING", nature: "ADDITIVE", distribute: true, basis: "VALUE", ledger: "GL040" });
    expect(term("EXCISE")).toMatchObject({ category: "COSTING", nature: "ADDITIVE", distribute: true, basis: "QUANTITY", ledger: "GL040" });
  });

  it("has an input VAT term for service bills with its own VAT ledger, and keeps the original terms", () => {
    expect(term("VAT")).toMatchObject({ category: "GENERAL", nature: "ADDITIVE", ledger: "GL070" });
    expect(terms.map((t) => t.code)).toEqual(expect.arrayContaining(["DISC", "FREIGHT", "ROUND"]));
    expect(term("ROUND")).toMatchObject({ category: "ROUNDED" });
  });

  it("has each term once", () => {
    expect(new Set(terms.map((t) => t.code)).size).toBe(terms.length);
  });
});
