import { redirect } from "next/navigation";
import { Logo } from "@/components/logo";
import { SignOutButton } from "@/components/signout-button";
import { SubmitButton } from "@/components/submit-button";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { verifyMfa } from "./actions";

export const instant = false;

const errors: Record<string, string> = {
  format: "El código tiene 6 dígitos.",
  code: "Ese código no es válido o ya expiró. Usa el que aparece ahora en la app.",
  wait: "Demasiados intentos. Espera un momento y vuelve a intentarlo.",
};

// Doctors read clinical records, so they sign in with a second factor: a code
// from an authenticator app (Google Authenticator, Microsoft Authenticator,
// 1Password…). requireBusinessAccess sends them here until the session has it.
export default async function MfaPage({ searchParams }: PageProps<"/auth/mfa">) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : "/app";
  const error = typeof params.error === "string" ? errors[params.error] : null;

  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect(`/login?next=${encodeURIComponent(next)}`);

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel === "aal2") redirect(next);

  const { data: factors } = await supabase.auth.mfa.listFactors();
  const verified = factors?.totp.find((f) => f.status === "verified");
  let setup: { factorId: string; qr: string; secret: string } | null = null;
  if (!verified) {
    // A setup left half-way leaves an unverified factor behind; start over.
    for (const f of factors?.all ?? []) {
      if (f.factor_type === "totp" && f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
    const { data, error: enrollError } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      issuer: "Praxia",
      friendlyName: `Praxia ${new Date().toISOString().slice(0, 10)}`,
    });
    if (enrollError || !data) {
      console.error("mfa enroll failed", enrollError?.status, enrollError?.code);
      throw new Error("No se pudo preparar la verificación en dos pasos.");
    }
    setup = { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
  }
  const factorId = verified?.id ?? setup!.factorId;
  // Each visit during setup makes a new key, so a failed first code means scanning again.
  const message = setup && params.error === "code" ? "Ese código no coincide. Borra la entrada de Praxia en tu app y escanea este código nuevo." : error;

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4">
      <Logo />
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Verificación en dos pasos</h1>
        <p className="text-sm text-neutral-500">
          {setup
            ? "Como doctor, entras con tu contraseña y un código de una app de autenticación. Escanea este código QR con la app (Google Authenticator, Microsoft Authenticator u otra) y escribe el código de 6 dígitos que muestra."
            : "Escribe el código de 6 dígitos que muestra tu app de autenticación."}
        </p>
      </div>
      {setup && (
        <div className="flex flex-col items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL from Supabase */}
          <img src={setup.qr} alt="Código QR para la app de autenticación" width={192} height={192} className="rounded-md bg-white p-2" />
          <p className="text-center text-xs text-neutral-500">
            ¿No puedes escanearlo? Escribe esta clave en la app:
            <br />
            <span className="font-mono break-all select-all">{setup.secret}</span>
          </p>
        </div>
      )}
      <form action={verifyMfa} className="flex flex-col gap-3">
        <input type="hidden" name="next" value={next} />
        <input type="hidden" name="factorId" value={factorId} />
        <label className="flex flex-col gap-1 text-sm">
          Código
          <input
            name="code"
            required
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]{6,7}"
            maxLength={7}
            className="rounded-md border px-3 py-2 tracking-widest"
          />
        </label>
        <SubmitButton pendingText="Verificando…" className="rounded-md bg-brand px-3 py-2 text-white hover:bg-brand-hover disabled:opacity-60">
          Verificar y entrar
        </SubmitButton>
      </form>
      {message && <p className="text-sm text-red-600">{message}</p>}
      <div className="flex justify-center">
        <SignOutButton />
      </div>
    </main>
  );
}
