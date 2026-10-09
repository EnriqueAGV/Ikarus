import { createHash } from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Vitals } from "@/db/schema";
import { isCode } from "@/lib/cie10";
import { can } from "@/lib/permissions";
import type { Actor } from "./patients";

export type Note = typeof schema.clinicalNotes.$inferSelect;

export class NoteError extends Error {
  constructor(
    readonly code:
      | "not_found"
      | "forbidden"
      | "not_your_note"
      | "not_draft"
      | "empty_note"
      | "unknown_code"
      | "invalid_vitals"
      | "unknown_appointment"
      | "empty_addendum",
  ) {
    super(code);
  }
}

export type DraftInput = {
  subjective: string | null;
  objective: string | null;
  vitals: Record<keyof Vitals, string | null>;
  assessment: string | null;
  diagnosisCodes: string[];
  plan: string | null;
};

const blank = (s: string | null) => (s?.trim() ? s.trim() : null);

const RANGES: Record<Exclude<keyof Vitals, "bloodPressure">, [number, number]> = {
  heartRate: [20, 250],
  temperature: [30, 45],
  weight: [0.3, 400],
  height: [20, 250],
  spo2: [50, 100],
};

// Blank fields are left out; anything typed must be a plausible reading.
export function parseVitals(raw: DraftInput["vitals"]): Vitals {
  const vitals: Vitals = {};
  const bp = blank(raw.bloodPressure)?.replace(/\s/g, "");
  if (bp) {
    const m = /^(\d{2,3})\/(\d{2,3})$/.exec(bp);
    if (!m || Number(m[1]) <= Number(m[2])) throw new NoteError("invalid_vitals");
    vitals.bloodPressure = bp;
  }
  for (const [key, [min, max]] of Object.entries(RANGES) as [keyof typeof RANGES, [number, number]][]) {
    const value = blank(raw[key])?.replace(",", ".");
    if (!value) continue;
    const n = Number(value);
    if (!Number.isFinite(n) || n < min || n > max) throw new NoteError("invalid_vitals");
    vitals[key] = n;
  }
  return vitals;
}

// What a signature covers. Recomputing it later proves the stored note
// is the one the doctor signed.
export function contentHash(note: Pick<Note, "id" | "clientId" | "practitionerId" | "subjective" | "objective" | "vitals" | "assessment" | "diagnosisCodes" | "plan">, signedBy: string, signedAt: Date) {
  const content = {
    id: note.id,
    clientId: note.clientId,
    practitionerId: note.practitionerId,
    subjective: note.subjective ?? null,
    objective: note.objective ?? null,
    vitals: note.vitals ?? null,
    assessment: note.assessment ?? null,
    diagnosisCodes: note.diagnosisCodes,
    plan: note.plan ?? null,
    signedBy,
    signedAt: signedAt.toISOString(),
  };
  return createHash("sha256").update(JSON.stringify(content)).digest("hex");
}

function requireClinical(actor: Actor) {
  if (!can(actor, "chart.clinical")) throw new NoteError("forbidden");
}

function writer(actor: Actor) {
  if (!can(actor, "notes.write") || !actor.practitionerId) throw new NoteError("forbidden");
  return actor.practitionerId;
}

async function log(
  exec: Pick<typeof db, "insert">,
  actor: Actor,
  clientId: string,
  action: "create_note" | "sign_note" | "add_addendum" | "print_note",
) {
  await exec.insert(schema.accessLog).values({
    businessId: actor.business.id,
    clientId,
    userId: actor.profile.id,
    practitionerId: actor.practitionerId,
    action,
  });
}

export async function listNotes(actor: Actor, clientId: string) {
  requireClinical(actor);
  return db
    .select({
      id: schema.clinicalNotes.id,
      number: schema.clinicalNotes.number,
      status: schema.clinicalNotes.status,
      createdAt: schema.clinicalNotes.createdAt,
      signedAt: schema.clinicalNotes.signedAt,
      diagnosisCodes: schema.clinicalNotes.diagnosisCodes,
      practitionerId: schema.clinicalNotes.practitionerId,
      practitionerName: schema.practitioners.displayName,
      addenda: sql<number>`(select count(*)::int from ${schema.noteAddenda} where ${schema.noteAddenda.noteId} = ${schema.clinicalNotes.id})`,
    })
    .from(schema.clinicalNotes)
    .innerJoin(schema.practitioners, eq(schema.practitioners.id, schema.clinicalNotes.practitionerId))
    .where(and(eq(schema.clinicalNotes.businessId, actor.business.id), eq(schema.clinicalNotes.clientId, clientId)))
    .orderBy(desc(schema.clinicalNotes.createdAt));
}

