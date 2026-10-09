import { createHmac } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startFakeKapso } from "./fake-kapso";

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
const { runAgent } = await import("@/lib/agent/run");
const messagesRoute = await import("@/app/api/webhooks/kapso/messages/route");

// Monday 12 Oct 2026, 09:00 in Mexico City.
const NOW = new Date("2026-10-12T15:00:00Z");
const CLIENT_PHONE = "5215511112222";

type Step = { tools?: { name: string; input: unknown }[]; text?: string };

// Scripted stand-in for the Messages API: returns the next step on each call
// and records every request.
function fakeClaude(steps: Step[]) {
  const requests: Anthropic.Beta.MessageCreateParamsNonStreaming[] = [];
  let i = 0;
  const create = async (params: Anthropic.Beta.MessageCreateParamsNonStreaming) => {
    requests.push(structuredClone(params));
    const step = steps[i++] ?? { text: "(sin guion)" };
    const content = [
      ...(step.text ? [{ type: "text", text: step.text }] : []),
      ...(step.tools ?? []).map((t, n) => ({ type: "tool_use", id: `tu_${i}_${n}`, name: t.name, input: t.input })),
    ];
    return { content, stop_reason: step.tools?.length ? "tool_use" : "end_turn" };
  };
  return { client: { beta: { messages: { create } } } as unknown as Pick<Anthropic, "beta">, requests };
}

function lastToolResults(req: Anthropic.Beta.MessageCreateParamsNonStreaming) {
  const last = req.messages.at(-1)!;
  return (last.content as Anthropic.Beta.BetaToolResultBlockParam[]).map((r) => ({
    error: r.is_error ?? false,
    content: JSON.parse(JSON.stringify(r.content)),
  }));
}

