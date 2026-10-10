import { beforeEach, describe, expect, it } from "vitest";

const { db, schema } = await import("@/db");
const { eq, sql } = await import("drizzle-orm");
const notes = await import("@/lib/dashboard/notes");
const { createPractitioner } = await import("@/lib/booking/practitioners");
const { searchCodes, describeCode } = await import("@/lib/cie10");
const { encryptExistingRows } = await import("@/lib/encrypt-backfill");

let business: typeof schema.businesses.$inferSelect;
let clientId: string;
let visitId: string;
let ana: Awaited<ReturnType<typeof doctor>>;
let luis: Awaited<ReturnType<typeof doctor>>;

async function doctor(name: string, email: string) {
  const [profile] = await db.insert(schema.profiles).values({ id: crypto.randomUUID(), email }).returning();
  const practitioner = await createPractitioner(business.id, { displayName: name });
  return {
    role: "doctor" as const,
    managesClinic: false,
    practitionerId: practitioner.id,
    business: { id: business.id },
    profile: { id: profile.id },
  };
}

const empty = { bloodPressure: null, heartRate: null, temperature: null, weight: null, height: null, spo2: null };
const draft = {
  subjective: "Dolor de garganta desde hace 3 días.",
  objective: "Faringe eritematosa, sin exudado.",
  vitals: { ...empty, bloodPressure: "120/80", temperature: "37,8", spo2: "98" },
  assessment: "Faringitis viral.",
  diagnosisCodes: ["j02.9"],
  plan: "Reposo, líquidos, acetaminofén 500 mg cada 8 h.",
};

beforeEach(async () => {
  await db.execute(sql`truncate clinical_notes, note_addenda, access_log, messages, clients, businesses, profiles cascade`);
  [business] = await db.insert(schema.businesses).values({ name: "Clínica Luna" }).returning();
  [{ id: clientId }] = await db.insert(schema.clients).values({ businessId: business.id, waPhone: "50370000000" }).returning();
  ana = await doctor("Dra. Ana Ruiz", "ana@luna.sv");
  luis = await doctor("Dr. Luis Pérez", "luis@luna.sv");
  visitId = await visit(new Date(Date.now() - 3_600_000));
});

// One of the patient's appointments, with Dra. Ruiz.
async function visit(startsAt: Date, status: (typeof schema.appointmentStatus.enumValues)[number] = "booked") {
  const [service] = await db.insert(schema.services).values({ businessId: business.id, name: "Consulta", durationMin: 30 }).returning();
  const [a] = await db
    .insert(schema.appointments)
    .values({ businessId: business.id, clientId, serviceId: service.id, practitionerId: ana.practitionerId!, startsAt, endsAt: new Date(startsAt.getTime() + 1_800_000), status })
    .returning();
  return a.id;
}

