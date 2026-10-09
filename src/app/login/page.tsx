import { SubmitButton } from "@/components/submit-button";
import { sendMagicLink } from "./actions";

export const instant = false;

const errors: Record<string, string> = {
  email: "Escribe tu correo.",
  send: "No pudimos enviar el enlace. ¿Tu cuenta ya fue invitada?",
  wait: "Ya te enviamos un enlace hace poco. Espera un minuto y usa el último correo que recibiste.",
  callback: "El enlace no es válido o ya expiró. Pide uno nuevo.",
};

export default async function LoginPage({
  searchParams,
}: PageProps<"/login">) {
  const params = await searchParams;
  const sent = params.sent === "1";
  const error = typeof params.error === "string" ? errors[params.error] : null;
  const next = typeof params.next === "string" ? params.next : "/";

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4">
      <h1 className="text-2xl font-semibold">Entrar a Ikarus</h1>
      {sent ? (
        <p className="text-sm">Te enviamos un enlace de acceso. Revisa tu correo.</p>
      ) : (
        <form action={sendMagicLink} className="flex flex-col gap-3">
          <input type="hidden" name="next" value={next} />
          <label className="flex flex-col gap-1 text-sm">
            Correo
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              className="rounded-md border px-3 py-2"
            />
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
    </main>
  );
}
