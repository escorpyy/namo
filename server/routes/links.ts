import { eq } from "drizzle-orm";
import { db } from "../db";
import * as S from "../db/schema";
import { HttpError } from "./_util";

// GL.companyId / Party.companyId denormalized hain (trigger db:push se nahi banta): linked rows usi company ke hone chahiye.
export async function assertSubGroup(id: number, companyId: number): Promise<string> {
  const [r] = await db
    .select({ c: S.accountGroup.companyId, type: S.accountGroup.type })
    .from(S.accountSubGroup)
    .innerJoin(S.accountGroup, eq(S.accountSubGroup.accountGroupId, S.accountGroup.id))
    .where(eq(S.accountSubGroup.id, id));
  if (r?.c !== companyId) throw new HttpError(400, "Sub Group not found in this company.", "accountSubGroupId");
  return r.type;
}

export async function assertSubArea(id: number | null | undefined, companyId: number) {
  if (id == null) return;
  const [r] = await db.select({ c: S.area.companyId }).from(S.subArea).innerJoin(S.area, eq(S.subArea.areaId, S.area.id)).where(eq(S.subArea.id, id));
  if (r?.c !== companyId) throw new HttpError(400, "Sub Area not found in this company.", "subAreaId");
}

export async function assertAgent(id: number | null | undefined, companyId: number) {
  if (id == null) return;
  const [r] = await db.select({ c: S.agent.companyId }).from(S.agent).where(eq(S.agent.id, id));
  if (r?.c !== companyId) throw new HttpError(400, "Agent not found in this company.", "agentId");
}

// Asset/Expense ka normal balance Debit, baaki Credit
export const normalBalanceFor = (groupType: string) => (groupType === "ASSET" || groupType === "EXPENSE" ? "DEBIT" : "CREDIT");
