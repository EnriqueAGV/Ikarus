import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";

export type Business = typeof schema.businesses.$inferSelect;
export type Client = typeof schema.clients.$inferSelect;
export type IntakeField = typeof schema.intakeFields.$inferSelect;

export async function loadIntakeFields(businessId: string) {
  return db
    .select()
    .from(schema.intakeFields)
    .where(eq(schema.intakeFields.businessId, businessId))
    .orderBy(asc(schema.intakeFields.position));
}

// Required information the client has not given yet. The name is always required.
export function missingIntake(client: Client, fields: IntakeField[]) {
  const missing: string[] = [];
  if (!client.name?.trim()) missing.push("name");
  for (const f of fields) {
    const v = client.data[f.key];
    if (f.required && (v === undefined || v === null || String(v).trim() === "")) missing.push(f.key);
  }
  return missing;
}

export async function reloadClient(businessId: string, clientId: string) {
  const [client] = await db
    .select()
    .from(schema.clients)
    .where(and(eq(schema.clients.id, clientId), eq(schema.clients.businessId, businessId)));
  return client ?? null;
}
