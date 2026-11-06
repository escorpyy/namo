import { Router, type Request } from "express";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import * as S from "../db/schema";
import * as P from "../services/purchase";
import type { LockOverride } from "../services/periodLock";
import { HttpError, wrap } from "./_util";

// Purchase documents over HTTP: Order -> Challan -> Bill. These routes only check what the HTTP layer must (ids are whole numbers,
// the document belongs to the company in the URL, field types are what the service expects) and then call the service layer, which
// owns every business rule (pricing, quantity limits, posting, reversal). Nothing is calculated here.
//
//   GET    /api/purchase/lookups?companyId=
//   GET    /api/purchase/{orders|challans|bills}?companyId=&branchId=&fiscalYear=&status=&vendorGLId=&search=&limit=
//   GET    /api/purchase/{orders|challans|bills}/:id?companyId=
//   POST   /api/purchase/{orders|challans|bills}                 body: companyId, branchId, ...fields, lines, terms
//   PUT    /api/purchase/{orders|challans|bills}/:id?companyId=  a draft only; company and branch cannot change
//   DELETE /api/purchase/{orders|challans|bills}/:id?companyId=  a draft only
//   POST   /api/purchase/orders/:id/{approve|close|cancel}   POST /api/purchase/challans/:id/confirm
//   POST   /api/purchase/bills/:id/{post|reverse}            GET  /api/purchase/bills/from-challan/:challanId?companyId=
//
// A bill body with `mainBillId` (an "additional bill") is refused with 400: use a cost assessment or a linked service bill instead.
//
// Bill writes (create, edit, delete, post, reverse) are refused with 409 and code PERIOD_LOCKED when the document is dated on or before the
// company lock date (ERP-025, GET/PUT /api/period-lock). The body may carry `lockOverride: { password, reason }` to override that for this one
// request: 403 LOCK_PASSWORD_WRONG for a wrong password, 400 for a missing reason. Orders and challans are not covered by the lock.
//
// Every write answers { result, document }: what the service returned, and the whole document as it now stands.
// There is no login yet (ERP-002): the acting user comes from `userId` (body or query) and must be an active user; none = recorded as nobody.

export const purchaseRouter = Router();

// ---------- input helpers ----------
const MAX_LINES = 500, MAX_TERMS = 100;

function whole(v: unknown, name: string): number {
  const n = typeof v === "string" && /^\d{1,9}$/.test(v) ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n <= 0 || n > 2_000_000_000) throw new HttpError(400, `${name} is required.`, name);
  return n;
}
const optWhole = (v: unknown, name: string): number | undefined => (v === undefined || v === null || v === "" ? undefined : whole(v, name));
const q = (req: Request, name: string) => (typeof req.query[name] === "string" ? (req.query[name] as string) : undefined);
const companyOf = (req: Request) => whole(q(req, "companyId"), "companyId");
const idOf = (req: Request, name = "id") => whole(req.params[name], name);

// The optional { password, reason } that overrides the company lock date for ONE request (ERP-025). Only the shape is checked here;
// the service checks the password and the reason against the company's lock.
function lockOverrideOf(req: Request): LockOverride | undefined {
  const o = req.body?.lockOverride;
  if (o === undefined || o === null) return undefined;
  if (typeof o !== "object" || Array.isArray(o)) throw new HttpError(400, "lockOverride must be an object.", "lockOverride");
  const password = (o as any).password, reason = (o as any).reason;
  if (password !== undefined && password !== null && typeof password !== "string") throw new HttpError(400, "lockOverride.password must be a string.", "lockOverride.password");
  if (reason !== undefined && reason !== null && typeof reason !== "string") throw new HttpError(400, "lockOverride.reason must be a string.", "lockOverride.reason");
  return { password: typeof password === "string" ? password : undefined, reason: typeof reason === "string" ? reason : undefined };
}

