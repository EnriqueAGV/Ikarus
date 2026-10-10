import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/dashboard/patients";

vi.mock("@/inngest/client", () => ({ inngest: { send: async () => {}, createFunction: () => ({}) } }));

const { db, schema } = await import("@/db");
const { eq, sql } = await import("drizzle-orm");
const patients = await import("@/lib/dashboard/patients");
const notes = await import("@/lib/dashboard/notes");
const rx = await import("@/lib/dashboard/prescriptions");
const files = await import("@/lib/dashboard/attachments");
const { pausedConversations, waitingCount } = await import("@/lib/dashboard/inbox");
const { monthNumbers, shiftMonth } = await import("@/lib/dashboard/stats");
const { memoryFileStore, setFileStore } = await import("@/lib/storage");
const { parseCoordinates, resolveMapsLink } = await import("@/lib/location");
const { updateBusinessSettings } = await import("@/lib/dashboard/settings");
const { createPractitioner } = await import("@/lib/booking/practitioners");

let business: typeof schema.businesses.$inferSelect;
let doctor: Actor;
let assistant: Actor;
let serviceId: string;
const store = memoryFileStore();
setFileStore(store);

beforeEach(async () => {
  await db.execute(sql`truncate attachments, prescriptions, clinical_notes, note_addenda, consents, access_log, messages, appointments, clients, services, businesses, profiles cascade`);
  store.files.clear();
  [business] = await db.insert(schema.businesses).values({ name: "Clínica Luna", timezone: "America/El_Salvador" }).returning();
  const [p1] = await db.insert(schema.profiles).values({ id: crypto.randomUUID(), email: "ana@luna.sv" }).returning();
  const [p2] = await db.insert(schema.profiles).values({ id: crypto.randomUUID(), email: "rosa@luna.sv" }).returning();
  const practitioner = await createPractitioner(business.id, { displayName: "Dra. Ana Ruiz" });
  doctor = { role: "doctor", managesClinic: true, practitionerId: practitioner.id, business: { id: business.id }, profile: { id: p1.id } };
  assistant = { role: "assistant", managesClinic: false, practitionerId: null, business: { id: business.id }, profile: { id: p2.id } };
  [{ id: serviceId }] = await db.insert(schema.services).values({ businessId: business.id, name: "Consulta", durationMin: 30 }).returning();
});

async function patient(values: Partial<typeof schema.clients.$inferInsert> = {}) {
  const [c] = await db.insert(schema.clients).values({ businessId: business.id, ...values }).returning();
  return c;
}
const reload = async (id: string) => (await db.select().from(schema.clients).where(eq(schema.clients.id, id)))[0];

async function appointment(clientId: string, startsAt: Date, values: Partial<typeof schema.appointments.$inferInsert> = {}) {
  const [a] = await db
    .insert(schema.appointments)
    .values({ businessId: business.id, clientId, serviceId, practitionerId: doctor.practitionerId!, startsAt, endsAt: new Date(startsAt.getTime() + 1_800_000), ...values })
    .returning();
  return a;
}

async function message(clientId: string, direction: "inbound" | "outbound", body: string, createdAt = new Date()) {
  await db.insert(schema.messages).values({ businessId: business.id, clientId, direction, type: "text", body, createdAt });
}

