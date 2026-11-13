import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DB_READY, seededContext, startApi, uniq, type Res } from "./helpers";

// Journal voucher over HTTP: draft -> post -> reverse, the balance rule, cash/bank ledgers refused, party sub-ledger rules,
// numbering from the number series, posted-voucher edits needing a reason, and vouchers owned by other documents.
describe.skipIf(!DB_READY)("Journal Voucher (API)", () => {
  let call: (m: string, p: string, b?: unknown) => Promise<Res>;
  let close: () => Promise<void>;
  let companyId = 0, branchId = 0;
  let glA = 0, glB = 0, cashGl = 0, controlGl = 0, partyId = 0;
  let date = ""; // a day inside the seeded current fiscal year
  const created: number[] = [];

  const line = (generalLedgerId: number, debit: string, credit: string, narration = "test") => ({ generalLedgerId, debit, credit, narration });
  const body = (lines: unknown[], extra: Record<string, unknown> = {}) => ({ companyId, branchId, voucherDate: date, remarks: `jv test ${uniq()}`, lines, ...extra });
  const make = async (extra: Record<string, unknown> = {}) => {
    const r = await call("POST", "/api/journal-vouchers", body([line(glA, "100.00", ""), line(glB, "", "100.00")], extra));
    if (r.status === 201) created.push(r.body.result.id);
    return r;
  };

  beforeAll(async () => {
    ({ call, close } = await startApi());
    ({ companyId, branchId } = await seededContext(call));
    const lk = (await call("GET", `/api/journal-vouchers/lookups?companyId=${companyId}`)).body;
    const plain = lk.ledgers.filter((l: any) => l.isActive && !l.requiresSubLedger);
    expect(plain.length).toBeGreaterThanOrEqual(2);
    glA = plain[0].id; glB = plain[1].id;
    const fy = lk.fiscalYears.find((y: any) => y.isCurrent) ?? lk.fiscalYears[0];
    date = fy.startDate;
    const control = lk.ledgers.find((l: any) => l.isActive && l.requiresSubLedger && lk.subLedgers.some((s: any) => s.generalLedgerId === l.id && s.isActive));
    if (control) { controlGl = control.id; partyId = lk.subLedgers.find((s: any) => s.generalLedgerId === control.id && s.isActive).id; }
    const { db } = await import("../server/db");
    const { generalLedger } = await import("../server/db/schema");
    const { eq } = await import("drizzle-orm");
    const [cash] = await db.select({ id: generalLedger.id }).from(generalLedger).where(eq(generalLedger.isCashOrBank, true)).limit(1);
    cashGl = cash?.id ?? 0;
  });
  afterAll(async () => { await close(); });

  it("lookups leave cash and bank ledgers out", async () => {
    const lk = (await call("GET", `/api/journal-vouchers/lookups?companyId=${companyId}`)).body;
    expect(lk.ledgers.some((l: any) => l.id === cashGl)).toBe(false);
    expect(lk.fiscalYears.length).toBeGreaterThan(0);
  });

  it("refuses to save lines that do not balance (even as a draft), naming the difference", async () => {
    const r = await call("POST", "/api/journal-vouchers", body([line(glA, "100.00", ""), line(glB, "", "60.00")]));
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/does not balance.*40\.00/);
  });

  it("saves a draft with no lines, but will not post it", async () => {
    const r = await call("POST", "/api/journal-vouchers", body([]));
    expect(r.status).toBe(201);
    created.push(r.body.result.id);
    expect(r.body.document.state).toBe("DRAFT");
    const p = await call("POST", `/api/journal-vouchers/${r.body.result.id}/post?companyId=${companyId}`, {});
    expect(p.status).toBe(409);
    expect(p.body.message).toMatch(/at least two lines/);
  });

  it("numbers a new voucher and posts a balanced one", async () => {
    const r = await make();
    expect(r.status).toBe(201);
    expect(r.body.result.voucherNumber).toBeTruthy();
    const id = r.body.result.id;
    const p = await call("POST", `/api/journal-vouchers/${id}/post?companyId=${companyId}`, {});
    expect(p.status).toBe(200);
    expect(p.body.document.state).toBe("POSTED");
    expect(p.body.document.totalDebit).toBe("100.00");
    expect(p.body.document.lines).toHaveLength(2);
    expect((await call("POST", `/api/journal-vouchers/${id}/post?companyId=${companyId}`, {})).status).toBe(409);
  });

  it("refuses a line with both Dr and Cr, no amount, a negative amount, 3 decimals, or no ledger", async () => {
    const bad = [
      [line(glA, "10", "5"), line(glB, "", "5")],
      [line(glA, "", ""), line(glB, "", "5")].slice(1).concat([{ generalLedgerId: glA, debit: "", credit: "", narration: "x" }]),
      [line(glA, "-1", ""), line(glB, "", "1")],
      [line(glA, "1.005", ""), line(glB, "", "1")],
      [{ debit: "5", credit: "", narration: "no ledger" }],
    ];
    for (const lines of bad) expect((await call("POST", "/api/journal-vouchers", body(lines))).status, JSON.stringify(lines)).toBe(400);
  });

  it("refuses a cash/bank ledger", async () => {
    if (!cashGl) return;
    const r = await call("POST", "/api/journal-vouchers", body([line(cashGl, "10", ""), line(glB, "", "10")]));
    expect(r.status).toBe(409);
  });

  it("needs a party for a control ledger at post, and takes the party when given", async () => {
    if (!controlGl) return;
    const noParty = await call("POST", "/api/journal-vouchers", body([line(controlGl, "10", ""), line(glB, "", "10")]));
    expect(noParty.status).toBe(201);
    created.push(noParty.body.result.id);
    expect((await call("POST", `/api/journal-vouchers/${noParty.body.result.id}/post?companyId=${companyId}`, {})).status).toBe(409);
    const ok = await call("POST", "/api/journal-vouchers", body([{ ...line(controlGl, "10", ""), subLedgerId: partyId }, line(glB, "", "10")]));
    expect(ok.status).toBe(201);
    created.push(ok.body.result.id);
    expect(ok.body.document.lines[0].subLedgerId).toBe(partyId);
    // a party that belongs to another ledger is refused
    const wrong = await call("POST", "/api/journal-vouchers", body([{ ...line(glA, "10", ""), subLedgerId: partyId }, line(glB, "", "10")]));
    expect(wrong.status).toBe(400);
  });

  it("edits a draft freely, but a posted voucher only with a reason", async () => {
    const r = await make();
    const id = r.body.result.id;
    const edit = await call("PUT", `/api/journal-vouchers/${id}?companyId=${companyId}`, body([line(glA, "250.00", ""), line(glB, "", "250.00")]));
    expect(edit.status).toBe(200);
    expect(edit.body.document.totalDebit).toBe("250.00");
    await call("POST", `/api/journal-vouchers/${id}/post?companyId=${companyId}`, {});
    const noReason = await call("PUT", `/api/journal-vouchers/${id}?companyId=${companyId}`, body([line(glA, "300.00", ""), line(glB, "", "300.00")]));
    expect(noReason.status).toBe(400);
    const withReason = await call("PUT", `/api/journal-vouchers/${id}?companyId=${companyId}`, body([line(glA, "300.00", ""), line(glB, "", "300.00")], { reason: "typo in amount" }));
    expect(withReason.status).toBe(200);
    expect(withReason.body.document.totalDebit).toBe("300.00");
    // and a posted voucher cannot be saved unbalanced
    const unbalanced = await call("PUT", `/api/journal-vouchers/${id}?companyId=${companyId}`, body([line(glA, "300.00", ""), line(glB, "", "100.00")], { reason: "oops" }));
    expect(unbalanced.status).toBe(409);
  });

  it("deletes a draft; a posted one needs a reason", async () => {
    const d = (await make()).body.result.id;
    expect((await call("DELETE", `/api/journal-vouchers/${d}?companyId=${companyId}`)).status).toBe(200);
    expect((await call("GET", `/api/journal-vouchers/${d}?companyId=${companyId}`)).status).toBe(404);
    const p = (await make()).body.result.id;
    await call("POST", `/api/journal-vouchers/${p}/post?companyId=${companyId}`, {});
    expect((await call("DELETE", `/api/journal-vouchers/${p}?companyId=${companyId}`)).status).toBe(400);
    expect((await call("DELETE", `/api/journal-vouchers/${p}?companyId=${companyId}&reason=entered%20twice`)).status).toBe(200);
  });

  it("reverses a posted voucher once, with Dr and Cr swapped, and then locks the original", async () => {
    const id = (await make()).body.result.id;
    expect((await call("POST", `/api/journal-vouchers/${id}/reverse?companyId=${companyId}`, { reason: "x" })).status, "a draft cannot be reversed").toBe(409);
    await call("POST", `/api/journal-vouchers/${id}/post?companyId=${companyId}`, {});
    const rv = await call("POST", `/api/journal-vouchers/${id}/reverse?companyId=${companyId}`, { reason: "wrong month", date });
    expect(rv.status).toBe(200);
    created.push(rv.body.document.id);
    expect(rv.body.document.state).toBe("REVERSAL");
    expect(rv.body.document.lines[0].credit).toBe("100.00");
    expect(rv.body.document.lines[0].debit).toBe("0.00");
    const orig = (await call("GET", `/api/journal-vouchers/${id}?companyId=${companyId}`)).body;
    expect(orig.state).toBe("REVERSED");
    expect(orig.editable).toBe(false);
    expect((await call("POST", `/api/journal-vouchers/${id}/reverse?companyId=${companyId}`, { reason: "again" })).status).toBe(409);
    expect((await call("PUT", `/api/journal-vouchers/${id}?companyId=${companyId}`, body([line(glA, "1", ""), line(glB, "", "1")], { reason: "r" }))).status).toBe(409);
  });

  it("lists vouchers with state and totals, filtered by status and search", async () => {
    const mark = `LIST${uniq()}`;
    const id = (await make({ remarks: mark })).body.result.id;
    const all = (await call("GET", `/api/journal-vouchers?companyId=${companyId}&search=${mark}`)).body;
    expect(all.total).toBe(1);
    expect(all.rows[0]).toMatchObject({ id, state: "DRAFT", totalAmount: "100.00", lineCount: 2 });
    expect((await call("GET", `/api/journal-vouchers?companyId=${companyId}&status=POSTED&search=${mark}`)).body.total).toBe(0);
    expect((await call("GET", `/api/journal-vouchers?companyId=${companyId}&status=NOPE`)).status).toBe(400);
  });

  it("refuses other companies' ids and bad input", async () => {
    expect((await call("GET", `/api/journal-vouchers/999999?companyId=${companyId}`)).status).toBe(404);
    expect((await call("GET", `/api/journal-vouchers/abc?companyId=${companyId}`)).status).toBe(400);
    expect((await call("POST", "/api/journal-vouchers", { companyId, branchId, lines: [] })).status).toBe(400);
    expect((await call("POST", "/api/journal-vouchers", body([line(999999, "1", ""), line(glB, "", "1")]))).status).toBe(404);
  });

  it("does not let this screen change a voucher made by a purchase bill", async () => {
    const { db } = await import("../server/db");
    const { purchaseBill } = await import("../server/db/schema");
    const { isNotNull } = await import("drizzle-orm");
    const [b] = await db.select({ jv: purchaseBill.journalVoucherId }).from(purchaseBill).where(isNotNull(purchaseBill.journalVoucherId)).limit(1);
    if (!b?.jv) return; // the seed has no posted bill: nothing to check here
    const r = await call("POST", `/api/journal-vouchers/${b.jv}/reverse?companyId=${companyId}`, { reason: "x" });
    expect(r.status).toBe(409);
    expect((await call("GET", `/api/journal-vouchers/${b.jv}?companyId=${companyId}`)).body.source).toMatch(/Purchase bill/);
  });
});
