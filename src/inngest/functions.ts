import { runAgent } from "@/lib/agent/run";
import { autoCancel, clientRepliedSince, planReminder, REPLY_WAIT, sendReminder } from "@/lib/reminders";
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

// The steps this flow uses, so tests can drive it without an Inngest server.
export type ReminderStep = {
  run<T>(id: string, fn: () => Promise<T>): Promise<T>;
  sleepUntil(id: string, time: Date): Promise<void>;
  waitForEvent(id: string, opts: { event: string; timeout: string; match: string }): Promise<unknown | null>;
};

// Reminder, follow-up and auto-cancel for one appointment. A cancellation or
// reschedule of the appointment stops the run (cancelOn below); a reply from
// the client ends it at the next wait.
export async function remindersFlow({ event, step }: { event: { data: unknown }; step: ReminderStep }) {
  const { appointmentId } = event.data as { appointmentId: string; clientId: string };

  const plan = await step.run("plan", () => planReminder(appointmentId));
  if ("skip" in plan) return plan;
  await step.sleepUntil("until-reminder", new Date(plan.remindAt));

  let sent = await step.run("send-reminder", () => sendReminder(appointmentId, "reminder"));
  if (sent.status !== "sent") return sent;
  if (await waitedWithoutReply("first", sent.sentAt)) {
    sent = await step.run("send-followup", () => sendReminder(appointmentId, "followup"));
    if (sent.status !== "sent") return sent;
    if (await waitedWithoutReply("second", sent.sentAt)) {
      return step.run("auto-cancel", () => autoCancel(appointmentId));
    }
  }
  return { status: "replied" };

  async function waitedWithoutReply(label: string, since: string) {
    const reply = await step.waitForEvent(`reply-${label}`, {
      event: "client/replied",
      timeout: REPLY_WAIT,
      match: "data.clientId",
    });
    if (reply) return false;
    return !(await step.run(`check-reply-${label}`, () => clientRepliedSince(appointmentId, since)));
  }
}

export const appointmentReminders = inngest.createFunction(
  {
    id: "appointment-reminders",
    triggers: [{ event: "appointment/booked" }],
    cancelOn: [{ event: "appointment/cancelled", match: "data.appointmentId" }],
    retries: 3,
  },
  ({ event, step }) => remindersFlow({ event, step: step as unknown as ReminderStep }),
);

export const functions = [agentReply, appointmentReminders];
