import Link from "next/link";
import { notFound } from "next/navigation";
import { requireBusinessAccess } from "@/lib/auth";
import { getClientDetail } from "@/lib/dashboard/appointments";
import {
  appointmentStatusLabel,
  appointmentStatusTone,
  formatLocal,
  formatPhone,
  settingsErrorLabel,
} from "@/lib/dashboard/labels";
import { listIntakeFields } from "@/lib/dashboard/settings";
import { setAgentPausedAction, staffReplyAction } from "../../actions";

export default async function ClientPage({ params, searchParams }: PageProps<"/app/[businessId]/clients/[clientId]">) {
  const { businessId, clientId } = await params;
  const sp = await searchParams;
  const { business } = await requireBusinessAccess(businessId);
  const [detail, fields] = await Promise.all([getClientDetail(business.id, clientId), listIntakeFields(business.id)]);
  if (!detail) notFound();
  const { client, appointments, messages } = detail;
  const tz = business.timezone;
  const error = typeof sp.error === "string" ? settingsErrorLabel[sp.error] ?? "Algo salió mal." : null;

  // Answers to questions the business later removed are still shown, by key.
  const known = new Set(fields.map((f) => f.key));
  const answers = [
    ...fields.map((f) => ({ label: f.label, value: client.data[f.key] })),
    ...Object.entries(client.data)
      .filter(([k]) => !known.has(k))
      .map(([k, v]) => ({ label: k, value: v })),
  ];

  return (
    <div className="flex flex-col gap-6">
      <Link href={`/app/${business.id}/clients`} className="text-sm text-neutral-500 hover:underline">
        ← Clientes
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{client.name ?? "Sin nombre"}</h2>
          <p className="text-sm text-neutral-500">{formatPhone(client.waPhone)}</p>
        </div>
        <form action={setAgentPausedAction.bind(null, business.id, client.id, !client.agentPaused)}>
          {client.agentPaused ? (
            <div className="flex flex-col items-end gap-1">
              <span className="text-sm text-amber-700 dark:text-amber-300">El asistente está en pausa con este cliente.</span>
              <button className="rounded-md bg-brand px-3 py-1.5 text-sm text-white hover:bg-brand-hover">
                Reactivar asistente
              </button>
            </div>
          ) : (
            <button className="rounded-md border px-3 py-1.5 text-sm">Pausar asistente</button>
          )}
        </form>
      </header>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="rounded-md border p-4">
          <h3 className="mb-3 font-medium">Datos</h3>
          {answers.length === 0 ? (
            <p className="text-sm text-neutral-500">El negocio no pide datos adicionales.</p>
          ) : (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              {answers.map((a) => (
                <div key={a.label} className="contents">
                  <dt className="text-neutral-500">{a.label}</dt>
                  <dd>{a.value === undefined || a.value === null || a.value === "" ? "—" : String(a.value)}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>

        <section className="rounded-md border p-4">
          <h3 className="mb-3 font-medium">Citas</h3>
          {appointments.length === 0 ? (
            <p className="text-sm text-neutral-500">Sin citas todavía.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {appointments.map(({ appointment: a, serviceName }) => (
                <li key={a.id} className="flex items-center justify-between gap-2">
                  <span>
                    <span className="capitalize">{formatLocal(a.startsAt, tz, "EEE d MMM yyyy, HH:mm")}</span> · {serviceName}
                  </span>
                  <span className={`rounded px-2 py-0.5 text-xs ${appointmentStatusTone[a.status]}`}>
                    {appointmentStatusLabel[a.status]}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section id="conversation" className="rounded-md border p-4">
        <h3 className="mb-3 font-medium">Conversación</h3>
        <ol className="flex max-h-[32rem] flex-col gap-2 overflow-y-auto">
          {messages.map((m) => (
            <li
              key={m.id}
              className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                m.direction === "inbound"
                  ? "self-start bg-neutral-100 dark:bg-neutral-900"
                  : "self-end bg-emerald-100 dark:bg-emerald-950"
              }`}
            >
              <p className="whitespace-pre-wrap">{m.body ?? `(${m.type})`}</p>
              <p className="mt-1 text-[10px] text-neutral-500">
                {formatLocal(m.createdAt, tz, "d MMM, HH:mm")}
                {m.direction === "outbound" && (isStaff(m.payload) ? " · equipo" : " · asistente")}
              </p>
            </li>
          ))}
          {messages.length === 0 && <li className="text-sm text-neutral-500">Sin mensajes.</li>}
        </ol>
        <form action={staffReplyAction.bind(null, business.id, client.id)} className="mt-4 flex flex-col gap-2">
          {error && <p className="text-sm text-red-600">{error}</p>}
          {sp.sent && <p className="text-sm text-emerald-700">Mensaje enviado. El asistente quedó en pausa.</p>}
          <textarea name="text" rows={2} required placeholder="Responder como el negocio" className="rounded-md border px-3 py-2 text-sm" />
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-neutral-500">Al responder, el asistente se pausa con este cliente.</p>
            <button className="rounded-md bg-brand px-3 py-1.5 text-sm text-white hover:bg-brand-hover">
              Enviar por WhatsApp
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function isStaff(payload: unknown) {
  return typeof payload === "object" && payload !== null && "sentBy" in payload;
}
