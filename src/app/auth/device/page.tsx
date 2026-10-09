import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Logo } from "@/components/logo";
import { SignOutButton } from "@/components/signout-button";
import { SubmitButton } from "@/components/submit-button";
import { getCurrentProfile } from "@/lib/auth";
import { DEVICE_COOKIE, isTrustedDevice } from "@/lib/devices";
import { sendDeviceCode, verifyDeviceCode } from "./actions";

export const instant = false;

const errors: Record<string, string> = {
  format: "Escribe el código de 6 dígitos del correo.",
  code: "Ese código no es válido o ya expiró. Pide uno nuevo.",
  wait: "Ya enviamos un código hace poco. Espera un minuto antes de pedir otro.",
  send: "No pudimos enviar el correo. Inténtalo de nuevo en un momento.",
};

const button = "rounded-md bg-brand px-3 py-2 text-white hover:bg-brand-hover disabled:opacity-60";

// The first sign-in on a new computer or phone: a code sent to the person's
// email confirms the device, and it isn't asked again there.
export default async function DevicePage({ searchParams }: PageProps<"/auth/device">) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : "/app";
  const error = typeof params.error === "string" ? errors[params.error] : null;
  const sent = params.sent === "1";

  const profile = await getCurrentProfile();
  if (!profile) redirect(`/login?next=${encodeURIComponent(next)}`);
  if (await isTrustedDevice(profile.id, (await cookies()).get(DEVICE_COOKIE)?.value)) redirect(next);

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4">
      <Logo />
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Confirma este dispositivo</h1>
        <p className="text-sm text-neutral-500">
          {sent
            ? `Enviamos un código a ${profile.email}. Escríbelo aquí. Si no lo ves, revisa la carpeta de spam.`
            : `Es la primera vez que entras desde este dispositivo. Para proteger los expedientes, te enviaremos un código a ${profile.email}. Solo se pide una vez en cada dispositivo.`}
        </p>
      </div>
      {sent ? (
        <form action={verifyDeviceCode} className="flex flex-col gap-3">
          <input type="hidden" name="next" value={next} />
          <label className="flex flex-col gap-1 text-sm">
            Código
            <input
              name="code"
              required
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={11}
              className="rounded-md border px-3 py-2 text-lg tracking-widest"
            />
          </label>
          <SubmitButton pendingText="Verificando…" className={button}>
            Confirmar y entrar
          </SubmitButton>
        </form>
      ) : (
        <form action={sendDeviceCode}>
          <input type="hidden" name="next" value={next} />
          <SubmitButton pendingText="Enviando…" className={`${button} w-full`}>
            Enviarme el código
          </SubmitButton>
        </form>
      )}
      {sent && (
        <form action={sendDeviceCode} className="text-center">
          <input type="hidden" name="next" value={next} />
          <button className="text-sm text-neutral-500 hover:underline">Enviar otro código</button>
        </form>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-center">
        <SignOutButton />
      </div>
    </main>
  );
}
