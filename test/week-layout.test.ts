import { describe, expect, it } from "vitest";
import { mergeWindows } from "@/lib/dashboard/agenda";
import { gridRange, placeInLanes } from "@/lib/dashboard/week-layout";

describe("placeInLanes", () => {
  it("keeps separate items full width", () => {
    const placed = placeInLanes([
      { id: "a", start: 540, end: 570 },
      { id: "b", start: 570, end: 600 },
    ]);
    expect(placed.map((p) => [p.id, p.lane, p.lanes])).toEqual([
      ["a", 0, 1],
      ["b", 0, 1],
    ]);
  });

  it("puts overlapping items side by side and reuses free lanes", () => {
    const placed = placeInLanes([
      { id: "a", start: 540, end: 600 },
      { id: "b", start: 550, end: 570 },
      { id: "c", start: 575, end: 590 },
      { id: "d", start: 660, end: 690 },
    ]);
    const by = Object.fromEntries(placed.map((p) => [p.id, [p.lane, p.lanes]]));
    expect(by).toEqual({ a: [0, 2], b: [1, 2], c: [1, 2], d: [0, 1] });
  });
});

describe("gridRange", () => {
  it("spans the opening hours and anything booked outside them, in whole hours", () => {
    expect(gridRange([["08:30", "17:00"]], [{ id: "x", start: 17 * 60 + 15, end: 17 * 60 + 45 }])).toEqual([480, 1080]);
    expect(gridRange([], [])).toEqual([480, 1080]);
  });
});

describe("mergeWindows", () => {
  it("joins overlapping doctors' hours", () => {
    expect(
      mergeWindows([
        ["14:00", "18:00"],
        ["08:00", "12:00"],
        ["11:00", "13:00"],
      ]),
    ).toEqual([
      ["08:00", "13:00"],
      ["14:00", "18:00"],
    ]);
  });
});
