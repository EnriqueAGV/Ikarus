import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db, schema } from "@/db";
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
  if (existing) return existing;

  const [created] = await db
    .insert(schema.profiles)
    .values({ id: user.id, email: user.email })
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

export type Membership = {
  profile: Profile;
  business: typeof schema.businesses.$inferSelect;
  role: "owner" | "staff" | "super_admin";
};

// Super-admins can open any business; everyone else needs a membership row.
export async function requireBusinessAccess(
  businessId: string,
): Promise<Membership> {
  const profile = await requireProfile();
  const [business] = await db
    .select()
    .from(schema.businesses)
    .where(eq(schema.businesses.id, businessId));
  if (!business) redirect("/app");
  if (profile.isSuperAdmin) return { profile, business, role: "super_admin" };

  const [member] = await db
    .select()
    .from(schema.businessMembers)
    .where(
      and(
        eq(schema.businessMembers.businessId, businessId),
        eq(schema.businessMembers.userId, profile.id),
      ),
    );
  if (!member) redirect("/app");
  return { profile, business, role: member.role };
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
