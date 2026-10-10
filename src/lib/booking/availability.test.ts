import { describe, expect, it } from "vitest";
import { dayHours, findSlots, fromLocalString, toLocalString, type SlotQuery } from "./availability";

const tz = "America/Mexico_City"; // UTC-6, no DST since 2022
const base: SlotQuery = {
  timezone: tz,
  // Friday 10:00-12:00
  rules: [{ weekday: 5, startTime: "10:00:00", endTime: "12:00:00" }],
  exceptions: [],
  busy: [],
  durationMin: 30,
  fromDate: "2026-10-09",
  toDate: "2026-10-10",
  now: new Date("2026-10-01T00:00:00Z"),
};
const local = (slots: Date[]) => slots.map((s) => toLocalString(s, tz));

describe("findSlots", () => {
  it("fills opening hours on the right weekday, in local time", () => {
    expect(local(findSlots(base))).toEqual([
      "2026-10-09T10:00",
      "2026-10-09T10:30",
      "2026-10-09T11:00",
      "2026-10-09T11:30",
    ]);
  });

  it("skips times taken by an appointment, including its buffer", () => {
    const busy = [{ startsAt: new Date("2026-10-09T16:30:00Z"), endsAt: new Date("2026-10-09T17:00:00Z") }];
    expect(local(findSlots({ ...base, busy }))).toEqual([
      "2026-10-09T10:00",
      "2026-10-09T11:00",
      "2026-10-09T11:30",
    ]);
    expect(local(findSlots({ ...base, busy, bufferMin: 15 }))).toEqual(["2026-10-09T11:30"]);
  });

  it("does not offer a service that runs past closing", () => {
    expect(local(findSlots({ ...base, durationMin: 90 }))).toEqual([
      "2026-10-09T10:00",
      "2026-10-09T10:30",
    ]);
  });

  it("honours closed days and custom hours", () => {
    expect(findSlots({ ...base, exceptions: [{ date: "2026-10-09", startTime: null, endTime: null }] })).toEqual([]);
    const custom = findSlots({
      ...base,
      exceptions: [{ date: "2026-10-10", startTime: "09:00", endTime: "10:00" }],
    });
    expect(local(custom)).toContain("2026-10-10T09:00");
  });

  it("keeps the minimum notice before now", () => {
    const now = new Date("2026-10-09T16:10:00Z"); // 10:10 local
    expect(local(findSlots({ ...base, now }))).toEqual(["2026-10-09T11:30"]);
  });
});

describe("dayHours", () => {
  const rules = [
    { weekday: 5, startTime: "16:00:00", endTime: "19:00:00" },
    { weekday: 5, startTime: "09:00:00", endTime: "14:00:00" },
  ];
  it("lists a weekday's hours in order", () => {
    expect(dayHours(rules, [], "2026-10-09")).toEqual([
      ["09:00", "14:00"],
      ["16:00", "19:00"],
    ]);
    expect(dayHours(rules, [], "2026-10-10")).toEqual([]);
  });
  it("lets a date's exceptions replace the week", () => {
    expect(dayHours(rules, [{ date: "2026-10-09", startTime: null, endTime: null }], "2026-10-09")).toEqual([]);
    expect(dayHours(rules, [{ date: "2026-10-09", startTime: "10:00:00", endTime: "12:00:00" }], "2026-10-09")).toEqual([
      ["10:00", "12:00"],
    ]);
  });
});

describe("local strings", () => {
  it("round-trips through the business timezone", () => {
    const d = fromLocalString("2026-10-09T10:30", tz)!;
    expect(d.toISOString()).toBe("2026-10-09T16:30:00.000Z");
    expect(toLocalString(d, tz)).toBe("2026-10-09T10:30");
    expect(fromLocalString("mañana", tz)).toBeNull();
  });
});
