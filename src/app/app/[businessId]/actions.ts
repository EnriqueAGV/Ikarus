"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireBusinessAccess, requireBusinessManager } from "@/lib/auth";
import {
  setAgentPaused,
  updateAppointmentByBusiness,
  type BusinessAction,
} from "@/lib/dashboard/appointments";
import {
  addException,
  addPractitioner,
  createIntakeField,
  createService,
  deleteIntakeField,
  moveIntakeField,
  removeException,
  saveWeeklyRules,
  SettingsError,
  updateBusinessSettings,
  updateIntakeField,
  updatePractitioner,
  updateService,
  type IntakeInput,
  type PractitionerInput,
  type WeeklyRule,
} from "@/lib/dashboard/settings";
import { addTimeBlock, AgendaError, bookForPatient, moveAppointment, removeTimeBlock, type StaffBookingResult } from "@/lib/dashboard/agenda";
import { archivePatient, createPatient, PatientError, restorePatient, updateClinical, updateDemographics } from "@/lib/dashboard/patients";
import { forgetMemberDevices, inviteMember, removeMember, setManagesClinic, TeamError } from "@/lib/dashboard/team";
import { formatLocal } from "@/lib/dashboard/labels";
import { sendStaffReply } from "@/lib/messaging/staff";

const str = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const int = (form: FormData, key: string) => Number.parseInt(str(form, key), 10);
const checked = (form: FormData, key: string) => form.get(key) === "on";
const nullable = (form: FormData, key: string) => str(form, key) || null;

// Runs a settings change and comes back to the settings page with the outcome,
// on the same doctor's calendar when there is one.
async function settingsChange(
  businessId: string,
  section: string,
  change: () => Promise<unknown>,
  practitionerId?: string,
) {
  await requireBusinessManager(businessId);
  let error: string | null = null;
  try {
    await change();
  } catch (err) {
    if (!(err instanceof SettingsError)) throw err;
    error = err.code;
  }
  revalidatePath(`/app/${businessId}`, "layout");
  const doctor = practitionerId ? `&doctor=${practitionerId}` : "";
  redirect(`/app/${businessId}/settings?${error ? `error=${error}` : "saved=1"}${doctor}#${section}`);
}

export async function appointmentAction(businessId: string, appointmentId: string, action: BusinessAction) {
  await requireBusinessAccess(businessId);
  await updateAppointmentByBusiness(businessId, appointmentId, action);
  revalidatePath(`/app/${businessId}`, "layout");
}

// After booking or moving: the agenda on that day, saying whether the patient
// was told on WhatsApp. On failure, back to the slot picker with the reason.
function afterBooking(businessId: string, result: StaffBookingResult, back: string, timezone: string): never {
  if (!result.ok) {
    const page = back.startsWith(`/app/${businessId}/`) ? back : `/app/${businessId}`;
    redirect(`${page}${page.includes("?") ? "&" : "?"}error=${result.reason}`);
  }
  const date = result.appointment.startsAt;
  const notice = !result.notice ? "" : result.notice.notified ? "&notified=1" : `&notice=${result.notice.reason}`;
  revalidatePath(`/app/${businessId}`, "layout");
  redirect(`/app/${businessId}?view=day&date=${formatLocal(date, timezone, "yyyy-MM-dd")}&booked=${result.appointment.id}${notice}`);
}

export async function bookForPatientAction(
  businessId: string,
  clientId: string,
  serviceId: string,
  practitionerId: string | null,
  localStart: string,
  back: string,
  form: FormData,
) {
  const { business } = await requireBusinessAccess(businessId);
  let result: StaffBookingResult;
  try {
    result = await bookForPatient({ business, clientId, serviceId, practitionerId, localStart, notify: checked(form, "notify") });
  } catch (err) {
    if (!(err instanceof AgendaError)) throw err;
    result = { ok: false, reason: "not_found" };
  }
  afterBooking(businessId, result, back, business.timezone);
}