async function actorOf(req: Request): Promise<{ userId: number | null }> {
  const raw = req.body?.userId ?? q(req, "userId");
  if (raw === undefined || raw === null || raw === "") return { userId: null };
  const userId = whole(raw, "userId");
  const [u] = await db.select({ id: S.User.id, isActive: S.User.isActive }).from(S.User).where(eq(S.User.id, userId)).limit(1);
  if (!u) throw new HttpError(400, "userId is not a known user.", "userId");
  if (!u.isActive) throw new HttpError(400, "userId is inactive.", "userId");
  return { userId };
}

async function owned(kind: "order" | "challan" | "bill", id: number, companyId: number) {
  const table = kind === "order" ? S.PurchaseOrder : kind === "challan" ? S.PurchaseChallan : S.PurchaseBill;
  const [row] = await db.select().from(table).where(and(eq(table.id, id), eq(table.companyId, companyId))).limit(1);
  if (!row) throw new HttpError(404, `${kind} ${id} not found for this company.`);
  return row as any;
}

type Kind = "str" | "int" | "date" | "bool" | readonly string[];
function pick(src: any, spec: Record<string, Kind>, label: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, kind] of Object.entries(spec)) {
    const v = src?.[k];
    if (v === undefined) continue;
    if (v === null || v === "") { out[k] = null; continue; }
    if (kind === "str") {
      if (typeof v !== "string") throw new HttpError(400, `${label}.${k} must be a string.`, k);
      out[k] = v;
    } else if (kind === "int") {
      out[k] = whole(v, `${label}.${k}`);
    } else if (kind === "date") {
      if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new HttpError(400, `${label}.${k} must be YYYY-MM-DD.`, k);
      out[k] = v;
    } else if (kind === "bool") {
      if (typeof v !== "boolean") throw new HttpError(400, `${label}.${k} must be a boolean.`, k);
      out[k] = v;
    } else if (Array.isArray(kind)) {
      if (typeof v !== "string" || !(kind as readonly string[]).includes(v)) throw new HttpError(400, `${label}.${k} must be one of ${(kind as readonly string[]).join(", ")}.`, k);
      out[k] = v;
    }
  }
  return out;
}
function rows<T>(raw: unknown, spec: Record<string, Kind>, name: string, max: number, label: string): T[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new HttpError(400, `${name} must be an array.`, name);
  if (raw.length > max) throw new HttpError(400, `${name} may have at most ${max} rows.`, name);
  return raw.map((r, i) => pick(r, spec, `${label}[${i}]`) as T);
}

const LINE = { productId: "int", qty: "str", rate: "str", unitId: "int", description: "str", remarks: "str" } as const satisfies Record<string, Kind>;
const TRACK = { batchNo: "str", serialNo: "str", expiryDate: "date", warehouseId: "int", godownId: "int", rackId: "int" } as const satisfies Record<string, Kind>;
const TERM = { termId: "int", calcType: ["PERCENT", "AMOUNT", "RATE"], rate: "str", inputAmount: "str", allocationBasis: ["VALUE", "QUANTITY"], capitalizable: "bool", againstLedgerId: "int", lineNumber: "int", remarks: "str" } as const satisfies Record<string, Kind>;

const ORDER_HEAD = {
  orderDate: "date", expectedDate: "date", purchaseType: "str", vendorGLId: "int", subLedgerId: "int", agentId: "int",
  vendorRefNo: "str", remarks: "str", dueDays: "int", dueDate: "date",
} as const satisfies Record<string, Kind>;
const orderInput = (b: any, base: { companyId: number; branchId: number; id?: number }): P.PurchaseOrderInput => ({
  ...(pick(b, ORDER_HEAD, "Order") as any),
  lines: rows(b?.lines, { ...LINE, ...TRACK }, "lines", MAX_LINES, "Line") as any,
  terms: rows(b?.terms, TERM, "terms", MAX_TERMS, "Term") as any,
  ...base,
});