export async function getNote(actor: Actor, noteId: string) {
  requireClinical(actor);
  const [row] = await db
    .select({ note: schema.clinicalNotes, practitioner: schema.practitioners, client: schema.clients })
    .from(schema.clinicalNotes)
    .innerJoin(schema.practitioners, eq(schema.practitioners.id, schema.clinicalNotes.practitionerId))
    .innerJoin(schema.clients, eq(schema.clients.id, schema.clinicalNotes.clientId))
    .where(and(eq(schema.clinicalNotes.id, noteId), eq(schema.clinicalNotes.businessId, actor.business.id)));
  if (!row) return null;
  const [addenda, signer] = await Promise.all([
    db
      .select({
        id: schema.noteAddenda.id,
        body: schema.noteAddenda.body,
        createdAt: schema.noteAddenda.createdAt,
        authorEmail: schema.profiles.email,
        authorName: schema.profiles.fullName,
        practitionerName: schema.practitioners.displayName,
      })
      .from(schema.noteAddenda)
      .innerJoin(schema.profiles, eq(schema.profiles.id, schema.noteAddenda.authorId))
      .leftJoin(schema.practitioners, eq(schema.practitioners.id, schema.noteAddenda.practitionerId))
      .where(eq(schema.noteAddenda.noteId, noteId))
      .orderBy(asc(schema.noteAddenda.createdAt)),
    row.note.signedBy
      ? db.select().from(schema.profiles).where(eq(schema.profiles.id, row.note.signedBy)).then((r) => r[0] ?? null)
      : null,
  ]);
  const appointment = row.note.appointmentId
    ? await db
        .select({ startsAt: schema.appointments.startsAt, serviceName: schema.services.name })
        .from(schema.appointments)
        .innerJoin(schema.services, eq(schema.services.id, schema.appointments.serviceId))
        .where(eq(schema.appointments.id, row.note.appointmentId))
        .then((r) => r[0] ?? null)
    : null;
  return { ...row, addenda, signer, appointment };
}

