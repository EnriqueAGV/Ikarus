import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startFakeKapso } from "./fake-kapso";

const sent = vi.hoisted(() => [] as { name: string; data: unknown }[]);
vi.mock("@/inngest/client", () => ({
  inngest: { send: async (e: { name: string; data: unknown }) => void sent.push(e) },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    auth: {
      admin: {
        createUser: async ({ email }: { email: string }) => ({
          data: { user: { id: crypto.randomUUID(), email } },
          error: null,
        }),
        listUsers: async () => ({ data: { users: [] } }),
      },
    },
  }),
}));

const PHONE_ID = "555000111";
const kapso = await startFakeKapso({
  "POST /meta/whatsapp/v24.0/[^/]+/messages": () => ({
    json: { messaging_product: "whatsapp", messages: [{ id: "wamid.staff" }] },
  }),
});
process.env.KAPSO_API_BASE_URL = kapso.url;

const { db, schema } = await import("@/db");
const { eq, sql } = await import("drizzle-orm");
const settings = await import("@/lib/dashboard/settings");
const dashboard = await import("@/lib/dashboard/appointments");
const team = await import("@/lib/dashboard/team");
const { sendStaffReply } = await import("@/lib/messaging/staff");
const { availableSlots, bookAppointment } = await import("@/lib/booking/service");
const { toConversation } = await import("@/lib/agent/run");

// Monday 12 Oct 2026, 09:00 in Mexico City.
const NOW = new Date("2026-10-12T15:00:00Z");

let business: typeof schema.businesses.$inferSelect;
let clientId: string;

beforeEach(async () => {
  sent.length = 0;
  kapso.calls.length = 0;
  await db.execute(
    sql`truncate webhook_events, messages, appointments, clients, intake_fields, availability_rules, availability_exceptions, services, templates, setup_links, business_members, businesses, profiles cascade`,
  );
  [business] = await db
    .insert(schema.businesses)
    .values({ name: "Estética Luna", status: "connected", phoneNumberId: PHONE_ID })
    .returning();
  [{ id: clientId }] = await db
    .insert(schema.clients)
    .values({ businessId: business.id, waPhone: "5215511112222", name: "Ana" })
    .returning();
});

afterAll(() => kapso.close());

describe("opening hours", () => {
  it("rejects overlapping or inverted ranges on the same day", () => {
    expect(() => settings.validateRanges([{ startTime: "09:00", endTime: "14:00" }, { startTime: "13:00", endTime: "18:00" }])).toThrow("overlap");
    expect(() => settings.validateRanges([{ startTime: "18:00", endTime: "09:00" }])).toThrow("end_before_start");
    expect(() => settings.validateRanges([{ startTime: "9", endTime: "18:00" }])).toThrow("invalid_time");
    expect(() => settings.validateRanges([{ startTime: "09:00", endTime: "14:00" }, { startTime: "14:00", endTime: "18:00" }])).not.toThrow();
  });

  it("replaces the whole week and drives the free slots", async () => {
    const service = await settings.createService(business.id, { name: "Corte", durationMin: 60, bufferMin: 0, active: true });
    await settings.saveWeeklyRules(business.id, [{ weekday: 1, startTime: "08:00", endTime: "20:00" }]);
    await settings.saveWeeklyRules(business.id, [
      { weekday: 1, startTime: "10:00", endTime: "12:00" },
      { weekday: 1, startTime: "16:00", endTime: "17:00" },
    ]);
    expect(await settings.getWeeklyRules(business.id)).toHaveLength(2);

    const slots = await availableSlots(business, service.id, "2026-10-12", "2026-10-12", NOW);
    expect(slots!.map((s) => s.toISOString())).toEqual([
      "2026-10-12T16:00:00.000Z",
      "2026-10-12T16:30:00.000Z",
      "2026-10-12T17:00:00.000Z",
      "2026-10-12T22:00:00.000Z",
    ]);
  });

  it("a closure replaces custom hours for that date, and the reverse", async () => {
    await settings.addException(business.id, { date: "2026-12-24", range: { startTime: "09:00", endTime: "13:00" } });
    await settings.addException(business.id, { date: "2026-12-24", range: null, note: "Nochebuena" });
    let rows = await settings.getExceptions(business.id, "2026-10-01");
    expect(rows).toMatchObject([{ date: "2026-12-24", startTime: null, note: "Nochebuena" }]);

    await settings.addException(business.id, { date: "2026-12-24", range: { startTime: "10:00", endTime: "12:00" } });
    rows = await settings.getExceptions(business.id, "2026-10-01");
    expect(rows).toMatchObject([{ startTime: "10:00:00", endTime: "12:00:00" }]);
  });
});

