import { aliasedTable, and, eq, gt, inArray, or, sql } from "drizzle-orm";
import { es } from "date-fns/locale";
import { formatInTimeZone } from "date-fns-tz";
import { db, schema } from "@/db";
import { serviceRunning } from "@/lib/billing";
import { sendTemplate } from "@/lib/kapso/client";
import { TEMPLATES, TEMPLATE_LANGUAGE, type TemplateName } from "@/lib/kapso/templates";

// The reminder flow for one appointment, as plain functions the Inngest
// function calls step by step:
//   reminder at (start - lead hours) -> 2h without reply -> follow-up
//   -> 2h without reply -> the clinic's reminder_end_policy:
//      escalate (default): the appointment stays booked and is flagged for the
//        team to call the patient;
//      auto_cancel: cancel it and tell the patient.
// Any message from the patient stops the flow; tapping "Confirmar" also marks
// the appointment confirmed.

export const REPLY_WAIT = "2h";

type Kind = "reminder" | "followup" | "cancelled" | "booked" | "no_show";
type Policy = (typeof schema.reminderEndPolicy.enumValues)[number];

function templateFor(kind: Kind, policy: Policy): TemplateName {
  if (kind === "reminder") return "praxia_recordatorio";
  if (kind === "cancelled") return "praxia_cita_cancelada";
  if (kind === "booked") return "praxia_cita_agendada";
  if (kind === "no_show") return "praxia_no_asistio";
  // Only warn about a cancellation that will actually happen.
  return policy === "auto_cancel" ? "praxia_seguimiento_aviso" : "praxia_seguimiento";
}

// Status an appointment must be in for each send, and the status it moves to.
const transition = {
  reminder: { from: "booked", to: "reminder_sent", stamp: "reminderSentAt" },
  followup: { from: "reminder_sent", to: "followup_sent", stamp: "followupSentAt" },
} as const;

export type Plan = { remindAt: string } | { skip: "not_found" | "not_live" | "booked_too_late" | "no_whatsapp" };

// Bookings made closer to the appointment than the lead time get no reminder:
// the client just booked, so asking them to confirm again adds nothing.
export async function planReminder(appointmentId: string): Promise<Plan> {
  const row = await load(appointmentId);
  if (!row) return { skip: "not_found" };
  if (row.appointment.status !== "booked") return { skip: "not_live" };
  if (!row.conversation.waPhone) return { skip: "no_whatsapp" };
  const remindAt = new Date(row.appointment.startsAt.getTime() - row.business.reminderLeadHours * 3600_000);
  if (remindAt <= row.appointment.createdAt) return { skip: "booked_too_late" };
  return { remindAt: remindAt.toISOString() };
}

export type SendResult =
  | { status: "sent"; sentAt: string }
  | { status: "skipped"; reason: "not_found" | "wrong_status" | "already_started" | "template_not_approved" | "not_connected" | "service_stopped" };

export async function sendReminder(appointmentId: string, kind: "reminder" | "followup", now = new Date()): Promise<SendResult> {
  const row = await load(appointmentId);
  if (!row) return { status: "skipped", reason: "not_found" };
  const { appointment, business } = row;
  if (appointment.startsAt <= now) return { status: "skipped", reason: "already_started" };
  if (!business.phoneNumberId) return { status: "skipped", reason: "not_connected" };
  if (!serviceRunning(business, now)) return { status: "skipped", reason: "service_stopped" };
  const template = templateFor(kind, business.reminderEndPolicy);
  if (!(await templateApproved(business.id, template))) {
    console.warn(`reminder skipped: ${template} not approved for business ${business.id}`);
    return { status: "skipped", reason: "template_not_approved" };
  }

  // Claim the transition first so a retried step cannot send twice; undo the
  // claim if the send fails so the retry can try again.
  const t = transition[kind];
  const [claimed] = await db
    .update(schema.appointments)
    .set({ status: t.to, [t.stamp]: now })
    .where(and(eq(schema.appointments.id, appointment.id), eq(schema.appointments.status, t.from)))
    .returning();
  if (!claimed) return { status: "skipped", reason: "wrong_status" };

  try {
    await deliver(row, kind, now, [`confirm:${appointment.id}`, `reschedule:${appointment.id}`, `cancel:${appointment.id}`]);
  } catch (err) {
    await db
      .update(schema.appointments)
      .set({ status: t.from, [t.stamp]: null })
      .where(and(eq(schema.appointments.id, appointment.id), eq(schema.appointments.status, t.to)));
    throw err;
  }
  return { status: "sent", sentAt: now.toISOString() };
}

