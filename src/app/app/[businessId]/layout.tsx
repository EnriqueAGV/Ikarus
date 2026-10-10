import { LogoMark } from "@/components/logo";
import { SignOutButton } from "@/components/signout-button";
import { NavLinks } from "@/components/dashboard/nav-links";
import { can, requireBusinessAccess } from "@/lib/auth";
import { standing } from "@/lib/billing";
import { standingNotice } from "@/lib/billing-labels";
import { waitingCount } from "@/lib/dashboard/inbox";

export default async function BusinessLayout({ children, params }: LayoutProps<"/app/[businessId]">) {
  const { businessId } = await params;
  const membership = await requireBusinessAccess(businessId);
  const { business } = membership;
  const base = `/app/${business.id}`;
  const notice = standingNotice(standing(business), business.timezone);
  const waiting = await waitingCount(business.id);
  const links = [
    { href: base, label: "Citas", exact: true },
    { href: `${base}/inbox`, label: "Por responder", badge: waiting },
    { href: `${base}/clients`, label: "Pacientes" },
    ...(can(membership, "clinic.manage")
      ? [
          { href: `${base}/stats`, label: "Números" },
          { href: `${base}/settings`, label: "Ajustes" },
          { href: `${base}/team`, label: "Equipo" },
        ]
      : []),
  ];

  return (
    <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
      <header className="mb-6 flex flex-col gap-3 border-b pb-4 print:hidden">
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
      {notice && (
        <p
          className={`mb-4 rounded-md border p-3 text-sm print:hidden ${
            notice.tone === "stop"
              ? "border-red-300 bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-200"
              : "border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
          }`}
        >
          {notice.text}
        </p>
      )}
      {children}
    </div>
  );
}
