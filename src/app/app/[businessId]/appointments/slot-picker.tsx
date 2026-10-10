import Link from "next/link";
import type { Slot } from "@/lib/booking/service";
import { shiftDate } from "@/lib/dashboard/appointments";
import { formatLocal } from "@/lib/dashboard/labels";

type Option = { id: string; name: string };

// The day's free times for one service, as buttons that book. A GET form
// picks the service, the doctor and the day; the WhatsApp notice applies to
// whichever time is chosen.
export function SlotPicker({
  timezone,
  hidden,
  services,
  serviceId,
  doctors,
  doctorId,
  date,
  today,
  slots,
  href,
  bookAction,
  canNotify,
  submitLabel,
}: {
  timezone: string;
  // Query parameters the GET form carries along (e.g. the patient).
  hidden: Record<string, string>;
  // Omitted when the service is fixed, as when moving an appointment.
  services?: Option[];
  serviceId: string;
  // Only shown once the clinic has a second doctor.
  doctors: Option[];
  doctorId: string | null;
  date: string;
  today: string;
  slots: Slot[];
  href: (date: string) => string;
  bookAction: (slot: Slot) => (form: FormData) => Promise<void>;
  canNotify: boolean;
  submitLabel: string;
}) {
  const input = "rounded-md border px-2 py-1 text-sm";
  const label = "flex flex-col gap-1 text-xs text-neutral-500";
  const showDoctor = doctors.length > 1;

  return (
    <div className="flex flex-col gap-4">
      <form className="flex flex-wrap items-end gap-3">
        {Object.entries(hidden).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        {services && (
          <label className={label}>
            Servicio
            <select name="serviceId" defaultValue={serviceId} className={input}>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {showDoctor && (
          <label className={label}>
            Doctor
            <select name="doctor" defaultValue={doctorId ?? "any"} className={input}>
              <option value="any">Cualquiera disponible</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className={label}>
          Fecha
          <input type="date" name="date" defaultValue={date} min={today} className={input} />
        </label>
        <button className="rounded-md border px-3 py-1.5 text-sm">Ver horarios</button>
      </form>

      <div className="flex items-center gap-2 text-sm">
        {date > today ? (
          <Link href={href(shiftDate(date, -1))} className="rounded-md border px-2 py-1" aria-label="Día anterior">
            ←
          </Link>
        ) : (
          <span className="rounded-md border px-2 py-1 text-neutral-300">←</span>
        )}
        <Link href={href(shiftDate(date, 1))} className="rounded-md border px-2 py-1" aria-label="Día siguiente">
          →
        </Link>
        <span className="ml-2 font-medium capitalize">
          {formatLocal(new Date(`${date}T12:00:00Z`), "UTC", "EEEE d 'de' MMMM")}
        </span>
      </div>

      {slots.length === 0 ? (
        <p className="rounded-md border p-6 text-center text-sm text-neutral-500">
          No hay horarios libres este día. Prueba otro día{showDoctor ? " u otro doctor" : ""}.
        </p>
      ) : (
        <form className="flex flex-col gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="notify" defaultChecked={canNotify} disabled={!canNotify} />
            Avisar al paciente por WhatsApp
            {!canNotify && <span className="text-xs text-neutral-500">(no tiene WhatsApp registrado)</span>}
          </label>
          <p className="text-xs text-neutral-500">{submitLabel}</p>
          <div className="flex flex-wrap gap-2">
            {slots.map((slot) => (
              <button
                key={`${slot.startsAt.getTime()}`}
                formAction={bookAction(slot)}
                className="rounded-md border px-3 py-1.5 text-sm hover:border-brand hover:bg-neutral-100 dark:hover:bg-neutral-900"
              >
                {formatLocal(slot.startsAt, timezone, "HH:mm")}
                {showDoctor && !doctorId && <span className="block text-xs text-neutral-500">{slot.practitionerName}</span>}
              </button>
            ))}
          </div>
        </form>
      )}
    </div>
  );
}