// Whether the client wrote anything since a moment. The Inngest wait only
// sees replies sent after it started, so this closes that gap.
export async function clientRepliedSince(appointmentId: string, since: string) {
  const row = await load(appointmentId);
  if (!row) return true;
  const [reply] = await db
    .select({ id: schema.messages.id })
    .from(schema.messages)
    .where(
      and(
        eq(schema.messages.clientId, row.conversation.id),
        eq(schema.messages.direction, "inbound"),
        gt(schema.messages.createdAt, new Date(since)),
      ),
    )
    .limit(1);
  return Boolean(reply);
}

export type CancelResult = { status: "cancelled"; notified: boolean } | { status: "skipped"; reason: "not_found" | "wrong_status" };
export type EndResult = CancelResult | { status: "escalated" };

// The patient answered neither the reminder nor the follow-up.
export async function endUnanswered(appointmentId: string, now = new Date()): Promise<EndResult> {
  const row = await load(appointmentId);
  if (!row) return { status: "skipped", reason: "not_found" };
  if (row.business.reminderEndPolicy === "auto_cancel") return autoCancel(appointmentId, now);
  const [flagged] = await db
    .update(schema.appointments)
    .set({ escalatedAt: now })
    .where(and(eq(schema.appointments.id, appointmentId), inArray(schema.appointments.status, ["reminder_sent", "followup_sent"])))
    .returning();
  return flagged ? { status: "escalated" } : { status: "skipped", reason: "wrong_status" };
}

export async function autoCancel(appointmentId: string, now = new Date()): Promise<CancelResult> {
  const [cancelled] = await db
    .update(schema.appointments)
    .set({ status: "auto_cancelled", cancelledAt: now, cancelReason: "no_reply" })
    .where(and(eq(schema.appointments.id, appointmentId), inArray(schema.appointments.status, ["reminder_sent", "followup_sent"])))
    .returning();
  if (!cancelled) return { status: "skipped", reason: (await load(appointmentId)) ? "wrong_status" : "not_found" };

  const row = (await load(appointmentId))!;
  if (!row.business.phoneNumberId || !(await templateApproved(row.business.id, templateFor("cancelled", row.business.reminderEndPolicy)))) {
    return { status: "cancelled", notified: false };
  }
  await deliver(row, "cancelled", now, ["rebook"]);
  return { status: "cancelled", notified: true };
}

export type NotifyResult =
  | { notified: true }
  | { notified: false; reason: "no_whatsapp" | "not_connected" | "template_not_approved" | "service_stopped" };

// Tells the patient (on their number's WhatsApp) about an appointment the
// clinic's team booked or moved for them.
export async function notifyBooked(appointmentId: string, now = new Date()): Promise<NotifyResult> {
  const row = await load(appointmentId);
  if (!row?.conversation.waPhone) return { notified: false, reason: "no_whatsapp" };
  if (!row.business.phoneNumberId) return { notified: false, reason: "not_connected" };
  if (!serviceRunning(row.business, now)) return { notified: false, reason: "service_stopped" };
  if (!(await templateApproved(row.business.id, "praxia_cita_agendada"))) return { notified: false, reason: "template_not_approved" };
  await deliver(row, "booked", now, []);
  return { notified: true };
}

// After the team marks a no-show: one message offering a new time, if the
// clinic has it on. The patient's reply reaches the assistant, which books.
export async function notifyNoShow(appointmentId: string, now = new Date()): Promise<NotifyResult | { notified: false; reason: "turned_off" | "wrong_status" }> {
  const row = await load(appointmentId);
  if (!row || row.appointment.status !== "no_show") return { notified: false, reason: "wrong_status" };
  if (!row.business.noShowFollowUp) return { notified: false, reason: "turned_off" };
  if (!row.conversation.waPhone) return { notified: false, reason: "no_whatsapp" };
  if (!row.business.phoneNumberId) return { notified: false, reason: "not_connected" };
  if (!serviceRunning(row.business, now)) return { notified: false, reason: "service_stopped" };
  if (!(await templateApproved(row.business.id, "praxia_no_asistio"))) return { notified: false, reason: "template_not_approved" };
  await deliver(row, "no_show", now, []);
  return { notified: true };
}

