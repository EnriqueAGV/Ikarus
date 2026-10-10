import { describe, expect, it } from "vitest";
import { displayDate, displayDateTime, displayTime, isoDate, normalizeChatDates, normalizeChatTimes, parseDisplayTime } from "./dates";

describe("calendar date conventions", () => {
  it("uses day-first dates without shifting birth dates", () => {
    expect(displayDate("2001-10-08")).toBe("08-10-2001");
    expect(isoDate("08-10-2001")).toBe("2001-10-08");
    expect(displayDateTime(new Date("2026-01-01T02:30:00Z"), "America/El_Salvador")).toBe("31-12-2025, 8:30 PM");
  });
  it("rejects impossible dates and respects leap years", () => {
    expect(isoDate("29-02-2024")).toBe("2024-02-29");
    for (const date of ["29-02-2025", "31-04-2026", "2026-02-30", "10/08/2001"]) expect(isoDate(date)).toBeNull();
    expect(displayDate("Sin registrar")).toBe("Sin registrar");
  });
  it("normalizes generated dates while preserving links and identifiers", () => {
    expect(normalizeChatDates("Cita 2026-10-13T10:00; nació 04/05/1990. 8 de octubre de 2001. https://example.test/2026-10-13 DUI 01234567-8"))
      .toBe("Cita 13-10-2026, 10:00; nació 04-05-1990. 08-10-2001. https://example.test/2026-10-13 DUI 01234567-8");
  });
  it("converts noon and midnight without changing the scheduled hour", () => {
    for (const [stored, shown] of [["00:00", "12:00 AM"], ["12:00", "12:00 PM"], ["09:05", "9:05 AM"], ["16:30", "4:30 PM"], ["23:59", "11:59 PM"]]) {
      expect(displayTime(stored)).toBe(shown);
      expect(parseDisplayTime(shown)).toBe(stored);
    }
    expect(parseDisplayTime("4:30 pm")).toBe("16:30");
    for (const bad of ["16:30", "13:00 PM", "0:30 AM", "12:60 PM"]) expect(parseDisplayTime(bad)).toBeNull();
  });
  it("normalizes generated times without doubling meridians or rewriting URLs", () => {
    expect(normalizeChatTimes("00:00, 12:00, 16:30, 4:30 PM, 9:05 a. m. https://example.test/16:30"))
      .toBe("12:00 AM, 12:00 PM, 4:30 PM, 4:30 PM, 9:05 AM https://example.test/16:30");
  });
});
