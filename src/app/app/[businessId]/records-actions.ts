"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireBusinessAccess } from "@/lib/auth";
import { AttachmentError, removeAttachment, uploadAttachment } from "@/lib/dashboard/attachments";
import { changePhone, mergePatients, PatientError } from "@/lib/dashboard/patients";
import { issuePrescription, MAX_ITEMS, PrescriptionError } from "@/lib/dashboard/prescriptions";

// The patient record beyond notes: the WhatsApp number, merging duplicates,
// prescriptions and attached files.

const str = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const nullable = (form: FormData, key: string) => str(form, key) || null;
const patientPath = (businessId: string, clientId: string) => `/app/${businessId}/clients/${clientId}`;

function back(businessId: string, clientId: string, outcome: string, section: string): never {
  revalidatePath(`/app/${businessId}`, "layout");
  redirect(`${patientPath(businessId, clientId)}?${outcome}#${section}`);
}

export async function changePhoneAction(businessId: string, clientId: string, form: FormData) {
  const membership = await requireBusinessAccess(businessId);
  let outcome = "saved=whatsapp";
  try {
    await changePhone(membership, clientId, nullable(form, "phone"));
  } catch (err) {
    if (!(err instanceof PatientError)) throw err;
    outcome = `recordError=${err.code}`;
  }
  back(businessId, clientId, outcome, "datos");
}

// The duplicate (dropId) joins the record being viewed (keepId).
export async function mergePatientAction(businessId: string, keepId: string, dropId: string) {
  const membership = await requireBusinessAccess(businessId);
  let outcome = "saved=unido";
  try {
    await mergePatients(membership, keepId, dropId);
  } catch (err) {
    if (!(err instanceof PatientError)) throw err;
    outcome = `recordError=${err.code}`;
  }
  back(businessId, keepId, outcome, "duplicados");
}

export async function issuePrescriptionAction(businessId: string, clientId: string, form: FormData) {
  const membership = await requireBusinessAccess(businessId);
  const items = Array.from({ length: MAX_ITEMS }, (_, i) => ({
    drug: str(form, `drug${i}`),
    dose: str(form, `dose${i}`),
    frequency: str(form, `frequency${i}`),
    duration: str(form, `duration${i}`),
  }));
  let id: string;
  try {
    const prescription = await issuePrescription(membership, clientId, {
      appointmentId: nullable(form, "appointmentId"),
      items,
      instructions: nullable(form, "instructions"),
    });
    id = prescription.id;
  } catch (err) {
    if (!(err instanceof PrescriptionError)) throw err;
    redirect(`${patientPath(businessId, clientId)}/prescriptions/new?error=${err.code}`);
  }
  revalidatePath(patientPath(businessId, clientId));
  redirect(`${patientPath(businessId, clientId)}/prescriptions/${id}?issued=1`);
}

export async function uploadAttachmentAction(businessId: string, clientId: string, form: FormData) {
  const membership = await requireBusinessAccess(businessId);
  const file = form.get("file");
  const kind = str(form, "kind");
  let outcome = "saved=archivo";
  try {
    await uploadAttachment(membership, clientId, {
      file: file instanceof File ? file : new File([], ""),
      kind: kind === "lab" || kind === "image" ? kind : "other",
      appointmentId: nullable(form, "appointmentId"),
    });
  } catch (err) {
    if (!(err instanceof AttachmentError)) throw err;
    outcome = `recordError=${err.code}`;
  }
  back(businessId, clientId, outcome, "archivos");
}

export async function removeAttachmentAction(businessId: string, clientId: string, attachmentId: string) {
  const membership = await requireBusinessAccess(businessId);
  let outcome = "saved=archivo_quitado";
  try {
    await removeAttachment(membership, attachmentId);
  } catch (err) {
    if (!(err instanceof AttachmentError)) throw err;
    outcome = `recordError=${err.code}`;
  }
  back(businessId, clientId, outcome, "archivos");
}
