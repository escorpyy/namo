import { Router } from "express";
import { and, asc, eq, getTableColumns, getTableName, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { HttpError, wrap } from "./_util";
import type { FieldDef, MasterDef } from "../../shared/masters";

type CountSrc = { table: any; column: string };
type RefSrc = { table: any; column: string; via: string };

export interface ServerCfg {
  table: any;
  scope?: "global"; // company-scoped nahi (Company, User): list sab ki, insert me companyId nahi
  parent?: { column: string; table: any }; // child masters (company parent ke through)
  counts?: Record<string, CountSrc | CountSrc[]>;
  refs?: Record<string, RefSrc>; // doosri table ka column list me laana (jaise userName)
  orderBy?: (t: any, extras: Record<string, any>) => any;
  validate?: (data: Record<string, any>, ctx: { companyId: number; id?: number }) => Promise<void>;
  afterWrite?: (data: Record<string, any>, id: number) => Promise<void>; // save ke baad related rows sync karne ke liye
  beforeDelete?: (row: Record<string, any>) => Promise<void>;
}

const fieldOf = (def: MasterDef, name: string) => def.fields.find((f) => f.name === name)!;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const validIso = (v: string) => {
  const d = new Date(v + "T00:00:00Z");
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

// Shared definition se zod schema: server me wahi rules jo UI me dikhte hain. readOnly fields schema me nahi (ignore hote hain).
export function buildSchema(def: MasterDef) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of def.fields) {
    if (f.readOnly) continue;
    const req = !!f.required;
    const msgReq = `${f.label} is required.`;
    let s: z.ZodTypeAny;
    if (f.type === "text") {
      let b: z.ZodTypeAny = z.string({ required_error: msgReq, invalid_type_error: msgReq }).trim().max(f.max ?? 255, `${f.label} can be at most ${f.max} characters.`);
      if (req) b = (b as z.ZodString).min(1, msgReq);
      if (f.format === "email") b = b.refine((v: string) => v === "" || EMAIL.test(v), "Enter a valid email address.");
      const norm = (v: string) => (f.upper ? v.toUpperCase() : f.lower ? v.toLowerCase() : v);
      s = req ? b.transform(norm) : z.union([b, z.null()]).optional().transform((v) => (v == null || v === "" ? null : norm(v as string)));
    } else if (f.type === "number") {
      let n = z.number({ required_error: msgReq, invalid_type_error: `${f.label} must be a number.` });
      if (f.decimals === 0) n = n.int(`${f.label} must be a whole number.`);
      if (f.min != null) n = n.min(f.min, `${f.label} must be at least ${f.min}.`);
      if (f.maxValue != null) n = n.max(f.maxValue, `${f.label} must be at most ${f.maxValue}.`);
      s = req ? n : n.nullable().optional();
    } else if (f.type === "date") {
      const msg = `${f.label} must be a valid date (YYYY-MM-DD).`;
      const d = z.string({ required_error: msgReq, invalid_type_error: msg }).regex(/^\d{4}-\d{2}-\d{2}$/, msg).refine(validIso, msg);
      s = req ? d : z.union([d, z.null()]).optional();
    } else if (f.type === "select") {
      const e = z.enum(f.options!.map((o) => o.value) as [string, ...string[]], { errorMap: () => ({ message: msgReq }) });
      s = req ? e : e.nullable().optional();
    } else if (f.type === "lookup") {
      const n = z.number({ required_error: msgReq, invalid_type_error: msgReq }).int();
      s = req ? n : n.nullable().optional();
    } else {
      s = z.boolean();
    }
    shape[f.name] = s;
  }
  return z.object(shape);
}

function toDb(def: MasterDef, data: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const f of def.fields) {
    if (f.readOnly) continue; // isClosed jaise fields form se kabhi nahi badalte
    const v = data[f.name] ?? null;
    if (f.type === "date") out[f.name] = v == null ? null : new Date(v + "T00:00:00Z");
    else out[f.name] = f.type === "number" && v != null && (f.decimals ?? 0) > 0 ? String(v) : v; // numeric column string leta hai
  }
  return out;
}

