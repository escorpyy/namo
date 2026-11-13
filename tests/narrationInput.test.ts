import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NarrationInput, filterNarrations } from "../src/components/NarrationInput";
import type { NarrationEntry } from "../src/lib/narrations";

// The searchable list behind the Down arrow of a narration / remarks field (the keyboard behaviour itself needs a browser).

const E = (id: number, code: string, narration: string): NarrationEntry => ({ id, code, narration });
const entries = [
  E(1, "CASHDEP", "Being cash deposited in bank"),
  E(2, "CASHWD", "Being cash withdrawn from bank for office use"),
  E(3, "ELEC", "Being electricity bill paid"),
  E(4, "RENT", "Being office rent paid for the month"),
  E(5, "BANK", "Cash received from customer"),
];

describe("filterNarrations", () => {
  it("shows everything, in master order, when nothing is typed", () => {
    expect(filterNarrations(entries, "").map((e) => e.id)).toEqual([1, 2, 3, 4, 5]);
    expect(filterNarrations(entries, "   ").map((e) => e.id)).toEqual([1, 2, 3, 4, 5]);
  });
  it("lists codes that start with the search before text that merely contains it", () => {
    // "cash" starts CASHDEP and CASHWD; entry 5 only has it inside its text
    expect(filterNarrations(entries, "cash").map((e) => e.id)).toEqual([1, 2, 5]);
  });
  it("matches inside the code or the text, ignoring letter case", () => {
    expect(filterNarrations(entries, "ELECTRICITY").map((e) => e.id)).toEqual([3]);
    expect(filterNarrations(entries, "office").map((e) => e.id)).toEqual([2, 4]);
    expect(filterNarrations(entries, "rent").map((e) => e.id)).toEqual([4]);
  });
  it("returns nothing when nothing matches", () => {
    expect(filterNarrations(entries, "zzz")).toEqual([]);
  });
  it("finds Nepali text", () => {
    const ne = [E(1, "BANK", "नगद बैंकमा जम्मा गरियो"), E(2, "RENT", "कार्यालय भाडा बुझाइयो")];
    expect(filterNarrations(ne, "भाडा").map((e) => e.id)).toEqual([2]);
  });
});

describe("<NarrationInput> markup", () => {
  const html = (props: Record<string, unknown>) =>
    renderToStaticMarkup(createElement(NarrationInput, { companyId: 1, value: "", onText: () => {}, ...props }));

  it("is a plain single-line text box that keeps the attributes the screens rely on", () => {
    const out = html({ "data-field": "L.0.n", maxLength: 500, placeholder: "Narration", "aria-label": "Narration line 1", className: "fld" });
    expect(out).toMatch(/^<input /);
    for (const part of ['data-field="L.0.n"', 'maxLength="500"', 'aria-label="Narration line 1"', 'class="fld"', 'autoComplete="off"', 'type="text"']) expect(out).toContain(part);
    expect(out).toContain('placeholder="Narration"'); // no hint until there is a list to offer
  });
  it("is a <textarea> with its rows when multiline", () => {
    const out = html({ multiline: true, value: "Paid", rows: 2, "data-field": "remarks" });
    expect(out).toMatch(/^<textarea /);
    expect(out).toContain('rows="2"');
    expect(out).toContain('data-field="remarks"');
    expect(out).toContain(">Paid</textarea>");
  });
  it("renders disabled when the screen is read-only", () => {
    expect(html({ disabled: true })).toContain("disabled");
  });
});
