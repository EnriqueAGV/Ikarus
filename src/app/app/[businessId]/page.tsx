import { fromZonedTime } from "date-fns-tz";
import Link from "next/link";
import { ConfirmButton } from "@/components/confirm-button";
import { RowMenu } from "@/components/dashboard/row-menu";
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
import { blocksBetween, openingHours, type DayHours } from "@/lib/dashboard/agenda";
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
import { WeekGrid } from "./week-grid";

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
  const blocks =
    view === "list"
      ? []
      : await blocksBetween(business.id, fromZonedTime(`${from}T00:00:00`, tz), fromZonedTime(`${shiftDate(from, days)}T00:00:00`, tz));
  const hours = view === "list" ? new Map<string, DayHours>() : await openingHours(business.id, from, shiftDate(from, days - 1));
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
  const blockError = one(sp.error) === "invalid_block" || one(sp.error) === "unknown_practitioner";
  const localDay = (d: Date) => formatLocal(d, tz, "yyyy-MM-dd");
  const longDate = (d: string) => formatLocal(new Date(`${d}T12:00:00Z`), "UTC", "EEEE d 'de' MMMM");
  const now = new Date();

  return (
    <div className="flex flex-col gap-4">
      {toCall.length > 0 && (
        <section className="notice notice-error text-sm">
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
        <p className="notice notice-ok text-sm">
          {success}
        </p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div>
            <h1 className="inline-block text-2xl font-semibold tracking-tight first-letter:uppercase">
              {view === "list"
                ? "Próximas citas"
                : view === "day"
                  ? longDate(date)
                  : `${formatLocal(new Date(`${from}T12:00:00Z`), "UTC", "d MMM")} – ${formatLocal(
                      new Date(`${shiftDate(from, 6)}T12:00:00Z`),
                      "UTC",
                      "d MMM yyyy",
                    )}`}
            </h1>
            <p className="text-sm text-neutral-500">
              {view === "day" && date === today && "Hoy · "}
              {countLabel(rows.filter((r) => live.has(r.appointment.status) || r.appointment.status === "completed" || r.appointment.status === "no_show").length)}
            </p>
          </div>
          {view !== "list" && (
            <div className="flex items-center gap-1.5 text-sm">
              <Link href={href(view, shiftDate(date, -days))} className="rounded-full border bg-white px-3 py-1.5 hover:bg-neutral-50" aria-label="Anterior">
                ←
              </Link>
              <Link
                href={href(view, today)}
                aria-current={(view === "day" ? date === today : from === weekStart(today)) ? "date" : undefined}
                className="rounded-full border bg-white px-4 py-1.5 hover:bg-neutral-50"
              >
                Hoy
              </Link>
              <Link href={href(view, shiftDate(date, days))} className="rounded-full border bg-white px-3 py-1.5 hover:bg-neutral-50" aria-label="Siguiente">
                →
              </Link>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <nav aria-label="Vista" className="flex gap-1 rounded-full bg-black/[0.05] p-1 text-sm">
            {(["day", "week", "list"] as const).map((v) => (
              <Link
                key={v}
                href={href(v)}
                aria-current={view === v ? "page" : undefined}
                className={`rounded-full px-3.5 py-1 ${view === v ? "bg-white font-medium text-foreground shadow-sm" : "text-neutral-600 hover:text-foreground"}`}
              >
                {{ day: "Día", week: "Semana", list: "Próximas" }[v]}
              </Link>
            ))}
          </nav>
          <Link href={`${base}/appointments/new`} className="rounded-full bg-brand px-4 py-1.5 text-sm text-white hover:bg-brand-hover font-medium shadow-sm">
            Nueva cita
          </Link>
        </div>
      </div>

      {view === "week" ? (
        <>
          <div className="hidden md:block">
            <WeekGrid
              days={Array.from({ length: 7 }, (_, i) => shiftDate(from, i))}
              rows={rows}
              blocks={blocks}
              hours={hours}
              tz={tz}
              base={base}
              today={today}
              now={now}
              showDoctor={showDoctor}
              dayHref={(d) => href("day", d)}
            />
          </div>
          {/* On a phone the week stays a list of days. */}
          <div className="grid grid-cols-1 gap-3 md:hidden">
            {Array.from({ length: 7 }, (_, i) => shiftDate(from, i)).map((d) => {
              const dayRows = rows.filter((r) => localDay(r.appointment.startsAt) === d);
              const dayBlocks = blocks.filter(({ block }) => localDay(block.startsAt) === d);
              const h = hours.get(d);
              return (
                <section key={d} className={`card flex flex-col p-3 ${d === today ? "ring-2 ring-brand/30" : ""} ${h && !h.open ? "bg-neutral-50" : ""}`}>
                  <Link href={href("day", d)} className="mb-2 block hover:underline">
                    <span className="block text-xs font-semibold capitalize">{formatLocal(new Date(`${d}T12:00:00Z`), "UTC", "EEE d")}</span>
                    <span className="block text-[11px] text-neutral-500">{hoursLabel(h)}</span>
                  </Link>
                  <ul className="flex flex-col gap-1">
                    {dayItems(dayRows, dayBlocks).map((item) => {
                      if (item.kind === "block") {
                        const { block, practitionerName } = item;
                        return (
                          <li key={block.id} className="rounded-lg border border-dashed px-2 py-1.5 text-xs text-neutral-500">
                            <span className="block font-medium tabular-nums">
                              {formatLocal(block.startsAt, tz, "HH:mm")}–{formatLocal(block.endsAt, tz, "HH:mm")}
                            </span>
                            Bloqueado{block.note && ` · ${block.note}`}
                            {showDoctor && ` · ${practitionerName}`}
                          </li>
                        );
                      }
                      const r = item.row;
                      const name = r.clientName ?? formatPhone(r.clientPhone);
                      return (
                        <li key={r.appointment.id}>
                          <Link
                            href={`${base}/clients/${r.appointment.clientId}`}
                            title={`${name} · ${r.serviceName}`}
                            className={`block rounded-lg px-2 py-1.5 text-xs ${appointmentTone(r.appointment)}`}
                          >
                            <span className="block font-semibold tabular-nums">
                              {formatLocal(r.appointment.startsAt, tz, "HH:mm")}–{formatLocal(r.appointment.endsAt, tz, "HH:mm")}
                            </span>
                            <span className="block line-clamp-2 break-words">{name}</span>
                            <span className="block truncate opacity-70">
                              {r.serviceName}
                              {showDoctor && ` · ${r.practitionerName}`}
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                    {dayRows.length === 0 && dayBlocks.length === 0 && (
                      <li className="text-xs text-neutral-400">{h && !h.open ? h.note ?? "Cerrado" : "Sin citas"}</li>
                    )}
                  </ul>
                </section>
              );
            })}
          </div>
        </>
      ) : view === "list" ? (
        rows.length === 0 ? (
          <p className="card p-8 text-center text-sm text-neutral-500">No hay citas próximas.</p>
        ) : (
          groupByDay(rows, localDay).map(([d, dayRows]) => (
            <section key={d} className="flex flex-col gap-2">
              <h2 className="px-1 text-sm font-semibold first-letter:uppercase">
                {d === today ? "Hoy · " : d === shiftDate(today, 1) ? "Mañana · " : ""}
                <span className={d === today || d === shiftDate(today, 1) ? "" : "inline-block first-letter:uppercase"}>{longDate(d)}</span>
                <span className="ml-2 font-normal text-neutral-500">{countLabel(dayRows.length)}</span>
              </h2>
              <ul className="card divide-y [&>li:first-child]:rounded-t-[1.25rem] [&>li:last-child]:rounded-b-[1.25rem]">
                {dayRows.map((r) => (
                  <AppointmentRow key={r.appointment.id} row={r} tz={tz} base={base} now={now} showDoctor={showDoctor} consult={consults && d === today} />
                ))}
              </ul>
            </section>
          ))
        )
      ) : rows.length === 0 && blocks.length === 0 ? (
        <p className="card p-8 text-center text-sm text-neutral-500">
          {hours.get(date)?.open === false ? (
            <>
              <span className="block font-medium text-foreground">Cerrado</span>
              {hours.get(date)?.note ?? "El consultorio no atiende este día."}
            </>
          ) : (
            <>
              <span className="block font-medium text-foreground">Sin citas</span>
              {hours.get(date)?.open && `Se atiende de ${hoursLabel(hours.get(date))}.`}
            </>
          )}
        </p>
      ) : (
        <ul className="card divide-y [&>li:first-child]:rounded-t-[1.25rem] [&>li:last-child]:rounded-b-[1.25rem]">
          {dayItems(rows, blocks).map((item) =>
            item.kind === "appointment" ? (
              <AppointmentRow key={item.row.appointment.id} row={item.row} tz={tz} base={base} now={now} showDoctor={showDoctor} consult={consults && date === today} />
            ) : (
              <li key={item.block.id} className="flex items-center justify-between gap-3 bg-neutral-50/70 px-4 py-3 text-sm">
                <div className="flex items-center gap-4">
                  <div className="w-28 font-medium tabular-nums text-neutral-500">
                    {formatLocal(item.block.startsAt, tz, "HH:mm")}–{formatLocal(item.block.endsAt, tz, "HH:mm")}
                  </div>
                  <div className="text-neutral-500">
                    <span className="font-medium">Horario bloqueado</span>
                    {item.block.note && ` · ${item.block.note}`}
                    {showDoctor && ` · ${item.practitionerName}`}
                  </div>
                </div>
                <form action={removeTimeBlockAction.bind(null, business.id, item.block.id, date)}>
                  <button className="rounded-full border bg-white px-3 py-1 text-xs hover:bg-neutral-100">Quitar</button>
                </form>
              </li>
            ),
          )}
        </ul>
      )}

      {view === "day" && doctors.length > 0 && (
        <details id="bloqueos" open={blockError} className="group">
          <summary className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border bg-white px-4 py-1.5 text-sm hover:bg-neutral-50">
            <span aria-hidden className="transition-transform group-open:rotate-45">+</span> Bloquear horario
          </summary>
          <section className="card mt-3 flex flex-col gap-3 p-5">
            <div>
              <h2 className="text-sm font-semibold">
                Bloquear horario · <span className="font-normal">{longDate(date)}</span>
              </h2>
              <p className="text-xs text-neutral-500">
                Un horario bloqueado no se ofrece a los pacientes, ni por WhatsApp ni al agendar aquí. Las citas que ya
                estaban agendadas se quedan.
              </p>
            </div>
            <form action={addTimeBlockAction.bind(null, business.id)} className="flex flex-wrap items-end gap-2 text-sm">
              <input type="hidden" name="date" value={date} />
              {showDoctor ? (
                <label className="flex flex-col gap-1 text-xs text-neutral-500">
                  Doctor
                  <select name="practitionerId" className="rounded-xl border px-2 py-1.5 text-sm">
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
                Hora de inicio
                <input type="time" name="startTime" required className="rounded-xl border px-2 py-1.5 text-sm" />
              </label>
              <label className="flex flex-col gap-1 text-xs text-neutral-500">
                Hora de fin
                <input type="time" name="endTime" required className="rounded-xl border px-2 py-1.5 text-sm" />
              </label>
              <label className="flex flex-col gap-1 text-xs text-neutral-500">
                Nota (opcional)
                <input name="note" placeholder="Almuerzo, cirugía…" className="rounded-xl border px-2 py-1.5 text-sm" />
              </label>
              <button className="rounded-full bg-brand px-4 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-brand-hover">
                Bloquear
              </button>
            </form>
          </section>
        </details>
      )}
    </div>
  );
}

type Block = Awaited<ReturnType<typeof blocksBetween>>[number];
type DayItem = ({ kind: "appointment"; row: Row } | ({ kind: "block" } & Block)) & { at: number };

// A day's appointments and blocked hours in one timeline.
function dayItems(rows: Row[], blocks: Block[]): DayItem[] {
  return [
    ...rows.map((row) => ({ kind: "appointment" as const, row, at: row.appointment.startsAt.getTime() })),
    ...blocks.map((b) => ({ kind: "block" as const, ...b, at: b.block.startsAt.getTime() })),
  ].sort((a, b) => a.at - b.at);
}

function groupByDay(rows: Row[], localDay: (d: Date) => string) {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const d = localDay(r.appointment.startsAt);
    groups.set(d, [...(groups.get(d) ?? []), r]);
  }
  return [...groups.entries()];
}

function countLabel(n: number) {
  return n === 0 ? "Sin citas" : n === 1 ? "1 cita" : `${n} citas`;
}

function hoursLabel(h: DayHours | undefined) {
  if (!h) return "";
  if (!h.open) return "Cerrado";
  return `${h.from}–${h.to}`;
}

const menuItem = "block w-full rounded-xl px-3 py-1.5 text-left hover:bg-black/[0.05]";

function AppointmentRow({
  row,
  tz,
  base,
  now,
  showDoctor,
  consult,
}: {
  row: Row;
  tz: string;
  base: string;
  now: Date;
  showDoctor: boolean;
  // Today's appointment, seen by a doctor: they can open a note for it.
  consult: boolean;
}) {
  const a = row.appointment;
  const isLive = live.has(a.status);
  const started = a.startsAt <= now;
  const act = (action: "confirm" | "cancel" | "completed" | "no_show") => appointmentAction.bind(null, a.businessId, a.id, action);
  const secondary = "rounded-full border bg-white px-3 py-1 text-xs hover:bg-neutral-100";

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="flex items-center gap-4">
        <div className="w-28 text-sm font-medium tabular-nums">
          {formatLocal(a.startsAt, tz, "HH:mm")}–{formatLocal(a.endsAt, tz, "HH:mm")}
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
        <span className={`rounded-full px-2 py-0.5 text-xs ${appointmentTone(a)}`}>{appointmentLabel(a)}</span>
        {consult && (isLive || a.status === "completed") && (
          <form action={startNoteAction.bind(null, a.businessId, a.clientId, a.id)}>
            <button className="rounded-full bg-brand px-3 py-1 text-xs text-white hover:bg-brand-hover font-medium shadow-sm">Iniciar consulta</button>
          </form>
        )}
        {isLive && !started && a.status !== "confirmed" && (
          <form action={act("confirm")}>
            <button className="rounded-full bg-brand/10 px-3 py-1 text-xs font-medium text-brand hover:bg-brand/15">Confirmar</button>
          </form>
        )}
        {isLive && started && (
          <>
            <form action={act("completed")}>
              <button className={secondary}>Atendida</button>
            </form>
            <form action={act("no_show")}>
              <button className={secondary}>No asistió</button>
            </form>
          </>
        )}
        {isLive && !started && (
          <RowMenu>
            <Link href={`${base}/appointments/${a.id}/reschedule`} role="menuitem" className={menuItem}>
              Reprogramar
            </Link>
            <form action={act("cancel")}>
              <ConfirmButton message="¿Cancelar esta cita? El horario quedará libre." className={`${menuItem} text-red-700`}>
                Cancelar cita
              </ConfirmButton>
            </form>
          </RowMenu>
        )}
      </div>
    </li>
  );
}
