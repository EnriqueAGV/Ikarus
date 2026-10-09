import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";

export const instant = false;

const messages: Record<string, string> = {
  facebook_auth_failed: "Se canceló el inicio de sesión con Facebook.",
  phone_verification_failed: "No se pudo verificar el número de teléfono.",
  waba_limit_reached: "Tu cuenta de Meta alcanzó el límite de cuentas de WhatsApp Business.",
  token_exchange_failed: "Meta no autorizó la conexión.",
  link_expired: "El enlace expiró.",
  already_used: "Este enlace ya se usó.",
};

export default async function OnboardingFailedPage({
  searchParams,
}: PageProps<"/onboarding/failed">) {
  const params = await searchParams;
  const code = typeof params.error_code === "string" ? params.error_code : "unknown";
  const linkId = typeof params.setup_link_id === "string" ? params.setup_link_id : null;

  if (linkId && code !== "already_used") {
    await db
      .update(schema.setupLinks)
      .set({ status: code === "link_expired" ? "expired" : "failed", errorCode: code })
      .where(
        and(
          eq(schema.setupLinks.kapsoSetupLinkId, linkId),
          eq(schema.setupLinks.status, "pending"),
        ),
      );
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-3 px-4 text-center">
      <h1 className="text-2xl font-semibold">No pudimos conectar tu WhatsApp</h1>
      <p className="text-neutral-600">{messages[code] ?? "Ocurrió un error inesperado."}</p>
      <p className="text-sm text-neutral-500">
        Puedes intentarlo de nuevo con el mismo enlace o pedir uno nuevo a quien te lo envió.
      </p>
    </main>
  );
}
