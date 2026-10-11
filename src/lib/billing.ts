import { and, desc, eq } from "drizzle-orm";
import { addDays, addMonths } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { db, schema } from "@/db";
import { env } from "@/lib/env";

// Clinics pay Praxia by bank transfer, a month at a time, after an optional
// free trial. Praxia's superadmin issues each month's invoice and marks it
// paid when the transfer arrives. While a clinic is in good standing the
// assistant and reminders run; once the trial or the paid month is over and
// a grace week has passed, or the superadmin suspends it, they stop. The
// dashboard keeps working so the clinic can see what's owed.

type Business = typeof schema.businesses.$inferSelect;
export type Invoice = typeof schema.invoices.$inferSelect;

export const GRACE_DAYS = 7;
export const DEFAULT_TRIAL_DAYS = 7;

export type Standing =
  // Billing was never set up (a clinic from before billing, or Praxia's own).
  | { status: "unbilled" }
  | { status: "trial"; until: Date }
  | { status: "active"; until: string }
  // Unpaid, but still running until `stopsOn`.
  | { status: "grace"; stopsOn: string }
  | { status: "expired"; since: string }
  | { status: "suspended" };

const today = (b: Pick<Business, "timezone">, now: Date) => formatInTimeZone(now, b.timezone, "yyyy-MM-dd");
const day = (d: string, n: number) => addDays(new Date(`${d}T12:00:00Z`), n).toISOString().slice(0, 10);
const max = (...dates: (string | null)[]) => dates.filter((d): d is string => d !== null).sort().at(-1) ?? null;

export function standing(
  b: Pick<Business, "timezone" | "trialEndsAt" | "paidUntil" | "billingSuspended">,
  now = new Date(),
): Standing {
  if (b.billingSuspended) return { status: "suspended" };
  if (!b.trialEndsAt && !b.paidUntil) return { status: "unbilled" };
  const t = today(b, now);
  // paid_until is the first day not paid for.
  if (b.paidUntil && t < b.paidUntil) return { status: "active", until: b.paidUntil };
  if (b.trialEndsAt && now < b.trialEndsAt) return { status: "trial", until: b.trialEndsAt };
  const covered = max(b.paidUntil, b.trialEndsAt ? today(b, b.trialEndsAt) : null)!;
  const stopsOn = day(covered, GRACE_DAYS);
  return t < stopsOn ? { status: "grace", stopsOn } : { status: "expired", since: stopsOn };
}

// Whether the assistant answers and reminders go out.
export function serviceRunning(b: Parameters<typeof standing>[0], now = new Date()) {
  const s = standing(b, now).status;
  return s !== "expired" && s !== "suspended";
}

export class BillingError extends Error {
  constructor(readonly code: "no_price" | "invalid_price" | "invalid_days" | "pending_exists" | "not_found") {
    super(code);
  }
}

// Bank account clinics transfer to, as Praxia writes it (several lines).
export function bankDetails() {
  return env.BILLING_BANK_DETAILS?.trim() || null;
}

// A trial of `days` from now; 0 ends it. Used when a clinic is created and
// from the admin page.
export async function setTrial(businessId: string, days: number, now = new Date()) {
  if (!Number.isInteger(days) || days < 0 || days > 365) throw new BillingError("invalid_days");
  await db
    .update(schema.businesses)
    .set({ trialEndsAt: days === 0 ? now : addDays(now, days) })
    .where(eq(schema.businesses.id, businessId));
}

export async function setMonthlyPrice(businessId: string, dollars: string) {
  const cents = Math.round(Number(dollars.replace(",", ".")) * 100);
  if (!Number.isFinite(cents) || cents <= 0 || cents > 10_000_000) throw new BillingError("invalid_price");
  await db.update(schema.businesses).set({ monthlyPriceCents: cents }).where(eq(schema.businesses.id, businessId));
}

export async function setSuspended(businessId: string, suspended: boolean) {
  await db.update(schema.businesses).set({ billingSuspended: suspended }).where(eq(schema.businesses.id, businessId));
}

export async function invoicesFor(businessId: string) {
  return db
    .select()
    .from(schema.invoices)
    .where(eq(schema.invoices.businessId, businessId))
    .orderBy(desc(schema.invoices.periodStart), desc(schema.invoices.number));
}

// The next month's invoice: from the end of what's paid or of the trial
// (today if both are past), due on its first day, at the clinic's price.
export async function issueNextInvoice(businessId: string, now = new Date()) {
  const [b] = await db.select().from(schema.businesses).where(eq(schema.businesses.id, businessId));
  if (!b) throw new BillingError("not_found");
  if (!b.monthlyPriceCents) throw new BillingError("no_price");
  const [pending] = await db
    .select({ id: schema.invoices.id })
    .from(schema.invoices)
    .where(and(eq(schema.invoices.businessId, businessId), eq(schema.invoices.status, "pending")));
  if (pending) throw new BillingError("pending_exists");
  const t = today(b, now);
  const start = max(t, b.paidUntil, b.trialEndsAt ? today(b, b.trialEndsAt) : null)!;
  const end = addMonths(new Date(`${start}T12:00:00Z`), 1).toISOString().slice(0, 10);
  const [invoice] = await db
    .insert(schema.invoices)
    .values({ businessId, periodStart: start, periodEnd: end, dueOn: start, amountCents: b.monthlyPriceCents })
    .returning();
  return invoice;
}

// The transfer arrived: the month is paid and the clinic runs through it.
export async function markInvoicePaid(invoiceId: string, reference: string | null, now = new Date()) {
  return db.transaction(async (tx) => {
    const [invoice] = await tx
      .update(schema.invoices)
      .set({ status: "paid", paidAt: now, paymentReference: reference?.trim() || null })
      .where(and(eq(schema.invoices.id, invoiceId), eq(schema.invoices.status, "pending")))
      .returning();
    if (!invoice) throw new BillingError("not_found");
    const [b] = await tx.select().from(schema.businesses).where(eq(schema.businesses.id, invoice.businessId));
    await tx
      .update(schema.businesses)
      .set({ paidUntil: max(b.paidUntil, invoice.periodEnd), billingSuspended: false })
      .where(eq(schema.businesses.id, invoice.businessId));
    return invoice;
  });
}

export async function voidInvoice(invoiceId: string) {
  const [invoice] = await db
    .update(schema.invoices)
    .set({ status: "void" })
    .where(and(eq(schema.invoices.id, invoiceId), eq(schema.invoices.status, "pending")))
    .returning();
  if (!invoice) throw new BillingError("not_found");
  return invoice;
}

export const formatMoney = (cents: number, currency = "USD") =>
  new Intl.NumberFormat("es-SV", { style: "currency", currency }).format(cents / 100);

// What a clinic's transfer should say, so Praxia can match it.
export const transferReference = (invoice: Pick<Invoice, "number">) => `PRAXIA-${invoice.number}`;
