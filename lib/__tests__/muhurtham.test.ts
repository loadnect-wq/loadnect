import { describe, expect, it } from "vitest";
import { MUHURTHAM_COVERAGE_END, MUHURTHAM_DATES, isMuhurtham, nextMuhurthamDates } from "../muhurtham";

// The list is hand-maintained data (see the header of lib/muhurtham.ts). These
// tests pin its shape so an edit cannot quietly break the calendar markers.

describe("the muhurtham list", () => {
  it("holds real ISO dates", () => {
    for (const d of MUHURTHAM_DATES) {
      expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const [y, m, day] = d.split("-").map(Number);
      const parsed = new Date(Date.UTC(y, m - 1, day));
      // Rejects 2027-02-30 and friends, which Date would silently roll over.
      expect(parsed.getUTCMonth()).toBe(m - 1);
      expect(parsed.getUTCDate()).toBe(day);
    }
  });

  it("is sorted and has no duplicates — nextMuhurthamDates relies on order", () => {
    const sorted = [...MUHURTHAM_DATES].sort();
    expect(MUHURTHAM_DATES).toEqual(sorted);
    expect(new Set(MUHURTHAM_DATES).size).toBe(MUHURTHAM_DATES.length);
  });

  it("stays inside its coverage window", () => {
    expect(MUHURTHAM_DATES.at(-1)! <= MUHURTHAM_COVERAGE_END).toBe(true);
  });

  it("keeps out of the months Tamil weddings avoid", () => {
    // Aadi, Purattasi and Margazhi, by their approximate Gregorian windows.
    // A date inside one of these almost certainly came from a bad copy.
    const avoided = (d: string) => {
      const md = d.slice(5);
      return (
        (md >= "07-18" && md <= "08-16") || // Aadi
        (md >= "09-18" && md <= "10-17") || // Purattasi
        md >= "12-17" || md <= "01-14"      // Margazhi
      );
    };
    expect(MUHURTHAM_DATES.filter(avoided)).toEqual([]);
  });

  it("carries the 56 dates both 2027 publishers agree on", () => {
    expect(MUHURTHAM_DATES.filter((d) => d.startsWith("2027"))).toHaveLength(56);
  });
});

describe("lookups", () => {
  it("answers isMuhurtham for a listed and an unlisted day", () => {
    expect(isMuhurtham("2026-11-11")).toBe(true);
    expect(isMuhurtham("2026-11-12")).toBe(false);
  });

  it("returns the next days on or after a date, in order", () => {
    expect(nextMuhurthamDates("2026-10-02", 3)).toEqual(["2026-10-25", "2026-10-30", "2026-11-01"]);
    expect(nextMuhurthamDates("2026-10-25")).toEqual(["2026-10-25"]); // inclusive
    expect(nextMuhurthamDates("2028-01-01")).toEqual([]);             // past coverage
  });
});
