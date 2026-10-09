import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { env } from "@/lib/env";
import * as kapso from "@/lib/kapso/client";
import { TEMPLATES } from "@/lib/kapso/templates";
import { createPractitioner } from "@/lib/booking/practitioners";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Business = typeof schema.businesses.$inferSelect;

// What the agent asks a new patient besides their name. Nothing clinical
// beyond a few words of reason; the practice can edit these in Ajustes.
export const DEFAULT_INTAKE = [
  { key: "fecha_nacimiento", label: "Fecha de nacimiento", type: "date" as const, options: null },
  { key: "tipo_visita", label: "¿Primera vez o seguimiento?", type: "choice" as const, options: ["Primera vez", "Seguimiento"] },
  { key: "motivo", label: "Motivo de la consulta (en pocas palabras)", type: "text" as const, options: null },
];

// Super-admin creates a business: our row, its Kapso customer, the owner's
// account, the owner as its first doctor, and a first setup link to send to
// the business.
export async function createBusiness(input: {
  name: string;
  timezone: string;
  ownerEmail: string;
  ownerName?: string;
  specialty?: string;
  jvpmNumber?: string;
  createdBy: string;
}): Promise<Business> {
  const [business] = await db
    .insert(schema.businesses)
    .values({ name: input.name, timezone: input.timezone })
    .returning();

  const customer = await kapso.createCustomer(business.name, business.id);
  await db
    .update(schema.businesses)
    .set({ kapsoCustomerId: customer.id })
    .where(eq(schema.businesses.id, business.id));

  const owner = await ensureUser(input.ownerEmail, input.ownerName);
  const [member] = await db
    .insert(schema.businessMembers)
    .values({ businessId: business.id, userId: owner.id, role: "owner" })
    .onConflictDoNothing()
    .returning();
  await db
    .insert(schema.intakeFields)
    .values(DEFAULT_INTAKE.map((f, position) => ({ ...f, businessId: business.id, required: true, position })));
  await createPractitioner(business.id, {
    displayName: input.ownerName?.trim() || input.ownerEmail.trim().toLowerCase(),
    specialty: input.specialty,
    jvpmNumber: input.jvpmNumber,
    memberId: member?.id,
  });

  await issueSetupLink(business.id, input.createdBy);
  return { ...business, kapsoCustomerId: customer.id };
}

// Returns the profile id for this email, creating the account if needed. A new
// account gets Supabase's invitation email, whose link signs them in and opens
// the create-password screen (see /auth/invite); after that they sign in
// with email and password.
export async function ensureUser(email: string, fullName?: string): Promise<{ id: string; invited: boolean }> {
  const normalized = email.trim().toLowerCase();
  const [existing] = await db
    .select()
    .from(schema.profiles)
    .where(eq(schema.profiles.email, normalized));
  if (existing) return { id: existing.id, invited: false };

  const admin = createSupabaseAdminClient();
  const invite = await admin.auth.admin.inviteUserByEmail(normalized, {
    data: fullName ? { full_name: fullName } : undefined,
    redirectTo: `${env.APP_URL}/auth/invite?next=/app`,
  });
  let userId = invite.data.user?.id;
  const invited = Boolean(userId);
  if (!userId) {
    // The auth user exists but has never signed in to Ikarus.
    const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
    userId = data.users.find((u) => u.email?.toLowerCase() === normalized)?.id;
  }
  if (!userId) throw new Error(`Could not create user ${normalized}: ${invite.error?.message ?? "unknown"}`);

  await db
    .insert(schema.profiles)
    .values({ id: userId, email: normalized, fullName })
    .onConflictDoNothing();
  return { id: userId, invited };
}

export async function issueSetupLink(businessId: string, createdBy?: string) {
  const [business] = await db
    .select()
    .from(schema.businesses)
    .where(eq(schema.businesses.id, businessId));
  if (!business?.kapsoCustomerId) throw new Error("Business has no Kapso customer");

  const link = await kapso.createSetupLink(business.kapsoCustomerId);
  const [row] = await db
    .insert(schema.setupLinks)
    .values({
      businessId,
      kapsoSetupLinkId: link.id,
      url: link.url,
      expiresAt: new Date(link.expires_at),
      createdBy,
    })
    .returning();
  return row;
}

export type ConnectResult =
  | { ok: true; business: Business }
  | { ok: false; reason: "unknown_customer" | "customer_mismatch" };

