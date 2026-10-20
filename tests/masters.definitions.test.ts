import { describe, expect, it } from "vitest";
import { MASTERS, type MasterDef } from "../shared/masters";

const defs = Object.values(MASTERS);

describe("shared/masters.ts is a usable registry", () => {
  it("is not empty and keys match each definition's key", () => {
    expect(defs.length).toBeGreaterThanOrEqual(22); // README "22 screens" counts 2 grid screens that are not masters
    for (const [k, d] of Object.entries(MASTERS)) expect(d.key).toBe(k);
  });
  it("includes the billing term masters", () => {
    expect(MASTERS["purchase-terms"]).toBeDefined();
    expect(MASTERS["sales-terms"]).toBeDefined();
  });
});

describe.each(defs.map((d) => [d.key, d] as [string, MasterDef]))("master %s", (_key, d) => {
  const names = d.fields.map((f) => f.name);
  // Server-joined display columns: a lookup field "userId" also yields "userName" (see `refs` in server/masters.ts).
  const derived = d.fields.filter((f) => f.type === "lookup").map((f) => f.name.replace(/Id$/, "Name"));
  const known = [...names, ...derived];
  it("has unique field names", () => {
    expect(new Set(names).size).toBe(names.length);
  });
  it("label fields, unique sets, columns, sortBy and counts-driven fields exist", () => {
    for (const n of d.labelFields) expect(known, `labelField ${n}`).toContain(n);
    for (const set of d.unique) for (const n of set) expect(names, `unique ${n}`).toContain(n);
    for (const c of d.columns) expect(known, `column ${c.name}`).toContain(c.name);
    if (d.sortBy) expect(known, `sortBy ${d.sortBy}`).toContain(d.sortBy);
    if (d.parent) expect(names, `parent ${d.parent.field}`).toContain(d.parent.field);
  });
  it("lookups point to real masters; selects have options", () => {
    for (const f of d.fields) {
      if (f.type === "lookup") expect(MASTERS[f.lookup!], `${f.name} -> ${f.lookup}`).toBeDefined();
      if (f.type === "select") expect(f.options?.length, `${f.name} options`).toBeGreaterThan(0);
      if (f.type === "lines") for (const c of f.lines!.columns) if (c.type === "lookup") expect(MASTERS[c.lookup!], `${f.name}.${c.name}`).toBeDefined();
    }
  });
  it("conditional rules reference existing fields", () => {
    for (const f of d.fields) {
      if (f.showIf) expect(names, `${f.name}.showIf`).toContain(f.showIf.field);
      if (f.requiredIf) expect(names, `${f.name}.requiredIf`).toContain(f.requiredIf.field);
    }
  });
  it("select option values are unique and hotkeys do not collide", () => {
    for (const f of d.fields) {
      if (f.type !== "select") continue;
      const vals = f.options!.map((o) => o.value);
      expect(new Set(vals).size, `${f.name} values`).toBe(vals.length);
      const keys = f.options!.map((o) => o.hotkey).filter(Boolean);
      expect(new Set(keys).size, `${f.name} hotkeys`).toBe(keys.length);
    }
  });
});
