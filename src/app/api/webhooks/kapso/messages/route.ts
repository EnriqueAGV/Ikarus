import { inngest } from "@/inngest/client";
import { env } from "@/lib/env";
import { receiveKapsoWebhook } from "@/lib/kapso/receive";
import { messageText, storeInbound, unwrapBatch } from "@/lib/messaging/inbound";
import { applyReminderReply } from "@/lib/reminders";

// Client messages for every connected business number. Messages are stored
// right away; the agent answers in a background Inngest function, one
// conversation at a time.
export async function POST(request: Request) {
  const received = await receiveKapsoWebhook(request, env.KAPSO_MESSAGE_WEBHOOK_SECRET);
  if (received.kind !== "accepted") return received.response;
  if (received.event !== "whatsapp.message.received") return new Response("ok");

  const clients = new Map<string, { businessId: string; clientId: string }>();
  for (const payload of unwrapBatch(received.payload)) {
    const stored = await storeInbound(payload);
    if (!stored) continue;
    clients.set(stored.clientId, { businessId: stored.businessId, clientId: stored.clientId });
    // Before the agent runs, so it already sees the appointment as confirmed.
    await applyReminderReply(stored.clientId, { body: messageText(payload.message), payload: payload.message });
  }

  if (clients.size) {
    // Any reply stops pending reminder flows for that client.
    await inngest.send(
      [...clients.values()].flatMap((c) => [
        { name: "whatsapp/message.received", data: c },
        { name: "client/replied", data: c },
      ]),
    );
  }
  return new Response("ok");
}
