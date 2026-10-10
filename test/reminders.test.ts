import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startFakeKapso } from "./fake-kapso";

const sent = vi.hoisted(() => [] as { name: string; data: unknown }[]);
vi.mock("@/inngest/client", () => ({
  inngest: {
    send: async (e: { name: string; data: unknown } | { name: string; data: unknown }[]) => {
      sent.push(...(Array.isArray(e) ? e : [e]));
    },
    createFunction: () => ({}),
  },
}));

const PHONE_ID = "555000111";
let failSends = false;
const kapso = await startFakeKapso({
  "POST /meta/whatsapp/v24.0/[^/]+/messages": () =>
    failSends
      ? { status: 500, json: { error: { message: "boom" } } }
      : { json: { messaging_product: "whatsapp", messages: [{ id: `wamid.${Math.random()}` }] } },
});
process.env.KAPSO_API_BASE_URL = kapso.url;

const { db, schema } = await import("@/db");
const { eq, sql } = await import("drizzle-orm");
const reminders = await import("@/lib/reminders");
const { remindersFlow } = await import("@/inngest/functions");
const messagesRoute = await import("@/app/api/webhooks/kapso/messages/route");

// Booked Monday 12 Oct 2026 09:00 local for Wednesday 14 Oct 10:00 local (16:00Z).
const BOOKED_AT = new Date("2026-10-12T15:00:00Z");
const STARTS_AT = new Date("2026-10-14T16:00:00Z");
const CLIENT_PHONE = "5215511112222";

let business: typeof schema.businesses.$inferSelect;
let clientId: string;
let serviceId: string;
let practitionerId: string;

beforeEach(async () => {
  failSends = false;
  sent.length = 0;
  kapso.calls.length = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  await db.execute(
    sql`truncate webhook_events, messages, appointments, clients, intake_fields, availability_rules, availability_exceptions, services, templates, setup_links, business_members, businesses, profiles cascade`,
  );
  [business] = await db
    .insert(schema.businesses)
    .values({ name: "Consultorio San Benito", status: "connected", phoneNumberId: PHONE_ID, reminderLeadHours: 24, timezone: "America/Mexico_City" })
    .returning();
  [{ id: clientId }] = await db
    .insert(schema.clients)
    .values({ businessId: business.id, waPhone: CLIENT_PHONE, name: "Ana" })
    .returning();
  [{ id: serviceId }] = await db
    .insert(schema.services)
    .values({ businessId: business.id, name: "Corte de cabello", durationMin: 60 })
    .returning();
  [{ id: practitionerId }] = await db
    .insert(schema.practitioners)
    .values({ businessId: business.id, displayName: "Dra. Ana Ruiz" })
    .returning();
  await db.insert(schema.templates).values(
    ["praxia_recordatorio", "praxia_seguimiento", "praxia_seguimiento_aviso", "praxia_cita_cancelada"].map((name) => ({
      businessId: business.id,
      name,
      status: "APPROVED" as const,
    })),
  );
});

afterEach(() => vi.useRealTimers());
afterAll(() => kapso.close());

async function appointment(startsAt = STARTS_AT, createdAt = BOOKED_AT, patientId = clientId) {
  const [a] = await db
    .insert(schema.appointments)
    .values({
      businessId: business.id,
      clientId: patientId,
      serviceId,
      practitionerId,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3600_000),
      createdAt,
    })
    .returning();
  return a;
}

async function statusOf(id: string) {
  const [a] = await db.select().from(schema.appointments).where(eq(schema.appointments.id, id));
  return a.status;
}

function templateSends() {
  return kapso.calls
    .map((c) => c.body as { type?: string; template?: { name: string; components: unknown[] } })
    .filter((b) => b.type === "template");
}

// Stand-in for Inngest's step tools: runs steps inline, moves the clock on
// sleeps and timeouts, and answers waits from a script.
function fakeStep(waits: Array<"reply" | "timeout" | ((now: Date) => Promise<void>)>) {
  const log: string[] = [];
  return {
    log,
    step: {
      run: async <T,>(id: string, fn: () => Promise<T>) => {
        log.push(`run:${id}`);
        return JSON.parse(JSON.stringify(await fn())) as T;
      },
      sleepUntil: async (id: string, time: Date) => {
        log.push(`sleep:${time.toISOString()}`);
        vi.setSystemTime(time);
      },
      waitForEvent: async (id: string) => {
        log.push(`wait:${id}`);
        const next = waits.shift() ?? "timeout";
        if (next === "reply") return { name: "client/replied" };
        if (typeof next === "function") await next(new Date());
        vi.setSystemTime(new Date(Date.now() + 2 * 3600_000));
        return null;
      },
    },
  };
}

