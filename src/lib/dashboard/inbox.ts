import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";

// Conversations the assistant handed to the team (or the team took over),
// for the "Por responder" list. Waiting: the patient wrote last. Answered:
// the team replied but the assistant is still paused for that number.

export type InboxRow = {
  client: { id: string; name: string | null; waPhone: string | null };
  lastMessage: { body: string | null; type: string; direction: "inbound" | "outbound"; createdAt: Date } | null;
  lastInboundAt: Date | null;
  waiting: boolean;
};

export async function pausedConversations(businessId: string): Promise<InboxRow[]> {
  const holders = await db
    .select({
      id: schema.clients.id,
      name: schema.clients.name,
      waPhone: schema.clients.waPhone,
      // As epoch milliseconds: postgres-js returns a bare timestamp string here.
      lastInboundAt: sql<number | null>`(select extract(epoch from max(m.created_at)) * 1000 from messages m where m.client_id = "clients"."id" and m.direction = 'inbound')`.mapWith(
        (v) => (v === null ? null : new Date(Number(v))),
      ),
    })
    .from(schema.clients)
    .where(
      and(
        eq(schema.clients.businessId, businessId),
        eq(schema.clients.agentPaused, true),
        isNull(schema.clients.holderId),
        isNull(schema.clients.archivedAt),
      ),
    )
    .limit(200);
  if (holders.length === 0) return [];
  const last = await db
    .selectDistinctOn([schema.messages.clientId], {
      clientId: schema.messages.clientId,
      body: schema.messages.body,
      type: schema.messages.type,
      direction: schema.messages.direction,
      createdAt: schema.messages.createdAt,
    })
    .from(schema.messages)
    .where(inArray(schema.messages.clientId, holders.map((h) => h.id)))
    .orderBy(asc(schema.messages.clientId), desc(schema.messages.createdAt));
  const lastBy = new Map(last.map((m) => [m.clientId, m]));
  const rows = holders.map(({ lastInboundAt, ...client }) => {
    const m = lastBy.get(client.id) ?? null;
    return {
      client,
      lastMessage: m && { body: m.body, type: m.type, direction: m.direction, createdAt: m.createdAt },
      lastInboundAt,
      waiting: m?.direction === "inbound",
    };
  });
  // Waiting first, the longest wait at the top; then the rest, latest first.
  return rows.sort((a, b) => {
    if (a.waiting !== b.waiting) return a.waiting ? -1 : 1;
    const at = a.lastMessage?.createdAt.getTime() ?? 0;
    const bt = b.lastMessage?.createdAt.getTime() ?? 0;
    return a.waiting ? at - bt : bt - at;
  });
}

// How many patients are waiting on the team, for the menu badge.
export async function waitingCount(businessId: string) {
  const rows = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from ${schema.clients} c
    where c.business_id = ${businessId} and c.agent_paused and c.holder_id is null and c.archived_at is null
      and (select m.direction from ${schema.messages} m where m.client_id = c.id order by m.created_at desc limit 1) = 'inbound'
  `);
  return Number(rows[0]?.n ?? 0);
}
