import { describe, expect, it } from "vitest";
import { CODE_SPECS, codeMax, codeSpec, exampleCode, name2, nextCode, parseTemplate, prefixOf, templateProblems } from "../shared/codeRules";
import { MASTERS } from "../shared/masters";

// The code-numbering rule language: parsing, what a template can be used for, and the next number under a prefix.

const party = codeSpec("party")!, product = codeSpec("products")!;

describe("templates", () => {
  it("accepts the tokens and a running number at the end", () => {
    expect(parseTemplate("{NAME2}{TYPE}{SEQ:3}").problems).toEqual([]);
    expect(parseTemplate("{parent}-{seq:4}").problems).toEqual([]); // upper-cased for you
    expect(parseTemplate("PB/{SEQ:5}").tokens).toEqual([{ t: "lit", v: "PB/" }, { t: "seq", n: 5 }]);
  });
  it("refuses a template that does not end with one running number, or has unknown tokens or characters", () => {
    expect(parseTemplate("").problems).toHaveLength(1);
    expect(parseTemplate("{PARENT}").problems.join()).toMatch(/running number/);
    expect(parseTemplate("{SEQ:3}{PARENT}").problems.join()).toMatch(/running number/);
    expect(parseTemplate("{SEQ:2}{SEQ:2}").problems.join()).toMatch(/running number/);
    expect(parseTemplate("{SEQ:9}").problems.join()).toMatch(/Unknown token/);
    expect(parseTemplate("{FOO}{SEQ:3}").problems.join()).toMatch(/Unknown token/);
    expect(parseTemplate("A B{SEQ:3}").problems.join()).toMatch(/not allowed/);
    expect(parseTemplate("{PARENT{SEQ:3}").problems.length).toBeGreaterThan(0);
  });
  it("a token needs the master to have that thing", () => {
    expect(templateProblems(party, "{PARENT}{SEQ:3}").join()).toMatch(/no parent/);
    expect(templateProblems(codeSpec("account-groups")!, "{TYPE}{SEQ:3}").join()).toMatch(/no type/);
    expect(templateProblems(product, "{PARENT}{SEQ:3}")).toEqual([]);
    expect(templateProblems(party, "{NAME2}{TYPE}{SEQ:3}")).toEqual([]);
  });
  it("refuses a template whose longest code would not fit the Code field", () => {
    expect(templateProblems(codeSpec("product-groups")!, "LONGER-XYZ{NAME2}{SEQ:6}").join()).toMatch(/at most 10/);
  });
  it("every built-in default is valid for its own master, and every master exists with a Code field", () => {
    for (const s of CODE_SPECS) {
      expect(MASTERS[s.key], s.key).toBeTruthy();
      expect(MASTERS[s.key].fields.some((f) => f.name === "code"), s.key).toBe(true);
      expect(templateProblems(s, s.defaultTemplate), s.key).toEqual([]);
      for (const f of [s.parentField, s.typeField, s.nameField]) if (f) expect(MASTERS[s.key].fields.some((x) => x.name === f), `${s.key}.${f}`).toBe(true);
    }
  });
});

describe("making the code", () => {
  it("NAME2 is the first two letters or digits, upper case", () => {
    expect(name2("Ramesh Traders")).toBe("RA");
    expect(name2("  r-k Stores")).toBe("RK");
    expect(name2("7 Eleven")).toBe("7E");
    expect(name2("Z")).toBe("Z");
    expect(name2("रमेश")).toBe("");
    expect(name2(null)).toBe("");
  });
  it("the prefix needs every value the template uses", () => {
    expect(prefixOf(party, "{NAME2}{TYPE}{SEQ:3}", { name: "Ramesh", type: "VENDOR" })).toEqual({ prefix: "RAV", width: 3 });
    expect(prefixOf(party, "{NAME2}{TYPE}{SEQ:3}", { name: "Ramesh", type: "CUSTOMER" })).toEqual({ prefix: "RAC", width: 3 });
    expect(prefixOf(party, "{NAME2}{TYPE}{SEQ:3}", { name: "", type: "VENDOR" })).toBeNull();
    expect(prefixOf(product, "{PARENT}{SEQ:3}", { parent: null })).toBeNull();
    expect(prefixOf(product, "{PARENT}{SEQ:3}", { parent: "fd01" })).toEqual({ prefix: "FD01", width: 3 });
    expect(prefixOf(product, "{PARENT}{TYPE}{SEQ:3}", { parent: "FD", type: "SERVICE" })).toEqual({ prefix: "FDE", width: 3 });
  });
  it("the next number is the highest used under the prefix plus one, padded, growing past its width", () => {
    expect(nextCode("FD", 3, [])).toBe("FD001");
    expect(nextCode("FD", 3, ["FD001", "FD002", "FD007"])).toBe("FD008");
    expect(nextCode("FD", 3, ["FD999"])).toBe("FD1000");
    expect(nextCode("FD", 3, ["fd004"])).toBe("FD005"); // case does not matter
  });
  it("only counts codes that really are prefix + digits, so other codes are left alone", () => {
    expect(nextCode("FD", 3, ["FD001", "FDX005", "FD-9", "FD12", "FOOD009"])).toBe("FD002");
    expect(nextCode("RAV", 3, ["RAC004", "RAV001"])).toBe("RAV002");
    expect(nextCode("10", 2, ["1001", "1002", "1003", "10"])).toBe("1004");
  });
  it("shows an example for a template", () => {
    expect(exampleCode(party, "{NAME2}{TYPE}{SEQ:3}")).toBe("RAC001");
    expect(exampleCode(product, "{PARENT}{SEQ:3}")).toMatch(/^\d{2}001$/);
    expect(exampleCode(party, "{PARENT}{SEQ:3}")).toBe("");
    expect(codeMax("general-ledger")).toBe(20);
  });
});
