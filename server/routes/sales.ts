import { Router, type Request } from "express";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import * as S from "../db/schema";
import * as SI from "../services/salesInvoice";
import * as SC from "../services/salesChallan";
import { HttpError, wrap } from "./_util";
import { whole, optWhole, q, companyOf, idOf, lockOverrideOf, actorOf, pick, rows, type Kind } from "./_input";

export const salesRouter = Router();
const MAX_LINES = 500, MAX_TERMS = 100;
const LINE = { productId: "int", altQty: "num", altUnitId: "int", qty: "num", unitId: "int", rate: "num", foreignRate: "num", locationId: "int", batchNo: "str", expiryDate: "date", challanLineId: "int" } as const satisfies Record<string, Kind>;
const TERM = { termId: "int", lineNumber: "int", calcType: ["PERCENT", "AMOUNT"], rate: "num", inputAmount: "num", isOverridden: "bool", overrideAmount: "num" } as const satisfies Record<string, Kind>;
const HEAD = { invoiceNumber: "str", numberSeriesId: "int", invoiceDate: "date", invoiceType: ["LOCAL", "EXPORT"], salesType: ["GOODS_SALES", "SERVICE_SALES"], fiscalYear: "str", customerGLId: "int", subLedgerId: "int", agentId: "int", dueDays: "int", dueDate: "date", remarks: "str", salesChallanId: "int" } as const satisfies Record<string, Kind>;

const filterOf = (req: Request): SI.SalesListFilter => ({
  companyId: companyOf(req), branchId: optWhole(q(req, "branchId"), "branchId"), fiscalYear: q(req, "fiscalYear")?.slice(0, 15),
  customerGLId: optWhole(q(req, "customerGLId"), "customerGLId"), status: q(req, "status"), search: q(req, "search")?.slice(0, 60), limit: optWhole(q(req, "limit"), "limit"),
});
async function owned(id: number, companyId: number) {
  const [invoice] = await db.select({ id: S.salesInvoice.id, companyId: S.salesInvoice.companyId, branchId: S.salesInvoice.branchId }).from(S.salesInvoice)
    .where(and(eq(S.salesInvoice.id, id), eq(S.salesInvoice.companyId, companyId)));
  if (!invoice) throw new HttpError(404, "Sales invoice not found in this company.");
  return invoice;
}
// the export block is a flat object of strings and numbers; the service checks each field
function exportBlock(v: unknown) {
  if (v === null || v === undefined) return null;
  if (typeof v !== "object" || Array.isArray(v)) throw new HttpError(400, "exportDetail must be an object.", "exportDetail");
  const out: Record<string, string | number | null> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (x === null || x === undefined || x === "") continue;
    if (typeof x !== "string" && typeof x !== "number") throw new HttpError(400, `exportDetail.${k} must be text or a number.`, "exportDetail");
    out[k] = x;
  }
  return out;
}
const invoiceInput = (body: any, base: { companyId: number; branchId: number; id?: number }) => ({
  ...(pick(body, HEAD, "Sales invoice") as any),
  lines: rows(body?.lines, LINE, "lines", MAX_LINES, "Line") as any,
  terms: rows(body?.terms, TERM, "terms", MAX_TERMS, "Term") as any,
  exportDetail: exportBlock(body?.exportDetail),
  ...base,
});

salesRouter.get("/invoices/lookups", wrap(async (req, res) => {
  const companyId = companyOf(req), branchId = whole(q(req, "branchId"), "branchId"), actor = await actorOf(req);
  res.json(await SI.salesInvoiceLookups(companyId, branchId, actor.userId));
}));
salesRouter.get("/invoices", wrap(async (req, res) => { res.json(await SI.listSalesInvoices(filterOf(req))); }));
salesRouter.get("/invoices/:id", wrap(async (req, res) => { res.json(await SI.getSalesInvoice(idOf(req), companyOf(req))); }));

salesRouter.post("/invoices", wrap(async (req, res) => {
  const companyId = whole(req.body?.companyId ?? q(req, "companyId"), "companyId"), branchId = whole(req.body?.branchId, "branchId");
  const result = await SI.saveSalesInvoice(invoiceInput(req.body, { companyId, branchId }), await actorOf(req), { lockOverride: lockOverrideOf(req) });
  res.status(201).json({ result, document: await SI.getSalesInvoice(result.id, companyId) });
}));
salesRouter.put("/invoices/:id", wrap(async (req, res) => {
  const id = idOf(req), companyId = companyOf(req), invoice = await owned(id, companyId);
  const result = await SI.saveSalesInvoice(invoiceInput(req.body, { companyId, branchId: invoice.branchId, id }), await actorOf(req), { lockOverride: lockOverrideOf(req) });
  res.json({ result, document: await SI.getSalesInvoice(id, companyId) });
}));
salesRouter.delete("/invoices/:id", wrap(async (req, res) => {
  const id = idOf(req), companyId = companyOf(req);
  await owned(id, companyId);
  res.json({ result: await SI.deleteDraftSalesInvoice(id, companyId, await actorOf(req), { lockOverride: lockOverrideOf(req) }) });
}));
salesRouter.post("/invoices/:id/post", wrap(async (req, res) => {
  const id = idOf(req), companyId = companyOf(req);
  await owned(id, companyId);
  const result = await SI.postSalesInvoice(id, await actorOf(req), { lockOverride: lockOverrideOf(req) });
  res.json({ result, document: await SI.getSalesInvoice(id, companyId) });
}));
salesRouter.post("/invoices/:id/reverse", wrap(async (req, res) => {
  const id = idOf(req), companyId = companyOf(req);
  await owned(id, companyId);
  const body = pick(req.body ?? {}, { date: "date", reason: "str" }, "Reversal");
  const result = await SI.reverseSalesInvoice(id, await actorOf(req), { date: body.date as any, reason: body.reason?.trim(), lockOverride: lockOverrideOf(req) });
  res.json({ result, document: await SI.getSalesInvoice(result.id, companyId) });
}));

