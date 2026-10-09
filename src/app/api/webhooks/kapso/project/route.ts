import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { env } from "@/lib/env";
import { receiveKapsoWebhook } from "@/lib/kapso/receive";
import { connectPhoneNumber } from "@/lib/onboarding";

type PhoneNumberEvent = {
  phone_number_id: string;
  customer?: { id: string } | null;
};

export async function POST(request: Request) {
  const received = await receiveKapsoWebhook(request, env.KAPSO_PROJECT_WEBHOOK_SECRET);
  if (received.kind !== "accepted") return received.response;

  const payload = received.payload as PhoneNumberEvent;
  if (received.event === "whatsapp.phone_number.created") {
    const result = await connectPhoneNumber({
      phoneNumberId: payload.phone_number_id,
      kapsoCustomerId: payload.customer?.id,
    });
    if (!result.ok) console.warn("Kapso number not matched", payload, result.reason);
  } else if (received.event === "whatsapp.phone_number.deleted") {
    await db
      .update(schema.businesses)
      .set({ status: "invited", phoneNumberId: null, kapsoMessageWebhookId: null })
      .where(eq(schema.businesses.phoneNumberId, payload.phone_number_id));
  }
  return new Response("ok");
}
