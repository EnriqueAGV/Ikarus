import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db, schema } from "@/db";
import { CopyButton } from "@/components/copy-button";
import { requireSuperAdmin } from "@/lib/auth";
import { newSetupLinkAction, syncTemplatesAction } from "../../actions";

const statusLabel = {
  invited: "Esperando conexión de WhatsApp",
  connected: "WhatsApp conectado",
  active: "Activo",
  disabled: "Desactivado",
} as const;

const linkStatusLabel = {
  pending: "Pendiente",
  completed: "Usado",
  failed: "Falló",
  expired: "Expirado",
} as const;

const templateStatusLabel = {
  PENDING: "En revisión de Meta",
  APPROVED: "Aprobada",
  REJECTED: "Rechazada",
  DISABLED: "Desactivada",
} as const;

const dateFmt = new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" });

export default async function AdminBusinessPage({
  params,
}: PageProps<"/admin/businesses/[businessId]">) {
  await requireSuperAdmin();
  const { businessId } = await params;

  const [business] = await db
    .select()
    .from(schema.businesses)
    .where(eq(schema.businesses.id, businessId));
  if (!business) notFound();

  const [links, templates, members] = await Promise.all([
    db
      .select()
      .from(schema.setupLinks)
      .where(eq(schema.setupLinks.businessId, businessId))
      .orderBy(desc(schema.setupLinks.createdAt)),
    db.select().from(schema.templates).where(eq(schema.templates.businessId, businessId)),
    db
      .select({ email: schema.profiles.email, role: schema.businessMembers.role })
      .from(schema.businessMembers)
      .innerJoin(schema.profiles, eq(schema.profiles.id, schema.businessMembers.userId))
      .where(eq(schema.businessMembers.businessId, businessId)),
  ]);

  const current = links.find((l) => l.status === "pending" && l.expiresAt > new Date());

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      <Link href="/admin" className="text-sm text-neutral-500 hover:underline">
        ← Negocios
      </Link>
      <header className="mb-6 mt-2 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold">{business.name}</h1>
        <Link href={`/app/${business.id}`} className="text-sm hover:underline">
          Abrir panel del negocio →
        </Link>
      </header>

      <section className="mb-8 rounded-md border p-4">
        <h2 className="mb-2 font-medium">WhatsApp</h2>
        <p className="text-sm">
          {statusLabel[business.status]}
          {business.displayPhone ? ` · ${business.displayPhone}` : ""}
        </p>
        {business.status === "invited" && (
          <div className="mt-4 flex flex-col gap-3">
            {current ? (
              <>
                <p className="text-sm text-neutral-500">
                  Envía este enlace al negocio. Vence el {dateFmt.format(current.expiresAt)}.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <code className="break-all rounded bg-neutral-100 px-2 py-1 text-xs dark:bg-neutral-900">
                    {current.url}
                  </code>
                  <CopyButton text={current.url} />
                </div>
              </>
            ) : (
              <p className="text-sm text-neutral-500">No hay un enlace vigente.</p>
            )}
            <form action={newSetupLinkAction.bind(null, business.id)}>
              <button className="text-sm underline">Generar un enlace nuevo</button>
            </form>
          </div>
        )}
      </section>

      <section className="mb-8 rounded-md border p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-medium">Plantillas de mensajes</h2>
          {business.wabaId && (
            <form action={syncTemplatesAction.bind(null, business.id)}>
              <button className="text-sm underline">Actualizar estado</button>
            </form>
          )}
        </div>
        {templates.length === 0 ? (
          <p className="text-sm text-neutral-500">Se crean al conectar el WhatsApp.</p>
        ) : (
          <ul className="text-sm">
            {templates.map((t) => (
              <li key={t.id} className="flex justify-between gap-4 py-1">
                <span className="font-mono">{t.name}</span>
                <span className={t.status === "REJECTED" ? "text-red-600" : "text-neutral-500"}>
                  {templateStatusLabel[t.status]}
                  {t.rejectedReason ? ` · ${t.rejectedReason}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-8 rounded-md border p-4">
        <h2 className="mb-2 font-medium">Equipo</h2>
        <ul className="text-sm">
          {members.map((m) => (
            <li key={m.email} className="flex justify-between py-1">
              <span>{m.email}</span>
              <span className="text-neutral-500">{m.role === "owner" ? "Dueño" : "Equipo"}</span>
            </li>
          ))}
        </ul>
      </section>

      {links.length > 0 && (
        <section className="rounded-md border p-4">
          <h2 className="mb-2 font-medium">Historial de enlaces</h2>
          <ul className="text-sm">
            {links.map((l) => (
              <li key={l.id} className="flex justify-between py-1 text-neutral-500">
                <span>{dateFmt.format(l.createdAt)}</span>
                <span>
                  {linkStatusLabel[l.status]}
                  {l.errorCode ? ` · ${l.errorCode}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
