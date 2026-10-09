import Anthropic from "@anthropic-ai/sdk";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { env } from "@/lib/env";
import { upcomingAppointments } from "@/lib/booking/service";
import { sendText } from "@/lib/kapso/client";
import { loadIntakeFields, missingIntake, reloadClient } from "./context";
import { staticSystemPrompt, turnContext } from "./prompt";
import { runTool, TOOLS, type ToolContext } from "./tools";

const HISTORY_LIMIT = 30;
const MAX_STEPS = 10;
const FALLBACK_REPLY =
  "Gracias por tu mensaje. En un momento alguien del equipo te responde.";

type MessagesClient = Pick<Anthropic, "beta">;

export type AgentRunResult =
  | { status: "replied"; reply: string }
  | { status: "skipped"; reason: "not_found" | "paused" | "already_answered" };

// Answers the client's latest messages. Runs inside an Inngest function that
// allows one run per client at a time, so history is read and written in order.
export async function runAgent(input: {
  businessId: string;
  clientId: string;
  now?: Date;
  anthropic?: MessagesClient;
}): Promise<AgentRunResult> {
  const now = input.now ?? new Date();
  const [business] = await db
    .select()
    .from(schema.businesses)
    .where(eq(schema.businesses.id, input.businessId));
  const client = await reloadClient(input.businessId, input.clientId);
  if (!business?.phoneNumberId || !client) return { status: "skipped", reason: "not_found" };
  if (client.agentPaused) return { status: "skipped", reason: "paused" };

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
  const upcoming = await upcomingAppointments(business.id, client.id, now);
  const ctx: ToolContext = { business, client, fields, now };

  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: "text", text: staticSystemPrompt(business, fields), cache_control: { type: "ephemeral" } },
    {
      type: "text",
      text: turnContext({
        business,
        client,
        missing: missingIntake(client, fields),
        upcoming: upcoming.map((u) => ({
          id: u.appointment.id,
          serviceName: u.serviceName,
          startsAt: u.appointment.startsAt,
          status: u.appointment.status,
        })),
        now,
      }),
    },
  ];

  const messages: Anthropic.Beta.BetaMessageParam[] = toConversation(history);
  const anthropic = input.anthropic ?? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  let reply: string | null = null;

  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await anthropic.beta.messages.create({
      model: env.AGENT_MODEL,
      max_tokens: 16000,
      output_config: { effort: "medium" },
      // On a policy decline, re-run on Anthropic's recommended fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system,
      tools: TOOLS,
      messages,
    });

    if (response.stop_reason === "refusal") break;
    messages.push({ role: "assistant", content: response.content });

    const toolUses = response.content.filter(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use",
    );
    if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
      reply = textOf(response.content);
      break;
    }

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const use of toolUses) {
      const outcome = await runTool(use.name, use.input, ctx).catch((err) => ({
        result: `Tool failed: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      }));
      results.push({
        type: "tool_result",
        tool_use_id: use.id,
        content: typeof outcome.result === "string" ? outcome.result : JSON.stringify(outcome.result),
        is_error: outcome.isError,
      });
    }
    // All results of one turn go back in a single user message.
    messages.push({ role: "user", content: results });
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

// Stored WhatsApp history as alternating turns. The API needs the first turn
// to be the client's, and consecutive same-role turns are merged by the API.
export function toConversation(history: StoredMessage[]): Anthropic.Beta.BetaMessageParam[] {
  const firstInbound = history.findIndex((m) => m.direction === "inbound");
  return history
    .slice(Math.max(firstInbound, 0))
    .filter((m) => m.body?.trim())
    .map((m) => ({
      role: m.direction === "inbound" ? ("user" as const) : ("assistant" as const),
      content: m.body!,
    }));
}

function textOf(content: Anthropic.Beta.BetaContentBlock[]) {
  return content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}
