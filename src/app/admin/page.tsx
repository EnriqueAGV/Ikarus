import Link from "next/link";
import { SignOutButton } from "@/components/signout-button";
import { listMyBusinesses, requireSuperAdmin } from "@/lib/auth";

const statusLabel = {
  invited: "Invitado",
  connected: "WhatsApp conectado",
  active: "Activo",
  disabled: "Desactivado",
} as const;

export default async function AdminPage() {
  const profile = await requireSuperAdmin();
  const businesses = await listMyBusinesses(profile);

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Negocios</h1>
        <SignOutButton />
      </header>
      {businesses.length === 0 ? (
        <p className="text-sm text-neutral-500">
          Aún no hay negocios. El alta con enlace de WhatsApp llega en el hito 2.
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {businesses.map((b) => (
            <li key={b.id} className="flex items-center justify-between px-4 py-3">
              <Link href={`/app/${b.id}`} className="font-medium hover:underline">
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
    </main>
  );
}
