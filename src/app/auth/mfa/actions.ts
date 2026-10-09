"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function safePath(value: FormDataEntryValue | null) {
  const path = String(value ?? "");
  return path.startsWith("/") && !path.startsWith("//") ? path : "/app";
}

// Checks the six-digit code from the authenticator app. On the first use this
// also confirms the new factor; either way the session reaches aal2.
export async function verifyMfa(formData: FormData) {
  const next = safePath(formData.get("next"));
  const factorId = String(formData.get("factorId") ?? "");
  const code = String(formData.get("code") ?? "").replace(/\s/g, "");
  const back = (error: string) => redirect(`/auth/mfa?${new URLSearchParams({ error, next })}`);
  if (!/^\d{6}$/.test(code)) back("format");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) {
    if (error.status !== 422 && error.status !== 400) console.error("mfa verify failed", error.status, error.code);
    back(error.status === 429 ? "wait" : "code");
  }
  redirect(next);
}
