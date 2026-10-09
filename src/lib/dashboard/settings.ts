import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { createPractitioner, getPractitioner, offerServiceByAll } from "@/lib/booking/practitioners";

// Business-facing configuration: doctors and their hours and days off,
// services, intake questions and reminder timing. Every function takes the
// business id so a caller can only touch its own rows.

export type Range = { startTime: string; endTime: string };
export type WeeklyRule = Range & { weekday: number };

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export class SettingsError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

// Ranges on one day must be well formed and must not overlap.
export function validateRanges(ranges: Range[]) {
  for (const r of ranges) {
    if (!TIME.test(r.startTime) || !TIME.test(r.endTime)) throw new SettingsError("invalid_time");
    if (r.startTime >= r.endTime) throw new SettingsError("end_before_start");
  }
  const sorted = [...ranges].sort((a, b) => a.startTime.localeCompare(b.startTime));
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].startTime < sorted[i - 1].endTime) throw new SettingsError("overlap");
  }
}

// Hours and days off belong to one doctor of this business.
async function requirePractitioner(businessId: string, practitionerId: string) {
  const practitioner = await getPractitioner(businessId, practitionerId);
  if (!practitioner) throw new SettingsError("unknown_practitioner");
  return practitioner;
}

export async function getWeeklyRules(businessId: string, practitionerId: string) {
  return db
    .select()
    .from(schema.availabilityRules)
    .where(
      and(
        eq(schema.availabilityRules.businessId, businessId),
        eq(schema.availabilityRules.practitionerId, practitionerId),
      ),
    )
    .orderBy(asc(schema.availabilityRules.weekday), asc(schema.availabilityRules.startTime));
}

// Replaces the doctor's whole week at once, so the form is the source of truth.
export async function saveWeeklyRules(businessId: string, practitionerId: string, rules: WeeklyRule[]) {
  for (let weekday = 0; weekday < 7; weekday++) {
    validateRanges(rules.filter((r) => r.weekday === weekday));
  }
  if (rules.some((r) => !Number.isInteger(r.weekday) || r.weekday < 0 || r.weekday > 6)) {
    throw new SettingsError("invalid_weekday");
  }
  await requirePractitioner(businessId, practitionerId);
  await db.transaction(async (tx) => {
    await tx
      .delete(schema.availabilityRules)
      .where(
        and(
          eq(schema.availabilityRules.businessId, businessId),
          eq(schema.availabilityRules.practitionerId, practitionerId),
        ),
      );
    if (rules.length) {
      await tx.insert(schema.availabilityRules).values(rules.map((r) => ({ ...r, businessId, practitionerId })));
    }
  });
}

export async function getExceptions(businessId: string, practitionerId: string, fromDate: string) {
  const rows = await db
    .select()
    .from(schema.availabilityExceptions)
    .where(
      and(
        eq(schema.availabilityExceptions.businessId, businessId),
        eq(schema.availabilityExceptions.practitionerId, practitionerId),
      ),
    )
    .orderBy(asc(schema.availabilityExceptions.date), asc(schema.availabilityExceptions.startTime));
  return rows.filter((r) => r.date >= fromDate);
}

// A date is either a day off (no range) or open with custom hours, replacing
// the doctor's weekly hours for that day.
export async function addException(
  businessId: string,
  practitionerId: string,
  input: { date: string; range: Range | null; note?: string },
) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || Number.isNaN(Date.parse(input.date))) {
    throw new SettingsError("invalid_date");
  }
  await requirePractitioner(businessId, practitionerId);
  await db.transaction(async (tx) => {
    const sameDay = await tx
      .select()
      .from(schema.availabilityExceptions)
      .where(
        and(
          eq(schema.availabilityExceptions.businessId, businessId),
          eq(schema.availabilityExceptions.practitionerId, practitionerId),
          eq(schema.availabilityExceptions.date, input.date),
        ),
      );
    if (input.range) {
      const open = sameDay.flatMap((e) =>
        e.startTime && e.endTime ? [{ startTime: e.startTime.slice(0, 5), endTime: e.endTime.slice(0, 5) }] : [],
      );
      validateRanges([...open, input.range]);
    }
    // A closure replaces any custom hours that day, and custom hours replace a closure.
    const replaced = sameDay.filter((e) => !input.range || !e.startTime);
    for (const e of replaced) {
      await tx.delete(schema.availabilityExceptions).where(eq(schema.availabilityExceptions.id, e.id));
    }
    await tx.insert(schema.availabilityExceptions).values({
      businessId,
      practitionerId,
      date: input.date,
      startTime: input.range?.startTime ?? null,
      endTime: input.range?.endTime ?? null,
      note: input.note?.trim() || null,
    });
  });
}

export async function removeException(businessId: string, exceptionId: string) {
  await db
    .delete(schema.availabilityExceptions)
    .where(
      and(
        eq(schema.availabilityExceptions.id, exceptionId),
        eq(schema.availabilityExceptions.businessId, businessId),
      ),
    );
}

export type ServiceInput = { name: string; durationMin: number; bufferMin: number; active: boolean };

function validateService(s: ServiceInput) {
  if (!s.name.trim()) throw new SettingsError("name_required");
  if (!Number.isInteger(s.durationMin) || s.durationMin < 5 || s.durationMin > 720) {
    throw new SettingsError("invalid_duration");
  }
  if (!Number.isInteger(s.bufferMin) || s.bufferMin < 0 || s.bufferMin > 240) {
    throw new SettingsError("invalid_buffer");
  }
}

