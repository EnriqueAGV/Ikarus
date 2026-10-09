import { and, asc, desc, eq, gte, ilike, inArray, lt, or, sql } from "drizzle-orm";
import { addDays } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { db, schema } from "@/db";
import { LIVE_APPOINTMENT_STATUSES } from "@/db/schema";
import { inngest } from "@/inngest/client";

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

export type BusinessAction = "cancel" | "completed" | "no_show";

// Staff actions on one appointment. Cancelling frees the slot and stops its
// reminders; completed and no-show record what happened after it started.
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
        : { status: action },
    )
    .where(
      and(
        eq(schema.appointments.id, appointmentId),
        eq(schema.appointments.businessId, businessId),
        inArray(schema.appointments.status, LIVE),
        // Outcomes only make sense once the appointment has started.
        action === "cancel" ? undefined : lt(schema.appointments.startsAt, now),
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

export async function listClients(businessId: string, query?: string) {
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
        q ? or(ilike(schema.clients.name, `%${q}%`), ilike(schema.clients.waPhone, `%${q.replace(/\D/g, "") || q}%`)) : undefined,
      ),
    )
    .groupBy(schema.clients.id)
    .orderBy(desc(schema.clients.agentPaused), desc(schema.clients.createdAt))
    .limit(200);
}

export async function getClientDetail(businessId: string, clientId: string) {
  const [client] = await db
    .select()
    .from(schema.clients)
    .where(and(eq(schema.clients.id, clientId), eq(schema.clients.businessId, businessId)));
  if (!client) return null;
  const [appointments, messages] = await Promise.all([
    db
      .select({ appointment: schema.appointments, serviceName: schema.services.name })
      .from(schema.appointments)
      .innerJoin(schema.services, eq(schema.services.id, schema.appointments.serviceId))
      .where(eq(schema.appointments.clientId, client.id))
      .orderBy(desc(schema.appointments.startsAt)),
    db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.clientId, client.id))
      .orderBy(desc(schema.messages.createdAt))
      .limit(50),
  ]);
  return { client, appointments, messages: messages.reverse() };
}

export async function setAgentPaused(businessId: string, clientId: string, paused: boolean) {
  await db
    .update(schema.clients)
    .set({ agentPaused: paused })
    .where(and(eq(schema.clients.id, clientId), eq(schema.clients.businessId, businessId)));
}
