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

// Archived patients only show when asked for, and then only they do.
export async function listClients(businessId: string, query?: string, opts: { archived?: boolean } = {}) {
  const q = query?.trim();
  const lastAppointment = sql<Date | null>`max(${schema.appointments.startsAt})`;
  return db
    .select({
      client: schema.clients,
      appointmentCount: sql<number>`count(${schema.appointments.id})::int`,
      lastAppointment,
    })
    .from(schema.clients)
    .leftJoin(schema.appointments, eq(schema.appointments.clientId, schema.clients.id))
    .where(
      and(
        eq(schema.clients.businessId, businessId),
        opts.archived ? isNotNull(schema.clients.archivedAt) : isNull(schema.clients.archivedAt),
        q ? or(ilike(schema.clients.name, `%${q}%`), ilike(schema.clients.waPhone, `%${q.replace(/\D/g, "") || q}%`)) : undefined,
      ),
    )
    .groupBy(schema.clients.id)
    .orderBy(desc(schema.clients.agentPaused), desc(schema.clients.createdAt))
    .limit(200);
}

// A patient with their appointments, and the WhatsApp conversation of their
// number, which belongs to the number's holder when they share it.
export async function getClientDetail(businessId: string, clientId: string) {
  const [client] = await db
    .select()
    .from(schema.clients)
    .where(and(eq(schema.clients.id, clientId), eq(schema.clients.businessId, businessId)));
  if (!client) return null;
  const holderId = conversationId(client);
  const [appointments, messages, sharing] = await Promise.all([
    db
      .select({ appointment: schema.appointments, serviceName: schema.services.name })
      .from(schema.appointments)
      .innerJoin(schema.services, eq(schema.services.id, schema.appointments.serviceId))
      .where(eq(schema.appointments.clientId, client.id))
      .orderBy(desc(schema.appointments.startsAt)),
    db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.clientId, holderId))
      .orderBy(desc(schema.messages.createdAt))
      .limit(50),
    client.waPhone ? household(businessId, holderId) : Promise.resolve([client]),
  ]);
  const conversation = sharing.find((p) => p.id === holderId) ?? client;
  return {
    client,
    conversation,
    others: sharing.filter((p) => p.id !== client.id),
    appointments,
    messages: messages.reverse(),
  };
}

// The pause is on the number's conversation, so it covers everyone sharing it.
export async function setAgentPaused(businessId: string, clientId: string, paused: boolean) {
  const [client] = await db
    .select({ id: schema.clients.id, holderId: schema.clients.holderId })
    .from(schema.clients)
    .where(and(eq(schema.clients.id, clientId), eq(schema.clients.businessId, businessId)));
  if (!client) return;
  await db
    .update(schema.clients)
    .set({ agentPaused: paused })
    .where(and(eq(schema.clients.id, conversationId(client)), eq(schema.clients.businessId, businessId)));
}
