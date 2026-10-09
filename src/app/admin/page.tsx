import Link from "next/link";
import { SignOutButton } from "@/components/signout-button";
import { listMyBusinesses, requireSuperAdmin } from "@/lib/auth";
import { registerProjectWebhookAction } from "./actions";

const statusLabel = {
  invited: "Esperando WhatsApp",
  connected: "WhatsApp conectado",
  active: "Activo",
  disabled: "Desactivado",
} as const;

const webhookNotice: Record<string, string> = {
  created: "Webhook de Kapso registrado.",
  exists: "El webhook de Kapso ya estaba registrado.",
  failed: "No se pudo registrar el webhook. Revisa KAPSO_API_KEY y KAPSO_PROJECT_WEBHOOK_SECRET.",
};

export default async function AdminPage({ searchParams }: PageProps<"/admin">) {
  const profile = await requireSuperAdmin();
  const businesses = await listMyBusinesses(profile);
  const { webhook } = await searchParams;
  const notice = typeof webhook === "string" ? webhookNotice[webhook] : null;

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
      <header className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Negocios</h1>
        <div className="flex items-center gap-4">
          <Link
            href="/admin/new"
            className="rounded-md bg-brand px-3 py-1.5 text-sm text-white hover:bg-brand-hover"
          >
            Nuevo negocio
          </Link>
          <SignOutButton />
        </div>
      </header>
      {businesses.length === 0 ? (
        <p className="text-sm text-neutral-500">Aún no hay negocios.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {businesses.map((b) => (
            <li key={b.id} className="flex items-center justify-between px-4 py-3">
              <Link href={`/admin/businesses/${b.id}`} className="font-medium hover:underline">
                {b.name}
              </Link>
              <span className="text-sm text-neutral-500">
                {statusLabel[b.status]}
                {b.displayPhone ? ` · ${b.displayPhone}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
      <footer className="mt-10 flex flex-wrap items-center gap-3 border-t pt-4 text-sm text-neutral-500">
        <form action={registerProjectWebhookAction}>
          <button className="underline">Registrar webhook de Kapso</button>
        </form>
        <span>Hazlo una vez, y de nuevo si cambia la URL de la app, para que las conexiones nuevas lleguen a Praxia.</span>
        {notice && <span className="w-full text-neutral-700 dark:text-neutral-300">{notice}</span>}
      </footer>
    </main>
  );
}
