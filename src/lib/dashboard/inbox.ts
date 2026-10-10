import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { conversationId } from "@/lib/household";

const eligible = (businessId: string) => and(
  eq(schema.clients.businessId, businessId), isNull(schema.clients.holderId), isNull(schema.clients.archivedAt),
  or(inArray(schema.clients.attentionStatus, ["needs_reply", "follow_up"]),
    and(eq(schema.clients.agentPaused, true), isNull(schema.clients.attentionStatus))),
);

export async function pausedConversations(businessId: string, opts: { page?: number; pageSize?: number; status?: "needs_reply" | "follow_up" } = {}) {
  const holders = await db.select({
    id: schema.clients.id, name: schema.clients.name, waPhone: schema.clients.waPhone,
    agentPaused: schema.clients.agentPaused, attentionStatus: schema.clients.attentionStatus,
    attentionSince: schema.clients.attentionSince, attentionReason: schema.clients.attentionReason,
    attentionUrgent: schema.clients.attentionUrgent,
    lastInboundAt: sql<Date | null>`(select max(m.created_at) from messages m where m.client_id = "clients"."id" and m.direction = 'inbound')`.mapWith(v => v === null ? null : new Date(v)),
  }).from(schema.clients).where(and(eligible(businessId), opts.status ? sql`coalesce(${schema.clients.attentionStatus}, 'needs_reply') = ${opts.status}` : undefined))
    .orderBy(desc(schema.clients.attentionUrgent), asc(sql`coalesce(${schema.clients.attentionSince}, ${schema.clients.createdAt})`), asc(schema.clients.id))
    .limit(opts.pageSize ?? 1000).offset(((opts.page ?? 1) - 1) * (opts.pageSize ?? 1000));
  if (!holders.length) return [];
  const last = await db.selectDistinctOn([schema.messages.clientId], {
    clientId: schema.messages.clientId, body: schema.messages.body, type: schema.messages.type,
    direction: schema.messages.direction, createdAt: schema.messages.createdAt,
  }).from(schema.messages).where(inArray(schema.messages.clientId, holders.map(h => h.id)))
    .orderBy(asc(schema.messages.clientId), desc(schema.messages.createdAt), desc(schema.messages.id));
  const byClient = new Map(last.map(m => [m.clientId, m]));
  return holders.map(({ lastInboundAt, ...client }) => ({
    client, lastMessage: byClient.get(client.id) ?? null, lastInboundAt,
    waiting: client.attentionStatus !== "follow_up",
  }));
}
export type InboxRow = Awaited<ReturnType<typeof pausedConversations>>[number];

export async function inboxCounts(businessId: string) {
  const [counts] = await db.select({
    needsReply: sql<number>`count(*) filter (where coalesce(${schema.clients.attentionStatus}, 'needs_reply') = 'needs_reply')::int`,
    followUp: sql<number>`count(*) filter (where ${schema.clients.attentionStatus} = 'follow_up')::int`,
  }).from(schema.clients).where(eligible(businessId));
  return counts;
}
export async function waitingCount(businessId: string) { return (await inboxCounts(businessId)).needsReply; }

export async function resolveConversation(businessId: string, clientId: string, expectedLastId?: string | null) {
  return db.transaction(async tx => {
    const [patient] = await tx.select().from(schema.clients).where(and(eq(schema.clients.businessId, businessId), eq(schema.clients.id, clientId)));
    if (!patient || patient.archivedAt || patient.mergedIntoId) return false;
    const holderId = conversationId(patient);
    await tx.select({ id: schema.clients.id }).from(schema.clients).where(eq(schema.clients.id, holderId)).for("update");
    const [latest] = await tx.select({ id: schema.messages.id }).from(schema.messages).where(eq(schema.messages.clientId, holderId)).orderBy(desc(schema.messages.createdAt), desc(schema.messages.id)).limit(1);
    if (expectedLastId !== undefined && (latest?.id ?? null) !== expectedLastId) return false;
    await tx.update(schema.clients).set({ attentionStatus: "resolved", attentionSince: null, attentionReason: null, attentionUrgent: false })
      .where(and(eq(schema.clients.businessId, businessId), eq(schema.clients.id, holderId)));
    return true;
  });
}
