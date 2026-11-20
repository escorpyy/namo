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
    expect(route).toContain('s."partyId" IS NULL AND pt."generalLedgerId" = g.id');
  });
});
