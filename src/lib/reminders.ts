import { and, eq, gt, inArray } from "drizzle-orm";
import { es } from "date-fns/locale";
import { formatInTimeZone } from "date-fns-tz";
import { db, schema } from "@/db";
import { sendTemplate } from "@/lib/kapso/client";
import { TEMPLATES, TEMPLATE_LANGUAGE, type TemplateName } from "@/lib/kapso/templates";

// The reminder flow for one appointment, as plain functions the Inngest
// function calls step by step:
//   reminder at (start - lead hours) -> 2h without reply -> follow-up
//   -> 2h without reply -> auto-cancel and tell the client.
// Any message from the client stops the flow; tapping "Confirmar" also marks
// the appointment confirmed.

export const REPLY_WAIT = "2h";

type Kind = "reminder" | "followup" | "cancelled";

const templateFor: Record<Kind, TemplateName> = {
  reminder: "ikarus_recordatorio",
  followup: "ikarus_seguimiento",
  cancelled: "ikarus_cita_cancelada",
};

// Status an appointment must be in for each send, and the status it moves to.
const transition = {
  reminder: { from: "booked", to: "reminder_sent", stamp: "reminderSentAt" },
  followup: { from: "reminder_sent", to: "followup_sent", stamp: "followupSentAt" },
} as const;

export type Plan = { remindAt: string } | { skip: "not_found" | "not_live" | "booked_too_late" };

// Bookings made closer to the appointment than the lead time get no reminder:
// the client just booked, so asking them to confirm again adds nothing.
export async function planReminder(appointmentId: string): Promise<Plan> {
  const row = await load(appointmentId);
  if (!row) return { skip: "not_found" };
  if (row.appointment.status !== "booked") return { skip: "not_live" };
  const remindAt = new Date(row.appointment.startsAt.getTime() - row.business.reminderLeadHours * 3600_000);
  if (remindAt <= row.appointment.createdAt) return { skip: "booked_too_late" };
  return { remindAt: remindAt.toISOString() };
}

export type SendResult =
  | { status: "sent"; sentAt: string }
  | { status: "skipped"; reason: "not_found" | "wrong_status" | "already_started" | "template_not_approved" | "not_connected" };

export async function sendReminder(appointmentId: string, kind: "reminder" | "followup", now = new Date()): Promise<SendResult> {
  const row = await load(appointmentId);
  if (!row) return { status: "skipped", reason: "not_found" };
  const { appointment, business } = row;
  if (appointment.startsAt <= now) return { status: "skipped", reason: "already_started" };
  if (!business.phoneNumberId) return { status: "skipped", reason: "not_connected" };
  if (!(await templateApproved(business.id, templateFor[kind]))) {
    console.warn(`reminder skipped: ${templateFor[kind]} not approved for business ${business.id}`);
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
        eq(schema.messages.clientId, row.appointment.clientId),
        eq(schema.messages.direction, "inbound"),
        gt(schema.messages.createdAt, new Date(since)),
      ),
    )
    .limit(1);
  return Boolean(reply);
}

export type CancelResult = { status: "cancelled"; notified: boolean } | { status: "skipped"; reason: "not_found" | "wrong_status" };

export async function autoCancel(appointmentId: string, now = new Date()): Promise<CancelResult> {
  const [cancelled] = await db
    .update(schema.appointments)
    .set({ status: "auto_cancelled", cancelledAt: now, cancelReason: "no_reply" })
    .where(and(eq(schema.appointments.id, appointmentId), inArray(schema.appointments.status, ["reminder_sent", "followup_sent"])))
    .returning();
  if (!cancelled) return { status: "skipped", reason: (await load(appointmentId)) ? "wrong_status" : "not_found" };

  const row = (await load(appointmentId))!;
  if (!row.business.phoneNumberId || !(await templateApproved(row.business.id, templateFor.cancelled))) {
    return { status: "cancelled", notified: false };
  }
  await deliver(row, "cancelled", now, ["rebook"]);
  return { status: "cancelled", notified: true };
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
    .where(and(eq(schema.appointments.clientId, clientId), inArray(schema.appointments.status, ["reminder_sent", "followup_sent"])))
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

async function load(appointmentId: string) {
  const [row] = await db
    .select({
      appointment: schema.appointments,
      business: schema.businesses,
      client: schema.clients,
      serviceName: schema.services.name,
    })
    .from(schema.appointments)
    .innerJoin(schema.businesses, eq(schema.businesses.id, schema.appointments.businessId))
    .innerJoin(schema.clients, eq(schema.clients.id, schema.appointments.clientId))
    .innerJoin(schema.services, eq(schema.services.id, schema.appointments.serviceId))
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

export function templateParams(row: Pick<Loaded, "appointment" | "business" | "client" | "serviceName">) {
  const tz = row.business.timezone;
  return {
    nombre: row.client.name?.trim() || "cliente",
    servicio: row.serviceName,
    negocio: row.business.name,
    fecha: formatInTimeZone(row.appointment.startsAt, tz, "EEEE d 'de' MMMM", { locale: es }),
    hora: formatInTimeZone(row.appointment.startsAt, tz, "HH:mm"),
  };
}

// Sends the template and keeps a copy in the conversation, so the dashboard
// and the agent both see what the client received.
async function deliver(row: Loaded, kind: Kind, now: Date, buttonPayloads: string[]) {
  const name = templateFor[kind];
  const template = TEMPLATES.find((t) => t.name === name)!;
  const all = templateParams(row);
  const bodyComponent = template.components.find((c): c is TemplateBody => c.type === "BODY")!;
  const used = bodyComponent.example.body_text_named_params.map((p) => p.param_name);
  const params = Object.fromEntries(used.map((k) => [k, all[k]]));

  const kapsoMessageId = await sendTemplate(row.business.phoneNumberId!, row.client.waPhone, {
    name,
    language: TEMPLATE_LANGUAGE,
    params,
    buttonPayloads,
  });
  await db.insert(schema.messages).values({
    businessId: row.business.id,
    clientId: row.client.id,
    direction: "outbound",
    kapsoMessageId,
    type: "template",
    body: bodyComponent.text.replace(/\{\{(\w+)\}\}/g, (_, k: string) => params[k] ?? ""),
    payload: { template: name, appointmentId: row.appointment.id },
    createdAt: now,
  });
}