export async function listServices(businessId: string) {
  return db
    .select()
    .from(schema.services)
    .where(eq(schema.services.businessId, businessId))
    .orderBy(asc(schema.services.name));
}

// Every active doctor offers a new service.
export async function createService(businessId: string, input: ServiceInput) {
  validateService(input);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.services)
      .values({ ...input, name: input.name.trim(), businessId })
      .returning();
    await offerServiceByAll(businessId, row.id, tx);
    return row;
  });
}

export type PractitionerInput = { displayName: string; specialty: string; jvpmNumber: string };

function validatePractitioner(p: PractitionerInput) {
  if (!p.displayName.trim()) throw new SettingsError("doctor_name_required");
}

// A new doctor offers every active service and starts with no hours.
export async function addPractitioner(businessId: string, input: PractitionerInput) {
  validatePractitioner(input);
  return db.transaction((tx) => createPractitioner(businessId, input, tx));
}

// Doctors are never deleted, since appointments reference them; an inactive
// doctor gets no new bookings.
export async function updatePractitioner(
  businessId: string,
  practitionerId: string,
  input: PractitionerInput & { active: boolean },
) {
  validatePractitioner(input);
  await db
    .update(schema.practitioners)
    .set({
      displayName: input.displayName.trim(),
      specialty: input.specialty.trim() || null,
      jvpmNumber: input.jvpmNumber.trim() || null,
      active: input.active,
    })
    .where(and(eq(schema.practitioners.id, practitionerId), eq(schema.practitioners.businessId, businessId)));
}

// Services are never deleted, since past appointments reference them;
// deactivating hides them from the agent. Changing the duration only affects
// new bookings.
export async function updateService(businessId: string, serviceId: string, input: ServiceInput) {
  validateService(input);
  await db
    .update(schema.services)
    .set({ ...input, name: input.name.trim() })
    .where(and(eq(schema.services.id, serviceId), eq(schema.services.businessId, businessId)));
}

export type IntakeInput = {
  label: string;
  type: "text" | "date" | "choice";
  options: string[];
  required: boolean;
};

function validateIntake(f: IntakeInput) {
  if (!f.label.trim()) throw new SettingsError("label_required");
  if (f.type === "choice" && f.options.length < 2) throw new SettingsError("choice_needs_options");
}

// Stable machine key from the label: "Fecha de nacimiento" -> "fecha_de_nacimiento".
export function intakeKey(label: string) {
  const key = label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return key && key !== "name" ? key : `campo_${key || "dato"}`;
}

export async function listIntakeFields(businessId: string) {
  return db
    .select()
    .from(schema.intakeFields)
    .where(eq(schema.intakeFields.businessId, businessId))
    .orderBy(asc(schema.intakeFields.position), asc(schema.intakeFields.label));
}

export async function createIntakeField(businessId: string, input: IntakeInput) {
  validateIntake(input);
  const existing = await listIntakeFields(businessId);
  const base = intakeKey(input.label);
  let key = base;
  for (let n = 2; existing.some((f) => f.key === key); n++) key = `${base}_${n}`;
  const [row] = await db
    .insert(schema.intakeFields)
    .values({
      businessId,
      key,
      label: input.label.trim(),
      type: input.type,
      options: input.type === "choice" ? input.options : null,
      required: input.required,
      position: (existing.at(-1)?.position ?? -1) + 1,
    })
    .returning();
  return row;
}

// The key stays fixed so answers clients already gave keep matching.
export async function updateIntakeField(businessId: string, fieldId: string, input: IntakeInput) {
  validateIntake(input);
  await db
    .update(schema.intakeFields)
    .set({
      label: input.label.trim(),
      type: input.type,
      options: input.type === "choice" ? input.options : null,
      required: input.required,
    })
    .where(and(eq(schema.intakeFields.id, fieldId), eq(schema.intakeFields.businessId, businessId)));
}

export async function deleteIntakeField(businessId: string, fieldId: string) {
  await db
    .delete(schema.intakeFields)
    .where(and(eq(schema.intakeFields.id, fieldId), eq(schema.intakeFields.businessId, businessId)));
}

export async function moveIntakeField(businessId: string, fieldId: string, direction: "up" | "down") {
  const fields = await listIntakeFields(businessId);
  const i = fields.findIndex((f) => f.id === fieldId);
  const j = direction === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= fields.length) return;
  [fields[i], fields[j]] = [fields[j], fields[i]];
  await db.transaction(async (tx) => {
    for (const [position, f] of fields.entries()) {
      await tx.update(schema.intakeFields).set({ position }).where(eq(schema.intakeFields.id, f.id));
    }
  });
}

export async function updateBusinessSettings(
  businessId: string,
  input: { reminderLeadHours: number; agentInstructions: string },
) {
  if (!Number.isInteger(input.reminderLeadHours) || input.reminderLeadHours < 1 || input.reminderLeadHours > 168) {
    throw new SettingsError("invalid_reminder_hours");
  }
  if (input.agentInstructions.length > 4000) throw new SettingsError("instructions_too_long");
  await db
    .update(schema.businesses)
    .set({
      reminderLeadHours: input.reminderLeadHours,
      agentInstructions: input.agentInstructions.trim() || null,
    })
    .where(eq(schema.businesses.id, businessId));
}