export async function moveAppointmentAction(
  businessId: string,
  appointmentId: string,
  practitionerId: string | null,
  localStart: string,
  back: string,
  form: FormData,
) {
  const { business } = await requireBusinessAccess(businessId);
  const result = await moveAppointment({ business, appointmentId, practitionerId, localStart, notify: checked(form, "notify") });
  afterBooking(businessId, result, back, business.timezone);
}

export async function addTimeBlockAction(businessId: string, form: FormData) {
  const { business } = await requireBusinessAccess(businessId);
  const date = str(form, "date");
  let outcome = "blocked=1";
  try {
    await addTimeBlock(business, {
      practitionerId: str(form, "practitionerId"),
      date,
      startTime: str(form, "startTime"),
      endTime: str(form, "endTime"),
      note: nullable(form, "note"),
    });
  } catch (err) {
    if (!(err instanceof AgendaError)) throw err;
    outcome = `error=${err.code}`;
  }
  revalidatePath(`/app/${businessId}`, "layout");
  redirect(`/app/${businessId}?view=day&date=${encodeURIComponent(date)}&${outcome}#bloqueos`);
}

export async function removeTimeBlockAction(businessId: string, blockId: string, date: string) {
  await requireBusinessAccess(businessId);
  await removeTimeBlock(businessId, blockId);
  revalidatePath(`/app/${businessId}`, "layout");
  redirect(`/app/${businessId}?view=day&date=${encodeURIComponent(date)}#bloqueos`);
}

export async function setAgentPausedAction(businessId: string, clientId: string, paused: boolean) {
  await requireBusinessAccess(businessId);
  await setAgentPaused(businessId, clientId, paused);
  revalidatePath(`/app/${businessId}`, "layout");
}

export async function staffReplyAction(businessId: string, clientId: string, form: FormData) {
  const { business, profile } = await requireBusinessAccess(businessId);
  let outcome: string;
  try {
    const result = await sendStaffReply({ business, clientId, text: str(form, "text"), sentBy: profile.id });
    outcome = result.ok ? "sent=1" : `error=${result.reason}`;
  } catch (err) {
    console.error("staff reply failed", err);
    outcome = "error=send_failed";
  }
  revalidatePath(`/app/${businessId}/clients/${clientId}`);
  redirect(`/app/${businessId}/clients/${clientId}?${outcome}#conversation`);
}

async function patientChange(businessId: string, clientId: string, section: string, change: () => Promise<void>) {
  let outcome = `saved=${section}`;
  try {
    await change();
  } catch (err) {
    if (!(err instanceof PatientError)) throw err;
    outcome = `recordError=${err.code}`;
  }
  revalidatePath(`/app/${businessId}/clients/${clientId}`);
  redirect(`/app/${businessId}/clients/${clientId}?${outcome}#${section}`);
}

export async function saveDemographicsAction(businessId: string, clientId: string, form: FormData) {
  const membership = await requireBusinessAccess(businessId);
  const sex = form.get("sex");
  await patientChange(businessId, clientId, "datos", () =>
    updateDemographics(membership, clientId, {
      name: nullable(form, "name"),
      dateOfBirth: nullable(form, "dateOfBirth"),
      sex: sex === "female" || sex === "male" ? sex : null,
      dui: nullable(form, "dui"),
      address: nullable(form, "address"),
      guardianName: nullable(form, "guardianName"),
      guardianPhone: nullable(form, "guardianPhone"),
      emergencyContactName: nullable(form, "emergencyContactName"),
      emergencyContactPhone: nullable(form, "emergencyContactPhone"),
      preferredPractitionerId: nullable(form, "preferredPractitionerId"),
    }),
  );
}

export async function saveClinicalAction(businessId: string, clientId: string, form: FormData) {
  const membership = await requireBusinessAccess(businessId);
  await patientChange(businessId, clientId, "clinico", () =>
    updateClinical(membership, clientId, {
      allergies: nullable(form, "allergies"),
      chronicConditions: nullable(form, "chronicConditions"),
    }),
  );
}

