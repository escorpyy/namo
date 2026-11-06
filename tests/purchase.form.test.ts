import { describe, expect, it } from "vitest";
import { addDaysIso } from "../src/lib/purchaseForm";

// The due date on a bill follows its invoice date and due days: whole calendar days, month and year ends included, never a timezone slip.
describe("addDaysIso", () => {
  it("adds whole days across month, year and leap-day ends", () => {
    expect(addDaysIso("2025-10-14", 30)).toBe("2025-11-13");
    expect(addDaysIso("2025-12-20", 15)).toBe("2026-01-04");
    expect(addDaysIso("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDaysIso("2027-02-28", 1)).toBe("2027-03-01");
    expect(addDaysIso("2025-10-14", 0)).toBe("2025-10-14");
  });
  it("answers an empty string when the start or the days are not usable", () => {
    expect(addDaysIso("", 5)).toBe("");
    expect(addDaysIso("2025-13-40", 5)).toBe("");
    expect(addDaysIso("?2025", 5)).toBe("");
    expect(addDaysIso("2025-10-14", -1)).toBe("");
    expect(addDaysIso("2025-10-14", 1.5)).toBe("");
  });
});
