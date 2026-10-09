import { describe, expect, it } from "vitest";
import { can, needsDeviceCode } from "./permissions";

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

describe("needsDeviceCode", () => {
  it("asks doctors, clinic managers and Praxia staff, not other assistants", () => {
    expect(needsDeviceCode(doctor)).toBe(true);
    expect(needsDeviceCode({ ...assistant, managesClinic: true })).toBe(true);
    expect(needsDeviceCode(superAdmin)).toBe(true);
    expect(needsDeviceCode(assistant)).toBe(false);
  });
});
