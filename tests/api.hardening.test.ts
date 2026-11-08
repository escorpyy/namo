import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DB_READY, startApi, uniq, type Res } from "./helpers";

// Audit fixes (2026-11-08): edit/delete by id must respect the company in the URL, bad ids and bad bodies must answer 4xx (not 500),
// and CORS is off unless CORS_ORIGIN lists an origin. NOTE: the company check is a consistency guard, not access control (no login yet, ERP-002).
describe.skipIf(!DB_READY)("API hardening", () => {
  let call: (m: string, p: string, b?: unknown) => Promise<Res>;
  let close: () => Promise<void>;
  let base = "";
  let coA = 0, coB = 0;
  const created: number[] = [];

  beforeAll(async () => {
    ({ call, close } = await startApi());
    const ctx = (await call("GET", "/api/context")).body;
    coA = ctx.companies[0].id;
    coB = ctx.companies[1].id;
    // startApi hides its base URL, so ask the same app on its own port for the raw-body and header checks
    const { app } = await import("../server/app");
    const s: any = await new Promise((r) => { const x = app.listen(0, () => r(x)); });
    base = `http://127.0.0.1:${s.address().port}`;
    (globalThis as any).__hardeningServer = s;
  });
  afterAll(async () => {
    for (const id of created) await call("DELETE", `/api/masters/branches/${id}?companyId=${coA}`);
    await new Promise<void>((r) => (globalThis as any).__hardeningServer.close(() => r()));
    await close();
  });

  const branch = (name: string) => ({ code: `H${uniq()}`, name, isHeadOffice: false, isActive: true });
  const make = async (name = "Hardening branch") => {
    const r = await call("POST", `/api/masters/branches?companyId=${coA}`, branch(name));
    expect(r.status).toBe(201);
    created.push(r.body.id);
    return r.body;
  };

  it("PUT with another company's id is 404 and changes nothing", async () => {
    const b = await make("Original");
    const r = await call("PUT", `/api/masters/branches/${b.id}?companyId=${coB}`, { ...branch("HACKED"), code: b.code });
    expect(r.status).toBe(404);
    const list = (await call("GET", `/api/masters/branches?companyId=${coA}`)).body;
    expect(list.find((x: any) => x.id === b.id).name).toBe("Original");
  });

  it("PUT with the right company works, and so does PUT with no companyId (older callers)", async () => {
    const b = await make("Before");
    expect((await call("PUT", `/api/masters/branches/${b.id}?companyId=${coA}`, { ...branch("After"), code: b.code })).status).toBe(200);
    expect((await call("PUT", `/api/masters/branches/${b.id}`, { ...branch("After 2"), code: b.code })).status).toBe(200);
  });

  it("DELETE with another company's id is 404 and the record stays", async () => {
    const b = await make();
    expect((await call("DELETE", `/api/masters/branches/${b.id}?companyId=${coB}`)).status).toBe(404);
    expect((await call("GET", `/api/masters/branches?companyId=${coA}`)).body.some((x: any) => x.id === b.id)).toBe(true);
    expect((await call("DELETE", `/api/masters/branches/${b.id}?companyId=${coA}`)).status).toBe(200);
  });

  it.each(["abc", "1.5", "-3", "0", "99999999999", "1e3"])("a non-numeric or out-of-range id %s is 404, not 500", async (id) => {
    expect((await call("PUT", `/api/masters/branches/${id}?companyId=${coA}`, {})).status).toBe(404);
    expect((await call("DELETE", `/api/masters/branches/${id}?companyId=${coA}`)).status).toBe(404);
    expect((await call("DELETE", `/api/masters/products/${id}?companyId=${coA}`)).status).toBe(404);
    expect((await call("DELETE", `/api/masters/party/${id}?companyId=${coA}`)).status).toBe(404);
  });

  it("malformed JSON is 400 and an oversize body is 413 (not 500)", async () => {
    const bad = await fetch(`${base}/api/masters/branches?companyId=${coA}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{bad" });
    expect(bad.status).toBe(400);
    expect((await bad.json()).message).toMatch(/not valid JSON/);
    const big = await fetch(`${base}/api/masters/branches?companyId=${coA}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ a: "x".repeat(6 * 1024 * 1024) }) });
    expect(big.status).toBe(413);
  });

  it("sends no CORS header by default", async () => {
    const r = await fetch(`${base}/api/health`, { headers: { Origin: "http://evil.example" } });
    expect(r.headers.get("access-control-allow-origin")).toBeNull();
  });
});
