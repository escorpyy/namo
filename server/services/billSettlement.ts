import { and, eq, sql } from "drizzle-orm";
import * as S from "../db/schema";
import { HttpError } from "../routes/_util";
import { formatPaise } from "../../shared/cashBankVoucher";
import { parseDec, toCents } from "../../shared/decimal";
import { guardPeriod, type LockOverride } from "./periodLock";
import { type Actor, type Opts, type Tx, inActorTx, parseDate } from "./purchase/common";

// Bill-wise adjustment: which invoices / bills a Cash/Bank voucher pays off. A receipt settles sales invoices of the customer
// ledger it credits; a payment settles purchase bills of the vendor ledger it debits. The settlement never moves money; the voucher's own
// lines do. Outstanding of a document = total - settlements of POSTED vouchers that have not been reversed.

export type SettlementInput = { kind: "SALES_INVOICE" | "PURCHASE_BILL"; documentId: number; amount: unknown };
export type SettlementKind = SettlementInput["kind"];
export type OpenDocument = { generalLedgerId: number; id: number; kind: SettlementKind; number: string; date: string; dueDate: string | null; total: string; settled: string; outstanding: string; overdueDays: number };

const paise = (v: unknown) => toCents(String(v ?? "0"));
type Reader = Pick<Tx, "execute">;

// Posted, not-reversed vouchers' rows (settlements, or applications of an advance taken from that voucher). `a` is the row alias.
const live = (a: string) => sql`exists (select 1 from "CashBankVoucher" cv where cv.id = ${sql.raw(a)}."cashBankVoucherId" and cv."isPosted"
  and not exists (select 1 from "CashBankVoucher" r where r."reversalOfId" = cv.id and r."isPosted"))`;

// Documents of one customer / vendor ledger that still have something to pay, oldest first. `all` also lists settled ones.
export async function openDocuments(db_: Reader, o: { companyId: number; kind: SettlementKind; generalLedgerId?: number; all?: boolean; asOf?: string }): Promise<OpenDocument[]> {
  const sales = o.kind === "SALES_INVOICE";
  const asOf = o.asOf ?? new Date().toISOString().slice(0, 10);
  const rows = (await db_.execute(sales
    ? sql`select d.id, d."customerGLId" as gl, d."invoiceNumber" as number, to_char(d."invoiceDate",'YYYY-MM-DD') as date, to_char(d."dueDate",'YYYY-MM-DD') as "dueDate", d."totalAmount"::text as total,
            (coalesce((select sum(bs.amount) from "BillSettlement" bs where bs."salesInvoiceId" = d.id and ${live("bs")}), 0)
              + coalesce((select sum(aa.amount) from "AdvanceApplication" aa where aa."salesInvoiceId" = d.id and ${live("aa")}), 0))::text as settled,
            (${asOf}::date - coalesce(d."dueDate", d."invoiceDate")) as late
          from "SalesInvoice" d where d."companyId" = ${o.companyId} ${o.generalLedgerId ? sql`and d."customerGLId" = ${o.generalLedgerId}` : sql``} and d."isPosted" and d."reversalOfId" is null
            and not exists (select 1 from "SalesInvoice" r where r."reversalOfId" = d.id and r."isPosted") order by d."invoiceDate", d.id`
    : sql`select d.id, d."vendorGLId" as gl, d."invoiceNumber" as number, to_char(d."invoiceDate",'YYYY-MM-DD') as date, null::text as "dueDate", d."totalAmount"::text as total,
            (coalesce((select sum(bs.amount) from "BillSettlement" bs where bs."purchaseBillId" = d.id and ${live("bs")}), 0)
              + coalesce((select sum(aa.amount) from "AdvanceApplication" aa where aa."purchaseBillId" = d.id and ${live("aa")}), 0))::text as settled,
            (${asOf}::date - d."invoiceDate") as late
          from "PurchaseBill" d where d."companyId" = ${o.companyId} ${o.generalLedgerId ? sql`and d."vendorGLId" = ${o.generalLedgerId}` : sql``} and d."isPosted" and d."reversalOfId" is null
            and not exists (select 1 from "PurchaseBill" r where r."reversalOfId" = d.id and r."isPosted") order by d."invoiceDate", d.id`)) as any[];
  return rows.map((r) => {
    const out = paise(r.total) - paise(r.settled);
    return { id: r.id as number, generalLedgerId: r.gl as number, kind: o.kind, number: r.number as string, date: r.date as string, dueDate: (r.dueDate ?? null) as string | null, total: formatPaise(paise(r.total)), settled: formatPaise(paise(r.settled)), outstanding: formatPaise(out), overdueDays: Math.max(0, Number(r.late ?? 0)), _out: out };
  }).filter((r) => o.all || r._out > 0n).map(({ _out, ...r }) => r);
}

