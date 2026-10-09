import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startFakeKapso } from "./fake-kapso";

const sent = vi.hoisted(() => [] as { name: string; data: unknown }[]);
vi.mock("@/inngest/client", () => ({
  inngest: { send: async (e: { name: string; data: unknown }) => void sent.push(e) },
}));
const invites = vi.hoisted(() => [] as { email: string; redirectTo?: string }[]);
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    auth: {
      admin: {
        inviteUserByEmail: async (email: string, opts?: { redirectTo?: string }) => {
          invites.push({ email, redirectTo: opts?.redirectTo });
          return { data: { user: { id: crypto.randomUUID(), email } }, error: null };
        },
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
const patients = await import("@/lib/dashboard/patients");
const labels = await import("@/lib/dashboard/labels");
const { sendStaffReply } = await import("@/lib/messaging/staff");
const { availableSlots, bookAppointment, rescheduleByClient } = await import("@/lib/booking/service");
const { createPractitioner } = await import("@/lib/booking/practitioners");
const { toConversation } = await import("@/lib/agent/run");

// Monday 12 Oct 2026, 09:00 in Mexico City.
const NOW = new Date("2026-10-12T15:00:00Z");

let business: typeof schema.businesses.$inferSelect;
let clientId: string;
let doctorId: string;

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
  ({ id: doctorId } = await createPractitioner(business.id, { displayName: "Dra. Ana Ruiz" }));
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
    await settings.saveWeeklyRules(business.id, doctorId, [{ weekday: 1, startTime: "08:00", endTime: "20:00" }]);
    await settings.saveWeeklyRules(business.id, doctorId, [
      { weekday: 1, startTime: "10:00", endTime: "12:00" },
      { weekday: 1, startTime: "16:00", endTime: "17:00" },
    ]);
    expect(await settings.getWeeklyRules(business.id, doctorId)).toHaveLength(2);

    const slots = await availableSlots(business, { serviceId: service.id, fromDate: "2026-10-12", toDate: "2026-10-12", now: NOW });
    expect(slots!.map((s) => s.startsAt.toISOString())).toEqual([
      "2026-10-12T16:00:00.000Z",
      "2026-10-12T16:30:00.000Z",
      "2026-10-12T17:00:00.000Z",
      "2026-10-12T22:00:00.000Z",
    ]);
  });

  it("a closure replaces custom hours for that date, and the reverse", async () => {
    await settings.addException(business.id, doctorId, { date: "2026-12-24", range: { startTime: "09:00", endTime: "13:00" } });
    await settings.addException(business.id, doctorId, { date: "2026-12-24", range: null, note: "Nochebuena" });
    let rows = await settings.getExceptions(business.id, doctorId, "2026-10-01");
    expect(rows).toMatchObject([{ date: "2026-12-24", startTime: null, note: "Nochebuena" }]);

    await settings.addException(business.id, doctorId, { date: "2026-12-24", range: { startTime: "10:00", endTime: "12:00" } });
    rows = await settings.getExceptions(business.id, doctorId, "2026-10-01");
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
    expect(b).toMatchObject({ reminderLeadHours: 48, agentInstructions: "Llega 10 min antes", reminderEndPolicy: "escalate" });
    await settings.updateBusinessSettings(business.id, { reminderLeadHours: 48, agentInstructions: "", reminderEndPolicy: "auto_cancel" });
    const [after] = await db.select().from(schema.businesses).where(eq(schema.businesses.id, business.id));
    expect(after.reminderEndPolicy).toBe("auto_cancel");
  });
});