// A patient registered by hand. Errors come back to the list with the form open.
export async function createPatientAction(businessId: string, form: FormData) {
  const membership = await requireBusinessAccess(businessId);
  const sex = form.get("sex");
  let id: string;
  try {
    id = await createPatient(membership, {
      name: str(form, "name"),
      phone: nullable(form, "phone"),
      dateOfBirth: nullable(form, "dateOfBirth"),
      sex: sex === "female" || sex === "male" ? sex : null,
    });
  } catch (err) {
    if (!(err instanceof PatientError)) throw err;
    redirect(`/app/${businessId}/clients?new=1&recordError=${err.code}`);
  }
  revalidatePath(`/app/${businessId}`, "layout");
  redirect(`/app/${businessId}/clients/${id}?saved=nuevo`);
}

export async function archivePatientAction(businessId: string, clientId: string) {
  const membership = await requireBusinessAccess(businessId);
  let outcome: string;
  try {
    const { cancelled } = await archivePatient(membership, clientId);
    outcome = `archived=${cancelled}`;
  } catch (err) {
    if (!(err instanceof PatientError)) throw err;
    outcome = `recordError=${err.code}`;
  }
  revalidatePath(`/app/${businessId}`, "layout");
  redirect(`/app/${businessId}/clients/${clientId}?${outcome}`);
}

export async function restorePatientAction(businessId: string, clientId: string) {
  const membership = await requireBusinessAccess(businessId);
  await patientChange(businessId, clientId, "restaurado", () => restorePatient(membership, clientId));
}

export async function saveHoursAction(businessId: string, practitionerId: string, form: FormData) {
  const rules: WeeklyRule[] = [];
  for (let weekday = 0; weekday < 7; weekday++) {
    if (!checked(form, `d${weekday}_open`)) continue;
    for (const n of [1, 2]) {
      const startTime = str(form, `d${weekday}_s${n}`);
      const endTime = str(form, `d${weekday}_e${n}`);
      if (startTime || endTime) rules.push({ weekday, startTime, endTime });
    }
  }
  await settingsChange(businessId, "hours", () => saveWeeklyRules(businessId, practitionerId, rules), practitionerId);
}

export async function addExceptionAction(businessId: string, practitionerId: string, form: FormData) {
  const closed = checked(form, "closed");
  await settingsChange(
    businessId,
    "exceptions",
    () =>
      addException(businessId, practitionerId, {
        date: str(form, "date"),
        range: closed ? null : { startTime: str(form, "startTime"), endTime: str(form, "endTime") },
        note: str(form, "note"),
      }),
    practitionerId,
  );
}

export async function removeExceptionAction(businessId: string, practitionerId: string, exceptionId: string) {
  await settingsChange(businessId, "exceptions", () => removeException(businessId, exceptionId), practitionerId);
}

const practitionerFrom = (form: FormData): PractitionerInput => ({
  displayName: str(form, "displayName"),
  specialty: str(form, "specialty"),
  jvpmNumber: str(form, "jvpmNumber"),
});

export async function addPractitionerAction(businessId: string, form: FormData) {
  await settingsChange(businessId, "doctors", () => addPractitioner(businessId, practitionerFrom(form)));
}

export async function updatePractitionerAction(businessId: string, practitionerId: string, form: FormData) {
  await settingsChange(
    businessId,
    "doctors",
    () => updatePractitioner(businessId, practitionerId, { ...practitionerFrom(form), active: checked(form, "active") }),
    practitionerId,
  );
}

const serviceFrom = (form: FormData) => ({
  name: str(form, "name"),
  durationMin: int(form, "durationMin"),
  bufferMin: int(form, "bufferMin") || 0,
  active: checked(form, "active"),
});

export async function createServiceAction(businessId: string, form: FormData) {
  await settingsChange(businessId, "services", () => createService(businessId, { ...serviceFrom(form), active: true }));
}

