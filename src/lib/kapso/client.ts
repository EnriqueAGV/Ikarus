import { env } from "@/lib/env";

// Thin wrapper over the Kapso Platform API and its Meta Cloud API proxy.
// Every call authenticates with the one project API key.

export class KapsoError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
  }
}

const GRAPH_VERSION = "v24.0";

async function kapso<T>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  if (!env.KAPSO_API_KEY) throw new Error("KAPSO_API_KEY is not set");
  const res = await fetch(`${env.KAPSO_API_BASE_URL}${path}`, {
    method,
    headers: {
      "X-API-Key": env.KAPSO_API_KEY,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const detail =
      typeof json?.error === "string"
        ? json.error
        : (json?.error?.message ?? res.statusText);
    throw new KapsoError(`Kapso ${method} ${path}: ${detail}`, res.status, json);
  }
  return json as T;
}

export type KapsoCustomer = { id: string; name: string };
export type KapsoSetupLink = {
  id: string;
  url: string;
  status: string;
  expires_at: string;
};
export type KapsoPhoneNumber = {
  phone_number_id: string;
  business_account_id: string | null;
  customer_id: string | null;
  display_phone_number: string | null;
  verified_name?: string | null;
  status?: string | null;
};
export type KapsoWebhook = {
  id: string;
  url: string;
  events: string[];
  phone_number_id?: string | null;
};
export type MetaTemplate = {
  id: string;
  name: string;
  language: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "DISABLED" | string;
  rejected_reason?: string;
};

export function createCustomer(name: string, externalId: string) {
  return kapso<{ data: KapsoCustomer }>("POST", "/platform/v1/customers", {
    customer: { name, external_customer_id: externalId },
  }).then((r) => r.data);
}

export function createSetupLink(customerId: string) {
  return kapso<{ data: KapsoSetupLink }>(
    "POST",
    `/platform/v1/customers/${customerId}/setup_links`,
    {
      setup_link: {
        success_redirect_url: `${env.APP_URL}/onboarding/success`,
        failure_redirect_url: `${env.APP_URL}/onboarding/failed`,
        meta_billing_mode: "partner_managed",
        language: "es",
      },
    },
  ).then((r) => r.data);
}

export function getPhoneNumber(phoneNumberId: string) {
  return kapso<{ data: KapsoPhoneNumber }>(
    "GET",
    `/platform/v1/whatsapp/phone_numbers/${phoneNumberId}`,
  ).then((r) => r.data);
}

export function listProjectWebhooks() {
  return kapso<{ data: KapsoWebhook[] }>(
    "GET",
    "/platform/v1/whatsapp/webhooks",
  ).then((r) => r.data);
}

export function createProjectWebhook(url: string, secret: string) {
  return kapso<{ data: KapsoWebhook }>("POST", "/platform/v1/whatsapp/webhooks", {
    whatsapp_webhook: {
      url,
      secret_key: secret,
      events: ["whatsapp.phone_number.created", "whatsapp.phone_number.deleted"],
      active: true,
    },
  }).then((r) => r.data);
}

export function createPhoneNumberWebhook(
  phoneNumberId: string,
  url: string,
  secret: string,
) {
  return kapso<{ data: KapsoWebhook }>(
    "POST",
    `/platform/v1/whatsapp/phone_numbers/${phoneNumberId}/webhooks`,
    {
      whatsapp_webhook: {
        url,
        secret_key: secret,
        events: ["whatsapp.message.received", "whatsapp.message.failed"],
        active: true,
        // Merge quick bursts ("hola" / "quiero una cita") into one delivery.
        buffer_enabled: true,
        buffer_events: ["whatsapp.message.received"],
        buffer_window_seconds: 5,
      },
    },
  ).then((r) => r.data);
}

export function createMessageTemplate(wabaId: string, template: unknown) {
  return kapso<{ id: string; status: string }>(
    "POST",
    `/meta/whatsapp/${GRAPH_VERSION}/${wabaId}/message_templates`,
    template,
  );
}

export function listMessageTemplates(wabaId: string) {
  return kapso<{ data: MetaTemplate[] }>(
    "GET",
    `/meta/whatsapp/${GRAPH_VERSION}/${wabaId}/message_templates?limit=100`,
  ).then((r) => r.data);
}

export function sendText(phoneNumberId: string, to: string, body: string) {
  return kapso<{ messages?: { id: string }[] }>(
    "POST",
    `/meta/whatsapp/${GRAPH_VERSION}/${phoneNumberId}/messages`,
    { messaging_product: "whatsapp", to, type: "text", text: { body } },
  ).then((r) => r.messages?.[0]?.id ?? null);
}

// A map pin; WhatsApp shows the name and address under it.
export function sendLocation(
  phoneNumberId: string,
  to: string,
  location: { latitude: number; longitude: number; name: string; address?: string | null },
) {
  return kapso<{ messages?: { id: string }[] }>(
    "POST",
    `/meta/whatsapp/${GRAPH_VERSION}/${phoneNumberId}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "location",
      location: { ...location, address: location.address ?? undefined },
    },
  ).then((r) => r.messages?.[0]?.id ?? null);
}

// Marks the patient's message as read and shows "escribiendo…" until the
// next message is sent, or for at most 25 seconds.
export function sendTyping(phoneNumberId: string, messageId: string) {
  return kapso<unknown>("POST", `/meta/whatsapp/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
    messaging_product: "whatsapp",
    status: "read",
    message_id: messageId,
    typing_indicator: { type: "text" },
  });
}

export type TemplateSend = {
  name: string;
  language: string;
  params: Record<string, string>;
  // One payload per quick-reply button, in order; it comes back when tapped.
  buttonPayloads?: string[];
};

export function sendTemplate(phoneNumberId: string, to: string, t: TemplateSend) {
  const components: unknown[] = [
    {
      type: "body",
      parameters: Object.entries(t.params).map(([name, text]) => ({ type: "text", parameter_name: name, text })),
    },
    ...(t.buttonPayloads ?? []).map((payload, index) => ({
      type: "button",
      sub_type: "quick_reply",
      index: String(index),
      parameters: [{ type: "payload", payload }],
    })),
  ];
  return kapso<{ messages?: { id: string }[] }>(
    "POST",
    `/meta/whatsapp/${GRAPH_VERSION}/${phoneNumberId}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: { name: t.name, language: { code: t.language }, components },
    },
  ).then((r) => r.messages?.[0]?.id ?? null);
}

// A message with up to three reply buttons; a tap comes back with the button's id.
export function sendButtons(phoneNumberId: string, to: string, body: string, buttons: { id: string; title: string }[]) {
  return kapso<{ messages?: { id: string }[] }>(
    "POST",
    `/meta/whatsapp/${GRAPH_VERSION}/${phoneNumberId}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: body },
        action: { buttons: buttons.map((b) => ({ type: "reply", reply: b })) },
      },
    },
  ).then((r) => r.messages?.[0]?.id ?? null);
}