const CHALLAN_HEAD = {
  challanDate: "date", purchaseType: "str", vendorGLId: "int", subLedgerId: "int", agentId: "int",
  vendorChallanNo: "str", vendorChallanDate: "date", purchaseOrderId: "int", remarks: "str",
} as const satisfies Record<string, Kind>;
const challanInput = (b: any, base: { companyId: number; branchId: number; id?: number }): P.PurchaseChallanInput => ({
  ...(pick(b, CHALLAN_HEAD, "Challan") as any),
  lines: rows(b?.lines, { ...LINE, ...TRACK, orderLineId: "int" }, "lines", MAX_LINES, "Line") as any,
  terms: rows(b?.terms, TERM, "terms", MAX_TERMS, "Term") as any,
  ...base,
});

const BILL_HEAD = {
  invoiceDate: "date", invoiceType: ["LOCAL", "IMPORT"], purchaseType: "str", vendorGLId: "int", subLedgerId: "int", agentId: "int",
  vendorInvoiceNo: "str", vendorInvoiceDate: "date", purchaseChallanId: "int", purchaseOrderId: "int", mainBillId: "int", importCostForBillId: "int",
  importCostAllocationBasis: ["VALUE", "QUANTITY"], importCostTreatment: ["CIF", "LANDED_ONLY"], dueDays: "int", dueDate: "date",
} as const satisfies Record<string, Kind>;
// Additional bills are retired. Customs, excise and similar charges are recorded with a cost assessment, and an agent's or freight company's
// invoice is a service bill linked to the goods bill (importCostForBillId). The service layer can still post and reverse any that already exist.
function refuseAdditionalBill(body: any) {
  const v = body?.mainBillId;
  if (v !== undefined && v !== null && v !== "") {
    throw new HttpError(400, "Additional bills are no longer entered. Record customs, excise and similar charges with a cost assessment, or enter the agent's or freight invoice as a service bill linked to the goods bill.", "mainBillId");
  }
}
const billInput = (b: any, base: { companyId: number; branchId: number; id?: number }): P.PurchaseBillInput => ({
  ...(pick(b, BILL_HEAD, "Bill") as any),
  lines: rows(b?.lines, { ...LINE, ...TRACK, challanLineId: "int", purchaseOrderLineId: "int" }, "lines", MAX_LINES, "Line") as any,
  terms: rows(b?.terms, TERM, "terms", MAX_TERMS, "Term") as any,
  importDetail: b?.importDetail ?? null,
  remarks: typeof b?.remarks === "string" ? b.remarks : null,
  ...base,
});

// ---------- routes ----------
purchaseRouter.get("/lookups", wrap(async (req, res) => { res.json(await P.getPurchaseLookups(companyOf(req))); }));

purchaseRouter.get("/orders", wrap(async (req, res) => { res.json(await P.listPurchaseOrders({ companyId: companyOf(req), branchId: optWhole(q(req, "branchId"), "branchId"), fiscalYear: q(req, "fiscalYear"), status: q(req, "status"), vendorGLId: optWhole(q(req, "vendorGLId"), "vendorGLId"), search: q(req, "search"), limit: optWhole(q(req, "limit"), "limit") })); }));
purchaseRouter.get("/orders/:id", wrap(async (req, res) => { res.json(await P.getPurchaseOrder(idOf(req), companyOf(req))); }));
purchaseRouter.post("/orders", wrap(async (req, res) => {
  const companyId = whole(req.body?.companyId ?? q(req, "companyId"), "companyId"), branchId = whole(req.body?.branchId, "branchId");
  const result = await P.savePurchaseOrder(orderInput(req.body, { companyId, branchId }), await actorOf(req));
  res.status(201).json({ result, document: await P.getPurchaseOrder(result.id, companyId) });
}));
purchaseRouter.put("/orders/:id", wrap(async (req, res) => {
  const id = idOf(req), companyId = companyOf(req), o = await owned("order", id, companyId);
  const result = await P.savePurchaseOrder(orderInput(req.body, { companyId, branchId: o.branchId, id }), await actorOf(req));
  res.json({ result, document: await P.getPurchaseOrder(id, companyId) });
}));
purchaseRouter.delete("/orders/:id", wrap(async (req, res) => {
  const id = idOf(req), companyId = companyOf(req); await owned("order", id, companyId);
  res.json(await P.deletePurchaseOrder(id, companyId, await actorOf(req)));
}));
purchaseRouter.post("/orders/:id/approve", wrap(async (req, res) => { const id = idOf(req), companyId = companyOf(req); await owned("order", id, companyId); res.json(await P.approvePurchaseOrder(id, companyId, await actorOf(req))); }));
purchaseRouter.post("/orders/:id/close", wrap(async (req, res) => { const id = idOf(req), companyId = companyOf(req); await owned("order", id, companyId); res.json(await P.closePurchaseOrder(id, companyId, await actorOf(req))); }));
purchaseRouter.post("/orders/:id/cancel", wrap(async (req, res) => { const id = idOf(req), companyId = companyOf(req); await owned("order", id, companyId); res.json(await P.cancelPurchaseOrder(id, companyId, await actorOf(req))); }));

