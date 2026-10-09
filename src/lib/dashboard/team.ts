import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { createPractitioner } from "@/lib/booking/practitioners";
import { ensureUser } from "@/lib/onboarding";

export type MemberRole = (typeof schema.memberRole.enumValues)[number];

export async function listMembers(businessId: string) {
  return db
    .select({
      memberId: schema.businessMembers.id,
      userId: schema.profiles.id,
      email: schema.profiles.email,
      fullName: schema.profiles.fullName,
      role: schema.businessMembers.role,
      managesClinic: schema.businessMembers.managesClinic,
      practitionerName: schema.practitioners.displayName,
    })
    .from(schema.businessMembers)
    .innerJoin(schema.profiles, eq(schema.profiles.id, schema.businessMembers.userId))
    .leftJoin(schema.practitioners, eq(schema.practitioners.memberId, schema.businessMembers.id))
    .where(eq(schema.businessMembers.businessId, businessId))
    .orderBy(asc(schema.businessMembers.role), asc(schema.profiles.email));
}

export class TeamError extends Error {
  constructor(readonly code: "last_manager" | "not_found" | "doctor_name_required") {
    super(code);
  }
}

// Creates the account if needed, which emails the person an invitation;
// someone who already has an account signs in from the login page as usual.
// Inviting a doctor also gives them a calendar, under the name patients see.
export async function inviteMember(
  businessId: string,
  input: { email: string; role: MemberRole; managesClinic: boolean; displayName?: string },
) {
  if (input.role === "doctor" && !input.displayName?.trim()) throw new TeamError("doctor_name_required");
  const user = await ensureUser(input.email, input.displayName?.trim() || undefined);
  const row = await db.transaction(async (tx) => {
    const [member] = await tx
      .insert(schema.businessMembers)
      .values({ businessId, userId: user.id, role: input.role, managesClinic: input.managesClinic })
      .onConflictDoNothing()
      .returning();
    if (member && input.role === "doctor") {
      await createPractitioner(businessId, { displayName: input.displayName!, memberId: member.id }, tx);
    }
    return member;
  });
  return { added: Boolean(row), emailed: user.invited };
}

// A clinic always keeps at least one member who can manage it.
async function keepsAManager(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  businessId: string,
  change: { memberId: string; removes: boolean },
) {
  const members = await tx
    .select()
    .from(schema.businessMembers)
    .where(eq(schema.businessMembers.businessId, businessId))
    .for("update");
  const target = members.find((m) => m.id === change.memberId);
  if (!target) throw new TeamError("not_found");
  const managers = members.filter((m) => m.managesClinic);
  if (change.removes && target.managesClinic && managers.length === 1) throw new TeamError("last_manager");
}

export async function setManagesClinic(businessId: string, memberId: string, managesClinic: boolean) {
  await db.transaction(async (tx) => {
    await keepsAManager(tx, businessId, { memberId, removes: !managesClinic });
    await tx
      .update(schema.businessMembers)
      .set({ managesClinic })
      .where(and(eq(schema.businessMembers.id, memberId), eq(schema.businessMembers.businessId, businessId)));
  });
}

// A doctor who leaves keeps their calendar and appointments, inactive.
export async function removeMember(businessId: string, memberId: string) {
  await db.transaction(async (tx) => {
    await keepsAManager(tx, businessId, { memberId, removes: true });
    await tx
      .update(schema.practitioners)
      .set({ active: false })
      .where(and(eq(schema.practitioners.memberId, memberId), eq(schema.practitioners.businessId, businessId)));
    await tx
      .delete(schema.businessMembers)
      .where(and(eq(schema.businessMembers.id, memberId), eq(schema.businessMembers.businessId, businessId)));
  });
}
