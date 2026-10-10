import Link from "next/link";
import { notFound } from "next/navigation";
import { LIVE_APPOINTMENT_STATUSES } from "@/db/schema";
import { requireBusinessAccess } from "@/lib/auth";
import { toLocalString } from "@/lib/booking/availability";
import { listPractitioners } from "@/lib/booking/practitioners";
import { availableSlots } from "@/lib/booking/service";
import { liveAppointment } from "@/lib/dashboard/agenda";
import { todayIn } from "@/lib/dashboard/appointments";
import { formatLocal, formatPhone, settingsErrorLabel } from "@/lib/dashboard/labels";
import { moveAppointmentAction } from "../../../actions";
import { SlotPicker } from "../../slot-picker";

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const live = new Set<string>(LIVE_APPOINTMENT_STATUSES);

// Moving an appointment to another free time, e.g. after the patient called.
// The old time is freed only once the new one is booked.
export default async function RescheduleAppointmentPage({
  params,
  searchParams,
}: PageProps<"/app/[businessId]/appointments/[appointmentId]/reschedule">) {
  const { businessId, appointmentId } = await params;
  const sp = await searchParams;
  const { business } = await requireBusinessAccess(businessId);
  const base = `/app/${business.id}`;
  const row = await liveAppointment(business.id, appointmentId);
  if (!row) notFound();
  const a = row.appointment;
  const tz = business.timezone;
  const error = one(sp.error) ? settingsErrorLabel[one(sp.error)] ?? "Algo salió mal." : null;

  if (!live.has(a.status) || a.startsAt <= new Date()) {
    return (
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Mover cita</h2>
        <p className="text-sm text-neutral-500">Esta cita ya no se puede mover.</p>
        <Link href={base} className="text-sm text-brand hover:underline">
          Volver a la agenda
        </Link>
      </div>
    );
  }

  const doctors = await listPractitioners(business.id, { activeOnly: true });
  const today = todayIn(tz);
  const current = formatLocal(a.startsAt, tz, "yyyy-MM-dd");
  const wanted = one(sp.date);
  const date = isDate(wanted) && wanted >= today ? wanted : current;
  // Stays with the same doctor unless another one is picked.
  const doctorId = one(sp.doctor) === "any" ? null : doctors.some((d) => d.id === one(sp.doctor)) ? one(sp.doctor) : a.practitionerId;
  const href = (d: string) => `${base}/appointments/${a.id}/reschedule?${new URLSearchParams({ doctor: doctorId ?? "any", date: d })}`;
  const slots = (await availableSlots(business, { serviceId: a.serviceId, fromDate: date, toDate: date, practitionerId: doctorId })) ?? [];
  const showDoctor = doctors.length > 1;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">Mover cita</h2>
        <p className="text-sm">
          <Link href={`${base}/clients/${a.clientId}`} className="font-medium hover:underline">
            {row.clientName ?? formatPhone(row.waPhone)}
          </Link>{" "}
          · {row.serviceName}
          {showDoctor && ` · ${row.practitionerName}`} ·{" "}
          <span className="capitalize">{formatLocal(a.startsAt, tz, "EEEE d 'de' MMMM, HH:mm")}</span>
        </p>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <SlotPicker
        timezone={tz}
        hidden={{}}
        serviceId={a.serviceId}
        doctors={doctors.map((d) => ({ id: d.id, name: d.displayName }))}
        doctorId={doctorId}
        date={date}
        today={today}
        slots={slots}
        href={href}
        bookAction={(slot) =>
          moveAppointmentAction.bind(null, business.id, a.id, slot.practitionerId, toLocalString(slot.startsAt, tz), href(date))
        }
        canNotify={row.waPhone !== null}
        submitLabel="Elige el nuevo horario. El horario actual queda libre al mover la cita."
      />
    </div>
  );
}
