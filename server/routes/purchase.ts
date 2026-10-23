import { Router, type Request } from "express";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import * as S from "../db/schema";
import * as P from "../services/purchase";
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

async function actorOf(req: Request): Promise<P.Actor> {
  const raw = req.body?.userId ?? q(req, "userId");
  if (raw === undefined || raw === null || raw === "") return { userId: null };
  const id = whole(raw, "userId");
  const [u] = await db.select({ id: S.user.id, isActive: S.user.isActive }).from(S.user).where(eq(S.user.id, id));
  if (!u || !u.isActive) throw new HttpError(400, "Unknown or inactive user.", "userId");
  return { userId: id };
}

type Kind = "int" | "str" | "date" | "num" | "bool" | string[]; // string[] = one of these words
function checkKind(v: unknown, kind: Kind, label: string, field: string) {
  const bad = (what: string) => new HttpError(400, `${label}${what}`, field);
  if (kind === "int") { if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 2_000_000_000) throw bad(" must be a whole number."); }
  else if (kind === "num") { if (!(typeof v === "number" && Number.isFinite(v)) && !(typeof v === "string" && v.length <= 40)) throw bad(" must be a number."); }
  else if (kind === "bool") { if (typeof v !== "boolean") throw bad(" must be true or false."); }
  else if (kind === "str" || kind === "date") { if (typeof v !== "string" || v.length > 2000) throw bad(" must be text."); }
  else if (typeof v !== "string" || !kind.includes(v)) throw bad(` must be one of ${kind.join(", ")}.`);
}
// Keeps only the fields in `spec` (anything else the client sent is dropped) and refuses a value of the wrong type with a 400,
// so a bad request never reaches the service or the database as a type error.
function pick(obj: unknown, spec: Record<string, Kind>, label: string): Record<string, any> {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) throw new HttpError(400, `${label} must be an object.`);
  const out: Record<string, any> = {};
  for (const [k, kind] of Object.entries(spec)) {
    const v = (obj as any)[k];
    if (v === undefined) continue;
    if (v !== null && v !== "") checkKind(v, kind, `${label}: ${k}`, k);
    out[k] = v;
  }
  return out;
}
function rows(v: unknown, spec: Record<string, Kind>, name: string, max: number, label: string) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new HttpError(400, `${name} must be a list.`, name);
  if (v.length > max) throw new HttpError(400, `At most ${max} ${name} per document.`, name);
  return v.map((r, i) => pick(r, spec, `${label} ${i + 1}`));
}

const LINE = { productId: "int", particular: "str", altQty: "num", altUnitId: "int", qty: "num", unitId: "int", rate: "num" } as const satisfies Record<string, Kind>;
const TRACK = { locationId: "int", batchNo: "str", manufactureDate: "date", expiryDate: "date" } as const satisfies Record<string, Kind>;
const TERM = { termId: "int", lineNumber: "int", calcType: ["PERCENT", "AMOUNT"], rate: "num", inputAmount: "num", isOverridden: "bool", overrideAmount: "num" } as const satisfies Record<string, Kind>;
const HEAD = { fiscalYear: "str", vendorGLId: "int", subLedgerId: "int", agentId: "int", remarks: "str" } as const satisfies Record<string, Kind>;
const IMPORT: Record<string, Kind> = {
  customsDeclarationNo: "str", customsDeclarationDate: "date", customsOffice: "str", countryOfOrigin: "str", lcNo: "str", lcDate: "date", lcBankName: "str",
  transportMode: ["ROAD", "AIR", "RAIL", "OTHER"], blAwbNo: "str", blAwbDate: "date", transporterName: "str", vehicleNo: "str", lrNo: "str", lrDate: "date", importPermitNo: "str", importPermitDate: "date",
};