export async function updateServiceAction(businessId: string, serviceId: string, form: FormData) {
  await settingsChange(businessId, "services", () => updateService(businessId, serviceId, serviceFrom(form)));
}

const intakeFrom = (form: FormData): IntakeInput => ({
  label: str(form, "label"),
  type: z.enum(["text", "date", "choice"]).catch("text").parse(str(form, "type")),
  options: str(form, "options")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
  required: checked(form, "required"),
});

export async function createIntakeAction(businessId: string, form: FormData) {
  await settingsChange(businessId, "intake", () => createIntakeField(businessId, intakeFrom(form)));
}

export async function updateIntakeAction(businessId: string, fieldId: string, form: FormData) {
  await settingsChange(businessId, "intake", () => updateIntakeField(businessId, fieldId, intakeFrom(form)));
}

export async function deleteIntakeAction(businessId: string, fieldId: string) {
  await settingsChange(businessId, "intake", () => deleteIntakeField(businessId, fieldId));
}

export async function moveIntakeAction(businessId: string, fieldId: string, direction: "up" | "down") {
  await settingsChange(businessId, "intake", () => moveIntakeField(businessId, fieldId, direction));
}

export async function saveGeneralAction(businessId: string, form: FormData) {
  await settingsChange(businessId, "general", () =>
    updateBusinessSettings(businessId, {
      reminderLeadHours: int(form, "reminderLeadHours"),
      agentInstructions: str(form, "agentInstructions"),
      reminderEndPolicy: form.get("reminderEndPolicy") === "auto_cancel" ? "auto_cancel" : "escalate",
    }),
  );
}

export async function inviteMemberAction(businessId: string, form: FormData) {
  await requireBusinessManager(businessId);
  const email = z.string().trim().toLowerCase().email().safeParse(form.get("email"));
  const role = form.get("role") === "doctor" ? "doctor" : "assistant";
  const managesClinic = form.get("managesClinic") === "on";
  const displayName = str(form, "displayName") || undefined;
  let outcome: string;
  if (!email.success) {
    outcome = "error=invalid_email";
  } else {
    try {
      const { added, emailed } = await inviteMember(businessId, { email: email.data, role, managesClinic, displayName });
      outcome = added ? `invited=${encodeURIComponent(email.data)}${emailed ? "&emailed=1" : ""}` : "exists=1";
    } catch (err) {
      if (err instanceof TeamError) {
        outcome = `error=${err.code}`;
      } else {
        console.error("inviteMember failed", err);
        outcome = "error=invite_failed";
      }
    }
  }
  revalidatePath(`/app/${businessId}/team`);
  redirect(`/app/${businessId}/team?${outcome}`);
}

export async function forgetDevicesAction(businessId: string, memberId: string) {
  await requireBusinessManager(businessId);
  let outcome = "forgot=1";
  try {
    await forgetMemberDevices(businessId, memberId);
  } catch (err) {
    if (!(err instanceof TeamError)) throw err;
    outcome = `error=${err.code}`;
  }
  redirect(`/app/${businessId}/team?${outcome}`);
}

export async function setManagesClinicAction(businessId: string, memberId: string, managesClinic: boolean) {
  await requireBusinessManager(businessId);
  let outcome = "saved=1";
  try {
    await setManagesClinic(businessId, memberId, managesClinic);
  } catch (err) {
    if (!(err instanceof TeamError)) throw err;
    outcome = `error=${err.code}`;
  }
  revalidatePath(`/app/${businessId}/team`);
  redirect(`/app/${businessId}/team?${outcome}`);
}

export async function removeMemberAction(businessId: string, memberId: string) {
  await requireBusinessManager(businessId);
  let outcome = "removed=1";
  try {
    await removeMember(businessId, memberId);
  } catch (err) {
    if (!(err instanceof TeamError)) throw err;
    outcome = `error=${err.code}`;
  }
  revalidatePath(`/app/${businessId}/team`);
  redirect(`/app/${businessId}/team?${outcome}`);
}
