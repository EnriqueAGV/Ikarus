import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyKapsoSignature } from "./webhook";

const secret = "test-secret";
const body = JSON.stringify({ phone_number_id: "123", customer: { id: "c1" } });
const sign = (raw: string) =>
  createHmac("sha256", secret).update(raw).digest("hex");

describe("verifyKapsoSignature", () => {
  it("accepts a signature over the raw body", () => {
    expect(verifyKapsoSignature(body, sign(body), secret)).toBe(true);
  });

  it("rejects a tampered body", () => {
    expect(verifyKapsoSignature(body + " ", sign(body), secret)).toBe(false);
  });

  it("rejects a missing or short signature without throwing", () => {
    expect(verifyKapsoSignature(body, null, secret)).toBe(false);
    expect(verifyKapsoSignature(body, "abc", secret)).toBe(false);
  });
});
