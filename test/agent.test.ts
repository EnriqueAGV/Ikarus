import { createHmac } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startFakeKapso } from "./fake-kapso";
import type { ChatClient, ChatRequest } from "@/lib/agent/llm";

const sent = vi.hoisted(() => [] as { name: string; data: unknown }[]);
vi.mock("@/inngest/client", () => ({
  inngest: {
    send: async (e: { name: string; data: unknown } | { name: string; data: unknown }[]) => {
      sent.push(...(Array.isArray(e) ? e : [e]));
    },
  },
}));

const PHONE_ID = "555000111";
const kapso = await startFakeKapso({
  "POST /meta/whatsapp/v24.0/[^/]+/messages": () => ({
    json: { messaging_product: "whatsapp", messages: [{ id: `wamid.out.${Math.random()}` }] },
  }),
});
process.env.KAPSO_API_BASE_URL = kapso.url;

const { db, schema } = await import("@/db");
const { eq, sql } = await import("drizzle-orm");
const { apologizeAndHandOff, runAgent } = await import("@/lib/agent/run");
const { NOTICE_VERSION } = await import("@/lib/agent/consent");
const { createPractitioner } = await import("@/lib/booking/practitioners");
const messagesRoute = await import("@/app/api/webhooks/kapso/messages/route");

// Monday 12 Oct 2026, 09:00 in Mexico City.
const NOW = new Date("2026-10-12T15:00:00Z");
const CLIENT_PHONE = "5215511112222";

type Step = { tools?: { name: string; input: unknown }[]; text?: string };
// A step can be computed when it is reached, e.g. to use an id a tool just created.
type ScriptedStep = Step | (() => Promise<Step>);

// Scripted stand-in for an OpenAI-compatible endpoint: returns the next step
// on each call and records every request.
function fakeLlm(steps: ScriptedStep[]) {
  const requests: ChatRequest[] = [];
  let i = 0;
  const complete = async (req: ChatRequest) => {
    requests.push(structuredClone(req));
    const next = steps[i++] ?? { text: "(sin guion)" };
    const step = typeof next === "function" ? await next() : next;
    const tool_calls = (step.tools ?? []).map((t, n) => ({
      id: `call_${i}_${n}`,
      type: "function" as const,
      function: { name: t.name, arguments: JSON.stringify(t.input) },
    }));
    return {
      message: { content: step.text ?? null, ...(tool_calls.length ? { tool_calls } : {}) },
      finishReason: tool_calls.length ? "tool_calls" : "stop",
    };
  };
  return { client: { complete } satisfies ChatClient, requests };
}

const isTyping = (body: unknown) => typeof body === "object" && body !== null && "typing_indicator" in body;

// Results of the last batch of tool calls, the trailing "tool" messages.
function lastToolResults(req: ChatRequest) {
  const results: { error: boolean; content: string }[] = [];
  for (let k = req.messages.length - 1; k >= 0 && req.messages[k].role === "tool"; k--) {
    const content = String(req.messages[k].content);
    results.unshift({ error: content.startsWith("Error: "), content: content.replace(/^Error: /, "") });
  }
  return results;
}

let business: typeof schema.businesses.$inferSelect;
let serviceId: string;
let practitionerId: string;

beforeEach(async () => {
  kapso.calls.length = 0;
  sent.length = 0;
  await db.execute(
    sql`truncate webhook_events, messages, appointments, clients, intake_fields, availability_rules, availability_exceptions, services, templates, setup_links, business_members, businesses, profiles cascade`,
  );
  [business] = await db
    .insert(schema.businesses)
    .values({ name: "Estética Luna", status: "connected", phoneNumberId: PHONE_ID, timezone: "America/Mexico_City" })
    .returning();
  [{ id: serviceId }] = await db
    .insert(schema.services)
    .values({ businessId: business.id, name: "Corte de cabello", durationMin: 60 })
    .returning();
  ({ id: practitionerId } = await createPractitioner(business.id, { displayName: "Dra. Ana Ruiz" }));
  await db.insert(schema.availabilityRules).values(
    [1, 2, 3, 4, 5].map((weekday) => ({ businessId: business.id, practitionerId, weekday, startTime: "09:00", endTime: "18:00" })),
  );
  await db.insert(schema.intakeFields).values({
    businessId: business.id,
    key: "fecha_nacimiento",
    label: "Fecha de nacimiento",
    type: "date",
    required: true,
  });
});

