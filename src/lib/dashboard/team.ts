import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { ensureUser } from "@/lib/onboarding";

export async function listMembers(businessId: string) {
  return db
    .select({
      memberId: schema.businessMembers.id,
      userId: schema.profiles.id,
      email: schema.profiles.email,
      fullName: schema.profiles.fullName,
      role: schema.businessMembers.role,
    })
    .from(schema.businessMembers)
    .innerJoin(schema.profiles, eq(schema.profiles.id, schema.businessMembers.userId))
    .where(eq(schema.businessMembers.businessId, businessId))
    .orderBy(asc(schema.businessMembers.role), asc(schema.profiles.email));
}

// Creates the account if needed, which emails the person an invitation;
// someone who already has an account signs in from the login page as usual.
export async function inviteMember(businessId: string, email: string, role: "owner" | "staff") {
  const user = await ensureUser(email);
  const [row] = await db
    .insert(schema.businessMembers)
    .values({ businessId, userId: user.id, role })
    .onConflictDoNothing()
    .returning();
  return { added: Boolean(row), emailed: user.invited };
}

export class TeamError extends Error {
  constructor(readonly code: "last_owner" | "not_found") {
    super(code);
  }
}

// A business always keeps at least one owner.
export async function removeMember(businessId: string, memberId: string) {
  await db.transaction(async (tx) => {
    const members = await tx
      .select()
      .from(schema.businessMembers)
      .where(eq(schema.businessMembers.businessId, businessId))
      .for("update");
    const target = members.find((m) => m.id === memberId);
    if (!target) throw new TeamError("not_found");
    if (target.role === "owner" && members.filter((m) => m.role === "owner").length === 1) {
      throw new TeamError("last_owner");
    }
    await tx
      .delete(schema.businessMembers)
      .where(and(eq(schema.businessMembers.id, memberId), eq(schema.businessMembers.businessId, businessId)));
  });
}
