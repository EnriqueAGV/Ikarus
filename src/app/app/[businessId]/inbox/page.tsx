import { connection } from "next/server";
import Link from "next/link";
import { requireBusinessAccess } from "@/lib/auth";
import { pausedConversations } from "@/lib/dashboard/inbox";
import { formatLocal, formatPhone } from "@/lib/dashboard/labels";
import { setAgentPausedAction } from "../actions";

const DAY_MS = 24 * 3_600_000;

function waited(since: Date, now: Date) {
  const minutes = Math.max(1, Math.round((now.getTime() - since.getTime()) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} días`;
}

// Patients the assistant handed to the team, or whom the team took over:
// who is still waiting for an answer, and for how long.
export default async function InboxPage({ params }: PageProps<"/app/[businessId]/inbox">) {
  await connection();
  const { businessId } = await params;
  const { business } = await requireBusinessAccess(businessId);
  const rows = await pausedConversations(business.id);
  const now = new Date();
  const waiting = rows.filter((r) => r.waiting);
  const answered = rows.filter((r) => !r.waiting);

  const list = (items: typeof rows) => (
    <ul className="card divide-y overflow-hidden">
      {items.map(({ client, lastMessage, lastInboundAt, waiting }) => {
        const windowOpen = lastInboundAt !== null && now.getTime() - lastInboundAt.getTime() < DAY_MS;
        return (
          <li key={client.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <Link href={`/app/${business.id}/clients/${client.id}#conversation`} className="min-w-0 flex-1 hover:underline">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{client.name ?? formatPhone(client.waPhone)}</span>
                {waiting && lastMessage && (
                  <span className="text-xs text-amber-700">esperando desde hace {waited(lastMessage.createdAt, now)}</span>
                )}
              </div>
              <p className="truncate text-sm text-neutral-500">
                {lastMessage ? (
                  <>
                    {lastMessage.direction === "outbound" && "Tú: "}
                    {lastMessage.body ?? `(${lastMessage.type})`}
                  </>
                ) : (
                  "Sin mensajes"
                )}
              </p>
              {!windowOpen && <p className="text-xs text-neutral-500">Pasaron más de 24 horas: WhatsApp solo deja escribirle con una plantilla, así que conviene llamarle.</p>}
            </Link>
            <div className="flex items-center gap-2">
              {lastMessage && <span className="text-xs text-neutral-500">{formatLocal(lastMessage.createdAt, business.timezone, "d MMM, HH:mm")}</span>}
              <form action={setAgentPausedAction.bind(null, business.id, client.id, false)}>
                <button className="rounded-full border px-3 py-1 text-xs hover:bg-neutral-100 bg-white">Devolver al asistente</button>
              </form>
            </div>
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Por responder</h2>
        {waiting.length === 0 ? (
          <p className="card p-8 text-center text-sm text-neutral-500">Nadie está esperando al equipo.</p>
        ) : (
          list(waiting)
        )}
      </section>
      {answered.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Respondidas, con el asistente en pausa</h2>
          <p className="text-sm text-neutral-500">Cuando termines con cada uno, devuélvelo al asistente para que vuelva a responder.</p>
          {list(answered)}
        </section>
      )}
    </div>
  );
}
