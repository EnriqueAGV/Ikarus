import { createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";

// A device is trusted once its owner types a code we emailed them; the
// browser then keeps a random token in a cookie, and we keep its hash.
export const DEVICE_COOKIE = "praxia_device";
// Browsers cap cookie lifetimes at 400 days.
export const DEVICE_MAX_AGE_S = 400 * 24 * 60 * 60;

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function trustDevice(userId: string, label: string | null) {
  const token = randomBytes(32).toString("base64url");
  await db.insert(schema.trustedDevices).values({ userId, tokenHash: hash(token), label: label?.slice(0, 200) ?? null });
  return token;
}

export async function isTrustedDevice(userId: string, token: string | undefined, now = new Date()) {
  if (!token) return false;
  const [device] = await db
    .update(schema.trustedDevices)
    .set({ lastSeenAt: now })
    .where(and(eq(schema.trustedDevices.tokenHash, hash(token)), eq(schema.trustedDevices.userId, userId)))
    .returning({ id: schema.trustedDevices.id });
  return Boolean(device);
}

export async function listDevices(userId: string) {
  return db
    .select({ id: schema.trustedDevices.id, label: schema.trustedDevices.label, lastSeenAt: schema.trustedDevices.lastSeenAt })
    .from(schema.trustedDevices)
    .where(eq(schema.trustedDevices.userId, userId));
}

// For a lost phone or laptop: every device asks for a code again.
export async function forgetDevices(userId: string) {
  await db.delete(schema.trustedDevices).where(eq(schema.trustedDevices.userId, userId));
}

// "Chrome en Mac" from a user agent, good enough to tell devices apart.
export function deviceLabel(userAgent: string | null) {
  if (!userAgent) return null;
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Chrome\//.test(userAgent)
      ? "Chrome"
      : /Firefox\//.test(userAgent)
        ? "Firefox"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : "Navegador";
  const os = /iPhone|iPad/.test(userAgent)
    ? "iPhone"
    : /Android/.test(userAgent)
      ? "Android"
      : /Mac OS X/.test(userAgent)
        ? "Mac"
        : /Windows/.test(userAgent)
          ? "Windows"
          : "otro sistema";
  return `${browser} en ${os}`;
}
