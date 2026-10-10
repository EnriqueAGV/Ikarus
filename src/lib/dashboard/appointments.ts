import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { addDays } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { db, schema } from "@/db";
import { LIVE_APPOINTMENT_STATUSES } from "@/db/schema";
import { inngest } from "@/inngest/client";
import { conversationId, household } from "@/lib/household";

type AppointmentStatus = (typeof schema.appointmentStatus.enumValues)[number];

const LIVE: AppointmentStatus[] = [...LIVE_APPOINTMENT_STATUSES];

export function todayIn(timezone: string, now = new Date()) {
  return formatInTimeZone(now, timezone, "yyyy-MM-dd");
}

// Monday of the week containing a local date.
export function weekStart(date: string) {
  const d = new Date(`${date}T12:00:00Z`);
  const offset = (d.getUTCDay() + 6) % 7;
  return addDays(d, -offset).toISOString().slice(0, 10);
}

export function shiftDate(date: string, days: number) {
  return addDays(new Date(`${date}T12:00:00Z`), days).toISOString().slice(0, 10);
}

const appointmentColumns = {
  appointment: schema.appointments,
  serviceName: schema.services.name,
  practitionerName: schema.practitioners.displayName,
  clientName: schema.clients.name,
  clientPhone: schema.clients.waPhone,
};

// Appointments that start on local dates [fromDate, toDate), cancelled ones included.
export async function appointmentsBetween(
  business: { id: string; timezone: string },
  fromDate: string,
  toDate: string,
) {
  const start = fromZonedTime(`${fromDate}T00:00:00`, business.timezone);
  const end = fromZonedTime(`${toDate}T00:00:00`, business.timezone);
  return db
    .select(appointmentColumns)
    .from(schema.appointments)
    .innerJoin(schema.services, eq(schema.services.id, schema.appointments.serviceId))
    .innerJoin(schema.clients, eq(schema.clients.id, schema.appointments.clientId))
    .innerJoin(schema.practitioners, eq(schema.practitioners.id, schema.appointments.practitionerId))
    .where(
      and(
        eq(schema.appointments.businessId, business.id),
        gte(schema.appointments.startsAt, start),
        lt(schema.appointments.startsAt, end),
      ),
    )
    .orderBy(asc(schema.appointments.startsAt));
}

export async function upcomingForBusiness(businessId: string, now = new Date(), limit = 100) {
  return db
    .select(appointmentColumns)
    .from(schema.appointments)
    .innerJoin(schema.services, eq(schema.services.id, schema.appointments.serviceId))
    .innerJoin(schema.clients, eq(schema.clients.id, schema.appointments.clientId))
    .innerJoin(schema.practitioners, eq(schema.practitioners.id, schema.appointments.practitionerId))
    .where(
      and(
        eq(schema.appointments.businessId, businessId),
        inArray(schema.appointments.status, LIVE),
        gte(schema.appointments.endsAt, now),
      ),
    )
    .orderBy(asc(schema.appointments.startsAt))
    .limit(limit);
}

export type BusinessAction = "confirm" | "cancel" | "completed" | "no_show";

// Staff actions on one appointment. Confirming records a confirmation the
// team got by phone; cancelling frees the slot and stops its reminders;
// completed and no-show record what happened after it started.
export async function updateAppointmentByBusiness(
  businessId: string,
  appointmentId: string,
  action: BusinessAction,
  now = new Date(),
) {
  const [row] = await db
    .update(schema.appointments)
    .set(
      action === "cancel"
        ? { status: "cancelled_by_business", cancelledAt: now, cancelReason: "business" }
        : action === "confirm"
          ? { status: "confirmed", confirmedAt: now }
          : { status: action },
    )
    .where(
      and(
        eq(schema.appointments.id, appointmentId),
        eq(schema.appointments.businessId, businessId),
        inArray(schema.appointments.status, LIVE),
        // Outcomes only make sense once the appointment has started.
        action === "cancel" || action === "confirm" ? undefined : lt(schema.appointments.startsAt, now),
      ),
    )
    .returning();
  if (row && action === "cancel") {
    try {
      await inngest.send({
        name: "appointment/cancelled",
        data: { appointmentId: row.id, businessId: row.businessId, clientId: row.clientId },
      });
    } catch (err) {
      console.error("inngest.send appointment/cancelled failed", err);
    }
  }
  return row ?? null;
}

// Upcoming appointments whose patient never answered the reminders, in a
// clinic that escalates instead of cancelling: the team should call them.
export async function needingCall(businessId: string, now = new Date()) {
  return db
    .select(appointmentColumns)
    .from(schema.appointments)
    .innerJoin(schema.services, eq(schema.services.id, schema.appointments.serviceId))
    .innerJoin(schema.clients, eq(schema.clients.id, schema.appointments.clientId))
    .innerJoin(schema.practitioners, eq(schema.practitioners.id, schema.appointments.practitionerId))
    .where(
      and(
        eq(schema.appointments.businessId, businessId),
        inArray(schema.appointments.status, ["reminder_sent", "followup_sent"]),
        isNotNull(schema.appointments.escalatedAt),
        gte(schema.appointments.endsAt, now),
      ),
    )
    .orderBy(asc(schema.appointments.startsAt));
}