// ---------- advances ----------
export type OpenAdvance = { generalLedgerId: number; voucherId: number; voucherNumber: string; date: string; amount: string; used: string; available: string };

// Receipts (customer) / payments (vendor) on one ledger that were not fully settled against bills, oldest first.
//   available = what the voucher received / paid on that ledger - its settlements for that ledger's documents - applications taken from it
export async function openAdvances(db_: Reader, o: { companyId: number; kind: SettlementKind; generalLedgerId?: number }): Promise<OpenAdvance[]> {
  const sales = o.kind === "SALES_INVOICE";
  const rows = (await db_.execute(sql`
    select v.id, l."generalLedgerId" as gl, v."voucherNumber" as number, to_char(v."voucherDate",'YYYY-MM-DD') as date,
           sum(${sales ? sql`l.credit` : sql`l.debit`})::text as amount,
           (coalesce((select sum(bs.amount) from "BillSettlement" bs ${sales ? sql`join "SalesInvoice" d on d.id = bs."salesInvoiceId" and d."customerGLId"` : sql`join "PurchaseBill" d on d.id = bs."purchaseBillId" and d."vendorGLId"`} = l."generalLedgerId"
                       where bs."cashBankVoucherId" = v.id), 0)
            + coalesce((select sum(aa.amount) from "AdvanceApplication" aa where aa."cashBankVoucherId" = v.id and aa."generalLedgerId" = l."generalLedgerId"), 0))::text as used
      from "CashBankVoucher" v join "CashBankVoucherLine" l on l."cashBankVoucherId" = v.id and not l."isCashBankLine" ${o.generalLedgerId ? sql`and l."generalLedgerId" = ${o.generalLedgerId}` : sql``}
     where v."companyId" = ${o.companyId} and v."isPosted" and v."reversalOfId" is null
       and not exists (select 1 from "CashBankVoucher" r where r."reversalOfId" = v.id and r."isPosted")
     group by v.id, l."generalLedgerId" order by v."voucherDate", v.id`)) as any[];
  return rows.map((r) => ({ generalLedgerId: r.gl as number, voucherId: r.id as number, voucherNumber: r.number as string, date: r.date as string, amount: paise(r.amount), used: paise(r.used) }))
    .filter((r) => r.amount > r.used)
    .map((r) => ({ generalLedgerId: r.generalLedgerId, voucherId: r.voucherId, voucherNumber: r.voucherNumber, date: r.date, amount: formatPaise(r.amount), used: formatPaise(r.used), available: formatPaise(r.amount - r.used) }));
}

export async function advanceTotal(db_: Reader, o: { companyId: number; kind: SettlementKind; generalLedgerId: number }) {
  const list = await openAdvances(db_, o);
  return { count: list.length, total: formatPaise(list.reduce((a, r) => a + paise(r.available), 0n)) };
}

