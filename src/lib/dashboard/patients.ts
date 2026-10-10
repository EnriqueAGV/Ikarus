import { and, desc, eq, gt, ilike, inArray, isNull, ne, notInArray, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { LIVE_APPOINTMENT_STATUSES } from "@/db/schema";
import { updateAppointmentByBusiness } from "@/lib/dashboard/appointments";
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
      | "name_required_patient"
      | "phone_in_use"
      | "has_dependents"
      | "same_patient"
      | "merged",
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


// "Deleting" a patient archives them: the record and its access log must be
// kept, so they are hidden from Pacientes, search and the assistant instead,
// and their upcoming appointments are cancelled. Restoring undoes it, and a
// number's holder who writes again comes back by themselves.
export async function archivePatient(actor: Actor, clientId: string, now = new Date()) {
  if (!can(actor, "patients")) throw new PatientError("forbidden");
  await requirePatient(actor.business.id, clientId);
  const upcoming = await db
    .select({ id: schema.appointments.id })
    .from(schema.appointments)
    .where(
      and(
        eq(schema.appointments.clientId, clientId),
        inArray(schema.appointments.status, [...LIVE_APPOINTMENT_STATUSES]),
        gt(schema.appointments.startsAt, now),
      ),
    );
  for (const { id } of upcoming) await updateAppointmentByBusiness(actor.business.id, id, "cancel", now);
  await db.update(schema.clients).set({ archivedAt: now }).where(eq(schema.clients.id, clientId));
  await logAccess(actor, clientId, "archive_patient");
  return { cancelled: upcoming.length };
}

export async function restorePatient(actor: Actor, clientId: string) {
  if (!can(actor, "patients")) throw new PatientError("forbidden");
  const [client] = await db
    .select({ mergedIntoId: schema.clients.mergedIntoId })
    .from(schema.clients)
    .where(and(eq(schema.clients.id, clientId), eq(schema.clients.businessId, actor.business.id)));
  if (!client) throw new PatientError("not_found");
  // A merged duplicate lives on in the record it joined.
  if (client.mergedIntoId) throw new PatientError("merged");
  await db.update(schema.clients).set({ archivedAt: null }).where(eq(schema.clients.id, clientId));
  await logAccess(actor, clientId, "restore_patient");
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Client = typeof schema.clients.$inferSelect;

async function lockPatient(tx: Tx, businessId: string, clientId: string) {
  const [client] = await tx
    .select()
    .from(schema.clients)
    .where(and(eq(schema.clients.id, clientId), eq(schema.clients.businessId, businessId)))
    .for("update");
  if (!client) throw new PatientError("not_found");
  if (client.mergedIntoId) throw new PatientError("merged");
  return client;
}

const dependentsOf = (tx: Tx, holderId: string) =>
  tx.select({ id: schema.clients.id }).from(schema.clients).where(eq(schema.clients.holderId, holderId));

// A new WhatsApp number, or none. A holder takes everyone sharing their
// number along, and keeps the conversation. Anyone else joins the new
// number's holder if it has one, or holds it; their own past messages stay
// on their record.
export async function changePhone(actor: Actor, clientId: string, raw: string | null) {
  if (!can(actor, "patients")) throw new PatientError("forbidden");
  const phone = normalizePhone(raw);
  if (phone === undefined) throw new PatientError("invalid_phone");
  await db.transaction(async (tx) => {
    const patient = await lockPatient(tx, actor.business.id, clientId);
    if (phone === patient.waPhone) return;
    const other = phone ? await holderOfNumber(actor.business.id, phone, tx) : null;
    const dependents = patient.holderId ? [] : await dependentsOf(tx, patient.id);
    if (dependents.length) {
      if (!phone) throw new PatientError("has_dependents");
      // Two families can't merge onto one number by accident.
      if (other) throw new PatientError("phone_in_use");
      await tx.update(schema.clients).set({ waPhone: phone }).where(eq(schema.clients.id, patient.id));
      await tx.update(schema.clients).set({ waPhone: phone }).where(eq(schema.clients.holderId, patient.id));
    } else {
      await tx
        .update(schema.clients)
        .set({ waPhone: phone, holderId: other?.id ?? null })
        .where(eq(schema.clients.id, patient.id));
    }
    await tx.insert(schema.accessLog).values({
      businessId: actor.business.id,
      clientId,
      userId: actor.profile.id,
      practitionerId: actor.practitionerId,
      action: "edit_chart",
    });
  });
}

// The patient and the duplicates merged into it: their signed notes,
// prescriptions and files stay on the duplicate (signed records never
// change) and are shown on the record they joined.
export async function recordIds(businessId: string, clientId: string) {
  const merged = await db
    .select({ id: schema.clients.id })
    .from(schema.clients)
    .where(and(eq(schema.clients.businessId, businessId), eq(schema.clients.mergedIntoId, clientId)));
  return [clientId, ...merged.map((m) => m.id)];
}

// Patients who might be the same person: the same number, or a name with
// the same first and last word. With a query, anyone matching it.
export async function duplicateCandidates(businessId: string, client: Pick<Client, "id" | "name" | "waPhone">, query?: string) {
  const q = query?.trim();
  const words = (client.name ?? "").trim().split(/\s+/).filter((w) => w.length > 1);
  const byName =
    words.length >= 2
      ? and(ilike(schema.clients.name, `%${words[0]}%`), ilike(schema.clients.name, `%${words.at(-1)}%`))
      : words.length === 1
        ? ilike(schema.clients.name, `%${words[0]}%`)
        : undefined;
  const match = q
    ? or(ilike(schema.clients.name, `%${q}%`), ilike(schema.clients.waPhone, `%${q.replace(/\D/g, "") || q}%`))
    : or(byName, client.waPhone ? eq(schema.clients.waPhone, client.waPhone) : undefined);
  if (!match) return [];
  return db
    .select({ id: schema.clients.id, name: schema.clients.name, waPhone: schema.clients.waPhone, dateOfBirth: schema.clients.dateOfBirth, createdAt: schema.clients.createdAt })
    .from(schema.clients)
    .where(and(eq(schema.clients.businessId, businessId), ne(schema.clients.id, client.id), isNull(schema.clients.mergedIntoId), match))
    .orderBy(desc(schema.clients.createdAt))
    .limit(10);
}

const both = (a: string | null, b: string | null) => {
  if (!a?.trim()) return b;
  if (!b?.trim() || a.trim() === b.trim()) return a;
  return `${a.trim()}\n${b.trim()}`;
};

// The conversation (messages and consents) of a number's holder, moved to
// another patient. Consents the target already has for a version stay put.
async function moveConversation(tx: Tx, fromId: string, toId: string) {
  await tx.update(schema.messages).set({ clientId: toId }).where(eq(schema.messages.clientId, fromId));
  const held = tx.select({ v: schema.consents.noticeVersion }).from(schema.consents).where(eq(schema.consents.clientId, toId));
  await tx
    .update(schema.consents)
    .set({ clientId: toId })
    .where(and(eq(schema.consents.clientId, fromId), notInArray(schema.consents.noticeVersion, held)));
}

// The same person registered twice (by hand and from WhatsApp, or from two
// numbers). Everything moves to `keepId`: appointments, missing details,
// the WhatsApp number when it has none, and the conversation. The duplicate
// is archived and marked as merged; its signed notes stay on it, shown on
// the kept record, since signed notes never change.
export async function mergePatients(actor: Actor, keepId: string, dropId: string, now = new Date()) {
  if (!can(actor, "patients")) throw new PatientError("forbidden");
  if (keepId === dropId) throw new PatientError("same_patient");
  await db.transaction(async (tx) => {
    const keep = await lockPatient(tx, actor.business.id, keepId);
    const drop = await lockPatient(tx, actor.business.id, dropId);
    const set = (id: string, values: Partial<Client>) => tx.update(schema.clients).set(values).where(eq(schema.clients.id, id));
    const leaveNumber = () => set(drop.id, { waPhone: null, holderId: null });

    if (drop.waPhone && !keep.waPhone) {
      // The kept record takes the duplicate's place on its number.
      await leaveNumber();
      if (!drop.holderId) {
        await tx.update(schema.clients).set({ holderId: keep.id }).where(eq(schema.clients.holderId, drop.id));
        await moveConversation(tx, drop.id, keep.id);
        await set(keep.id, { waPhone: drop.waPhone, holderId: null, agentPaused: drop.agentPaused });
      } else {
        await set(keep.id, { waPhone: drop.waPhone, holderId: drop.holderId });
      }
    } else if (drop.waPhone && drop.waPhone === keep.waPhone) {
      if (!drop.holderId) {
        // The duplicate held the number the kept patient shares: the kept one holds it now.
        await leaveNumber();
        await tx
          .update(schema.clients)
          .set({ holderId: keep.id })
          .where(and(eq(schema.clients.holderId, drop.id), ne(schema.clients.id, keep.id)));
        await moveConversation(tx, drop.id, keep.id);
        await set(keep.id, { holderId: null, agentPaused: drop.agentPaused });
      } else {
        await leaveNumber();
      }
    } else if (drop.waPhone) {
      // Two numbers: the kept one stays, and the duplicate's history joins it.
      if (!drop.holderId) {
        if ((await dependentsOf(tx, drop.id)).length) throw new PatientError("has_dependents");
        await leaveNumber();
        await moveConversation(tx, drop.id, keep.holderId ?? keep.id);
      } else {
        await leaveNumber();
      }
    }

    await tx.update(schema.appointments).set({ clientId: keep.id }).where(eq(schema.appointments.clientId, drop.id));
    await set(keep.id, {
      name: keep.name ?? drop.name,
      dateOfBirth: keep.dateOfBirth ?? drop.dateOfBirth,
      sex: keep.sex ?? drop.sex,
      dui: keep.dui ?? drop.dui,
      address: keep.address ?? drop.address,
      guardianName: keep.guardianName ?? drop.guardianName,
      guardianPhone: keep.guardianPhone ?? drop.guardianPhone,
      emergencyContactName: keep.emergencyContactName ?? drop.emergencyContactName,
      emergencyContactPhone: keep.emergencyContactPhone ?? drop.emergencyContactPhone,
      preferredPractitionerId: keep.preferredPractitionerId ?? drop.preferredPractitionerId,
      // Clinical details are combined rather than one picked, so none is lost.
      allergies: both(keep.allergies, drop.allergies),
      chronicConditions: both(keep.chronicConditions, drop.chronicConditions),
      data: { ...drop.data, ...keep.data },
    });
    // Duplicates merged into the dropped record now point at the kept one.
    await tx.update(schema.clients).set({ mergedIntoId: keep.id }).where(eq(schema.clients.mergedIntoId, drop.id));
    await set(drop.id, { mergedIntoId: keep.id, archivedAt: now });
    for (const clientId of [keep.id, drop.id]) {
      await tx.insert(schema.accessLog).values({
        businessId: actor.business.id,
        clientId,
        userId: actor.profile.id,
        practitionerId: actor.practitionerId,
        action: "merge_patient",
      });
    }
  });
}
