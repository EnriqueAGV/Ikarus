import { connection } from "next/server";
import { LogoMark } from "@/components/logo";
import { SignOutButton } from "@/components/signout-button";
import { NavLinks } from "@/components/dashboard/nav-links";
import { can, requireBusinessAccess } from "@/lib/auth";
import { standing } from "@/lib/billing";
import { standingNotice } from "@/lib/billing-labels";
import { waitingCount } from "@/lib/dashboard/inbox";

export default async function BusinessLayout({ children, params }: LayoutProps<"/app/[businessId]">) {
  // Request-time only: the session, trusted devices and the plan's standing all depend on now.
  await connection();
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
    <div className="flex flex-1 flex-col">
      <header className="sticky top-0 z-30 border-b border-black/[0.06] bg-background/75 backdrop-blur-xl backdrop-saturate-150 print:hidden">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 pt-4 pb-3 sm:px-6">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <LogoMark className="h-9 w-9 shrink-0" />
              <div className="leading-tight">
                <h1 className="text-[17px] font-semibold">{business.name}</h1>
                <p className="text-xs text-muted">{business.displayPhone ?? "WhatsApp sin conectar"}</p>
              </div>
            </div>
            <SignOutButton />
          </div>
          <NavLinks links={links} />
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        {notice && (
          <p className={`notice mb-6 print:hidden ${notice.tone === "stop" ? "notice-error" : "notice-warn"}`}>{notice.text}</p>
        )}
        {children}
      </main>
    </div>
  );
}
