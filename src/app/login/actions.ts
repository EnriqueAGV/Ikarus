"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function sendMagicLink(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const next = String(formData.get("next") ?? "/");
  if (!email) redirect("/login?error=email");

  // Each attempt stores a new PKCE verifier, and only the matching email link
  // works. Keep the previous verifier if this attempt sends nothing, so the
  // link already in the inbox still works.
  const cookieStore = await cookies();
  const verifiers = cookieStore.getAll().filter((c) => c.name.endsWith("-code-verifier"));

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${env.APP_URL}/auth/callback?next=${encodeURIComponent(next)}`,
      // Accounts are created by a super-admin, except the listed super-admins.
      shouldCreateUser: env.SUPER_ADMIN_EMAILS.includes(email),
    },
  });
  if (error) {
    console.error("magic link failed", error.status, error.code);
    for (const c of verifiers) cookieStore.set(c.name, c.value, { path: "/", sameSite: "lax", httpOnly: false, maxAge: 400 * 24 * 3600 });
  }
  // Too many requests: the earlier link is still the one to use.
  if (error?.status === 429) redirect("/login?error=wait");
  redirect(error ? "/login?error=send" : "/login?sent=1");
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
