import type { ChatTool } from "./llm";
import { eq } from "drizzle-orm";
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
import { addToNumber } from "@/lib/household";
import { type Business, type Client, type IntakeField, missingIntake, reloadClient } from "./context";

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
      "Save a patient's name and/or answers to the clinic's intake questions. Call it as soon as they are given.",
    input_schema: obj({
      patient_id: patientId,
      name: { type: ["string", "null"], description: "Patient's full name, or null if not given now" },
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
      "Find free start times for a service between two local dates (inclusive, at most 14 days apart). Each slot says which doctor it is with.",
    input_schema: obj({
      service_id: { type: "string" },
      date_from: { type: "string", description: "YYYY-MM-DD" },
      date_to: { type: "string", description: "YYYY-MM-DD" },
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
export type ToolContext = { business: Business; client: Client; household: Client[]; fields: IntakeField[]; now: Date };
export type ToolOutcome = { result: unknown; isError?: boolean; handoff?: boolean };

const inputs = {
  save_client_info: z.object({
    patient_id: z.string().nullish(),
    name: z.string().nullable(),
    answers: z.array(z.object({ key: z.string(), value: z.string() })),
  }),
  add_patient: z.object({ name: z.string() }),
  list_services: z.object({}),
  list_practitioners: z.object({}),
  find_available_slots: z.object({
    service_id: z.string(),
    date_from: z.string(),
    date_to: z.string(),
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
  handoff_to_business: z.object({ reason: z.string() }),
};

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

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
        else if (field.type === "date" && !isDate(value)) rejected.push(`${key}: use YYYY-MM-DD`);
        else if (field.type === "choice" && field.options?.length && !field.options.includes(value))
          rejected.push(`${key}: must be one of ${field.options.join(", ")}`);
        else data[key] = value.trim();
      }
      // The default birth-date question also fills the record header, unless
      // the clinic already typed one in.
      const birth = typeof data.fecha_nacimiento === "string" && isDate(data.fecha_nacimiento) ? data.fecha_nacimiento : null;
      const [client] = await db
        .update(schema.clients)
        .set({
          data,
          ...(input.name?.trim() ? { name: input.name.trim() } : {}),
          ...(birth && !patient.dateOfBirth ? { dateOfBirth: birth } : {}),
        })
        .where(eq(schema.clients.id, patient.id))
        .returning();
      remember(ctx, client);
      return {
        result: { saved: true, patient_id: client.id, rejected, still_missing: missingIntake(client, ctx.fields) },
        isError: rejected.length > 0,
      };
    }

    case "add_patient": {
      const input = inputs.add_patient.parse(rawInput);
      const name = input.name.trim();
      if (!name) return { result: "Give the patient's full name.", isError: true };
      const holder = ctx.client;
      const existing = ctx.household.find((p) => p.name?.trim().toLowerCase() === name.toLowerCase());
      if (existing) return { result: { patient_id: existing.id, already_registered: true } };
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
      if (!isDate(input.date_from) || !isDate(input.date_to))
        return { result: "Dates must be YYYY-MM-DD.", isError: true };
      const days = (Date.parse(input.date_to) - Date.parse(input.date_from)) / 86_400_000;
      if (days < 0 || days > 14) return { result: "Use a range of 0 to 14 days.", isError: true };
      const slots = await availableSlots(business, {
        serviceId: input.service_id,
        fromDate: input.date_from,
        toDate: input.date_to,
        practitionerId: input.practitioner_id,
        now,
      });
      if (!slots) return { result: bookingErrors.unknown_service, isError: true };
      return {
        result: {
          slots: slots.slice(0, 40).map((s) => ({
            ...describeSlot(s.startsAt, tz),
            practitioner_id: s.practitionerId,
            practitioner: s.practitionerName,
          })),
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
        now,
      });
      if (!booked.ok) return { result: bookingErrors[booked.reason], isError: true };
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

    case "handoff_to_business": {
      await db
        .update(schema.clients)
        .set({ agentPaused: true })
        .where(eq(schema.clients.id, ctx.client.id));
      return { result: { handed_off: true }, handoff: true };
    }
  }
  return { result: `Unhandled tool ${name}`, isError: true };
}