// Use advances to pay off a posted invoice / bill now. No money moves: the advance is already in the party's ledger.
export async function applyAdvances(tx: Tx, o: { companyId: number; kind: SettlementKind; documentId: number; date: string; items: { voucherId: number; amount: unknown }[] }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.date ?? "")) throw new HttpError(400, "Choose the date of the adjustment.", "date");
  if (!o.items?.length) throw new HttpError(400, "Choose at least one advance to apply.", "items");
  const sales = o.kind === "SALES_INVOICE";
  const table = sales ? S.salesInvoice : S.purchaseBill;
  const [doc] = (await tx.select({ id: table.id, gl: sales ? S.salesInvoice.customerGLId : S.purchaseBill.vendorGLId, no: table.invoiceNumber })
    .from(table as any).where(and(eq(table.id, o.documentId), eq(table.companyId, o.companyId)))) as any[];
  if (!doc) throw new HttpError(404, `That ${sales ? "invoice" : "bill"} was not found in this company.`);
  const open = (await openDocuments(tx, { companyId: o.companyId, kind: o.kind, generalLedgerId: doc.gl })).find((d) => d.id === doc.id);
  if (!open) throw new HttpError(409, `${doc.no} is not open (it is not posted, was reversed, or is already fully settled).`);
  const advances = new Map((await openAdvances(tx, { companyId: o.companyId, kind: o.kind, generalLedgerId: doc.gl })).map((a) => [a.voucherId, a]));
  let total = 0n;
  const seen = new Set<number>();
  for (const [i, it] of o.items.entries()) {
    const n = i + 1, field = `items.${i}.amount`, txt = String(it.amount ?? "").trim();
    if (!parseDec(txt)) throw new HttpError(400, `Advance ${n}: the amount is not a valid number.`, field);
    const amt = toCents(txt);
    if (amt <= 0n) throw new HttpError(400, `Advance ${n}: the amount must be more than zero.`, field);
    if (seen.has(it.voucherId)) throw new HttpError(400, `Advance ${n}: that voucher is listed twice.`, field);
    seen.add(it.voucherId);
    const adv = advances.get(it.voucherId);
    if (!adv) throw new HttpError(409, `Advance ${n}: that voucher has no advance left on this account.`, field);
    if (amt > paise(adv.available)) throw new HttpError(409, `Advance ${n}: ${adv.voucherNumber} has only ${adv.available} left.`, field);
    total += amt;
    await tx.insert(S.advanceApplication).values({
      companyId: o.companyId, cashBankVoucherId: it.voucherId, generalLedgerId: doc.gl, amount: formatPaise(amt), appliedDate: o.date,
      salesInvoiceId: sales ? doc.id : null, purchaseBillId: sales ? null : doc.id,
    });
  }
  if (total > paise(open.outstanding)) throw new HttpError(409, `${doc.no} has only ${open.outstanding} outstanding; ${formatPaise(total)} was chosen.`, "items");
  return { documentId: doc.id as number, applied: formatPaise(total) };
}

// Advances applied to one document (shown on it, with an Undo).
export async function applicationsOf(db_: Reader, o: { kind: SettlementKind; documentId: number }) {
  const col = o.kind === "SALES_INVOICE" ? sql`aa."salesInvoiceId"` : sql`aa."purchaseBillId"`;
  const rows = (await db_.execute(sql`select aa.id, aa."cashBankVoucherId" as "voucherId", v."voucherNumber" as number, to_char(aa."appliedDate",'YYYY-MM-DD') as date, aa.amount::text as amount
    from "AdvanceApplication" aa join "CashBankVoucher" v on v.id = aa."cashBankVoucherId" where ${col} = ${o.documentId} order by aa.id`)) as any[];
  return rows.map((r) => ({ id: r.id as number, voucherId: r.voucherId as number, voucherNumber: r.number as string, date: r.date as string, amount: formatPaise(paise(r.amount)) }));
}

