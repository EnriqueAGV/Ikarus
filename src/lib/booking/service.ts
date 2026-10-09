import { and, asc, eq, gt, gte, inArray, lt, lte } from "drizzle-orm";
import { addDays } from "date-fns";
import { es } from "date-fns/locale";
import { formatInTimeZone } from "date-fns-tz";
import { db, schema } from "@/db";
import { LIVE_APPOINTMENT_STATUSES } from "@/db/schema";
import { inngest } from "@/inngest/client";
import { findSlots, fromLocalString, toLocalString } from "./availability";
import { conversationId } from "@/lib/household";
import { practitionersOffering } from "./practitioners";

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

export type Slot = { startsAt: Date; practitionerId: string; practitionerName: string; durationMin: number };

export type SlotQuery = {
  serviceId: string;
  // Local dates, inclusive, as YYYY-MM-DD.
  fromDate: string;
  toDate: string;
  // One doctor's calendar, or every active doctor who offers the service.
  practitionerId?: string | null;
  now?: Date;
};

// Free start times for a service between two local dates (inclusive). Across
// several doctors, each time appears once, with the first free doctor in the
// clinic's order. Null when the service does not exist.
export async function availableSlots(business: Business, q: SlotQuery, exec: Executor = db): Promise<Slot[] | null> {
  const service = await getService(business.id, q.serviceId, exec);
  if (!service) return null;
  const offering = await practitionersOffering(business.id, service.id, q.practitionerId ?? undefined, exec);
  if (!offering.length) return [];
  const ids = offering.map((o) => o.practitioner.id);

  // Busy window: a day before and after the local range covers any timezone.
  const rangeStart = addDays(new Date(`${q.fromDate}T00:00:00Z`), -1);
  const rangeEnd = addDays(new Date(`${q.toDate}T00:00:00Z`), 2);
  const [rules, exceptions, busy] = await Promise.all([
    exec
      .select()
      .from(schema.availabilityRules)
      .where(
        and(eq(schema.availabilityRules.businessId, business.id), inArray(schema.availabilityRules.practitionerId, ids)),
      ),
    exec
      .select()
      .from(schema.availabilityExceptions)
      .where(
        and(
          eq(schema.availabilityExceptions.businessId, business.id),
          inArray(schema.availabilityExceptions.practitionerId, ids),
          gte(schema.availabilityExceptions.date, q.fromDate),
          lte(schema.availabilityExceptions.date, q.toDate),
        ),
      ),
    exec
      .select({
        practitionerId: schema.appointments.practitionerId,
        startsAt: schema.appointments.startsAt,
        endsAt: schema.appointments.endsAt,
      })
      .from(schema.appointments)
      .where(
        and(
          eq(schema.appointments.businessId, business.id),
          inArray(schema.appointments.practitionerId, ids),
          inArray(schema.appointments.status, [...LIVE_APPOINTMENT_STATUSES]),
          lt(schema.appointments.startsAt, rangeEnd),
          gt(schema.appointments.endsAt, rangeStart),
        ),
      ),
  ]);

  const byTime = new Map<number, Slot>();
  for (const { practitioner, durationMin, bufferMin } of offering) {
    const mine = <T extends { practitionerId: string }>(rows: T[]) => rows.filter((r) => r.practitionerId === practitioner.id);
    const starts = findSlots({
      timezone: business.timezone,
      rules: mine(rules),
      exceptions: mine(exceptions),
      busy: mine(busy),
      durationMin,
      bufferMin,
      fromDate: q.fromDate,
      toDate: q.toDate,
      now: q.now ?? new Date(),
    });
    for (const startsAt of starts) {
      if (!byTime.has(startsAt.getTime())) {
        byTime.set(startsAt.getTime(), {
          startsAt,
          practitionerId: practitioner.id,
          practitionerName: practitioner.displayName,
          durationMin,
        });
      }
    }
  }
  return [...byTime.values()].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

export type BookResult =
  | { ok: true; appointment: Appointment }
  | {
      ok: false;
      reason: "unknown_service" | "unknown_practitioner" | "invalid_time" | "slot_unavailable" | "not_found";
    };

type BookInput = {
  business: Business;
  clientId: string;
  serviceId: string;
  localStart: string;
  // Omitted: any doctor who offers the service and is free then.
  practitionerId?: string | null;
  now?: Date;
};

export async function bookAppointment(input: BookInput): Promise<BookResult> {
  const result = await db.transaction((tx) => bookInTx(tx, input));
  if (result.ok) await emit("appointment/booked", result.appointment);
  return result;
}

async function bookInTx(tx: Tx, input: BookInput, rescheduledFromId?: string): Promise<BookResult> {
  const { business } = input;
  const service = await getService(business.id, input.serviceId, tx);
  if (!service) return { ok: false, reason: "unknown_service" };
  if (input.practitionerId) {
    const offers = await practitionersOffering(business.id, service.id, input.practitionerId, tx);
    if (!offers.length) return { ok: false, reason: "unknown_practitioner" };
  }
  const startsAt = fromLocalString(input.localStart, business.timezone);
  if (!startsAt) return { ok: false, reason: "invalid_time" };

  // Only times the calendar actually offers can be booked.
  const date = input.localStart.slice(0, 10);
  const free = await availableSlots(
    business,
    { serviceId: service.id, fromDate: date, toDate: date, practitionerId: input.practitionerId, now: input.now },
    tx,
  );
  const slot = free?.find((s) => s.startsAt.getTime() === startsAt.getTime());
  if (!slot) return { ok: false, reason: "slot_unavailable" };

  try {
    const [appointment] = await tx
      .insert(schema.appointments)
      .values({
        businessId: business.id,
        clientId: input.clientId,
        serviceId: service.id,
        practitionerId: slot.practitionerId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + slot.durationMin * 60_000),
        rescheduledFromId,
      })
      .returning();
    return { ok: true, appointment };
  } catch (err) {
    if (pgCode(err) === EXCLUSION_VIOLATION) return { ok: false, reason: "slot_unavailable" };
    throw err;
  }
}

