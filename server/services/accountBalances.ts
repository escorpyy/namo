import { sql } from "drizzle-orm";
import { db } from "../db";
import { formatPaise } from "../../shared/cashBankVoucher";
import { parseDate, type Tx } from "./purchase/common";

export interface AccountBalanceInput {
  companyId: number;
  branchId: number;
  fiscalYear: string;
  date: string;
  excludeJournalVoucherId?: number | null;
  excludeCashBankVoucherId?: number | null;
}

export interface AccountBalanceRow {
  generalLedgerId: number;
  subLedgerId: number | null;
  debit: string;
  credit: string;
}

function signedPaise(value: string): bigint {
  // The database sums numeric columns that carry more than two decimals (e.g. "500.000000"), so accept any number of
  // decimals and round the magnitude half-up to whole paise.
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!m) throw new Error(`Unreadable account balance from the database: ${value}`);
  const frac = (m[3] ?? "") + "000";
  let cents = BigInt(m[2]) * 100n + BigInt(frac.slice(0, 2));
  if (frac.charCodeAt(2) >= 53) cents += 1n; // third decimal digit 5-9 rounds up
  return m[1] ? -cents : cents;
}

/**
 * Opening plus posted journal and cash/bank movements in one branch and fiscal year,
 * through the voucher date. A row with subLedgerId=null is the whole-ledger balance;
 * non-null rows are the corresponding sub-ledger balances.
 */
export async function accountBalances(
  o: AccountBalanceInput,
  tx: Pick<Tx, "execute"> = db,
): Promise<AccountBalanceRow[]> {
  // postgres-js expects string/Buffer parameters for raw SQL; do not interpolate a JS Date object.
  const asOf = parseDate(o.date, "date").toISOString().slice(0, 10);
  const raw = (await tx.execute(sql`
    WITH movements AS (
      SELECT ob."generalLedgerId" AS gl_id, ob."subLedgerId" AS sub_id, (ob."debit" - ob."credit") AS amount
        FROM "OpeningBalance" ob
        JOIN "FiscalYear" fy ON fy.id = ob."fiscalYearId"
       WHERE ob."companyId" = ${o.companyId} AND ob."branchId" = ${o.branchId}
         AND fy."companyId" = ${o.companyId} AND fy."code" = ${o.fiscalYear}
      UNION ALL
      SELECT l."generalLedgerId" AS gl_id, l."subLedgerId" AS sub_id, (l."debit" - l."credit") AS amount
        FROM "JournalVoucherLine" l
        JOIN "JournalVoucher" v ON v.id = l."journalVoucherId"
       WHERE v."companyId" = ${o.companyId} AND v."branchId" = ${o.branchId}
         AND v."fiscalYear" = ${o.fiscalYear} AND v."isPosted" = true AND v."voucherDate" <= ${asOf}::date
         AND (${o.excludeJournalVoucherId ?? null}::int IS NULL OR v.id <> ${o.excludeJournalVoucherId ?? null}::int)
      UNION ALL
      SELECT l."generalLedgerId" AS gl_id, l."subLedgerId" AS sub_id, (l."debit" - l."credit") AS amount
        FROM "CashBankVoucherLine" l
        JOIN "CashBankVoucher" v ON v.id = l."cashBankVoucherId"
       WHERE v."companyId" = ${o.companyId} AND v."branchId" = ${o.branchId}
         AND v."fiscalYear" = ${o.fiscalYear} AND v."isPosted" = true AND v."voucherDate" <= ${asOf}::date
         AND (${o.excludeCashBankVoucherId ?? null}::int IS NULL OR v.id <> ${o.excludeCashBankVoucherId ?? null}::int)
    ), balances AS (
      SELECT gl_id, NULL::integer AS sub_id, SUM(amount) AS net
        FROM movements GROUP BY gl_id
      UNION ALL
      SELECT gl_id, sub_id, SUM(amount) AS net
        FROM movements WHERE sub_id IS NOT NULL GROUP BY gl_id, sub_id
    )
    SELECT gl_id AS "generalLedgerId", sub_id AS "subLedgerId", net::text AS net
      FROM balances
  `)) as any[];

  return raw.map((r) => {
    const net = signedPaise(String(r.net));
    return {
      generalLedgerId: Number(r.generalLedgerId),
      subLedgerId: r.subLedgerId === null ? null : Number(r.subLedgerId),
      debit: formatPaise(net > 0n ? net : 0n),
      credit: formatPaise(net < 0n ? -net : 0n),
    };
  });
}