describe("changing a patient's WhatsApp number", () => {
  it("moves a holder with everyone sharing the number, and keeps the conversation", async () => {
    const mom = await patient({ name: "María", waPhone: "50370000001" });
    const son = await patient({ name: "Pedro", waPhone: "50370000001", holderId: mom.id });
    await message(mom.id, "inbound", "Hola");
    await patients.changePhone(assistant, mom.id, "7000 0002");
    expect(await reload(mom.id)).toMatchObject({ waPhone: "50370000002", holderId: null });
    expect(await reload(son.id)).toMatchObject({ waPhone: "50370000002", holderId: mom.id });
    expect(await db.select().from(schema.messages).where(eq(schema.messages.clientId, mom.id))).toHaveLength(1);
    // A holder can't drop the number while others share it, or take someone else's.
    await expect(patients.changePhone(assistant, mom.id, null)).rejects.toThrow("has_dependents");
    await patient({ name: "Otro", waPhone: "50370000009" });
    await expect(patients.changePhone(assistant, mom.id, "70000009")).rejects.toThrow("phone_in_use");
    // Alone on a number, a patient can join another family's.
    const loner = await patient({ name: "Tío", waPhone: "50370000010" });
    await patients.changePhone(assistant, loner.id, "70000009");
    expect((await reload(loner.id)).holderId).not.toBeNull();
    await expect(patients.changePhone(assistant, mom.id, "123")).rejects.toThrow("invalid_phone");
  });

  it("lets someone who shared a number leave it, or join another family's", async () => {
    const mom = await patient({ name: "María", waPhone: "50370000001" });
    const son = await patient({ name: "Pedro", waPhone: "50370000001", holderId: mom.id });
    await patients.changePhone(assistant, son.id, "70000003");
    expect(await reload(son.id)).toMatchObject({ waPhone: "50370000003", holderId: null });
    await patients.changePhone(assistant, son.id, "70000001");
    expect(await reload(son.id)).toMatchObject({ waPhone: "50370000001", holderId: mom.id });
    await patients.changePhone(assistant, son.id, null);
    expect(await reload(son.id)).toMatchObject({ waPhone: null, holderId: null });
  });
});

describe("merging duplicate patients", () => {
  it("brings a WhatsApp duplicate's number, conversation and appointments to the hand-made record", async () => {
    const byHand = await patient({ name: "Ana López", dateOfBirth: "1990-05-04", allergies: "Penicilina" });
    const fromWa = await patient({ name: "Ana", waPhone: "50370000001", dui: "01234567-8", allergies: "Sulfas", agentPaused: true, data: { seguro: "no" } });
    const kid = await patient({ name: "Luis", waPhone: "50370000001", holderId: fromWa.id });
    await message(fromWa.id, "inbound", "Hola");
    await db.insert(schema.consents).values({ businessId: business.id, clientId: fromWa.id, noticeVersion: "v1" });
    const appt = await appointment(fromWa.id, new Date(Date.now() + 86_400_000));
    // A signed note stays on the duplicate and still shows on the kept record.
    const visit = await appointment(fromWa.id, new Date(Date.now() - 3_600_000));
    const noteId = await notes.createNote(doctor, fromWa.id, visit.id);
    await notes.saveDraft(doctor, noteId, {
      subjective: "Tos", objective: null, assessment: null, plan: null, diagnosisCodes: [],
      vitals: { bloodPressure: null, heartRate: null, temperature: null, weight: null, height: null, spo2: null },
    });
    await notes.signNote(doctor, noteId);

    await patients.mergePatients(assistant, byHand.id, fromWa.id);

    const kept = await reload(byHand.id);
    expect(kept).toMatchObject({
      name: "Ana López",
      waPhone: "50370000001",
      holderId: null,
      dui: "01234567-8",
      dateOfBirth: "1990-05-04",
      agentPaused: true,
      allergies: "Penicilina\nSulfas",
      data: { seguro: "no" },
    });
    expect(await reload(fromWa.id)).toMatchObject({ waPhone: null, mergedIntoId: byHand.id });
    expect((await reload(fromWa.id)).archivedAt).not.toBeNull();
    expect(await reload(kid.id)).toMatchObject({ holderId: byHand.id });
    expect((await db.select().from(schema.messages))[0].clientId).toBe(byHand.id);
    expect((await db.select().from(schema.consents))[0].clientId).toBe(byHand.id);
    expect((await db.select().from(schema.appointments).where(eq(schema.appointments.id, appt.id)))[0].clientId).toBe(byHand.id);
    const ids = await patients.recordIds(business.id, byHand.id);
    expect((await notes.listNotes(doctor, ids)).map((n) => [n.id, n.clientId])).toEqual([[noteId, fromWa.id]]);

    // A merged record can't be merged, restored or edited again.
    await expect(patients.mergePatients(assistant, byHand.id, fromWa.id)).rejects.toThrow("merged");
    await expect(patients.restorePatient(assistant, fromWa.id)).rejects.toThrow("merged");
    await expect(patients.mergePatients(assistant, byHand.id, byHand.id)).rejects.toThrow("same_patient");
  });

  it("joins a second number's history to the kept conversation", async () => {
    const one = await patient({ name: "Ana López", waPhone: "50370000001" });
    const two = await patient({ name: "Ana López", waPhone: "50370000002" });
    await message(two.id, "inbound", "Hola desde el otro número");
    await patients.mergePatients(assistant, one.id, two.id);
    expect(await reload(one.id)).toMatchObject({ waPhone: "50370000001" });
    expect(await reload(two.id)).toMatchObject({ waPhone: null, mergedIntoId: one.id });
    expect((await db.select().from(schema.messages))[0].clientId).toBe(one.id);
  });

  it("refuses a second number that others share, and makes a dependent the holder of a shared number", async () => {
    const mom = await patient({ name: "María", waPhone: "50370000001" });
    const kid = await patient({ name: "Luis", waPhone: "50370000001", holderId: mom.id });
    const other = await patient({ name: "María", waPhone: "50370000002" });
    await expect(patients.mergePatients(assistant, other.id, mom.id)).rejects.toThrow("has_dependents");

    // The same number: the duplicate held it, the kept record now does.
    const mom2 = await patient({ name: "María López", waPhone: "50370000005" });
    const dup = await patient({ name: "María", waPhone: "50370000005", holderId: mom2.id });
    await message(mom2.id, "inbound", "Hola");
    await patients.mergePatients(assistant, dup.id, mom2.id);
    expect(await reload(dup.id)).toMatchObject({ waPhone: "50370000005", holderId: null });
    expect((await db.select().from(schema.messages))[0].clientId).toBe(dup.id);
    expect(await reload(mom2.id)).toMatchObject({ waPhone: null, mergedIntoId: dup.id });
    expect((await reload(kid.id)).holderId).toBe(mom.id);
  });

  it("suggests records with the same number or a similar name", async () => {
    const ana = await patient({ name: "Ana María López", waPhone: "50370000001" });
    await patient({ name: "Ana López", waPhone: null });
    await patient({ name: "Pedro Ruiz", waPhone: "50370000001", holderId: ana.id });
    await patient({ name: "Luis Gómez" });
    const names = (await patients.duplicateCandidates(business.id, ana)).map((d) => d.name).sort();
    expect(names).toEqual(["Ana López", "Pedro Ruiz"]);
    expect((await patients.duplicateCandidates(business.id, ana, "gómez")).map((d) => d.name)).toEqual(["Luis Gómez"]);
  });
});

