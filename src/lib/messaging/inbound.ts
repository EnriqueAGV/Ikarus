import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { holderOfNumber } from "@/lib/household";

// Shape of Kapso's whatsapp.message.received payload, limited to what we read.
export type KapsoInbound = {
  phone_number_id: string;
  message: {
    id: string;
    from?: string;
    type: string;
    text?: { body?: string };
    interactive?: {
      type?: string;
      button_reply?: { id?: string; title?: string };
      list_reply?: { id?: string; title?: string };
    };
    // Quick-reply taps on a template arrive as type "button".
    button?: { text?: string; payload?: string };
    kapso?: { content?: string; origin?: string; transcript?: { text?: string } };
  };
  conversation?: { phone_number?: string; contact_name?: string | null };
};

// A buffered delivery wraps several payloads in { batch: true, data: [...] }.
export function unwrapBatch(body: unknown): KapsoInbound[] {
  const batch = body as { batch?: boolean; data?: unknown };
  if (batch?.batch && Array.isArray(batch.data)) return batch.data as KapsoInbound[];
  return [body as KapsoInbound];
}

// The words a client sent, whatever the message type.
export function messageText(m: KapsoInbound["message"]): string | null {
  return (
    m.text?.body ??
    m.interactive?.button_reply?.title ??
    m.interactive?.list_reply?.title ??
    m.button?.text ??
    m.kapso?.transcript?.text ??
    m.kapso?.content ??
    null
  );
}

function senderPhone(p: KapsoInbound) {
  const raw = p.message.from ?? p.conversation?.phone_number ?? "";
  return raw.replace(/\D/g, "");
}

export type StoredInbound = { businessId: string; clientId: string; messageId: string };

// Saves one inbound message and its client. Returns null when the number is
// not one of ours or the message is an old one replayed by a history sync.
export async function storeInbound(p: KapsoInbound): Promise<StoredInbound | null> {
  if (p.message.kapso?.origin === "history_sync") return null;
  const phone = senderPhone(p);
  if (!phone) return null;

  const [business] = await db
    .select()
    .from(schema.businesses)
    .where(eq(schema.businesses.phoneNumberId, p.phone_number_id));
  if (!business) return null;

  await db
    .insert(schema.clients)
    .values({
      businessId: business.id,
      waPhone: phone,
      name: p.conversation?.contact_name || null,
    })
    .onConflictDoNothing();
  // The conversation belongs to the number's holder, whoever else shares it.
  const client = (await holderOfNumber(business.id, phone))!;

  const [message] = await db
    .insert(schema.messages)
    .values({
      businessId: business.id,
      clientId: client.id,
      direction: "inbound",
      kapsoMessageId: p.message.id,
      type: p.message.type,
      body: messageText(p.message),
      payload: p.message,
    })
    .returning();

  return { businessId: business.id, clientId: client.id, messageId: message.id };
}