purchaseRouter.get("/challans", wrap(async (req, res) => { res.json(await P.listPurchaseChallans({ companyId: companyOf(req), branchId: optWhole(q(req, "branchId"), "branchId"), fiscalYear: q(req, "fiscalYear"), status: q(req, "status"), vendorGLId: optWhole(q(req, "vendorGLId"), "vendorGLId"), search: q(req, "search"), limit: optWhole(q(req, "limit"), "limit") })); }));
purchaseRouter.get("/challans/:id", wrap(async (req, res) => { res.json(await P.getPurchaseChallan(idOf(req), companyOf(req))); }));
purchaseRouter.post("/challans", wrap(async (req, res) => {
  const companyId = whole(req.body?.companyId ?? q(req, "companyId"), "companyId"), branchId = whole(req.body?.branchId, "branchId");
  const result = await P.savePurchaseChallan(challanInput(req.body, { companyId, branchId }), await actorOf(req));
  res.status(201).json({ result, document: await P.getPurchaseChallan(result.id, companyId) });
}));
purchaseRouter.put("/challans/:id", wrap(async (req, res) => {
  const id = idOf(req), companyId = companyOf(req), c = await owned("challan", id, companyId);
  const result = await P.savePurchaseChallan(challanInput(req.body, { companyId, branchId: c.branchId, id }), await actorOf(req));
  res.json({ result, document: await P.getPurchaseChallan(id, companyId) });
}));
purchaseRouter.delete("/challans/:id", wrap(async (req, res) => {
  const id = idOf(req), companyId = companyOf(req); await owned("challan", id, companyId);
  res.json(await P.deletePurchaseChallan(id, companyId, await actorOf(req)));
}));
purchaseRouter.post("/challans/:id/confirm", wrap(async (req, res) => { const id = idOf(req), companyId = companyOf(req); await owned("challan", id, companyId); res.json(await P.confirmPurchaseChallan(id, companyId, await actorOf(req))); }));

purchaseRouter.get("/bills", wrap(async (req, res) => { res.json(await P.listPurchaseBills({ companyId: companyOf(req), branchId: optWhole(q(req, "branchId"), "branchId"), fiscalYear: q(req, "fiscalYear"), status: q(req, "status"), vendorGLId: optWhole(q(req, "vendorGLId"), "vendorGLId"), search: q(req, "search"), limit: optWhole(q(req, "limit"), "limit") })); }));
purchaseRouter.get("/bills/from-challan/:challanId", wrap(async (req, res) => {
  res.json(await P.billFromChallan(idOf(req, "challanId"), companyOf(req)));
}));
purchaseRouter.get("/bills/:id", wrap(async (req, res) => { res.json(await P.getPurchaseBill(idOf(req), companyOf(req))); }));

