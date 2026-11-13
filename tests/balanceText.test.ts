import { describe, expect, it } from "vitest";
import { drCrText } from "../src/lib/balanceText";

describe("drCrText", () => {
  it("shows one side only", () => {
    expect(drCrText("500.00", "0.00")).toBe("NPR 500.00 Dr");
    expect(drCrText("0.00", "120.00")).toBe("NPR 120.00 Cr");
    expect(drCrText("0.00", "0.00")).toBe("NPR 0.00");
  });
  it("groups digits the Indian way", () => {
    expect(drCrText("1284500.00", "0.00")).toBe("NPR 12,84,500.00 Dr");
  });
});
