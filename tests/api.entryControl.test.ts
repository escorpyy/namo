import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DB_READY, seededContext, startApi, uniq, type Res } from "./helpers";

// Entry Control is a company setting: what a source module shows and what it insists on. Saved per company, defaults when nothing is saved,
// and a feature set Mandatory is enforced by the server (a hidden one is never mandatory).
describe.skipIf(!DB_READY)("Entry Control (API)", () => {
  let call: (m: string, p: string, b?: unknown) => Promise<Res>;
  let close: () => Promise<void>;
  let companyId = 0, branchId = 0, from = "", glA = 0, glB = 0;
  const tag = uniq();

  const put = (controls: unknown) => call("PUT", "/api/entry-control", { companyId, controls });
  const journal = (remarks: string, narration = "n") => call("POST", "/api/journal-vouchers", { companyId, branchId, voucherDate: from, remarks, lines: [
    { generalLedgerId: glA, debit: "10.00", credit: "", narration }, { generalLedgerId: glB, debit: "", credit: "10.00", narration }] });

  beforeAll(async () => {
    ({ call, close } = await startApi());
    let fyId = 0;
    ({ companyId, branchId, fyId } = await seededContext(call));
    const ctx = (await call("GET", "/api/context")).body;
    from = ctx.companies.find((c: any) => c.id === companyId).fiscalYears.find((y: any) => y.id === fyId).startDate;
    const subs = (await call("GET", `/api/masters/account-sub-groups?companyId=${companyId}`)).body as any[];
    const mk = async (s: string) => {
      const r = await call("POST", `/api/masters/general-ledger?companyId=${companyId}`, { code: `EC${s}${tag}`, name: `Entry control ${s}`, accountGroupId: subs[0].accountGroupId, accountSubGroupId: subs[0].id, normalBalance: "DEBIT", glType: "OTHER", isActive: true, isCashOrBank: false, postsToCashBook: false, requiresSubLedger: false, allowDocAdjust: false });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      return r.body.id as number;
    };
    glA = await mk("A"); glB = await mk("B");
  });
  afterAll(async () => {
    await put({ JOURNAL_VOUCHER: { remarks: { show: true, mandatory: false }, lineNarration: { show: true, mandatory: false } } });
    await close();
  });

  it("lists the modules and answers defaults when nothing is saved", async () => {
    const r = await call("GET", `/api/entry-control?companyId=${companyId}`);
    expect(r.status).toBe(200);
    expect(r.body.modules.map((m: any) => m.key)).toEqual(["CASH_BANK_VOUCHER", "JOURNAL_VOUCHER"]);
    expect(r.body.controls.JOURNAL_VOUCHER.remarks).toMatchObject({ show: true, mandatory: false });
  });

  it("refuses a bad value and ignores unknown features", async () => {
    expect((await put({ JOURNAL_VOUCHER: { remarks: { mandatory: "yes" } } })).status).toBe(400);
    expect((await put({ JOURNAL_VOUCHER: { remarks: { rule: "MAYBE" } } })).status).toBe(400);
    expect((await put({ JOURNAL_VOUCHER: { noSuchFeature: { show: false } } })).status).toBe(200);
  });

  it("a mandatory remarks / narration is enforced by the server; a hidden feature is never mandatory", async () => {
    const saved = await put({ JOURNAL_VOUCHER: { remarks: { show: true, mandatory: true }, lineNarration: { show: true, mandatory: true } } });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.controls.JOURNAL_VOUCHER.remarks.mandatory).toBe(true);
    const blank = await journal("");
    expect(blank.status).toBe(409);
    expect(blank.body.field).toBe("remarks");
    expect((await journal("ok", "")).status).toBe(409);
    expect((await journal(`ok ${tag}`)).status).toBe(201);
    const hidden = await put({ JOURNAL_VOUCHER: { remarks: { show: false, mandatory: true } } });
    expect(hidden.body.controls.JOURNAL_VOUCHER.remarks).toMatchObject({ show: false, mandatory: false });
  });

  it("applies to a cash / bank voucher too", async () => {
    await put({ CASH_BANK_VOUCHER: { remarks: { show: true, mandatory: true } } });
    const r = await call("POST", "/api/cash-bank-vouchers", { companyId, branchId, voucherDate: from, cashBankLedgerId: glA, remarks: "", lines: [{ generalLedgerId: glB, receipt: "5.00", payment: "", narration: "x" }] });
    expect(r.status).toBe(409);
    expect(r.body.field).toBe("remarks");
    await put({ CASH_BANK_VOUCHER: { remarks: { show: true, mandatory: false } } });
  });
});
