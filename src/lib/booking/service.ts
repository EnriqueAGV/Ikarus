import { and, asc, eq, gt, gte, inArray, lt } from "drizzle-orm";
import { addDays } from "date-fns";
import { es } from "date-fns/locale";
import { formatInTimeZone } from "date-fns-tz";
import { db, schema } from "@/db";
import { LIVE_APPOINTMENT_STATUSES } from "@/db/schema";
import { inngest } from "@/inngest/client";
import { findSlots, fromLocalString, toLocalString } from "./availability";

type Business = typeof schema.businesses.$inferSelect;
type Appointment = typeof schema.appointments.$inferSelect;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

const EXCLUSION_VIOLATION = "23P01";

export async function listActiveServices(businessId: string) {
  return db
    .select()
    .from(schema.services)
    .where(and(eq(schema.services.businessId, businessId), eq(schema.services.active, true)))
    .orderBy(asc(schema.services.name));
}

async function getService(businessId: string, serviceId: string, exec: Executor = db) {
  const [service] = await exec
    .select()
    .from(schema.services)
    .where(
      and(
        eq(schema.services.id, serviceId),
        eq(schema.services.businessId, businessId),
        eq(schema.services.active, true),
      ),
    );
  return service ?? null;
}

// Free start times for a service between two local dates (inclusive).
export async function availableSlots(
  business: Business,
  serviceId: string,
  fromDate: string,
  toDate: string,
  now = new Date(),
  exec: Executor = db,
) {
  const service = await getService(business.id, serviceId, exec);
  if (!service) return null;

  // Busy window: a day before and after the local range covers any timezone.
  const rangeStart = addDays(new Date(`${fromDate}T00:00:00Z`), -1);
  const rangeEnd = addDays(new Date(`${toDate}T00:00:00Z`), 2);
  const [rules, exceptions, busy] = await Promise.all([
    exec.select().from(schema.availabilityRules).where(eq(schema.availabilityRules.businessId, business.id)),
    exec
      .select()
      .from(schema.availabilityExceptions)
      .where(eq(schema.availabilityExceptions.businessId, business.id)),
    exec
      .select({ startsAt: schema.appointments.startsAt, endsAt: schema.appointments.endsAt })
      .from(schema.appointments)
      .where(
        and(
          eq(schema.appointments.businessId, business.id),
          inArray(schema.appointments.status, [...LIVE_APPOINTMENT_STATUSES]),
          lt(schema.appointments.startsAt, rangeEnd),
          gt(schema.appointments.endsAt, rangeStart),
        ),
      ),
  ]);

  return findSlots({
    timezone: business.timezone,
    rules,
    exceptions,
    busy,
    durationMin: service.durationMin,
    bufferMin: service.bufferMin,
    fromDate,
    toDate,
    now,
  });
}

export type BookResult =
  | { ok: true; appointment: Appointment }
  | { ok: false; reason: "unknown_service" | "invalid_time" | "slot_unavailable" | "not_found" };

export async function bookAppointment(input: {
  business: Business;
  clientId: string;
  serviceId: string;
  localStart: string;
  now?: Date;
}): Promise<BookResult> {
  const result = await db.transaction((tx) => bookInTx(tx, input));
  if (result.ok) await emit("appointment/booked", result.appointment);
  return result;
}

async function bookInTx(
  tx: Tx,
  input: { business: Business; clientId: string; serviceId: string; localStart: string; now?: Date },
  rescheduledFromId?: string,
): Promise<BookResult> {
  const { business } = input;
  const service = await getService(business.id, input.serviceId, tx);
  if (!service) return { ok: false, reason: "unknown_service" };
  const startsAt = fromLocalString(input.localStart, business.timezone);
  if (!startsAt) return { ok: false, reason: "invalid_time" };

  // Only times the calendar actually offers can be booked.
  const date = input.localStart.slice(0, 10);
  const free = await availableSlots(business, service.id, date, date, input.now, tx);
  if (!free?.some((s) => s.getTime() === startsAt.getTime())) {
    return { ok: false, reason: "slot_unavailable" };
  }

  try {
    const [appointment] = await tx
      .insert(schema.appointments)
      .values({
        businessId: business.id,
        clientId: input.clientId,
        serviceId: service.id,
        startsAt,
        endsAt: new Date(startsAt.getTime() + service.durationMin * 60_000),
        rescheduledFromId,
      })
      .returning();
    return { ok: true, appointment };
  } catch (err) {
    if (pgCode(err) === EXCLUSION_VIOLATION) return { ok: false, reason: "slot_unavailable" };
    throw err;
  }
}

