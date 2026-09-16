import { describe, it, expect } from "vitest";
import {
  addDays,
  buildHallSearchHref,
  dayOfWeek,
  formatDateChoice,
  monthGrid,
  shiftMonth,
  weekendRange,
} from "../search-url";

// Behaviour, not source: these call the functions both search UIs rely on.
// 2026-09-16 is a Wednesday.

describe("buildHallSearchHref", () => {
  it("is plain /halls when nothing is chosen", () => {
    expect(buildHallSearchHref({})).toBe("/halls");
    expect(buildHallSearchHref({ city: "  ", capacity: "" })).toBe("/halls");
  });

  it("sends every field /halls reads", () => {
    expect(
      buildHallSearchHref({ city: "Madurai", date: "2026-11-20", dateTo: "2026-11-22", capacity: "300" }),
    ).toBe("/halls?city=Madurai&date=2026-11-20&dateTo=2026-11-22&capacity=300");
  });

  it("never sends dateTo without a date — it would silently do nothing", () => {
    expect(buildHallSearchHref({ dateTo: "2026-11-22" })).toBe("/halls");
  });

  it("drops a dateTo that is not after the date", () => {
    expect(buildHallSearchHref({ date: "2026-11-20", dateTo: "2026-11-20" })).toBe("/halls?date=2026-11-20");
    expect(buildHallSearchHref({ date: "2026-11-20", dateTo: "2026-11-19" })).toBe("/halls?date=2026-11-20");
  });

  it("ignores malformed dates and capacities instead of forwarding them", () => {
    expect(buildHallSearchHref({ date: "20-11-2026" })).toBe("/halls");
    expect(buildHallSearchHref({ capacity: "abc" })).toBe("/halls");
    expect(buildHallSearchHref({ capacity: "0" })).toBe("/halls");
    expect(buildHallSearchHref({ capacity: "0250" })).toBe("/halls?capacity=250");
  });

  it("encodes a city with spaces safely", () => {
    expect(buildHallSearchHref({ city: "Tiruchirappalli East" })).toBe("/halls?city=Tiruchirappalli+East");
  });
});

describe("date maths", () => {
  it("adds days across month and year ends", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29"); // leap year
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("knows the weekday", () => {
    expect(dayOfWeek("2026-09-16")).toBe(3); // Wednesday
    expect(dayOfWeek("2026-09-19")).toBe(6); // Saturday
    expect(dayOfWeek("2026-09-20")).toBe(0); // Sunday
  });
});

describe("weekendRange", () => {
  it("midweek: this weekend is the coming Saturday and Sunday", () => {
    expect(weekendRange("2026-09-16", "this")).toEqual({ date: "2026-09-19", dateTo: "2026-09-20" });
    expect(weekendRange("2026-09-16", "next")).toEqual({ date: "2026-09-26", dateTo: "2026-09-27" });
  });

  it("on Saturday: this weekend starts today", () => {
    expect(weekendRange("2026-09-19", "this")).toEqual({ date: "2026-09-19", dateTo: "2026-09-20" });
    expect(weekendRange("2026-09-19", "next")).toEqual({ date: "2026-09-26", dateTo: "2026-09-27" });
  });

  it("on Sunday: this weekend is only what is left of it — never a past Saturday", () => {
    expect(weekendRange("2026-09-20", "this")).toEqual({ date: "2026-09-20", dateTo: "2026-09-20" });
    expect(weekendRange("2026-09-20", "next")).toEqual({ date: "2026-09-26", dateTo: "2026-09-27" });
  });

  it("a Sunday 'this weekend' becomes a single-day search", () => {
    expect(buildHallSearchHref(weekendRange("2026-09-20", "this"))).toBe("/halls?date=2026-09-20");
  });
});

describe("formatDateChoice", () => {
  it("shows nothing, one day, or a range", () => {
    expect(formatDateChoice()).toBeNull();
    expect(formatDateChoice("2026-11-20")).toMatch(/20 Nov/);
    expect(formatDateChoice("2026-11-20")).toMatch(/Fri/);
    expect(formatDateChoice("2026-11-20", "2026-11-22")).toBe("20 Nov – 22 Nov");
  });

  it("treats a non-increasing range as a single day", () => {
    expect(formatDateChoice("2026-11-20", "2026-11-20")).not.toContain("–");
  });
});

describe("monthGrid", () => {
  it("lays September 2026 out Sunday-first, in whole weeks", () => {
    const rows = monthGrid(2026, 9);
    expect(rows.every((r) => r.length === 7)).toBe(true);
    // 1 September 2026 is a Tuesday: two empty cells first.
    expect(rows[0]).toEqual([null, null, "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"]);
    expect(rows.flat().filter(Boolean)).toHaveLength(30);
  });

  it("handles February in a leap year", () => {
    expect(monthGrid(2028, 2).flat().filter(Boolean)).toHaveLength(29);
  });

  it("steps months across a year boundary", () => {
    expect(shiftMonth(2026, 12, 1)).toEqual([2027, 1]);
    expect(shiftMonth(2026, 1, -1)).toEqual([2025, 12]);
  });
});
