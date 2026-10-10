import { fromZonedTime } from "date-fns-tz";
import Link from "next/link";
import { ConfirmButton } from "@/components/confirm-button";
import { LIVE_APPOINTMENT_STATUSES } from "@/db/schema";
import { can, requireBusinessAccess } from "@/lib/auth";
import { listPractitioners } from "@/lib/booking/practitioners";
import {
  appointmentsBetween,
  needingCall,
  shiftDate,
  todayIn,
  upcomingForBusiness,
  weekStart,
} from "@/lib/dashboard/appointments";
import { blocksBetween } from "@/lib/dashboard/agenda";
import {
  appointmentLabel,
  appointmentTone,
  formatLocal,
  formatPhone,
  noticeLabel,
  settingsErrorLabel,
} from "@/lib/dashboard/labels";
import { addTimeBlockAction, appointmentAction, removeTimeBlockAction } from "./actions";
import { startNoteAction } from "./notes-actions";

type View = "day" | "week" | "list";
type Row = Awaited<ReturnType<typeof upcomingForBusiness>>[number];

const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const live = new Set<string>(LIVE_APPOINTMENT_STATUSES);

export default async function AppointmentsPage({ params, searchParams }: PageProps<"/app/[businessId]">) {
  const { businessId } = await params;
  const sp = await searchParams;
  const membership = await requireBusinessAccess(businessId);
  const { business } = membership;
  const tz = business.timezone;
  const consults = can(membership, "notes.write") && membership.practitionerId !== null;
  const view: View = sp.view === "week" || sp.view === "list" ? sp.view : "day";
  const today = todayIn(tz);
  const date = isDate(sp.date) ? sp.date : today;
  const base = `/app/${business.id}`;
  const href = (v: View, d = date) => `${base}?view=${v}&date=${d}`;

  const from = view === "week" ? weekStart(date) : date;
  const days = view === "week" ? 7 : 1;
  const rows =
    view === "list" ? await upcomingForBusiness(business.id) : await appointmentsBetween(business, from, shiftDate(from, days));
  const blocks = view === "day" ? await blocksBetween(business.id, fromZonedTime(`${date}T00:00:00`, tz), fromZonedTime(`${shiftDate(date, 1)}T00:00:00`, tz)) : [];
  const doctors = await listPractitioners(business.id, { activeOnly: true });
  // The doctor only shows once the clinic has a second one.
  const showDoctor = doctors.length > 1;
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
  const error = one(sp.error) ? settingsErrorLabel[one(sp.error)] ?? "Algo salió mal." : null;
  const success = one(sp.booked)
    ? one(sp.notified)
      ? "Cita agendada. Le avisamos al paciente por WhatsApp."
      : one(sp.notice)
        ? `Cita agendada, pero no se le avisó al paciente: ${noticeLabel[one(sp.notice)] ?? "no se pudo enviar el mensaje."}`
        : "Cita agendada."
    : one(sp.blocked)
      ? "Horario bloqueado."
      : null;
  const toCall = await needingCall(business.id);
  const now = new Date();

  return (
    <div className="flex flex-col gap-4">
      {toCall.length > 0 && (
        <section className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950 dark:text-red-200">
          <p className="font-medium">
            {toCall.length === 1 ? "1 paciente no confirmó su cita" : `${toCall.length} pacientes no confirmaron su cita`}. Llámalos para confirmar o cancelar.
          </p>
          <ul className="mt-1">
            {toCall.map((r) => (
              <li key={r.appointment.id}>
                <Link href={`${base}/clients/${r.appointment.clientId}`} className="hover:underline">
                  <span className="capitalize">{formatLocal(r.appointment.startsAt, tz, "EEE d MMM, HH:mm")}</span> ·{" "}
                  {r.clientName ?? formatPhone(r.clientPhone)} · {formatPhone(r.clientPhone)}
                  {showDoctor && ` · ${r.practitionerName}`}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {success && (
        <p className="rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-900 dark:bg-green-950 dark:text-green-200">
          {success}
        </p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href={`${base}/appointments/new`} className="rounded-md bg-brand px-3 py-1.5 text-sm text-white hover:bg-brand-hover">
            Nueva cita
          </Link>
          <div className="flex gap-1 rounded-md border p-0.5 text-sm">
            {(["day", "week", "list"] as const).map((v) => (
              <Link
                key={v}
                href={href(v)}
                className={`rounded px-3 py-1 ${view === v ? "bg-brand text-white" : ""}`}
              >
                {{ day: "Día", week: "Semana", list: "Próximas" }[v]}
              </Link>
            ))}
          </div>
        </div>
        {view !== "list" && (
          <div className="flex items-center gap-2 text-sm">
            <Link href={href(view, shiftDate(date, -days))} className="rounded-md border px-2 py-1" aria-label="Anterior">
              ←
            </Link>
            <Link href={href(view, today)} className="rounded-md border px-3 py-1">
              Hoy
            </Link>
            <Link href={href(view, shiftDate(date, days))} className="rounded-md border px-2 py-1" aria-label="Siguiente">
              →
            </Link>
            <span className="ml-2 font-medium capitalize">
              {view === "day"
                ? formatLocal(new Date(`${date}T12:00:00Z`), "UTC", "EEEE d 'de' MMMM")
                : `${formatLocal(new Date(`${from}T12:00:00Z`), "UTC", "d MMM")} – ${formatLocal(
                    new Date(`${shiftDate(from, 6)}T12:00:00Z`),
                    "UTC",
                    "d MMM yyyy",
                  )}`}
            </span>
          </div>
        )}
      </div>

      {view === "week" ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-7">
          {Array.from({ length: 7 }, (_, i) => shiftDate(from, i)).map((d) => {
            const dayRows = rows.filter((r) => formatLocal(r.appointment.startsAt, tz, "yyyy-MM-dd") === d);
            return (
              <section key={d} className={`rounded-md border p-2 ${d === today ? "border-brand" : ""}`}>
                <Link href={href("day", d)} className="mb-2 block text-xs font-medium capitalize hover:underline">
                  {formatLocal(new Date(`${d}T12:00:00Z`), "UTC", "EEE d")}
                </Link>
                <ul className="flex flex-col gap-1">
                  {dayRows.map((r) => (
                    <li key={r.appointment.id}>
                      <Link
                        href={`${base}/clients/${r.appointment.clientId}`}
                        className={`block rounded px-2 py-1 text-xs ${appointmentTone(r.appointment)}`}
                      >
                        <span className="font-medium">{formatLocal(r.appointment.startsAt, tz, "HH:mm")}</span>{" "}
                        {r.clientName ?? formatPhone(r.clientPhone)}
                        <span className="block opacity-75">
                          {r.serviceName}
                          {showDoctor && ` · ${r.practitionerName}`}
                        </span>
                      </Link>
                    </li>
                  ))}
                  {dayRows.length === 0 && <li className="text-xs text-neutral-400">—</li>}
                </ul>
              </section>
            );
          })}
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-md border p-6 text-center text-sm text-neutral-500">
          {view === "list" ? "No hay citas próximas." : "No hay citas este día."}
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {rows.map((r) => (
            <AppointmentRow key={r.appointment.id} row={r} tz={tz} base={base} now={now} showDate={view === "list"} showDoctor={showDoctor} consult={consults && formatLocal(r.appointment.startsAt, tz, "yyyy-MM-dd") === today} />
          ))}
        </ul>
      )}

      {view === "day" && doctors.length > 0 && (
        <section id="bloqueos" className="flex flex-col gap-2 rounded-md border p-4">
          <h2 className="text-sm font-medium">Horarios bloqueados</h2>
          <p className="text-xs text-neutral-500">
            Un horario bloqueado no se ofrece a los pacientes, ni por WhatsApp ni al agendar aquí. Las citas que ya
            estaban agendadas se quedan.
          </p>
          {blocks.length > 0 && (
            <ul className="divide-y text-sm">
              {blocks.map(({ block, practitionerName }) => (
                <li key={block.id} className="flex items-center justify-between gap-3 py-2">
                  <span>
                    <span className="font-medium">
                      {formatLocal(block.startsAt, tz, "HH:mm")}–{formatLocal(block.endsAt, tz, "HH:mm")}
                    </span>
                    {showDoctor && ` · ${practitionerName}`}
                    {block.note && <span className="text-neutral-500"> · {block.note}</span>}
                  </span>
                  <form action={removeTimeBlockAction.bind(null, business.id, block.id, date)}>
                    <button className="rounded-md border px-2 py-1 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-900">
                      Quitar
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <form action={addTimeBlockAction.bind(null, business.id)} className="flex flex-wrap items-end gap-2 text-sm">
            <input type="hidden" name="date" value={date} />
            {showDoctor ? (
              <label className="flex flex-col gap-1 text-xs text-neutral-500">
                Doctor
                <select name="practitionerId" className="rounded-md border px-2 py-1 text-sm">
                  {doctors.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.displayName}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <input type="hidden" name="practitionerId" value={doctors[0].id} />
            )}
            <label className="flex flex-col gap-1 text-xs text-neutral-500">
              Desde
              <input type="time" name="startTime" required className="rounded-md border px-2 py-1 text-sm" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-neutral-500">
              Hasta
              <input type="time" name="endTime" required className="rounded-md border px-2 py-1 text-sm" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-neutral-500">
              Nota (opcional)
              <input name="note" placeholder="Almuerzo, cirugía…" className="rounded-md border px-2 py-1 text-sm" />
            </label>
            <button className="rounded-md border px-3 py-1 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-900">
              Bloquear horario
            </button>
          </form>
        </section>
      )}
    </div>
  );
}

function AppointmentRow({
  row,
  tz,
  base,
  now,
  showDate,
  showDoctor,
  consult,
}: {
  row: Row;
  tz: string;
  base: string;
  now: Date;
  showDate: boolean;
  showDoctor: boolean;
  // Today's appointment, seen by a doctor: they can open a note for it.
  consult: boolean;
}) {
  const a = row.appointment;
  const isLive = live.has(a.status);
  const started = a.startsAt <= now;
  const act = (action: "confirm" | "cancel" | "completed" | "no_show") => appointmentAction.bind(null, a.businessId, a.id, action);

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="flex items-center gap-4">
        <div className="w-28 text-sm">
          <div className="font-medium">{formatLocal(a.startsAt, tz, "HH:mm")}–{formatLocal(a.endsAt, tz, "HH:mm")}</div>
          {showDate && <div className="text-xs capitalize text-neutral-500">{formatLocal(a.startsAt, tz, "EEE d MMM")}</div>}
        </div>
        <div>
          <Link href={`${base}/clients/${a.clientId}`} className="font-medium hover:underline">
            {row.clientName ?? formatPhone(row.clientPhone)}
          </Link>
          <div className="text-sm text-neutral-500">
            {row.serviceName}
            {showDoctor && ` · ${row.practitionerName}`}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded px-2 py-0.5 text-xs ${appointmentTone(a)}`}>{appointmentLabel(a)}</span>
        {consult && (isLive || a.status === "completed") && (
          <form action={startNoteAction.bind(null, a.businessId, a.clientId, a.id)}>
            <button className="rounded-md bg-brand px-2 py-1 text-xs text-white hover:bg-brand-hover">Iniciar consulta</button>
          </form>
        )}
        {isLive && !started && a.status !== "confirmed" && (
          <form action={act("confirm")}>
            <button className="rounded-md border px-2 py-1 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-900">Confirmar</button>
          </form>
        )}
        {isLive && started && (
          <>
            <form action={act("completed")}>
              <button className="rounded-md border px-2 py-1 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-900">Atendida</button>
            </form>
            <form action={act("no_show")}>
              <button className="rounded-md border px-2 py-1 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-900">No asistió</button>
            </form>
          </>
        )}
        {isLive && !started && (
          <Link
            href={`${base}/appointments/${a.id}/reschedule`}
            className="rounded-md border px-2 py-1 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-900"
          >
            Mover
          </Link>
        )}
        {isLive && !started && (
          <form action={act("cancel")}>
            <ConfirmButton
              message="¿Cancelar esta cita? El horario quedará libre."
              className="rounded-md border px-2 py-1 text-xs text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
            >
              Cancelar
            </ConfirmButton>
          </form>
        )}
      </div>
    </li>
  );
}