describe("appointments from the dashboard", () => {
  async function book(localStart: string) {
    const service = await settings.createService(business.id, { name: "Corte", durationMin: 60, bufferMin: 0, active: true });
    await settings.saveWeeklyRules(business.id, doctorId, [{ weekday: 1, startTime: "09:00", endTime: "18:00" }]);
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

  it("lists unanswered appointments to call and lets the team confirm them", async () => {
    const { appointment } = await book("2026-10-12T11:00");
    await db
      .update(schema.appointments)
      .set({ status: "followup_sent", escalatedAt: NOW })
      .where(eq(schema.appointments.id, appointment.id));
    const toCall = await dashboard.needingCall(business.id, NOW);
    expect(toCall.map((r) => r.appointment.id)).toEqual([appointment.id]);
    expect(labels.appointmentLabel(toCall[0].appointment)).toBe("Sin confirmar, llamar");

    const confirmed = await dashboard.updateAppointmentByBusiness(business.id, appointment.id, "confirm", NOW);
    expect(confirmed).toMatchObject({ status: "confirmed" });
    expect(labels.appointmentLabel(confirmed!)).toBe("Confirmada");
    expect(await dashboard.needingCall(business.id, NOW)).toEqual([]);
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
      content: "[Escrito por el equipo del consultorio, no por ti]\nHola Ana, soy Luz",
    });

    await dashboard.setAgentPaused(business.id, clientId, false);
    const [resumed] = await db.select().from(schema.clients).where(eq(schema.clients.id, clientId));
    expect(resumed.agentPaused).toBe(false);
  });
});

describe("team", () => {
  it("invites once and always keeps someone managing the clinic", async () => {
    invites.length = 0;
    const doctor = { email: "Duena@Luna.mx", role: "doctor" as const, managesClinic: true, displayName: "Dra. Luna" };
    expect(await team.inviteMember(business.id, doctor)).toEqual({ added: true, emailed: true });
    // Already has an account: no second invitation email.
    expect(await team.inviteMember(business.id, { ...doctor, email: "duena@luna.mx" })).toEqual({ added: false, emailed: false });
    expect(invites).toEqual([{ email: "duena@luna.mx", redirectTo: "https://ikarus.test/auth/invite?next=/app" }]);
    await expect(
      team.inviteMember(business.id, { email: "otro@luna.mx", role: "doctor", managesClinic: false }),
    ).rejects.toThrow("doctor_name_required");
    await team.inviteMember(business.id, { email: "luz@luna.mx", role: "assistant", managesClinic: false });
    const members = await team.listMembers(business.id);
    expect(members.map((m) => [m.email, m.role, m.managesClinic, m.practitionerName])).toEqual([
      ["duena@luna.mx", "doctor", true, "Dra. Luna"],
      ["luz@luna.mx", "assistant", false, null],
    ]);

    const manager = members.find((m) => m.role === "doctor")!;
    const assistant = members.find((m) => m.role === "assistant")!;
    await expect(team.removeMember(business.id, manager.memberId)).rejects.toThrow("last_manager");
    await expect(team.setManagesClinic(business.id, manager.memberId, false)).rejects.toThrow("last_manager");
    await team.setManagesClinic(business.id, assistant.memberId, true);
    await team.setManagesClinic(business.id, manager.memberId, false);

    // A doctor who leaves keeps their calendar, inactive.
    await team.setManagesClinic(business.id, manager.memberId, true);
    await team.removeMember(business.id, manager.memberId);
    const [calendar] = await db.select().from(schema.practitioners).where(eq(schema.practitioners.displayName, "Dra. Luna"));
    expect(calendar).toMatchObject({ active: false, memberId: null });
    expect(await team.listMembers(business.id)).toHaveLength(1);
  });
});

