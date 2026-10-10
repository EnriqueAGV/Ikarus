import { Logo } from "@/components/logo";
import { redirect } from "next/navigation";
import { SubmitButton } from "@/components/submit-button";
import { setPassword } from "@/app/login/actions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const instant = false;

const errors: Record<string, string> = {
  short: "La contraseña debe tener al menos 8 caracteres.",
  mismatch: "Las contraseñas no coinciden.",
  weak: "Esa contraseña es muy fácil de adivinar. Prueba con otra.",
  failed: "No pudimos guardar tu contraseña. Inténtalo de nuevo.",
};

const inputClass = "rounded-xl border px-3 py-2";

// Reached from the invitation email (via /auth/invite) or a password reset
// email (via /auth/callback), both of which leave the user signed in.
export default async function SetPasswordPage({
  searchParams,
}: PageProps<"/auth/set-password">) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : "/app";
  const error = typeof params.error === "string" ? errors[params.error] : null;

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login?error=callback");

  return (
    <main className="card animate-enter mx-auto my-auto flex w-[calc(100%-2rem)] max-w-sm flex-col gap-6 p-8">
      <Logo />
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Crea tu contraseña</h1>
        <p className="text-sm text-neutral-500">
          La usarás junto con {data.user.email} para entrar a Praxia.
        </p>
      </div>
      <form action={setPassword} className="flex flex-col gap-3">
        <input type="hidden" name="next" value={next} />
        <input type="email" name="username" value={data.user.email ?? ""} autoComplete="username" readOnly hidden />
        <label className="flex flex-col gap-1 text-sm">
          Contraseña
          <input name="password" type="password" required minLength={8} autoComplete="new-password" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Repite la contraseña
          <input name="confirm" type="password" required minLength={8} autoComplete="new-password" className={inputClass} />
        </label>
        <SubmitButton
          pendingText="Guardando…"
          className="rounded-full bg-brand px-4 py-2 text-white hover:bg-brand-hover disabled:opacity-60 font-medium shadow-sm"
        >
          Guardar y entrar
        </SubmitButton>
      </form>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </main>
  );
}
