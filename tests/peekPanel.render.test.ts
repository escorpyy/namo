import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PeekPanel, PeekToggle, type PeekPanelProps } from "../src/components/PeekPanel";

// The account panel before any answer from the server: closed, no account under the cursor, no valid date, waiting for the first answer.
const base: PeekPanelProps = { open: true, onToggle: () => {}, target: null, companyId: 1, branchId: 1, fiscalYear: "2082/83", date: "2025-12-31", pending: 0n, calendar: "AD", ownKind: "JOURNAL" };
const html = (o: Partial<PeekPanelProps> = {}) => renderToStaticMarkup(createElement(PeekPanel, { ...base, ...o }));

describe("PeekPanel (static render)", () => {
  it("draws nothing while closed", () => {
    expect(html({ open: false })).toBe("");
  });
  it("is a labelled side region that cannot pull the cursor out of a field", () => {
    const out = html();
    expect(out).toContain('aria-label="Account panel"');
    expect(out).toContain('role="complementary"');
    expect(out).toContain("Move to a ledger line");
  });
  it("asks for a valid date before it can show a balance", () => {
    expect(html({ target: { glId: 5, subId: null }, date: "" })).toContain("Choose a valid voucher date");
    expect(html({ target: { glId: 5, subId: null }, date: "2026-02-31" })).toContain("Choose a valid voucher date");
  });
  it("says it is loading until the first answer arrives", () => {
    expect(html({ target: { glId: 5, subId: null } })).toContain("Loading…");
  });
  it("the header button shows the F6 key and its state, and is not a tab stop", () => {
    const out = renderToStaticMarkup(createElement(PeekToggle, { open: true, onClick: () => {} }));
    expect(out).toContain("F6");
    expect(out).toContain('aria-pressed="true"');
    expect(out).toContain('tabindex="-1"');
  });
});
