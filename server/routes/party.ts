import { Router } from "express";
import { and, asc, eq, getTableName, ne, sql } from "drizzle-orm";
import { db } from "../db";
import * as S from "../db/schema";
import { HttpError, wrap } from "./_util";
import { buildSchema } from "./masterFactory";
import { assertAgent, assertSubArea, assertSubGroup, normalBalanceFor } from "./links";
import type { MasterDef } from "../../shared/masters";

const GL = S.generalLedger, P = S.party, CD = S.customerDetail, VD = S.vendorDetail;
const isCust = (t: string) => t === "CUSTOMER" || t === "BOTH";
const isVend = (t: string) => t === "VENDOR" || t === "BOTH";
const str = (v: unknown) => (v == null ? null : String(v));

// "Party" UI me ek screen hai, par DB me 4 tables: GeneralLedger + Party + CustomerDetail + VendorDetail.
// Isliye generic factory ki jagah yahan custom router hai (transaction me save), par API shape wahi hai.
export function partyRouter(def: MasterDef) {
  const r = Router();
  const schema = buildSchema(def);

  const cnt = (t: any, col: string, outer: any) =>
    sql<number>`(select count(*)::int from ${sql.identifier(getTableName(t))} ref where ref.${sql.identifier(col)} = ${outer})`;

  const selectRows = (o: { companyId?: number; id?: number }) =>
    db
      .select({
        id: P.id, generalLedgerId: P.generalLedgerId,
        code: GL.code, name: GL.name, accountSubGroupId: GL.accountSubGroupId, glType: GL.glType, isActive: GL.isActive,
        subAreaId: P.subAreaId, agentId: P.agentId,
        address: P.address, city: P.city, state: P.state, country: P.country, phone: P.phone, mobile: P.mobile,
        email: P.email, contactPerson: P.contactPerson, panNo: P.panNo, isVatRegistered: P.isVatRegistered,
        creditLimit: CD.creditLimit, creditDays: CD.creditDays, paymentTermDays: VD.paymentTermDays,
        createdAt: P.createdAt, updatedAt: P.updatedAt,
        childCount: cnt(GL, "parentId", GL.id),
        subLedgerCount: cnt(S.subLedger, "generalLedgerId", GL.id),
        voucherLineCount: sql<number>`(${cnt(S.journalVoucherLine, "generalLedgerId", GL.id)} + ${cnt(S.cashBankVoucherLine, "generalLedgerId", GL.id)})`,
        openingCount: cnt(S.openingBalance, "generalLedgerId", GL.id),
        productCount: cnt(S.stockDetail, "defaultVendorId", P.id),
      })
      .from(P)
      .innerJoin(GL, eq(P.generalLedgerId, GL.id))
      .leftJoin(CD, eq(CD.partyId, P.id))
      .leftJoin(VD, eq(VD.partyId, P.id))
      .where(and(o.id != null ? eq(P.id, o.id) : undefined, o.companyId != null ? eq(P.companyId, o.companyId) : undefined))
      .orderBy(asc(GL.code));

  const parse = (raw: unknown) => {
    const p = schema.safeParse(raw);
    if (!p.success) {
      const issue = p.error.issues[0];
      throw new HttpError(400, issue.message, String(issue.path[0] ?? ""));
    }
    return p.data as Record<string, any>;
  };

  async function validate(d: Record<string, any>, companyId: number, partyId?: number, glId?: number) {
    const groupType = await assertSubGroup(d.accountSubGroupId, companyId);
    await assertSubArea(d.subAreaId, companyId);
    await assertAgent(d.agentId, companyId);
    // GL code company ke saare ledgers me unique (sirf party me nahi)
    const [dupGl] = await db.select({ id: GL.id }).from(GL)
      .where(and(eq(GL.companyId, companyId), sql`lower(${GL.code}) = ${String(d.code).toLowerCase()}`, glId != null ? ne(GL.id, glId) : undefined)).limit(1);
    if (dupGl) throw new HttpError(409, `Code '${d.code}' already exists in this company.`, "code");
    if (d.panNo != null) {
      const [dupPan] = await db.select({ id: P.id }).from(P)
        .where(and(eq(P.companyId, companyId), sql`lower(${P.panNo}) = ${String(d.panNo).toLowerCase()}`, partyId != null ? ne(P.id, partyId) : undefined)).limit(1);
      if (dupPan) throw new HttpError(409, `PAN No '${d.panNo}' already exists in this company.`, "panNo");
    }
    return groupType;
  }

  const partyCols = (d: Record<string, any>) => ({
    address: d.address, city: d.city, state: d.state, country: d.country, phone: d.phone, mobile: d.mobile,
    email: d.email, contactPerson: d.contactPerson, panNo: d.panNo, isVatRegistered: d.isVatRegistered,
    subAreaId: d.subAreaId ?? null, agentId: d.agentId ?? null,
  });

  // Type ke hisaab se detail rows; jo type ab applicable nahi uski purani detail delete nahi karte (data loss nahi)
  async function saveDetails(tx: any, partyId: number, d: Record<string, any>) {
    if (isCust(d.glType)) {
      const v = { creditLimit: str(d.creditLimit), creditDays: d.creditDays ?? null };
      await tx.insert(CD).values({ partyId, ...v }).onConflictDoUpdate({ target: CD.partyId, set: v });
    }
    if (isVend(d.glType)) {
      const v = { paymentTermDays: d.paymentTermDays ?? null };
      await tx.insert(VD).values({ partyId, ...v }).onConflictDoUpdate({ target: VD.partyId, set: v });
    }
  }

  r.get("/", wrap(async (req, res) => {
    const companyId = Number(req.query.companyId);
    if (!Number.isInteger(companyId)) throw new HttpError(400, "companyId is required.");
    res.json(await selectRows({ companyId }));
  }));

  r.post("/", wrap(async (req, res) => {
    const companyId = Number(req.query.companyId);
    if (!Number.isInteger(companyId)) throw new HttpError(400, "companyId is required.");
    const d = parse(req.body);
    const groupType = await validate(d, companyId);
    const id = await db.transaction(async (tx) => {
      const [gl] = await tx.insert(GL).values({
        companyId, code: d.code, name: d.name, accountSubGroupId: d.accountSubGroupId, normalBalance: normalBalanceFor(groupType),
        glType: d.glType, isActive: d.isActive, subAreaId: d.subAreaId ?? null, agentId: d.agentId ?? null,
      }).returning({ id: GL.id });
      const [p] = await tx.insert(P).values({ companyId, generalLedgerId: gl.id, ...partyCols(d) }).returning({ id: P.id });
      await saveDetails(tx, p.id, d);
      return p.id;
    });
    res.status(201).json((await selectRows({ id }))[0]);
  }));

  r.put("/:id", wrap(async (req, res) => {
    const id = Number(req.params.id);
    const [ex] = await db.select().from(P).where(eq(P.id, id));
    if (!ex) throw new HttpError(404, "Party not found.");
    const [glRow] = await db.select().from(GL).where(eq(GL.id, ex.generalLedgerId));
    const d = parse(req.body);
    const groupType = await validate(d, ex.companyId, id, ex.generalLedgerId);
    await db.transaction(async (tx) => {
      await tx.update(GL).set({
        code: d.code, name: d.name, accountSubGroupId: d.accountSubGroupId, glType: d.glType, isActive: d.isActive,
        subAreaId: d.subAreaId ?? null, agentId: d.agentId ?? null,
        // Sub group badla ho tabhi normal balance dobara nikalo, warna jaisa tha waisa
        ...(d.accountSubGroupId !== glRow.accountSubGroupId ? { normalBalance: normalBalanceFor(groupType) } : {}),
      }).where(eq(GL.id, ex.generalLedgerId));
      await tx.update(P).set(partyCols(d)).where(eq(P.id, id));
      await saveDetails(tx, id, d);
    });
    res.json((await selectRows({ id }))[0]);
  }));

  r.delete("/:id", wrap(async (req, res) => {
    const id = Number(req.params.id);
    const [row] = await selectRows({ id });
    if (!row) throw new HttpError(404, "Party not found.");
    for (const c of def.counts ?? []) {
      const n = (row as any)[c.key] as number;
      if (n > 0) throw new HttpError(409, `Cannot delete: ${n} ${c.label} linked to this Party.`);
    }
    // GL delete se Party + Customer/Vendor detail cascade hote hain
    await db.delete(GL).where(eq(GL.id, row.generalLedgerId));
    res.json({ ok: true });
  }));

  return r;
}