// Upcoming appointments of one patient, or of everyone on a WhatsApp number.
export async function upcomingAppointments(businessId: string, clientIds: string | string[], now = new Date()) {
  return db
    .select({
      appointment: schema.appointments,
      serviceName: schema.services.name,
      practitionerName: schema.practitioners.displayName,
    })
    .from(schema.appointments)
    .innerJoin(schema.services, eq(schema.services.id, schema.appointments.serviceId))
    .innerJoin(schema.practitioners, eq(schema.practitioners.id, schema.appointments.practitionerId))
    .where(
      and(
        eq(schema.appointments.businessId, businessId),
        inArray(schema.appointments.clientId, [clientIds].flat()),
        inArray(schema.appointments.status, [...LIVE_APPOINTMENT_STATUSES]),
        gte(schema.appointments.startsAt, now),
      ),
    )
    .orderBy(asc(schema.appointments.startsAt));
}

async function liveAppointmentOf(tx: Tx, businessId: string, clientIds: string[], appointmentId: string) {
  const [row] = await tx
    .select()
    .from(schema.appointments)
    .where(
      and(
        eq(schema.appointments.id, appointmentId),
        eq(schema.appointments.businessId, businessId),
        inArray(schema.appointments.clientId, clientIds),
        inArray(schema.appointments.status, [...LIVE_APPOINTMENT_STATUSES]),
      ),
    )
    .for("update");
  return row ?? null;
}

// clientIds: the patients the person writing may act for (everyone on their number).
export async function cancelByClient(businessId: string, clientIds: string | string[], appointmentId: string) {
  const cancelled = await db.transaction(async (tx) => {
    const appt = await liveAppointmentOf(tx, businessId, [clientIds].flat(), appointmentId);
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
// new time is taken, the client keeps the original appointment. The doctor
// stays the same unless another one is given.
export async function rescheduleByClient(input: {
  business: Business;
  // The patients the person writing may act for (everyone on their number).
  clientIds: string | string[];
  appointmentId: string;
  localStart: string;
  practitionerId?: string | null;
  now?: Date;
}): Promise<BookResult> {
  let old: Appointment | null = null;
  let result: BookResult;
  try {
    result = await db.transaction(async (tx) => {
      old = await liveAppointmentOf(tx, input.business.id, [input.clientIds].flat(), input.appointmentId);
      if (!old) return { ok: false, reason: "not_found" } as const;
      await tx
        .update(schema.appointments)
        .set({ status: "cancelled_by_client", cancelledAt: new Date(), cancelReason: "rescheduled" })
        .where(eq(schema.appointments.id, old.id));
      const booked = await bookInTx(
        tx,
        { ...input, clientId: old.clientId, serviceId: old.serviceId, practitionerId: input.practitionerId || old.practitionerId },
        old.id,
      );
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
    // clientId is the conversation's, so the patient's replies (from the
    // number's holder) reach the reminder flow of anyone on the number.
    const [patient] = await db
      .select({ id: schema.clients.id, holderId: schema.clients.holderId })
      .from(schema.clients)
      .where(eq(schema.clients.id, a.clientId));
    const clientId = patient ? conversationId(patient) : a.clientId;
    await inngest.send({ name, data: { appointmentId: a.id, businessId: a.businessId, clientId } });
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