// Undo an application. The reason is kept in the audit trail.
export async function undoApplication(tx: Tx, o: { companyId: number; id: number; reason: string }) {
  const reason = String(o.reason ?? "").trim();
  if (reason.length < 3) throw new HttpError(400, "Give a reason (at least 3 characters) for undoing this adjustment.", "reason");
  const [row] = await tx.select({ id: S.advanceApplication.id }).from(S.advanceApplication).where(and(eq(S.advanceApplication.id, o.id), eq(S.advanceApplication.companyId, o.companyId)));
  if (!row) throw new HttpError(404, "That adjustment was not found in this company.");
  await tx.execute(sql`select set_config('namo.change_reason', ${reason}, true)`);
  await tx.delete(S.advanceApplication).where(eq(S.advanceApplication.id, o.id));
  return { id: o.id };
}

// Total still unpaid for a customer / vendor ledger (paise as a money string), for the panels.
export async function outstandingTotal(db_: Reader, o: { companyId: number; kind: SettlementKind; generalLedgerId: number }) {
  const docs = await openDocuments(db_, { ...o, all: false });
  return { count: docs.length, total: formatPaise(docs.reduce((a, d) => a + paise(d.outstanding), 0n)) };
}

// The settlements of one voucher, with the document they point at.
export async function settlementsOf(db_: Reader, voucherId: number) {
  const rows = (await db_.execute(sql`
    select bs.id, bs."salesInvoiceId", bs."purchaseBillId", bs.amount::text as amount, coalesce(si."invoiceNumber", pb."invoiceNumber") as number,
           to_char(coalesce(si."invoiceDate", pb."invoiceDate"),'YYYY-MM-DD') as date, coalesce(si."customerGLId", pb."vendorGLId") as "generalLedgerId"
      from "BillSettlement" bs left join "SalesInvoice" si on si.id = bs."salesInvoiceId" left join "PurchaseBill" pb on pb.id = bs."purchaseBillId"
     where bs."cashBankVoucherId" = ${voucherId} order by bs.id`)) as any[];
  return rows.map((r) => ({
    id: r.id as number, kind: (r.salesInvoiceId ? "SALES_INVOICE" : "PURCHASE_BILL") as SettlementKind, documentId: (r.salesInvoiceId ?? r.purchaseBillId) as number,
    number: r.number as string, date: r.date as string, generalLedgerId: r.generalLedgerId as number, amount: formatPaise(paise(r.amount)),
  }));
}