export type PatientListOptions = { archived?: boolean; page?: number; pageSize?: number; sort?: "name" | "recent" };
const patientFilter = (businessId: string, query = "", archived = false) => and(
  eq(schema.clients.businessId, businessId), archived ? isNotNull(schema.clients.archivedAt) : isNull(schema.clients.archivedAt),
  query.trim() ? or(ilike(schema.clients.name, `%${query.trim()}%`), ilike(schema.clients.waPhone, `%${query.replace(/\D/g, "") || query.trim()}%`)) : undefined,
);
const dateColumn = (value: unknown) => value === null ? null : new Date(String(value));
export async function listClients(businessId: string, query?: string, opts: PatientListOptions = {}) {
  return db.select({
    client: schema.clients,
    appointmentCount: sql<number>`(select count(*)::int from appointments a where a.client_id = clients.id)`,
    lastAppointment: sql<Date | null>`(select max(a.starts_at) from appointments a where a.client_id = clients.id and a.status = 'completed')`.mapWith(dateColumn),
    nextAppointment: sql<Date | null>`(select min(a.starts_at) from appointments a where a.client_id = clients.id and a.ends_at >= now() and a.status in ('booked', 'reminder_sent', 'followup_sent', 'confirmed'))`.mapWith(dateColumn),
    conversationPaused: sql<boolean>`(select c.agent_paused from clients c where c.id = coalesce(clients.holder_id, clients.id))`,
    conversationStatus: sql<string | null>`(select c.attention_status from clients c where c.id = coalesce(clients.holder_id, clients.id))`,
    sharedNumber: sql<boolean>`clients.holder_id is not null or exists(select 1 from clients c where c.holder_id = clients.id and c.archived_at is null)`,
  }).from(schema.clients).where(patientFilter(businessId, query, opts.archived))
    .orderBy(opts.sort === "name" ? asc(schema.clients.name) : desc(schema.clients.createdAt), asc(schema.clients.id))
    .limit(opts.pageSize ?? 1000).offset(((opts.page ?? 1) - 1) * (opts.pageSize ?? 1000));
}
export async function patientCount(businessId: string, query?: string, archived = false) {
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.clients).where(patientFilter(businessId, query, archived));
  return row.count;
}

// A patient with their appointments, and the WhatsApp conversation of their
// number, which belongs to the number's holder when they share it.
export async function getClientDetail(businessId: string, clientId: string, messageLimit = 50) {
  const [client] = await db
    .select()
    .from(schema.clients)
    .where(and(eq(schema.clients.id, clientId), eq(schema.clients.businessId, businessId)));
  if (!client) return null;
  const holderId = conversationId(client);
  const [appointments, messages, sharing, inbound] = await Promise.all([
    db
      .select({ appointment: schema.appointments, serviceName: schema.services.name, practitionerName: schema.practitioners.displayName })
      .from(schema.appointments)
      .innerJoin(schema.services, eq(schema.services.id, schema.appointments.serviceId))
      .innerJoin(schema.practitioners, eq(schema.practitioners.id, schema.appointments.practitionerId))
      .where(eq(schema.appointments.clientId, client.id))
      .orderBy(desc(schema.appointments.startsAt)),
    db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.clientId, holderId))
      .orderBy(desc(schema.messages.createdAt), desc(schema.messages.id))
      .limit(Math.min(1000, Math.max(50, messageLimit)) + 1),
    client.waPhone ? household(businessId, holderId) : Promise.resolve([client]),
    db.select({ createdAt: schema.messages.createdAt }).from(schema.messages).where(and(eq(schema.messages.businessId, businessId), eq(schema.messages.clientId, holderId), eq(schema.messages.direction, "inbound"))).orderBy(desc(schema.messages.createdAt)).limit(1),
  ]);
  const conversation = sharing.find((p) => p.id === holderId) ?? client;
  return {
    client,
    conversation,
    others: sharing.filter((p) => p.id !== client.id),
    appointments,
    lastInboundAt: inbound[0]?.createdAt ?? null,
    hasOlderMessages: messages.length > messageLimit,
    messages: messages.slice(0, messageLimit).reverse(),
  };
}

// The pause is on the number's conversation, so it covers everyone sharing it.
export async function setAgentPaused(businessId: string, clientId: string, paused: boolean) {
  const [client] = await db
    .select({ id: schema.clients.id, holderId: schema.clients.holderId, archivedAt: schema.clients.archivedAt, mergedIntoId: schema.clients.mergedIntoId })
    .from(schema.clients)
    .where(and(eq(schema.clients.id, clientId), eq(schema.clients.businessId, businessId)));
  if (!client || client.archivedAt || client.mergedIntoId) return;
  await db
    .update(schema.clients)
    .set(paused ? {
      agentPaused: true,
      attentionStatus: "needs_reply",
      attentionSince: sql`coalesce(${schema.clients.attentionSince}, now())`,
    } : { agentPaused: false })
    .where(and(eq(schema.clients.id, conversationId(client)), eq(schema.clients.businessId, businessId)));
}
