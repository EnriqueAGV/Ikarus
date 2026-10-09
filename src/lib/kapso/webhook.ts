import { createHmac, timingSafeEqual } from "node:crypto";

// Kapso signs webhooks with HMAC-SHA256 of the raw body, hex encoded, in
// the X-Webhook-Signature header. Verify against the raw bytes, never a
// re-serialized object.
export function verifyKapsoSignature(
  rawBody: string,
  signature: string | null,
  secret: string,
): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(signature, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
