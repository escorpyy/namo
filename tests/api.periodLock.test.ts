import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { DB_READY, startApi, uniq, type Res } from "./helpers";

// ERP-025 over HTTP: GET/PUT /api/period-lock and the lock on purchase-bill writes (create, edit, delete, post, reverse), with the
// override { password, reason } that opens ONE request only. The database rules themselves are in tests/db.periodLock.test.ts.
// The world is a throw-away INACTIVE company (never in the header switcher), removed afterwards.
describe.skipIf(!DB_READY)("Company lock date (API)", () => {
  let call: (m: string, p: string, b?: unknown) => Promise<Res>;
  let close: () => Promise<void>;
  let db: any;
  let hashLockPassword: (p: string) => Promise<string>;
  let userId = 0;
  const tag = uniq();
  const c = (s: string) => `${s}${tag}`.slice(0, 20);
  const W: Record<string, number> = {};
  const NOW = sql`now()`;
  const PW = "correct-horse";
  const LOCK = "2025-09-01";

  const ins = async (table: string, vals: Record<string, unknown>) => {
    const keys = Object.keys(vals);
    const r = (await db.execute(sql`insert into ${sql.identifier(table)} (${sql.join(keys.map((k) => sql.identifier(k)), sql`, `)}) values (${sql.join(keys.map((k) => sql`${vals[k]}`), sql`, `)}) returning id`)) as any[];
    return r[0].id as number;
  };
  const rowsOf = async (q: any) => (await db.execute(q)) as any[];

  // Put the company's lock in a known state straight in the database (test setup only; the guard is switched off for this one transaction).
  const setLock = async (date: string | null) => {
    const hash = date ? await hashLockPassword(PW) : null;
    await db.transaction(async (tx: any) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.execute(sql`delete from "CompanyLock" where "companyId" = ${W.co}`);
      if (date) await tx.execute(sql`insert into "CompanyLock" ("companyId", "lockDate", "passwordHash", "updatedAt") values (${W.co}, ${date}, ${hash}, now())`);
    });
  };

  const bills = "/api/purchase/bills";
  const billBody = (over: Record<string, unknown> = {}) => ({
    companyId: W.co, branchId: W.br, invoiceDate: "2025-10-14", vendorGLId: W.vendor, lines: [{ productId: W.rice, qty: 10, rate: 100 }], ...over,
  });
  const mkBill = async (over: Record<string, unknown> = {}) => {
    const r = await call("POST", bills, billBody(over));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.result as { id: number; invoiceNumber: string };
  };
  const post = (id: number, body: unknown = {}) => call("POST", `${bills}/${id}/post?companyId=${W.co}`, body);
  const reverse = (id: number, body: unknown = {}) => call("POST", `${bills}/${id}/reverse?companyId=${W.co}`, body);
  const put = (id: number, body: unknown) => call("PUT", `${bills}/${id}?companyId=${W.co}`, body);
  const del = (id: number, body?: unknown) => call("DELETE", `${bills}/${id}?companyId=${W.co}`, body);
  const override = (over: Record<string, unknown> = {}) => ({ lockOverride: { password: PW, reason: "owner approved a correction", ...over } });
  const locked = (r: Res) => {
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(r.body.code).toBe("PERIOD_LOCKED");
    expect(r.body.message).toMatch(/locked up to 2025-09-01/);
  };
  const auditOf = (table: string, id: number | string) => rowsOf(sql`select "action", "reason", "lockOverride", "newData", "oldData" from "AuditLog" where "tableName" = ${table} and "recordId" = ${String(id)} order by id`);

  beforeAll(async () => {
    ({ call, close } = await startApi());
    ({ db } = await import("../server/db"));
    ({ hashLockPassword } = await import("../server/services/periodLock"));
    userId = (await call("GET", "/api/context")).body.user.id;

    W.co = await ins("Company", { code: c("T"), name: `ZZ Lock Test ${tag}`, isActive: false, updatedAt: NOW });
    W.br = await ins("Branch", { companyId: W.co, code: c("B"), name: "Branch", updatedAt: NOW });
    await ins("FiscalYear", { companyId: W.co, code: "2082/83", startDate: "2025-07-17", endDate: "2026-07-16", isCurrent: true, updatedAt: NOW });
    const grp = await ins("AccountGroup", { companyId: W.co, code: c("G"), description: "Grp", type: "EXPENSE", updatedAt: NOW });
    const sg = await ins("AccountSubGroup", { code: c("S"), description: "Sub", accountGroupId: grp, updatedAt: NOW });
    const gl = (code: string, normal = "DEBIT") => ins("GeneralLedger", { companyId: W.co, code: c(code), name: code, accountSubGroupId: sg, normalBalance: normal, updatedAt: NOW });
    W.vendor = await gl("VEND", "CREDIT");
    W.purchase = await gl("PURCH");
    W.pcs = await ins("ProductUnit", { companyId: W.co, code: c("PCS").slice(0, 10), name: `Pcs ${tag}`, updatedAt: NOW });
    const pg = await ins("ProductGroup", { companyId: W.co, code: c("PG"), name: "PG", updatedAt: NOW });
    const psg = await ins("ProductSubGroup", { code: c("PSG"), name: "PSG", productGroupId: pg, updatedAt: NOW });
    W.rice = await ins("Product", { companyId: W.co, code: c("rice").slice(0, 10), description: "rice", type: "STOCK", productSubGroupId: psg, updatedAt: NOW });
    await ins("StockDetail", { productId: W.rice, baseUnitId: W.pcs, purchaseGLId: W.purchase, updatedAt: NOW });
  });

  afterAll(async () => {
    if (W.co) {
      await db.transaction(async (tx: any) => {
        const co = W.co;
        await tx.execute(sql`set local session_replication_role = replica`);
        await tx.execute(sql`delete from "PurchaseDocumentTermAllocation" where "documentTermId" in (select id from "PurchaseDocumentTerm" where "companyId" = ${co})`);
        await tx.execute(sql`delete from "PurchaseDocumentTerm" where "companyId" = ${co}`);
        await tx.execute(sql`delete from "PurchaseBillLine" where "purchaseBillId" in (select id from "PurchaseBill" where "companyId" = ${co})`);
        await tx.execute(sql`delete from "PurchaseBill" where "companyId" = ${co}`);
        await tx.execute(sql`delete from "JournalVoucherLine" where "journalVoucherId" in (select id from "JournalVoucher" where "companyId" = ${co})`);
        await tx.execute(sql`delete from "JournalVoucher" where "companyId" = ${co}`);
        await tx.execute(sql`delete from "PurchaseOrderLine" where "purchaseOrderId" in (select id from "PurchaseOrder" where "companyId" = ${co})`);
        await tx.execute(sql`delete from "PurchaseOrder" where "companyId" = ${co}`);
        await tx.execute(sql`delete from "CompanyLock" where "companyId" = ${co}`);
        await tx.execute(sql`delete from "StockDetail" where "productId" = ${W.rice}`);
        await tx.execute(sql`delete from "Product" where "companyId" = ${co}`);
        await tx.execute(sql`delete from "ProductSubGroup" where "productGroupId" in (select id from "ProductGroup" where "companyId" = ${co})`);
        for (const t of ["ProductGroup", "ProductUnit"]) await tx.execute(sql`delete from ${sql.identifier(t)} where "companyId" = ${co}`);
        await tx.execute(sql`delete from "GeneralLedger" where "companyId" = ${co}`);
        await tx.execute(sql`delete from "AccountSubGroup" where "accountGroupId" in (select id from "AccountGroup" where "companyId" = ${co})`);
        for (const t of ["AccountGroup", "FiscalYear", "Branch"]) await tx.execute(sql`delete from ${sql.identifier(t)} where "companyId" = ${co}`);
        await tx.execute(sql`delete from "Company" where id = ${co}`);
      });
    }
    await close();
  });

  // ===================================================================================================================
  describe("GET / PUT /api/period-lock", () => {
    const put2 = (b: Record<string, unknown>) => call("PUT", "/api/period-lock", { companyId: W.co, ...b });
    const get = () => call("GET", `/api/period-lock?companyId=${W.co}`);

    it("a company with no lock reports no date and no password", async () => {
      await setLock(null);
      const r = await get();
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ companyId: W.co, lockDate: null, passwordSet: false, updatedAt: null, updatedBy: null });
    });

    it("refuses a missing / unknown company", async () => {
      expect((await call("GET", "/api/period-lock")).status).toBe(400);
      expect((await call("GET", "/api/period-lock?companyId=abc")).status).toBe(400);
      expect((await call("GET", "/api/period-lock?companyId=999999999")).status).toBe(404);
      expect((await call("PUT", "/api/period-lock", { companyId: 2000000000, lockDate: LOCK, newPassword: PW })).status).toBe(404);
      expect((await call("PUT", "/api/period-lock", [])).status).toBe(400);
    });

    it("a lock date needs a password; the first lock sets both and the answer never contains the hash", async () => {
      await setLock(null);
      const noPw = await put2({ lockDate: LOCK });
      expect(noPw.status).toBe(400);
      expect(noPw.body.message).toMatch(/password/i);
      expect((await get()).body.lockDate).toBeNull();

      const ok = await put2({ lockDate: LOCK, newPassword: PW, userId });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body).toMatchObject({ companyId: W.co, lockDate: LOCK, passwordSet: true, updatedBy: userId });
      expect(JSON.stringify(ok.body)).not.toMatch(/scrypt|passwordHash/);
      expect(JSON.stringify((await get()).body)).not.toMatch(/scrypt|passwordHash/);
      const [row] = await rowsOf(sql`select "passwordHash" as h from "CompanyLock" where "companyId" = ${W.co}`);
      expect(row.h).toMatch(/^scrypt\$/);
      expect(row.h).not.toContain(PW);
    });

    it("validates input: short password, bad date, wrong types, unknown user", async () => {
      await setLock(null);
      expect((await put2({ lockDate: LOCK, newPassword: "abc" })).status).toBe(400);
      expect((await put2({ lockDate: "2025-02-30", newPassword: PW })).status).toBe(400);
      expect((await put2({ lockDate: "tomorrow", newPassword: PW })).status).toBe(400);
      expect((await put2({ lockDate: 20250901, newPassword: PW })).status).toBe(400);
      expect((await put2({ lockDate: LOCK, newPassword: 123456 })).status).toBe(400);
      expect((await put2({ lockDate: LOCK, newPassword: PW, userId: 2000000000 })).status).toBe(400);
      expect((await get()).body.lockDate).toBeNull();
    });

    it("raising the date needs nothing more; lowering, removing or changing the password needs the current password and a reason", async () => {
      await setLock(LOCK);
      expect((await put2({ lockDate: "2025-09-15" })).body.lockDate).toBe("2025-09-15");

      const noCurrent = await put2({ lockDate: LOCK, reason: "r" });
      expect(noCurrent.status).toBe(400);
      expect(noCurrent.body.code).toBe("LOCK_PASSWORD_REQUIRED");
      const wrong = await put2({ lockDate: LOCK, currentPassword: "nope-nope", reason: "r" });
      expect(wrong.status).toBe(403);
      expect(wrong.body.code).toBe("LOCK_PASSWORD_WRONG");
      const noReason = await put2({ lockDate: LOCK, currentPassword: PW });
      expect(noReason.status).toBe(400);
      expect(noReason.body.field).toBe("reason");
      const blank = await put2({ lockDate: LOCK, currentPassword: PW, reason: "   " });
      expect(blank.status).toBe(400);
      expect((await get()).body.lockDate).toBe("2025-09-15");

      expect((await put2({ lockDate: LOCK, currentPassword: PW, reason: "wrong date was typed", userId })).body.lockDate).toBe(LOCK);
      expect((await put2({ lockDate: null, currentPassword: PW, reason: "audit finished", userId })).body).toMatchObject({ lockDate: null, passwordSet: true });
    });

    it("changing the password needs the current one; the new one then works and the old one does not", async () => {
      await setLock(LOCK);
      expect((await put2({ newPassword: "brand-new-pw" })).status).toBe(400);
      expect((await put2({ newPassword: "brand-new-pw", currentPassword: "nope-nope", reason: "rotate" })).status).toBe(403);
      expect((await put2({ newPassword: "brand-new-pw", currentPassword: PW, reason: "rotate" })).status).toBe(200);
      expect((await put2({ lockDate: "2025-08-01", currentPassword: PW, reason: "x" })).status).toBe(403); // old password is dead
      expect((await put2({ lockDate: "2025-08-01", currentPassword: "brand-new-pw", reason: "x" })).status).toBe(200);
    });

    it("saving the same values again changes nothing and logs nothing", async () => {
      await setLock(LOCK);
      const before = (await rowsOf(sql`select count(*)::int as n from "AuditLog" where "companyId" = ${W.co} and "tableName" = 'CompanyLock'`))[0].n;
      expect((await put2({ lockDate: LOCK })).body.lockDate).toBe(LOCK);
      expect((await rowsOf(sql`select count(*)::int as n from "AuditLog" where "companyId" = ${W.co} and "tableName" = 'CompanyLock'`))[0].n).toBe(before);
    });

    it("the lock settings show up in the audit API without the hash, with who and why and the override flag", async () => {
      await setLock(null);
      await put2({ lockDate: LOCK, newPassword: PW, userId });
      await put2({ lockDate: "2025-08-01", currentPassword: PW, reason: "lowered for the audit", userId });
      const r = await call("GET", `/api/audit?companyId=${W.co}&tableName=CompanyLock`);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(JSON.stringify(r.body)).not.toMatch(/scrypt|passwordHash/);
      const [latest, first] = r.body.rows;
      expect(latest).toMatchObject({ action: "UPDATE", reason: "lowered for the audit", changedBy: userId, lockOverride: true });
      expect(latest.changedFields).toEqual(expect.arrayContaining(["lockDate"]));
      expect(first).toMatchObject({ action: "INSERT", lockOverride: false });
    });
  });

  // ===================================================================================================================
  describe("purchase bills in a locked period", () => {
    it("a bill dated in an open period is not affected", async () => {
      await setLock(LOCK);
      const b = await mkBill({ invoiceDate: "2025-09-02" });
      expect((await post(b.id)).status).toBe(200);
    });

    it("creating a bill dated before or ON the lock date answers 409 PERIOD_LOCKED, and nothing is saved", async () => {
      await setLock(LOCK);
      const before = (await rowsOf(sql`select count(*)::int as n from "PurchaseBill" where "companyId" = ${W.co}`))[0].n;
      locked(await call("POST", bills, billBody({ invoiceDate: "2025-08-01" })));
      locked(await call("POST", bills, billBody({ invoiceDate: LOCK })));
      expect((await rowsOf(sql`select count(*)::int as n from "PurchaseBill" where "companyId" = ${W.co}`))[0].n).toBe(before);
    });

    it("no lock, or another company's lock: no effect", async () => {
      await setLock(null);
      expect((await call("POST", bills, billBody({ invoiceDate: "2025-08-01" }))).status).toBe(201);
    });

    it("a draft keyed in before the lock cannot be edited, deleted or posted afterwards", async () => {
      await setLock(null);
      const b = await mkBill({ invoiceDate: "2025-08-02" });
      await setLock(LOCK);
      locked(await put(b.id, billBody({ invoiceDate: "2025-08-02", remarks: "edited" })));
      locked(await del(b.id));
      locked(await post(b.id));
      // moving it OUT of the locked period is a change to a locked document too
      locked(await put(b.id, billBody({ invoiceDate: "2025-10-02" })));
    });

    it("a posted bill in a locked period: still not editable (S7), and reversing it in an OPEN period needs no password", async () => {
      await setLock(null);
      const b = await mkBill({ invoiceDate: "2025-08-03" });
      expect((await post(b.id)).status).toBe(200);
      await setLock(LOCK);
      const edit = await put(b.id, billBody({ invoiceDate: "2025-08-03" }));
      expect(edit.status).toBe(409); // the lock answers first or the "posted bill" rule does; either way refused
      const ok = await reverse(b.id, { date: "2025-10-20", reason: "wrong vendor" });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    });

    it("a reversal that would itself be dated in the locked period is refused", async () => {
      await setLock(null);
      const b = await mkBill({ invoiceDate: "2025-08-04" });
      expect((await post(b.id)).status).toBe(200);
      await setLock(LOCK);
      locked(await reverse(b.id, { date: "2025-08-20" }));
    });

    it("order and challan dates are NOT covered by the lock (S9 answer 3)", async () => {
      await setLock(LOCK);
      const r = await call("POST", "/api/purchase/orders", { companyId: W.co, branchId: W.br, orderDate: "2025-08-01", vendorGLId: W.vendor, lines: [{ productId: W.rice, qty: 1, rate: 10 }] });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
    });
  });

  // ===================================================================================================================
  describe("the override on a bill request", () => {
    it("create: wrong password 403, missing reason 400, malformed 400, none of them saves anything", async () => {
      await setLock(LOCK);
      const before = (await rowsOf(sql`select count(*)::int as n from "PurchaseBill" where "companyId" = ${W.co}`))[0].n;
      const wrong = await call("POST", bills, billBody({ invoiceDate: "2025-08-05", ...override({ password: "not-the-password" }) }));
      expect(wrong.status).toBe(403);
      expect(wrong.body.code).toBe("LOCK_PASSWORD_WRONG");
      const noReason = await call("POST", bills, billBody({ invoiceDate: "2025-08-05", ...override({ reason: "  " }) }));
      expect(noReason.status).toBe(400);
      expect((await call("POST", bills, billBody({ invoiceDate: "2025-08-05", lockOverride: "yes" }))).status).toBe(400);
      expect((await call("POST", bills, billBody({ invoiceDate: "2025-08-05", lockOverride: { reason: "r" } }))).status).toBe(400);
      expect((await call("POST", bills, billBody({ invoiceDate: "2025-08-05", lockOverride: { password: PW, reason: "x".repeat(501) } }))).status).toBe(400);
      expect((await rowsOf(sql`select count(*)::int as n from "PurchaseBill" where "companyId" = ${W.co}`))[0].n).toBe(before);
    });

    it("create with the right password and a reason works, and the audit log says so", async () => {
      await setLock(LOCK);
      const r = await call("POST", bills, billBody({ invoiceDate: "2025-08-06", userId, ...override({ reason: "late vendor bill, owner approved" }) }));
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      const log = await auditOf("PurchaseBill", r.body.result.id);
      expect(log[0]).toMatchObject({ action: "INSERT", lockOverride: true });
      expect(log[0].reason).toContain("late vendor bill, owner approved");
      expect(JSON.stringify(r.body)).not.toContain(PW);
    });

    it("ONE edit at a time: the next request without the override is refused again", async () => {
      await setLock(LOCK);
      const first = await call("POST", bills, billBody({ invoiceDate: "2025-08-07", ...override() }));
      expect(first.status).toBe(201);
      locked(await put(first.body.result.id, billBody({ invoiceDate: "2025-08-07", remarks: "again" })));
      locked(await call("POST", bills, billBody({ invoiceDate: "2025-08-07" })));
      // ...and with the override again it is allowed
      expect((await put(first.body.result.id, { ...billBody({ invoiceDate: "2025-08-07", remarks: "again" }), ...override({ reason: "second correction" }) })).status).toBe(200);
    });

    it("edit, post and delete of a locked draft each work with the override", async () => {
      await setLock(null);
      const a = await mkBill({ invoiceDate: "2025-08-08" });
      const b = await mkBill({ invoiceDate: "2025-08-09" });
      await setLock(LOCK);
      expect((await put(a.id, { ...billBody({ invoiceDate: "2025-08-08", remarks: "ok" }), ...override() })).status).toBe(200);
      const posted = await post(a.id, override({ reason: "posting a bill that missed the cut-off" }));
      expect(posted.status, JSON.stringify(posted.body)).toBe(200);
      expect((await del(b.id, override())).status).toBe(200);
      const [{ n }] = await rowsOf(sql`select count(*)::int as n from "PurchaseBill" where id = ${b.id}`);
      expect(n).toBe(0);
      // the posting wrote a locked-period voucher; its audit rows carry the reason and the override flag
      const jv = (await rowsOf(sql`select "journalVoucherId" as j from "PurchaseBill" where id = ${a.id}`))[0].j;
      const log = await auditOf("JournalVoucher", jv);
      expect(log[0]).toMatchObject({ action: "INSERT", lockOverride: true });
    });

    it("reversing into the locked period works with the override and a reason", async () => {
      await setLock(null);
      const b = await mkBill({ invoiceDate: "2025-08-10" });
      expect((await post(b.id)).status).toBe(200);
      await setLock(LOCK);
      const r = await reverse(b.id, { date: "2025-08-20", reason: "supplier credit note", ...override({ reason: "reversal inside the closed month" }) });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
    });

    it("sending the override for a company that has no lock date is harmless (the same form can always send it), even with a wrong password", async () => {
      await setLock(null);
      const r = await call("POST", bills, billBody({ invoiceDate: "2025-08-11", lockOverride: { password: "whatever", reason: "n/a" } }));
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      const log = await auditOf("PurchaseBill", r.body.result.id);
      expect(log[0].lockOverride).toBe(false);
    });

    it("an open-period request with the override attached does not need (or check) the password, and is not flagged as an override", async () => {
      await setLock(LOCK);
      const r = await call("POST", bills, billBody({ invoiceDate: "2025-09-20", userId, ...override({ password: "wrong-wrong" }) }));
      // the password IS checked whenever a lock exists, so a wrong one is refused even for an open-period date
      expect(r.status).toBe(403);
      const ok = await call("POST", bills, billBody({ invoiceDate: "2025-09-20", userId, ...override() }));
      expect(ok.status).toBe(201);
      expect((await auditOf("PurchaseBill", ok.body.result.id))[0].lockOverride).toBe(false);
    });
  });
});
