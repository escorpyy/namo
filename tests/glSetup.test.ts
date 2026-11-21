import { describe, expect, it, vi } from "vitest";
import { GL_ENTRY_TYPES, GL_SETUP_ROLES, type GlRoleKey } from "../shared/glSetup";
import { assertGlEntryAllowed, assertGlRolesAllowed } from "../server/services/glEntryControl";

function txReturning(rows: unknown[]) {
  const where = vi.fn(async () => rows);
  const join = { where };
  const query = { from: () => ({ innerJoin: () => join, leftJoin: () => join }) };
  return { select: () => query, where };
}

describe("GL Setup roles and entry controls", () => {
  it("defines each requested GL role exactly once and exposes every entry control", () => {
    const expected: GlRoleKey[] = [
      "PROFIT_AND_LOSS", "CASH_BOOK", "SALES_ACCOUNT", "SALES_RETURN_ACCOUNT", "PURCHASE_ACCOUNT",
      "PURCHASE_RETURN_ACCOUNT", "OPENING_STOCK_PL", "CLOSING_STOCK_PL", "CLOSING_STOCK_BS",
    ];
    expect(GL_SETUP_ROLES.map((role) => role.key)).toEqual(expected);
    expect(new Set(GL_SETUP_ROLES.map((role) => role.key)).size).toBe(9);
    expect(GL_ENTRY_TYPES.map((entry) => entry.entryType)).toEqual([
      "JOURNAL", "CASH_BANK", "SALES_INVOICE", "SALES_RETURN", "PURCHASE_BILL", "PURCHASE_RETURN", "OPENING_BALANCE", "STOCK_OPENING",
    ]);
    for (const role of GL_SETUP_ROLES) {
      for (const control of GL_ENTRY_TYPES) expect(typeof role.defaults[control.key]).toBe("boolean");
      expect(role.defaults.isLocked).toBe(false);
    }
  });

  it("does not constrain an unassigned ledger", async () => {
    const tx = txReturning([]);
    await expect(assertGlEntryAllowed(tx as never, 1, [], "JOURNAL")).resolves.toBeUndefined();
    expect(tx.where).not.toHaveBeenCalled();
  });

  it("blocks a mapped ledger when its entry control is off", async () => {
    const tx = txReturning([{ role: "SALES_ACCOUNT", generalLedgerId: 22, isLocked: false, allowed: false, code: "SALE" }]);
    await expect(assertGlEntryAllowed(tx as never, 1, [22], "SALES_INVOICE"))
      .rejects.toThrow(/SALE is not allowed for Sales Invoice/);
  });

  it("blocks a locked ledger even when the entry type is allowed", async () => {
    const tx = txReturning([{ role: "CASH_BOOK", generalLedgerId: 31, isLocked: true, allowed: true, code: "CASH" }]);
    await expect(assertGlEntryAllowed(tx as never, 1, [31], "CASH_BANK"))
      .rejects.toThrow(/CASH is locked in GL Setup/);
  });

  it("allows a mapped ledger when it is unlocked and the selected entry control is enabled", async () => {
    const tx = txReturning([{ role: "PURCHASE_ACCOUNT", generalLedgerId: 41, isLocked: false, allowed: true, code: "PUR" }]);
    await expect(assertGlEntryAllowed(tx as never, 1, [41], "PURCHASE_BILL")).resolves.toBeUndefined();
  });

  it("checks mapped stock roles even where product mappings are resolved by a separate workflow", async () => {
    const tx = txReturning([{ role: "CLOSING_STOCK_BS", generalLedgerId: 51, isLocked: false, allowed: false, code: "STOCK" }]);
    await expect(assertGlRolesAllowed(tx as never, 1, ["CLOSING_STOCK_BS"], "STOCK_OPENING"))
      .rejects.toThrow(/STOCK is not allowed for Stock Opening/);
  });
});