// Applies a client's reply to their pending reminders. Tapping "Confirmar"
// (or answering just that word) confirms the appointment the reminder was for.
export async function applyReminderReply(clientId: string, message: { body: string | null; payload: unknown }, now = new Date()) {
  const payload = buttonPayload(message.payload);
  const isConfirm = payload?.startsWith("confirm:") || message.body?.trim().toLowerCase() === "confirmar";
  if (!isConfirm) return null;

  const targetId = payload?.startsWith("confirm:") ? payload.slice("confirm:".length) : null;
  const pending = await db
    .select()
    .from(schema.appointments)
    .where(
      and(
        // The reply comes from the number, so it covers everyone on it.
        inArray(
          schema.appointments.clientId,
          db
            .select({ id: schema.clients.id })
            .from(schema.clients)
            .where(or(eq(schema.clients.id, clientId), eq(schema.clients.holderId, clientId))),
        ),
        inArray(schema.appointments.status, ["reminder_sent", "followup_sent"]),
      ),
    )
    .orderBy(schema.appointments.startsAt);
  const target = targetId ? pending.find((a) => a.id === targetId) : pending[0];
  if (!target) return null;

  const [confirmed] = await db
    .update(schema.appointments)
    .set({ status: "confirmed", confirmedAt: now })
    .where(and(eq(schema.appointments.id, target.id), inArray(schema.appointments.status, ["reminder_sent", "followup_sent"])))
    .returning();
  return confirmed ?? null;
}

function buttonPayload(payload: unknown): string | null {
  const p = payload as { button?: { payload?: string }; interactive?: { button_reply?: { id?: string } } } | null;
  return p?.button?.payload ?? p?.interactive?.button_reply?.id ?? null;
}

type TemplateBody = Extract<(typeof TEMPLATES)[number]["components"][number], { type: "BODY" }>;

type Loaded = NonNullable<Awaited<ReturnType<typeof load>>>;

// The appointment's patient, and the conversation it is reminded on: the
// patient's own, or the holder's when they share a number.
const holders = aliasedTable(schema.clients, "holder");

async function load(appointmentId: string) {
  const [row] = await db
    .select({
      appointment: schema.appointments,
      business: schema.businesses,
      client: schema.clients,
      conversation: holders,
      practitionerName: schema.practitioners.displayName,
    })
    .from(schema.appointments)
    .innerJoin(schema.businesses, eq(schema.businesses.id, schema.appointments.businessId))
    .innerJoin(schema.clients, eq(schema.clients.id, schema.appointments.clientId))
    .innerJoin(holders, eq(holders.id, sql`coalesce(${schema.clients.holderId}, ${schema.clients.id})`))
    .innerJoin(schema.practitioners, eq(schema.practitioners.id, schema.appointments.practitionerId))
    .where(eq(schema.appointments.id, appointmentId));
  return row ?? null;
}

async function templateApproved(businessId: string, name: TemplateName) {
  const [t] = await db
    .select({ status: schema.templates.status })
    .from(schema.templates)
    .where(
      and(
        eq(schema.templates.businessId, businessId),
        eq(schema.templates.name, name),
        eq(schema.templates.language, TEMPLATE_LANGUAGE),
      ),
    );
  return t?.status === "APPROVED";
}

export function templateParams(row: Pick<Loaded, "appointment" | "business" | "client" | "practitionerName">) {
  const tz = row.business.timezone;
  return {
    nombre: row.client.name?.trim() || "paciente",
    consultorio: row.business.name,
    doctor: row.practitionerName,
    fecha: formatInTimeZone(row.appointment.startsAt, tz, "EEEE d 'de' MMMM", { locale: es }),
    hora: formatInTimeZone(row.appointment.startsAt, tz, "HH:mm"),
  };
}

// Sends the template and keeps a copy in the conversation, so the dashboard
// and the agent both see what the client received.
async function deliver(row: Loaded, kind: Kind, now: Date, buttonPayloads: string[]) {
  const name = templateFor(kind, row.business.reminderEndPolicy);
  const template = TEMPLATES.find((t) => t.name === name)!;
  const all = templateParams(row);
  const bodyComponent = template.components.find((c): c is TemplateBody => c.type === "BODY")!;
  const used = bodyComponent.example.body_text_named_params.map((p) => p.param_name);
  const params = Object.fromEntries(used.map((k) => [k, all[k]]));

  const kapsoMessageId = await sendTemplate(row.business.phoneNumberId!, row.conversation.waPhone!, {
    name,
    language: TEMPLATE_LANGUAGE,
    params,
    buttonPayloads,
  });
  await db.insert(schema.messages).values({
    businessId: row.business.id,
    clientId: row.conversation.id,
    direction: "outbound",
    kapsoMessageId,
    type: "template",
    body: bodyComponent.text.replace(/\{\{(\w+)\}\}/g, (_, k: string) => params[k] ?? ""),
    payload: { template: name, appointmentId: row.appointment.id },
    createdAt: now,
  });
}
