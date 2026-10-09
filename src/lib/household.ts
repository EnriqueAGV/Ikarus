import { and, asc, eq, isNull, or } from "drizzle-orm";
import { db, schema } from "@/db";

type Client = typeof schema.clients.$inferSelect;
type Executor = Pick<typeof db, "select" | "insert">;

// The patient whose WhatsApp conversation this is: messages, consent and the
// agent pause are stored on the number's holder.
export function conversationId(client: Pick<Client, "id" | "holderId">) {
  return client.holderId ?? client.id;
}

// The holder of a number and everyone who shares it, holder first.
export async function household(businessId: string, holderId: string, exec: Executor = db) {
  const rows = await exec
    .select()
    .from(schema.clients)
    .where(
      and(
        eq(schema.clients.businessId, businessId),
        or(eq(schema.clients.id, holderId), eq(schema.clients.holderId, holderId)),
      ),
    )
    .orderBy(asc(schema.clients.createdAt));
  return rows.sort((a, b) => Number(a.id !== holderId) - Number(b.id !== holderId));
}

export async function holderOfNumber(businessId: string, waPhone: string, exec: Executor = db) {
  const [holder] = await exec
    .select()
    .from(schema.clients)
    .where(and(eq(schema.clients.businessId, businessId), eq(schema.clients.waPhone, waPhone), isNull(schema.clients.holderId)));
  return holder ?? null;
}

// Another patient on the holder's number, e.g. a child the mother books for.
export async function addToNumber(
  businessId: string,
  holder: Pick<Client, "id" | "waPhone" | "holderId">,
  values: { name: string; dateOfBirth?: string | null },
  exec: Executor = db,
) {
  if (holder.holderId) throw new Error("addToNumber needs the number's holder");
  const [patient] = await exec
    .insert(schema.clients)
    .values({ businessId, waPhone: holder.waPhone, holderId: holder.id, name: values.name, dateOfBirth: values.dateOfBirth ?? null })
    .returning();
  return patient;
}

// WhatsApp numbers as typed by people: a local Salvadoran number gets 503.
export function normalizePhone(raw: string | null) {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 8) return `503${digits}`;
  if (digits.length < 10 || digits.length > 15) return undefined;
  return digits;
}
