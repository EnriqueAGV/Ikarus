import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { env } from "@/lib/env";
import { listPractitioners } from "@/lib/booking/practitioners";
import { upcomingAppointments } from "@/lib/booking/service";
import { household as loadHousehold } from "@/lib/household";
import { sendText } from "@/lib/kapso/client";
import { loadIntakeFields, missingIntake, reloadClient, type Business, type Client } from "./context";
import { ensureConsent } from "./consent";
import { EMERGENCY_REPLY, isEmergency } from "./emergency";
import { staticSystemPrompt, turnContext } from "./prompt";
import { chatClient, type ChatClient, type ChatMessage } from "./llm";
import { CHAT_TOOLS, runTool, type ToolContext } from "./tools";

const HISTORY_LIMIT = 30;
const MAX_STEPS = 10;
const FALLBACK_REPLY =
  "Gracias por su mensaje. En un momento alguien del consultorio le responde.";
// One emergency reply covers a burst of messages about the same situation.
const EMERGENCY_REPEAT_MS = 30 * 60_000;

export type AgentRunResult =
  | { status: "replied"; reply: string }
  | { status: "emergency"; replied: boolean }
  | { status: "consent_requested" }
  | { status: "skipped"; reason: "not_found" | "paused" | "already_answered" };

// Answers the client's latest messages. Runs inside an Inngest function that
// allows one run per client at a time, so history is read and written in order.
export async function runAgent(input: {
  businessId: string;
  clientId: string;
  now?: Date;
  llm?: ChatClient;
}): Promise<AgentRunResult> {
  if (!env.LLM_MODEL) throw new Error("LLM_MODEL is not set");
  const now = input.now ?? new Date();
  const [business] = await db
    .select()
    .from(schema.businesses)
    .where(eq(schema.businesses.id, input.businessId));
  const client = await reloadClient(input.businessId, input.clientId);
  // Runs on the number's holder, who has the conversation.
  if (!business?.phoneNumberId || !client?.waPhone || client.holderId) return { status: "skipped", reason: "not_found" };
  // Checked before the pause: a patient already handed to the team still
  // gets pointed to 911.
  const emergency = await answerEmergency(business, client, now);
  if (emergency) return emergency;
  if (client.agentPaused) return { status: "skipped", reason: "paused" };
  // Nothing reaches the LLM until the patient accepts the privacy notice.
  const consent = await ensureConsent(business, client);
  if (consent === "requested") return { status: "consent_requested" };
  if (consent === "waiting") return { status: "skipped", reason: "already_answered" };

  const history = (
    await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.clientId, client.id))
      .orderBy(desc(schema.messages.createdAt))
      .limit(HISTORY_LIMIT)
  ).reverse();
  // A previous run already answered everything (several events, one burst).
  if (history.at(-1)?.direction !== "inbound") return { status: "skipped", reason: "already_answered" };

  const fields = await loadIntakeFields(business.id);
  const household = await loadHousehold(business.id, client.id);
  const upcoming = await upcomingAppointments(business.id, household.map((p) => p.id), now);
  const practitioners = await listPractitioners(business.id, { activeOnly: true });
  const ctx: ToolContext = { business, client, household, fields, now };

  // The stable instructions come first so endpoints with prompt caching can reuse them.
  const system = [
    staticSystemPrompt(business, fields, practitioners),
    turnContext({
      business,
      client,
      patients: household.map((p) => ({ patient: p, missing: missingIntake(p, fields) })),
      upcoming: upcoming.map((u) => ({
        id: u.appointment.id,
        patientName: household.find((p) => p.id === u.appointment.clientId)?.name ?? null,
        serviceName: u.serviceName,
        practitionerName: u.practitionerName,
        startsAt: u.appointment.startsAt,
        status: u.appointment.status,
      })),
      now,
    }),
  ].join("\n\n");

  const messages: ChatMessage[] = [{ role: "system", content: system }, ...toConversation(history)];
  const llm = input.llm ?? chatClient();
  let reply: string | null = null;

  for (let step = 0; step < MAX_STEPS; step++) {
    const { message, finishReason } = await llm.complete({ model: env.LLM_MODEL, messages, tools: CHAT_TOOLS });
    const calls = message.tool_calls ?? [];
    messages.push({ role: "assistant", content: message.content ?? null, ...(calls.length ? { tool_calls: calls } : {}) });
    if (calls.length === 0) {
      // A content-filter stop gets the fallback reply rather than a cut-off message.
      if (finishReason !== "content_filter") reply = message.content;
      break;
    }

    // Each tool call gets its own result message, in order.
    for (const call of calls) {
      const outcome = await callTool(call.function.name, call.function.arguments, ctx);
      const content = typeof outcome.result === "string" ? outcome.result : JSON.stringify(outcome.result);
      messages.push({ role: "tool", tool_call_id: call.id, content: outcome.isError ? `Error: ${content}` : content });
    }
  }

  const text = reply?.trim() || FALLBACK_REPLY;
  const kapsoMessageId = await sendText(business.phoneNumberId, client.waPhone, text);
  await db.insert(schema.messages).values({
    businessId: business.id,
    clientId: client.id,
    direction: "outbound",
    kapsoMessageId,
    type: "text",
    body: text,
  });
  return { status: "replied", reply: text };
}

