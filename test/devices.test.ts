import { beforeEach, describe, expect, it } from "vitest";

const { db, schema } = await import("@/db");
const { sql } = await import("drizzle-orm");
const devices = await import("@/lib/devices");

let ana: string;
let luis: string;

beforeEach(async () => {
  await db.execute(sql`truncate trusted_devices, profiles cascade`);
  [{ id: ana }, { id: luis }] = await db
    .insert(schema.profiles)
    .values([
      { id: crypto.randomUUID(), email: "ana@luna.sv" },
      { id: crypto.randomUUID(), email: "luis@luna.sv" },
    ])
    .returning();
});

describe("trusted devices", () => {
  it("trusts a device for its owner only, by a token stored as a hash", async () => {
    const token = await devices.trustDevice(ana, "Chrome en Mac");
    expect(await devices.isTrustedDevice(ana, token)).toBe(true);
    expect(await devices.isTrustedDevice(luis, token)).toBe(false);
    expect(await devices.isTrustedDevice(ana, undefined)).toBe(false);
    expect(await devices.isTrustedDevice(ana, "made-up")).toBe(false);
    const [row] = await db.select().from(schema.trustedDevices);
    expect(row.tokenHash).not.toContain(token);
    expect(row.label).toBe("Chrome en Mac");
  });

  it("forgets every device of one person", async () => {
    const first = await devices.trustDevice(ana, null);
    const second = await devices.trustDevice(ana, null);
    const other = await devices.trustDevice(luis, null);
    await devices.forgetDevices(ana);
    expect(await devices.isTrustedDevice(ana, first)).toBe(false);
    expect(await devices.isTrustedDevice(ana, second)).toBe(false);
    expect(await devices.isTrustedDevice(luis, other)).toBe(true);
  });

  it("names devices from the user agent", () => {
    expect(devices.deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Version/17.0 Mobile Safari/604.1")).toBe("Safari en iPhone");
    expect(devices.deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36")).toBe("Chrome en Windows");
    expect(devices.deviceLabel(null)).toBeNull();
  });
});
