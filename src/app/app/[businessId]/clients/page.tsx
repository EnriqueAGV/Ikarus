import Link from "next/link";
import { requireBusinessAccess } from "@/lib/auth";
import { listClients } from "@/lib/dashboard/appointments";
import { formatLocal, formatPhone, settingsErrorLabel } from "@/lib/dashboard/labels";
import { createPatientAction } from "../actions";

export default async function ClientsPage({ params, searchParams }: PageProps<"/app/[businessId]/clients">) {
  const { businessId } = await params;
  const { q, new: open, recordError, archived } = await searchParams;
  const { business } = await requireBusinessAccess(businessId);
  const query = typeof q === "string" ? q : "";
  const showArchived = archived === "1";
  const rows = await listClients(business.id, query, { archived: showArchived });
  const error = typeof recordError === "string" ? settingsErrorLabel[recordError] ?? "Algo salió mal." : null;
  const input = "rounded-md border px-2 py-1 text-sm";
  const label = "flex flex-col gap-1 text-xs text-neutral-500";

  return (
    <div className="flex flex-col gap-4">
      <form className="flex gap-2">
        <input
          name="q"
          defaultValue={query}
          placeholder="Buscar por nombre o teléfono"
          className="w-full max-w-sm rounded-md border px-3 py-1.5 text-sm"
        />
        {showArchived && <input type="hidden" name="archived" value="1" />}
        <button className="rounded-md border px-3 py-1.5 text-sm">Buscar</button>
        <Link
          href={showArchived ? `/app/${business.id}/clients` : `/app/${business.id}/clients?archived=1`}
          className="self-center whitespace-nowrap text-sm text-neutral-500 hover:underline"
        >
          {showArchived ? "Ver activos" : "Ver archivados"}
        </Link>
      </form>
      <details open={open === "1"} className="rounded-md border p-4">
        <summary className="cursor-pointer text-sm font-medium">Nuevo paciente</summary>
        <form action={createPatientAction.bind(null, business.id)} className="mt-3 grid gap-3 sm:grid-cols-2">
          {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
          <label className={label}>
            Nombre completo
            <input name="name" required className={input} />
          </label>
          <label className={label}>
            WhatsApp (opcional)
            <input name="phone" type="tel" placeholder="7000 0000" className={input} />
          </label>
          <label className={label}>
            Fecha de nacimiento
            <input name="dateOfBirth" type="date" className={input} />
          </label>
          <label className={label}>
            Sexo
            <select name="sex" defaultValue="" className={input}>
              <option value="">Sin indicar</option>
              <option value="female">Femenino</option>
              <option value="male">Masculino</option>
            </select>
          </label>
          <p className="text-xs text-neutral-500 sm:col-span-2">
            Si el número ya es de otro paciente (por ejemplo, la mamá), el nuevo paciente comparte ese WhatsApp y el
            asistente lo reconoce cuando ella escribe.
          </p>
          <div className="flex justify-end sm:col-span-2">
            <button className="rounded-md bg-brand px-3 py-1.5 text-sm text-white hover:bg-brand-hover">Registrar paciente</button>
          </div>
        </form>
      </details>
      {rows.length === 0 ? (
        <p className="rounded-md border p-6 text-center text-sm text-neutral-500">
          {showArchived ? "No hay pacientes archivados." : query ? "Ningún paciente coincide con la búsqueda." : "Aún no hay pacientes. Aparecen cuando escriben por WhatsApp, o puedes registrarlos en Nuevo paciente."}
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {rows.map(({ client, appointmentCount, lastAppointment }) => (
            <li key={client.id}>
              <Link
                href={`/app/${business.id}/clients/${client.id}`}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-900"
              >
                <div>
                  <div className="font-medium">{client.name ?? "Sin nombre"}</div>
                  <div className="text-sm text-neutral-500">{formatPhone(client.waPhone)}</div>
                </div>
                <div className="flex items-center gap-3 text-sm text-neutral-500">
                  {client.mergedIntoId && (
                    <span className="rounded bg-sky-100 px-2 py-0.5 text-xs text-sky-900">Unido a otro expediente</span>
                  )}
                  {client.agentPaused && (
                    <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                      Esperando al equipo
                    </span>
                  )}
                  <span>
                    {appointmentCount} {appointmentCount === 1 ? "cita" : "citas"}
                    {lastAppointment ? ` · última ${formatLocal(new Date(lastAppointment), business.timezone, "d MMM yyyy")}` : ""}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
