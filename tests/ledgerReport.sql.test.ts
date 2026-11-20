import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const route = readFileSync(new URL("../server/routes/ledgerReport.ts", import.meta.url), "utf8");

describe("ledger report SQL identifiers", () => {
  it("quotes mixed-case invoiceNumber columns to match PostgreSQL schema identifiers", () => {
    expect(route).toContain('si."invoiceNumber"');
    expect(route).toContain('pb."invoiceNumber"');
    expect(route).not.toMatch(/\b(?:si|pb)\.invoiceNumber\b/);
  });

  it("keeps summary dimensions stable while using source-document agents on transaction rows", () => {
    expect(route).toContain('LEFT JOIN "Party" p ON p."generalLedgerId" = g.id');
    expect(route).toContain('COALESCE(p."agentId", g."agentId") AS "agentId"');
    expect(route).toContain('COALESCE(si."agentId", pb."agentId", pt."agentId", g."agentId") AS "agentId"');
    expect(route).toContain('COALESCE(pt."subAreaId", g."subAreaId") AS "subAreaId"');
    // The party is found by one indexed lookup; an OR inside the join condition would force a scan of Party for every line.
    expect(route).toContain('pt.id = COALESCE(s."partyId", (SELECT p0.id FROM "Party" p0 WHERE p0."generalLedgerId" = g.id))');
    expect(route).not.toContain('OR (s."partyId" IS NULL');
  });
});