type StoredMessage = typeof schema.messages.$inferSelect;

// Unanswered messages that describe an emergency get the fixed reply and a
// handoff, without the LLM. Null when there is no emergency.
async function answerEmergency(business: Business, client: Client, now: Date): Promise<AgentRunResult | null> {
  const recent = await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.clientId, client.id))
    .orderBy(desc(schema.messages.createdAt))
    .limit(HISTORY_LIMIT);
  const lastOutbound = recent.findIndex((m) => m.direction === "outbound");
  const unanswered = lastOutbound === -1 ? recent : recent.slice(0, lastOutbound);
  if (!unanswered.some((m) => m.direction === "inbound" && isEmergency(m.body))) return null;

  await db.update(schema.clients).set({ agentPaused: true }).where(eq(schema.clients.id, client.id));
  const lastEmergencyReply = recent.find((m) => m.direction === "outbound" && isEmergencyReply(m));
  if (lastEmergencyReply && now.getTime() - lastEmergencyReply.createdAt.getTime() < EMERGENCY_REPEAT_MS) {
    return { status: "emergency", replied: false };
  }
  const kapsoMessageId = await sendText(business.phoneNumberId!, client.waPhone!, EMERGENCY_REPLY);
  await db.insert(schema.messages).values({
    businessId: business.id,
    clientId: client.id,
    direction: "outbound",
    kapsoMessageId,
    type: "text",
    body: EMERGENCY_REPLY,
    payload: { emergency: true },
  });
  return { status: "emergency", replied: true };
}

function isEmergencyReply(m: StoredMessage) {
  return typeof m.payload === "object" && m.payload !== null && "emergency" in m.payload;
}

// Stored WhatsApp history as chat turns, starting at the client's first message.
export function toConversation(history: StoredMessage[]): ChatMessage[] {
  const firstInbound = history.findIndex((m) => m.direction === "inbound");
  return history
    .slice(Math.max(firstInbound, 0))
    .filter((m) => m.body?.trim())
    .map((m) => ({
      role: m.direction === "inbound" ? ("user" as const) : ("assistant" as const),
      content: sentByStaff(m) ? `[Escrito por el equipo del consultorio, no por ti]\n${m.body}` : m.body!,
    }));
}

function sentByStaff(m: StoredMessage) {
  return typeof m.payload === "object" && m.payload !== null && "sentBy" in m.payload;
}

// Arguments arrive as a JSON string; a malformed one is reported back to the model.
async function callTool(name: string, rawArgs: string, ctx: ToolContext) {
  let args: unknown;
  try {
    args = rawArgs ? JSON.parse(rawArgs) : {};
  } catch {
    return { result: "Arguments were not valid JSON. Call the tool again.", isError: true };
  }
  return runTool(name, args, ctx).catch((err) => ({
    result: `Tool failed: ${err instanceof Error ? err.message : String(err)}`,
    isError: true,
  }));
}
