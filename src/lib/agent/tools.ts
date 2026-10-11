import { openAttention } from "@/lib/messaging/attention";
import { isoDate } from "@/lib/dates";
import type { ChatTool } from "./llm";
import { eq, sql } from "drizzle-orm";
import { addDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { z } from "zod";
import { db, schema } from "@/db";
import {
  availableSlots,
  bookAppointment,
  cancelByClient,
  describeSlot,
  listActiveServices,
  rescheduleByClient,
  upcomingAppointments,
} from "@/lib/booking/service";
import { listPractitioners } from "@/lib/booking/practitioners";
import { normalizeDui } from "@/lib/dashboard/patients";
import { addToNumber } from "@/lib/household";
import { RECEIVED_DUI_KEY, RECEIVED_NAME_KEY } from "@/lib/dashboard/intake-review";
import { type Business, type Client, type IntakeField, missingIntake, reloadClient } from "./context";
import { householdSection } from "./prompt";
import { ANSWER_MAX, type DuiVault, NAME_MAX, oneLine, REASON_MAX } from "./sanitize";

type Tool = { name: string; description: string; input_schema: Record<string, unknown> };

const obj = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({
  type: "object" as const,
  properties,
  required,
  additionalProperties: false,
});
const localDateTime = { type: "string", description: "Local time, YYYY-MM-DDTHH:mm" };
const practitionerId = (description: string) => ({ type: ["string", "null"], description });
const patientId = {
  type: ["string", "null"],
  description: "The patient's id from 'Patients on this WhatsApp number', or null for the person writing",
};

export const TOOLS: Tool[] = [
  {
    name: "save_client_info",
    description:
      "Save a patient's name, DUI and/or answers to the clinic's intake questions. Call it as soon as they are given.",
    input_schema: obj({
      patient_id: patientId,
      name: { type: ["string", "null"], description: "Patient's full name, or null if not given now" },
      dui: { type: ["string", "null"], description: 'The "[DUI n]" token the patient\'s DUI appears as in the conversation, or null if not given now' },
      answers: {
        type: "array",
        description: "Answers to intake questions, by question key",
        items: obj({ key: { type: "string" }, value: { type: "string" } }),
      },
    }),
  },
  {
    name: "add_patient",
    description:
      "Register another patient who uses this WhatsApp number (e.g. the writer's child or parent), when the appointment is for someone not yet listed. Returns their patient_id.",
    input_schema: obj({ name: { type: "string", description: "The patient's full name" } }),
  },
  {
    name: "list_services",
    description: "List the services the business offers, with their ids and durations.",
    input_schema: obj({}),
  },
  {
    name: "list_practitioners",
    description: "List the clinic's doctors, with their ids, specialty and the ids of the services each one offers.",
    input_schema: obj({}),
  },
  {
    name: "find_available_slots",
    description:
      "Find free start times for a service between two local dates (inclusive, at most 14 days apart). With no dates, searches the next 7 days. Each slot says which doctor it is with; `suggested` picks the earliest times spread over a few days, to offer first.",
    input_schema: obj({
      service_id: { type: "string" },
      date_from: { type: ["string", "null"], description: "YYYY-MM-DD, or null for today" },
      date_to: { type: ["string", "null"], description: "YYYY-MM-DD, or null for 7 days after date_from" },
      practitioner_id: practitionerId("One doctor's id from list_practitioners, or null for any doctor who offers the service"),
    }),
  },
  {
    name: "book_appointment",
    description:
      "Book a patient into a free slot returned by find_available_slots. Only after the person confirmed who it is for, the service, day and time.",
    input_schema: obj({
      patient_id: patientId,
      service_id: { type: "string" },
      start: localDateTime,
      practitioner_id: practitionerId("The doctor of the chosen slot, or null for any free doctor who offers the service"),
    }),
  },
  {
    name: "list_my_appointments",
    description: "List the upcoming appointments of every patient on this WhatsApp number.",
    input_schema: obj({}),
  },
  {
    name: "cancel_appointment",
    description: "Cancel one of the upcoming appointments of a patient on this number, after the person confirmed.",
    input_schema: obj({ appointment_id: { type: "string" } }),
  },
  {
    name: "reschedule_appointment",
    description:
      "Move an upcoming appointment of a patient on this number to a new free slot of the same service. If the new time is taken, the original appointment is kept.",
    input_schema: obj({
      appointment_id: { type: "string" },
      new_start: localDateTime,
      practitioner_id: practitionerId("Another doctor's id if the client wants to change doctor, or null to keep the same one"),
    }),
  },
  {
    name: "send_location",
    description:
      "Send the clinic's location as a WhatsApp map pin, right after your reply. Use when the patient asks where the clinic is or how to get there. After a booking it is sent automatically.",
    input_schema: obj({}),
  },
  {
    name: "verify_identity",
    description:
      "Check that the person writing owns this WhatsApp number, by the date of birth or DUI of someone registered on it. Only needed when the context says the number is not verified.",
    input_schema: obj({
      date_of_birth: { type: ["string", "null"], description: "YYYY-MM-DD, or null" },
      dui: { type: ["string", "null"], description: "The DUI or its [DUI n] token, or null" },
    }),
  },
  {
    name: "handoff_to_business",
    description:
      "Pass the conversation to the business's staff and stop answering automatically. Use when the client needs a human.",
    input_schema: obj({ reason: { type: "string" } }),
  },
];

// The same tools in the Chat Completions format.
export const CHAT_TOOLS: ChatTool[] = TOOLS.map((t) => ({
  type: "function",
  function: { name: t.name, description: t.description, parameters: t.input_schema },
}));

// client is the number's holder, who is writing; household is everyone on
// the number, holder first.
// sendLocation is set by a tool when the clinic's pin should follow the reply.
// verified: the number's owner proved it's theirs (see clients.waVerifiedAt);
// until then only tools that reveal and change nothing of the record run.
// duis turns the DUI tokens the model sees back into DUIs.
export type ToolContext = {
  business: Business;
  client: Client;
  household: Client[];
  fields: IntakeField[];
  now: Date;
  verified: boolean;
  duis: DuiVault;
  sendLocation?: boolean;
};
export type ToolOutcome = { result: unknown; isError?: boolean; handoff?: boolean };

const nameInput = z.string().max(200).transform((s) => oneLine(s, NAME_MAX));
const inputs = {
  save_client_info: z.object({
    patient_id: z.string().nullish(),
    name: nameInput.nullable(),
    dui: z.string().max(20).nullish(),
    answers: z.array(z.object({ key: z.string().max(100), value: z.string().max(1000).transform((s) => oneLine(s, ANSWER_MAX)) })).max(30),
  }),
  add_patient: z.object({ name: nameInput }),
  list_services: z.object({}),
  list_practitioners: z.object({}),
  find_available_slots: z.object({
    service_id: z.string(),
    date_from: z.string().nullish(),
    date_to: z.string().nullish(),
    practitioner_id: z.string().nullish(),
  }),
  book_appointment: z.object({
    patient_id: z.string().nullish(),
    service_id: z.string(),
    start: z.string(),
    practitioner_id: z.string().nullish(),
  }),
  list_my_appointments: z.object({}),
  cancel_appointment: z.object({ appointment_id: z.string() }),
  reschedule_appointment: z.object({
    appointment_id: z.string(),
    new_start: z.string(),
    practitioner_id: z.string().nullish(),
  }),
  send_location: z.object({}),
  verify_identity: z.object({ date_of_birth: z.string().max(20).nullish(), dui: z.string().max(20).nullish() }),
  handoff_to_business: z.object({ reason: z.string().max(2000).transform((s) => oneLine(s, REASON_MAX)) }),
};

// Before the number is verified: nothing that shows or changes the record.
const OPEN_TOOLS = new Set(["list_services", "list_practitioners", "find_available_slots", "send_location", "verify_identity", "handoff_to_business"]);
const VERIFY_FIRST = "This number is not verified. Ask for the date of birth or DUI of the person writing (or of the patient they write for) and call verify_identity first.";
// Three wrong answers and the team takes over.
const MAX_VERIFY_FAILURES = 3;
// More patients than any family needs on one number is someone filling the clinic's list.
const MAX_HOUSEHOLD = 10;

export const hasLocation = (b: Business) => b.locationLat !== null && b.locationLng !== null;

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
// The first two times on each of the first three days that have any, so the
// patient gets real choices instead of four back-to-back slots.
export function spread<T>(slots: T[], dayOf: (slot: T) => string, perDay = 2, maxDays = 3) {
  const picked: T[] = [];
  const days = new Map<string, number>();
  for (const slot of slots) {
    const day = dayOf(slot);
    const count = days.get(day) ?? 0;
    if (count === 0 && days.size === maxDays) break;
    if (count < perDay) picked.push(slot);
    days.set(day, count + 1);
  }
  return picked;
}

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && isoDate(s) !== null;

const bookingErrors = {
  unknown_service: "That service does not exist. Call list_services.",
  unknown_practitioner: "That doctor does not exist or does not offer this service. Call list_practitioners.",
  invalid_time: "Time must be local YYYY-MM-DDTHH:mm.",
  slot_unavailable: "That time is not available (taken or outside opening hours). Call find_available_slots again.",
  not_found: "That appointment is not an upcoming appointment of a patient on this number.",
} as const;

const UNKNOWN_PATIENT = "That patient_id is not on this number. Use one from 'Patients on this WhatsApp number', or add_patient.";

function patientIn(ctx: ToolContext, id: string | null | undefined) {
  if (!id) return ctx.household[0] ?? ctx.client;
  return ctx.household.find((p) => p.id === id) ?? null;
}

function remember(ctx: ToolContext, patient: Client) {
  ctx.household = ctx.household.map((p) => (p.id === patient.id ? patient : p));
  if (patient.id === ctx.client.id) ctx.client = patient;
}

export async function runTool(name: string, rawInput: unknown, ctx: ToolContext): Promise<ToolOutcome> {
  if (!(name in inputs)) return { result: `Unknown tool ${name}`, isError: true };
  const parsed = inputs[name as keyof typeof inputs].safeParse(rawInput);
  if (!parsed.success) return { result: `Invalid input: ${parsed.error.message}`, isError: true };
  if (!ctx.verified && !OPEN_TOOLS.has(name)) return { result: VERIFY_FIRST, isError: true };
  const { business, now } = ctx;
  const tz = business.timezone;

  switch (name) {
    case "save_client_info": {
      const input = inputs.save_client_info.parse(rawInput);
      const patient = patientIn(ctx, input.patient_id);
      if (!patient) return { result: UNKNOWN_PATIENT, isError: true };
      const data = { ...patient.data };
      const rejected: string[] = [];
      for (const { key, value } of input.answers) {
        const field = ctx.fields.find((f) => f.key === key);
        if (!field) rejected.push(`${key}: unknown question`);
        else if (field.type === "date") {
          const date = isoDate(value.trim());
          if (!date) rejected.push(`${key}: ask the patient for a valid DD-MM-YYYY date; store as YYYY-MM-DD`);
          else data[key] = date;
        }
        else if (field.type === "choice" && field.options?.length && !field.options.includes(value))
          rejected.push(`${key}: must be one of ${field.options.join(", ")}`);
        else data[key] = ctx.duis.resolve(value).trim();
      }
      let dui: string | null = null;
      try {
        dui = normalizeDui(input.dui ? ctx.duis.resolve(input.dui) : null);
      } catch {
        rejected.push(
          ctx.duis.size
            ? 'dui: pass the token the DUI appears as in the conversation, exactly like "[DUI 1]"; do not ask the patient again'
            : "dui: a DUI has 9 digits, like 01234567-8; ask the patient to check it",
        );
      }
      // Once staff confirmed the name and DUI, a different one is kept for
      // their review instead of overwriting the record.
      const newName = input.name || null;
      const locked = patient.identityReviewedAt !== null;
      const nameChanges = newName && newName.toLowerCase() !== patient.name?.trim().toLowerCase();
      const duiChanges = dui && dui !== patient.dui;
      const setName = nameChanges && (!locked || !patient.name);
      const setDui = duiChanges && (!locked || !patient.dui);
      const forReview: string[] = [];
      if (nameChanges && !setName) {
        data[RECEIVED_NAME_KEY] = newName;
        forReview.push("name");
      }
      if (duiChanges && !setDui) {
        data[RECEIVED_DUI_KEY] = dui;
        forReview.push("dui");
      }
      // The default birth-date question also fills the record header, unless
      // the clinic already typed one in.
      const birth = typeof data.fecha_nacimiento === "string" && isDate(data.fecha_nacimiento) ? data.fecha_nacimiento : null;
      const [client] = await db
        .update(schema.clients)
        .set({
          data,
          ...(setName ? { name: newName } : {}),
          ...(setDui ? { dui } : {}),
          ...(birth && !patient.dateOfBirth ? { dateOfBirth: birth } : {}),
        })
        .where(eq(schema.clients.id, patient.id))
        .returning();
      remember(ctx, client);
      return {
        result: {
          saved: true,
          patient_id: client.id,
          rejected,
          ...(forReview.length ? { sent_to_team_for_review: forReview, note: "The record already had a different value; the team will review it. Tell the patient the team will check the change." } : {}),
          still_missing: missingIntake(client, ctx.fields),
        },
        isError: rejected.length > 0,
      };
    }

    case "add_patient": {
      const input = inputs.add_patient.parse(rawInput);
      const name = input.name;
      if (!name) return { result: "Give the patient's full name.", isError: true };
      const holder = ctx.client;
      const existing = ctx.household.find((p) => p.name?.trim().toLowerCase() === name.toLowerCase());
      if (existing) return { result: { patient_id: existing.id, already_registered: true } };
      if (ctx.household.length >= MAX_HOUSEHOLD) return { result: "This number already has the most patients allowed. Hand off to the team.", isError: true };
      const patient = await addToNumber(business.id, holder, { name });
      ctx.household = [...ctx.household, patient];
      return { result: { patient_id: patient.id, still_missing: missingIntake(patient, ctx.fields) } };
    }

    case "list_services": {
      const services = await listActiveServices(business.id);
      return {
        result: services.map((s) => ({ id: s.id, name: s.name, duration_minutes: s.durationMin })),
      };
    }

    case "list_practitioners": {
      const [practitioners, offered] = await Promise.all([
        listPractitioners(business.id, { activeOnly: true }),
        db
          .select()
          .from(schema.practitionerServices)
          .where(eq(schema.practitionerServices.businessId, business.id)),
      ]);
      return {
        result: practitioners.map((p) => ({
          id: p.id,
          name: p.displayName,
          specialty: p.specialty,
          service_ids: offered.filter((o) => o.practitionerId === p.id).map((o) => o.serviceId),
        })),
      };
    }

    case "find_available_slots": {
      const input = inputs.find_available_slots.parse(rawInput);
      if (!isUuid(input.service_id)) return { result: bookingErrors.unknown_service, isError: true };
      if (input.practitioner_id && !isUuid(input.practitioner_id))
        return { result: bookingErrors.unknown_practitioner, isError: true };
      const dateFrom = input.date_from || formatInTimeZone(now, tz, "yyyy-MM-dd");
      const dateTo = input.date_to || (isDate(dateFrom) ? addDays(new Date(`${dateFrom}T12:00:00Z`), 7).toISOString().slice(0, 10) : "");
      if (!isDate(dateFrom) || !isDate(dateTo)) return { result: "Dates must be YYYY-MM-DD.", isError: true };
      const days = (Date.parse(dateTo) - Date.parse(dateFrom)) / 86_400_000;
      if (days < 0 || days > 14) return { result: "Use a range of 0 to 14 days.", isError: true };
      const slots = await availableSlots(business, {
        serviceId: input.service_id,
        fromDate: dateFrom,
        toDate: dateTo,
        practitionerId: input.practitioner_id,
        now,
      });
      if (!slots) return { result: bookingErrors.unknown_service, isError: true };
      const describe = (s: (typeof slots)[number]) => ({
        ...describeSlot(s.startsAt, tz),
        practitioner_id: s.practitionerId,
        practitioner: s.practitionerName,
      });
      return {
        result: {
          suggested: spread(slots, (s) => formatInTimeZone(s.startsAt, tz, "yyyy-MM-dd")).map(describe),
          slots: slots.slice(0, 40).map(describe),
          total: slots.length,
        },
      };
    }

    case "book_appointment": {
      const input = inputs.book_appointment.parse(rawInput);
      const patient = patientIn(ctx, input.patient_id);
      if (!patient) return { result: UNKNOWN_PATIENT, isError: true };
      const fresh = (await reloadClient(business.id, patient.id)) ?? patient;
      const missing = missingIntake(fresh, ctx.fields);
      if (missing.length)
        return { result: `Collect these first: ${missing.join(", ")}`, isError: true };
      if (!isUuid(input.service_id)) return { result: bookingErrors.unknown_service, isError: true };
      if (input.practitioner_id && !isUuid(input.practitioner_id))
        return { result: bookingErrors.unknown_practitioner, isError: true };
      const booked = await bookAppointment({
        business,
        clientId: fresh.id,
        serviceId: input.service_id,
        localStart: input.start,
        practitionerId: input.practitioner_id,
        bookedBy: "assistant",
        now,
      });
      if (!booked.ok) return { result: bookingErrors[booked.reason], isError: true };
      if (hasLocation(business)) ctx.sendLocation = true;
      return {
        result: {
          booked: true,
          appointment_id: booked.appointment.id,
          patient: fresh.name,
          ...describeSlot(booked.appointment.startsAt, tz),
        },
      };
    }

    case "list_my_appointments": {
      const rows = await upcomingAppointments(business.id, ctx.household.map((p) => p.id), now);
      return {
        result: rows.map((r) => ({
          appointment_id: r.appointment.id,
          patient_id: r.appointment.clientId,
          patient: ctx.household.find((p) => p.id === r.appointment.clientId)?.name ?? null,
          service: r.serviceName,
          practitioner: r.practitionerName,
          status: r.appointment.status,
          ...describeSlot(r.appointment.startsAt, tz),
        })),
      };
    }

    case "cancel_appointment": {
      const input = inputs.cancel_appointment.parse(rawInput);
      if (!isUuid(input.appointment_id)) return { result: bookingErrors.not_found, isError: true };
      const cancelled = await cancelByClient(business.id, ctx.household.map((p) => p.id), input.appointment_id);
      if (!cancelled) return { result: bookingErrors.not_found, isError: true };
      return { result: { cancelled: true } };
    }

    case "reschedule_appointment": {
      const input = inputs.reschedule_appointment.parse(rawInput);
      if (!isUuid(input.appointment_id)) return { result: bookingErrors.not_found, isError: true };
      if (input.practitioner_id && !isUuid(input.practitioner_id))
        return { result: bookingErrors.unknown_practitioner, isError: true };
      const moved = await rescheduleByClient({
        business,
        clientIds: ctx.household.map((p) => p.id),
        appointmentId: input.appointment_id,
        localStart: input.new_start,
        practitionerId: input.practitioner_id,
        now,
      });
      if (!moved.ok) return { result: bookingErrors[moved.reason], isError: true };
      return {
        result: { rescheduled: true, appointment_id: moved.appointment.id, ...describeSlot(moved.appointment.startsAt, tz) },
      };
    }

    case "send_location": {
      if (!hasLocation(business)) {
        return { result: "The clinic has not set its location. Give the address from Clinic information if it has one, otherwise hand off.", isError: true };
      }
      ctx.sendLocation = true;
      return { result: { will_send_after_reply: true } };
    }

    case "verify_identity": {
      const input = inputs.verify_identity.parse(rawInput);
      if (ctx.verified) return { result: { verified: true } };
      if (ctx.client.waVerifyFailures >= MAX_VERIFY_FAILURES) return { result: "Too many failed attempts. Call handoff_to_business.", isError: true };
      const birth = input.date_of_birth ? isoDate(input.date_of_birth.trim()) : null;
      let dui: string | null = null;
      try {
        dui = input.dui ? normalizeDui(ctx.duis.resolve(input.dui)) : null;
      } catch {
        return { result: "That is not a valid DUI (9 digits). Ask again.", isError: true };
      }
      if (!birth && !dui) return { result: "Give a date of birth as YYYY-MM-DD or a DUI.", isError: true };
      const onFile = ctx.household.filter((p) => p.dateOfBirth || p.data.fecha_nacimiento || p.dui);
      if (!onFile.length) {
        return { result: "The record has no birth date or DUI to compare with. Call handoff_to_business so the team can confirm the number.", isError: true };
      }
      const match = onFile.some(
        (p) => (birth && (p.dateOfBirth === birth || p.data.fecha_nacimiento === birth)) || (dui && p.dui === dui),
      );
      if (!match) {
        const [after] = await db
          .update(schema.clients)
          .set({ waVerifyFailures: sql`${schema.clients.waVerifyFailures} + 1` })
          .where(eq(schema.clients.id, ctx.client.id))
          .returning();
        ctx.client = after;
        if (after.waVerifyFailures >= MAX_VERIFY_FAILURES) {
          await openAttention(business.id, ctx.client.id, "No se pudo verificar el número de WhatsApp", false, now);
          return { result: "It does not match, and there are no attempts left. Tell the patient the team will contact them.", isError: true, handoff: true };
        }
        return { result: "It does not match the record. Ask them to check it; do not say what is on the record.", isError: true };
      }
      const [verified] = await db
        .update(schema.clients)
        .set({ waVerifiedAt: now, waVerifyFailures: 0 })
        .where(eq(schema.clients.id, ctx.client.id))
        .returning();
      ctx.client = verified;
      ctx.household = ctx.household.map((p) => (p.id === verified.id ? verified : p));
      ctx.verified = true;
      const upcoming = await upcomingAppointments(business.id, ctx.household.map((p) => p.id), now);
      return {
        result: {
          verified: true,
          context: householdSection({
            business,
            patients: ctx.household.map((p) => ({ patient: p, missing: missingIntake(p, ctx.fields) })),
            upcoming: upcoming.map((u) => ({
              id: u.appointment.id,
              patientName: ctx.household.find((p) => p.id === u.appointment.clientId)?.name ?? null,
              serviceName: u.serviceName,
              practitionerName: u.practitionerName,
              startsAt: u.appointment.startsAt,
              status: u.appointment.status,
            })),
          }),
        },
      };
    }

    case "handoff_to_business": {
      const input = inputs.handoff_to_business.parse(rawInput);
      await openAttention(ctx.business.id, ctx.client.id, input.reason || "El asistente necesita ayuda del equipo", false, ctx.now);
      return { result: { handed_off: true }, handoff: true };
    }
  }
  return { result: `Unhandled tool ${name}`, isError: true };
}
