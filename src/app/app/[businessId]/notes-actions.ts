"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireBusinessAccess } from "@/lib/auth";
import { searchCodes } from "@/lib/cie10";
import { addAddendum, createNote, deleteDraft, NoteError, saveDraft, signNote, type DraftInput } from "@/lib/dashboard/notes";

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim() || null;
const notePath = (businessId: string, clientId: string, noteId: string) =>
  `/app/${businessId}/clients/${clientId}/notes/${noteId}`;

function draftFrom(form: FormData): DraftInput {
  return {
    subjective: text(form, "subjective"),
    objective: text(form, "objective"),
    vitals: {
      bloodPressure: text(form, "bloodPressure"),
      heartRate: text(form, "heartRate"),
      temperature: text(form, "temperature"),
      weight: text(form, "weight"),
      height: text(form, "height"),
      spo2: text(form, "spo2"),
    },
    assessment: text(form, "assessment"),
    diagnosisCodes: form.getAll("diagnosisCodes").map(String),
    plan: text(form, "plan"),
  };
}

export async function startNoteAction(businessId: string, clientId: string, appointmentId: string | null, form?: FormData) {
  const membership = await requireBusinessAccess(businessId);
  // From the patient's page the appointment is picked in the form.
  appointmentId ??= String(form?.get("appointmentId") ?? "");
  let noteId: string;
  try {
    noteId = await createNote(membership, clientId, appointmentId);
  } catch (err) {
    if (!(err instanceof NoteError)) throw err;
    redirect(`/app/${businessId}/clients/${clientId}?view=clinical&recordError=${err.code}#notas`);
  }
  redirect(notePath(businessId, clientId, noteId));
}

export type SaveState = { savedAt: string | null; error: string | null };

// Used by the editor's autosave and its Guardar button; it never redirects,
// so typing isn't interrupted.
export async function saveDraftAction(businessId: string, noteId: string, _prev: SaveState, form: FormData): Promise<SaveState> {
  const membership = await requireBusinessAccess(businessId);
  try {
    await saveDraft(membership, noteId, draftFrom(form));
    return { savedAt: new Date().toISOString(), error: null };
  } catch (err) {
    if (!(err instanceof NoteError)) throw err;
    return { savedAt: null, error: err.code };
  }
}

export async function signNoteAction(businessId: string, clientId: string, noteId: string, form: FormData) {
  const membership = await requireBusinessAccess(businessId);
  let outcome = "signed=1";
  try {
    // Whatever is on screen is what gets signed.
    await saveDraft(membership, noteId, draftFrom(form));
    await signNote(membership, noteId);
  } catch (err) {
    if (!(err instanceof NoteError)) throw err;
    outcome = `error=${err.code}`;
  }
  revalidatePath(notePath(businessId, clientId, noteId));
  redirect(`${notePath(businessId, clientId, noteId)}?${outcome}`);
}

export async function deleteDraftAction(businessId: string, clientId: string, noteId: string) {
  const membership = await requireBusinessAccess(businessId);
  try {
    await deleteDraft(membership, noteId);
  } catch (err) {
    if (!(err instanceof NoteError)) throw err;
    redirect(`${notePath(businessId, clientId, noteId)}?error=${err.code}`);
  }
  revalidatePath(`/app/${businessId}/clients/${clientId}`);
  redirect(`/app/${businessId}/clients/${clientId}?view=clinical#notas`);
}

export async function addAddendumAction(businessId: string, clientId: string, noteId: string, form: FormData) {
  const membership = await requireBusinessAccess(businessId);
  let outcome = "addendum=1";
  try {
    await addAddendum(membership, noteId, String(form.get("body") ?? ""));
  } catch (err) {
    if (!(err instanceof NoteError)) throw err;
    outcome = `error=${err.code}`;
  }
  revalidatePath(notePath(businessId, clientId, noteId));
  redirect(`${notePath(businessId, clientId, noteId)}?${outcome}#adendas`);
}

export async function searchCodesAction(businessId: string, query: string) {
  await requireBusinessAccess(businessId);
  return searchCodes(query, 15);
}