describe("prescriptions", () => {
  it("issues a receta from a doctor and never changes it", async () => {
    const p = await patient({ name: "Ana" });
    const visit = await appointment(p.id, new Date(Date.now() - 3_600_000));
    await expect(rx.issuePrescription(assistant, p.id, { appointmentId: null, items: [{ drug: "X" }], instructions: null })).rejects.toThrow("forbidden");
    await expect(rx.issuePrescription(doctor, p.id, { appointmentId: null, items: [{ drug: "  " }], instructions: null })).rejects.toThrow("empty_prescription");
    const issued = await rx.issuePrescription(doctor, p.id, {
      appointmentId: visit.id,
      items: [{ drug: "Amoxicilina 500 mg", dose: "1 cápsula", frequency: "cada 8 horas", duration: "7 días" }, { drug: "" }],
      instructions: " Tomar con alimentos ",
    });
    expect(issued.items).toEqual([{ drug: "Amoxicilina 500 mg", dose: "1 cápsula", frequency: "cada 8 horas", duration: "7 días" }]);
    // Encrypted at rest.
    const [raw] = await db.execute<{ items: string; instructions: string }>(sql`select items, instructions from prescriptions`);
    expect(raw.items.startsWith("enc:v")).toBe(true);
    expect(raw.instructions).not.toContain("alimentos");
    await expect(db.update(schema.prescriptions).set({ instructions: "otra" }).where(eq(schema.prescriptions.id, issued.id))).rejects.toThrow();
    const listed = await rx.listPrescriptions(doctor, [p.id]);
    expect(listed.map((r) => [r.prescription.instructions, r.practitionerName])).toEqual([["Tomar con alimentos", "Dra. Ana Ruiz"]]);
    await expect(rx.listPrescriptions(assistant, [p.id])).rejects.toThrow("forbidden");
    const log = await db.select({ action: schema.accessLog.action }).from(schema.accessLog);
    expect(log.map((l) => l.action)).toContain("create_prescription");
  });
});

