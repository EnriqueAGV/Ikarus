import { and, desc, eq, gt, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { getPractitioner } from "@/lib/booking/practitioners";
import { holderOfNumber, normalizePhone } from "@/lib/household";
import { can, type Role } from "@/lib/permissions";

type AccessAction = (typeof schema.accessAction.enumValues)[number];
export type Actor = {
  role: Role;
  managesClinic: boolean;
  practitionerId: string | null;
  business: { id: string };
  profile: { id: string };
};

export class PatientError extends Error {
  constructor(
    readonly code:
      | "not_found"
      | "forbidden"
      | "invalid_dui"
      | "invalid_birth_date"
      | "unknown_practitioner"
      | "invalid_phone"
      | "name_required_patient",
  ) {
    super(code);
  }
}

export type DemographicsInput = {
  name: string | null;
  dateOfBirth: string | null;
  sex: "female" | "male" | null;
  dui: string | null;
  address: string | null;
  guardianName: string | null;
  guardianPhone: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  preferredPractitionerId: string | null;
};

export type ClinicalInput = { allergies: string | null; chronicConditions: string | null };

const blank = (s: string | null) => (s?.trim() ? s.trim() : null);

// A DUI is eight digits, a dash and a check digit; people often type it without the dash.
export function normalizeDui(raw: string | null) {
  const digits = blank(raw)?.replace(/[\s-]/g, "");
  if (!digits) return null;
  if (!/^\d{9}$/.test(digits)) throw new PatientError("invalid_dui");
  return `${digits.slice(0, 8)}-${digits.slice(8)}`;
}

function birthDate(raw: string | null, now: Date) {
  const value = blank(raw);
  if (!value) return null;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(parsed) || parsed > now.getTime() || value < "1900-01-01") {
    throw new PatientError("invalid_birth_date");
  }
  return value;
}

async function requirePatient(businessId: string, clientId: string) {
  const [client] = await db
    .select({ id: schema.clients.id })
    .from(schema.clients)
    .where(and(eq(schema.clients.id, clientId), eq(schema.clients.businessId, businessId)));
  if (!client) throw new PatientError("not_found");
}

export async function logAccess(actor: Actor, clientId: string, action: AccessAction) {
  await db.insert(schema.accessLog).values({
    businessId: actor.business.id,
    clientId,
    userId: actor.profile.id,
    practitionerId: actor.practitionerId,
    action,
  });
}

// Opening a record is logged, at most once per person every ten minutes so a
// reload doesn't flood the log.
export async function logChartView(actor: Actor, clientId: string) {
  const [recent] = await db
    .select({ id: schema.accessLog.id })
    .from(schema.accessLog)
    .where(
      and(
        eq(schema.accessLog.clientId, clientId),
        eq(schema.accessLog.userId, actor.profile.id),
        eq(schema.accessLog.action, "view_chart"),
        gt(schema.accessLog.createdAt, sql`now() - interval '10 minutes'`),
      ),
    )
    .limit(1);
  if (!recent) await logAccess(actor, clientId, "view_chart");
}

export async function updateDemographics(actor: Actor, clientId: string, input: DemographicsInput, now = new Date()) {
  if (!can(actor, "patients")) throw new PatientError("forbidden");
  await requirePatient(actor.business.id, clientId);
  if (input.preferredPractitionerId && !(await getPractitioner(actor.business.id, input.preferredPractitionerId))) {
    throw new PatientError("unknown_practitioner");
  }
  const values = {
    name: blank(input.name),
    dateOfBirth: birthDate(input.dateOfBirth, now),
    sex: input.sex,
    dui: normalizeDui(input.dui),
    address: blank(input.address),
    guardianName: blank(input.guardianName),
    guardianPhone: blank(input.guardianPhone),
    emergencyContactName: blank(input.emergencyContactName),
    emergencyContactPhone: blank(input.emergencyContactPhone),
    preferredPractitionerId: input.preferredPractitionerId,
  };
  await db.transaction(async (tx) => {
    await tx
      .update(schema.clients)
      .set(values)
      .where(and(eq(schema.clients.id, clientId), eq(schema.clients.businessId, actor.business.id)));
    await tx.insert(schema.accessLog).values({
      businessId: actor.business.id,
      clientId,
      userId: actor.profile.id,
      practitionerId: actor.practitionerId,
      action: "edit_chart",
    });
  });
}

export async function updateClinical(actor: Actor, clientId: string, input: ClinicalInput) {
  if (!can(actor, "chart.clinical")) throw new PatientError("forbidden");
  await requirePatient(actor.business.id, clientId);
  await db.transaction(async (tx) => {
    await tx
      .update(schema.clients)
      .set({ allergies: blank(input.allergies), chronicConditions: blank(input.chronicConditions) })
      .where(and(eq(schema.clients.id, clientId), eq(schema.clients.businessId, actor.business.id)));
    await tx.insert(schema.accessLog).values({
      businessId: actor.business.id,
      clientId,
      userId: actor.profile.id,
      practitionerId: actor.practitionerId,
      action: "edit_clinical",
    });
  });
}

export async function recentAccess(businessId: string, clientId: string, limit = 20) {
  return db
    .select({
      id: schema.accessLog.id,
      action: schema.accessLog.action,
      createdAt: schema.accessLog.createdAt,
      email: schema.profiles.email,
      fullName: schema.profiles.fullName,
      practitionerName: schema.practitioners.displayName,
    })
    .from(schema.accessLog)
    .innerJoin(schema.profiles, eq(schema.profiles.id, schema.accessLog.userId))
    .leftJoin(schema.practitioners, eq(schema.practitioners.id, schema.accessLog.practitionerId))
    .where(and(eq(schema.accessLog.businessId, businessId), eq(schema.accessLog.clientId, clientId)))
    .orderBy(desc(schema.accessLog.createdAt))
    .limit(limit);
}

// A patient the clinic registers itself, e.g. one who called or walked in.
// With a WhatsApp number already in use, they join that number (the agent
// then knows them when the holder writes); otherwise they become its holder.
export async function createPatient(
  actor: Actor,
  input: { name: string; phone: string | null; dateOfBirth: string | null; sex: "female" | "male" | null },
  now = new Date(),
) {
  if (!can(actor, "patients")) throw new PatientError("forbidden");
  const name = blank(input.name);
  if (!name) throw new PatientError("name_required_patient");
  const phone = normalizePhone(input.phone);
  if (phone === undefined) throw new PatientError("invalid_phone");
  const values = { name, dateOfBirth: birthDate(input.dateOfBirth, now), sex: input.sex };
  return db.transaction(async (tx) => {
    const holder = phone ? await holderOfNumber(actor.business.id, phone, tx) : null;
    const [patient] = await tx
      .insert(schema.clients)
      .values({ ...values, businessId: actor.business.id, waPhone: phone, holderId: holder?.id ?? null })
      .returning({ id: schema.clients.id });
    await tx.insert(schema.accessLog).values({
      businessId: actor.business.id,
      clientId: patient.id,
      userId: actor.profile.id,
      practitionerId: actor.practitionerId,
      action: "edit_chart",
    });
    return patient.id;
  });
}

