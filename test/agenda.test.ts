import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startFakeKapso } from "./fake-kapso";

const sent = vi.hoisted(() => [] as { name: string; data: unknown }[]);
vi.mock("@/inngest/client", () => ({
  inngest: { send: async (e: { name: string; data: unknown }) => void sent.push(e) },
}));

const PHONE_ID = "555000111";
const kapso = await startFakeKapso({
  "POST /meta/whatsapp/v24.0/[^/]+/messages": () => ({
    json: { messaging_product: "whatsapp", messages: [{ id: `wamid.${Math.random()}` }] },
  }),
});
process.env.KAPSO_API_BASE_URL = kapso.url;

const { db, schema } = await import("@/db");
const { eq, sql } = await import("drizzle-orm");
const settings = await import("@/lib/dashboard/settings");
const agenda = await import("@/lib/dashboard/agenda");
const { availableSlots, bookAppointment } = await import("@/lib/booking/service");
const { createPractitioner } = await import("@/lib/booking/practitioners");

// Monday 12 Oct 2026, 09:00 in Mexico City.
const NOW = new Date("2026-10-12T15:00:00Z");
const DAY = "2026-10-13";
const PHONE = "50370001111";

let business: typeof schema.businesses.$inferSelect;
let clientId: string;
let doctorId: string;
let serviceId: string;

const slotsOn = async (date = DAY, practitionerId?: string) =>
  (await availableSlots(business, { serviceId, fromDate: date, toDate: date, practitionerId, now: NOW }))!.map((s) =>
    s.startsAt.toISOString(),
  );
const templateSends = () =>
  kapso.calls.filter((c) => (c.body as { type?: string } | undefined)?.type === "template");
const approve = (name: string) => db.insert(schema.templates).values({ businessId: business.id, name, status: "APPROVED" });

beforeEach(async () => {
  sent.length = 0;
  kapso.calls.length = 0;
  await db.execute(
    sql`truncate webhook_events, messages, appointments, clients, intake_fields, availability_rules, availability_exceptions, services, templates, setup_links, business_members, businesses, profiles cascade`,
  );
  [business] = await db
    .insert(schema.businesses)
    .values({ name: "Clínica Luna", status: "connected", phoneNumberId: PHONE_ID, timezone: "America/Mexico_City" })
    .returning();
  [{ id: clientId }] = await db
    .insert(schema.clients)
    .values({ businessId: business.id, waPhone: PHONE, name: "Ana" })
    .returning();
  ({ id: doctorId } = await createPractitioner(business.id, { displayName: "Dra. Ruiz" }));
  ({ id: serviceId } = await settings.createService(business.id, { name: "Consulta", durationMin: 60, bufferMin: 0, active: true }));
  // Tuesdays 10:00–13:00 local (16:00–19:00Z).
  await settings.saveWeeklyRules(business.id, doctorId, [{ weekday: 2, startTime: "10:00", endTime: "13:00" }]);
});

afterAll(() => kapso.close());

