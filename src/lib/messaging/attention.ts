import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";

// Automated messages never close human work. Repeated handoffs preserve its age.
export async function openAttention(businessId: string, clientId: string, reason: string, urgent = false, now = new Date()) {
  await db.update(schema.clients).set({
    agentPaused: true,
    attentionStatus: "needs_reply",
    attentionSince: sql`case when ${schema.clients.attentionStatus} in ('needs_reply', 'follow_up') then coalesce(${schema.clients.attentionSince}, ${now.toISOString()}::timestamptz) else ${now.toISOString()}::timestamptz end`,
    attentionReason: reason,
    attentionUrgent: sql`${schema.clients.attentionUrgent} or ${urgent}`,
  }).where(and(eq(schema.clients.id, clientId), eq(schema.clients.businessId, businessId)));
}
