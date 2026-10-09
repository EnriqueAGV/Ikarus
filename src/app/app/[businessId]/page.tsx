import { SignOutButton } from "@/components/signout-button";
import { requireBusinessAccess } from "@/lib/auth";

export default async function BusinessDashboardPage({
  params,
}: PageProps<"/app/[businessId]">) {
  const { businessId } = await params;
  const { business } = await requireBusinessAccess(businessId);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{business.name}</h1>
        <SignOutButton />
      </header>
      <p className="text-sm text-neutral-500">
        Citas y clientes llegan en el hito 4.
      </p>
    </main>
  );
}
