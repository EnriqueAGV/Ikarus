import { and, desc, eq, inArray, notInArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { PrescriptionItem } from "@/db/schema";
import { can } from "@/lib/permissions";
import type { Actor } from "./patients";

// Recetas: a doctor lists the drugs, and the patient gets a printed copy with
// the doctor's header. An issued prescription never changes (the database
// rejects it); a correction is a new one.

export class PrescriptionError extends Error {
  constructor(readonly code: "forbidden" | "not_found" | "empty_prescription" | "too_long" | "unknown_appointment") {
    super(code);
  }
}

export const MAX_ITEMS = 12;
const CANCELLED = ["cancelled_by_client", "cancelled_by_business", "auto_cancelled"] as const;

const blank = (s: string | null | undefined) => (s?.trim() ? s.trim() : null);

function cleanItems(items: Partial<PrescriptionItem>[]): PrescriptionItem[] {
  const clean = items
    .map((i) => ({ drug: blank(i.drug), dose: blank(i.dose), frequency: blank(i.frequency), duration: blank(i.duration) }))
    .filter((i): i is PrescriptionItem => i.drug !== null);
  if (clean.length === 0) throw new PrescriptionError("empty_prescription");
  if (clean.length > MAX_ITEMS) throw new PrescriptionError("too_long");
  for (const i of clean) {
    if ([i.drug, i.dose, i.frequency, i.duration].some((v) => (v?.length ?? 0) > 200)) throw new PrescriptionError("too_long");
  }
  return clean;
}

export async function issuePrescription(
  actor: Actor,
  clientId: string,
  input: { appointmentId: string | null; items: Partial<PrescriptionItem>[]; instructions: string | null },
) {
  if (!can(actor, "notes.write") || !actor.practitionerId) throw new PrescriptionError("forbidden");
  const items = cleanItems(input.items);
  const instructions = blank(input.instructions);
  if ((instructions?.length ?? 0) > 2000) throw new PrescriptionError("too_long");
  const [client] = await db
    .select({ id: schema.clients.id, mergedIntoId: schema.clients.mergedIntoId })
    .from(schema.clients)
    .where(and(eq(schema.clients.id, clientId), eq(schema.clients.businessId, actor.business.id)));
  if (!client || client.mergedIntoId) throw new PrescriptionError("not_found");
  if (input.appointmentId) {
    const [appointment] = /^[0-9a-f-]{36}$/i.test(input.appointmentId)
      ? await db
          .select({ id: schema.appointments.id })
          .from(schema.appointments)
          .where(
            and(
              eq(schema.appointments.id, input.appointmentId),
              eq(schema.appointments.clientId, clientId),
              notInArray(schema.appointments.status, [...CANCELLED]),
            ),
          )
      : [];
    if (!appointment) throw new PrescriptionError("unknown_appointment");
  }
  return db.transaction(async (tx) => {
    const [prescription] = await tx
      .insert(schema.prescriptions)
      .values({
        businessId: actor.business.id,
        clientId,
        practitionerId: actor.practitionerId!,
        appointmentId: input.appointmentId,
        items,
        instructions,
        createdBy: actor.profile.id,
      })
      .returning();
    await tx.insert(schema.accessLog).values({
      businessId: actor.business.id,
      clientId,
      userId: actor.profile.id,
      practitionerId: actor.practitionerId,
      action: "create_prescription",
    });
    return prescription;
  });
}

// The patient's prescriptions (and those of duplicates merged into them), newest first.
export async function listPrescriptions(actor: Actor, clientIds: string[]) {
  if (!can(actor, "chart.clinical")) throw new PrescriptionError("forbidden");
  return db
    .select({ prescription: schema.prescriptions, practitionerName: schema.practitioners.displayName })
    .from(schema.prescriptions)
    .innerJoin(schema.practitioners, eq(schema.practitioners.id, schema.prescriptions.practitionerId))
    .where(and(eq(schema.prescriptions.businessId, actor.business.id), inArray(schema.prescriptions.clientId, clientIds)))
    .orderBy(desc(schema.prescriptions.createdAt));
}

export async function getPrescription(actor: Actor, prescriptionId: string) {
  if (!can(actor, "chart.clinical")) throw new PrescriptionError("forbidden");
  if (!/^[0-9a-f-]{36}$/i.test(prescriptionId)) return null;
  const [row] = await db
    .select({ prescription: schema.prescriptions, practitioner: schema.practitioners, client: schema.clients })
    .from(schema.prescriptions)
    .innerJoin(schema.practitioners, eq(schema.practitioners.id, schema.prescriptions.practitionerId))
    .innerJoin(schema.clients, eq(schema.clients.id, schema.prescriptions.clientId))
    .where(and(eq(schema.prescriptions.id, prescriptionId), eq(schema.prescriptions.businessId, actor.business.id)));
  return row ?? null;
}

export async function logPrescriptionPrint(actor: Actor, clientId: string) {
  if (!can(actor, "chart.clinical")) throw new PrescriptionError("forbidden");
  await db.insert(schema.accessLog).values({
    businessId: actor.business.id,
    clientId,
    userId: actor.profile.id,
    practitionerId: actor.practitionerId,
    action: "print_prescription",
  });
}
