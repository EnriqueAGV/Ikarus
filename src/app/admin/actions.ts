"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSuperAdmin } from "@/lib/auth";
import {
  createBusiness,
  ensureProjectWebhook,
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
