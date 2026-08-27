import { describe, it, expect } from "vitest";
import { planWindow, isPlanOrderId, PLAN_ORDER_PREFIX } from "@/lib/plan-payments";

// ─────────────────────────────────────────────────────────────────────────────
// planWindow decides how many days of promotion an owner receives for ₹4,999 or
// ₹9,999. An off-by-one here is either a day stolen from a paying owner or a
// day given away on every purchase, and neither shows up in any other test.
// ─────────────────────────────────────────────────────────────────────────────

describe("planWindow", () => {
  it("gives exactly the days paid for, counting today", () => {
    const w = planWindow({ today: "2026-09-01", activeEndDate: null, durationDays: 30 });

    expect(w.mode).toBe("new");
    expect(w.startDate).toBe("2026-09-01");
    // 1 Sep through 30 Sep inclusive is 30 days. Ending on 1 Oct would be 31.
    expect(w.endDate).toBe("2026-09-30");

    const days =
      (Date.parse(`${w.endDate}T00:00:00Z`) - Date.parse(`${w.startDate}T00:00:00Z`))
        / 86_400_000 + 1;
    expect(days).toBe(30);
  });

  it("renewing an active plan adds the full duration instead of restarting it", () => {
    // 20 days still to run. A renewal must not throw those away.
    const w = planWindow({ today: "2026-09-01", activeEndDate: "2026-09-20", durationDays: 30 });

    expect(w.mode).toBe("extend");
    expect(w.endDate).toBe("2026-10-20");
  });

  it("renewing on the last day of the window still extends rather than restarts", () => {
    // The boundary that decides between the two branches: end_date === today
    // means the plan is still live today, so this is a renewal.
    const w = planWindow({ today: "2026-09-20", activeEndDate: "2026-09-20", durationDays: 30 });

    expect(w.mode).toBe("extend");
    expect(w.endDate).toBe("2026-10-20");
  });

  it("buying again after a plan has lapsed starts fresh, not backdated", () => {
    // Expired yesterday. The new window must begin today — extending a dead
    // window would silently burn days the owner just paid for.
    const w = planWindow({ today: "2026-09-21", activeEndDate: "2026-09-20", durationDays: 30 });

    expect(w.mode).toBe("new");
    expect(w.startDate).toBe("2026-09-21");
    expect(w.endDate).toBe("2026-10-20");
  });

  it("crosses month and year boundaries correctly", () => {
    expect(planWindow({ today: "2026-12-15", activeEndDate: null, durationDays: 30 }).endDate)
      .toBe("2027-01-13");
    // 2028 is a leap year: 1 Feb + 30 days must land on 1 Mar, not 2 Mar.
    expect(planWindow({ today: "2028-02-01", activeEndDate: null, durationDays: 30 }).endDate)
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