describe("reminder flow", () => {
  it("reminds at the lead time, follows up, then flags the appointment for a call", async () => {
    vi.setSystemTime(BOOKED_AT);
    const a = await appointment();
    const { step } = fakeStep(["timeout", "timeout"]);
    const result = await remindersFlow({ event: { data: { appointmentId: a.id, clientId } }, step });

    expect(result).toEqual({ status: "escalated" });
    // The follow-up does not threaten a cancellation that won't happen.
    expect(templateSends().map((t) => t.template!.name)).toEqual(["praxia_recordatorio", "praxia_seguimiento"]);
    const [row] = await db.select().from(schema.appointments).where(eq(schema.appointments.id, a.id));
    expect(row.status).toBe("followup_sent");
    expect(row.escalatedAt?.toISOString()).toBe("2026-10-13T20:00:00.000Z");
  });

  it("with auto-cancel, warns in the follow-up, then cancels and tells the patient", async () => {
    await db.update(schema.businesses).set({ reminderEndPolicy: "auto_cancel" }).where(eq(schema.businesses.id, business.id));
    vi.setSystemTime(BOOKED_AT);
    const a = await appointment();
    const { step, log } = fakeStep(["timeout", "timeout"]);
    const result = await remindersFlow({ event: { data: { appointmentId: a.id, clientId } }, step });

    expect(result).toEqual({ status: "cancelled", notified: true });
    expect(log[1]).toBe("sleep:2026-10-13T16:00:00.000Z");
    expect(templateSends().map((t) => t.template!.name)).toEqual([
      "praxia_recordatorio",
      "praxia_seguimiento_aviso",
      "praxia_cita_cancelada",
    ]);
    const [first] = templateSends();
    expect(first.template!.components).toEqual([
      {
        type: "body",
        parameters: [
          { type: "text", parameter_name: "nombre", text: "Ana" },
          { type: "text", parameter_name: "consultorio", text: "Consultorio San Benito" },
          { type: "text", parameter_name: "doctor", text: "Dra. Ana Ruiz" },
          { type: "text", parameter_name: "fecha", text: "14-10-2026" },
          { type: "text", parameter_name: "hora", text: "10:00 AM" },
        ],
      },
      { type: "button", sub_type: "quick_reply", index: "0", parameters: [{ type: "payload", payload: `confirm:${a.id}` }] },
      { type: "button", sub_type: "quick_reply", index: "1", parameters: [{ type: "payload", payload: `reschedule:${a.id}` }] },
      { type: "button", sub_type: "quick_reply", index: "2", parameters: [{ type: "payload", payload: `cancel:${a.id}` }] },
    ]);

    const [row] = await db.select().from(schema.appointments).where(eq(schema.appointments.id, a.id));
    expect(row).toMatchObject({ status: "auto_cancelled", cancelReason: "no_reply" });
    expect(row.reminderSentAt?.toISOString()).toBe("2026-10-13T16:00:00.000Z");
    expect(row.followupSentAt?.toISOString()).toBe("2026-10-13T18:00:00.000Z");

    // The conversation shows what the client received.
    const outbound = await db.select().from(schema.messages).orderBy(schema.messages.createdAt);
    expect(outbound[0].body).toBe(
      "Hola Ana, le recordamos su cita en Consultorio San Benito con Dra. Ana Ruiz el 14-10-2026 a las 10:00 AM. ¿Nos confirma su asistencia?",
    );
  });

  it("stops when the client replies", async () => {
    vi.setSystemTime(BOOKED_AT);
    const a = await appointment();
    const { step } = fakeStep(["reply"]);
    expect(await remindersFlow({ event: { data: { appointmentId: a.id, clientId } }, step })).toEqual({ status: "replied" });
    expect(templateSends()).toHaveLength(1);
    expect(await statusOf(a.id)).toBe("reminder_sent");
  });

  it("stops when the reply landed just before the wait began", async () => {
    vi.setSystemTime(BOOKED_AT);
    const a = await appointment();
    const replyBeforeWait = async (now: Date) => {
      await db.insert(schema.messages).values({
        businessId: business.id,
        clientId,
        direction: "inbound",
        type: "text",
        body: "ok",
        createdAt: new Date(now.getTime() + 1000),
      });
    };
    const { step } = fakeStep([replyBeforeWait]);
    expect(await remindersFlow({ event: { data: { appointmentId: a.id, clientId } }, step })).toEqual({ status: "replied" });
    expect(templateSends()).toHaveLength(1);
  });

  it("skips bookings made inside the lead time", async () => {
    vi.setSystemTime(BOOKED_AT);
    const a = await appointment(new Date(BOOKED_AT.getTime() + 5 * 3600_000));
    const { step } = fakeStep([]);
    expect(await remindersFlow({ event: { data: { appointmentId: a.id, clientId } }, step })).toEqual({ skip: "booked_too_late" });
    expect(kapso.calls).toHaveLength(0);
  });

  it("does not send while Meta has not approved the template", async () => {
    vi.setSystemTime(BOOKED_AT);
    await db.update(schema.templates).set({ status: "PENDING" });
    const a = await appointment();
    const { step } = fakeStep([]);
    expect(await remindersFlow({ event: { data: { appointmentId: a.id, clientId } }, step })).toEqual({
      status: "skipped",
      reason: "template_not_approved",
    });
    expect(await statusOf(a.id)).toBe("booked");
  });

  it("does not remind an appointment that was confirmed or cancelled meanwhile", async () => {
    vi.setSystemTime(BOOKED_AT);
    const a = await appointment();
    await db.update(schema.appointments).set({ status: "cancelled_by_client" }).where(eq(schema.appointments.id, a.id));
    vi.setSystemTime(new Date("2026-10-13T16:00:00Z"));
    expect(await reminders.sendReminder(a.id, "reminder")).toEqual({ status: "skipped", reason: "wrong_status" });
    expect(kapso.calls).toHaveLength(0);
  });

  it("sends nothing while the clinic's plan has run out", async () => {
    vi.setSystemTime(new Date("2026-10-13T16:00:00Z"));
    const a = await appointment();
    await db.update(schema.businesses).set({ billingSuspended: true }).where(eq(schema.businesses.id, business.id));
    expect(await reminders.sendReminder(a.id, "reminder")).toEqual({ status: "skipped", reason: "service_stopped" });
    expect(kapso.calls).toHaveLength(0);
    expect(await statusOf(a.id)).toBe("booked");
  });

  it("releases its claim when the send fails, so a retry can send", async () => {
    vi.setSystemTime(new Date("2026-10-13T16:00:00Z"));
    const a = await appointment();
    failSends = true;
    await expect(reminders.sendReminder(a.id, "reminder")).rejects.toThrow();
    expect(await statusOf(a.id)).toBe("booked");
    failSends = false;
    expect(await reminders.sendReminder(a.id, "reminder")).toMatchObject({ status: "sent" });
    expect(await statusOf(a.id)).toBe("reminder_sent");
  });
});

