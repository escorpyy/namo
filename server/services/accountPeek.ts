import { sql } from "drizzle-orm";
import { db } from "../db";
import { formatPaise } from "../../shared/cashBankVoucher";
import { HttpError } from "../routes/_util";
import { signedPaise } from "./accountBalances";
import { parseDate, type Tx } from "./purchase/common";

// The "account panel" beside the voucher screens: for ONE ledger (or one party sub-ledger of it) the balance on the voucher date and the
// last few posted entries. Read-only. The balance follows exactly the rules of services/accountBalances.ts (opening balance + posted journal and
// cash/bank lines of one branch and fiscal year, through the date, the voucher being edited left out); a test compares the two so they cannot drift.

export interface AccountPeekInput {
  companyId: number;
  branchId: number;
  fiscalYear: string;
  date: string;
  generalLedgerId: number;
  subLedgerId?: number | null;
  excludeJournalVoucherId?: number | null;
  excludeCashBankVoucherId?: number | null;
  limit?: number;
}

export interface PeekEntry {
  kind: "JOURNAL" | "CASH_BANK";
  voucherId: number;
  voucherNumber: string;
  voucherDate: string; // AD, YYYY-MM-DD
  narration: string | null;
  debit: string;
  credit: string;
}

export interface AccountPeek {
  ledger: { id: number; code: string; name: string; requiresSubLedger: boolean };
  subLedger: { id: number; code: string; name: string } | null;
  /** net balance through the date, one side only (like the account-balances rows) */
  balance: { debit: string; credit: string };
  recent: PeekEntry[];
}

export const PEEK_DEFAULT_LIMIT = 5;
export const PEEK_MAX_LIMIT = 20;

// An amount read from a numeric column, as "1234.50" (the same rounding as the balance service).
const money = (v: unknown) => formatPaise(signedPaise(String(v ?? "0")));