describe("several doctors", () => {
  const MONDAY = [{ weekday: 1, startTime: "09:00", endTime: "18:00" }];
  let serviceId: string;
  let secondId: string;

  beforeEach(async () => {
    ({ id: serviceId } = await settings.createService(business.id, { name: "Consulta", durationMin: 60, bufferMin: 0, active: true }));
    ({ id: secondId } = await settings.addPractitioner(business.id, { displayName: "Dr. Luis Pérez", specialty: "Pediatría", jvpmNumber: "" }));
    await settings.saveWeeklyRules(business.id, doctorId, MONDAY);
    await settings.saveWeeklyRules(business.id, secondId, MONDAY);
  });

  const book = (localStart: string, practitionerId?: string) =>
    bookAppointment({ business, clientId, serviceId, localStart, practitionerId, now: NOW });

  it("lets two doctors see patients at the same time, but never one doctor twice", async () => {
    const first = await book("2026-10-12T11:00");
    const second = await book("2026-10-12T11:00");
    const third = await book("2026-10-12T11:00");
    expect(first.ok && first.appointment.practitionerId).toBe(doctorId);
    expect(second.ok && second.appointment.practitionerId).toBe(secondId);
    expect(third).toEqual({ ok: false, reason: "slot_unavailable" });

    // The database constraint is per doctor too.
    const row = (practitionerId: string) => ({
      businessId: business.id,
      clientId,
      serviceId,
      practitionerId,
      startsAt: new Date("2026-10-12T19:00:00Z"),
      endsAt: new Date("2026-10-12T20:00:00Z"),
    });
    await db.insert(schema.appointments).values(row(doctorId));
    await db.insert(schema.appointments).values(row(secondId));
    await expect(db.insert(schema.appointments).values(row(doctorId))).rejects.toMatchObject({ cause: { code: "23P01" } });
  });

  it("merges free times across doctors, or shows one doctor's calendar", async () => {
    await settings.saveWeeklyRules(business.id, doctorId, [{ weekday: 1, startTime: "10:00", endTime: "11:00" }]);
    await settings.saveWeeklyRules(business.id, secondId, [{ weekday: 1, startTime: "16:00", endTime: "17:00" }]);
    const q = { serviceId, fromDate: "2026-10-12", toDate: "2026-10-12", now: NOW };

    const any = await availableSlots(business, q);
    expect(any!.map((s) => [s.startsAt.toISOString(), s.practitionerName])).toEqual([
      ["2026-10-12T16:00:00.000Z", "Dra. Ana Ruiz"],
      ["2026-10-12T22:00:00.000Z", "Dr. Luis Pérez"],
    ]);
    const his = await availableSlots(business, { ...q, practitionerId: secondId });
    expect(his!.map((s) => s.practitionerId)).toEqual([secondId]);
    expect(await book("2026-10-12T10:00", secondId)).toEqual({ ok: false, reason: "slot_unavailable" });
  });

  it("honors which doctor offers a service, their own duration, and inactive doctors", async () => {
    await db
      .delete(schema.practitionerServices)
      .where(eq(schema.practitionerServices.practitionerId, secondId));
    expect(await book("2026-10-12T11:00", secondId)).toEqual({ ok: false, reason: "unknown_practitioner" });

    await db.update(schema.practitionerServices).set({ durationMin: 30 }).where(eq(schema.practitionerServices.practitionerId, doctorId));
    const short = await book("2026-10-12T11:00", doctorId);
    expect(short.ok && short.appointment.endsAt.toISOString()).toBe("2026-10-12T17:30:00.000Z");

    await settings.updatePractitioner(business.id, doctorId, { displayName: "Dra. Ana Ruiz", specialty: "", jvpmNumber: "", active: false });
    expect(await availableSlots(business, { serviceId, fromDate: "2026-10-12", toDate: "2026-10-12", now: NOW })).toEqual([]);
  });

  it("keeps the doctor when a patient reschedules", async () => {
    const booked = await book("2026-10-12T11:00", secondId);
    if (!booked.ok) throw new Error(booked.reason);
    const moved = await rescheduleByClient({ business, clientId, appointmentId: booked.appointment.id, localStart: "2026-10-12T14:00", now: NOW });
    expect(moved.ok && moved.appointment.practitionerId).toBe(secondId);
  });

  it("keeps each doctor's hours and days off separate, within the business", async () => {
    await settings.saveWeeklyRules(business.id, secondId, []);
    expect(await settings.getWeeklyRules(business.id, doctorId)).toHaveLength(1);
    await settings.addException(business.id, secondId, { date: "2026-12-24", range: null });
    expect(await settings.getExceptions(business.id, doctorId, "2026-10-01")).toEqual([]);

    const [other] = await db.insert(schema.businesses).values({ name: "Otra clínica" }).returning();
    await expect(settings.saveWeeklyRules(other.id, doctorId, MONDAY)).rejects.toThrow("unknown_practitioner");
    await expect(settings.addPractitioner(business.id, { displayName: " ", specialty: "", jvpmNumber: "" })).rejects.toThrow(
      "doctor_name_required",
    );
  });
});