let business: typeof schema.businesses.$inferSelect;
let serviceId: string;

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
  await db.insert(schema.availabilityRules).values(
    [1, 2, 3, 4, 5].map((weekday) => ({ businessId: business.id, weekday, startTime: "09:00", endTime: "18:00" })),
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

async function theClient() {
  const [c] = await db.select().from(schema.clients);
  return c;
}

describe("inbound messages", () => {
  it("stores the client and message, then queues one agent run", async () => {
    expect((await receive("Hola, quiero una cita")).status).toBe(200);
    const client = await theClient();
    expect(client).toMatchObject({ waPhone: CLIENT_PHONE, name: "Ana", businessId: business.id });
    const msgs = await db.select().from(schema.messages);
    expect(msgs).toMatchObject([{ direction: "inbound", body: "Hola, quiero una cita", clientId: client.id }]);
    expect(sent).toEqual([
      { name: "whatsapp/message.received", data: { businessId: business.id, clientId: client.id } },
    ]);
  });
});

describe("booking agent", () => {
  it("collects intake, books a free slot and replies on WhatsApp", async () => {
    await receive("Hola, soy Ana López, quiero un corte mañana a las 10");
    const client = await theClient();
    const claude = fakeClaude([
      {
        tools: [
          { name: "save_client_info", input: { name: "Ana López", answers: [] } },
          { name: "find_available_slots", input: { service_id: serviceId, date_from: "2026-10-13", date_to: "2026-10-13" } },
        ],
      },
      // Tries to book before the birth date is known: refused.
      { tools: [{ name: "book_appointment", input: { service_id: serviceId, start: "2026-10-13T10:00" } }] },
      { tools: [{ name: "save_client_info", input: { name: null, answers: [{ key: "fecha_nacimiento", value: "1990-05-04" }] } }] },
      { tools: [{ name: "book_appointment", input: { service_id: serviceId, start: "2026-10-13T10:00" } }] },
      { text: "¡Listo, Ana! Te esperamos el martes 13 de octubre a las 10:00." },
    ]);

    const result = await runAgent({ businessId: business.id, clientId: client.id, now: NOW, anthropic: claude.client });
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
    expect(await theClient()).toMatchObject({ name: "Ana López", data: { fecha_nacimiento: "1990-05-04" } });
    expect(sent.at(-1)).toEqual({ name: "appointment/booked", data: { appointmentId: appt.id, businessId: business.id } });

    const send = kapso.calls.find((c) => c.path.endsWith("/messages"));
    expect(send?.path).toBe(`/meta/whatsapp/v24.0/${PHONE_ID}/messages`);
    expect(send?.body).toMatchObject({ to: CLIENT_PHONE, type: "text", text: { body: result.status === "replied" ? result.reply : "" } });

    // Request shape: Spanish system prompt on a cached block, history from WhatsApp.
    const req = claude.requests[0];
    expect(req.model).toBe("claude-opus-5-5");
    expect(req.fallbacks).toBe("default");
    expect(JSON.stringify(req.system)).toContain("Always reply in Spanish");
    expect(req.messages[0]).toEqual({ role: "user", content: "Hola, soy Ana López, quiero un corte mañana a las 10" });
    const out = await db.select().from(schema.messages).where(eq(schema.messages.direction, "outbound"));
    expect(out).toHaveLength(1);
  });

  it("never books a taken or closed time", async () => {
    await receive("Quiero el martes a las 10");
    const client = await theClient();
    await db.update(schema.clients).set({ data: { fecha_nacimiento: "1990-05-04" } });
    await db.insert(schema.appointments).values({
      businessId: business.id,
      clientId: client.id,
      serviceId,
      startsAt: new Date("2026-10-13T16:30:00Z"),
      endsAt: new Date("2026-10-13T17:30:00Z"),
    });
    const claude = fakeClaude([
      {
        tools: [
          { name: "book_appointment", input: { service_id: serviceId, start: "2026-10-13T10:00" } },
          { name: "book_appointment", input: { service_id: serviceId, start: "2026-10-17T10:00" } }, // Saturday
        ],
      },
      { text: "Esa hora ya no está disponible." },
    ]);
    await runAgent({ businessId: business.id, clientId: client.id, now: NOW, anthropic: claude.client });
    const results = lastToolResults(claude.requests[1]);
    expect(results.every((r) => r.error && String(r.content).includes("not available"))).toBe(true);
    expect(await db.select().from(schema.appointments)).toHaveLength(1);
  });

  it("reschedules, keeping the original when the new time is taken", async () => {
    await receive("¿Puedo cambiar mi cita?");
    const client = await theClient();
    const [mine] = await db
      .insert(schema.appointments)
      .values({ businessId: business.id, clientId: client.id, serviceId, startsAt: new Date("2026-10-13T16:00:00Z"), endsAt: new Date("2026-10-13T17:00:00Z") })
      .returning();
    const [otherClient] = await db.insert(schema.clients).values({ businessId: business.id, waPhone: "5210000000000" }).returning();
    await db.insert(schema.appointments).values({
      businessId: business.id,
      clientId: otherClient.id,
      serviceId,
      startsAt: new Date("2026-10-14T16:00:00Z"),
      endsAt: new Date("2026-10-14T17:00:00Z"),
    });

    const claude = fakeClaude([
      { tools: [{ name: "reschedule_appointment", input: { appointment_id: mine.id, new_start: "2026-10-14T10:00" } }] },
      // Moving into its own slot's neighbourhood works: the old slot is released first.
      { tools: [{ name: "reschedule_appointment", input: { appointment_id: mine.id, new_start: "2026-10-13T10:30" } }] },
      { text: "Listo, quedó a las 10:30." },
    ]);
    await runAgent({ businessId: business.id, clientId: client.id, now: NOW, anthropic: claude.client });

    expect(lastToolResults(claude.requests[1])[0].error).toBe(true);
    expect(lastToolResults(claude.requests[2])[0].error).toBe(false);
    const rows = await db.select().from(schema.appointments).where(eq(schema.appointments.clientId, client.id));
    const live = rows.filter((r) => r.status === "booked");
    expect(live).toHaveLength(1);
    expect(live[0].startsAt.toISOString()).toBe("2026-10-13T16:30:00.000Z");
    expect(live[0].rescheduledFromId).toBe(mine.id);
    expect(rows.find((r) => r.id === mine.id)?.status).toBe("cancelled_by_client");
  });

  it("only cancels the client's own appointments", async () => {
    await receive("Cancela la cita");
    const client = await theClient();
    const [other] = await db.insert(schema.clients).values({ businessId: business.id, waPhone: "5210000000000" }).returning();
    const [theirs] = await db
      .insert(schema.appointments)
      .values({ businessId: business.id, clientId: other.id, serviceId, startsAt: new Date("2026-10-13T16:00:00Z"), endsAt: new Date("2026-10-13T17:00:00Z") })
      .returning();
    const claude = fakeClaude([
      { tools: [{ name: "cancel_appointment", input: { appointment_id: theirs.id } }] },
      { text: "No encuentro esa cita." },
    ]);
    await runAgent({ businessId: business.id, clientId: client.id, now: NOW, anthropic: claude.client });
    expect(lastToolResults(claude.requests[1])[0].error).toBe(true);
    const [row] = await db.select().from(schema.appointments).where(eq(schema.appointments.id, theirs.id));
    expect(row.status).toBe("booked");
  });

  it("stops answering after a handoff, and skips messages already answered", async () => {
    await receive("Quiero hablar con una persona");
    const client = await theClient();
    const claude = fakeClaude([
      { tools: [{ name: "handoff_to_business", input: { reason: "pide un humano" } }] },
      { text: "Claro, alguien del equipo te escribe en breve." },
    ]);
    await runAgent({ businessId: business.id, clientId: client.id, now: NOW, anthropic: claude.client });
    expect(await runAgent({ businessId: business.id, clientId: client.id, now: NOW, anthropic: claude.client })).toEqual({
      status: "skipped",
      reason: "paused",
    });

    await db.update(schema.clients).set({ agentPaused: false });
    expect(await runAgent({ businessId: business.id, clientId: client.id, now: NOW, anthropic: claude.client })).toEqual({
      status: "skipped",
      reason: "already_answered",
    });
  });
});
