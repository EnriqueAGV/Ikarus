import { addDays, addMinutes } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

// Free-slot computation for one business calendar. Pure: no database access,
// so it is unit-tested directly. All inputs and outputs are UTC instants; the
// business timezone only decides where each local day and opening hour falls.

export type WeeklyRule = { weekday: number; startTime: string; endTime: string };
export type DateException = { date: string; startTime: string | null; endTime: string | null };
export type Busy = { startsAt: Date; endsAt: Date };

export type SlotQuery = {
  timezone: string;
  rules: WeeklyRule[];
  exceptions: DateException[];
  busy: Busy[];
  durationMin: number;
  bufferMin?: number;
  // Local dates, inclusive, as YYYY-MM-DD.
  fromDate: string;
  toDate: string;
  now: Date;
  minLeadMin?: number;
  stepMin?: number;
  limit?: number;
};

export function localDates(fromDate: string, toDate: string): string[] {
  const out: string[] = [];
  // Noon UTC avoids any date shift while stepping through calendar days.
  let d = new Date(`${fromDate}T12:00:00Z`);
  const end = new Date(`${toDate}T12:00:00Z`);
  while (d <= end && out.length < 62) {
    out.push(d.toISOString().slice(0, 10));
    d = addDays(d, 1);
  }
  return out;
}

// A local date's opening hours as "HH:mm" pairs: the date's own exceptions
// when it has any (none with times means closed), otherwise the weekly rules.
export function dayHours(rules: WeeklyRule[], exceptions: DateException[], date: string): Array<[string, string]> {
  const overrides = exceptions.filter((e) => e.date === date);
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const ranges = overrides.length
    ? overrides.filter((e) => e.startTime && e.endTime)
    : rules.filter((r) => r.weekday === weekday);
  return ranges
    .map((r): [string, string] => [hhmm(r.startTime!), hhmm(r.endTime!)])
    .sort((a, b) => a[0].localeCompare(b[0]));
}

function openingWindows(q: SlotQuery, date: string): Array<[Date, Date]> {
  return dayHours(q.rules, q.exceptions, date).map(([start, end]) => [
    fromZonedTime(`${date}T${start}:00`, q.timezone),
    fromZonedTime(`${date}T${end}:00`, q.timezone),
  ]);
}

const hhmm = (t: string) => t.slice(0, 5);

export function findSlots(q: SlotQuery): Date[] {
  const step = q.stepMin ?? 30;
  const buffer = q.bufferMin ?? 0;
  const earliest = addMinutes(q.now, q.minLeadMin ?? 60);
  const limit = q.limit ?? 200;
  const slots: Date[] = [];

  for (const date of localDates(q.fromDate, q.toDate)) {
    for (const [open, close] of openingWindows(q, date)) {
      for (let start = open; addMinutes(start, q.durationMin) <= close; start = addMinutes(start, step)) {
        if (start < earliest) continue;
        const end = addMinutes(start, q.durationMin);
        const clash = q.busy.some(
          (b) => start < addMinutes(b.endsAt, buffer) && addMinutes(end, buffer) > b.startsAt,
        );
        if (!clash) slots.push(start);
        if (slots.length >= limit) return slots;
      }
    }
  }
  return slots.sort((a, b) => a.getTime() - b.getTime());
}

// "2026-10-10T10:30" in the business timezone, the format the agent speaks.
export function toLocalString(instant: Date, timezone: string) {
  return formatInTimeZone(instant, timezone, "yyyy-MM-dd'T'HH:mm");
}

export function fromLocalString(local: string, timezone: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const d = fromZonedTime(`${local}:00`, timezone);
  return Number.isNaN(d.getTime()) ? null : d;
}
