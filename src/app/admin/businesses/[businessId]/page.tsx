import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db, schema } from "@/db";
import { CopyButton } from "@/components/copy-button";
import { requireSuperAdmin } from "@/lib/auth";
import { bankDetails, formatMoney, invoicesFor, standing, transferReference } from "@/lib/billing";
import { standingLabel } from "@/lib/billing-labels";
import {
  issueInvoiceAction,
  markPaidAction,
  newSetupLinkAction,
  setPriceAction,
  setSuspendedAction,
  setTrialAction,
  syncTemplatesAction,
  voidInvoiceAction,
} from "../../actions";

const billingErrorLabel: Record<string, string> = {
  no_price: "Primero pon el precio mensual.",
  invalid_price: "El precio no es válido.",
  invalid_days: "Los días de prueba deben estar entre 0 y 365.",
  pending_exists: "Ya hay una factura pendiente; márcala pagada o anúlala primero.",
  not_found: "Esa factura ya no está pendiente.",
};

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
  searchParams,
}: PageProps<"/admin/businesses/[businessId]">) {
  await requireSuperAdmin();
  const { businessId } = await params;
  const { billingError } = await searchParams;

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
      .select({ email: schema.profiles.email, role: schema.businessMembers.role, managesClinic: schema.businessMembers.managesClinic })
      .from(schema.businessMembers)
      .innerJoin(schema.profiles, eq(schema.profiles.id, schema.businessMembers.userId))
      .where(eq(schema.businessMembers.businessId, businessId)),
  ]);

  const current = links.find((l) => l.status === "pending" && l.expiresAt > new Date());
  const invoices = await invoicesFor(business.id);
  const billing = standing(business);
  const billingMessage = typeof billingError === "string" ? billingErrorLabel[billingError] ?? "Algo salió mal." : null;
  const bank = bankDetails();

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      <Link href="/admin" className="text-sm text-neutral-500 hover:underline">
        ← Consultorios
      </Link>
      <header className="mb-6 mt-2 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold">{business.name}</h1>
        <Link href={`/app/${business.id}`} className="text-sm hover:underline">
          Abrir panel del consultorio →
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
                  Envía este enlace al consultorio. Vence el {dateFmt.format(current.expiresAt)}.
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
              <button className="text-sm underline">Crear faltantes y actualizar estado</button>
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

      <section id="billing" className="mb-8 flex flex-col gap-3 rounded-md border p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-medium">Plan y pagos</h2>
          <span className="text-sm">{standingLabel(billing, business.timezone)}</span>
        </div>
        {billingMessage && <p className="text-sm text-red-600">{billingMessage}</p>}
        <div className="flex flex-wrap gap-4 text-sm">
          <form action={setPriceAction.bind(null, business.id)} className="flex items-end gap-2">
            <label className="flex flex-col gap-1 text-xs text-neutral-500">
              Precio mensual (USD)
              <input
                name="price"
                inputMode="decimal"
                defaultValue={business.monthlyPriceCents ? (business.monthlyPriceCents / 100).toFixed(2) : ""}
                className="w-28 rounded-md border px-2 py-1 text-sm"
              />
            </label>
            <button className="rounded-md border px-2 py-1">Guardar</button>
          </form>
          <form action={setTrialAction.bind(null, business.id)} className="flex items-end gap-2">
            <label className="flex flex-col gap-1 text-xs text-neutral-500">
              Prueba gratis: días desde hoy
              <input name="trialDays" type="number" min={0} max={365} defaultValue={30} className="w-24 rounded-md border px-2 py-1 text-sm" />
            </label>
            <button className="rounded-md border px-2 py-1">Dar prueba</button>
          </form>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <form action={issueInvoiceAction.bind(null, business.id)}>
            <button className="rounded-md bg-brand px-3 py-1.5 text-white hover:bg-brand-hover">Emitir factura del próximo mes</button>
          </form>
          <form action={setSuspendedAction.bind(null, business.id, !business.billingSuspended)}>
            <button className="text-sm underline">{business.billingSuspended ? "Reactivar servicio" : "Suspender servicio"}</button>
          </form>
        </div>
        {!bank && (
          <p className="text-xs text-amber-700 dark:text-amber-300">
            Falta BILLING_BANK_DETAILS en las variables de entorno: el consultorio no verá a qué cuenta transferir.
          </p>
        )}
        {invoices.length > 0 && (
          <ul className="divide-y text-sm">
            {invoices.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <span className="font-mono">{transferReference(inv)}</span> · {inv.periodStart} a {inv.periodEnd} ·{" "}
                  {formatMoney(inv.amountCents, inv.currency)}
                </span>
                {inv.status === "pending" ? (
                  <span className="flex items-center gap-2">
                    <form action={markPaidAction.bind(null, business.id, inv.id)} className="flex items-center gap-1">
                      <input name="reference" placeholder="N.º de transferencia" className="w-40 rounded-md border px-2 py-1 text-xs" />
                      <button className="rounded-md border px-2 py-1 text-xs">Marcar pagada</button>
                    </form>
                    <form action={voidInvoiceAction.bind(null, business.id, inv.id)}>
                      <button className="text-xs text-neutral-500 underline">Anular</button>
                    </form>
                  </span>
                ) : (
                  <span className="text-neutral-500">
                    {inv.status === "paid" ? `Pagada${inv.paymentReference ? ` · ${inv.paymentReference}` : ""}` : "Anulada"}
                  </span>
                )}
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
              <span className="text-neutral-500">{m.role === "doctor" ? "Doctor" : "Asistente"}{m.managesClinic ? " · administra" : ""}</span>
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
