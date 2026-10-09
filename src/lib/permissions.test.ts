import { describe, expect, it } from "vitest";
import { can, needsSecondFactor } from "./permissions";

const doctor = { role: "doctor" as const, managesClinic: false };
const assistant = { role: "assistant" as const, managesClinic: false };
const superAdmin = { role: "super_admin" as const, managesClinic: true };

describe("can", () => {
  it("follows the permission table", () => {
    for (const m of [doctor, assistant]) {
      expect(can(m, "agenda")).toBe(true);
      expect(can(m, "patients")).toBe(true);
      expect(can(m, "clinic.manage")).toBe(false);
      expect(can({ ...m, managesClinic: true }, "clinic.manage")).toBe(true);
    }
    expect(can(doctor, "chart.clinical")).toBe(true);
    expect(can({ ...assistant, managesClinic: true }, "chart.clinical")).toBe(false);
    // Praxia's own staff can support a clinic but never read its charts (Art. 20).
    expect(can(superAdmin, "clinic.manage")).toBe(true);
    expect(can(superAdmin, "chart.clinical")).toBe(false);
  });
});

describe("needsSecondFactor", () => {
  it("is required for doctors only", () => {
    expect(needsSecondFactor("doctor", "aal1")).toBe(true);
    expect(needsSecondFactor("doctor", null)).toBe(true);
    expect(needsSecondFactor("doctor", "aal2")).toBe(false);
    expect(needsSecondFactor("assistant", "aal1")).toBe(false);
    expect(needsSecondFactor("super_admin", "aal1")).toBe(false);
  });
});