describe("patient record", () => {
  async function actor(role: "doctor" | "assistant", email: string) {
    const [profile] = await db.insert(schema.profiles).values({ id: crypto.randomUUID(), email }).returning();
    return {
      role,
      managesClinic: false,
      practitionerId: role === "doctor" ? doctorId : null,
      business: { id: business.id },
      profile: { id: profile.id },
    };
  }
  const demographics = {
    name: " Ana López ",
    dateOfBirth: "1990-05-04",
    sex: "female" as const,
    dui: "012345678",
    address: "Col. Escalón, San Salvador",
    guardianName: null,
    guardianPhone: null,
    emergencyContactName: "Luis López",
    emergencyContactPhone: "7000-0000",
    preferredPractitionerId: null,
  };

  it("lets assistants edit demographics and only doctors the clinical fields, logging both", async () => {
    const doctor = await actor("doctor", "doctora@luna.mx");
    const assistant = await actor("assistant", "luz@luna.mx");

    await patients.updateDemographics(assistant, clientId, { ...demographics, preferredPractitionerId: doctorId }, NOW);
    const [saved] = await db.select().from(schema.clients).where(eq(schema.clients.id, clientId));
    expect(saved).toMatchObject({ name: "Ana López", dateOfBirth: "1990-05-04", sex: "female", dui: "01234567-8", preferredPractitionerId: doctorId });

    await expect(patients.updateClinical(assistant, clientId, { allergies: "Penicilina", chronicConditions: null })).rejects.toThrow("forbidden");
    await patients.updateClinical(doctor, clientId, { allergies: "Penicilina", chronicConditions: " " });
    const [clinical] = await db.select().from(schema.clients).where(eq(schema.clients.id, clientId));
    expect(clinical).toMatchObject({ allergies: "Penicilina", chronicConditions: null });

    // Opening the record twice in ten minutes is logged once.
    await patients.logChartView(doctor, clientId);
    await patients.logChartView(doctor, clientId);
    const log = await patients.recentAccess(business.id, clientId);
    expect(log.map((l) => [l.email, l.action, l.practitionerName])).toEqual(
      expect.arrayContaining([
        ["luz@luna.mx", "edit_chart", null],
        ["doctora@luna.mx", "edit_clinical", "Dra. Ana Ruiz"],
        ["doctora@luna.mx", "view_chart", "Dra. Ana Ruiz"],
      ]),
    );
    expect(log).toHaveLength(3);

    // The log keeps the patient: deleting them is refused.
    await expect(db.delete(schema.clients).where(eq(schema.clients.id, clientId))).rejects.toThrow();
  });

  it("validates the DUI, birth date and doctor", async () => {
    const assistant = await actor("assistant", "luz@luna.mx");
    await expect(patients.updateDemographics(assistant, clientId, { ...demographics, dui: "1234" }, NOW)).rejects.toThrow("invalid_dui");
    await expect(patients.updateDemographics(assistant, clientId, { ...demographics, dateOfBirth: "2030-01-01" }, NOW)).rejects.toThrow(
      "invalid_birth_date",
    );
    await expect(
      patients.updateDemographics(assistant, clientId, { ...demographics, preferredPractitionerId: crypto.randomUUID() }, NOW),
    ).rejects.toThrow("unknown_practitioner");
    await expect(patients.updateDemographics(assistant, crypto.randomUUID(), demographics, NOW)).rejects.toThrow("not_found");
    expect(patients.normalizeDui("01234567-8")).toBe("01234567-8");
    expect(patients.normalizeDui("")).toBeNull();
  });
});