export async function accountPeek(o: AccountPeekInput, tx: Pick<Tx, "execute"> = db): Promise<AccountPeek> {
  const asOf = parseDate(o.date, "date").toISOString().slice(0, 10);
  const limit = Math.min(Math.max(Math.trunc(o.limit ?? PEEK_DEFAULT_LIMIT), 1), PEEK_MAX_LIMIT);
  const sub = o.subLedgerId ?? null;
  const exJ = o.excludeJournalVoucherId ?? null;
  const exC = o.excludeCashBankVoucherId ?? null;

  // The ledger must belong to the company asked about: an id from another company is "not found", never its balance.
  const [gl] = (await tx.execute(sql`
    SELECT id, code, name, "requiresSubLedger" FROM "GeneralLedger"
     WHERE id = ${o.generalLedgerId} AND "companyId" = ${o.companyId}
  `)) as any[];
  if (!gl) throw new HttpError(404, "Ledger not found in this company.", "generalLedgerId");

  let subRow: AccountPeek["subLedger"] = null;
  if (sub !== null) {
    const [s] = (await tx.execute(sql`
      SELECT id, code, name FROM "SubLedger" WHERE id = ${sub} AND "generalLedgerId" = ${o.generalLedgerId}
    `)) as any[];
    if (!s) throw new HttpError(404, "Sub-ledger not found under this ledger.", "subLedgerId");
    subRow = { id: Number(s.id), code: String(s.code), name: String(s.name) };
  }

  const [bal] = (await tx.execute(sql`
    WITH movements AS (
      SELECT (ob."debit" - ob."credit") AS amount
        FROM "OpeningBalance" ob
        JOIN "FiscalYear" fy ON fy.id = ob."fiscalYearId"
       WHERE ob."companyId" = ${o.companyId} AND ob."branchId" = ${o.branchId}
         AND fy."companyId" = ${o.companyId} AND fy."code" = ${o.fiscalYear}
         AND ob."generalLedgerId" = ${o.generalLedgerId}
         AND (${sub}::int IS NULL OR ob."subLedgerId" = ${sub}::int)
      UNION ALL
      SELECT (l."debit" - l."credit") AS amount
        FROM "JournalVoucherLine" l
        JOIN "JournalVoucher" v ON v.id = l."journalVoucherId"
       WHERE v."companyId" = ${o.companyId} AND v."branchId" = ${o.branchId}
         AND v."fiscalYear" = ${o.fiscalYear} AND v."isPosted" = true AND v."voucherDate" <= ${asOf}::date
         AND (${exJ}::int IS NULL OR v.id <> ${exJ}::int)
         AND l."generalLedgerId" = ${o.generalLedgerId}
         AND (${sub}::int IS NULL OR l."subLedgerId" = ${sub}::int)
      UNION ALL
      SELECT (l."debit" - l."credit") AS amount
        FROM "CashBankVoucherLine" l
        JOIN "CashBankVoucher" v ON v.id = l."cashBankVoucherId"
       WHERE v."companyId" = ${o.companyId} AND v."branchId" = ${o.branchId}
         AND v."fiscalYear" = ${o.fiscalYear} AND v."isPosted" = true AND v."voucherDate" <= ${asOf}::date
         AND (${exC}::int IS NULL OR v.id <> ${exC}::int)
         AND l."generalLedgerId" = ${o.generalLedgerId}
         AND (${sub}::int IS NULL OR l."subLedgerId" = ${sub}::int)
    )
    SELECT COALESCE(SUM(amount), 0)::text AS net FROM movements
  `)) as any[];
  const net = signedPaise(String(bal?.net ?? "0"));

  // Newest first: voucher date, then the later voucher, then the later line.
  const recent = (await tx.execute(sql`
    SELECT * FROM (
      SELECT 'JOURNAL' AS kind, v.id AS "voucherId", v."voucherNumber" AS "voucherNumber", v."voucherDate"::text AS "voucherDate",
             COALESCE(NULLIF(l."narration", ''), NULLIF(v."remarks", '')) AS narration, l."debit"::text AS debit, l."credit"::text AS credit, l.id AS "lineId"
        FROM "JournalVoucherLine" l
        JOIN "JournalVoucher" v ON v.id = l."journalVoucherId"
       WHERE v."companyId" = ${o.companyId} AND v."branchId" = ${o.branchId}
         AND v."fiscalYear" = ${o.fiscalYear} AND v."isPosted" = true AND v."voucherDate" <= ${asOf}::date
         AND (${exJ}::int IS NULL OR v.id <> ${exJ}::int)
         AND l."generalLedgerId" = ${o.generalLedgerId}
         AND (${sub}::int IS NULL OR l."subLedgerId" = ${sub}::int)
      UNION ALL
      SELECT 'CASH_BANK' AS kind, v.id AS "voucherId", v."voucherNumber" AS "voucherNumber", v."voucherDate"::text AS "voucherDate",
             COALESCE(NULLIF(l."narration", ''), NULLIF(v."remarks", '')) AS narration, l."debit"::text AS debit, l."credit"::text AS credit, l.id AS "lineId"
        FROM "CashBankVoucherLine" l
        JOIN "CashBankVoucher" v ON v.id = l."cashBankVoucherId"
       WHERE v."companyId" = ${o.companyId} AND v."branchId" = ${o.branchId}
         AND v."fiscalYear" = ${o.fiscalYear} AND v."isPosted" = true AND v."voucherDate" <= ${asOf}::date
         AND (${exC}::int IS NULL OR v.id <> ${exC}::int)
         AND l."generalLedgerId" = ${o.generalLedgerId}
         AND (${sub}::int IS NULL OR l."subLedgerId" = ${sub}::int)
    ) x
    ORDER BY x."voucherDate" DESC, x."voucherId" DESC, x."lineId" DESC
    LIMIT ${limit}
  `)) as any[];

  return {
    ledger: { id: Number(gl.id), code: String(gl.code), name: String(gl.name), requiresSubLedger: !!gl.requiresSubLedger },
    subLedger: subRow,
    balance: { debit: formatPaise(net > 0n ? net : 0n), credit: formatPaise(net < 0n ? -net : 0n) },
    recent: recent.map((r) => ({
      kind: r.kind === "CASH_BANK" ? "CASH_BANK" : "JOURNAL",
      voucherId: Number(r.voucherId),
      voucherNumber: String(r.voucherNumber),
      voucherDate: String(r.voucherDate).slice(0, 10),
      narration: r.narration === null ? null : String(r.narration),
      debit: money(r.debit),
      credit: money(r.credit),
    })),
  };
}
