import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/inngest/client", () => ({ inngest: { send: async () => {}, createFunction: () => ({}) } }));

const { db, schema } = await import("@/db");
const { eq, sql } = await import("drizzle-orm");
const billing = await import("@/lib/billing");
const { standingLabel, standingNotice } = await import("@/lib/billing-labels");

// Saturday 10 Oct 2026, noon in El Salvador.
const NOW = new Date("2026-10-10T18:00:00Z");
const DAY = 86_400_000;

let business: typeof schema.businesses.$inferSelect;
const reload = async () => (await db.select().from(schema.businesses).where(eq(schema.businesses.id, business.id)))[0];

beforeEach(async () => {
  await db.execute(sql`truncate invoices, businesses cascade`);
  [business] = await db.insert(schema.businesses).values({ name: "Clínica Luna", timezone: "America/El_Salvador" }).returning();
});

describe("standing", () => {
  const at = (b: Partial<typeof business>) => billing.standing({ ...business, ...b }, NOW);

  it("runs during the trial and the paid month, warns for a grace week, then stops", () => {
    expect(at({})).toEqual({ status: "unbilled" });
    expect(at({ trialEndsAt: new Date(NOW.getTime() + 3 * DAY) }).status).toBe("trial");
    expect(at({ paidUntil: "2026-10-11" })).toEqual({ status: "active", until: "2026-10-11" });
    // Paid through the 9th: the 10th starts the grace week.
    expect(at({ paidUntil: "2026-10-10" })).toEqual({ status: "grace", stopsOn: "2026-10-17" });
    expect(at({ paidUntil: "2026-10-03" })).toEqual({ status: "expired", since: "2026-10-10" });
    expect(at({ trialEndsAt: new Date(NOW.getTime() - 8 * DAY) }).status).toBe("expired");
    expect(at({ paidUntil: "2026-11-01", billingSuspended: true })).toEqual({ status: "suspended" });

    expect(billing.serviceRunning({ ...business, paidUntil: "2026-10-10" }, NOW)).toBe(true);
    expect(billing.serviceRunning({ ...business, paidUntil: "2026-10-03" }, NOW)).toBe(false);
    expect(billing.serviceRunning({ ...business, billingSuspended: true }, NOW)).toBe(false);
  });

  it("explains itself to the clinic", () => {
    expect(standingLabel({ status: "active", until: "2026-11-10" }, "America/El_Salvador")).toBe("Pagado hasta el 09-11-2026");
    expect(standingNotice({ status: "trial", until: new Date(NOW.getTime() + 5 * DAY) }, "America/El_Salvador", NOW)).toBeNull();
    expect(standingNotice({ status: "trial", until: new Date(NOW.getTime() + 2 * DAY) }, "America/El_Salvador", NOW)?.tone).toBe("warn");
    expect(standingNotice({ status: "expired", since: "2026-10-10" }, "America/El_Salvador", NOW)?.tone).toBe("stop");
  });
});

describe("invoices by bank transfer", () => {
  it("bills the month after the trial and extends the service when paid", async () => {
    await billing.setTrial(business.id, 14, NOW);
    await expect(billing.issueNextInvoice(business.id, NOW)).rejects.toThrow("no_price");
    await billing.setMonthlyPrice(business.id, "49,99");

    const first = await billing.issueNextInvoice(business.id, NOW);
    expect(first).toMatchObject({ periodStart: "2026-10-24", periodEnd: "2026-11-24", dueOn: "2026-10-24", amountCents: 4999, status: "pending" });
    expect(billing.transferReference(first)).toBe(`PRAXIA-${first.number}`);
    await expect(billing.issueNextInvoice(business.id, NOW)).rejects.toThrow("pending_exists");

    await billing.markInvoicePaid(first.id, " TRF-123 ", NOW);
    expect(await reload()).toMatchObject({ paidUntil: "2026-11-24" });
    const [paid] = await billing.invoicesFor(business.id);
    expect(paid).toMatchObject({ status: "paid", paymentReference: "TRF-123" });
    await expect(billing.markInvoicePaid(first.id, null, NOW)).rejects.toThrow("not_found");

    // The next one starts where the paid month ends.
    const second = await billing.issueNextInvoice(business.id, NOW);
    expect(second).toMatchObject({ periodStart: "2026-11-24", periodEnd: "2026-12-24" });
    await billing.voidInvoice(second.id);
    expect((await billing.invoicesFor(business.id)).map((i) => i.status)).toEqual(["void", "paid"]);
  });

  it("starts from today once everything is past, and paying lifts a suspension", async () => {
    await db.update(schema.businesses).set({ paidUntil: "2026-09-01", monthlyPriceCents: 3000, billingSuspended: true }).where(eq(schema.businesses.id, business.id));
    const invoice = await billing.issueNextInvoice(business.id, NOW);
    expect(invoice).toMatchObject({ periodStart: "2026-10-10", periodEnd: "2026-11-10" });
    await billing.markInvoicePaid(invoice.id, null, NOW);
    expect(billing.standing(await reload(), NOW)).toEqual({ status: "active", until: "2026-11-10" });
  });

  it("rejects a bad price or trial", async () => {
    await expect(billing.setMonthlyPrice(business.id, "gratis")).rejects.toThrow("invalid_price");
    await expect(billing.setMonthlyPrice(business.id, "0")).rejects.toThrow("invalid_price");
    await expect(billing.setTrial(business.id, 400, NOW)).rejects.toThrow("invalid_days");
    await billing.setTrial(business.id, 0, NOW);
    expect(billing.standing(await reload(), NOW).status).toBe("grace");
  });
});
