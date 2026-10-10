export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;
export type ReplyEligibility = { reason: "not_connected" | "no_whatsapp" | "window_closed" | null; expiresAt: string | null };
export function replyEligibility(connected: boolean, phone: string | null, lastInboundAt: Date | null, now = new Date()): ReplyEligibility {
  const expiresAt = lastInboundAt ? new Date(lastInboundAt.getTime() + SERVICE_WINDOW_MS).toISOString() : null;
  const reason = !connected ? "not_connected" : !phone ? "no_whatsapp" : !expiresAt || now.getTime() >= Date.parse(expiresAt) ? "window_closed" : null;
  return { reason, expiresAt };
}