purchaseRouter.post("/bills", wrap(async (req, res) => {
  refuseAdditionalBill(req.body);
  const companyId = whole(req.body?.companyId ?? q(req, "companyId"), "companyId"), branchId = whole(req.body?.branchId, "branchId");
  const result = await P.savePurchaseBill(billInput(req.body, { companyId, branchId }), await actorOf(req), { lockOverride: lockOverrideOf(req) });
  res.status(201).json({ result, document: await P.getPurchaseBill(result.id, companyId) });
}));
purchaseRouter.put("/bills/:id", wrap(async (req, res) => {
  refuseAdditionalBill(req.body);
  const id = idOf(req), companyId = companyOf(req), b = await owned("bill", id, companyId);
  const result = await P.savePurchaseBill(billInput(req.body, { companyId, branchId: b.branchId, id }), await actorOf(req), { lockOverride: lockOverrideOf(req) });
  res.json({ result, document: await P.getPurchaseBill(id, companyId) });
}));
purchaseRouter.delete("/bills/:id", wrap(async (req, res) => {
  const id = idOf(req), companyId = companyOf(req); await owned("bill", id, companyId);
  res.json(await P.deletePurchaseBill(id, companyId, await actorOf(req), { lockOverride: lockOverrideOf(req) }));
}));
purchaseRouter.post("/bills/:id/post", wrap(async (req, res) => {
  const id = idOf(req), companyId = companyOf(req); await owned("bill", id, companyId);
  res.json(await P.postPurchaseBill(id, companyId, await actorOf(req), { lockOverride: lockOverrideOf(req) }));
}));
purchaseRouter.post("/bills/:id/reverse", wrap(async (req, res) => {
  const id = idOf(req), companyId = companyOf(req); await owned("bill", id, companyId);
  res.json(await P.reversePurchaseBill(id, companyId, await actorOf(req), { lockOverride: lockOverrideOf(req) }));
}));

// Import cost assessment routes (kept for completeness of the purchase router surface)
purchaseRouter.get("/import-assessments", wrap(async (req, res) => { res.json(await P.listImportAssessments({ companyId: companyOf(req), branchId: optWhole(q(req, "branchId"), "branchId"), fiscalYear: q(req, "fiscalYear"), status: q(req, "status"), search: q(req, "search"), limit: optWhole(q(req, "limit"), "limit") })); }));
purchaseRouter.get("/import-assessments/:id", wrap(async (req, res) => { res.json(await P.getImportAssessment(idOf(req), companyOf(req))); }));
purchaseRouter.post("/import-assessments", wrap(async (req, res) => {
  const companyId = whole(req.body?.companyId ?? q(req, "companyId"), "companyId"), branchId = whole(req.body?.branchId, "branchId");
  const result = await P.saveImportAssessment({ ...(req.body as any), companyId, branchId }, await actorOf(req));
  res.status(201).json({ result, ...(await P.getImportAssessment(result.id, companyId)) });
}));
purchaseRouter.put("/import-assessments/:id", wrap(async (req, res) => {
  const id = idOf(req), companyId = companyOf(req);
  const result = await P.saveImportAssessment({ ...(req.body as any), companyId, id }, await actorOf(req));
  res.json({ result, ...(await P.getImportAssessment(id, companyId)) });
}));
purchaseRouter.delete("/import-assessments/:id", wrap(async (req, res) => {
  const id = idOf(req), companyId = companyOf(req);
  res.json(await P.deleteImportAssessment(id, companyId, await actorOf(req)));
}));
purchaseRouter.post("/import-assessments/:id/post", wrap(async (req, res) => {
  const id = idOf(req), companyId = companyOf(req);
  const result = await P.postImportAssessment(id, companyId, await actorOf(req), { lockOverride: lockOverrideOf(req), assessmentDate: req.body?.assessmentDate as any });
  res.json({ result, ...(await P.getImportAssessment(id, companyId)) });
}));
purchaseRouter.post("/import-assessments/:id/reverse", wrap(async (req, res) => {
  const id = idOf(req), companyId = companyOf(req);
  const result = await P.reverseImportAssessment(id, companyId, await actorOf(req), { lockOverride: lockOverrideOf(req), reversalDate: req.body?.reversalDate as any });
  res.json({ result, ...(await P.getImportAssessment(id, companyId)) });
}));
