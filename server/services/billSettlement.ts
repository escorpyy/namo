import { and, eq, sql } from "drizzle-orm";
import * as S from "../db/schema";
import { HttpError } from "../routes/_util";
import { formatPaise } from "../../shared/cashBankVoucher";
import { parseDec, toCents } from "../../shared/decimal";
import { type Tx } from "./purchase/common";

// Bill-wise adjustment: which invoices / bills a Cash/Bank voucher pays off. A receipt settles sales invoices of the customer
// ledger it credits; a payment settles purchase bills of the vendor ledger it debits. The settlement never moves money; the voucher's own
// lines do. Outstanding of a document = total - settlements of POSTED vouchers that have not been reversed.

export type SettlementInput = { kind: "SALES_INVOICE" | "PURCHASE_BILL"; documentId: number; amount: unknown };
export type SettlementKind = SettlementInput["kind"];
export type OpenDocument = { id: number; kind: SettlementKind; number: string; date: string; dueDate: string | null; total: string; settled: string; outstanding: string; overdueDays: number };

const paise = (v: unknown) => toCents(String(v ?? "0"));
type Reader = Pick<Tx, "execute">;

// Posted, not-reversed vouchers' settlements. Used by both lists below.
const liveSettlement = sql`exists (select 1 from "CashBankVoucher" cv where cv.id = bs."cashBankVoucherId" and cv."isPosted"
  and not exists (select 1 from "CashBankVoucher" r where r."reversalOfId" = cv.id and r."isPosted"))`;

// Documents of one customer / vendor ledger that still have something to pay, oldest first. `all` also lists settled ones.
export async function openDocuments(db_: Reader, o: { companyId: number; kind: SettlementKind; generalLedgerId: number; all?: boolean; asOf?: string }): Promise<OpenDocument[]> {
  const sales = o.kind === "SALES_INVOICE";
  const asOf = o.asOf ?? new Date().toISOString().slice(0, 10);
  const rows = (await db_.execute(sales
    ? sql`select d.id, d."invoiceNumber" as number, to_char(d."invoiceDate",'YYYY-MM-DD') as date, to_char(d."dueDate",'YYYY-MM-DD') as "dueDate", d."totalAmount"::text as total,
            coalesce((select sum(bs.amount) from "BillSettlement" bs where bs."salesInvoiceId" = d.id and ${liveSettlement}), 0)::text as settled,
            (${asOf}::date - coalesce(d."dueDate", d."invoiceDate")) as late
          from "SalesInvoice" d where d."companyId" = ${o.companyId} and d."customerGLId" = ${o.generalLedgerId} and d."isPosted" and d."reversalOfId" is null
            and not exists (select 1 from "SalesInvoice" r where r."reversalOfId" = d.id and r."isPosted") order by d."invoiceDate", d.id`
    : sql`select d.id, d."invoiceNumber" as number, to_char(d."invoiceDate",'YYYY-MM-DD') as date, null::text as "dueDate", d."totalAmount"::text as total,
            coalesce((select sum(bs.amount) from "BillSettlement" bs where bs."purchaseBillId" = d.id and ${liveSettlement}), 0)::text as settled,
            (${asOf}::date - d."invoiceDate") as late
          from "PurchaseBill" d where d."companyId" = ${o.companyId} and d."vendorGLId" = ${o.generalLedgerId} and d."isPosted" and d."reversalOfId" is null
            and not exists (select 1 from "PurchaseBill" r where r."reversalOfId" = d.id and r."isPosted") order by d."invoiceDate", d.id`)) as any[];
  return rows.map((r) => {
    const out = paise(r.total) - paise(r.settled);
    return { id: r.id as number, kind: o.kind, number: r.number as string, date: r.date as string, dueDate: (r.dueDate ?? null) as string | null, total: formatPaise(paise(r.total)), settled: formatPaise(paise(r.settled)), outstanding: formatPaise(out), overdueDays: Math.max(0, Number(r.late ?? 0)), _out: out };
  }).filter((r) => o.all || r._out > 0n).map(({ _out, ...r }) => r);
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

