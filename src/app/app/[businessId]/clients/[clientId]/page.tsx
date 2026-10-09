import Link from "next/link";
import { notFound } from "next/navigation";
import { can, requireBusinessAccess } from "@/lib/auth";
import { listPractitioners } from "@/lib/booking/practitioners";
import { getClientDetail } from "@/lib/dashboard/appointments";
import {
  appointmentLabel,
  appointmentTone,
  formatLocal,
  formatPhone,
  settingsErrorLabel,
} from "@/lib/dashboard/labels";
import { logChartView, recentAccess } from "@/lib/dashboard/patients";
import { listIntakeFields } from "@/lib/dashboard/settings";
import { saveClinicalAction, saveDemographicsAction, setAgentPausedAction, staffReplyAction } from "../../actions";

const accessLabel = { view_chart: "Abrió el expediente", edit_chart: "Editó los datos", edit_clinical: "Editó los datos clínicos" } as const;
const savedLabel: Record<string, string> = { datos: "Datos guardados.", clinico: "Datos clínicos guardados." };

export default async function ClientPage({ params, searchParams }: PageProps<"/app/[businessId]/clients/[clientId]">) {
  const { businessId, clientId } = await params;
  const sp = await searchParams;
  const membership = await requireBusinessAccess(businessId);
  const { business } = membership;
  const clinical = can(membership, "chart.clinical");
  const [detail, fields, practitioners] = await Promise.all([
    getClientDetail(business.id, clientId),
    listIntakeFields(business.id),
    listPractitioners(business.id),
  ]);
  if (!detail) notFound();
  await logChartView(membership, clientId);
  const access = clinical ? await recentAccess(business.id, clientId) : [];
  const { client, appointments, messages } = detail;
  const tz = business.timezone;
  const error = typeof sp.error === "string" ? settingsErrorLabel[sp.error] ?? "Algo salió mal." : null;
  const recordError = typeof sp.recordError === "string" ? settingsErrorLabel[sp.recordError] ?? "Algo salió mal." : null;
  const saved = typeof sp.saved === "string" ? savedLabel[sp.saved] : null;
  const input = "rounded-md border px-2 py-1 text-sm";
  const label = "flex flex-col gap-1 text-xs text-neutral-500";

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
        ← Pacientes
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{client.name ?? "Sin nombre"}</h2>
          <p className="text-sm text-neutral-500">{formatPhone(client.waPhone)}</p>
        </div>
        <form action={setAgentPausedAction.bind(null, business.id, client.id, !client.agentPaused)}>
          {client.agentPaused ? (
            <div className="flex flex-col items-end gap-1">
              <span className="text-sm text-amber-700 dark:text-amber-300">El asistente está en pausa con este paciente.</span>
              <button className="rounded-md bg-brand px-3 py-1.5 text-sm text-white hover:bg-brand-hover">
                Reactivar asistente
              </button>
            </div>
          ) : (
            <button className="rounded-md border px-3 py-1.5 text-sm">Pausar asistente</button>
          )}
        </form>
      </header>

      {recordError && <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{recordError}</p>}
      {saved && <p className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">{saved}</p>}

      <section id="datos" className="rounded-md border p-4">
        <h3 className="mb-3 font-medium">Datos del paciente</h3>
        <form action={saveDemographicsAction.bind(null, business.id, client.id)} className="grid gap-3 sm:grid-cols-2">
          <label className={label}>
            Nombre completo
            <input name="name" defaultValue={client.name ?? ""} className={input} />
          </label>
          <label className={label}>
            Fecha de nacimiento
            <input name="dateOfBirth" type="date" defaultValue={client.dateOfBirth ?? ""} className={input} />
          </label>
          <label className={label}>
            Sexo
            <select name="sex" defaultValue={client.sex ?? ""} className={input}>
              <option value="">Sin indicar</option>
              <option value="female">Femenino</option>
              <option value="male">Masculino</option>
            </select>
          </label>
          <label className={label}>
            DUI
            <input name="dui" defaultValue={client.dui ?? ""} placeholder="00000000-0" className={input} />
          </label>
          <label className={`${label} sm:col-span-2`}>
            Dirección
            <input name="address" defaultValue={client.address ?? ""} className={input} />
          </label>
          <label className={label}>
            Responsable (menores)
            <input name="guardianName" defaultValue={client.guardianName ?? ""} className={input} />
          </label>
          <label className={label}>
            Teléfono del responsable
            <input name="guardianPhone" defaultValue={client.guardianPhone ?? ""} className={input} />
          </label>
          <label className={label}>
            Contacto de emergencia
            <input name="emergencyContactName" defaultValue={client.emergencyContactName ?? ""} className={input} />
          </label>
          <label className={label}>
            Teléfono de emergencia
            <input name="emergencyContactPhone" defaultValue={client.emergencyContactPhone ?? ""} className={input} />
          </label>
          <label className={label}>
            Doctor de preferencia
            <select name="preferredPractitionerId" defaultValue={client.preferredPractitionerId ?? ""} className={input}>
              <option value="">Ninguno</option>
              {practitioners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                  {p.active ? "" : " (inactivo)"}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end justify-end">
            <button className="rounded-md bg-brand px-3 py-1.5 text-sm text-white hover:bg-brand-hover">Guardar datos</button>
          </div>
        </form>
      </section>

      {clinical && (
        <section id="clinico" className="rounded-md border p-4">
          <h3 className="mb-1 font-medium">Datos clínicos</h3>
          <p className="mb-3 text-xs text-neutral-500">Solo los doctores del consultorio ven esta sección.</p>
          <form action={saveClinicalAction.bind(null, business.id, client.id)} className="grid gap-3 sm:grid-cols-2">
            <label className={label}>
              Alergias
              <textarea name="allergies" rows={3} defaultValue={client.allergies ?? ""} className={input} />
            </label>
            <label className={label}>
              Enfermedades crónicas
              <textarea name="chronicConditions" rows={3} defaultValue={client.chronicConditions ?? ""} className={input} />
            </label>
            <div className="flex justify-end sm:col-span-2">
              <button className="rounded-md bg-brand px-3 py-1.5 text-sm text-white hover:bg-brand-hover">Guardar datos clínicos</button>
            </div>
          </form>
        </section>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <section className="rounded-md border p-4">
          <h3 className="mb-3 font-medium">Respuestas por WhatsApp</h3>
          {answers.length === 0 ? (
            <p className="text-sm text-neutral-500">El consultorio no pide datos adicionales.</p>
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
                  <span className={`rounded px-2 py-0.5 text-xs ${appointmentTone(a)}`}>
                    {appointmentLabel(a)}
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
          <textarea name="text" rows={2} required placeholder="Responder como el consultorio" className="rounded-md border px-3 py-2 text-sm" />
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-neutral-500">Al responder, el asistente se pausa con este paciente.</p>
            <button className="rounded-md bg-brand px-3 py-1.5 text-sm text-white hover:bg-brand-hover">
              Enviar por WhatsApp
            </button>
          </div>
        </form>
      </section>

      {clinical && (
        <section className="rounded-md border p-4">
          <h3 className="mb-3 font-medium">Accesos al expediente</h3>
          <ul className="flex flex-col gap-1 text-sm">
            {access.map((a) => (
              <li key={a.id} className="flex justify-between gap-2">
                <span>
                  {a.practitionerName ?? a.fullName ?? a.email} · {accessLabel[a.action]}
                </span>
                <span className="text-neutral-500">{formatLocal(a.createdAt, tz, "d MMM yyyy, HH:mm")}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function isStaff(payload: unknown) {
  return typeof payload === "object" && payload !== null && "sentBy" in payload;
}
