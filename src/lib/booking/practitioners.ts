import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";

// Doctors with a calendar. A solo practice has one; the dashboard and the
// agent only mention choosing a doctor once a clinic has a second.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

export type Practitioner = typeof schema.practitioners.$inferSelect;
export type PractitionerInput = { displayName: string; specialty?: string | null; jvpmNumber?: string | null };

export async function listPractitioners(businessId: string, opts: { activeOnly?: boolean } = {}, exec: Executor = db) {
  return exec
    .select()
    .from(schema.practitioners)
    .where(
      and(
        eq(schema.practitioners.businessId, businessId),
        opts.activeOnly ? eq(schema.practitioners.active, true) : undefined,
      ),
    )
    .orderBy(asc(schema.practitioners.createdAt), asc(schema.practitioners.id));
}

export async function getPractitioner(businessId: string, practitionerId: string, exec: Executor = db) {
  const [row] = await exec
    .select()
    .from(schema.practitioners)
    .where(and(eq(schema.practitioners.id, practitionerId), eq(schema.practitioners.businessId, businessId)));
  return row ?? null;
}

// A new doctor offers every active service until told otherwise.
export async function createPractitioner(
  businessId: string,
  input: PractitionerInput & { memberId?: string | null },
  exec: Executor = db,
) {
  const [practitioner] = await exec
    .insert(schema.practitioners)
    .values({
      businessId,
      memberId: input.memberId ?? null,
      displayName: input.displayName.trim(),
      specialty: input.specialty?.trim() || null,
      jvpmNumber: input.jvpmNumber?.trim() || null,
    })
    .returning();
  const services = await exec
    .select({ id: schema.services.id })
    .from(schema.services)
    .where(and(eq(schema.services.businessId, businessId), eq(schema.services.active, true)));
  if (services.length) {
    await exec
      .insert(schema.practitionerServices)
      .values(services.map((s) => ({ businessId, practitionerId: practitioner.id, serviceId: s.id })));
  }
  return practitioner;
}

// A new service is offered by every active doctor until told otherwise.
export async function offerServiceByAll(businessId: string, serviceId: string, exec: Executor = db) {
  const practitioners = await listPractitioners(businessId, { activeOnly: true }, exec);
  if (!practitioners.length) return;
  await exec
    .insert(schema.practitionerServices)
    .values(practitioners.map((p) => ({ businessId, practitionerId: p.id, serviceId })))
    .onConflictDoNothing();
}

// Active doctors who offer an active service, each with their duration for it,
// in the clinic's stable doctor order.
export async function practitionersOffering(
  businessId: string,
  serviceId: string,
  practitionerId?: string,
  exec: Executor = db,
) {
  const rows = await exec
    .select({
      practitioner: schema.practitioners,
      durationMin: schema.practitionerServices.durationMin,
      serviceDuration: schema.services.durationMin,
      bufferMin: schema.services.bufferMin,
    })
    .from(schema.practitionerServices)
    .innerJoin(schema.practitioners, eq(schema.practitioners.id, schema.practitionerServices.practitionerId))
    .innerJoin(schema.services, eq(schema.services.id, schema.practitionerServices.serviceId))
    .where(
      and(
        eq(schema.practitionerServices.businessId, businessId),
        eq(schema.practitionerServices.serviceId, serviceId),
        eq(schema.practitioners.active, true),
        eq(schema.services.active, true),
        practitionerId ? eq(schema.practitioners.id, practitionerId) : undefined,
      ),
    )
    .orderBy(asc(schema.practitioners.createdAt), asc(schema.practitioners.id));
  return rows.map((r) => ({
    practitioner: r.practitioner,
    durationMin: r.durationMin ?? r.serviceDuration,
    bufferMin: r.bufferMin,
  }));
}
