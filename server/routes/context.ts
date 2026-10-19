import { Router } from "express";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { branch, company, fiscalYear, user } from "../db/schema";
import { wrap } from "./_util";

export const contextRouter = Router();

// Header switcher ka data: Company -> Branch -> Fiscal Year
contextRouter.get(
  "/",
  wrap(async (_req, res) => {
    const [companies, branches, years, users] = await Promise.all([
      db.select().from(company).where(eq(company.isActive, true)).orderBy(asc(company.name)),
      db.select().from(branch).where(eq(branch.isActive, true)).orderBy(asc(branch.name)),
      db.select().from(fiscalYear).orderBy(desc(fiscalYear.startDate)),
      db.select().from(user).where(eq(user.isActive, true)).orderBy(asc(user.id)).limit(1),
    ]);

    res.json({
      user: users[0] ? { id: users[0].id, name: users[0].name } : { id: 0, name: "Guest" },
      companies: companies.map((c) => ({
        id: c.id,
        code: c.code,
        name: c.name,
        branches: branches
          .filter((b) => b.companyId === c.id)
          .map((b) => ({ id: b.id, name: b.name, isHeadOffice: b.isHeadOffice })),
        fiscalYears: years
          .filter((y) => y.companyId === c.id)
          .map((y) => ({ id: y.id, code: y.code, isCurrent: y.isCurrent })),
      })),
    });
  }),
);