describe("booking from the dashboard", () => {
  it("books a free time and tells the patient on WhatsApp once the template is approved", async () => {
    await approve("praxia_cita_agendada");
    const result = await agenda.bookForPatient({
      business,
      clientId,
      serviceId,
      localStart: `${DAY}T11:00`,
      practitionerId: null,
      notify: true,
      now: NOW,
    });
    expect(result).toMatchObject({ ok: true, notice: { notified: true } });
    expect(sent.map((e) => e.name)).toEqual(["appointment/booked"]);

    const [call] = templateSends();
    expect(call.path).toContain(PHONE_ID);
    expect(call.body).toMatchObject({ to: PHONE, template: { name: "praxia_cita_agendada" } });
    const [stored] = await db.select().from(schema.messages).where(eq(schema.messages.clientId, clientId));
    expect(stored.body).toContain("quedó agendada para el martes 13 de octubre a las 11:00");
  });

  it("books without a message when the template is not approved yet, or when asked not to", async () => {
    const pending = await agenda.bookForPatient({
      business,
      clientId,
      serviceId,
      localStart: `${DAY}T10:00`,
      practitionerId: doctorId,
      notify: true,
      now: NOW,
    });
    expect(pending).toMatchObject({ ok: true, notice: { notified: false, reason: "template_not_approved" } });

    await approve("praxia_cita_agendada");
    const quiet = await agenda.bookForPatient({
      business,
      clientId,
      serviceId,
      localStart: `${DAY}T11:00`,
      practitionerId: null,
      notify: false,
      now: NOW,
    });
    expect(quiet.ok).toBe(true);
    expect(quiet).not.toHaveProperty("notice");
    expect(templateSends()).toHaveLength(0);
  });

  it("does not notify a patient with no WhatsApp", async () => {
    await approve("praxia_cita_agendada");
    const [{ id: walkIn }] = await db.insert(schema.clients).values({ businessId: business.id, name: "Luis" }).returning();
    const result = await agenda.bookForPatient({
      business,
      clientId: walkIn,
      serviceId,
      localStart: `${DAY}T10:00`,
      practitionerId: null,
      notify: true,
      now: NOW,
    });
    expect(result).toMatchObject({ ok: true, notice: { notified: false, reason: "no_whatsapp" } });
  });

  it("sends the message to the number's holder for a patient sharing it", async () => {
    await approve("praxia_cita_agendada");
    const [{ id: son }] = await db
      .insert(schema.clients)
      .values({ businessId: business.id, name: "Luis", waPhone: PHONE, holderId: clientId })
      .returning();
    const result = await agenda.bookForPatient({
      business,
      clientId: son,
      serviceId,
      localStart: `${DAY}T10:00`,
      practitionerId: null,
      notify: true,
      now: NOW,
    });
    expect(result).toMatchObject({ ok: true, notice: { notified: true } });
    expect(templateSends()[0].body).toMatchObject({ to: PHONE });
    // In the holder's conversation, where the dashboard and the agent look.
    const stored = await db.select().from(schema.messages).where(eq(schema.messages.clientId, clientId));
    expect(stored).toHaveLength(1);
  });

  it("refuses a taken time and a patient from another clinic", async () => {
    await agenda.bookForPatient({ business, clientId, serviceId, localStart: `${DAY}T10:00`, practitionerId: null, notify: false, now: NOW });
    const taken = await agenda.bookForPatient({
      business,
      clientId,
      serviceId,
      localStart: `${DAY}T10:00`,
      practitionerId: null,
      notify: false,
      now: NOW,
    });
    expect(taken).toEqual({ ok: false, reason: "slot_unavailable" });

    const [other] = await db.insert(schema.businesses).values({ name: "Otra" }).returning();
    const [{ id: stranger }] = await db.insert(schema.clients).values({ businessId: other.id, name: "X" }).returning();
    await expect(
      agenda.bookForPatient({ business, clientId: stranger, serviceId, localStart: `${DAY}T11:00`, practitionerId: null, notify: false, now: NOW }),
    ).rejects.toThrow("not_found");
  });
});