// Replace a DRAFT voucher's settlements (an empty / missing list clears them). Rules, all with a message the screen can show:
//   - a receipt settles invoices only, a payment settles bills only, for the ledger the voucher line names
//   - each document is posted, belongs to this company, and is settled for no more than is still outstanding
//   - the amounts settled against a ledger never exceed what the voucher receives / pays on it
export async function writeSettlements(tx: Tx, o: { voucherId: number; companyId: number; settlements?: SettlementInput[] | null }) {
  await tx.delete(S.billSettlement).where(eq(S.billSettlement.cashBankVoucherId, o.voucherId));
  const list = (o.settlements ?? []).filter((s) => paise(s.amount) > 0n || String(s.amount ?? "").trim() !== "");
  if (!list.length) return;
  const lines = await tx.select({ gl: S.cashBankVoucherLine.generalLedgerId, debit: S.cashBankVoucherLine.debit, credit: S.cashBankVoucherLine.credit })
    .from(S.cashBankVoucherLine).where(and(eq(S.cashBankVoucherLine.cashBankVoucherId, o.voucherId), eq(S.cashBankVoucherLine.isCashBankLine, false)));
  const received = new Map<number, bigint>(), paid = new Map<number, bigint>();
  for (const l of lines) {
    received.set(l.gl, (received.get(l.gl) ?? 0n) + paise(l.credit));
    paid.set(l.gl, (paid.get(l.gl) ?? 0n) + paise(l.debit));
  }
  const used = new Map<string, bigint>(), seen = new Set<string>();
  const cache = new Map<string, Map<number, OpenDocument>>();
  for (const [i, s] of list.entries()) {
    const n = i + 1, field = `settlements.${i}.amount`;
    if (s.kind !== "SALES_INVOICE" && s.kind !== "PURCHASE_BILL") throw new HttpError(400, `Settlement ${n}: unknown document type.`, field);
    const txt = String(s.amount ?? "").trim();
    if (!parseDec(txt)) throw new HttpError(400, `Settlement ${n}: the amount is not a valid number.`, field);
    const amt = toCents(txt);
    if (amt <= 0n) throw new HttpError(400, `Settlement ${n}: the amount must be more than zero.`, field);
    const key = `${s.kind}:${s.documentId}`;
    if (seen.has(key)) throw new HttpError(400, `Settlement ${n}: that document is listed twice.`, field);
    seen.add(key);
    const table = s.kind === "SALES_INVOICE" ? S.salesInvoice : S.purchaseBill;
    const [doc] = await tx.select({ id: table.id, gl: s.kind === "SALES_INVOICE" ? S.salesInvoice.customerGLId : S.purchaseBill.vendorGLId, no: table.invoiceNumber })
      .from(table as any).where(and(eq(table.id, s.documentId), eq(table.companyId, o.companyId))) as any[];
    if (!doc) throw new HttpError(404, `Settlement ${n}: the ${s.kind === "SALES_INVOICE" ? "invoice" : "bill"} was not found in this company.`, field);
    const side = s.kind === "SALES_INVOICE" ? received : paid;
    if (!(side.get(doc.gl) ?? 0n)) throw new HttpError(400, `Settlement ${n}: ${doc.no} belongs to an account this voucher does not ${s.kind === "SALES_INVOICE" ? "receive from" : "pay"}.`, field);
    const ck = `${s.kind}:${doc.gl}`;
    if (!cache.has(ck)) cache.set(ck, new Map((await openDocuments(tx, { companyId: o.companyId, kind: s.kind, generalLedgerId: doc.gl })).map((d) => [d.id, d])));
    const open = cache.get(ck)!.get(s.documentId);
    if (!open) throw new HttpError(409, `Settlement ${n}: ${doc.no} is not open (it is not posted, was reversed, or is already fully settled).`, field);
    if (amt > paise(open.outstanding)) throw new HttpError(409, `Settlement ${n}: ${doc.no} has only ${open.outstanding} outstanding.`, field);
    const total = (used.get(ck) ?? 0n) + amt;
    used.set(ck, total);
    if (total > (side.get(doc.gl) ?? 0n)) throw new HttpError(409, `Settlement ${n}: more is settled than this voucher ${s.kind === "SALES_INVOICE" ? "receives" : "pays"} on that account (${formatPaise(side.get(doc.gl) ?? 0n)}).`, field);
    await tx.insert(S.billSettlement).values({
      companyId: o.companyId, cashBankVoucherId: o.voucherId, amount: formatPaise(amt),
      salesInvoiceId: s.kind === "SALES_INVOICE" ? s.documentId : null, purchaseBillId: s.kind === "PURCHASE_BILL" ? s.documentId : null,
    });
  }
}

// Called when a draft is posted: what was valid when saved may have been used up by another voucher since.
export async function recheckSettlements(tx: Tx, voucherId: number, companyId: number) {
  const rows = (await settlementsOf(tx, voucherId));
  if (!rows.length) return;
  await writeSettlements(tx, { voucherId, companyId, settlements: rows.map((r) => ({ kind: r.kind, documentId: r.documentId, amount: r.amount })) });
}


// Entry points that run in their own audited transaction (the routes call these).
export const applyAdvancesFor = (actor: Actor, o: Parameters<typeof applyAdvances>[1] & { lockOverride?: LockOverride }, opts: Opts = {}) =>
  inActorTx(actor, opts.tx, async (tx) => {
    await guardPeriod(tx, o.companyId, [parseDate(o.date, "date")], o.lockOverride, "date");
    return applyAdvances(tx, o);
  });
