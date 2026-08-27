import { describe, it, expect } from "vitest";
import { planWindow, isPlanOrderId, PLAN_ORDER_PREFIX } from "@/lib/plan-payments";

// ─────────────────────────────────────────────────────────────────────────────
// planWindow decides how many days of promotion an owner receives for ₹4,999 or
// ₹9,999. An off-by-one here is either a day stolen from a paying owner or a
// day given away on every purchase, and neither shows up in any other test.
// ─────────────────────────────────────────────────────────────────────────────

/** Inclusive day count for a [start, end] window. */
function days(w: { startDate: string; endDate: string }): number {
  return (Date.parse(`${w.endDate}T00:00:00Z`) - Date.parse(`${w.startDate}T00:00:00Z`))
    / 86_400_000 + 1;
}

describe("planWindow", () => {
  it("gives exactly the days paid for, counting the start day", () => {
    const w = planWindow({ today: "2026-09-01", sameplanEndDate: null, durationDays: 30 });

    expect(w.mode).toBe("immediate");
    expect(w.startDate).toBe("2026-09-01");
    // 1 Sep through 30 Sep inclusive is 30 days. Ending on 1 Oct would be 31.
    expect(w.endDate).toBe("2026-09-30");
    expect(days(w)).toBe(30);
  });

  it("renewing a live plan queues the new window with no gap and no overlap", () => {
    // 20 days still to run. The renewal must add its full duration on top,
    // starting the day AFTER the current window ends — a start on the same day
    // would double-count that day and lose one.
    const w = planWindow({ today: "2026-09-01", sameplanEndDate: "2026-09-20", durationDays: 30 });

    expect(w.mode).toBe("queued");
    expect(w.startDate).toBe("2026-09-21");
    expect(w.endDate).toBe("2026-10-20");
    expect(days(w)).toBe(30);
  });

  it("renewal totals the same coverage as extending in place used to", () => {
    // The old code mutated end_date to activeEnd + duration. Queuing must be
    // equivalent in what the owner actually gets: cover through 20 Oct.
    const w = planWindow({ today: "2026-09-01", sameplanEndDate: "2026-09-20", durationDays: 30 });
    expect(w.endDate).toBe("2026-10-20");
  });

  it("renewing on the last day of the window still queues rather than restarting", () => {
    // The boundary that decides the branch: end_date === today means the plan
    // is still live today, so this is a renewal, not a fresh purchase.
    const w = planWindow({ today: "2026-09-20", sameplanEndDate: "2026-09-20", durationDays: 30 });

    expect(w.mode).toBe("queued");
    expect(w.startDate).toBe("2026-09-21");
    expect(w.endDate).toBe("2026-10-20");
  });

  it("buying again after a plan has lapsed starts today, not backdated", () => {
    // Expired yesterday. Queuing from a dead window would burn days the owner
    // just paid for.
    const w = planWindow({ today: "2026-09-21", sameplanEndDate: "2026-09-20", durationDays: 30 });

    expect(w.mode).toBe("immediate");
    expect(w.startDate).toBe("2026-09-21");
    expect(w.endDate).toBe("2026-10-20");
  });

  it("a DIFFERENT plan starts today even while another is running", () => {
    // sameplanEndDate is null because the caller only looks up a live listing
    // for the SAME plan. An owner on Premium who buys Pro must be promoted now,
    // not when Premium lapses — recompute_hall_premium takes the higher tier.
    const w = planWindow({ today: "2026-09-01", sameplanEndDate: null, durationDays: 30 });
    expect(w.mode).toBe("immediate");
    expect(w.startDate).toBe("2026-09-01");
  });

  it("crosses month and year boundaries correctly", () => {
    expect(planWindow({ today: "2026-12-15", sameplanEndDate: null, durationDays: 30 }).endDate)
      .toBe("2027-01-13");
    // 2028 is a leap year: 1 Feb + 30 days must land on 1 Mar, not 2 Mar.
    expect(planWindow({ today: "2028-02-01", sameplanEndDate: null, durationDays: 30 }).endDate)
      .toBe("2028-03-01");
  });
});

describe("plan order ids", () => {
  it("routes plan orders away from the booking handler", () => {
    // The webhook dispatches on this prefix alone. If a plan order were
    // mistaken for a booking order it would be looked up as a booking, found
    // missing, and the owner's payment would never activate anything.
    expect(isPlanOrderId(`${PLAN_ORDER_PREFIX}abc_123`)).toBe(true);
    expect(isPlanOrderId("HN_abc_123")).toBe(false);
  });

  it("is not confused by a booking order id that merely contains the prefix", () => {
    expect(isPlanOrderId("HN_HNP_notaplan")).toBe(false);
  });
});