export function masterRouter(def: MasterDef, cfg: ServerCfg) {
  const r = Router();
  const t = cfg.table;
  const schema = buildSchema(def);
  const tName = getTableName(t);
  const global = cfg.scope === "global";

  const parse = (raw: unknown) => {
    const p = schema.safeParse(raw);
    if (!p.success) {
      const issue = p.error.issues[0];
      throw new HttpError(400, issue.message, String(issue.path[0] ?? ""));
    }
    return p.data as Record<string, any>;
  };

  const selectRows = (o: { companyId?: number; id?: number }) => {
    const outer = (col: string) => sql`${sql.identifier(tName)}.${sql.identifier(col)}`; // outer table explicit qualify: inner "id" se confuse na ho
    const extras: Record<string, any> = {};
    for (const [k, c] of Object.entries(cfg.counts ?? {})) {
      // Ek count kai tables ka jod ho sakta hai (jaise Journal + Cash/Bank lines)
      const parts = (Array.isArray(c) ? c : [c]).map(
        (x) => sql`(select count(*)::int from ${sql.identifier(getTableName(x.table))} ref where ref.${sql.identifier(x.column)} = ${outer("id")})`,
      );
      extras[k] = sql<number>`(${sql.join(parts, sql` + `)})`;
    }
    for (const [k, x] of Object.entries(cfg.refs ?? {})) {
      extras[k] = sql`(select ref.${sql.identifier(x.column)} from ${sql.identifier(getTableName(x.table))} ref where ref."id" = ${outer(x.via)})`;
    }
    const conds: any[] = [];
    if (o.id != null) conds.push(eq(t.id, o.id));
    if (o.companyId != null && !global) {
      conds.push(
        cfg.parent
          ? inArray(t[cfg.parent.column], db.select({ id: cfg.parent.table.id }).from(cfg.parent.table).where(eq(cfg.parent.table.companyId, o.companyId)))
          : eq(t.companyId, o.companyId),
      );
    }
    return db.select({ ...getTableColumns(t), ...extras }).from(t).where(and(...conds)).orderBy(cfg.orderBy ? cfg.orderBy(t, extras) : asc(t.code));
  };

  const parentCompany = async (parentId: number): Promise<number | null> => {
    const [p] = await db.select({ companyId: cfg.parent!.table.companyId }).from(cfg.parent!.table).where(eq(cfg.parent!.table.id, parentId));
    return p?.companyId ?? null;
  };

  async function assertUnique(data: Record<string, any>, companyId: number | null, excludeId?: number) {
    for (const set of def.unique) {
      const conds: any[] = [];
      let skip = false;
      for (const name of set) {
        const v = data[name];
        if (v == null) { skip = true; break; }
        conds.push(fieldOf(def, name).type === "text" ? sql`lower(${t[name]}) = ${String(v).toLowerCase()}` : eq(t[name], v));
      }
      if (skip) continue;
      if (!cfg.parent && !global && companyId != null) conds.push(eq(t.companyId, companyId));
      if (excludeId != null) conds.push(ne(t.id, excludeId));
      const [hit] = await db.select({ id: t.id }).from(t).where(and(...conds)).limit(1);
      if (hit) {
        const last = [...set].reverse().find((n) => fieldOf(def, n).type === "text")!;
        const f = fieldOf(def, last);
        throw new HttpError(409, `${f.label} '${data[last]}' already exists in this ${def.uniqueScope === "system" ? "system" : def.parent ? def.parent.label : global ? "system" : "company"}.`, last);
      }
    }
  }

  r.get("/", wrap(async (req, res) => {
    const companyId = Number(req.query.companyId);
    if (!Number.isInteger(companyId) && !global) throw new HttpError(400, "companyId is required.");
    res.json(await selectRows({ companyId }));
  }));

  r.post("/", wrap(async (req, res) => {
    const companyId = Number(req.query.companyId);
    if (!Number.isInteger(companyId) && !global) throw new HttpError(400, "companyId is required.");
    const data = parse(req.body);
    if (cfg.parent && (await parentCompany(data[def.parent!.field])) !== companyId)
      throw new HttpError(400, `${def.parent!.label} not found in this company.`, def.parent!.field);
    await cfg.validate?.(data, { companyId: global ? 0 : companyId });
    await assertUnique(data, global ? null : companyId);
    const values = { ...toDb(def, data), ...(cfg.parent || global ? {} : { companyId }) };
    const [created] = await db.insert(t).values(values).returning({ id: t.id });
    await cfg.afterWrite?.(data, created.id);
    res.status(201).json((await selectRows({ id: created.id }))[0]);
  }));

  r.put("/:id", wrap(async (req, res) => {
    const id = Number(req.params.id);
    const [existing] = await db.select().from(t).where(eq(t.id, id));
    if (!existing) throw new HttpError(404, `${def.singular} not found.`);
    const companyId: number = global ? id : cfg.parent ? (await parentCompany(existing[cfg.parent.column]))! : existing.companyId;
    const data = parse(req.body);
    if (cfg.parent && (await parentCompany(data[def.parent!.field])) !== companyId)
      throw new HttpError(400, `${def.parent!.label} must belong to the same company.`, def.parent!.field);
    await cfg.validate?.(data, { companyId, id });
    await assertUnique(data, global ? null : companyId, id);
    await db.update(t).set(toDb(def, data)).where(eq(t.id, id));
    await cfg.afterWrite?.(data, id);
    res.json((await selectRows({ id }))[0]);
  }));

  r.delete("/:id", wrap(async (req, res) => {
    if (def.noDelete) throw new HttpError(409, def.noDelete);
    const id = Number(req.params.id);
    const [row] = await selectRows({ id });
    if (!row) throw new HttpError(404, `${def.singular} not found.`);
    for (const c of def.counts ?? []) {
      const n = (row as any)[c.key] as number;
      if (n > 0) throw new HttpError(409, `Cannot delete: ${n} ${c.label} linked to this ${def.singular}.`);
    }
    await cfg.beforeDelete?.(row as Record<string, any>);
    await db.delete(t).where(eq(t.id, id));
    res.json({ ok: true });
  }));

  return r;
}