describe("services and intake", () => {
  it("validates services", async () => {
    await expect(settings.createService(business.id, { name: " ", durationMin: 60, bufferMin: 0, active: true })).rejects.toThrow("name_required");
    await expect(settings.createService(business.id, { name: "X", durationMin: 0, bufferMin: 0, active: true })).rejects.toThrow("invalid_duration");
  });

  it("derives unique keys from labels and keeps them when the label changes", async () => {
    const a = await settings.createIntakeField(business.id, { label: "Fecha de nacimiento", type: "date", options: [], required: true });
    const b = await settings.createIntakeField(business.id, { label: "Fecha de nacimiento", type: "date", options: [], required: false });
    expect([a.key, b.key]).toEqual(["fecha_de_nacimiento", "fecha_de_nacimiento_2"]);
    expect(settings.intakeKey("¿Alergias?")).toBe("alergias");
    expect(settings.intakeKey("Name")).toBe("campo_name");

    await settings.updateIntakeField(business.id, a.id, { label: "Cumpleaños", type: "date", options: [], required: true });
    const [updated] = await db.select().from(schema.intakeFields).where(eq(schema.intakeFields.id, a.id));
    expect(updated).toMatchObject({ key: "fecha_de_nacimiento", label: "Cumpleaños" });
  });

  it("requires options for choice questions and reorders fields", async () => {
    await expect(
      settings.createIntakeField(business.id, { label: "Sucursal", type: "choice", options: ["Centro"], required: true }),
    ).rejects.toThrow("choice_needs_options");
    const a = await settings.createIntakeField(business.id, { label: "Uno", type: "text", options: [], required: true });
    const b = await settings.createIntakeField(business.id, { label: "Dos", type: "text", options: [], required: true });
    await settings.moveIntakeField(business.id, b.id, "up");
    expect((await settings.listIntakeFields(business.id)).map((f) => f.id)).toEqual([b.id, a.id]);
  });

  it("bounds the reminder lead time", async () => {
    await expect(settings.updateBusinessSettings(business.id, { reminderLeadHours: 0, agentInstructions: "" })).rejects.toThrow(
      "invalid_reminder_hours",
    );
    await settings.updateBusinessSettings(business.id, { reminderLeadHours: 48, agentInstructions: "  Llega 10 min antes " });
    const [b] = await db.select().from(schema.businesses).where(eq(schema.businesses.id, business.id));
    expect(b).toMatchObject({ reminderLeadHours: 48, agentInstructions: "Llega 10 min antes" });
  });
});

