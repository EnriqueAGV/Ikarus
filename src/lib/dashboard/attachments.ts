import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, notInArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { decryptBytes, encryptBytes } from "@/lib/crypto";
import { can } from "@/lib/permissions";
import { fileStore } from "@/lib/storage";
import type { Actor } from "./patients";

// Lab results, images and other documents on a patient's record, for the
// clinic's doctors only. Each file is encrypted before it is stored, bound
// to its own row, and every opening is logged.

export class AttachmentError extends Error {
  constructor(readonly code: "forbidden" | "not_found" | "empty_file" | "file_too_large" | "file_type" | "unknown_appointment") {
    super(code);
  }
}

// Vercel accepts request bodies up to 4.5 MB, multipart overhead included.
export const MAX_BYTES = 4 * 1024 * 1024;
export const ACCEPTED_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
type Kind = (typeof schema.attachmentKind.enumValues)[number];
const CANCELLED = ["cancelled_by_client", "cancelled_by_business", "auto_cancelled"] as const;

const context = (attachmentId: string) => `attachments.file:${attachmentId}`;

function requireDoctor(actor: Actor) {
  if (!can(actor, "chart.clinical")) throw new AttachmentError("forbidden");
}

async function log(actor: Actor, clientId: string, action: "upload_attachment" | "view_attachment" | "delete_attachment") {
  await db.insert(schema.accessLog).values({
    businessId: actor.business.id,
    clientId,
    userId: actor.profile.id,
    practitionerId: actor.practitionerId,
    action,
  });
}

export async function uploadAttachment(
  actor: Actor,
  clientId: string,
  input: { file: File; kind: Kind; appointmentId: string | null },
) {
  requireDoctor(actor);
  const { file } = input;
  if (!file || file.size === 0) throw new AttachmentError("empty_file");
  if (file.size > MAX_BYTES) throw new AttachmentError("file_too_large");
  if (!ACCEPTED_TYPES.includes(file.type)) throw new AttachmentError("file_type");
  const [client] = await db
    .select({ id: schema.clients.id, mergedIntoId: schema.clients.mergedIntoId })
    .from(schema.clients)
    .where(and(eq(schema.clients.id, clientId), eq(schema.clients.businessId, actor.business.id)));
  if (!client || client.mergedIntoId) throw new AttachmentError("not_found");
  if (input.appointmentId) {
    const [appointment] = /^[0-9a-f-]{36}$/i.test(input.appointmentId)
      ? await db
          .select({ id: schema.appointments.id })
          .from(schema.appointments)
          .where(
            and(
              eq(schema.appointments.id, input.appointmentId),
              eq(schema.appointments.clientId, clientId),
              notInArray(schema.appointments.status, [...CANCELLED]),
            ),
          )
      : [];
    if (!appointment) throw new AttachmentError("unknown_appointment");
  }

  const id = randomUUID();
  const storagePath = `${actor.business.id}/${clientId}/${id}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  await fileStore().put(storagePath, encryptBytes(bytes, context(id)));
  const [attachment] = await db
    .insert(schema.attachments)
    .values({
      id,
      businessId: actor.business.id,
      clientId,
      appointmentId: input.appointmentId,
      kind: input.kind,
      fileName: (file.name || "archivo").slice(0, 200),
      contentType: file.type,
      sizeBytes: file.size,
      storagePath,
      uploadedBy: actor.profile.id,
    })
    .returning();
  await log(actor, clientId, "upload_attachment");
  return attachment;
}

export async function listAttachments(actor: Actor, clientIds: string[]) {
  requireDoctor(actor);
  return db
    .select({
      id: schema.attachments.id,
      clientId: schema.attachments.clientId,
      kind: schema.attachments.kind,
      fileName: schema.attachments.fileName,
      contentType: schema.attachments.contentType,
      sizeBytes: schema.attachments.sizeBytes,
      createdAt: schema.attachments.createdAt,
      appointmentStartsAt: schema.appointments.startsAt,
      uploaderName: schema.profiles.fullName,
      uploaderEmail: schema.profiles.email,
    })
    .from(schema.attachments)
    .innerJoin(schema.profiles, eq(schema.profiles.id, schema.attachments.uploadedBy))
    .leftJoin(schema.appointments, eq(schema.appointments.id, schema.attachments.appointmentId))
    .where(
      and(
        eq(schema.attachments.businessId, actor.business.id),
        inArray(schema.attachments.clientId, clientIds),
        isNull(schema.attachments.deletedAt),
      ),
    )
    .orderBy(desc(schema.attachments.createdAt));
}

async function find(actor: Actor, attachmentId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(attachmentId)) throw new AttachmentError("not_found");
  const [attachment] = await db
    .select()
    .from(schema.attachments)
    .where(
      and(
        eq(schema.attachments.id, attachmentId),
        eq(schema.attachments.businessId, actor.business.id),
        isNull(schema.attachments.deletedAt),
      ),
    );
  if (!attachment) throw new AttachmentError("not_found");
  return attachment;
}

// The decrypted file, for a doctor opening it. Logged.
export async function readAttachment(actor: Actor, attachmentId: string) {
  requireDoctor(actor);
  const attachment = await find(actor, attachmentId);
  const bytes = decryptBytes(await fileStore().get(attachment.storagePath), context(attachment.id));
  await log(actor, attachment.clientId, "view_attachment");
  return { attachment, bytes };
}

// Taken off the record. The encrypted file and the row stay, since the
// record must be kept; it just no longer shows.
export async function removeAttachment(actor: Actor, attachmentId: string, now = new Date()) {
  requireDoctor(actor);
  const attachment = await find(actor, attachmentId);
  await db.update(schema.attachments).set({ deletedAt: now }).where(eq(schema.attachments.id, attachment.id));
  await log(actor, attachment.clientId, "delete_attachment");
  return attachment;
}