export async function upcomingAppointments(businessId: string, clientId: string, now = new Date()) {
  return db
    .select({ appointment: schema.appointments, serviceName: schema.services.name })
    .from(schema.appointments)
    .innerJoin(schema.services, eq(schema.services.id, schema.appointments.serviceId))
    .where(
      and(
        eq(schema.appointments.businessId, businessId),
        eq(schema.appointments.clientId, clientId),
        inArray(schema.appointments.status, [...LIVE_APPOINTMENT_STATUSES]),
        gte(schema.appointments.startsAt, now),
      ),
    )
    .orderBy(asc(schema.appointments.startsAt));
}

async function liveAppointmentOf(tx: Tx, businessId: string, clientId: string, appointmentId: string) {
  const [row] = await tx
    .select()
    .from(schema.appointments)
    .where(
      and(
        eq(schema.appointments.id, appointmentId),
        eq(schema.appointments.businessId, businessId),
        eq(schema.appointments.clientId, clientId),
        inArray(schema.appointments.status, [...LIVE_APPOINTMENT_STATUSES]),
      ),
    )
    .for("update");
  return row ?? null;
}

export async function cancelByClient(businessId: string, clientId: string, appointmentId: string) {
  const cancelled = await db.transaction(async (tx) => {
    const appt = await liveAppointmentOf(tx, businessId, clientId, appointmentId);
    if (!appt) return null;
    const [row] = await tx
      .update(schema.appointments)
      .set({ status: "cancelled_by_client", cancelledAt: new Date(), cancelReason: "client" })
      .where(eq(schema.appointments.id, appt.id))
      .returning();
    return row;
  });
  if (cancelled) await emit("appointment/cancelled", cancelled);
  return cancelled;
}

// The old slot is released and the new one booked in one transaction: if the
// new time is taken, the client keeps the original appointment.
export async function rescheduleByClient(input: {
  business: Business;
  clientId: string;
  appointmentId: string;
  localStart: string;
  now?: Date;
}): Promise<BookResult> {
  let old: Appointment | null = null;
  let result: BookResult;
  try {
    result = await db.transaction(async (tx) => {
      old = await liveAppointmentOf(tx, input.business.id, input.clientId, input.appointmentId);
      if (!old) return { ok: false, reason: "not_found" } as const;
      await tx
        .update(schema.appointments)
        .set({ status: "cancelled_by_client", cancelledAt: new Date(), cancelReason: "rescheduled" })
        .where(eq(schema.appointments.id, old.id));
      const booked = await bookInTx(tx, { ...input, serviceId: old.serviceId }, old.id);
      if (!booked.ok) throw new KeepOriginal(booked);
      return booked;
    });
  } catch (err) {
    if (err instanceof KeepOriginal) return err.result;
    throw err;
  }

  if (result.ok && old) {
    await emit("appointment/cancelled", old);
    await emit("appointment/booked", result.appointment);
  }
  return result;
}

// Thrown inside the reschedule transaction to roll it back.
class KeepOriginal extends Error {
  constructor(readonly result: BookResult) {
    super("reschedule rolled back");
  }
}

export function describeSlot(instant: Date, timezone: string) {
  return {
    local: toLocalString(instant, timezone),
    label: formatInTimeZone(instant, timezone, "EEEE d 'de' MMMM, HH:mm", { locale: es }),
  };
}

async function emit(name: "appointment/booked" | "appointment/cancelled", a: Appointment) {
  try {
    await inngest.send({ name, data: { appointmentId: a.id, businessId: a.businessId, clientId: a.clientId } });
  } catch (err) {
    // Reminders are scheduled from these events; a failed send must not undo a booking.
    console.error(`inngest.send ${name} failed`, err);
  }
}

function pgCode(err: unknown): string | undefined {
  let e: unknown = err;
  while (e && typeof e === "object") {
    if ("code" in e && typeof (e as { code: unknown }).code === "string") return (e as { code: string }).code;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}
