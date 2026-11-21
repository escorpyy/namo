import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const route = readFileSync(new URL("../server/routes/ledgerReport.ts", import.meta.url), "utf8");

describe("ledger report SQL identifiers", () => {
  it("quotes mixed-case invoiceNumber columns to match PostgreSQL schema identifiers", () => {
    expect(route).toContain('si."invoiceNumber"');
    expect(route).toContain('pb."invoiceNumber"');
    expect(route).not.toMatch(/\b(?:si|pb)\.invoiceNumber\b/);
  });

  it("uses the same party/ledger Agent in both views and exposes invoice agents separately", () => {
    expect(route).toContain('LEFT JOIN "Party" p ON p."generalLedgerId" = g.id');
    expect(route).toContain('COALESCE(p."agentId", g."agentId") AS "agentId"');
    expect(route).toContain('COALESCE(ledgerParty."agentId", g."agentId") AS "agentId"');
    expect(route).toContain('COALESCE(si."agentId", pb."agentId") AS "invoiceAgentId"');
    expect(route).toContain('invoiceAgent.code AS "invoiceAgentCode"');
    expect(route).toContain('COALESCE(pt."subAreaId", g."subAreaId") AS "subAreaId"');
    // The party is found by one indexed lookup; an OR inside the join condition would force a scan of Party for every line.
    expect(route).toContain('pt.id = COALESCE(s."partyId", (SELECT p0.id FROM "Party" p0 WHERE p0."generalLedgerId" = g.id))');
    expect(route).not.toContain('OR (s."partyId" IS NULL');
  });
});

describe("ledger report source record (Ctrl+Enter)", () => {
  it("exposes the screen and id of the source record, chosen in the same order as the label and number", () => {
    expect(route).toContain(`CASE WHEN si.id IS NOT NULL THEN 'sales-invoices' WHEN ia.id IS NOT NULL THEN 'purchase-import-assessments' WHEN pb.id IS NOT NULL THEN 'purchase-bills' ELSE 'journal' END AS "sourceScreen"`);
    expect(route).toContain('COALESCE(si.id, ia.id, pb.id, v.id) AS "sourceId"');
    expect(route).toContain(`'[]'::jsonb, '[]'::jsonb, 'cash-bank'::text, v.id`);
  });
  it("adds the same two trailing columns to both halves of the UNION", () => {
    expect(route).toContain(`AS "productIds",\n        CASE WHEN si.id IS NOT NULL THEN 'sales-invoices'`);
    expect(route).toContain(`'[]'::jsonb, '[]'::jsonb, 'cash-bank'::text, v.id\n      FROM "CashBankVoucherLine" l`);
  });
});