const filterOf = (req: Request): P.DocListFilter => ({
  companyId: companyOf(req), branchId: optWhole(q(req, "branchId"), "branchId"), vendorGLId: optWhole(q(req, "vendorGLId"), "vendorGLId"),
  fiscalYear: q(req, "fiscalYear")?.slice(0, 15), status: q(req, "status"), search: q(req, "search")?.slice(0, 60), limit: optWhole(q(req, "limit"), "limit"),
});

// The document must exist in the company named in the URL; a document of another company is "not found", never "forbidden".
async function owned(table: "order" | "challan" | "bill", id: number, companyId: number) {
  const T = table === "order" ? S.purchaseOrder : table === "challan" ? S.purchaseChallan : S.purchaseBill;
  const [r] = await db.select({ companyId: T.companyId, branchId: T.branchId }).from(T).where(and(eq(T.id, id), eq(T.companyId, companyId)));
  if (!r) throw new HttpError(404, `Purchase ${table} not found.`);
  return r;
}

// ---------- lookups ----------
purchaseRouter.get("/lookups", wrap(async (req, res) => {
  res.json(await P.purchaseLookups(companyOf(req)));
}));

// ===================================================================================================================
// ORDERS
// ===================================================================================================================
const ORDER_HEAD = { ...HEAD, orderNumber: "str", orderDate: "date", vendorRefNo: "str", vendorRefDate: "date", expectedDate: "date" } as const satisfies Record<string, Kind>;
const orderInput = (b: any, base: { companyId: number; branchId: number; id?: number }): P.PurchaseOrderInput => ({
  ...(pick(b, ORDER_HEAD, "Order") as any),
  lines: rows(b?.lines, { ...LINE, expectedDate: "date" }, "lines", MAX_LINES, "Line") as any,
  terms: rows(b?.terms, TERM, "terms", MAX_TERMS, "Term") as any,
  ...base,
});

purchaseRouter.get("/orders", wrap(async (req, res) => { res.json(await P.listPurchaseOrders(filterOf(req))); }));
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
  const id = idOf(req); await owned("order", id, companyOf(req));
  res.json({ result: await P.deletePurchaseOrder(id, await actorOf(req)) });
}));
for (const [action, fn] of [["approve", P.approvePurchaseOrder], ["close", P.closePurchaseOrder], ["cancel", P.cancelPurchaseOrder]] as const) {
  purchaseRouter.post(`/orders/:id/${action}`, wrap(async (req, res) => {
    const id = idOf(req), companyId = companyOf(req); await owned("order", id, companyId);
    const result = await fn(id, await actorOf(req));
    res.json({ result, document: await P.getPurchaseOrder(id, companyId) });
  }));
}

// ===================================================================================================================
// CHALLANS
// ===================================================================================================================
const CHALLAN_HEAD = {
  ...HEAD, challanNumber: "str", challanDate: "date", purchaseOrderId: "int", vendorChallanNo: "str", vendorChallanDate: "date",
  transporterName: "str", vehicleNo: "str", lrNo: "str", lrDate: "date",
} as const satisfies Record<string, Kind>;
const challanInput = (b: any, base: { companyId: number; branchId: number; id?: number }): P.PurchaseChallanInput => ({
  ...(pick(b, CHALLAN_HEAD, "Challan") as any),
  lines: rows(b?.lines, { ...LINE, ...TRACK, purchaseOrderLineId: "int" }, "lines", MAX_LINES, "Line") as any,
  ...base,
});

purchaseRouter.get("/challans", wrap(async (req, res) => { res.json(await P.listPurchaseChallans(filterOf(req))); }));
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
  const id = idOf(req); await owned("challan", id, companyOf(req));
  res.json({ result: await P.deletePurchaseChallan(id, await actorOf(req)) });
}));
purchaseRouter.post("/challans/:id/confirm", wrap(async (req, res) => {
  const id = idOf(req), companyId = companyOf(req); await owned("challan", id, companyId);
  const result = await P.confirmPurchaseChallan(id, await actorOf(req));
  res.json({ result, document: await P.getPurchaseChallan(id, companyId) });
}));

