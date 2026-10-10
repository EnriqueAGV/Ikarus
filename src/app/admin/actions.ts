"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireSuperAdmin } from "@/lib/auth";
import { encryptExistingRows } from "@/lib/encrypt-backfill";
import {
  createBusiness,
  ensureProjectWebhook,
  ensureTemplates,
  issueSetupLink,
  syncTemplates,
} from "@/lib/onboarding";

const newBusiness = z.object({
  name: z.string().trim().min(2),
  timezone: z.string().min(1),
  ownerEmail: z.string().trim().email(),
  ownerName: z.string().trim().min(2),
  specialty: z.string().trim().optional(),
  jvpmNumber: z.string().trim().optional(),
});

export async function createBusinessAction(formData: FormData) {
  const admin = await requireSuperAdmin();
  const parsed = newBusiness.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/admin/new?error=invalid");

  let businessId: string;
  try {
    const business = await createBusiness({ ...parsed.data, createdBy: admin.id });
    businessId = business.id;
  } catch (err) {
    console.error("createBusiness failed", err);
    redirect("/admin/new?error=failed");
  }
  redirect(`/admin/businesses/${businessId}`);
}

export async function newSetupLinkAction(businessId: string) {
  const admin = await requireSuperAdmin();
  await issueSetupLink(businessId, admin.id);
  revalidatePath(`/admin/businesses/${businessId}`);
}

export async function syncTemplatesAction(businessId: string) {
  await requireSuperAdmin();
  // Templates added to Praxia since the clinic connected are created first.
  const [business] = await db.select().from(schema.businesses).where(eq(schema.businesses.id, businessId));
  if (business) await ensureTemplates(business);
  await syncTemplates(businessId);
  revalidatePath(`/admin/businesses/${businessId}`);
}

export async function registerProjectWebhookAction() {
  await requireSuperAdmin();
  let outcome: "created" | "exists" | "failed";
  try {
    const { created } = await ensureProjectWebhook();
    outcome = created ? "created" : "exists";
  } catch (err) {
    console.error("ensureProjectWebhook failed", err);
    outcome = "failed";
  }
  redirect(`/admin?webhook=${outcome}`);
}

// Encrypts rows written before app-level encryption, or under an older key.
export async function encryptExistingAction() {
  await requireSuperAdmin();
  let outcome: string;
  try {
    const { clients, messages } = await encryptExistingRows();
    outcome = `encrypted=${clients + messages}`;
  } catch (err) {
    console.error("encryptExistingRows failed", err instanceof Error ? err.message : err);
    outcome = "encrypted=failed";
  }
  redirect(`/admin?${outcome}`);
}

