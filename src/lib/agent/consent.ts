import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { env } from "@/lib/env";
import { sendButtons } from "@/lib/kapso/client";
import type { Business, Client } from "./context";

// Bump when the privacy notice changes: every patient is asked again.
// The text at /privacidad is a draft until a Salvadoran lawyer reviews it.
export const NOTICE_VERSION = "2026-10-borrador";
export const CONSENT_PAYLOAD = "consent:accept";

type StoredMessage = typeof schema.messages.$inferSelect;

export function consentRequest(business: { id: string; name: string }) {
  return (
    `Gracias por escribir a ${business.name}. Antes de atenderle por este medio necesitamos su autorización ` +
    `para guardar y usar sus datos personales y de salud, solo para su atención y sus citas, como explica ` +
    `nuestro aviso de privacidad: ${env.APP_URL}/privacidad/${business.id}\n\n` +
    `Si está de acuerdo, toque "Acepto" o escriba ACEPTO.`
  );
}

function normalized(text: string | null) {
  return (text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z ]/g, "")
    .trim();
}

export function isAcceptance(m: Pick<StoredMessage, "body" | "payload">) {
  const p = m.payload as { interactive?: { button_reply?: { id?: string } } } | null;
  if (p?.interactive?.button_reply?.id === CONSENT_PAYLOAD) return true;
  return ["acepto", "si acepto", "si, acepto"].includes(normalized(m.body));
}

function isConsentRequest(m: StoredMessage) {
  return typeof m.payload === "object" && m.payload !== null && "consentRequest" in m.payload;
}

export async function hasConsent(clientId: string) {
  const [row] = await db
    .select({ id: schema.consents.id })
    .from(schema.consents)
    .where(and(eq(schema.consents.clientId, clientId), eq(schema.consents.noticeVersion, NOTICE_VERSION)));
  return Boolean(row);
}

// Health data needs the patient's express consent (Ley para la Protección de
// Datos Personales, Art. 4) before the assistant handles it. Whether a tap on
// WhatsApp counts as "written" consent is an open question for the lawyer. Returns "consented"
// when the agent may go on, "requested" when it asked and must wait, and
// "waiting" when the request already covers these messages.
export async function ensureConsent(business: Business, client: Client): Promise<"consented" | "requested" | "waiting"> {
  if (await hasConsent(client.id)) return "consented";
  const recent = await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.clientId, client.id))
    .orderBy(desc(schema.messages.createdAt))
    .limit(30);
  const lastOutbound = recent.findIndex((m) => m.direction === "outbound");
  const unanswered = (lastOutbound === -1 ? recent : recent.slice(0, lastOutbound)).filter((m) => m.direction === "inbound");
  if (unanswered.length === 0) return "waiting";

  // An acceptance only counts after the patient was shown the notice.
  const asked = recent.some((m) => m.direction === "outbound" && isConsentRequest(m));
  const acceptance = asked ? unanswered.find(isAcceptance) : undefined;
  if (acceptance) {
    await db
      .insert(schema.consents)
      .values({ businessId: business.id, clientId: client.id, noticeVersion: NOTICE_VERSION, messageId: acceptance.id })
      .onConflictDoNothing();
    return "consented";
  }

  const body = consentRequest(business);
  const kapsoMessageId = await sendButtons(business.phoneNumberId!, client.waPhone!, body, [
    { id: CONSENT_PAYLOAD, title: "Acepto" },
  ]);
  await db.insert(schema.messages).values({
    businessId: business.id,
    clientId: client.id,
    direction: "outbound",
    kapsoMessageId,
    type: "interactive",
    body,
    payload: { consentRequest: NOTICE_VERSION },
  });
  return "requested";
}
