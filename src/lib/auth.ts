import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db, schema } from "@/db";
import { env } from "@/lib/env";
import { can, needsSecondFactor, type Role } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type Profile = typeof schema.profiles.$inferSelect;

// The signed-in user's profile, created on first sight of a new auth user.
export const getCurrentProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user?.email) return null;

  const [existing] = await db
    .select()
    .from(schema.profiles)
    .where(eq(schema.profiles.id, user.id));
  const isListedAdmin = env.SUPER_ADMIN_EMAILS.includes(user.email.toLowerCase());
  if (existing) {
    if (isListedAdmin && !existing.isSuperAdmin) {
      const [upgraded] = await db
        .update(schema.profiles)
        .set({ isSuperAdmin: true })
        .where(eq(schema.profiles.id, user.id))
        .returning();
      return upgraded;
    }
    return existing;
  }

  const [created] = await db
    .insert(schema.profiles)
    .values({
      id: user.id,
      email: user.email.toLowerCase(),
      isSuperAdmin: isListedAdmin,
    })
    .onConflictDoNothing()
    .returning();
  return created ?? null;
});

export async function requireProfile(): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  return profile;
}

export async function requireSuperAdmin(): Promise<Profile> {
  const profile = await requireProfile();
  if (!profile.isSuperAdmin) redirect("/app");
  return profile;
}

export { can, needsSecondFactor, type Action, type Role } from "@/lib/permissions";

export type Membership = {
  profile: Profile;
  business: typeof schema.businesses.$inferSelect;
  role: Role;
  managesClinic: boolean;
  // The doctor's own calendar, when the member is a doctor with one.
  practitionerId: string | null;
};

// Super-admins can open any business; everyone else needs a membership row.
// Doctors must have passed two-factor sign-in in this session.
export async function requireBusinessAccess(
  businessId: string,
): Promise<Membership> {
  const profile = await requireProfile();
  const [business] = await db
    .select()
    .from(schema.businesses)
    .where(eq(schema.businesses.id, businessId));
  if (!business) redirect("/app");
  if (profile.isSuperAdmin) {
    return { profile, business, role: "super_admin", managesClinic: true, practitionerId: null };
  }

  const [row] = await db
    .select({ member: schema.businessMembers, practitionerId: schema.practitioners.id })
    .from(schema.businessMembers)
    .leftJoin(schema.practitioners, eq(schema.practitioners.memberId, schema.businessMembers.id))
    .where(
      and(
        eq(schema.businessMembers.businessId, businessId),
        eq(schema.businessMembers.userId, profile.id),
      ),
    );
  if (!row) redirect("/app");
  const membership: Membership = {
    profile,
    business,
    role: row.member.role,
    managesClinic: row.member.managesClinic,
    practitionerId: row.practitionerId,
  };
  if (needsSecondFactor(membership.role, await assuranceLevel())) {
    redirect(`/auth/mfa?next=${encodeURIComponent(`/app/${businessId}`)}`);
  }
  return membership;
}

async function assuranceLevel() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return data?.currentLevel ?? null;
}

export async function listMyBusinesses(profile: Profile) {
  if (profile.isSuperAdmin) {
    return db.select().from(schema.businesses).orderBy(schema.businesses.name);
  }
  return db
    .select({ business: schema.businesses })
    .from(schema.businessMembers)
    .innerJoin(
      schema.businesses,
      eq(schema.businesses.id, schema.businessMembers.businessId),
    )
    .where(eq(schema.businessMembers.userId, profile.id))
    .then((rows) => rows.map((r) => r.business));
}

export async function requireBusinessManager(businessId: string): Promise<Membership> {
  const membership = await requireBusinessAccess(businessId);
  if (!can(membership, "clinic.manage")) redirect(`/app/${businessId}`);
  return membership;
}