// Starts a draft for the doctor, optionally tied to one of the patient's
// appointments; a draft already open for that appointment is reused.
export async function createNote(actor: Actor, clientId: string, appointmentId: string | null = null) {
  const practitionerId = writer(actor);
  const [client] = await db
    .select({ id: schema.clients.id })
    .from(schema.clients)
    .where(and(eq(schema.clients.id, clientId), eq(schema.clients.businessId, actor.business.id)));
  if (!client) throw new NoteError("not_found");
  if (appointmentId) {
    const [appointment] = await db
      .select({ id: schema.appointments.id })
      .from(schema.appointments)
      .where(and(eq(schema.appointments.id, appointmentId), eq(schema.appointments.clientId, clientId)));
    if (!appointment) throw new NoteError("unknown_appointment");
    const [open] = await db
      .select({ id: schema.clinicalNotes.id })
      .from(schema.clinicalNotes)
      .where(
        and(
          eq(schema.clinicalNotes.appointmentId, appointmentId),
          eq(schema.clinicalNotes.practitionerId, practitionerId),
          eq(schema.clinicalNotes.status, "draft"),
        ),
      );
    if (open) return open.id;
  }
  return db.transaction(async (tx) => {
    const [note] = await tx
      .insert(schema.clinicalNotes)
      .values({ businessId: actor.business.id, clientId, practitionerId, appointmentId, createdBy: actor.profile.id })
      .returning({ id: schema.clinicalNotes.id });
    await log(tx, actor, clientId, "create_note");
    return note.id;
  });
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// The doctor's own draft, locked when read inside a transaction.
async function ownDraft(actor: Actor, noteId: string, tx?: Tx) {
  const practitionerId = writer(actor);
  const query = (tx ?? db)
    .select()
    .from(schema.clinicalNotes)
    .where(and(eq(schema.clinicalNotes.id, noteId), eq(schema.clinicalNotes.businessId, actor.business.id)));
  const [note] = tx ? await query.for("update") : await query;
  if (!note) throw new NoteError("not_found");
  if (note.practitionerId !== practitionerId) throw new NoteError("not_your_note");
  if (note.status !== "draft") throw new NoteError("not_draft");
  return note;
}

export async function saveDraft(actor: Actor, noteId: string, input: DraftInput) {
  await ownDraft(actor, noteId);
  const codes = [...new Set(input.diagnosisCodes.map((c) => c.trim().toUpperCase()).filter(Boolean))];
  if (codes.some((c) => !isCode(c))) throw new NoteError("unknown_code");
  await db
    .update(schema.clinicalNotes)
    .set({
      subjective: blank(input.subjective),
      objective: blank(input.objective),
      vitals: parseVitals(input.vitals),
      assessment: blank(input.assessment),
      diagnosisCodes: codes,
      plan: blank(input.plan),
    })
    .where(and(eq(schema.clinicalNotes.id, noteId), eq(schema.clinicalNotes.status, "draft")));
}

export async function deleteDraft(actor: Actor, noteId: string) {
  await ownDraft(actor, noteId);
  await db.delete(schema.clinicalNotes).where(and(eq(schema.clinicalNotes.id, noteId), eq(schema.clinicalNotes.status, "draft")));
}

// Only the note's own doctor signs it. The database numbers and locks it.
export async function signNote(actor: Actor, noteId: string, now = new Date()) {
  // Whole seconds, so the stored time hashes the same when read back.
  const signedAt = new Date(Math.floor(now.getTime() / 1000) * 1000);
  return db.transaction(async (tx) => {
    // Locked, so a save can't land between hashing and signing.
    const note = await ownDraft(actor, noteId, tx);
    if (![note.subjective, note.objective, note.assessment, note.plan].some((s) => s?.trim())) {
      throw new NoteError("empty_note");
    }
    const [signed] = await tx
      .update(schema.clinicalNotes)
      .set({
        status: "signed",
        signedAt,
        signedBy: actor.profile.id,
        contentHash: contentHash(note, actor.profile.id, signedAt),
      })
      .where(and(eq(schema.clinicalNotes.id, noteId), eq(schema.clinicalNotes.status, "draft")))
      .returning();
    if (!signed) throw new NoteError("not_draft");
    await log(tx, actor, note.clientId, "sign_note");
    return signed;
  });
}

// Whether a signed note still matches its signature.
export function verifySignature(note: Note) {
  if (note.status !== "signed" || !note.signedBy || !note.signedAt || !note.contentHash) return false;
  return contentHash(note, note.signedBy, note.signedAt) === note.contentHash;
}

// Any doctor in the clinic can add a dated addendum to a signed note.
export async function addAddendum(actor: Actor, noteId: string, body: string, now = new Date()) {
  if (!can(actor, "notes.write")) throw new NoteError("forbidden");
  const text = body.trim();
  if (!text) throw new NoteError("empty_addendum");
  const [note] = await db
    .select({ clientId: schema.clinicalNotes.clientId, status: schema.clinicalNotes.status })
    .from(schema.clinicalNotes)
    .where(and(eq(schema.clinicalNotes.id, noteId), eq(schema.clinicalNotes.businessId, actor.business.id)));
  if (!note) throw new NoteError("not_found");
  if (note.status !== "signed") throw new NoteError("not_draft");
  const hash = createHash("sha256")
    .update(JSON.stringify({ noteId, authorId: actor.profile.id, body: text, at: now.toISOString() }))
    .digest("hex");
  await db.transaction(async (tx) => {
    await tx.insert(schema.noteAddenda).values({
      businessId: actor.business.id,
      noteId,
      authorId: actor.profile.id,
      practitionerId: actor.practitionerId,
      body: text,
      contentHash: hash,
      createdAt: now,
    });
    await log(tx, actor, note.clientId, "add_addendum");
  });
}

export async function logNotePrint(actor: Actor, clientId: string) {
  requireClinical(actor);
  await log(db, actor, clientId, "print_note");
}
