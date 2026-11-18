import { Router } from "express";
import * as V from "../services/cashBankVoucher";
import { db } from "../db";
import { ageingReport, advanceTotal, applicationsOf, applyAdvancesFor, openAdvances, openDocuments, outstandingTotal, undoApplicationFor, type SettlementKind } from "../services/billSettlement";
import { INSTRUMENTS, MAX_ENTRY_LINES } from "../../shared/cashBankVoucher";
import { HttpError, idParam, wrap } from "./_util";
import { actorOf, companyOf, lockOverrideOf, pick, q, rows, whole, optWhole, type Kind } from "./_input";

// Cash / Bank Voucher over HTTP (ERP-006). These routes only check what the HTTP layer must (ids are whole numbers, the voucher belongs to the
// company in the URL, field types are what the service expects) and then call the service, which owns every business rule.
//
//   GET    /api/cash-bank-vouchers/lookups?companyId=
//   GET    /api/cash-bank-vouchers/balance?companyId=&branchId=&fiscalYear=&generalLedgerId=&date=&excludeId=
//   GET    /api/cash-bank-vouchers/open-documents?companyId=&kind=SALES_INVOICE|PURCHASE_BILL&generalLedgerId=&all=1   unpaid invoices / bills of one account
//   GET    /api/cash-bank-vouchers?companyId=&branchId=&fiscalYear=&status=&search=&limit=
//   GET    /api/cash-bank-vouchers/:id?companyId=
//   POST   /api/cash-bank-vouchers                 body: companyId, branchId, ...fields, lines, post?   (post: true saves and posts in one go)
//   PUT    /api/cash-bank-vouchers/:id?companyId=  a draft only; company and branch cannot change
//   DELETE /api/cash-bank-vouchers/:id?companyId=  a draft only
//   POST   /api/cash-bank-vouchers/:id/post        POST /api/cash-bank-vouchers/:id/reverse   body: date?, reason?
//
// Writes are refused with 409 and code PERIOD_LOCKED when the voucher is dated on or before the company lock date (ERP-025); the body may carry
// `lockOverride: { password, reason }` for that one request. Every write answers { result, document } like the purchase routes.
// There is no login yet (ERP-002): the acting user comes from `userId` (body or query) and must be an active user; none = recorded as nobody.

export const cashBankVoucherRouter = Router();

const HEAD = {
  fiscalYear: "str", voucherDate: "date", cashBankLedgerId: "int", cashBankSubLedgerId: "int", instrumentType: INSTRUMENTS.map((i) => i.value) as string[], chequeNumber: "str", chequeDate: "date", payeeReference: "str", remarks: "str",
} as const satisfies Record<string, Kind>;
const SETTLEMENT = { kind: ["SALES_INVOICE", "PURCHASE_BILL"] as string[], documentId: "int", amount: "num" } as const satisfies Record<string, Kind>;
const LINE = { generalLedgerId: "int", subLedgerId: "int", receipt: "num", payment: "num", narration: "str" } as const satisfies Record<string, Kind>;

function inputOf(body: unknown, companyId: number, branchId: number): V.VoucherInput {
  const head = pick(body, HEAD, "Voucher");
  const lines = rows((body as any)?.lines, LINE, "lines", MAX_ENTRY_LINES, "Line");
  const settlements = rows((body as any)?.settlements, SETTLEMENT, "settlements", 200, "Settlement");
  return { ...head, companyId, branchId, lines, settlements } as V.VoucherInput;
}

const asWrite = async (result: { id: number } & Record<string, unknown>, companyId: number) => ({ result, document: await V.getVoucher(result.id, companyId) });

cashBankVoucherRouter.get("/lookups", wrap(async (req, res) => {
  res.json(await V.voucherLookups(companyOf(req)));
}));

cashBankVoucherRouter.get("/open-documents", wrap(async (req, res) => {
  const kind = q(req, "kind");
  if (kind !== "SALES_INVOICE" && kind !== "PURCHASE_BILL") throw new HttpError(400, "kind must be SALES_INVOICE or PURCHASE_BILL.", "kind");
  const o = { companyId: companyOf(req), kind: kind as SettlementKind, generalLedgerId: whole(q(req, "generalLedgerId"), "generalLedgerId"), all: q(req, "all") === "1" };
  const rowsOut = await openDocuments(db, o);
  res.json({ rows: rowsOut, ...(await outstandingTotal(db, o)) });
}));

const kindOf = (v: unknown): SettlementKind => {
  if (v !== "SALES_INVOICE" && v !== "PURCHASE_BILL") throw new HttpError(400, "kind must be SALES_INVOICE or PURCHASE_BILL.", "kind");
  return v;
};

cashBankVoucherRouter.get("/ageing", wrap(async (req, res) => {
  res.json(await ageingReport(db, { companyId: companyOf(req), kind: kindOf(q(req, "kind")), asOf: q(req, "asOf") || undefined }));
}));

