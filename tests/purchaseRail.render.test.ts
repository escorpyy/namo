import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RailPanel } from "../src/components/purchase/Rails";
import { VendorLedgerPeek } from "../src/components/purchase/VendorLedgerPeek";

describe("purchase context rail", () => {
  it("provides a keyboard-accessible resize separator for an open panel", () => {
    const out = renderToStaticMarkup(createElement(RailPanel, {
      side: "right", label: "Vendor", collapsed: false, onToggle: () => {}, width: 400, onWidthChange: () => {}, children: "Vendor details",
    }));
    expect(out).toContain('role="separator"');
    expect(out).toContain('aria-label="Resize Vendor"');
    expect(out).toContain('aria-valuenow="400"');
    expect(out).toContain("Vendor details");
  });

  it("does not show a resize handle on a folded rail", () => {
    const out = renderToStaticMarkup(createElement(RailPanel, {
      side: "right", label: "Vendor", collapsed: true, onToggle: () => {}, width: 400, onWidthChange: () => {}, children: "Vendor details",
    }));
    expect(out).not.toContain('role="separator"');
    expect(out).toContain("Vendor");
  });

  it("prompts for a vendor before requesting its ledger", () => {
    const out = renderToStaticMarkup(createElement(VendorLedgerPeek, {
      companyId: 1, branchId: 1, branchName: "Main", fiscalYear: "2082/83", date: "2025-12-31", vendorGLId: "", subLedgerId: "", calendar: "AD",
    }));
    expect(out).toContain("Choose a vendor to peek at its ledger");
  });

  it("requires a valid bill date before showing the ledger balance", () => {
    const out = renderToStaticMarkup(createElement(VendorLedgerPeek, {
      companyId: 1, branchId: 1, branchName: "Main", fiscalYear: "2082/83", date: "2026-02-31", vendorGLId: "10", subLedgerId: "", calendar: "AD",
    }));
    expect(out).toContain("Enter a valid invoice date");
  });
});