export const undoApplicationFor = (actor: Actor, o: Parameters<typeof undoApplication>[1], opts: Opts = {}) =>
  inActorTx(actor, opts.tx, (tx) => undoApplication(tx, o));

// ---------- ageing ----------
export const AGE_BUCKETS = ["current", "d1_30", "d31_60", "d61_90", "d90"] as const;
export type AgeBucket = (typeof AGE_BUCKETS)[number];
export type AgeingRow = { generalLedgerId: number; code: string; name: string; bills: number; total: string; advance: string; net: string } & Record<AgeBucket, string>;

// What each customer owes (invoices) or each vendor is owed (bills), by how late it is. Age counts from the due date (invoice) or the bill date
// (bill) to `asOf`; "current" is not yet due. Advances are shown beside, not netted into the buckets. Payments are counted as of today.
export async function ageingReport(db_: Reader, o: { companyId: number; kind: SettlementKind; asOf?: string }) {
  const asOf = o.asOf ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new HttpError(400, "The ageing date must look like 2026-11-30.", "asOf");
  const [docs, advs] = await Promise.all([openDocuments(db_, { companyId: o.companyId, kind: o.kind, asOf }), openAdvances(db_, { companyId: o.companyId, kind: o.kind })]);
  const ids = [...new Set([...docs.map((d) => d.generalLedgerId), ...advs.map((a) => a.generalLedgerId)])];
  const names = new Map<number, { code: string; name: string }>();
  if (ids.length) for (const g of (await db_.execute(sql`select id, code, name from "GeneralLedger" where id in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`)) as any[]) names.set(g.id, { code: g.code, name: g.name });
  const bucketOf = (days: number): AgeBucket => (days <= 0 ? "current" : days <= 30 ? "d1_30" : days <= 60 ? "d31_60" : days <= 90 ? "d61_90" : "d90");
  const acc = new Map<number, { buckets: Record<AgeBucket, bigint>; bills: number; advance: bigint }>();
  const get = (id: number) => acc.get(id) ?? (acc.set(id, { buckets: { current: 0n, d1_30: 0n, d31_60: 0n, d61_90: 0n, d90: 0n }, bills: 0, advance: 0n }), acc.get(id)!);
  for (const d of docs) { const r = get(d.generalLedgerId); r.buckets[bucketOf(d.overdueDays)] += paise(d.outstanding); r.bills += 1; }
  for (const a of advs) get(a.generalLedgerId).advance += paise(a.available);
  const rows: AgeingRow[] = [...acc.entries()].map(([id, r]) => {
    const total = AGE_BUCKETS.reduce((t, k) => t + r.buckets[k], 0n);
    return { generalLedgerId: id, code: names.get(id)?.code ?? "", name: names.get(id)?.name ?? `Ledger ${id}`, bills: r.bills, total: formatPaise(total), advance: formatPaise(r.advance), net: formatPaise(total - r.advance),
      current: formatPaise(r.buckets.current), d1_30: formatPaise(r.buckets.d1_30), d31_60: formatPaise(r.buckets.d31_60), d61_90: formatPaise(r.buckets.d61_90), d90: formatPaise(r.buckets.d90) };
  }).sort((a, b) => a.name.localeCompare(b.name));
  const sum = (k: "total" | "advance" | "net" | AgeBucket) => formatPaise(rows.reduce((t, r) => t + paise(r[k]), 0n));
  return { asOf, rows, totals: { total: sum("total"), advance: sum("advance"), net: formatPaise(rows.reduce((t, r) => t + paise(r.total) - paise(r.advance), 0n)), current: sum("current"), d1_30: sum("d1_30"), d31_60: sum("d31_60"), d61_90: sum("d61_90"), d90: sum("d90"), bills: rows.reduce((t, r) => t + r.bills, 0) } };
}
