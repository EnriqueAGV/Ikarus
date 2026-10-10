import Link from "next/link";
import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/signout-button";
import { listMyBusinesses, requireProfile } from "@/lib/auth";

export default async function MyBusinessesPage() {
  const profile = await requireProfile();
  const businesses = await listMyBusinesses(profile);
  if (businesses.length === 1) redirect(`/app/${businesses[0].id}`);

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Tus consultorios</h1>
        <SignOutButton />
      </header>
      {businesses.length === 0 ? (
        <p className="text-sm text-neutral-500">
          Tu cuenta todavía no pertenece a ningún consultorio.
        </p>
      ) : (
        <ul className="card divide-y overflow-hidden">
          {businesses.map((b) => (
            <li key={b.id} className="px-4 py-3">
              <Link href={`/app/${b.id}`} className="font-medium hover:underline">
                {b.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
