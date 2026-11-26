import { describe, expect, it } from "vitest";
import { buildStatement, StatementEngineError, type EngineInput, type EngineLine } from "../server/services/statementEngine/index";

const line = (id: number, code: string, lineType: EngineLine["lineType"] = "MAPPED", overrides: Partial<EngineLine> = {}): EngineLine => ({
  id, code, label: code, statement: "PL", parentLineId: null, sortOrder: id, lineType,
  nature: lineType === "MAPPED" ? "DEBIT" : null, role: null,
  allowedTypes: lineType === "MAPPED" ? ["ASSET", "REVENUE", "EXPENSE"] : [], showWhenZero: true,
  ...overrides,
});
const ledger = (id: number, amount: string, overrides: Partial<EngineInput["ledgers"][number]> = {}): EngineInput["ledgers"][number] => ({
  id, code: `GL-${id}`, name: `Ledger ${id}`, accountGroupId: 10, accountSubGroupId: 20,
  accountType: "ASSET", isCashOrBank: false, amount, ...overrides,
});
const flat = (rows: ReturnType<typeof buildStatement>["rows"]): Map<string, string | null> => {
  const out = new Map<string, string | null>();
  const walk = (items: typeof rows) => items.forEach((r) => { out.set(r.code, r.amount); walk(r.children); });
  walk(rows);
  return out;
};

const base: EngineInput = { statement: "PL", lines: [], mappings: [], formulas: [], ledgers: [] };

describe("statement engine", () => {
  it("resolves ledger-specific mappings ahead of subgroup and group mappings", () => {
    const output = buildStatement({
      ...base,
      lines: [line(1, "GROUP"), line(2, "SUBGROUP"), line(3, "LEDGER")],
      mappings: [
        { lineId: 1, selector: { accountGroupId: 10 } },
        { lineId: 2, selector: { accountSubGroupId: 20 } },
        { lineId: 3, selector: { generalLedgerId: 7 } },
      ],
      ledgers: [ledger(7, "125.00")],
    });
    const amounts = flat(output.rows);
    expect(amounts.get("GROUP")).toBe("0.00");
    expect(amounts.get("SUBGROUP")).toBe("0.00");
    expect(amounts.get("LEDGER")).toBe("125.00");
  });

  it("uses a GL Setup fallback only when the role is unassigned", () => {
    const input: EngineInput = {
      ...base,
      lines: [line(1, "CASH")],
      mappings: [{ lineId: 1, selector: { glSetupRole: "CASH", fallbackGeneralLedgerId: 22 } }],
      ledgers: [ledger(11, "5.00"), ledger(22, "7.00")],
    };
    const assigned = buildStatement({ ...input, roleLedgerIds: { CASH: 11 } });
    expect(flat(assigned.rows).get("CASH")).toBe("5.00");
    expect(assigned.unmapped.map((l) => l.id)).toEqual([22]);

    const fallback = buildStatement({ ...input, roleLedgerIds: { CASH: null } });
    expect(flat(fallback.rows).get("CASH")).toBe("7.00");
    expect(fallback.unmapped.map((l) => l.id)).toEqual([11]);
  });

  it("applies natural signs and evaluates formulas using fixed-point arithmetic", () => {
    const output = buildStatement({
      ...base,
      lines: [
        line(1, "REVENUE", "MAPPED", { nature: "CREDIT", allowedTypes: ["REVENUE"] }),
        line(2, "EXPENSE", "MAPPED", { nature: "DEBIT", allowedTypes: ["EXPENSE"] }),
        line(3, "SURPLUS", "COMPUTED"),
      ],
      mappings: [
        { lineId: 1, selector: { generalLedgerId: 1 } },
        { lineId: 2, selector: { generalLedgerId: 2 } },
      ],
      formulas: [{ lineId: 3, termLineId: 1, sign: 1, sortOrder: 1 }, { lineId: 3, termLineId: 2, sign: -1, sortOrder: 2 }],
      ledgers: [ledger(1, "-100.00", { accountType: "REVENUE" }), ledger(2, "40.00", { accountType: "EXPENSE" })],
    });
    const amounts = flat(output.rows);
    expect(amounts.get("REVENUE")).toBe("100.00");
    expect(amounts.get("EXPENSE")).toBe("40.00");
    expect(amounts.get("SURPLUS")).toBe("60.00");
  });

  it("rejects formula cycles", () => {
    expect(() => buildStatement({
      ...base,
      lines: [line(1, "A", "COMPUTED"), line(2, "B", "COMPUTED")],
      formulas: [{ lineId: 1, termLineId: 2, sign: 1, sortOrder: 1 }, { lineId: 2, termLineId: 1, sign: 1, sortOrder: 1 }],
    })).toThrowError(StatementEngineError);
    try {
      buildStatement({
        ...base,
        lines: [line(1, "A", "COMPUTED"), line(2, "B", "COMPUTED")],
        formulas: [{ lineId: 1, termLineId: 2, sign: 1, sortOrder: 1 }, { lineId: 2, termLineId: 1, sign: 1, sortOrder: 1 }],
      });
    } catch (error) {
      expect((error as StatementEngineError).code).toBe("FORMULA_CYCLE");
    }
  });

  it("rejects same-specificity mapping conflicts and disallowed account types", () => {
    expect(() => buildStatement({
      ...base, lines: [line(1, "A"), line(2, "B")],
      mappings: [{ lineId: 1, selector: { generalLedgerId: 5 } }, { lineId: 2, selector: { generalLedgerId: 5 } }],
      ledgers: [ledger(5, "1.00")],
    })).toThrowError(/multiple mappings at the same specificity/);

    expect(() => buildStatement({
      ...base,
      lines: [line(1, "ONLY_REVENUE", "MAPPED", { allowedTypes: ["REVENUE"] })],
      mappings: [{ lineId: 1, selector: { generalLedgerId: 5 } }],
      ledgers: [ledger(5, "1.00", { accountType: "ASSET" })],
    })).toThrowError(/is not allowed/);
  });

  it("returns only non-zero unmapped ledger balances with paisa rounding", () => {
    const output = buildStatement({
      ...base,
      ledgers: [ledger(1, "1.235"), ledger(2, "-2.00"), ledger(3, "0.00")],
    });
    expect(output.unmapped).toEqual([
      { id: 1, code: "GL-1", name: "Ledger 1", accountType: "ASSET", amount: "1.24" },
      { id: 2, code: "GL-2", name: "Ledger 2", accountType: "ASSET", amount: "-2.00" },
    ]);
  });
});