describe("attachments", () => {
  it("stores a lab result encrypted and opens it only for doctors, logging each opening", async () => {
    const p = await patient({ name: "Ana" });
    const pdf = new File([new TextEncoder().encode("%PDF-1.4 hemograma")], "hemograma Ana.pdf", { type: "application/pdf" });
    await expect(files.uploadAttachment(assistant, p.id, { file: pdf, kind: "lab", appointmentId: null })).rejects.toThrow("forbidden");
    await expect(
      files.uploadAttachment(doctor, p.id, { file: new File(["x"], "a.exe", { type: "application/x-msdownload" }), kind: "other", appointmentId: null }),
    ).rejects.toThrow("file_type");
    await expect(
      files.uploadAttachment(doctor, p.id, { file: new File([new Uint8Array(files.MAX_BYTES + 1)], "big.pdf", { type: "application/pdf" }), kind: "lab", appointmentId: null }),
    ).rejects.toThrow("file_too_large");

    const saved = await files.uploadAttachment(doctor, p.id, { file: pdf, kind: "lab", appointmentId: null });
    const stored = store.files.get(saved.storagePath)!;
    expect(Buffer.from(stored).toString("latin1")).not.toContain("hemograma");
    const [raw] = await db.execute<{ file_name: string }>(sql`select file_name from attachments`);
    expect(raw.file_name).not.toContain("Ana");

    const opened = await files.readAttachment(doctor, saved.id);
    expect(opened.bytes.toString()).toBe("%PDF-1.4 hemograma");
    expect(opened.attachment.fileName).toBe("hemograma Ana.pdf");
    await expect(files.readAttachment(assistant, saved.id)).rejects.toThrow("forbidden");

    expect((await files.listAttachments(doctor, [p.id])).map((f) => f.fileName)).toEqual(["hemograma Ana.pdf"]);
    await files.removeAttachment(doctor, saved.id);
    expect(await files.listAttachments(doctor, [p.id])).toEqual([]);
    await expect(files.readAttachment(doctor, saved.id)).rejects.toThrow("not_found");
    const log = (await db.select({ action: schema.accessLog.action }).from(schema.accessLog)).map((l) => l.action);
    expect(log).toEqual(expect.arrayContaining(["upload_attachment", "view_attachment", "delete_attachment"]));
  });
});

describe("conversations waiting on the team", () => {
  it("lists paused numbers, the ones where the patient wrote last first", async () => {
    const now = Date.now();
    const waitingLong = await patient({ name: "Ana", waPhone: "50370000001", agentPaused: true });
    const waitingShort = await patient({ name: "Luis", waPhone: "50370000002", agentPaused: true });
    const answered = await patient({ name: "Rosa", waPhone: "50370000003", agentPaused: true });
    const running = await patient({ name: "Pedro", waPhone: "50370000004" });
    await message(waitingLong.id, "inbound", "¿Me pueden llamar?", new Date(now - 3 * 3_600_000));
    await message(waitingShort.id, "outbound", "Hola", new Date(now - 7_200_000));
    await message(waitingShort.id, "inbound", "Tengo una duda", new Date(now - 600_000));
    await message(answered.id, "inbound", "Gracias", new Date(now - 7_200_000));
    await message(answered.id, "outbound", "Con gusto", new Date(now - 3_600_000));
    await message(running.id, "inbound", "Hola", new Date(now - 60_000));

    const rows = await pausedConversations(business.id);
    expect(rows.map((r) => [r.client.name, r.waiting, r.lastMessage?.body])).toEqual([
      ["Ana", true, "¿Me pueden llamar?"],
      ["Luis", true, "Tengo una duda"],
      ["Rosa", false, "Con gusto"],
    ]);
    expect(await waitingCount(business.id)).toBe(2);
  });
});

