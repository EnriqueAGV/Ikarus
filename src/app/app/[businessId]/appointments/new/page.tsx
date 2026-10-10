import Link from "next/link";
import { requireBusinessAccess } from "@/lib/auth";
import { toLocalString } from "@/lib/booking/availability";
import { listPractitioners } from "@/lib/booking/practitioners";
import { availableSlots, listActiveServices } from "@/lib/booking/service";
import { patientForBooking } from "@/lib/dashboard/agenda";
import { listClients, todayIn } from "@/lib/dashboard/appointments";
import { formatPhone, settingsErrorLabel } from "@/lib/dashboard/labels";
import { bookForPatientAction } from "../../actions";
import { SlotPicker } from "../slot-picker";

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

// Booking for a patient who called or walked in: pick the patient, then a
// free time on the calendar.
export default async function NewAppointmentPage({ params, searchParams }: PageProps<"/app/[businessId]/appointments/new">) {
  const { businessId } = await params;
  const sp = await searchParams;
  const { business } = await requireBusinessAccess(businessId);
  const base = `/app/${business.id}`;
  const error = one(sp.error) ? settingsErrorLabel[one(sp.error)] ?? "Algo salió mal." : null;
  const patient = one(sp.clientId) ? await patientForBooking(business.id, one(sp.clientId)) : null;

  if (!patient) {
    const q = one(sp.q);
    const rows = q ? await listClients(business.id, q) : [];
    return (
      <div className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Nueva cita</h2>
        <p className="text-sm text-neutral-500">¿Para qué paciente es la cita?</p>
        <form className="flex gap-2">
          <input
            name="q"
            defaultValue={q}
            autoFocus
            placeholder="Buscar por nombre o teléfono"
            className="w-full max-w-sm rounded-xl border px-3 py-1.5 text-sm"
          />
          <button className="rounded-full border px-4 py-1.5 text-sm bg-white hover:bg-neutral-50">Buscar</button>
        </form>
        {q && (
          <ul className="card divide-y overflow-hidden">
            {rows.slice(0, 20).map(({ client }) => (
              <li key={client.id}>
                <Link
                  href={`${base}/appointments/new?clientId=${client.id}`}
                  className="flex justify-between px-4 py-2 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-900"
                >
                  <span className="font-medium">{client.name ?? "Sin nombre"}</span>
                  <span className="text-neutral-500">{formatPhone(client.waPhone)}</span>
                </Link>
              </li>
            ))}
            {rows.length === 0 && <li className="px-4 py-3 text-sm text-neutral-500">Ningún paciente coincide.</li>}
          </ul>
        )}
        <p className="text-sm">
          ¿Es la primera vez que viene?{" "}
          <Link href={`${base}/clients?new=1`} className="text-brand hover:underline">
            Registra al paciente
          </Link>{" "}
          y agenda desde su expediente.
        </p>
      </div>
    );
  }

  const [services, doctors] = await Promise.all([
    listActiveServices(business.id),
    listPractitioners(business.id, { activeOnly: true }),
  ]);
  const today = todayIn(business.timezone);
  const date = isDate(one(sp.date)) && one(sp.date) >= today ? one(sp.date) : today;
  const serviceId = services.some((s) => s.id === one(sp.serviceId)) ? one(sp.serviceId) : services[0]?.id;
  const doctorId = doctors.some((d) => d.id === one(sp.doctor)) ? one(sp.doctor) : null;
  const query = (d: string) =>
    new URLSearchParams({ clientId: patient.id, ...(serviceId && { serviceId }), ...(doctorId && { doctor: doctorId }), date: d });
  const href = (d: string) => `${base}/appointments/new?${query(d)}`;
  const slots = serviceId
    ? (await availableSlots(business, { serviceId, fromDate: date, toDate: date, practitionerId: doctorId })) ?? []
    : [];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">Nueva cita</h2>
        <p className="text-sm">
          Para{" "}
          <Link href={`${base}/clients/${patient.id}`} className="font-medium hover:underline">
            {patient.name ?? formatPhone(patient.waPhone)}
          </Link>{" "}
          ·{" "}
          <Link href={`${base}/appointments/new`} className="text-brand hover:underline">
            Cambiar paciente
          </Link>
        </p>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!serviceId ? (
        <p className="card p-8 text-center text-sm text-neutral-500">
          El consultorio no tiene servicios activos. Agrégalos en Ajustes.
        </p>
      ) : (
        <SlotPicker
          timezone={business.timezone}
          hidden={{ clientId: patient.id }}
          services={services.map((s) => ({ id: s.id, name: s.name }))}
          serviceId={serviceId}
          doctors={doctors.map((d) => ({ id: d.id, name: d.displayName }))}
          doctorId={doctorId}
          date={date}
          today={today}
          slots={slots}
          href={href}
          bookAction={(slot) =>
            bookForPatientAction.bind(
              null,
              business.id,
              patient.id,
              serviceId,
              slot.practitionerId,
              toLocalString(slot.startsAt, business.timezone),
              href(date),
            )
          }
          canNotify={patient.waPhone !== null}
          submitLabel="Elige un horario para agendar la cita."
        />
      )}
    </div>
  );
}
