import { displayTime } from "@/lib/dates";
import Link from "next/link";
import { LIVE_APPOINTMENT_STATUSES } from "@/db/schema";
import type { blocksBetween, DayHours } from "@/lib/dashboard/agenda";
import type { appointmentsBetween } from "@/lib/dashboard/appointments";
import { appointmentTone, formatLocal, formatPhone } from "@/lib/dashboard/labels";
import { gridRange, minutes, placeInLanes } from "@/lib/dashboard/week-layout";

type Row = Awaited<ReturnType<typeof appointmentsBetween>>[number];
type Block = Awaited<ReturnType<typeof blocksBetween>>[number];

// Height of one minute on the grid, in pixels: an hour is 72px.
const PX = 1.2;
// Cancelled appointments leave the grid: their time is free again.
const shown = new Set<string>([...LIVE_APPOINTMENT_STATUSES, "completed", "no_show"]);

// The week on a shared time axis: each appointment sits at its start time and
// is as tall as it lasts, blocked hours are hatched, and the hours a day is
// closed are shaded, so free time shows as white space.
export function WeekGrid({
  days,
  rows,
  blocks,
  hours,
  tz,
  base,
  today,
  now,
  showDoctor,
  dayHref,
}: {
  days: string[];
  rows: Row[];
  blocks: Block[];
  hours: Map<string, DayHours>;
  tz: string;
  base: string;
  today: string;
  now: Date;
  showDoctor: boolean;
  dayHref: (date: string) => string;
}) {
  const local = (d: Date) => ({ day: formatLocal(d, tz, "yyyy-MM-dd"), min: minutes(formatLocal(d, tz, "HH:mm")) });
  const items = [
    ...rows
      .filter((r) => shown.has(r.appointment.status))
      .map((r) => {
        const s = local(r.appointment.startsAt);
        const e = local(r.appointment.endsAt);
        return { kind: "appointment" as const, id: r.appointment.id, day: s.day, start: s.min, end: e.day === s.day ? e.min : 24 * 60, row: r };
      }),
    ...blocks.flatMap((b) => {
      // A block can run over several days; each day gets its own piece.
      const s = local(b.block.startsAt);
      const e = local(b.block.endsAt);
      return days
        .filter((d) => d >= s.day && d <= e.day)
        .map((d) => ({
          kind: "block" as const,
          id: `${b.block.id}:${d}`,
          day: d,
          start: d === s.day ? s.min : 0,
          end: d === e.day ? e.min : 24 * 60,
          block: b,
        }))
        .filter((i) => i.end > i.start);
    }),
  ];
  const [from, to] = gridRange(
    days.flatMap((d) => hours.get(d)?.windows ?? []),
    items.filter((i) => days.includes(i.day)),
  );
  const height = (to - from) * PX;
  const y = (m: number) => (Math.min(Math.max(m, from), to) - from) * PX;
  const hourMarks = Array.from({ length: (to - from) / 60 + 1 }, (_, i) => from + i * 60);
  const nowMin = local(now);

  return (
    <div className="card overflow-hidden">
      <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] border-b">
        <div />
        {days.map((d) => {
          const h = hours.get(d);
          return (
            <Link key={d} href={dayHref(d)} className="border-l px-2 py-2 hover:bg-black/[0.025]">
              <span className={`block text-xs font-semibold capitalize ${d === today ? "text-brand" : ""}`}>
                {formatLocal(new Date(`${d}T12:00:00Z`), "UTC", "dd-MM-yyyy")}
              </span>
              <span className="block truncate text-[11px] text-neutral-500">
                {h?.open ? `${displayTime(h.from)}–${displayTime(h.to)}` : h ? (h.note ?? "Cerrado") : ""}
              </span>
            </Link>
          );
        })}
      </div>
      <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]">
        <div className="relative" style={{ height }}>
          {hourMarks.slice(0, -1).map((m) => (
            <span
              key={m}
              className={`absolute right-2 text-[11px] tabular-nums text-neutral-400 ${m === from ? "translate-y-0.5" : "-translate-y-1/2"}`}
              style={{ top: y(m) }}
            >
              {displayTime(`${String(m / 60).padStart(2, "0")}:00`)}
            </span>
          ))}
        </div>
        {days.map((d) => {
          const h = hours.get(d);
          const placed = placeInLanes(items.filter((i) => i.day === d));
          return (
            <div key={d} className="relative border-l bg-neutral-100/80" style={{ height }}>
              {/* Open hours are white; everything else stays shaded. */}
              {(h?.windows ?? []).map(([s, e]) => (
                <div key={s} className="absolute inset-x-0 bg-white" style={{ top: y(minutes(s)), height: y(minutes(e)) - y(minutes(s)) }} />
              ))}
              {hourMarks.slice(1, -1).map((m) => (
                <div key={m} className="absolute inset-x-0 border-t border-black/[0.05]" style={{ top: y(m) }} />
              ))}
              {h && !h.open && placed.length === 0 && (
                <span className="absolute inset-x-0 top-3 text-center text-xs text-neutral-400">{h.note ?? "Cerrado"}</span>
              )}
              {placed.map((p) => {
                const top = y(p.start);
                const tall = Math.max(y(p.end) - top, 20);
                const style = {
                  top,
                  height: tall,
                  left: `calc(${(p.lane / p.lanes) * 100}% + 2px)`,
                  width: `calc(${100 / p.lanes}% - 4px)`,
                };
                const range = `${hhmm(p.start)}–${hhmm(p.end)}`;
                if (p.kind === "block") {
                  const { block, practitionerName } = p.block;
                  const label = `Bloqueado${block.note ? ` · ${block.note}` : ""}${showDoctor ? ` · ${practitionerName}` : ""}`;
                  return (
                    <div
                      key={p.id}
                      title={`${range} · ${label}`}
                      style={style}
                      className="absolute overflow-hidden rounded-md border border-dashed border-neutral-300 bg-[repeating-linear-gradient(135deg,transparent_0_5px,rgb(0_0_0/0.04)_5px_10px)] px-1.5 py-0.5 text-[11px] leading-tight text-neutral-500"
                    >
                      {label}
                    </div>
                  );
                }
                const r = p.row;
                const name = r.clientName ?? formatPhone(r.clientPhone);
                const short = tall < 40;
                return (
                  <Link
                    key={p.id}
                    href={`${base}/clients/${r.appointment.clientId}`}
                    title={`${range} · ${name} · ${r.serviceName}${showDoctor ? ` · ${r.practitionerName}` : ""}`}
                    style={style}
                    className={`absolute overflow-hidden rounded-md px-1.5 py-0.5 text-[11px] leading-tight shadow-[0_1px_2px_rgb(0_0_0/0.06)] transition hover:z-10 hover:brightness-95 ${appointmentTone(r.appointment)}`}
                  >
                    {short ? (
                      <span className="block truncate">
                        <span className="font-semibold tabular-nums">{hhmm(p.start)}</span> {name}
                      </span>
                    ) : (
                      <>
                        <span className="block font-semibold tabular-nums">{range}</span>
                        <span className="block truncate">{name}</span>
                        <span className="block truncate opacity-70">
                          {r.serviceName}
                          {showDoctor && ` · ${r.practitionerName}`}
                        </span>
                      </>
                    )}
                  </Link>
                );
              })}
              {d === today && nowMin.day === d && nowMin.min >= from && nowMin.min <= to && (
                <div className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-brand" style={{ top: y(nowMin.min) }}>
                  <span className="absolute -left-1 -top-[5px] h-2 w-2 rounded-full bg-brand" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const hhmm = (m: number) => displayTime(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