describe("monthly numbers", () => {
  it("counts the month's appointments, outcomes, bookings and new patients", async () => {
    const p = await patient({ name: "Ana", createdAt: new Date("2026-09-20T18:00:00Z") });
    const q = await patient({ name: "Luis", createdAt: new Date("2026-10-02T18:00:00Z") });
    const oct = (d: number) => new Date(`2026-10-${String(d).padStart(2, "0")}T16:00:00Z`);
    await appointment(p.id, oct(1), { status: "completed", bookedBy: "assistant", createdAt: new Date("2026-09-25T12:00:00Z") });
    await appointment(p.id, oct(5), { status: "no_show", bookedBy: "staff", createdAt: oct(2) });
    await appointment(q.id, oct(6), { status: "completed", bookedBy: "assistant", createdAt: oct(3) });
    const moved = await appointment(q.id, oct(7), { status: "cancelled_by_client", cancelReason: "rescheduled", bookedBy: "assistant", createdAt: oct(3) });
    await appointment(q.id, oct(8), { status: "booked", bookedBy: "assistant", rescheduledFromId: moved.id, createdAt: oct(4) });
    await appointment(q.id, oct(9), { status: "cancelled_by_business", createdAt: oct(4) });
    // Local midnight in El Salvador: 1 Nov 00:30 local is still November.
    await appointment(p.id, new Date("2026-11-01T06:30:00Z"), { status: "booked", createdAt: new Date("2026-09-01T12:00:00Z") });
    await message(p.id, "inbound", "Hola", oct(2));
    await message(p.id, "inbound", "¿A qué hora?", oct(2));
    await message(q.id, "inbound", "Hola", oct(3));

    const m = await monthNumbers(business, "2026-10");
    expect(m).toMatchObject({
      appointments: 5,
      completed: 2,
      noShows: 1,
      cancelled: 1,
      booked: { byAssistant: 2, byStaff: 1, total: 4 },
      newPatients: 1,
      conversations: 2,
      received: 3,
    });
    expect(m.noShowRate).toBeCloseTo(1 / 3);
    expect(m.byDoctor).toMatchObject([{ name: "Dra. Ana Ruiz", appointments: 5 }]);
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });
});

describe("clinic location", () => {
  it("reads coordinates from the kinds of Google Maps links people paste", async () => {
    expect(parseCoordinates("https://www.google.com/maps/place/Cl%C3%ADnica/@13.7,-89.2,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d13.6929!4d-89.2182")).toEqual({ lat: 13.6929, lng: -89.2182 });
    expect(parseCoordinates("https://maps.google.com/?q=13.69,-89.21")).toEqual({ lat: 13.69, lng: -89.21 });
    expect(parseCoordinates("https://www.google.com/maps/@13.6929,-89.2182,15z")).toEqual({ lat: 13.6929, lng: -89.2182 });
    expect(parseCoordinates("13.6929, -89.2182")).toEqual({ lat: 13.6929, lng: -89.2182 });
    expect(parseCoordinates("https://www.google.com/maps/search/clinica")).toBeNull();
    const fetcher = (async () => ({ url: "https://www.google.com/maps/place/X/@13.5,-89.1,17z" })) as unknown as typeof fetch;
    expect(await resolveMapsLink("https://maps.app.goo.gl/abc123", fetcher)).toEqual({ lat: 13.5, lng: -89.1 });

    await updateBusinessSettings(business.id, {
      reminderLeadHours: 24,
      agentInstructions: "",
      mapsUrl: "https://maps.google.com/?q=13.69,-89.21",
      locationAddress: " Paseo General Escalón 123 ",
    });
    expect(await db.select().from(schema.businesses)).toMatchObject([{ locationLat: 13.69, locationLng: -89.21, locationAddress: "Paseo General Escalón 123" }]);
    await expect(
      updateBusinessSettings(business.id, { reminderLeadHours: 24, agentInstructions: "", mapsUrl: "https://example.com/somewhere" }),
    ).rejects.toThrow("invalid_maps_link");
    await updateBusinessSettings(business.id, { reminderLeadHours: 24, agentInstructions: "", mapsUrl: "" });
    expect(await db.select().from(schema.businesses)).toMatchObject([{ locationLat: null, mapsUrl: null }]);
  });
});