describe("clinical notes", () => {
  it("belongs to one of the patient's appointments that has started and wasn't cancelled", async () => {
    const tomorrow = await visit(new Date(Date.now() + 86_400_000));
    const cancelled = await visit(new Date(Date.now() - 86_400_000), "cancelled_by_client");
    const lastWeek = await visit(new Date(Date.now() - 7 * 86_400_000), "completed");
    for (const id of [tomorrow, cancelled, "", "not-a-uuid"]) {
      await expect(notes.createNote(ana, clientId, id)).rejects.toThrow("unknown_appointment");
    }
    expect((await notes.appointmentsForNotes(ana, clientId)).map((a) => a.id)).toEqual([visitId, lastWeek]);

    const today = await notes.createNote(ana, clientId, visitId);
    expect(await notes.createNote(ana, clientId, visitId)).toBe(today);
    const older = await notes.createNote(ana, clientId, lastWeek);
    // Listed visit by visit, newest first.
    expect((await notes.listNotes(ana, clientId)).map((n) => [n.id, n.appointmentId, n.serviceName])).toEqual([
      [today, visitId, "Consulta"],
      [older, lastWeek, "Consulta"],
    ]);
  });


  it("saves a draft, signs it with the next number and keeps it locked", async () => {
    const first = await notes.createNote(ana, clientId, visitId);
    await notes.saveDraft(ana, first, draft);
    await expect(notes.saveDraft(luis, first, draft)).rejects.toThrow("not_your_note");
    await expect(notes.signNote(luis, first)).rejects.toThrow("not_your_note");

    const signed = await notes.signNote(ana, first);
    expect(signed).toMatchObject({ status: "signed", number: 1, diagnosisCodes: ["J02.9"], signedBy: ana.profile.id });
    expect(signed.vitals).toEqual({ bloodPressure: "120/80", temperature: 37.8, spo2: 98 });
    const reread = await notes.getNote(ana, first);
    expect(notes.verifySignature(reread!.note)).toBe(true);
    await expect(notes.saveDraft(ana, first, draft)).rejects.toThrow("not_draft");

    // The database refuses any change, even from code that skips the checks.
    await expect(db.update(schema.clinicalNotes).set({ plan: "otro" }).where(eq(schema.clinicalNotes.id, first))).rejects.toThrow();
    await expect(db.delete(schema.clinicalNotes).where(eq(schema.clinicalNotes.id, first))).rejects.toThrow();
    await expect(db.insert(schema.clinicalNotes).values({ businessId: business.id, clientId, practitionerId: ana.practitionerId, createdBy: ana.profile.id, status: "signed" })).rejects.toThrow();

    // Numbers follow the patient across doctors; a deleted draft leaves no gap.
    const scrap = await notes.createNote(luis, clientId, visitId);
    await notes.deleteDraft(luis, scrap);
    const second = await notes.createNote(luis, clientId, visitId);
    await notes.saveDraft(luis, second, { ...draft, diagnosisCodes: [] });
    expect((await notes.signNote(luis, second)).number).toBe(2);
    await expect(notes.signNote(luis, await notes.createNote(luis, clientId, visitId))).rejects.toThrow("empty_note");
  });

  it("validates codes and vitals", async () => {
    const id = await notes.createNote(ana, clientId, visitId);
    await expect(notes.saveDraft(ana, id, { ...draft, diagnosisCodes: ["X99.99"] })).rejects.toThrow("unknown_code");
    await expect(notes.saveDraft(ana, id, { ...draft, vitals: { ...empty, bloodPressure: "80/120" } })).rejects.toThrow("invalid_vitals");
    await expect(notes.saveDraft(ana, id, { ...draft, vitals: { ...empty, temperature: "98" } })).rejects.toThrow("invalid_vitals");
  });

  it("takes addenda on signed notes only, from any doctor, and never changes them", async () => {
    const id = await notes.createNote(ana, clientId, visitId);
    await notes.saveDraft(ana, id, draft);
    await expect(notes.addAddendum(luis, id, "Nota")).rejects.toThrow("not_draft");
    await notes.signNote(ana, id);
    await expect(notes.addAddendum(luis, id, "  ")).rejects.toThrow("empty_addendum");
    await notes.addAddendum(luis, id, "Cultivo negativo, se mantiene el plan.");
    const { addenda } = (await notes.getNote(ana, id))!;
    expect(addenda).toMatchObject([{ body: "Cultivo negativo, se mantiene el plan.", practitionerName: "Dr. Luis Pérez" }]);
    await expect(db.update(schema.noteAddenda).set({ body: "x" })).rejects.toThrow();
    await expect(db.delete(schema.noteAddenda)).rejects.toThrow();

    const log = await db.select().from(schema.accessLog).where(eq(schema.accessLog.clientId, clientId));
    expect(log.map((l) => l.action).sort()).toEqual(["add_addendum", "create_note", "sign_note"]);
  });

  it("is closed to assistants and Praxia staff", async () => {
    const id = await notes.createNote(ana, clientId, visitId);
    const assistant = { ...ana, role: "assistant" as const, practitionerId: null };
    const superAdmin = { ...ana, role: "super_admin" as const, managesClinic: true, practitionerId: null };
    for (const actor of [assistant, superAdmin]) {
      await expect(notes.getNote(actor, id)).rejects.toThrow("forbidden");
      await expect(notes.listNotes(actor, clientId)).rejects.toThrow("forbidden");
      await expect(notes.createNote(actor, clientId, visitId)).rejects.toThrow("forbidden");
    }
  });

  it("stores note text encrypted", async () => {
    const id = await notes.createNote(ana, clientId, visitId);
    await notes.saveDraft(ana, id, draft);
    const [raw] = await db.execute<{ subjective: string; vitals: string; diagnosis_codes: string[] }>(
      sql`select subjective, vitals, diagnosis_codes from clinical_notes where id = ${id}`,
    );
    expect(raw.subjective).toMatch(/^enc:v1:/);
    expect(raw.subjective).not.toContain("garganta");
    expect(raw.vitals).toMatch(/^enc:v1:/);
    expect(raw.diagnosis_codes).toEqual(["J02.9"]);
  });
});

describe("CIE-10", () => {
  it("finds codes by code or by words, accents aside", () => {
    expect(searchCodes("j06")[0]).toEqual({ code: "J06", description: expect.stringContaining("respiratorias") });
    expect(searchCodes("j069").map((r) => r.code)).toEqual(["J06.9"]);
    expect(searchCodes("hipertensión esencial").map((r) => r.code)).toContain("I10");
    expect(describeCode("E11.9")).toContain("Diabetes");
    expect(searchCodes("a")).toEqual([]);
  });
});

describe("encryption at rest", () => {
  it("encrypts patient fields and messages, and the backfill catches rows written before", async () => {
    await db.update(schema.clients).set({ dui: "01234567-8", data: { motivo: "control" } }).where(eq(schema.clients.id, clientId));
    await db.insert(schema.messages).values({ businessId: business.id, clientId, direction: "inbound", type: "text", body: "Tengo tos", payload: { text: { body: "Tengo tos" } } });
    const [raw] = await db.execute<{ dui: string; data: string }>(sql`select dui, data from clients where id = ${clientId}`);
    expect(raw.dui).toMatch(/^enc:v1:/);
    expect(raw.data).not.toContain("control");
    const [msg] = await db.execute<{ body: string; payload: string }>(sql`select body, payload from messages`);
    expect(msg.body).toMatch(/^enc:v1:/);
    expect(msg.payload).not.toContain("tos");

    // Rows from before encryption: plain text, still readable, then rewritten.
    await db.execute(sql`update clients set dui = '98765432-1', data = '{"motivo":"fiebre"}' where id = ${clientId}`);
    await db.execute(sql`update messages set body = 'Hola', payload = '{"type":"text"}'`);
    const [legacy] = await db.select().from(schema.clients).where(eq(schema.clients.id, clientId));
    expect(legacy).toMatchObject({ dui: "98765432-1", data: { motivo: "fiebre" } });
    expect(await encryptExistingRows()).toEqual({ clients: 1, messages: 1 });
    expect(await encryptExistingRows()).toEqual({ clients: 0, messages: 0 });
    const [after] = await db.execute<{ dui: string; data: string }>(sql`select dui, data from clients where id = ${clientId}`);
    expect(after.dui).toMatch(/^enc:v1:/);
    const [reread] = await db.select().from(schema.clients).where(eq(schema.clients.id, clientId));
    expect(reread).toMatchObject({ dui: "98765432-1", data: { motivo: "fiebre" } });
    const [m] = await db.select().from(schema.messages);
    expect(m).toMatchObject({ body: "Hola", payload: { type: "text" } });
  });
});

