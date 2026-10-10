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

// Under 18 by their birth date: minors have no DUI.
function isMinor(client: Client, now: Date) {
  const raw = client.dateOfBirth ?? client.data.fecha_nacimiento;
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const adult = new Date(`${raw}T00:00:00Z`);
  adult.setUTCFullYear(adult.getUTCFullYear() + 18);
  return adult > now;
}

// Required information the client has not given yet. The name is always
// required, and so is the DUI unless the patient is a minor.
export function missingIntake(client: Client, fields: IntakeField[], now = new Date()) {
  const missing: string[] = [];
  if (!client.name?.trim()) missing.push("name");
  if (!client.dui && !isMinor(client, now)) missing.push("dui");
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
