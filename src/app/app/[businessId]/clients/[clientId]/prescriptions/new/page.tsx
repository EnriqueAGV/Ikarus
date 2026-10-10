import Link from "next/link";
import { notFound } from "next/navigation";
import { can, requireBusinessAccess } from "@/lib/auth";
import { getClientDetail } from "@/lib/dashboard/appointments";
import { formatLocal, settingsErrorLabel } from "@/lib/dashboard/labels";
import { appointmentsForNotes } from "@/lib/dashboard/notes";
import { issuePrescriptionAction } from "../../../../records-actions";

const ROWS = 5;

export default async function NewPrescriptionPage({ params, searchParams }: PageProps<"/app/[businessId]/clients/[clientId]/prescriptions/new">) {
  const { businessId, clientId } = await params;
  const sp = await searchParams;
  const membership = await requireBusinessAccess(businessId);
  if (!can(membership, "notes.write") || !membership.practitionerId) notFound();
  const detail = await getClientDetail(membership.business.id, clientId);
  if (!detail || detail.client.mergedIntoId) notFound();
  const visits = await appointmentsForNotes(membership, clientId);
  const tz = membership.business.timezone;
  const error = typeof sp.error === "string" ? (settingsErrorLabel[sp.error] ?? "Algo salió mal.") : null;
  const input = "rounded-xl border px-2 py-1.5 text-sm";

  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <Link href={`/app/${businessId}/clients/${clientId}#recetas`} className="text-sm text-neutral-500 hover:underline">
        ← {detail.client.name ?? "Paciente"}
      </Link>
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Nueva receta</h2>
        <p className="text-sm text-neutral-500">Una vez emitida no se puede cambiar. Para corregirla, emite otra.</p>
      </div>
      {error && <p className="notice notice-error text-sm">{error}</p>}
      <form action={issuePrescriptionAction.bind(null, businessId, clientId)} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          Cita
          <select name="appointmentId" defaultValue={visits[0]?.id ?? ""} className={`${input} max-w-md`}>
            {visits.map((v) => (
              <option key={v.id} value={v.id}>
                {formatLocal(v.startsAt, tz, "dd-MM-yyyy, h:mm a")} · {v.serviceName}
              </option>
            ))}
            <option value="">Sin cita</option>
          </select>
        </label>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="text-left text-xs text-neutral-500">
                <th className="pb-1 font-normal">Medicamento y concentración</th>
                <th className="pb-1 font-normal">Dosis</th>
                <th className="pb-1 font-normal">Frecuencia</th>
                <th className="pb-1 font-normal">Duración</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: ROWS }, (_, i) => (
                <tr key={i}>
                  <td className="py-1 pr-2">
                    <input name={`drug${i}`} required={i === 0} placeholder={i === 0 ? "Amoxicilina 500 mg" : ""} className={`${input} w-full`} />
                  </td>
                  <td className="py-1 pr-2">
                    <input name={`dose${i}`} placeholder={i === 0 ? "1 cápsula" : ""} className={`${input} w-full`} />
                  </td>
                  <td className="py-1 pr-2">
                    <input name={`frequency${i}`} placeholder={i === 0 ? "cada 8 horas" : ""} className={`${input} w-full`} />
                  </td>
                  <td className="py-1">
                    <input name={`duration${i}`} placeholder={i === 0 ? "7 días" : ""} className={`${input} w-full`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          Indicaciones (opcional)
          <textarea name="instructions" rows={3} maxLength={2000} className={input} placeholder="Tomar con alimentos. Regresar si hay fiebre." />
        </label>
        <div className="flex justify-end">
          <button className="rounded-full bg-brand px-4 py-2 text-sm text-white hover:bg-brand-hover font-medium shadow-sm">Emitir receta</button>
        </div>
      </form>
    </div>
  );
}