describe("appointments from the dashboard", () => {
  async function book(localStart: string) {
    const service = await settings.createService(business.id, { name: "Corte", durationMin: 60, bufferMin: 0, active: true });
    await settings.saveWeeklyRules(business.id, [{ weekday: 1, startTime: "09:00", endTime: "18:00" }]);
    const result = await bookAppointment({ business, clientId, serviceId: service.id, localStart, now: NOW });
    if (!result.ok) throw new Error(result.reason);
    return { service, appointment: result.appointment };
  }

  it("cancelling frees the slot and stops reminders", async () => {
    const { service, appointment } = await book("2026-10-12T11:00");
    sent.length = 0;
    const cancelled = await dashboard.updateAppointmentByBusiness(business.id, appointment.id, "cancel", NOW);
    expect(cancelled).toMatchObject({ status: "cancelled_by_business", cancelReason: "business" });
    expect(sent).toEqual([{ name: "appointment/cancelled", data: { appointmentId: appointment.id, businessId: business.id, clientId } }]);
    const again = await bookAppointment({ business, clientId, serviceId: service.id, localStart: "2026-10-12T11:00", now: NOW });
    expect(again.ok).toBe(true);
  });

  it("records outcomes only after the appointment started", async () => {
    const { appointment } = await book("2026-10-12T11:00");
    expect(await dashboard.updateAppointmentByBusiness(business.id, appointment.id, "completed", NOW)).toBeNull();
    const later = new Date("2026-10-12T17:30:00Z");
    expect(await dashboard.updateAppointmentByBusiness(business.id, appointment.id, "no_show", later)).toMatchObject({ status: "no_show" });
  });

  it("ignores appointments of another business", async () => {
    const { appointment } = await book("2026-10-12T11:00");
    const [other] = await db.insert(schema.businesses).values({ name: "Otro" }).returning();
    expect(await dashboard.updateAppointmentByBusiness(other.id, appointment.id, "cancel", NOW)).toBeNull();
  });

  it("lists a day in the business timezone", async () => {
    await book("2026-10-12T17:00"); // 23:00 UTC, still Monday locally
    expect(await dashboard.appointmentsBetween(business, "2026-10-12", "2026-10-13")).toHaveLength(1);
    expect(await dashboard.appointmentsBetween(business, "2026-10-13", "2026-10-14")).toHaveLength(0);
    expect(dashboard.weekStart("2026-10-18")).toBe("2026-10-12");
  });
});

describe("staff replies", () => {
  async function inbound(at: Date) {
    await db.insert(schema.messages).values({ businessId: business.id, clientId, direction: "inbound", type: "text", body: "Hola", createdAt: at });
  }

  it("refuses outside WhatsApp's 24-hour window", async () => {
    await inbound(new Date(NOW.getTime() - 25 * 3600_000));
    const result = await sendStaffReply({ business, clientId, text: "Hola Ana", sentBy: "staff-1", now: NOW });
    expect(result).toEqual({ ok: false, reason: "window_closed" });
    expect(kapso.calls).toHaveLength(0);
  });

  it("sends, pauses the agent, and is labelled for the agent later", async () => {
    await inbound(new Date(NOW.getTime() - 3600_000));
    expect(await sendStaffReply({ business, clientId, text: "Hola Ana, soy Luz", sentBy: "staff-1", now: NOW })).toEqual({ ok: true });
    expect(kapso.calls).toHaveLength(1);
    const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, clientId));
    expect(client.agentPaused).toBe(true);

    const history = await db.select().from(schema.messages).orderBy(schema.messages.createdAt);
    expect(toConversation(history).at(-1)).toEqual({
      role: "assistant",
      content: "[Escrito por el equipo del negocio, no por ti]\nHola Ana, soy Luz",
    });

    await dashboard.setAgentPaused(business.id, clientId, false);
    const [resumed] = await db.select().from(schema.clients).where(eq(schema.clients.id, clientId));
    expect(resumed.agentPaused).toBe(false);
  });
});

describe("team", () => {
  it("invites once and always keeps an owner", async () => {
    expect(await team.inviteMember(business.id, "Duena@Luna.mx", "owner")).toEqual({ added: true });
    expect(await team.inviteMember(business.id, "duena@luna.mx", "owner")).toEqual({ added: false });
    await team.inviteMember(business.id, "luz@luna.mx", "staff");
    const members = await team.listMembers(business.id);
    expect(members.map((m) => [m.email, m.role])).toEqual([
      ["duena@luna.mx", "owner"],
      ["luz@luna.mx", "staff"],
    ]);

    const owner = members.find((m) => m.role === "owner")!;
    await expect(team.removeMember(business.id, owner.memberId)).rejects.toThrow("last_owner");
    await team.removeMember(business.id, members.find((m) => m.role === "staff")!.memberId);
    expect(await team.listMembers(business.id)).toHaveLength(1);
  });
});
