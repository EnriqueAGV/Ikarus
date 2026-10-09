import { inngest } from "@/inngest/client";
import { env } from "@/lib/env";
import { receiveKapsoWebhook } from "@/lib/kapso/receive";
import { storeInbound, unwrapBatch } from "@/lib/messaging/inbound";

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
    if (stored) clients.set(stored.clientId, { businessId: stored.businessId, clientId: stored.clientId });
  }

  if (clients.size) {
    await inngest.send(
      [...clients.values()].map((c) => ({ name: "whatsapp/message.received", data: c })),
    );
  }
  return new Response("ok");
}
