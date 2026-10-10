"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

// Landing page for Supabase invitation emails. Admin invitations return the
// session in the URL fragment (never sent to the server), so it is read here
// and stored as the usual auth cookies, then the user creates their password.
export default function InvitePage() {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const next = new URLSearchParams(window.location.search).get("next") ?? "/app";
    const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/app";
    createSupabaseBrowserClient()
      .auth.setSession({
        access_token: hash.get("access_token") ?? "",
        refresh_token: hash.get("refresh_token") ?? "",
      })
      .then(({ error }) => {
        if (error) setFailed(true);
        else window.location.replace(`/auth/set-password?next=${encodeURIComponent(safeNext)}`);
      }, () => setFailed(true));
  }, []);

  return (
    <main className="card animate-enter mx-auto my-auto flex w-[calc(100%-2rem)] max-w-md flex-col gap-3 p-8 text-center">
      {failed ? (
        <>
          <h1 className="text-2xl font-semibold">El enlace ya no es válido</h1>
          <p className="text-sm text-neutral-500">
            Puede que haya expirado o que ya lo hayas usado. Pide un enlace nuevo para crear tu contraseña.
          </p>
          <a href="/login/forgot" className="mx-auto rounded-full bg-brand px-4 py-2 text-sm text-white hover:bg-brand-hover font-medium shadow-sm">
            Pedir un enlace nuevo
          </a>
        </>
      ) : (
        <p className="text-sm text-neutral-500">Abriendo tu panel…</p>
      )}
    </main>
  );
}
