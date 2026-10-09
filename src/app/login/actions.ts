"use server";

import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function sendMagicLink(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const next = String(formData.get("next") ?? "/");
  if (!email) redirect("/login?error=email");

  const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${env.APP_URL}/auth/callback?next=${encodeURIComponent(next)}`,
      // Accounts are created by a super-admin, except the listed super-admins.
      shouldCreateUser: env.SUPER_ADMIN_EMAILS.includes(email),
    },
  });
  redirect(error ? "/login?error=send" : "/login?sent=1");
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
