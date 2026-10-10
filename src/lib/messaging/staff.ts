import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { replyEligibility } from "./eligibility";
import { createHash, randomUUID } from "node:crypto";
import { conversationId } from "@/lib/household";
import { sendText } from "@/lib/kapso/client";

// WhatsApp only allows free-form messages within 24 hours of the client's
// last message; outside it, only approved templates can be sent.


export type StaffReplyResult = { ok: true } | { ok: false; reason: "not_found" | "not_connected" | "window_closed" | "empty" | "no_whatsapp" | "send_uncertain" | "pending_send" | "attempt_changed" | "merged" | "archived" };

// A person from the business writes to the client. The agent is paused so it
// does not talk over them; staff can resume it from the client page.
export async function sendStaffReply(input: {
  business: typeof schema.businesses.$inferSelect;
  clientId: string;
  text: string;
  sentBy: string;
  now?: Date;
  attemptId?: string;
}): Promise<StaffReplyResult> {
  const text = input.text.trim();
  if (!text) return { ok: false, reason: "empty" };
  if (!input.business.phoneNumberId) return { ok: false, reason: "not_connected" };
  const [patient] = await db
    .select()
    .from(schema.clients)
    .where(and(eq(schema.clients.id, input.clientId), eq(schema.clients.businessId, input.business.id)));
  if (!patient) return { ok: false, reason: "not_found" };
  if (patient.mergedIntoId) return { ok: false, reason: "merged" };
  if (patient.archivedAt) return { ok: false, reason: "archived" };
  // A patient sharing a number is written to through its holder's conversation.
  const [client] = patient.holderId
    ? await db.select().from(schema.clients).where(and(eq(schema.clients.id, conversationId(patient)), eq(schema.clients.businessId, input.business.id)))
    : [patient];
  if (!client?.waPhone) return { ok: false, reason: "no_whatsapp" };

  const [lastInbound] = await db
    .select({ createdAt: schema.messages.createdAt })
    .from(schema.messages)
    .where(and(eq(schema.messages.clientId, client.id), eq(schema.messages.direction, "inbound")))
    .orderBy(desc(schema.messages.createdAt))
    .limit(1);
  const now = input.now ?? new Date();
  const eligibility = replyEligibility(!!input.business.phoneNumberId, client.waPhone, lastInbound?.createdAt ?? null, now);
  if (eligibility.reason) return { ok: false, reason: eligibility.reason };

  const attemptId = input.attemptId ?? randomUUID();
  const contentHash = createHash("sha256").update(`${attemptId}:${text}`).digest("hex");
  const [claim] = await db.insert(schema.staffReplyAttempts).values({ id: attemptId, businessId: input.business.id, clientId: client.id, sentBy: input.sentBy, contentHash }).onConflictDoNothing().returning();
  if (!claim) {
    const [previous] = await db.select().from(schema.staffReplyAttempts).where(and(eq(schema.staffReplyAttempts.id, attemptId), eq(schema.staffReplyAttempts.businessId, input.business.id), eq(schema.staffReplyAttempts.clientId, client.id), eq(schema.staffReplyAttempts.sentBy, input.sentBy)));
    if (previous && previous.contentHash !== contentHash) return { ok: false, reason: "attempt_changed" };
    return previous?.status === "sent" ? { ok: true } : { ok: false, reason: previous?.status === "uncertain" ? "send_uncertain" : "pending_send" };
  }
  await db.update(schema.clients).set({ agentPaused: true }).where(eq(schema.clients.id, client.id));
  try {
    const kapsoMessageId = await sendText(input.business.phoneNumberId, client.waPhone, text);
    await db.transaction(async tx => {
      await tx.insert(schema.messages).values({ businessId: input.business.id, clientId: client.id, direction: "outbound", kapsoMessageId, type: "text", body: text, payload: { sentBy: input.sentBy }, createdAt: now });
      // An inbound arriving during the send still needs a response.
      const [newer] = await tx.select({ id: schema.messages.id }).from(schema.messages).where(and(eq(schema.messages.clientId, client.id), eq(schema.messages.direction, "inbound"), sql`${schema.messages.createdAt} > ${lastInbound!.createdAt.toISOString()}::timestamptz`)).limit(1);
      await tx.update(schema.clients).set({ attentionStatus: newer ? "needs_reply" : "follow_up", attentionSince: sql`coalesce(${schema.clients.attentionSince}, ${now.toISOString()}::timestamptz)` }).where(eq(schema.clients.id, client.id));
      await tx.update(schema.staffReplyAttempts).set({ status: "sent" }).where(eq(schema.staffReplyAttempts.id, attemptId));
    });
    return { ok: true };
  } catch {
    // A timeout does not prove the provider rejected a message: never retry this claim blindly.
    await db.update(schema.staffReplyAttempts).set({ status: "uncertain" }).where(eq(schema.staffReplyAttempts.id, attemptId));
    return { ok: false, reason: "send_uncertain" };
  }
}