// ===================================================================================================================
// BILLS
// ===================================================================================================================
const BILL_HEAD = {
  ...HEAD, invoiceNumber: "str", invoiceDate: "date", invoiceType: ["LOCAL", "IMPORT"],
  purchaseType: ["GOODS_PURCHASE_OTHERS", "GOODS_PURCHASE_CAPITAL", "SERVICE_PURCHASE_OTHERS", "SERVICE_PURCHASE_CAPITAL"],
  vendorInvoiceNo: "str", vendorInvoiceDate: "date", purchaseChallanId: "int", purchaseOrderId: "int", mainBillId: "int", dueDays: "int", dueDate: "date",
} as const satisfies Record<string, Kind>;
const billInput = (b: any, base: { companyId: number; branchId: number; id?: number }): P.PurchaseBillInput => ({
  ...(pick(b, BILL_HEAD, "Bill") as any),
  lines: rows(b?.lines, { ...LINE, ...TRACK, challanLineId: "int", purchaseOrderLineId: "int" }, "lines", MAX_LINES, "Line") as any,
  terms: rows(b?.terms, TERM, "terms", MAX_TERMS, "Term") as any,
  importDetail: b?.importDetail == null ? null : (pick(b.importDetail, IMPORT, "Import detail") as any),
  ...base,
});

purchaseRouter.get("/bills", wrap(async (req, res) => { res.json(await P.listPurchaseBills(filterOf(req))); }));
// A starting point for a bill from a confirmed challan (nothing is saved). Declared before "/bills/:id" so "from-challan" is not read as an id.
purchaseRouter.get("/bills/from-challan/:challanId", wrap(async (req, res) => {
  const challanId = idOf(req, "challanId"); await owned("challan", challanId, companyOf(req));
  res.json(await P.billInputFromChallan(challanId));
}));
purchaseRouter.get("/bills/:id", wrap(async (req, res) => { res.json(await P.getPurchaseBill(idOf(req), companyOf(req))); }));

purchaseRouter.post("/bills", wrap(async (req, res) => {
  const companyId = whole(req.body?.companyId ?? q(req, "companyId"), "companyId"), branchId = whole(req.body?.branchId, "branchId");
  const result = await P.savePurchaseBill(billInput(req.body, { companyId, branchId }), await actorOf(req));
  res.status(201).json({ result, document: await P.getPurchaseBill(result.id, companyId) });
}));
purchaseRouter.put("/bills/:id", wrap(async (req, res) => {
  const id = idOf(req), companyId = companyOf(req), b = await owned("bill", id, companyId);
  const result = await P.savePurchaseBill(billInput(req.body, { companyId, branchId: b.branchId, id }), await actorOf(req));
  res.json({ result, document: await P.getPurchaseBill(id, companyId) });
}));
purchaseRouter.delete("/bills/:id", wrap(async (req, res) => {
  const id = idOf(req); await owned("bill", id, companyOf(req));
  res.json({ result: await P.deletePurchaseBill(id, await actorOf(req)) });
}));
purchaseRouter.post("/bills/:id/post", wrap(async (req, res) => {
  const id = idOf(req), companyId = companyOf(req); await owned("bill", id, companyId);
  const result = await P.postPurchaseBill(id, await actorOf(req));
  res.json({ result, document: await P.getPurchaseBill(id, companyId) });
}));
purchaseRouter.post("/bills/:id/reverse", wrap(async (req, res) => {
  const id = idOf(req), companyId = companyOf(req); await owned("bill", id, companyId);
  const o = pick(req.body ?? {}, { date: "date", reason: "str" }, "Reversal");
  const result = await P.reversePurchaseBill(id, await actorOf(req), { date: o.date || undefined, reason: o.reason?.trim() || undefined });
  res.json({ result, document: await P.getPurchaseBill(id, companyId) });
}));
