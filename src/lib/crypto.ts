import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// App-level encryption (AES-256-GCM) for the sensitive columns: notes, the
// DUI, allergies, intake answers and WhatsApp messages. The database, its
// backups and support queries then see ciphertext only.
//
// DATA_ENCRYPTION_KEYS lists every key still needed to read old rows, as
// comma-separated "version:base64key" pairs (32-byte keys, from
// `openssl rand -base64 32`). The highest version encrypts. Each value
// carries its key version, so rotating means adding a key and rewriting rows.
//
// Stored form: "enc:v<version>:<iv>.<tag>.<ciphertext>", all base64. Values
// without the prefix were written before encryption and are read as is.

const PREFIX = "enc:v";

type Keyring = { current: number; keys: Map<number, Buffer> };
let cached: { source: string; ring: Keyring } | null = null;

function keyring(): Keyring {
  const source = process.env.DATA_ENCRYPTION_KEYS ?? "";
  if (cached?.source === source) return cached.ring;
  const keys = new Map<number, Buffer>();
  for (const entry of source.split(",").map((s) => s.trim()).filter(Boolean)) {
    const [version, b64] = entry.split(":");
    const key = Buffer.from(b64 ?? "", "base64");
    if (!/^\d+$/.test(version ?? "") || key.length !== 32) {
      throw new Error("DATA_ENCRYPTION_KEYS must be version:base64 pairs of 32-byte keys");
    }
    keys.set(Number(version), key);
  }
  if (keys.size === 0) throw new Error("DATA_ENCRYPTION_KEYS is not set");
  const ring = { current: Math.max(...keys.keys()), keys };
  cached = { source, ring };
  return ring;
}

// `context` (the column, e.g. "clients.dui") is bound into the ciphertext, so
// a value copied into another column fails to decrypt.
export function encrypt(plaintext: string, context: string): string {
  const { current, keys } = keyring();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keys.get(current)!, iv);
  cipher.setAAD(Buffer.from(context));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `${PREFIX}${current}:${iv.toString("base64")}.${cipher.getAuthTag().toString("base64")}.${ct.toString("base64")}`;
}

export function isEncrypted(stored: string) {
  return stored.startsWith(PREFIX);
}

export function decrypt(stored: string, context: string): string {
  if (!isEncrypted(stored)) return stored;
  const match = /^enc:v(\d+):([^.]+)\.([^.]+)\.(.*)$/.exec(stored);
  if (!match) throw new Error(`Malformed encrypted value in ${context}`);
  const key = keyring().keys.get(Number(match[1]));
  if (!key) throw new Error(`No key version ${match[1]} for ${context}`);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(match[2], "base64"));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(match[3], "base64"));
  return Buffer.concat([decipher.update(Buffer.from(match[4], "base64")), decipher.final()]).toString("utf8");
}

export function keyVersion(stored: string): number | null {
  const match = /^enc:v(\d+):/.exec(stored);
  return match ? Number(match[1]) : null;
}

export function currentKeyVersion() {
  return keyring().current;
}
