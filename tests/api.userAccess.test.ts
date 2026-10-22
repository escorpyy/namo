import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DB_READY, seededContext, startApi, uniq, type Res } from "./helpers";

// Users are global (not per company), unique by e-mail (case-insensitive, stored lower-case) and can never be deleted (their name stays in the audit trail).
// User Access = which user may work in which company, optionally limited to ONE branch, with a role.
// Rules: a user has EITHER one "all branches" row OR one row per branch in a company (never both, never the same branch twice);
// the branch must belong to the company; the user must exist. The same user can have access in several companies.
// Seed: Neeraj Sharma = ADMIN, all branches, in both companies; Sita Karki = ACCOUNTANT, head office only, company 1.
describe.skipIf(!DB_READY)("Users and User Access (API)", () => {
  let call: (m: string, p: string, b?: unknown) => Promise<Res>;
  let close: () => Promise<void>;
  let companyId = 0, otherCompanyId = 0, hoId = 0, br1Id = 0, otherBranchId = 0;
  let userA = 0, userB = 0;
  const createdUsers: number[] = [];
  const createdAccess: { id: number }[] = [];
  const tag = uniq();
  let wipeUsers: (ids: number[]) => Promise<void>;

  const users = async () => (await call("GET", "/api/masters/users")).body as any[];
  const access = async (cid = companyId) => (await call("GET", `/api/masters/user-access?companyId=${cid}`)).body as any[];
  const mineAccess = async (uid: number, cid = companyId) => (await access(cid)).filter((a) => a.userId === uid);
  const postUser = async (body: Record<string, unknown>) => {
    const r = await call("POST", "/api/masters/users", body);
    if (r.status === 201) createdUsers.push(r.body.id);
    return r;
  };
  const userBody = (over: Record<string, unknown> = {}) => ({ name: "Test User", email: `u${tag}@test.local`, calendarPreference: "BS", isActive: true, ...over });
  const post = async (body: Record<string, unknown>, cid = companyId) => {
    const r = await call("POST", `/api/masters/user-access?companyId=${cid}`, body);
    if (r.status === 201) createdAccess.push({ id: r.body.id });
    return r;
  };
  const put = (aid: number, body: Record<string, unknown>) => call("PUT", `/api/masters/user-access/${aid}`, body);
  const acc = (over: Record<string, unknown> = {}) => ({ userId: userA, branchId: null, role: "VIEWER", isActive: true, ...over });

  beforeAll(async () => {
    ({ call, close } = await startApi());
    ({ companyId, branchId: hoId } = (await seededContext(call)) as any);
    const ctx = (await call("GET", "/api/context")).body;
    const co = ctx.companies.find((c: any) => c.id === companyId);
    br1Id = co.branches.find((b: any) => !b.isHeadOffice).id;
    const other = ctx.companies.find((c: any) => c.id !== companyId);
    otherCompanyId = other.id;
    otherBranchId = other.branches[0].id;

    const a = await postUser(userBody({ name: `Alpha ${tag}`, email: `alpha${tag}@test.local` }));
    const b = await postUser(userBody({ name: `Beta ${tag}`, email: `beta${tag}@test.local` }));
    expect([a.status, b.status]).toEqual([201, 201]);
    userA = a.body.id;
    userB = b.body.id;

    const { db } = await import("../server/db");
    const { user, userCompanyAccess } = await import("../server/db/schema");
    const { inArray } = await import("drizzle-orm");
    wipeUsers = async (ids) => {
      await db.delete(userCompanyAccess).where(inArray(userCompanyAccess.userId, ids));
      await db.delete(user).where(inArray(user.id, ids)); // the API refuses to delete users, so test users are removed directly
    };
  });
  afterAll(async () => {
    await wipeUsers(createdUsers);
    await close();
  });

  describe("Users", () => {
    it("lists users without a company, sorted by name, with their access counts", async () => {
      const rows = await users();
      const names = rows.map((u) => u.name);
      expect(names).toEqual([...names].sort((x, y) => x.localeCompare(y)));
      const neeraj = rows.find((u) => u.email === "neeraj@namoerp.local");
      const sita = rows.find((u) => u.email === "sita@namoerp.local");
      expect([neeraj.accessCount, sita.accessCount]).toEqual([2, 1]);
    });

    it("creates a user: name trimmed, e-mail stored lower-case, calendar and active flag saved", async () => {
      const r = await postUser(userBody({ name: "  Mixed Case ", email: `MiXed${tag}@Test.Local`, calendarPreference: "AD", isActive: false }));
      expect(r.status).toBe(201);
      expect(r.body.name).toBe("Mixed Case");
      expect(r.body.email).toBe(`mixed${tag}@test.local`.toLowerCase());
      expect(r.body.calendarPreference).toBe("AD");
      expect(r.body.isActive).toBe(false);
      expect(r.body.accessCount).toBe(0);
    });

    it("validates input: missing name, bad e-mail, unknown calendar", async () => {
      const noName = await postUser(userBody({ email: `n1${tag}@test.local`, name: "" }));
      expect(noName.status).toBe(400);
      expect(noName.body.field).toBe("name");
      for (const email of ["not-an-email", "a@b", "@test.local", ""]) {
        const r = await postUser(userBody({ email }));
        expect(r.status, email).toBe(400);
        expect(r.body.field).toBe("email");
      }
      expect((await postUser(userBody({ email: `n2${tag}@test.local`, calendarPreference: "XX" }))).status).toBe(400);
    });

    it("the e-mail is unique across the system, case-insensitively", async () => {
      const dup = await postUser(userBody({ name: "Dup", email: `ALPHA${tag}@TEST.LOCAL` }));
      expect(dup.status).toBe(409);
      expect(dup.body.field).toBe("email");
      expect(dup.body.message).toMatch(/already exists in this system/);
      expect((await postUser(userBody({ email: "NEERAJ@namoerp.local" }))).status).toBe(409); // seeded
    });

    it("update: unknown id is 404; keeping its own e-mail is fine; taking another user's e-mail is 409; can be deactivated", async () => {
      expect((await call("PUT", "/api/masters/users/999999", userBody())).status).toBe(404);
      const same = await call("PUT", `/api/masters/users/${userA}`, userBody({ name: `Alpha ${tag} Renamed`, email: `alpha${tag}@test.local`, isActive: false }));
      expect(same.status).toBe(200);
      expect(same.body.name).toBe(`Alpha ${tag} Renamed`);
      expect(same.body.isActive).toBe(false);
      const clash = await call("PUT", `/api/masters/users/${userA}`, userBody({ email: `beta${tag}@test.local` }));
      expect(clash.status).toBe(409);
      expect(clash.body.field).toBe("email");
      expect((await call("PUT", `/api/masters/users/${userA}`, userBody({ name: `Alpha ${tag}`, email: `alpha${tag}@test.local` }))).status).toBe(200); // back to active
    });

    it("users cannot be deleted, not even without any access rows", async () => {
      const r = await call("DELETE", `/api/masters/users/${userB}`);
      expect(r.status).toBe(409);
      expect(r.body.message).toMatch(/cannot be deleted/);
      expect((await users()).some((u) => u.id === userB)).toBe(true);
    });
  });

  describe("User Access", () => {
    it("lists the access rows of one company with user and branch names, sorted by user name", async () => {
      expect((await call("GET", "/api/masters/user-access")).status).toBe(400);
      const rows = await access();
      const neeraj = rows.find((a) => a.userName === "Neeraj Sharma");
      expect([neeraj.role, neeraj.branchId, neeraj.branchName]).toEqual(["ADMIN", null, null]);
      const sita = rows.find((a) => a.userName === "Sita Karki");
      expect([sita.role, sita.branchId, sita.branchName]).toEqual(["ACCOUNTANT", hoId, "Main Branch"]);
      const names = rows.map((a) => a.userName);
      expect(names).toEqual([...names].sort((x, y) => x.localeCompare(y)));
      const other = await access(otherCompanyId);
      expect(other.map((a) => a.userName)).toEqual(["Neeraj Sharma"]); // Sita has no access to company 2
    });

    it("creates an all-branches row; a second all-branches row for the same user is 409", async () => {
      const r = await post(acc());
      expect(r.status).toBe(201);
      expect([r.body.userName, r.body.role, r.body.branchId, r.body.branchName]).toEqual([`Alpha ${tag}`, "VIEWER", null, null]);
      const dup = await post(acc({ role: "ADMIN" }));
      expect(dup.status).toBe(409);
      expect(dup.body.field).toBe("branchId");
      expect(dup.body.message).toMatch(/all branches/);
    });

    it("a user with an all-branches row cannot also get a single-branch row", async () => {
      const r = await post(acc({ branchId: hoId }));
      expect(r.status).toBe(409);
      expect(r.body.message).toMatch(/all branches/);
    });

    it("after the all-branches row is removed: one row per branch, never the same branch twice, and no all-branches row on top of them", async () => {
      const [all] = await mineAccess(userA);
      expect((await call("DELETE", `/api/masters/user-access/${all.id}`)).status).toBe(200);
      createdAccess.splice(createdAccess.findIndex((x) => x.id === all.id), 1);
      expect(await mineAccess(userA)).toEqual([]);

      const ho = await post(acc({ branchId: hoId, role: "ACCOUNTANT" }));
      expect(ho.status).toBe(201);
      expect([ho.body.branchId, ho.body.branchName]).toEqual([hoId, "Main Branch"]);
      const dup = await post(acc({ branchId: hoId }));
      expect(dup.status).toBe(409);
      expect(dup.body.message).toMatch(/already has access to this branch/);
      expect((await post(acc({ branchId: br1Id }))).status).toBe(201);
      const onTop = await post(acc());
      expect(onTop.status).toBe(409);
      expect(onTop.body.message).toMatch(/branch-specific access/);
    });

    it("update: keeping own user + branch while changing the role works; moving onto a branch already held is 409; widening to all branches is 409", async () => {
      const [ho, br1] = (await mineAccess(userA)).sort((x, y) => (x.branchId ?? 0) - (y.branchId ?? 0));
      expect(ho.branchId).toBe(hoId);
      const role = await put(ho.id, acc({ branchId: hoId, role: "ADMIN" }));
      expect(role.status).toBe(200);
      expect(role.body.role).toBe("ADMIN");
      const moved = await put(ho.id, acc({ branchId: br1.branchId }));
      expect(moved.status).toBe(409);
      expect(moved.body.message).toMatch(/already has access to this branch/);
      const widen = await put(ho.id, acc({ branchId: null }));
      expect(widen.status).toBe(409);
      expect(widen.body.message).toMatch(/branch-specific access/);
      expect((await put(999999, acc())).status).toBe(404);
      const unchanged = (await mineAccess(userA)).find((x) => x.id === ho.id);
      expect([unchanged.branchId, unchanged.role]).toEqual([hoId, "ADMIN"]); // failed updates changed nothing
    });

    it("the user must exist, the branch must belong to the company, the role must be known", async () => {
      const ghostUser = await post(acc({ userId: 999999 }));
      expect(ghostUser.status).toBe(400);
      expect(ghostUser.body.field).toBe("userId");
      const foreignBranch = await post(acc({ userId: userB, branchId: otherBranchId })); // company 2's branch used in company 1
      expect(foreignBranch.status).toBe(400);
      expect(foreignBranch.body.field).toBe("branchId");
      const ghostBranch = await post(acc({ userId: userB, branchId: 999999 }));
      expect(ghostBranch.status).toBe(400);
      expect(ghostBranch.body.field).toBe("branchId");
      expect((await post(acc({ userId: userB, role: "OWNER" }))).status).toBe(400);
      expect((await post({ userId: userB, branchId: null, isActive: true })).status).toBe(400); // role missing
      expect(await mineAccess(userB)).toEqual([]);
    });

    it("the same user can have access in several companies; each company lists only its own rows", async () => {
      const r = await post(acc({ userId: userB, role: "ACCOUNTANT" }));
      expect(r.status).toBe(201);
      const second = await post(acc({ userId: userB, branchId: otherBranchId }), otherCompanyId);
      expect(second.status).toBe(201);
      expect((await mineAccess(userB)).map((x) => x.branchId)).toEqual([null]);
      expect((await mineAccess(userB, otherCompanyId)).map((x) => x.branchId)).toEqual([otherBranchId]);
      expect(await post(acc({ userId: userB, branchId: hoId }), otherCompanyId)).toMatchObject({ status: 400 }); // company 1's branch used in company 2
    });

    it("an access row can be switched off without deleting it, and deleting rows updates the user's access count", async () => {
      const [row] = await mineAccess(userB);
      const off = await put(row.id, acc({ userId: userB, role: "ACCOUNTANT", isActive: false }));
      expect(off.status).toBe(200);
      expect(off.body.isActive).toBe(false);
      expect((await users()).find((u) => u.id === userB).accessCount).toBe(2);
      expect((await call("DELETE", `/api/masters/user-access/${row.id}`)).status).toBe(200);
      createdAccess.splice(createdAccess.findIndex((x) => x.id === row.id), 1);
      expect((await users()).find((u) => u.id === userB).accessCount).toBe(1);
      expect((await call("DELETE", "/api/masters/user-access/999999")).status).toBe(404);
    });
  });
});
