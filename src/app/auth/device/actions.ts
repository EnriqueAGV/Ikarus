"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { DEVICE_COOKIE, DEVICE_MAX_AGE_S, deviceLabel, trustDevice } from "@/lib/devices";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function safePath(value: FormDataEntryValue | null) {
  const path = String(value ?? "");
  return path.startsWith("/") && !path.startsWith("//") ? path : "/app";
}

const back = (next: string, params: Record<string, string>) =>
  redirect(`/auth/device?${new URLSearchParams({ ...params, next })}`);

// Emails the signed-in user a one-time code (Supabase's email OTP).
export async function sendDeviceCode(formData: FormData) {
  const next = safePath(formData.get("next"));
  const profile = await getCurrentProfile();
  if (!profile) redirect(`/login?next=${encodeURIComponent(next)}`);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({ email: profile.email, options: { shouldCreateUser: false } });
  if (error) {
    if (error.status !== 429) console.error("device code send failed", error.status, error.code);
    back(next, { error: error.status === 429 ? "wait" : "send" });
  }
  back(next, { sent: "1" });
}

// A correct code marks this browser as trusted for its owner.
export async function verifyDeviceCode(formData: FormData) {
  const next = safePath(formData.get("next"));
  const code = String(formData.get("code") ?? "").replace(/\s/g, "");
  const profile = await getCurrentProfile();
  if (!profile) redirect(`/login?next=${encodeURIComponent(next)}`);
  if (!/^\d{6,10}$/.test(code)) back(next, { sent: "1", error: "format" });

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.verifyOtp({ email: profile.email, token: code, type: "email" });
  if (error || data.user?.id !== profile.id) {
    if (error && error.status !== 403 && error.status !== 400) console.error("device code verify failed", error.status, error.code);
    back(next, { sent: "1", error: error?.status === 429 ? "wait" : "code" });
  }
  const token = await trustDevice(profile.id, deviceLabel((await headers()).get("user-agent")));
  (await cookies()).set(DEVICE_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: DEVICE_MAX_AGE_S,
  });
  redirect(next);
}
