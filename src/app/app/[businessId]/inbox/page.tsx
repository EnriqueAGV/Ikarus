import { connection } from "next/server";
import Link from "next/link";
import { requireBusinessAccess } from "@/lib/auth";
import { inboxCounts, pausedConversations } from "@/lib/dashboard/inbox";
import { formatLocal, formatPhone } from "@/lib/dashboard/labels";
import { RefreshButton } from "@/components/dashboard/refresh-button";
import { Pagination } from "@/components/dashboard/pagination";
import { replyEligibility } from "@/lib/messaging/eligibility";

function waited(since: Date, now: Date) {
  const minutes = Math.max(1, Math.floor((now.getTime() - since.getTime()) / 60000));
  return minutes < 60 ? `${minutes} min` : minutes < 2880 ? `${Math.floor(minutes / 60)} h` : `${Math.floor(minutes / 1440)} días`;
}
export default async function InboxPage({ params, searchParams }: PageProps<"/app/[businessId]/inbox">) {
  await connection();
  const { businessId } = await params;
  const sp = await searchParams;
  const { business } = await requireBusinessAccess(businessId);
  const counts = await inboxCounts(business.id);
  const status = sp.status === "follow_up" ? "follow_up" : "needs_reply";
  const total = status === "needs_reply" ? counts.needsReply : counts.followUp;
  const page = Math.min(Math.max(1, Math.floor(Number(sp.page) || 1)), Math.max(1, Math.ceil(total / 25)));
  const rows = await pausedConversations(business.id, { page, pageSize: 25, status });
  const now = new Date();
  const base = `/app/${business.id}/inbox`;
  return <div className="dashboard-view">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><h2 className="dashboard-heading">Por responder</h2><p className="mt-1 text-sm text-muted">Conversaciones que necesitan atención del equipo.</p></div>
      <div className="flex flex-wrap items-center gap-3"><span className="text-xs text-muted">Actualizado {formatLocal(now, business.timezone, "HH:mm")}</span><RefreshButton /></div>
    </header>
    <nav aria-label="Estado de las conversaciones" className="section-tabs">
      <Link aria-current={status === "needs_reply" ? "page" : undefined} href={base}>Pendientes <span className="badge">{counts.needsReply}</span></Link>
      <Link aria-current={status === "follow_up" ? "page" : undefined} href={`${base}?status=follow_up`}>En seguimiento <span className="badge">{counts.followUp}</span></Link>
    </nav>
    <p className="text-xs text-muted">Primero las conversaciones marcadas para revisión urgente, luego las pendientes desde hace más tiempo.</p>
    {rows.length ? <ul className="card divide-y overflow-hidden">{rows.map(({ client, lastMessage, lastInboundAt }) => {
      const eligibility = replyEligibility(!!business.phoneNumberId, client.waPhone, lastInboundAt, now);
      const href = `/app/${business.id}/clients/${client.id}?view=conversation&from=inbox#conversation`;
      return <li key={client.id} className="flex flex-wrap items-center justify-between gap-5 list-row">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><Link href={href} className="font-semibold hover:underline">{client.name ?? formatPhone(client.waPhone)}</Link>{client.attentionUrgent && <span className="badge bg-red-50 text-red-800">Revisión urgente</span>}</div>
          <p className="mt-1 text-sm text-muted">{client.attentionReason ?? "Atención del equipo"} · {formatPhone(client.waPhone)}</p>
          <p className="mt-2 truncate text-sm">{lastMessage ? `${lastMessage.direction === "outbound" ? "Último envío: " : ""}${lastMessage.body ?? "Mensaje adjunto"}` : "Sin mensajes"}</p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            {client.attentionSince && <span>Pendiente desde hace {waited(client.attentionSince, now)}</span>}
            {lastMessage && <span>Última actividad {formatLocal(lastMessage.createdAt, business.timezone, "d MMM, HH:mm")}</span>}
            <span>{eligibility.reason === "not_connected" ? "WhatsApp desconectado" : eligibility.reason === "no_whatsapp" ? "Sin WhatsApp" : eligibility.reason ? "Ventana cerrada · llamar al contacto" : "Respuesta por WhatsApp disponible"}</span>
          </div>
        </div><Link className="btn-secondary" href={href}>Abrir conversación <span aria-hidden="true">→</span></Link>
      </li>;
    })}</ul> : <div className="card px-6 py-12 text-center"><h3 className="font-semibold">{status === "needs_reply" ? "No hay conversaciones pendientes" : "No hay conversaciones en seguimiento"}</h3><p className="mx-auto mt-2 max-w-md text-sm text-muted">{status === "needs_reply" ? "Aquí aparecen las conversaciones que necesitan atención del equipo. Los mensajes automáticos no las marcan como resueltas." : "Las respuestas del equipo permanecen aquí hasta resolver la conversación."}</p></div>}
    <Pagination page={page} pageSize={25} total={total} href={p => `${base}?status=${status}&page=${p}`} />
  </div>;
}
