"use server";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { requireBusinessAccess } from "@/lib/auth";
import { db, schema } from "@/db";
import { PatientError, createPatient, updateDemographics, updateClinical, changePhone } from "@/lib/dashboard/patients";
import { resolveConversation } from "@/lib/dashboard/inbox";
import { sendStaffReply } from "@/lib/messaging/staff";
import { settingsErrorLabel } from "@/lib/dashboard/labels";
import type { FormResult } from "@/lib/dashboard/form-result";

const value = (form: FormData, key: string) => String(form.get(key) ?? "").trim() || null;
const fields: Record<string, string> = { invalid_dui: "dui", invalid_birth_date: "dateOfBirth", invalid_phone: "phone", phone_in_use: "phone", has_dependents: "phone", name_required_patient: "name", unknown_practitioner: "preferredPractitionerId" };
async function change(businessId: string, work: () => Promise<unknown>, message: string): Promise<FormResult> {
  try { await work(); } catch (error) { if (error instanceof PatientError) return { ok: false, message: settingsErrorLabel[error.code], field: fields[error.code] }; throw error; }
  revalidatePath(`/app/${businessId}`, "layout");
  return { ok: true, message };
}
export async function editPatientAction(businessId: string, clientId: string, form: FormData): Promise<FormResult> {
  const actor = await requireBusinessAccess(businessId);
  const sex = value(form, "sex");
  return change(businessId, () => updateDemographics(actor, clientId, {
    ...(form.has("phone") ? { phone: value(form, "phone") } : {}),
    name: value(form, "name"), dateOfBirth: value(form, "dateOfBirth"), sex: sex === "female" || sex === "male" ? sex : null,
    dui: value(form, "dui"), address: value(form, "address"), guardianName: value(form, "guardianName"), guardianPhone: value(form, "guardianPhone"),
    emergencyContactName: value(form, "emergencyContactName"), emergencyContactPhone: value(form, "emergencyContactPhone"), preferredPractitionerId: value(form, "preferredPractitionerId"),
  }), "Datos guardados.");
}
export async function editClinicalAction(businessId: string, clientId: string, form: FormData): Promise<FormResult> {
  const actor = await requireBusinessAccess(businessId);
  return change(businessId, () => updateClinical(actor, clientId, { allergies: value(form, "allergies"), chronicConditions: value(form, "chronicConditions") }), "Datos clínicos guardados.");
}
export async function registerPatientAction(businessId: string, form: FormData): Promise<FormResult> {
  const actor = await requireBusinessAccess(businessId);
  const sex = value(form, "sex");
  let id = "";
  const result = await change(businessId, async () => { const patient = await createPatient(actor, { name: value(form, "name") ?? "", phone: value(form, "phone"), dateOfBirth: value(form, "dateOfBirth"), sex: sex === "female" || sex === "male" ? sex : null }); id = patient; }, "Paciente registrado.");
  return result.ok ? { ...result, href: `/app/${businessId}/clients/${id}?saved=nuevo` } : result;
}
export async function editPhoneAction(businessId: string, clientId: string, form: FormData): Promise<FormResult> {
  const actor = await requireBusinessAccess(businessId);
  return change(businessId, () => changePhone(actor, clientId, value(form, "phone")), "WhatsApp actualizado. Revisa el contacto que recibe los mensajes.");
}
export async function resolveConversationAction(businessId: string, clientId: string, expectedLastId: string | null): Promise<FormResult> {
  await requireBusinessAccess(businessId);
  const resolved = await resolveConversation(businessId, clientId, expectedLastId);
  revalidatePath(`/app/${businessId}`, "layout");
  return { ok: resolved, message: resolved ? "Conversación resuelta." : "La conversación cambió. Actualiza y revisa los últimos mensajes antes de resolverla." };
}
export async function replyAction(businessId: string, clientId: string, form: FormData): Promise<FormResult> {
  const { business, profile } = await requireBusinessAccess(businessId);
  const attemptId = value(form, "attemptId");
  if (!attemptId || !/^[0-9a-f-]{36}$/i.test(attemptId)) return { ok: false, message: "Actualiza la página antes de enviar." };
  const result = await sendStaffReply({ business, clientId, sentBy: profile.id, text: value(form, "text") ?? "", attemptId });
  revalidatePath(`/app/${businessId}`, "layout");
  return result.ok ? { ok: true, message: "Mensaje aceptado para envío. La conversación queda en seguimiento y el asistente en pausa." } : { ok: false, message: settingsErrorLabel[result.reason], code: result.reason };
}
export async function olderMessagesAction(businessId: string, clientId: string, beforeId: string) {
  await requireBusinessAccess(businessId);
  const [patient] = await db.select().from(schema.clients).where(and(eq(schema.clients.businessId, businessId), eq(schema.clients.id, clientId)));
  if (!patient) return [];
  const holderId = patient.holderId ?? patient.id;
  const [cursor] = await db.select().from(schema.messages).where(and(eq(schema.messages.businessId, businessId), eq(schema.messages.clientId, holderId), eq(schema.messages.id, beforeId)));
  if (!cursor) return [];
  const { desc, sql } = await import("drizzle-orm");
  return db.select().from(schema.messages).where(and(eq(schema.messages.businessId, businessId), eq(schema.messages.clientId, holderId), sql`(${schema.messages.createdAt}, ${schema.messages.id}) < (${cursor.createdAt.toISOString()}::timestamptz, ${cursor.id})`)).orderBy(desc(schema.messages.createdAt), desc(schema.messages.id)).limit(50);
}

export async function reviewedArchiveAction(businessId: string, clientId: string, form: FormData): Promise<FormResult> {
  const actor = await requireBusinessAccess(businessId);
  const expected = form.getAll("appointmentId").map(String);
  if (expected.some(id => !/^[0-9a-f-]{36}$/i.test(id))) return { ok: false, message: "Actualiza la página para revisar las citas." };
  const { archivePatient } = await import("@/lib/dashboard/patients");
  let cancelled = 0;
  return change(businessId, async () => { cancelled = (await archivePatient(actor, clientId, new Date(), expected)).cancelled; }, `Paciente archivado. Se conservará el expediente. ${expected.length ? `${expected.length} citas previstas para cancelar.` : "Sin citas próximas que cancelar."}`).then(result => result.ok ? { ...result, message: `Paciente archivado. Se cancelaron ${cancelled} citas próximas. Restaurarlo no recuperará esas citas.` } : result);
}
export async function reviewedMergeAction(businessId: string, keepId: string, dropId: string, token: string, form: FormData): Promise<FormResult> {
  const actor = await requireBusinessAccess(businessId);
  if (form.get("samePerson") !== "on") return { ok: false, message: "Confirma que ambos expedientes son de la misma persona." };
  const { mergePatients } = await import("@/lib/dashboard/patients");
  return change(businessId, () => mergePatients(actor, keepId, dropId, new Date(), token), "Expedientes unidos. Se conservaron los documentos firmados y su procedencia.");
}
export async function reviewIntakeAction(businessId: string, clientId: string, key: string, received: string, form: FormData): Promise<FormResult> {
  const actor = await requireBusinessAccess(businessId);
  const { reviewIntake } = await import("@/lib/dashboard/patients");
  const decision = form.get("decision");
  if (decision !== "record" && decision !== "received") return { ok: false, message: "Elige qué dato conservar en el expediente." };
  return change(businessId, () => reviewIntake(actor, clientId, key, received, decision), "Dato revisado. Se conserva la respuesta recibida por WhatsApp.");
}