// Advances (receipts / payments not fully settled against bills) of one account, and what has been applied to one document.
cashBankVoucherRouter.get("/advances", wrap(async (req, res) => {
  const o = { companyId: companyOf(req), kind: kindOf(q(req, "kind")), generalLedgerId: whole(q(req, "generalLedgerId"), "generalLedgerId") };
  res.json({ rows: await openAdvances(db, o), ...(await advanceTotal(db, o)) });
}));
cashBankVoucherRouter.get("/advances/applications", wrap(async (req, res) => {
  companyOf(req);
  res.json({ rows: await applicationsOf(db, { kind: kindOf(q(req, "kind")), documentId: whole(q(req, "documentId"), "documentId") }) });
}));
cashBankVoucherRouter.post("/advances/apply", wrap(async (req, res) => {
  const companyId = companyOf(req), b = (req.body ?? {}) as Record<string, unknown>;
  const items = rows(b.items, { voucherId: "int", amount: "num" } as const satisfies Record<string, Kind>, "items", 50, "Advance");
  res.json(await applyAdvancesFor(await actorOf(req), { companyId, kind: kindOf(b.kind), documentId: whole(String(b.documentId ?? ""), "documentId"), date: String(b.date ?? ""), items: items as { voucherId: number; amount: unknown }[], lockOverride: lockOverrideOf(req) }));
}));
cashBankVoucherRouter.post("/advances/applications/:id/undo", wrap(async (req, res) => {
  res.json(await undoApplicationFor(await actorOf(req), { companyId: companyOf(req), id: idParam(req.params.id, "Adjustment"), reason: String((req.body as any)?.reason ?? "") }));
}));

cashBankVoucherRouter.get("/balance", wrap(async (req, res) => {
  const date = q(req, "date");
  if (!date) throw new HttpError(400, "date is required.", "date");
  res.json(await V.balanceOf({
    companyId: companyOf(req), branchId: whole(q(req, "branchId"), "branchId"), fiscalYear: (q(req, "fiscalYear") ?? "").slice(0, 15), generalLedgerId: whole(q(req, "generalLedgerId"), "generalLedgerId"),
    asOf: date, excludeVoucherId: optWhole(q(req, "excludeId"), "excludeId") ?? null,
  }));
}));

cashBankVoucherRouter.get("/", wrap(async (req, res) => {
  res.json(await V.listVouchers({
    companyId: companyOf(req), branchId: optWhole(q(req, "branchId"), "branchId"), fiscalYear: q(req, "fiscalYear")?.slice(0, 15), status: q(req, "status"),
    search: q(req, "search")?.slice(0, 60), limit: optWhole(q(req, "limit"), "limit"),
  }));
}));

cashBankVoucherRouter.get("/:id", wrap(async (req, res) => {
  res.json(await V.getVoucher(idParam(req.params.id, "Voucher"), companyOf(req)));
}));

cashBankVoucherRouter.post("/", wrap(async (req, res) => {
  const companyId = whole(req.body?.companyId, "companyId"), branchId = whole(req.body?.branchId, "branchId");
  const result = await V.createVoucher(inputOf(req.body, companyId, branchId), await actorOf(req), { post: req.body?.post === true, lockOverride: lockOverrideOf(req) });
  res.status(201).json(await asWrite(result, companyId));
}));

cashBankVoucherRouter.put("/:id", wrap(async (req, res) => {
  const id = idParam(req.params.id, "Voucher"), companyId = companyOf(req);
  const result = await V.updateVoucher(id, inputOf(req.body, companyId, 0), await actorOf(req), { post: req.body?.post === true, lockOverride: lockOverrideOf(req) });
  res.json(await asWrite(result, companyId));
}));

cashBankVoucherRouter.delete("/:id", wrap(async (req, res) => {
  const id = idParam(req.params.id, "Voucher");
  res.json({ result: await V.deleteVoucher(id, companyOf(req), await actorOf(req), { lockOverride: lockOverrideOf(req) }) });
}));

cashBankVoucherRouter.post("/:id/post", wrap(async (req, res) => {
  const id = idParam(req.params.id, "Voucher"), companyId = companyOf(req);
  res.json(await asWrite(await V.postVoucher(id, companyId, await actorOf(req), { lockOverride: lockOverrideOf(req) }), companyId));
}));

cashBankVoucherRouter.post("/:id/reverse", wrap(async (req, res) => {
  const id = idParam(req.params.id, "Voucher"), companyId = companyOf(req);
  const date = typeof req.body?.date === "string" && req.body.date ? req.body.date : undefined;
  const reason = typeof req.body?.reason === "string" ? req.body.reason.slice(0, 500) : undefined;
  const result = await V.reverseVoucher(id, companyId, await actorOf(req), { date, reason, lockOverride: lockOverrideOf(req) });
  // the answer shows the ORIGINAL voucher (now reversed); the reversal's own id is in `result`
  res.json({ result, document: await V.getVoucher(id, companyId) });
}));
