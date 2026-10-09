import Link from "next/link";
import { SubmitButton } from "@/components/submit-button";
import { sendPasswordReset } from "../actions";

export const instant = false;

const errors: Record<string, string> = {
  email: "Escribe tu correo.",
  send: "No pudimos enviar el correo. Inténtalo de nuevo en unos minutos.",
  wait: "Ya te enviamos un correo hace poco. Espera un minuto y usa el último que recibiste.",
};

export default async function ForgotPasswordPage({
  searchParams,
}: PageProps<"/login/forgot">) {
  const params = await searchParams;
  const sent = params.sent === "1";
  const error = typeof params.error === "string" ? errors[params.error] : null;

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4">
      <h1 className="text-2xl font-semibold">Crear una contraseña nueva</h1>
      {sent ? (
        <p className="text-sm">
          Si tu correo tiene una cuenta en Ikarus, te enviamos un enlace para crear tu contraseña. Ábrelo en este mismo navegador.
        </p>
      ) : (
        <form action={sendPasswordReset} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Correo
            <input name="email" type="email" required autoComplete="email" className="rounded-md border px-3 py-2" />
          </label>
          <SubmitButton
            pendingText="Enviando…"
            className="rounded-md bg-black px-3 py-2 text-white disabled:opacity-60 dark:bg-white dark:text-black"
          >
            Enviarme un enlace
          </SubmitButton>
        </form>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Link href="/login" className="text-sm text-neutral-500 hover:underline">
        Volver a iniciar sesión
      </Link>
    </main>
  );
}
