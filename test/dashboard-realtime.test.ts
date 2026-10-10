import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";

let businessId: string;
let otherBusinessId: string;
let memberId: string;
let adminId: string;

beforeEach(async () => {
  await db.execute(sql`truncate businesses, profiles cascade`);
  await db.execute(sql`truncate realtime.messages`);
  const clinics = await db.insert(schema.businesses).values([{ name: "Clinic A" }, { name: "Clinic B" }]).returning();
  businessId = clinics[0].id;
  otherBusinessId = clinics[1].id;
  memberId = randomUUID();
  adminId = randomUUID();
  await db.insert(schema.profiles).values([
    { id: memberId, email: "member@example.test" },
    { id: adminId, email: "admin@example.test", isSuperAdmin: true },
  ]);
  await db.insert(schema.businessMembers).values({ businessId, userId: memberId });
});

const notifications = () => db.execute<{ topic: string; event: string; payload: unknown; private: boolean }>(
  sql`select topic, event, payload, private from realtime.messages`,
);

describe("dashboard Realtime database integration", () => {
  it("broadcasts patient inserts, edits and deletions with no patient data", async () => {
    const [patient] = await db.insert(schema.clients).values({ businessId, name: "Private name" }).returning();
    await db.update(schema.clients).set({ name: "Changed private name" }).where(eq(schema.clients.id, patient.id));
    await db.delete(schema.clients).where(eq(schema.clients.id, patient.id));
    const events = await notifications();
    expect(events).toHaveLength(3);
    for (const event of events) expect(event).toEqual({ topic: `dashboard:${businessId}`, event: "changed", payload: {}, private: true });
  });

  it("broadcasts appointment creation, modification, cancellation and deletion", async () => {
    const [patient] = await db.insert(schema.clients).values({ businessId, name: "Patient" }).returning();
    const [doctor] = await db.insert(schema.practitioners).values({ businessId, displayName: "Doctor" }).returning();
    const [service] = await db.insert(schema.services).values({ businessId, name: "Consultation", durationMin: 30 }).returning();
    await db.execute(sql`truncate realtime.messages`);
    const [appointment] = await db.insert(schema.appointments).values({
      businessId, clientId: patient.id, practitionerId: doctor.id, serviceId: service.id,
      startsAt: new Date("2026-10-20T15:00:00Z"), endsAt: new Date("2026-10-20T15:30:00Z"),
    }).returning();
    await db.update(schema.appointments).set({ status: "confirmed" }).where(eq(schema.appointments.id, appointment.id));
    await db.update(schema.appointments).set({ status: "cancelled_by_client" }).where(eq(schema.appointments.id, appointment.id));
    await db.delete(schema.appointments).where(eq(schema.appointments.id, appointment.id));
    expect(await notifications()).toHaveLength(4);
  });

  it("rolls back notifications with the write transaction", async () => {
    await expect(db.transaction(async tx => {
      await tx.insert(schema.clients).values({ businessId, name: "Rolled back" });
      const events = await tx.execute(sql`select * from realtime.messages`);
      expect(events).toHaveLength(1);
      throw new Error("abort transaction");
    })).rejects.toThrow("abort transaction");
    expect(await notifications()).toHaveLength(0);
    expect(await db.select().from(schema.clients)).toHaveLength(0);
  });

  it("authorizes only clinic members and super-admins on valid clinic topics", async () => {
    await db.transaction(async tx => {
      await tx.execute(sql`select set_config('request.jwt.claim.sub', ${memberId}, true)`);
      await tx.execute(sql`set local role authenticated`);
      const check = async (topic: string) => {
        const [row] = await tx.execute<{ allowed: boolean }>(sql`select public.can_receive_dashboard_changes(${topic}) as allowed`);
        return row.allowed;
      };
      expect(await check(`dashboard:${businessId}`)).toBe(true);
      expect(await check(`dashboard:${otherBusinessId}`)).toBe(false);
      expect(await check("dashboard:invalid")).toBe(false);
      await tx.execute(sql`select set_config('request.jwt.claim.sub', ${adminId}, true)`);
      expect(await check(`dashboard:${otherBusinessId}`)).toBe(true);
      await tx.execute(sql`select set_config('request.jwt.claim.sub', '', true)`);
      expect(await check(`dashboard:${businessId}`)).toBe(false);
    });
  });

  it("enforces the channel read policy and keeps patient table RLS closed", async () => {
    await db.insert(schema.clients).values({ businessId, name: "Private" });
    await db.transaction(async tx => {
      await tx.execute(sql`select set_config('request.jwt.claim.sub', ${memberId}, true)`);
      await tx.execute(sql`select set_config('realtime.topic', ${`dashboard:${otherBusinessId}`}, true)`);
      // Give the test role SELECT so denial is tested through RLS, not grants.
      await tx.execute(sql`grant select on public.clients to authenticated`);
      await tx.execute(sql`set local role authenticated`);
      expect(await tx.execute(sql`select * from realtime.messages`)).toHaveLength(0);
      await tx.execute(sql`select set_config('realtime.topic', ${`dashboard:${businessId}`}, true)`);
      expect(await tx.execute(sql`select * from realtime.messages`)).toHaveLength(1);
      expect(await tx.execute(sql`select * from public.clients`)).toHaveLength(0);
      await tx.execute(sql`reset role`);
      await tx.execute(sql`revoke select on public.clients from authenticated`);
    });
  });

  it("does not allow browser clients to send broadcasts", async () => {
    await expect(db.transaction(async tx => {
      await tx.execute(sql`select set_config('request.jwt.claim.sub', ${memberId}, true)`);
      await tx.execute(sql`select set_config('realtime.topic', ${`dashboard:${businessId}`}, true)`);
      await tx.execute(sql`set local role authenticated`);
      await tx.execute(sql`insert into realtime.messages (topic, event, payload) values (${`dashboard:${businessId}`}, 'changed', '{}')`);
    })).rejects.toMatchObject({ cause: { code: "42501" } });
  });
});
