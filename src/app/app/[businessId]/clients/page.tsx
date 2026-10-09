import Link from "next/link";
import { requireBusinessAccess } from "@/lib/auth";
import { listClients } from "@/lib/dashboard/appointments";
import { formatLocal, formatPhone } from "@/lib/dashboard/labels";

export default async function ClientsPage({ params, searchParams }: PageProps<"/app/[businessId]/clients">) {
  const { businessId } = await params;
  const { q } = await searchParams;
  const { business } = await requireBusinessAccess(businessId);
  const query = typeof q === "string" ? q : "";
  const rows = await listClients(business.id, query);

  return (
    <div className="flex flex-col gap-4">
      <form className="flex gap-2">
        <input
          name="q"
          defaultValue={query}
          placeholder="Buscar por nombre o teléfono"
          className="w-full max-w-sm rounded-md border px-3 py-1.5 text-sm"
        />
        <button className="rounded-md border px-3 py-1.5 text-sm">Buscar</button>
      </form>
      {rows.length === 0 ? (
        <p className="rounded-md border p-6 text-center text-sm text-neutral-500">
          {query ? "Ningún paciente coincide con la búsqueda." : "Aún no hay pacientes. Aparecen cuando escriben por WhatsApp."}
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
