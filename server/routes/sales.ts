import { Router, type Request } from "express";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import * as S from "../db/schema";
import * as SI from "../services/salesInvoice";
import { HttpError, wrap } from "./_util";
import { whole, optWhole, q, companyOf, idOf, lockOverrideOf, actorOf, pick, rows, type Kind } from "./_input";

export const salesRouter = Router();
const MAX_LINES = 500, MAX_TERMS = 100;
const LINE = { productId: "int", altQty: "num", altUnitId: "int", qty: "num", unitId: "int", rate: "num", foreignRate: "num", locationId: "int", batchNo: "str", expiryDate: "date" } as const satisfies Record<string, Kind>;
const TERM = { termId: "int", lineNumber: "int", calcType: ["PERCENT", "AMOUNT"], rate: "num", inputAmount: "num", isOverridden: "bool", overrideAmount: "num" } as const satisfies Record<string, Kind>;
const HEAD = { invoiceNumber: "str", numberSeriesId: "int", invoiceDate: "date", invoiceType: ["LOCAL", "EXPORT"], salesType: ["GOODS_SALES", "SERVICE_SALES"], fiscalYear: "str", customerGLId: "int", subLedgerId: "int", agentId: "int", dueDays: "int", dueDate: "date", remarks: "str" } as const satisfies Record<string, Kind>;

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
