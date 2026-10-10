import { Logo } from "@/components/logo";
import Link from "next/link";
import { connectPhoneNumber } from "@/lib/onboarding";

export const instant = false;

// Kapso sends the business here after it connects its WhatsApp number.
// The project webhook usually gets there first; this is the backup path.
export default async function OnboardingSuccessPage({
  searchParams,
}: PageProps<"/onboarding/success">) {
  const params = await searchParams;
  const phoneNumberId = typeof params.phone_number_id === "string" ? params.phone_number_id : null;
  const setupLinkId = typeof params.setup_link_id === "string" ? params.setup_link_id : undefined;
  const display =
    typeof params.display_phone_number === "string" ? params.display_phone_number : null;

  let connected = false;
  if (phoneNumberId) {
    try {
      const result = await connectPhoneNumber({ phoneNumberId, setupLinkId });
      connected = result.ok;
    } catch (err) {
      console.error("Connecting number from redirect failed", err);
    }
  }

  return (
    <main className="card animate-enter mx-auto my-auto flex w-[calc(100%-2rem)] max-w-md flex-col gap-3 p-8 text-center">
      <Logo className="mx-auto mb-3 h-9 w-auto" />
      {connected ? (
        <>
          <h1 className="text-2xl font-semibold">¡Listo! Tu WhatsApp quedó conectado</h1>
          {display && <p className="text-neutral-600">{display}</p>}
          <p className="text-sm text-neutral-500">
            Te enviamos un correo con el enlace a tu panel, donde configuras tus servicios y horarios.
          </p>
          <Link href="/app" className="mx-auto rounded-full bg-brand px-4 py-2 text-sm text-white hover:bg-brand-hover font-medium shadow-sm">
            Entrar a mi panel
          </Link>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-semibold">Recibimos tu conexión</h1>
          <p className="text-sm text-neutral-500">
            Estamos terminando de configurarla. Si en unos minutos no ves cambios, contacta a quien te envió el enlace.
          </p>
        </>
      )}
    </main>
  );
}
