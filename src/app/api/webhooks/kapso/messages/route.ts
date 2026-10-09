import { env } from "@/lib/env";
import { receiveKapsoWebhook } from "@/lib/kapso/receive";

// Client messages for every connected business number. Milestone 3 hands
// them to the booking agent; for now deliveries are verified and acknowledged.
export async function POST(request: Request) {
  const received = await receiveKapsoWebhook(request, env.KAPSO_MESSAGE_WEBHOOK_SECRET);
  if (received.kind !== "accepted") return received.response;
  return new Response("ok");
}
