import Link from "next/link";
import { Logo } from "@/components/logo";
import { SubmitButton } from "@/components/submit-button";
import { signIn } from "./actions";

export const instant = false;

export const metadata = { title: "Entrar" };

const errors: Record<string, string> = {
  missing: "Escribe tu correo y tu contraseña.",
  credentials: "El correo o la contraseña no son correctos.",
  wait: "Demasiados intentos. Espera un minuto e inténtalo de nuevo.",
  callback: "El enlace no es válido o ya expiró. Pide uno nuevo.",
};

const inputClass = "rounded-xl border px-3 py-2";

export default async function LoginPage({
  searchParams,
}: PageProps<"/login">) {
  const params = await searchParams;
  const error = typeof params.error === "string" ? errors[params.error] : null;
  const next = typeof params.next === "string" ? params.next : "/";

  return (
    <main className="card animate-enter mx-auto my-auto flex w-[calc(100%-2rem)] max-w-sm flex-col gap-6 p-8">
      <Logo />
      <h1 className="text-2xl font-semibold">Entrar a tu cuenta</h1>
      <form action={signIn} className="flex flex-col gap-3">
        <input type="hidden" name="next" value={next} />
        <label className="flex flex-col gap-1 text-sm">
          Correo
          <input name="email" type="email" required autoComplete="email" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Contraseña
          <input name="password" type="password" required autoComplete="current-password" className={inputClass} />
        </label>
        <SubmitButton
          pendingText="Entrando…"
          className="rounded-full bg-brand px-4 py-2 text-white hover:bg-brand-hover disabled:opacity-60 font-medium shadow-sm"
        >
          Entrar
        </SubmitButton>
      </form>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Link href="/login/forgot" className="text-sm text-neutral-500 hover:underline">
        ¿Olvidaste tu contraseña?
      </Link>
    </main>
  );
}
