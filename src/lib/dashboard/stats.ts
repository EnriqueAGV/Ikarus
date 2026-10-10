import { and, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { addMonths } from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import { db, schema } from "@/db";

// A clinic's month in numbers, for its managers: appointments and what
// became of them, how many the assistant booked, new patients and WhatsApp
// conversations. Months are the clinic's local calendar months.

export const isMonth = (s: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
export const shiftMonth = (month: string, n: number) =>
  addMonths(new Date(`${month}-15T12:00:00Z`), n).toISOString().slice(0, 7);

type Business = { id: string; timezone: string };

function bounds(business: Business, month: string) {
  return {
    start: fromZonedTime(`${month}-01T00:00:00`, business.timezone),
    end: fromZonedTime(`${shiftMonth(month, 1)}-01T00:00:00`, business.timezone),
  };
}

const n = (column: ReturnType<typeof sql>) => sql<number>`${column}`.mapWith(Number);

export async function monthNumbers(business: Business, month: string) {
  const { start, end } = bounds(business, month);
  const a = schema.appointments;
  // A rescheduled appointment is counted once, at its new time.
  const counted = and(eq(a.businessId, business.id), gte(a.startsAt, start), lt(a.startsAt, end), sql`${a.cancelReason} is distinct from 'rescheduled'`);

  const [totals] = await db
    .select({
      appointments: n(sql`count(*)`),
      completed: n(sql`count(*) filter (where ${a.status} = 'completed')`),
      noShows: n(sql`count(*) filter (where ${a.status} = 'no_show')`),
      cancelled: n(sql`count(*) filter (where ${a.status} in ('cancelled_by_client', 'cancelled_by_business', 'auto_cancelled'))`),
    })
    .from(a)
    .where(counted);

  const [booked] = await db
    .select({
      byAssistant: n(sql`count(*) filter (where ${a.bookedBy} = 'assistant')`),
      byStaff: n(sql`count(*) filter (where ${a.bookedBy} = 'staff')`),
      total: n(sql`count(*)`),
    })
    .from(a)
    .where(and(eq(a.businessId, business.id), gte(a.createdAt, start), lt(a.createdAt, end), isNull(a.rescheduledFromId)));

  const [patients] = await db
    .select({ newPatients: n(sql`count(*)`) })
    .from(schema.clients)
    .where(
      and(
        eq(schema.clients.businessId, business.id),
        gte(schema.clients.createdAt, start),
        lt(schema.clients.createdAt, end),
        isNull(schema.clients.mergedIntoId),
      ),
    );

  const m = schema.messages;
  const [whatsapp] = await db
    .select({
      conversations: n(sql`count(distinct ${m.clientId}) filter (where ${m.direction} = 'inbound')`),
      received: n(sql`count(*) filter (where ${m.direction} = 'inbound')`),
    })
    .from(m)
    .where(and(eq(m.businessId, business.id), gte(m.createdAt, start), lt(m.createdAt, end)));

  const byDoctor = await db
    .select({
      practitionerId: a.practitionerId,
      name: schema.practitioners.displayName,
      appointments: n(sql`count(*)`),
      completed: n(sql`count(*) filter (where ${a.status} = 'completed')`),
      noShows: n(sql`count(*) filter (where ${a.status} = 'no_show')`),
    })
    .from(a)
    .innerJoin(schema.practitioners, eq(schema.practitioners.id, a.practitionerId))
    .where(counted)
    .groupBy(a.practitionerId, schema.practitioners.displayName)
    .orderBy(sql`count(*) desc`);

  const seen = totals.completed + totals.noShows;
  return {
    ...totals,
    // Of the appointments whose outcome was recorded.
    noShowRate: seen ? totals.noShows / seen : null,
    booked,
    newPatients: patients.newPatients,
    ...whatsapp,
    byDoctor,
  };
}

export type MonthNumbers = Awaited<ReturnType<typeof monthNumbers>>;