describe("replies to a reminder", () => {
  async function receive(message: Record<string, unknown>) {
    const id = `wamid.in.${Math.random()}`;
    const body = { message: { id, from: CLIENT_PHONE, ...message }, phone_number_id: PHONE_ID };
    const raw = JSON.stringify(body);
    return messagesRoute.POST(
      new Request("https://ikarus.test/api/webhooks/kapso/messages", {
        method: "POST",
        body: raw,
        headers: {
          "x-webhook-event": "whatsapp.message.received",
          "x-idempotency-key": id,
          "x-webhook-signature": createHmac("sha256", "message-secret").update(raw).digest("hex"),
        },
      }),
    );
  }

  it("tapping Confirmar confirms that appointment and stops the flow", async () => {
    vi.setSystemTime(new Date("2026-10-13T16:00:00Z"));
    const a = await appointment();
    await reminders.sendReminder(a.id, "reminder");
    await receive({ type: "button", button: { text: "Confirmar", payload: `confirm:${a.id}` } });

    expect(await statusOf(a.id)).toBe("confirmed");
    expect(sent.map((e) => e.name)).toEqual(["whatsapp/message.received", "client/replied"]);
  });

  it("any other reply leaves the appointment as is but still stops the flow", async () => {
    vi.setSystemTime(new Date("2026-10-13T16:00:00Z"));
    const a = await appointment();
    await reminders.sendReminder(a.id, "reminder");
    await receive({ type: "text", text: { body: "¿Puedo llegar 10 minutos tarde?" } });

    expect(await statusOf(a.id)).toBe("reminder_sent");
    expect(sent.map((e) => e.name)).toContain("client/replied");
  });
});

describe("a number shared by several patients", () => {
  async function son(waPhone: string | null = CLIENT_PHONE) {
    const [s] = await db
      .insert(schema.clients)
      .values({ businessId: business.id, waPhone, holderId: waPhone ? clientId : null, name: "Mateo" })
      .returning();
    return s.id;
  }

  it("reminds the holder about a dependent's appointment, and the holder's tap confirms it", async () => {
    vi.setSystemTime(new Date("2026-10-13T16:00:00Z"));
    const a = await appointment(STARTS_AT, BOOKED_AT, await son());
    expect(await reminders.sendReminder(a.id, "reminder")).toMatchObject({ status: "sent" });
    expect(kapso.calls.at(-1)?.body).toMatchObject({ to: CLIENT_PHONE, type: "template" });
    const [stored] = await db.select().from(schema.messages);
    expect(stored.clientId).toBe(clientId);

    const body = { message: { id: "wamid.tap", from: CLIENT_PHONE, type: "button", button: { text: "Confirmar", payload: `confirm:${a.id}` } }, phone_number_id: PHONE_ID };
    const raw = JSON.stringify(body);
    await messagesRoute.POST(
      new Request("https://ikarus.test/api/webhooks/kapso/messages", {
        method: "POST",
        body: raw,
        headers: {
          "x-webhook-event": "whatsapp.message.received",
          "x-idempotency-key": "wamid.tap",
          "x-webhook-signature": createHmac("sha256", "message-secret").update(raw).digest("hex"),
        },
      }),
    );
    expect(await statusOf(a.id)).toBe("confirmed");
    // The holder's reply counts as an answer to the dependent's reminder.
    expect(await reminders.clientRepliedSince(a.id, "2000-01-01T00:00:00Z")).toBe(true);
  });

  it("does not remind a patient with no WhatsApp", async () => {
    const a = await appointment(STARTS_AT, BOOKED_AT, await son(null));
    expect(await reminders.planReminder(a.id)).toMatchObject({ skip: "no_whatsapp" });
  });
});

