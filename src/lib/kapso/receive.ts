import { db, schema } from "@/db";
import { verifyKapsoSignature } from "./webhook";

export type ReceivedWebhook =
  | { kind: "rejected"; response: Response }
  | { kind: "duplicate"; response: Response }
  | { kind: "accepted"; event: string; payload: unknown };

// Verifies the signature and records the idempotency key. Only "accepted"
// deliveries should be processed; the others carry the response to return.
export async function receiveKapsoWebhook(
  request: Request,
  secret: string | undefined,
): Promise<ReceivedWebhook> {
  const raw = await request.text();
  if (
    !secret ||
    !verifyKapsoSignature(raw, request.headers.get("x-webhook-signature"), secret)
  ) {
    return { kind: "rejected", response: new Response("invalid signature", { status: 401 }) };
  }

  const event = request.headers.get("x-webhook-event") ?? "unknown";
  const key = request.headers.get("x-idempotency-key");
  if (key) {
    const [fresh] = await db
      .insert(schema.webhookEvents)
      .values({ idempotencyKey: key, event })
      .onConflictDoNothing()
      .returning();
    if (!fresh) return { kind: "duplicate", response: new Response("ok") };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return { kind: "rejected", response: new Response("invalid json", { status: 400 }) };
  }
  return { kind: "accepted", event, payload };
}
