import { LogoMark } from "@/components/logo";
import { SignOutButton } from "@/components/signout-button";
import { NavLinks } from "@/components/dashboard/nav-links";
import { canManage, requireBusinessAccess } from "@/lib/auth";

export default async function BusinessLayout({ children, params }: LayoutProps<"/app/[businessId]">) {
  const { businessId } = await params;
  const { business, role } = await requireBusinessAccess(businessId);
  const base = `/app/${business.id}`;
  const links = [
    { href: base, label: "Citas", exact: true },
    { href: `${base}/clients`, label: "Clientes" },
    ...(canManage(role)
      ? [
          { href: `${base}/settings`, label: "Ajustes" },
          { href: `${base}/team`, label: "Equipo" },
        ]
      : []),
  ];

  return (
    <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
      <header className="mb-6 flex flex-col gap-3 border-b pb-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <LogoMark className="h-9 w-9 shrink-0" />
            <div>
              <h1 className="text-xl font-semibold">{business.name}</h1>
              <p className="text-xs text-neutral-500">
                {business.displayPhone ?? "WhatsApp sin conectar"} · {business.timezone}
              </p>
            </div>
          </div>
          <SignOutButton />
        </div>
        <NavLinks links={links} />
      </header>
      {children}
    </div>
  );
}
