import { createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startFakeKapso } from "./fake-kapso";

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    auth: {
      admin: {
        createUser: async ({ email }: { email: string }) => ({
          data: { user: { id: "11111111-1111-4111-8111-111111111111", email } },
          error: null,
        }),
        listUsers: async () => ({ data: { users: [] } }),
      },
    },
  }),
}));

const CUSTOMER_ID = "cust-1";
const PHONE_ID = "555000111";
const WABA_ID = "waba-9";
let templateFailures = new Set<string>();

const kapso = await startFakeKapso({
  "POST /platform/v1/customers": () => ({ status: 201, json: { data: { id: CUSTOMER_ID, name: "x" } } }),
  "POST /platform/v1/customers/[^/]+/setup_links": () => ({
    status: 201,
    json: {
      data: {
        id: `link-${Math.random().toString(36).slice(2, 8)}`,
        url: "https://app.kapso.ai/whatsapp/setup/abc",
        status: "active",
        expires_at: "2026-11-08T00:00:00Z",
      },
    },
  }),
  "GET /platform/v1/whatsapp/phone_numbers/[^/]+": () => ({
    json: {
      data: {
        phone_number_id: PHONE_ID,
        business_account_id: WABA_ID,
        customer_id: CUSTOMER_ID,
        display_phone_number: "+52 55 1234 5678",
      },
    },
  }),
  "POST /platform/v1/whatsapp/phone_numbers/[^/]+/webhooks": () => ({
    status: 201,
    json: { data: { id: "hook-1", url: "", events: [] } },
  }),
  "POST /meta/whatsapp/v24.0/[^/]+/message_templates": (body) => {
    const name = (body as { name: string }).name;
    if (templateFailures.has(name)) {
      return { status: 400, json: { error: { message: "Invalid parameter", type: "OAuthException", code: 100 } } };
    }
    return { json: { id: `tpl-${name}`, status: "PENDING", category: "UTILITY" } };
  },
});
process.env.KAPSO_API_BASE_URL = kapso.url;

const { db, schema } = await import("@/db");
const { sql } = await import("drizzle-orm");
const onboarding = await import("@/lib/onboarding");
const projectRoute = await import("@/app/api/webhooks/kapso/project/route");

function signedRequest(body: unknown, event: string, key: string, secret = "project-secret") {
  const raw = JSON.stringify(body);
  return new Request("https://ikarus.test/api/webhooks/kapso/project", {
    method: "POST",
    body: raw,
    headers: {
      "x-webhook-event": event,
      "x-idempotency-key": key,
      "x-webhook-signature": createHmac("sha256", secret).update(raw).digest("hex"),
    },
  });
}

async function newBusiness() {
  return onboarding.createBusiness({
    name: "Estética Luna",
    timezone: "America/Mexico_City",
    ownerEmail: "Duena@Luna.mx",
    createdBy: undefined as unknown as string,
  });
}

beforeAll(async () => {
  await db.execute(sql`select 1`);
});

beforeEach(async () => {
  kapso.calls.length = 0;
  templateFailures = new Set();
  await db.execute(
    sql`truncate webhook_events, templates, setup_links, business_members, businesses, profiles cascade`,
  );
});

afterAll(async () => {
  await kapso.close();
});

describe("createBusiness", () => {
  it("creates the Kapso customer, the owner and a Spanish, partner-managed setup link", async () => {
    const business = await newBusiness();

    const customerCall = kapso.calls.find((c) => c.path === "/platform/v1/customers");
    expect(customerCall?.body).toEqual({
      customer: { name: "Estética Luna", external_customer_id: business.id },
    });

    const linkCall = kapso.calls.find((c) => c.path.endsWith("/setup_links"));
    expect(linkCall?.body).toEqual({
      setup_link: {
        success_redirect_url: "https://ikarus.test/onboarding/success",
        failure_redirect_url: "https://ikarus.test/onboarding/failed",
        meta_billing_mode: "partner_managed",
        language: "es",
      },
    });

    const [profile] = await db.select().from(schema.profiles);
    expect(profile.email).toBe("duena@luna.mx");
    const members = await db.select().from(schema.businessMembers);
    expect(members).toMatchObject([{ businessId: business.id, userId: profile.id, role: "owner" }]);
    const links = await db.select().from(schema.setupLinks);
    expect(links).toMatchObject([{ businessId: business.id, status: "pending" }]);
  });
});

describe("Kapso project webhook", () => {
  it("rejects an unsigned delivery", async () => {
    const res = await projectRoute.POST(
      signedRequest({ phone_number_id: PHONE_ID }, "whatsapp.phone_number.created", "k0", "wrong"),
    );
    expect(res.status).toBe(401);
  });

  it("connects the number, registers the message webhook and creates the three templates once", async () => {
    const business = await newBusiness();
    kapso.calls.length = 0;
    const payload = { phone_number_id: PHONE_ID, customer: { id: CUSTOMER_ID } };

    // Webhook and the success redirect race each other, then Kapso redelivers.
    const [res] = await Promise.all([
      projectRoute.POST(signedRequest(payload, "whatsapp.phone_number.created", "k1")),
      onboarding.connectPhoneNumber({ phoneNumberId: PHONE_ID }),
    ]);
    expect(res.status).toBe(200);
    await projectRoute.POST(signedRequest(payload, "whatsapp.phone_number.created", "k1"));

    const [row] = await db.select().from(schema.businesses);
    expect(row).toMatchObject({
      id: business.id,
      status: "connected",
      phoneNumberId: PHONE_ID,
      wabaId: WABA_ID,
      displayPhone: "+52 55 1234 5678",
      kapsoMessageWebhookId: "hook-1",
    });

    const hookCalls = kapso.calls.filter((c) => c.path.endsWith("/webhooks"));
    expect(hookCalls).toHaveLength(1);
    expect(hookCalls[0].body).toMatchObject({
      whatsapp_webhook: {
        url: "https://ikarus.test/api/webhooks/kapso/messages",
        secret_key: "message-secret",
        events: ["whatsapp.message.received", "whatsapp.message.failed"],
      },
    });

    const templateCalls = kapso.calls.filter((c) => c.path.endsWith("/message_templates"));
    expect(templateCalls.map((c) => (c.body as { name: string }).name).sort()).toEqual([
      "ikarus_cita_cancelada",
      "ikarus_recordatorio",
      "ikarus_seguimiento",
    ]);
    expect(templateCalls[0].path).toBe(`/meta/whatsapp/v24.0/${WABA_ID}/message_templates`);
    const templates = await db.select().from(schema.templates);
    expect(templates.every((t) => t.status === "PENDING" && t.language === "es")).toBe(true);
  });

  it("records a template Meta refused", async () => {
    await newBusiness();
    templateFailures.add("ikarus_seguimiento");
    await onboarding.connectPhoneNumber({ phoneNumberId: PHONE_ID });

    const templates = await db.select().from(schema.templates);
    const failed = templates.find((t) => t.name === "ikarus_seguimiento");
    expect(failed?.status).toBe("REJECTED");
    expect(failed?.rejectedReason).toContain("Invalid parameter");
  });

  it("refuses a redirect whose customer does not match the number", async () => {
    await newBusiness();
    const result = await onboarding.connectPhoneNumber({
      phoneNumberId: PHONE_ID,
      kapsoCustomerId: "someone-else",
    });
    expect(result).toEqual({ ok: false, reason: "customer_mismatch" });
    const [row] = await db.select().from(schema.businesses);
    expect(row.status).toBe("invited");
  });
});
