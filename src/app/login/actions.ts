"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function sendMagicLink(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const next = String(formData.get("next") ?? "/");
  if (!email) redirect("/login?error=email");

  const supabase = await createSupabaseServerClient();
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${appUrl}/auth/callback?next=${encodeURIComponent(next)}`,
      // Accounts are created by invitation (super-admin or business owner).
      shouldCreateUser: false,
    },
  });
  redirect(error ? "/login?error=send" : "/login?sent=1");
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