afterAll(() => kapso.close());

async function receive(text: string, id = `wamid.in.${Math.random()}`) {
  const body = {
    message: { id, from: CLIENT_PHONE, type: "text", text: { body: text }, kapso: { origin: "cloud_api" } },
    conversation: { phone_number: `+${CLIENT_PHONE}`, contact_name: "Ana" },
    phone_number_id: PHONE_ID,
  };
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

// Booking tests start from a patient who already accepted the privacy notice.
async function theClient({ consented = true } = {}) {
  const [c] = await db.select().from(schema.clients);
  if (consented) {
    await db
      .insert(schema.consents)
      .values({ businessId: c.businessId, clientId: c.id, noticeVersion: NOTICE_VERSION })
      .onConflictDoNothing();
  }
  return c;
}

async function tap(id: string, title: string) {
  const body = {
    message: {
      id: `wamid.tap.${Math.random()}`,
      from: CLIENT_PHONE,
      type: "interactive",
      interactive: { type: "button_reply", button_reply: { id, title } },
      kapso: { origin: "cloud_api" },
    },
    conversation: { phone_number: `+${CLIENT_PHONE}`, contact_name: "Ana" },
    phone_number_id: PHONE_ID,
  };
  const raw = JSON.stringify(body);
  return messagesRoute.POST(
    new Request("https://ikarus.test/api/webhooks/kapso/messages", {
      method: "POST",
      body: raw,
      headers: {
        "x-webhook-event": "whatsapp.message.received",
        "x-idempotency-key": body.message.id,
        "x-webhook-signature": createHmac("sha256", "message-secret").update(raw).digest("hex"),
      },
    }),
  );
}

describe("inbound messages", () => {
  it("stores the client and message, then queues one agent run and stops reminders", async () => {
    expect((await receive("Hola, quiero una cita")).status).toBe(200);
    const client = await theClient();
    expect(client).toMatchObject({ waPhone: CLIENT_PHONE, name: "Ana", businessId: business.id });
    const msgs = await db.select().from(schema.messages);
    expect(msgs).toMatchObject([{ direction: "inbound", body: "Hola, quiero una cita", clientId: client.id }]);
    expect(sent).toEqual([
      { name: "whatsapp/message.received", data: { businessId: business.id, clientId: client.id } },
      { name: "client/replied", data: { businessId: business.id, clientId: client.id } },
    ]);
  });
});

describe("booking agent", () => {
  it("collects intake, books a free slot and replies on WhatsApp", async () => {
    await receive("Hola, soy Ana López, quiero un corte mañana a las 10");
    const client = await theClient();
    const claude = fakeLlm([
      {
        tools: [
          { name: "save_client_info", input: { name: "Ana López", dui: "01234567 8", answers: [] } },
          { name: "find_available_slots", input: { service_id: serviceId, date_from: "2026-10-13", date_to: "2026-10-13" } },
        ],
      },
      // Tries to book before the birth date is known: refused.
      { tools: [{ name: "book_appointment", input: { service_id: serviceId, start: "2026-10-13T10:00" } }] },
      { tools: [{ name: "save_client_info", input: { name: null, answers: [{ key: "fecha_nacimiento", value: "1990-05-04" }] } }] },
      { tools: [{ name: "book_appointment", input: { service_id: serviceId, start: "2026-10-13T10:00" } }] },
      { text: "¡Listo, Ana! Te esperamos el martes 13 de octubre a las 10:00." },
    ]);

    const result = await runAgent({ businessId: business.id, clientId: client.id, now: NOW, llm: claude.client });
    expect(result).toEqual({ status: "replied", reply: "¡Listo, Ana! Te esperamos el martes 13 de octubre a las 10:00." });

    // Slots offered are real local times.
    const slots = lastToolResults(claude.requests[1]);
    expect(slots[1].content).toContain('"local":"2026-10-13T10:00"');
    expect(slots[1].content).toContain("martes 13 de octubre, 10:00");
    // Booking was refused until intake was complete.
    expect(lastToolResults(claude.requests[2])[0]).toEqual({ error: true, content: "Collect these first: fecha_nacimiento" });
    expect(lastToolResults(claude.requests[4])[0].error).toBe(false);

    const [appt] = await db.select().from(schema.appointments);
    expect(appt).toMatchObject({ clientId: client.id, serviceId, status: "booked" });
    expect(appt.startsAt.toISOString()).toBe("2026-10-13T16:00:00.000Z");
    // The birth date also lands in the record header.
    expect(await theClient()).toMatchObject({ name: "Ana López", dui: "01234567-8", data: { fecha_nacimiento: "1990-05-04" }, dateOfBirth: "1990-05-04" });
    expect(sent.at(-1)).toEqual({ name: "appointment/booked", data: { appointmentId: appt.id, businessId: business.id, clientId: appt.clientId } });

    // "escribiendo…" shows on the patient's message first, once for a quick run.
    const [inbound] = await db.select().from(schema.messages).where(eq(schema.messages.direction, "inbound"));
    const typing = kapso.calls.filter((c) => isTyping(c.body));
    expect(typing).toHaveLength(1);
    expect(typing[0].body).toEqual({ messaging_product: "whatsapp", status: "read", message_id: inbound.kapsoMessageId, typing_indicator: { type: "text" } });
    expect(isTyping(kapso.calls[0].body)).toBe(true);
    const send = kapso.calls.find((c) => c.path.endsWith("/messages") && !isTyping(c.body));
    expect(send?.path).toBe(`/meta/whatsapp/v24.0/${PHONE_ID}/messages`);
    expect(send?.body).toMatchObject({ to: CLIENT_PHONE, type: "text", text: { body: result.status === "replied" ? result.reply : "" } });

    // Request shape: configured model, Spanish system prompt, history from WhatsApp.
    const req = claude.requests[0];
    expect(req.model).toBe("test-model");
    expect(req.tools.map((t) => t.function.name)).toContain("book_appointment");
    expect(req.messages[0]).toMatchObject({ role: "system" });
    expect(String(req.messages[0].content)).toContain("Always reply in Spanish");
    // A solo practice never hears about choosing a doctor.
    expect(String(req.messages[0].content)).not.toContain("Doctors at this clinic");
    expect(req.messages[1]).toEqual({ role: "user", content: "Hola, soy Ana López, quiero un corte mañana a las 10" });
    const out = await db.select().from(schema.messages).where(eq(schema.messages.direction, "outbound"));
    expect(out).toHaveLength(1);
  });

  it("offers the earliest times over a few days without asking for a date", async () => {
    await receive("Hola, quiero una cita");
    const client = await theClient();
    const claude = fakeLlm([
      { tools: [{ name: "find_available_slots", input: { service_id: serviceId, date_from: null, date_to: null } }] },
      { text: "Tengo estos horarios: …" },
    ]);
    await runAgent({ businessId: business.id, clientId: client.id, now: NOW, llm: claude.client });

    const [result] = lastToolResults(claude.requests[1]);
    expect(result.error).toBe(false);
    const { suggested, total } = JSON.parse(result.content) as { suggested: { local: string }[]; total: number };
    // Two per day on the next three open days, starting now, from a 7-day search.
    expect(suggested.map((s) => s.local)).toEqual([
      "2026-10-12T10:00",
      "2026-10-12T10:30",
      "2026-10-13T09:00",
      "2026-10-13T09:30",
      "2026-10-14T09:00",
      "2026-10-14T09:30",
    ]);
    expect(total).toBeGreaterThan(40);
    // The prompt tells the agent to offer them instead of asking when.
    expect(String(claude.requests[0].messages[0].content)).toContain("Don't ask when they would like to come");
  });

  it("asks an adult for their DUI before booking, and rejects a malformed one", async () => {
    await receive("Soy Ana López, quiero una cita");
    const client = await theClient();
    await db.update(schema.clients).set({ data: { fecha_nacimiento: "1990-05-04" } });
    const claude = fakeLlm([
      { tools: [{ name: "save_client_info", input: { name: "Ana López", dui: "1234", answers: [] } }] },
      { tools: [{ name: "book_appointment", input: { service_id: serviceId, start: "2026-10-13T10:00" } }] },
      { text: "¿Me confirma su DUI?" },
    ]);
    await runAgent({ businessId: business.id, clientId: client.id, now: NOW, llm: claude.client });

    const [saved] = lastToolResults(claude.requests[1]);
    expect(saved.error).toBe(true);
    expect(saved.content).toContain("dui: a DUI has 9 digits");
    expect(lastToolResults(claude.requests[2])[0]).toEqual({ error: true, content: "Collect these first: dui" });
    expect(await db.select().from(schema.appointments)).toHaveLength(0);
    // The prompt puts the name and DUI first.
    expect(String(claude.requests[0].messages[0].content)).toContain("your first message asks for their full name and their DUI");
  });

  it("never books a taken or closed time", async () => {
    await receive("Quiero el martes a las 10");
    const client = await theClient();
    await db.update(schema.clients).set({ dui: "01234567-8", data: { fecha_nacimiento: "1990-05-04" } });
    await db.insert(schema.appointments).values({
      businessId: business.id,
      clientId: client.id,
      serviceId,
      practitionerId,
      startsAt: new Date("2026-10-13T16:30:00Z"),
      endsAt: new Date("2026-10-13T17:30:00Z"),
    });
    const claude = fakeLlm([
      {
        tools: [
          { name: "book_appointment", input: { service_id: serviceId, start: "2026-10-13T10:00" } },
          { name: "book_appointment", input: { service_id: serviceId, start: "2026-10-17T10:00" } }, // Saturday
        ],
      },
      { text: "Esa hora ya no está disponible." },
    ]);
    await runAgent({ businessId: business.id, clientId: client.id, now: NOW, llm: claude.client });
    const results = lastToolResults(claude.requests[1]);
    expect(results.every((r) => r.error && String(r.content).includes("not available"))).toBe(true);
    expect(await db.select().from(schema.appointments)).toHaveLength(1);
  });

  it("reschedules, keeping the original when the new time is taken", async () => {
    await receive("¿Puedo cambiar mi cita?");
    const client = await theClient();
    const [mine] = await db
      .insert(schema.appointments)
      .values({ businessId: business.id, clientId: client.id, serviceId, practitionerId, startsAt: new Date("2026-10-13T16:00:00Z"), endsAt: new Date("2026-10-13T17:00:00Z") })
      .returning();
    const [otherClient] = await db.insert(schema.clients).values({ businessId: business.id, waPhone: "5210000000000" }).returning();
    await db.insert(schema.appointments).values({
      businessId: business.id,
      clientId: otherClient.id,
      serviceId,
      practitionerId,
      startsAt: new Date("2026-10-14T16:00:00Z"),
      endsAt: new Date("2026-10-14T17:00:00Z"),
    });

    const claude = fakeLlm([
      { tools: [{ name: "reschedule_appointment", input: { appointment_id: mine.id, new_start: "2026-10-14T10:00" } }] },
      // Moving into its own slot's neighbourhood works: the old slot is released first.
      { tools: [{ name: "reschedule_appointment", input: { appointment_id: mine.id, new_start: "2026-10-13T10:30" } }] },
      { text: "Listo, quedó a las 10:30." },
    ]);
    await runAgent({ businessId: business.id, clientId: client.id, now: NOW, llm: claude.client });

    expect(lastToolResults(claude.requests[1])[0].error).toBe(true);
    expect(lastToolResults(claude.requests[2])[0].error).toBe(false);
    const rows = await db.select().from(schema.appointments).where(eq(schema.appointments.clientId, client.id));
    const live = rows.filter((r) => r.status === "booked");
    expect(live).toHaveLength(1);
    expect(live[0].startsAt.toISOString()).toBe("2026-10-13T16:30:00.000Z");
    expect(live[0].rescheduledFromId).toBe(mine.id);
    expect(rows.find((r) => r.id === mine.id)?.status).toBe("cancelled_by_client");
  });

  it("books with a chosen doctor when the clinic has several", async () => {
    const { id: secondId } = await createPractitioner(business.id, { displayName: "Dr. Luis Pérez", specialty: "Pediatría" });
    await db.insert(schema.availabilityRules).values({ businessId: business.id, practitionerId: secondId, weekday: 2, startTime: "09:00", endTime: "12:00" });
    await receive("Quiero cita con el Dr. Pérez el martes a las 10");
    const client = await theClient();
    await db.update(schema.clients).set({ dui: "01234567-8", data: { fecha_nacimiento: "1990-05-04" } });
    const claude = fakeLlm([
      { tools: [{ name: "list_practitioners", input: {} }] },
      {
        tools: [
          {
            name: "find_available_slots",
            input: { service_id: serviceId, date_from: "2026-10-13", date_to: "2026-10-13", practitioner_id: secondId },
          },
        ],
      },
      { tools: [{ name: "book_appointment", input: { service_id: serviceId, start: "2026-10-13T10:00", practitioner_id: secondId } }] },
      { text: "Listo, con el Dr. Pérez el martes a las 10:00." },
    ]);
    await runAgent({ businessId: business.id, clientId: client.id, now: NOW, llm: claude.client });

    expect(String(claude.requests[0].messages[0].content)).toContain(`Dr. Luis Pérez (Pediatría): id ${secondId}`);
    const listed = JSON.parse(lastToolResults(claude.requests[1])[0].content);
    expect(listed).toEqual([
      { id: practitionerId, name: "Dra. Ana Ruiz", specialty: null, service_ids: [serviceId] },
      { id: secondId, name: "Dr. Luis Pérez", specialty: "Pediatría", service_ids: [serviceId] },
    ]);
    const slots = JSON.parse(lastToolResults(claude.requests[2])[0].content);
    expect(slots.total).toBe(5);
    expect(slots.slots[0]).toMatchObject({ local: "2026-10-13T09:00", practitioner_id: secondId, practitioner: "Dr. Luis Pérez" });
    const [appt] = await db.select().from(schema.appointments);
    expect(appt).toMatchObject({ practitionerId: secondId, status: "booked" });
  });

  it("answers an emergency with the fixed reply and hands off, without the LLM", async () => {
    await receive("Buenas, mi papá tiene dolor de pecho y le cuesta respirar");
    const client = await theClient();
    const claude = fakeLlm([{ text: "no debería llamarse" }]);
    // Message times come from the database clock here, so the run uses it too.
    expect(await runAgent({ businessId: business.id, clientId: client.id, now: new Date(), llm: claude.client })).toEqual({
      status: "emergency",
      replied: true,
    });
    expect(claude.requests).toHaveLength(0);
    expect(await theClient()).toMatchObject({ agentPaused: true });
    const send = kapso.calls.find((c) => c.path.endsWith("/messages") && !isTyping(c.body));
    expect(send?.body).toMatchObject({ text: { body: expect.stringContaining("911") } });

    // A paused patient still gets it, but not again within half an hour.
    await receive("Sigue igual, se desmayó");
    expect(await runAgent({ businessId: business.id, clientId: client.id, now: new Date(Date.now() + 60_000), llm: claude.client })).toEqual({
      status: "emergency",
      replied: false,
    });
    expect(kapso.calls.filter((c) => c.path.endsWith("/messages") && !isTyping(c.body))).toHaveLength(1);
  });

  it("only cancels the client's own appointments", async () => {
    await receive("Cancela la cita");
    const client = await theClient();
    const [other] = await db.insert(schema.clients).values({ businessId: business.id, waPhone: "5210000000000" }).returning();
    const [theirs] = await db
      .insert(schema.appointments)
      .values({ businessId: business.id, clientId: other.id, serviceId, practitionerId, startsAt: new Date("2026-10-13T16:00:00Z"), endsAt: new Date("2026-10-13T17:00:00Z") })
      .returning();
    const claude = fakeLlm([
      { tools: [{ name: "cancel_appointment", input: { appointment_id: theirs.id } }] },
      { text: "No encuentro esa cita." },
    ]);
    await runAgent({ businessId: business.id, clientId: client.id, now: NOW, llm: claude.client });
    expect(lastToolResults(claude.requests[1])[0].error).toBe(true);
    const [row] = await db.select().from(schema.appointments).where(eq(schema.appointments.id, theirs.id));
    expect(row.status).toBe("booked");
  });

  it("stops answering after a handoff, and skips messages already answered", async () => {
    await receive("Quiero hablar con una persona");
    const client = await theClient();
    const claude = fakeLlm([
      { tools: [{ name: "handoff_to_business", input: { reason: "pide un humano" } }] },
      { text: "Claro, alguien del equipo te escribe en breve." },
    ]);
    await runAgent({ businessId: business.id, clientId: client.id, now: NOW, llm: claude.client });
    expect(await runAgent({ businessId: business.id, clientId: client.id, now: NOW, llm: claude.client })).toEqual({
      status: "skipped",
      reason: "paused",
    });

    await db.update(schema.clients).set({ agentPaused: false });
    expect(await runAgent({ businessId: business.id, clientId: client.id, now: NOW, llm: claude.client })).toEqual({
      status: "skipped",
      reason: "already_answered",
    });
  });
});

describe("when the agent can't answer", () => {
  it("sends the holding reply once and hands the conversation to the team", async () => {
    await receive("Si");
    const client = await theClient();
    await apologizeAndHandOff(business.id, client.id);
    await apologizeAndHandOff(business.id, client.id);
    const sends = kapso.calls.filter((c) => c.path.endsWith("/messages") && !isTyping(c.body));
    expect(sends).toHaveLength(1);
    expect(sends[0].body).toMatchObject({ to: CLIENT_PHONE, text: { body: "Gracias por su mensaje. En un momento alguien del consultorio le responde." } });
    expect((await theClient()).agentPaused).toBe(true);
  });
});

describe("several patients on one number", () => {
  it("adds the writer's son and books for him, sending to the mother's number", async () => {
    await receive("Hola, quiero cita para mi hijo mañana a las 10");
    const mother = await theClient();
    await db.update(schema.clients).set({ data: { fecha_nacimiento: "1990-05-04" } }).where(eq(schema.clients.id, mother.id));
    const sonOf = async () => (await db.select().from(schema.clients).where(eq(schema.clients.holderId, mother.id)))[0];
    const claude = fakeLlm([
      { tools: [{ name: "add_patient", input: { name: "Mateo López" } }] },
      async () => {
        const son = await sonOf();
        return {
          tools: [
            { name: "save_client_info", input: { patient_id: son.id, name: null, answers: [{ key: "fecha_nacimiento", value: "2018-03-01" }] } },
            { name: "book_appointment", input: { patient_id: son.id, service_id: serviceId, start: "2026-10-13T10:00" } },
          ],
        };
      },
      { text: "Listo, Mateo queda agendado el martes 13 a las 10:00." },
    ]);
    await runAgent({ businessId: business.id, clientId: mother.id, now: NOW, llm: claude.client });

    const [son] = await db.select().from(schema.clients).where(eq(schema.clients.holderId, mother.id));
    expect(son).toMatchObject({ name: "Mateo López", waPhone: CLIENT_PHONE, dateOfBirth: "2018-03-01" });
    expect(lastToolResults(claude.requests[1])[0].content).toContain(son.id);
    const [appt] = await db.select().from(schema.appointments);
    expect(appt).toMatchObject({ clientId: son.id, status: "booked" });
    // Reminders for the son go through the mother's conversation.
    expect(sent.at(-1)).toEqual({ name: "appointment/booked", data: { appointmentId: appt.id, businessId: business.id, clientId: mother.id } });
    const send = kapso.calls.find((c) => c.path.endsWith("/messages") && !isTyping(c.body));
    expect(send?.body).toMatchObject({ to: CLIENT_PHONE });
    // The prompt tells the model to ask who the appointment is for.
    expect(String(claude.requests[0].messages[0].content)).toContain("¿La cita es para usted o para otra persona?");

    // The next turn lists both patients and the son's appointment under his name.
    const next = fakeLlm([{ tools: [{ name: "list_my_appointments", input: {} }] }, { text: "Tiene una cita." }]);
    await receive("¿Qué citas tengo?");
    await runAgent({ businessId: business.id, clientId: mother.id, now: NOW, llm: next.client });
    const context = next.requests[0].messages.map((m) => String(m.content)).join("\n");
    expect(context).toContain(`patient_id ${mother.id} (the person writing): Ana;`);
    expect(context).toContain(`patient_id ${son.id}: Mateo López`);
    expect(context).toMatch(/Mateo López, Corte de cabello/);
    expect(lastToolResults(next.requests[1])[0].content).toContain('"patient":"Mateo López"');
  });

  it("refuses a patient_id from another number and never runs for a dependent", async () => {
    await receive("Hola");
    const mother = await theClient();
    const [stranger] = await db.insert(schema.clients).values({ businessId: business.id, waPhone: "5210000000000", name: "Otra" }).returning();
    const claude = fakeLlm([
      { tools: [{ name: "save_client_info", input: { patient_id: stranger.id, name: "Cambiado", answers: [] } }] },
      { text: "¿Para quién es la cita?" },
    ]);
    await runAgent({ businessId: business.id, clientId: mother.id, now: NOW, llm: claude.client });
    expect(lastToolResults(claude.requests[1])[0].error).toBe(true);
    const [unchanged] = await db.select().from(schema.clients).where(eq(schema.clients.id, stranger.id));
    expect(unchanged.name).toBe("Otra");

    const [son] = await db.insert(schema.clients).values({ businessId: business.id, waPhone: CLIENT_PHONE, holderId: mother.id, name: "Mateo" }).returning();
    expect(await runAgent({ businessId: business.id, clientId: son.id, now: NOW, llm: fakeLlm([]).client })).toMatchObject({ status: "skipped" });

    // A new message from the number still lands on the mother.
    await receive("Otra pregunta");
    const msgs = await db.select().from(schema.messages).where(eq(schema.messages.direction, "inbound"));
    expect(new Set(msgs.map((m) => m.clientId))).toEqual(new Set([mother.id]));
  });
});

describe("consent", () => {
  it("asks once for the privacy notice and waits for Acepto before the LLM", async () => {
    await receive("Hola, quiero una cita");
    await receive("¿Tienen el martes?");
    const client = await theClient({ consented: false });
    const claude = fakeLlm([{ text: "Con gusto. ¿Me dice su nombre completo?" }]);
    const run = () => runAgent({ businessId: business.id, clientId: client.id, now: new Date(), llm: claude.client });

    expect(await run()).toEqual({ status: "consent_requested" });
    expect(claude.requests).toHaveLength(0);
    const ask = kapso.calls.find((c) => c.path.endsWith("/messages") && !isTyping(c.body));
    expect(ask?.body).toMatchObject({
      type: "interactive",
      interactive: { type: "button", action: { buttons: [{ type: "reply", reply: { id: "consent:accept", title: "Acepto" } }] } },
    });
    expect(JSON.stringify(ask?.body)).toContain(`/privacidad/${business.id}`);
    // Both messages of the burst are covered by one request.
    expect(await run()).toEqual({ status: "skipped", reason: "already_answered" });

    // Anything but an acceptance gets the request again.
    await receive("¿Y cuánto cuesta?");
    expect(await run()).toEqual({ status: "consent_requested" });
    expect(await db.select().from(schema.consents)).toHaveLength(0);

    await tap("consent:accept", "Acepto");
    expect(await run()).toEqual({ status: "replied", reply: "Con gusto. ¿Me dice su nombre completo?" });
    const [consent] = await db.select().from(schema.consents);
    const [accepted] = await db.select().from(schema.messages).where(eq(schema.messages.id, consent.messageId!));
    expect(consent).toMatchObject({ clientId: client.id, noticeVersion: NOTICE_VERSION });
    expect(accepted).toMatchObject({ direction: "inbound", body: "Acepto" });
  });

  it("accepts a typed ACEPTO only after the notice was shown", async () => {
    await receive("Acepto");
    const client = await theClient({ consented: false });
    const claude = fakeLlm([{ text: "Gracias. ¿En qué le ayudo?" }]);
    const run = () => runAgent({ businessId: business.id, clientId: client.id, now: new Date(), llm: claude.client });
    expect(await run()).toEqual({ status: "consent_requested" });
    await receive("Sí, acepto.");
    expect(await run()).toEqual({ status: "replied", reply: "Gracias. ¿En qué le ayudo?" });
    expect(await db.select().from(schema.consents)).toHaveLength(1);
  });

  it("still answers an emergency before consent", async () => {
    await receive("Mi papá tiene dolor de pecho");
    const client = await theClient({ consented: false });
    const claude = fakeLlm([]);
    expect(await runAgent({ businessId: business.id, clientId: client.id, now: new Date(), llm: claude.client })).toEqual({
      status: "emergency",
      replied: true,
    });
  });
});
