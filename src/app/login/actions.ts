"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { ensureUser } from "@/lib/onboarding";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function safePath(value: FormDataEntryValue | null, fallback: string) {
  const path = String(value ?? "");
  return path.startsWith("/") && !path.startsWith("//") ? path : fallback;
}

export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = safePath(formData.get("next"), "/");
  if (!email || !password) redirect("/login?error=missing");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (error.status !== 400) console.error("password sign-in failed", error.status, error.code);
    const query = new URLSearchParams({ error: error.status === 429 ? "wait" : "credentials", next });
    redirect(`/login?${query}`);
  }
  redirect(next);
}

// Sends a link to choose a new password. Always answers the same way, so the
// form does not reveal which emails have an account.
export async function sendPasswordReset(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) redirect("/login/forgot?error=email");

  // A listed super-admin without an account yet gets the invitation instead,
  // which also ends on the create-password screen.
  if (env.SUPER_ADMIN_EMAILS.includes(email)) {
    const { invited } = await ensureUser(email);
    if (invited) redirect("/login/forgot?sent=1");
  }

  // Each attempt stores a new PKCE verifier, and only the matching email link
  // works. Keep the previous verifier if this attempt sends nothing, so the
  // link already in the inbox still works.
  const cookieStore = await cookies();
  const verifiers = cookieStore.getAll().filter((c) => c.name.endsWith("-code-verifier"));

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${env.APP_URL}/auth/callback?next=/auth/set-password`,
  });
  if (error) {
    console.error("password reset failed", error.status, error.code);
    for (const c of verifiers) cookieStore.set(c.name, c.value, { path: "/", sameSite: "lax", httpOnly: false, maxAge: 400 * 24 * 3600 });
  }
  if (error?.status === 429) redirect("/login/forgot?error=wait");
  redirect(error ? "/login/forgot?error=send" : "/login/forgot?sent=1");
}

export async function setPassword(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  const next = safePath(formData.get("next"), "/app");
  const back = (error: string) => redirect(`/auth/set-password?${new URLSearchParams({ error, next })}`);
  if (password.length < 8) back("short");
  if (password !== confirm) back("mismatch");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error && error.code !== "same_password") {
    console.error("set password failed", error.status, error.code);
    back(error.code === "weak_password" ? "weak" : "failed");
  }
  redirect(next);
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
