import { runAgent } from "@/lib/agent/run";
import { inngest } from "./client";

// One run per client at a time: messages arriving mid-reply queue behind it,
// and the next run skips if the reply already covered them.
export const agentReply = inngest.createFunction(
  {
    id: "agent-reply",
    triggers: [{ event: "whatsapp/message.received" }],
    concurrency: { key: "event.data.clientId", limit: 1 },
    retries: 2,
  },
  async ({ event, step }) => {
    const { businessId, clientId } = event.data as { businessId: string; clientId: string };
    return step.run("answer", () => runAgent({ businessId, clientId }));
  },
);

// Reminder, follow-up and auto-cancel flows land here in milestone 5.
export const functions = [agentReply];
