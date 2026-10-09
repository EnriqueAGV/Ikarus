import { afterEach, describe, expect, it } from "vitest";
import { currentKeyVersion, decrypt, encrypt, keyVersion } from "./crypto";

const key = (n: number) => Buffer.alloc(32, n).toString("base64");
const original = process.env.DATA_ENCRYPTION_KEYS;
afterEach(() => {
  process.env.DATA_ENCRYPTION_KEYS = original;
});

describe("column encryption", () => {
  it("round-trips, and each value is different ciphertext", () => {
    const a = encrypt("01234567-8", "clients.dui");
    expect(a).not.toContain("01234567");
    expect(encrypt("01234567-8", "clients.dui")).not.toBe(a);
    expect(decrypt(a, "clients.dui")).toBe("01234567-8");
  });

  it("won't decrypt in another column or after tampering", () => {
    const a = encrypt("Penicilina", "clients.allergies");
    expect(() => decrypt(a, "clients.dui")).toThrow();
    expect(() => decrypt(a.slice(0, -4) + "AAAA", "clients.allergies")).toThrow();
  });

  it("reads values written before encryption as they are", () => {
    expect(decrypt('{"motivo":"control"}', "clients.data")).toBe('{"motivo":"control"}');
  });

  it("rotates: the newest key encrypts, older keys still read", () => {
    process.env.DATA_ENCRYPTION_KEYS = `1:${key(1)}`;
    const old = encrypt("hola", "messages.body");
    process.env.DATA_ENCRYPTION_KEYS = `1:${key(1)},2:${key(2)}`;
    expect(currentKeyVersion()).toBe(2);
    expect(keyVersion(encrypt("hola", "messages.body"))).toBe(2);
    expect(decrypt(old, "messages.body")).toBe("hola");
    process.env.DATA_ENCRYPTION_KEYS = `2:${key(2)}`;
    expect(() => decrypt(old, "messages.body")).toThrow("No key version 1");
  });

  it("refuses a missing or malformed key", () => {
    process.env.DATA_ENCRYPTION_KEYS = "";
    expect(() => encrypt("x", "c")).toThrow("not set");
    process.env.DATA_ENCRYPTION_KEYS = "1:short";
    expect(() => encrypt("x", "c")).toThrow("32-byte");
  });
});