// ---- Challans (delivery notes): confirm takes the stock out; an invoice can bill one ----
const CLINE = { productId: "int", altQty: "num", altUnitId: "int", qty: "num", unitId: "int", rate: "num", locationId: "int", batchNo: "str", expiryDate: "date" } as const satisfies Record<string, Kind>;
const CHEAD = { challanNumber: "str", numberSeriesId: "int", challanDate: "date", fiscalYear: "str", customerGLId: "int", subLedgerId: "int", agentId: "int", transporterName: "str", vehicleNo: "str", lrNo: "str", lrDate: "date", remarks: "str" } as const satisfies Record<string, Kind>;
const challanInput = (body: any, base: { companyId: number; branchId: number; id?: number }) => ({
  ...(pick(body, CHEAD, "Sales challan") as any), lines: rows(body?.lines, CLINE, "lines", MAX_LINES, "Line") as any, ...base,
}) as SC.SalesChallanInput;
async function ownedChallan(id: number, companyId: number) {
  const [c] = await db.select({ id: S.salesChallan.id, branchId: S.salesChallan.branchId }).from(S.salesChallan).where(and(eq(S.salesChallan.id, id), eq(S.salesChallan.companyId, companyId)));
  if (!c) throw new HttpError(404, "Sales challan not found in this company.");
  return c;
}
salesRouter.get("/challans/lookups", wrap(async (req, res) => {
  const companyId = companyOf(req), branchId = whole(q(req, "branchId"), "branchId"), actor = await actorOf(req);
  const look = await SI.salesInvoiceLookups(companyId, branchId, actor.userId);
  const { usableSeries } = await import("../services/numberSeries");
  const series = await usableSeries(db as any, companyId, "SALES_CHALLAN", actor.userId, branchId);
  res.json({ ...look, series: series.map((s) => ({ id: s.id, name: s.name, mode: s.mode, isDefault: s.isDefault })) });
}));
salesRouter.get("/challans", wrap(async (req, res) => {
  res.json(await SC.listSalesChallans({ companyId: companyOf(req), branchId: optWhole(q(req, "branchId"), "branchId"), fiscalYear: q(req, "fiscalYear")?.slice(0, 15),
    customerGLId: optWhole(q(req, "customerGLId"), "customerGLId"), status: q(req, "status"), search: q(req, "search")?.slice(0, 60), limit: optWhole(q(req, "limit"), "limit") }));
}));
salesRouter.get("/challans/:id", wrap(async (req, res) => { res.json(await SC.getSalesChallan(idOf(req), companyOf(req))); }));
salesRouter.post("/challans", wrap(async (req, res) => {
  const companyId = whole(req.body?.companyId ?? q(req, "companyId"), "companyId"), branchId = whole(req.body?.branchId, "branchId");
  const result = await SC.saveSalesChallan(challanInput(req.body, { companyId, branchId }), await actorOf(req));
  res.status(201).json({ result, document: await SC.getSalesChallan(result.id, companyId) });
}));
salesRouter.put("/challans/:id", wrap(async (req, res) => {
  const id = idOf(req), companyId = companyOf(req), c = await ownedChallan(id, companyId);
  const result = await SC.saveSalesChallan(challanInput(req.body, { companyId, branchId: c.branchId, id }), await actorOf(req));
  res.json({ result, document: await SC.getSalesChallan(id, companyId) });
}));
salesRouter.delete("/challans/:id", wrap(async (req, res) => {
  const id = idOf(req); await ownedChallan(id, companyOf(req));
  res.json({ result: await SC.deleteSalesChallan(id, await actorOf(req)) });
}));
salesRouter.post("/challans/:id/confirm", wrap(async (req, res) => {
  const id = idOf(req), companyId = companyOf(req); await ownedChallan(id, companyId);
  const result = await SC.confirmSalesChallan(id, await actorOf(req));
  res.json({ result, document: await SC.getSalesChallan(id, companyId) });
}));
// A ready-to-edit invoice draft body for the still-unbilled part of a confirmed challan (nothing is saved).
salesRouter.get("/invoices/from-challan/:challanId", wrap(async (req, res) => {
  const companyId = companyOf(req), c = await SC.getSalesChallan(whole(req.params.challanId, "challanId"), companyId);
  if (!c.isConfirmed) throw new HttpError(409, `Challan ${c.challanNumber} is not confirmed; only delivered goods can be billed.`);
  res.json({
    salesChallanId: c.id, challanNumber: c.challanNumber, customerGLId: c.customerGLId, subLedgerId: c.subLedgerId, agentId: c.agentId, branchId: c.branchId,
    lines: c.lines.filter((l) => Number(l.pendingQty) > 0).map((l) => ({ challanLineId: l.id, productId: l.productId, qty: l.pendingQty, unitId: l.unitId, rate: l.rate, locationId: l.locationId, batchNo: l.batchNo, expiryDate: l.expiryDate })),
  });
}));
