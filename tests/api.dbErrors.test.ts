import { beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { DB_READY } from "./helpers";

// ERP-018: a rule the DATABASE refuses (unique / foreign key / check or trigger) must reach the client as a clear HTTP 409,
// and nothing else may leak SQL text. drizzle-orm 0.44 wraps every database error in a DrizzleQueryError whose own `code`
// is undefined: the Postgres code and the clean message live on `.cause`.
//
// These tests feed REAL errors, produced by the real driver against the real test database, through the real error handler.
// Each statement is a single DO block, so Postgres rolls it back as a whole: nothing is left in the database.
describe.skipIf(!DB_READY)("database errors reach the client as clear answers (ERP-018)", () => {
  let db: any;
  let errorHandler: (err: unknown, req: any, res: any, next: any) => unknown;
  let pgError: (e: unknown) => { code: string; message: string } | null;

  beforeAll(async () => {
    ({ db } = await import("../server/db"));
    ({ errorHandler } = await import("../server/app"));
    ({ pgError } = await import("../server/routes/_util"));
  });

  // What the database really throws for `statement`, as it arrives at the handler.
  const realError = async (statement: ReturnType<typeof sql>) => {
    try {
      await db.execute(statement);
    } catch (e) {
      return e;
    }
    throw new Error("the statement was expected to fail");
  };

  // Run the handler the way Express does, and capture the answer.
  const answer = (err: unknown, method = "GET") => {
    let status = 0;
    let body: any;
    const res = { status(n: number) { status = n; return this; }, json(b: unknown) { body = b; return this; } };
    errorHandler(err, { method }, res, () => {});
    return { status, body };
  };
  const noSql = (b: any) => {
    expect(String(b.message)).not.toMatch(/Failed query|params:|select |insert |update |delete from/i);
  };

  const duplicate = sql`do $$ begin
    create temp table _e18_u(a int primary key);
    insert into _e18_u values (1);
    insert into _e18_u values (1);
  end $$`;
  const orphanInsert = sql`do $$ begin
    create temp table _e18_p(id int primary key);
    create temp table _e18_c(pid int references _e18_p(id));
    insert into _e18_c values (9);
  end $$`;
  const deleteInUse = sql`do $$ begin
    create temp table _e18_p(id int primary key);
    create temp table _e18_c(pid int references _e18_p(id));
    insert into _e18_p values (1);
    insert into _e18_c values (1);
    delete from _e18_p where id = 1;
  end $$`;
  // The same way our company-integrity triggers refuse a row (ERRCODE check_violation = 23514).
  const triggerRefusal = sql`do $$ begin
    raise exception 'Ledger belongs to another company than its group.' using errcode = 'check_violation';
  end $$`;
  const otherDbError = sql`select 1 / 0`;

  describe("the handler", () => {
    it("a duplicate value answers 409, without SQL text", async () => {
      const r = answer(await realError(duplicate), "POST");
      expect(r.status).toBe(409);
      expect(r.body.message).toBe("Duplicate value: code or description already exists.");
      noSql(r.body);
    });

    it("deleting a record that is in use answers 409 \"used elsewhere\"", async () => {
      const r = answer(await realError(deleteInUse), "DELETE");
      expect(r.status).toBe(409);
      expect(r.body.message).toBe("Cannot delete: this record is used elsewhere.");
      noSql(r.body);
    });

    it("saving a row that points at a record that does not exist answers 409, and does NOT say \"cannot delete\"", async () => {
      const r = answer(await realError(orphanInsert), "POST");
      expect(r.status).toBe(409);
      expect(r.body.message).toMatch(/linked record/i);
      expect(r.body.message).not.toMatch(/delete/i);
      noSql(r.body);
    });

    it("a rule refused by a database trigger answers 409 with the rule's own message, not the SQL", async () => {
      const r = answer(await realError(triggerRefusal), "PUT");
      expect(r.status).toBe(409);
      expect(r.body.message).toBe("Ledger belongs to another company than its group.");
      noSql(r.body);
    });

    it("any other database error answers a generic 500: nothing from the database or the SQL reaches the client, but it is logged", async () => {
      const err = await realError(otherDbError);
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const r = answer(err);
        expect(r.status).toBe(500);
        expect(r.body).toEqual({ message: "Server error" });
        expect(JSON.stringify(r.body)).not.toMatch(/division|Failed query|select/i);
        expect(log).toHaveBeenCalledWith(err); // the details stay in the server log
      } finally {
        log.mockRestore();
      }
    });

    it("a non-database failure (lost connection, programming error) answers the same generic 500", () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const refused = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" });
        for (const e of [refused, new TypeError("Cannot read properties of undefined (reading 'x')")]) {
          expect(answer(e)).toEqual({ status: 500, body: { message: "Server error" } });
        }
      } finally {
        log.mockRestore();
      }
    });

    it("an error that only LOOKS like a constraint code is not treated as a database error", () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const lookalike = Object.assign(new Error("not from Postgres"), { code: "23505" });
        expect(answer(lookalike).status).toBe(500);
      } finally {
        log.mockRestore();
      }
    });

    it("a deliberate HttpError keeps its status, message and field", async () => {
      const { HttpError } = await import("../server/routes/_util");
      expect(answer(new HttpError(409, "Fiscal year 2082/83 is closed.", "fiscalYear"))).toEqual({
        status: 409,
        body: { message: "Fiscal year 2082/83 is closed.", field: "fiscalYear" },
      });
    });
  });

  describe("finding the Postgres error", () => {
    it("reads the code and clean message from .cause of drizzle's wrapper, which has no code of its own", async () => {
      const wrapped: any = await realError(duplicate);
      expect(wrapped.code).toBeUndefined();
      const pg = pgError(wrapped);
      expect(pg?.code).toBe("23505");
      expect(pg?.message).not.toMatch(/Failed query/);
    });

    it("finds an unwrapped Postgres error and ignores things that are not one", async () => {
      const wrapped: any = await realError(triggerRefusal);
      expect(pgError(wrapped.cause)?.code).toBe("23514");
      for (const v of [null, undefined, "boom", 42, {}, new Error("x"), Object.assign(new Error("x"), { code: "23505" })]) {
        expect(pgError(v)).toBeNull();
      }
    });
  });
});