// Called from both the Kapso project webhook and the setup success redirect,
// possibly at the same moment, so every step is idempotent. The phone number
// is always re-read from Kapso: redirect query params are not trusted.
export async function connectPhoneNumber(input: {
  phoneNumberId: string;
  kapsoCustomerId?: string;
  setupLinkId?: string;
}): Promise<ConnectResult> {
  const phone = await kapso.getPhoneNumber(input.phoneNumberId);
  if (!phone.customer_id) return { ok: false, reason: "unknown_customer" };
  if (input.kapsoCustomerId && input.kapsoCustomerId !== phone.customer_id) {
    return { ok: false, reason: "customer_mismatch" };
  }

  const [found] = await db
    .select()
    .from(schema.businesses)
    .where(eq(schema.businesses.kapsoCustomerId, phone.customer_id));
  if (!found) return { ok: false, reason: "unknown_customer" };

  const [business] = await db
    .update(schema.businesses)
    .set({
      phoneNumberId: phone.phone_number_id,
      wabaId: phone.business_account_id,
      displayPhone: phone.display_phone_number,
      status: found.status === "invited" ? "connected" : found.status,
    })
    .where(eq(schema.businesses.id, found.id))
    .returning();

  if (input.setupLinkId) {
    await db
      .update(schema.setupLinks)
      .set({ status: "completed" })
      .where(
        and(
          eq(schema.setupLinks.businessId, business.id),
          eq(schema.setupLinks.kapsoSetupLinkId, input.setupLinkId),
        ),
      );
  }

  await ensureMessageWebhook(business);
  await ensureTemplates(business);
  return { ok: true, business };
}

async function ensureMessageWebhook(business: Business) {
  if (!business.phoneNumberId || !env.KAPSO_MESSAGE_WEBHOOK_SECRET) return;
  // Claim the registration so a concurrent call doesn't register twice.
  const [claimed] = await db
    .update(schema.businesses)
    .set({ kapsoMessageWebhookId: "pending" })
    .where(
      and(
        eq(schema.businesses.id, business.id),
        isNull(schema.businesses.kapsoMessageWebhookId),
      ),
    )
    .returning({ id: schema.businesses.id });
  if (!claimed) return;

  try {
    const hook = await kapso.createPhoneNumberWebhook(
      business.phoneNumberId,
      `${env.APP_URL}/api/webhooks/kapso/messages`,
      env.KAPSO_MESSAGE_WEBHOOK_SECRET,
    );
    await db
      .update(schema.businesses)
      .set({ kapsoMessageWebhookId: hook.id })
      .where(eq(schema.businesses.id, business.id));
  } catch (err) {
    await db
      .update(schema.businesses)
      .set({ kapsoMessageWebhookId: null })
      .where(eq(schema.businesses.id, business.id));
    throw err;
  }
}

export async function ensureTemplates(business: Business) {
  if (!business.wabaId) return;
  for (const template of TEMPLATES) {
    // The unique (business, name, language) row is the claim.
    const [claimed] = await db
      .insert(schema.templates)
      .values({
        businessId: business.id,
        name: template.name,
        language: template.language,
      })
      .onConflictDoNothing()
      .returning();
    if (!claimed) continue;

    try {
      const created = await kapso.createMessageTemplate(business.wabaId, template);
      await db
        .update(schema.templates)
        .set({
          metaTemplateId: created.id,
          status: toTemplateStatus(created.status),
          updatedAt: new Date(),
        })
        .where(eq(schema.templates.id, claimed.id));
    } catch (err) {
      await db
        .update(schema.templates)
        .set({
          status: "REJECTED",
          rejectedReason: err instanceof Error ? err.message : String(err),
          updatedAt: new Date(),
        })
        .where(eq(schema.templates.id, claimed.id));
    }
  }
}

// Pulls the current review status of each template from Meta.
export async function syncTemplates(businessId: string) {
  const [business] = await db
    .select()
    .from(schema.businesses)
    .where(eq(schema.businesses.id, businessId));
  if (!business?.wabaId) return;

  const remote = await kapso.listMessageTemplates(business.wabaId);
  for (const t of remote) {
    await db
      .update(schema.templates)
      .set({
        metaTemplateId: t.id,
        status: toTemplateStatus(t.status),
        rejectedReason: t.rejected_reason && t.rejected_reason !== "NONE" ? t.rejected_reason : null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.templates.businessId, business.id),
          eq(schema.templates.name, t.name),
          eq(schema.templates.language, t.language),
        ),
      );
  }
}

// Registers our project webhook in Kapso once, so new connections reach us.
export async function ensureProjectWebhook() {
  if (!env.KAPSO_PROJECT_WEBHOOK_SECRET) {
    throw new Error("KAPSO_PROJECT_WEBHOOK_SECRET is not set");
  }
  const url = `${env.APP_URL}/api/webhooks/kapso/project`;
  const existing = await kapso.listProjectWebhooks();
  const match = existing.find((w) => w.url === url && !w.phone_number_id);
  if (match) return { created: false, webhook: match };
  const webhook = await kapso.createProjectWebhook(url, env.KAPSO_PROJECT_WEBHOOK_SECRET);
  return { created: true, webhook };
}

function toTemplateStatus(status: string) {
  const s = status.toUpperCase();
  return s === "APPROVED" || s === "REJECTED" || s === "DISABLED" ? s : "PENDING";
}
