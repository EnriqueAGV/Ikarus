import { and, asc, eq, gt, lt } from "drizzle-orm";
import { db, schema } from "@/db";
import { fromLocalString } from "@/lib/booking/availability";
import { getPractitioner } from "@/lib/booking/practitioners";
import { bookAppointment, rescheduleByBusiness, type BookResult } from "@/lib/booking/service";
import { notifyBooked, type NotifyResult } from "@/lib/reminders";

type Business = typeof schema.businesses.$inferSelect;

// What the clinic's team does on the agenda itself: book for a patient who
// called or walked in, move an appointment, and block time on a calendar.

export class AgendaError extends Error {
  constructor(readonly code: "not_found" | "unknown_practitioner" | "invalid_block") {
    super(code);
  }
}

export type StaffBookingResult = BookResult & { notice?: NotifyResult };

// Who an appointment is being booked for, as the booking page shows them.
export async function patientForBooking(businessId: string, clientId: string) {
  const [client] = await db
    .select({ id: schema.clients.id, name: schema.clients.name, waPhone: schema.clients.waPhone })
    .from(schema.clients)
    .where(and(eq(schema.clients.id, clientId), eq(schema.clients.businessId, businessId)));
  return client ?? null;
}

async function requirePatient(businessId: string, clientId: string) {
  if (!(await patientForBooking(businessId, clientId))) throw new AgendaError("not_found");
}

// Only free times can be booked, as for the WhatsApp assistant. With notify,
// the patient gets the booking on WhatsApp, and reminders follow as usual.
export async function bookForPatient(input: {
  business: Business;
  clientId: string;
  serviceId: string;
  localStart: string;
  practitionerId: string | null;
  notify: boolean;
  now?: Date;
}): Promise<StaffBookingResult> {
  await requirePatient(input.business.id, input.clientId);
  const booked = await bookAppointment({ ...input, bookedBy: "staff" });
  if (!booked.ok || !input.notify) return booked;
  return { ...booked, notice: await notifyBooked(booked.appointment.id) };
}

export async function moveAppointment(input: {
  business: Business;
  appointmentId: string;
  localStart: string;
  practitionerId: string | null;
  notify: boolean;
  now?: Date;
}): Promise<StaffBookingResult> {
  const moved = await rescheduleByBusiness(input);
  if (!moved.ok || !input.notify) return moved;
  return { ...moved, notice: await notifyBooked(moved.appointment.id) };
}

export async function liveAppointment(businessId: string, appointmentId: string) {
  const [row] = await db
    .select({
      appointment: schema.appointments,
      serviceName: schema.services.name,
      practitionerName: schema.practitioners.displayName,
      clientName: schema.clients.name,
      waPhone: schema.clients.waPhone,
    })
    .from(schema.appointments)
    .innerJoin(schema.services, eq(schema.services.id, schema.appointments.serviceId))
    .innerJoin(schema.practitioners, eq(schema.practitioners.id, schema.appointments.practitionerId))
    .innerJoin(schema.clients, eq(schema.clients.id, schema.appointments.clientId))
    .where(and(eq(schema.appointments.id, appointmentId), eq(schema.appointments.businessId, businessId)));
  return row ?? null;
}

const TIME = /^\d{2}:\d{2}$/;

export async function addTimeBlock(
  business: Business,
  input: { practitionerId: string; date: string; startTime: string; endTime: string; note: string | null },
) {
  if (!(await getPractitioner(business.id, input.practitionerId))) throw new AgendaError("unknown_practitioner");
  if (!TIME.test(input.startTime) || !TIME.test(input.endTime)) throw new AgendaError("invalid_block");
  const startsAt = fromLocalString(`${input.date}T${input.startTime}`, business.timezone);
  const endsAt = fromLocalString(`${input.date}T${input.endTime}`, business.timezone);
  if (!startsAt || !endsAt || endsAt <= startsAt) throw new AgendaError("invalid_block");
  const [block] = await db
    .insert(schema.timeBlocks)
    .values({
      businessId: business.id,
      practitionerId: input.practitionerId,
      startsAt,
      endsAt,
      note: input.note?.trim() || null,
    })
    .returning();
  return block;
}

export async function removeTimeBlock(businessId: string, blockId: string) {
  await db
    .delete(schema.timeBlocks)
    .where(and(eq(schema.timeBlocks.id, blockId), eq(schema.timeBlocks.businessId, businessId)));
}

// Blocks overlapping [from, to).
export async function blocksBetween(businessId: string, from: Date, to: Date) {
  return db
    .select({ block: schema.timeBlocks, practitionerName: schema.practitioners.displayName })
    .from(schema.timeBlocks)
    .innerJoin(schema.practitioners, eq(schema.practitioners.id, schema.timeBlocks.practitionerId))
    .where(
      and(
        eq(schema.timeBlocks.businessId, businessId),
        lt(schema.timeBlocks.startsAt, to),
        gt(schema.timeBlocks.endsAt, from),
      ),
    )
    .orderBy(asc(schema.timeBlocks.startsAt));
}
