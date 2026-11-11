import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { DB_READY, uniq } from "./helpers";

// The number series engine against the real database. Every test runs in a transaction that is always rolled back.
describe.skipIf(!DB_READY)("number series engine (database)", () => {
  let db: any, S: any, E: any;
  class Rollback extends Error {}
  const NOW = sql`now()`;
  beforeAll(async () => {
    ({ db } = await import("../server/db"));
    S = await import("../server/db/schema");
    E = await import("../server/services/numberSeries");
  });
  const ins = async (tx: any, table: string, vals: Record<string, unknown>) => {
    const keys = Object.keys(vals);
    return (await tx.execute(sql`insert into ${sql.identifier(table)} (${sql.join(keys.map((k) => sql.identifier(k)), sql`, `)}) values (${sql.join(keys.map((k) => sql`${vals[k]}`), sql`, `)}) returning id`))[0].id as number;
  };
  const run = async (body: (tx: any, c: { co: number; br: number; br2: number; user: number }) => Promise<void>) => {
    try {
      await db.transaction(async (tx: any) => {
        const t = uniq();
        const co = await ins(tx, "Company", { code: `T${t}`, name: `Test ${t}`, updatedAt: NOW });
        const br = await ins(tx, "Branch", { companyId: co, code: `B1${t}`, name: "One", updatedAt: NOW });
        const br2 = await ins(tx, "Branch", { companyId: co, code: `B2${t}`, name: "Two", updatedAt: NOW });
        const user = (await tx.select({ id: S.user.id }).from(S.user).limit(1))[0]?.id ?? null;
        await body(tx, { co, br, br2, user });
        throw new Rollback();
      });
    } catch (e) { if (!(e instanceof Rollback)) throw e; }
  };
  const series = async (tx: any, co: number, over: Record<string, unknown> = {}) =>
    (await tx.insert(S.numberSeries).values({ companyId: co, documentType: "PURCHASE_BILL", name: uniq(), prefix: "LP-", padding: 2, ...over }).returning())[0];
  const W = (c: any, over: Record<string, unknown> = {}) => ({ companyId: c.co, branchId: c.br, fiscalYear: "2082/083", ...over });

  it("counts up per branch and per fiscal year, and each starts again", async () => {
    await run(async (tx, c) => {
      const s = await series(tx, c.co);
      const n = async (w: any) => (await E.nextOfSeries(tx, s, w, true)).number;
      expect(await n(W(c))).toBe("LP-01");
      expect(await n(W(c))).toBe("LP-02");
      expect(await n(W(c, { branchId: c.br2 }))).toBe("LP-01");
      expect(await n(W(c, { fiscalYear: "2083/084" }))).toBe("LP-01");
    });
  });

  it("can count once for all branches and all years", async () => {
    await run(async (tx, c) => {
      const s = await series(tx, c.co, { perBranch: false, resetPerFy: false });
      const n = async (w: any) => (await E.nextOfSeries(tx, s, w, true)).number;
      expect(await n(W(c))).toBe("LP-01");
      expect(await n(W(c, { branchId: c.br2 }))).toBe("LP-02");
      expect(await n(W(c, { fiscalYear: "2083/084" }))).toBe("LP-03");
    });
  });

  it("looking does not use the number up", async () => {
    await run(async (tx, c) => {
      const s = await series(tx, c.co);
      expect((await E.nextOfSeries(tx, s, W(c), false)).number).toBe("LP-01");
      expect((await E.nextOfSeries(tx, s, W(c), false)).number).toBe("LP-01");
      expect((await E.nextOfSeries(tx, s, W(c), true)).number).toBe("LP-01");
    });
  });

  it("honours start and increase by, and refuses past the end number", async () => {
    await run(async (tx, c) => {
      const s = await series(tx, c.co, { startNumber: 10, increment: 10, endNumber: 30 });
      const n = async () => (await E.nextOfSeries(tx, s, W(c), true)).number;
      expect(await n()).toBe("LP-10");
      expect(await n()).toBe("LP-20");
      const last = await E.nextOfSeries(tx, s, W(c), true);
      expect(last).toMatchObject({ number: "LP-30", left: 0 });
      await expect(n()).rejects.toMatchObject({ status: 409 });
    });
  });

  it("only offers a series to the users and branches it is made for", async () => {
    await run(async (tx, c) => {
      const open = await series(tx, c.co, { name: "Open" });
      const onlyBr2 = await series(tx, c.co, { name: "BR2", allBranches: false });
      await tx.insert(S.numberSeriesBranch).values({ seriesId: onlyBr2.id, branchId: c.br2 });
      const names = async (branchId: number) => (await E.usableSeries(tx, c.co, "PURCHASE_BILL", c.user, branchId)).map((x: any) => x.name);
      expect(await names(c.br)).toEqual(["Open"]);
      expect((await names(c.br2)).sort()).toEqual(["BR2", "Open"]);
      await expect(E.assignNumber(tx, { ...W(c), userId: c.user, documentType: "PURCHASE_BILL", seriesId: onlyBr2.id })).rejects.toMatchObject({ status: 409 });
      void open;
    });
  });

  it("puts the default series first", async () => {
    await run(async (tx, c) => {
      await series(tx, c.co, { name: "A" });
      await series(tx, c.co, { name: "Z", isDefault: true });
      expect((await E.usableSeries(tx, c.co, "PURCHASE_BILL", c.user, c.br))[0].name).toBe("Z");
    });
  });

  it("automatic ignores what was typed, suggested keeps it, manual requires it, and no series falls back to the old way", async () => {
    await run(async (tx, c) => {
      const base = { ...W(c), userId: c.user, documentType: "PURCHASE_BILL" };
      expect(await E.assignNumber(tx, { ...base, typed: "X-1" })).toMatchObject({ number: "X-1", seriesId: null, mode: "LEGACY" });
      expect(await E.assignNumber(tx, { ...base, typed: "" })).toMatchObject({ number: "0001", mode: "LEGACY" });
      const auto = await series(tx, c.co, { name: "Auto" });
      expect(await E.assignNumber(tx, { ...base, seriesId: auto.id, typed: "X-1" })).toMatchObject({ number: "LP-01", mode: "AUTOMATIC" });
      const sug = await series(tx, c.co, { name: "Sug", mode: "SUGGESTED", prefix: "SG-" });
      expect(await E.assignNumber(tx, { ...base, seriesId: sug.id, typed: "MINE-7" })).toMatchObject({ number: "MINE-7", mode: "SUGGESTED" });
      expect(await E.assignNumber(tx, { ...base, seriesId: sug.id })).toMatchObject({ number: "SG-01" });
      const man = await series(tx, c.co, { name: "Man", mode: "MANUAL" });
      expect(await E.assignNumber(tx, { ...base, seriesId: man.id, typed: "ANY/1" })).toMatchObject({ number: "ANY/1", mode: "MANUAL" });
      await expect(E.assignNumber(tx, { ...base, seriesId: man.id })).rejects.toMatchObject({ status: 400 });
    });
  });
});
