import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { conversationId } from "@/lib/household";
import { sendText } from "@/lib/kapso/client";

// WhatsApp only allows free-form messages within 24 hours of the client's
// last message; outside it, only approved templates can be sent.
const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export type StaffReplyResult = { ok: true } | { ok: false; reason: "not_found" | "not_connected" | "window_closed" | "empty" | "no_whatsapp" };

// A person from the business writes to the client. The agent is paused so it
// does not talk over them; staff can resume it from the client page.
export async function sendStaffReply(input: {
  business: typeof schema.businesses.$inferSelect;
  clientId: string;
  text: string;
  sentBy: string;
  now?: Date;
}): Promise<StaffReplyResult> {
  const text = input.text.trim();
  if (!text) return { ok: false, reason: "empty" };
  if (!input.business.phoneNumberId) return { ok: false, reason: "not_connected" };
  const [patient] = await db
    .select()
    .from(schema.clients)
    .where(and(eq(schema.clients.id, input.clientId), eq(schema.clients.businessId, input.business.id)));
  if (!patient) return { ok: false, reason: "not_found" };
  // A patient sharing a number is written to through its holder's conversation.
  const [client] = patient.holderId
    ? await db.select().from(schema.clients).where(eq(schema.clients.id, conversationId(patient)))
    : [patient];
  if (!client.waPhone) return { ok: false, reason: "no_whatsapp" };

  const [lastInbound] = await db
    .select({ createdAt: schema.messages.createdAt })
    .from(schema.messages)
    .where(and(eq(schema.messages.clientId, client.id), eq(schema.messages.direction, "inbound")))
    .orderBy(desc(schema.messages.createdAt))
    .limit(1);
  const now = input.now ?? new Date();
  if (!lastInbound || now.getTime() - lastInbound.createdAt.getTime() > SERVICE_WINDOW_MS) {
    return { ok: false, reason: "window_closed" };
  }

  await db.update(schema.clients).set({ agentPaused: true }).where(eq(schema.clients.id, client.id));
  const kapsoMessageId = await sendText(input.business.phoneNumberId, client.waPhone, text);
  await db.insert(schema.messages).values({
    businessId: input.business.id,
    clientId: client.id,
    direction: "outbound",
    kapsoMessageId,
    type: "text",
    body: text,
    payload: { sentBy: input.sentBy },
    createdAt: now,
  });
  return { ok: true };
}