describe("moving an appointment from the dashboard", () => {
  it("frees the old time and books the new one for any patient", async () => {
    const booked = await bookAppointment({ business, clientId, serviceId, localStart: `${DAY}T10:00`, now: NOW });
    if (!booked.ok) throw new Error("setup");
    sent.length = 0;

    const moved = await agenda.moveAppointment({
      business,
      appointmentId: booked.appointment.id,
      localStart: `${DAY}T12:00`,
      practitionerId: null,
      notify: false,
      now: NOW,
    });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.appointment).toMatchObject({ clientId, serviceId, practitionerId: doctorId, rescheduledFromId: booked.appointment.id });

    const [old] = await db.select().from(schema.appointments).where(eq(schema.appointments.id, booked.appointment.id));
    expect(old).toMatchObject({ status: "cancelled_by_business", cancelReason: "rescheduled" });
    expect(sent.map((e) => e.name)).toEqual(["appointment/cancelled", "appointment/booked"]);
    expect(await slotsOn()).toContain("2026-10-13T16:00:00.000Z");
  });

  it("keeps the original appointment when the new time is taken", async () => {
    const first = await bookAppointment({ business, clientId, serviceId, localStart: `${DAY}T10:00`, now: NOW });
    await bookAppointment({ business, clientId, serviceId, localStart: `${DAY}T12:00`, now: NOW });
    if (!first.ok) throw new Error("setup");

    const moved = await agenda.moveAppointment({
      business,
      appointmentId: first.appointment.id,
      localStart: `${DAY}T12:00`,
      practitionerId: null,
      notify: true,
      now: NOW,
    });
    expect(moved).toEqual({ ok: false, reason: "slot_unavailable" });
    const [kept] = await db.select().from(schema.appointments).where(eq(schema.appointments.id, first.appointment.id));
    expect(kept.status).toBe("booked");
  });

  it("does not move another clinic's appointment", async () => {
    const booked = await bookAppointment({ business, clientId, serviceId, localStart: `${DAY}T10:00`, now: NOW });
    if (!booked.ok) throw new Error("setup");
    const [other] = await db.insert(schema.businesses).values({ name: "Otra", timezone: "America/Mexico_City" }).returning();
    const moved = await agenda.moveAppointment({
      business: other,
      appointmentId: booked.appointment.id,
      localStart: `${DAY}T12:00`,
      practitionerId: null,
      notify: false,
      now: NOW,
    });
    expect(moved).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("blocking time on a doctor's calendar", () => {
  it("takes the blocked hours out of the free times, for the agent too", async () => {
    expect(await slotsOn()).toHaveLength(5);
    const block = await agenda.addTimeBlock(business, {
      practitionerId: doctorId,
      date: DAY,
      startTime: "10:30",
      endTime: "11:30",
      note: "Cirugía",
    });
    // 10:00, 10:30 and 11:00 would overlap it; 11:30 and 12:00 are still free.
    expect(await slotsOn()).toEqual(["2026-10-13T17:30:00.000Z", "2026-10-13T18:00:00.000Z"]);
    const rejected = await bookAppointment({ business, clientId, serviceId, localStart: `${DAY}T10:00`, now: NOW });
    expect(rejected).toEqual({ ok: false, reason: "slot_unavailable" });

    const listed = await agenda.blocksBetween(business.id, new Date("2026-10-13T06:00:00Z"), new Date("2026-10-14T06:00:00Z"));
    expect(listed.map((b) => [b.block.note, b.practitionerName])).toEqual([["Cirugía", "Dra. Ruiz"]]);

    await agenda.removeTimeBlock(business.id, block.id);
    expect(await slotsOn()).toHaveLength(5);
  });

  it("rejects an inverted range, a bad time, and another clinic's doctor", async () => {
    const add = (input: Partial<Parameters<typeof agenda.addTimeBlock>[1]>) =>
      agenda.addTimeBlock(business, { practitionerId: doctorId, date: DAY, startTime: "10:00", endTime: "11:00", note: null, ...input });
    await expect(add({ startTime: "11:00", endTime: "10:00" })).rejects.toThrow("invalid_block");
    await expect(add({ startTime: "10" })).rejects.toThrow("invalid_block");
    await expect(add({ date: "mañana" })).rejects.toThrow("invalid_block");
    const [other] = await db.insert(schema.businesses).values({ name: "Otra" }).returning();
    const { id: stranger } = await createPractitioner(other.id, { displayName: "Dr. X" });
    await expect(add({ practitionerId: stranger })).rejects.toThrow("unknown_practitioner");
  });

  it("does not let another clinic remove a block", async () => {
    await agenda.addTimeBlock(business, { practitionerId: doctorId, date: DAY, startTime: "10:00", endTime: "13:00", note: null });
    const [other] = await db.insert(schema.businesses).values({ name: "Otra" }).returning();
    const [block] = await db.select().from(schema.timeBlocks);
    await agenda.removeTimeBlock(other.id, block.id);
    expect(await slotsOn()).toEqual([]);
  });
});
