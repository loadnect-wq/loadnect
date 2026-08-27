// Security regressions found in the pre-launch audit.
//
// Each case below is a defect that was live, not a hypothetical. They are
// pinned here because every one of them is invisible in normal use: nothing
// errors, nothing looks broken, and the damage only surfaces as money in the
// wrong place or a moderated review reappearing.

import { describe, it, expect } from "vitest";
import { safeHttpUrl } from "@/lib/utils";
import { OWNER_EDITABLE_AVAIL_STATUSES } from "@/lib/validation/schemas";
import { availabilityBatchSchema, parseSafe } from "@/lib/validation/schemas";

describe("safeHttpUrl — owner-supplied links rendered in the ADMIN dashboard", () => {
  it("passes ordinary http(s) links through", () => {
    expect(safeHttpUrl("https://example.com/receipt.png")).toBe("https://example.com/receipt.png");
    expect(safeHttpUrl("http://example.com/a.jpg")).toBe("http://example.com/a.jpg");
  });

  it("REFUSES javascript: — this was stored XSS into an admin session", () => {
    // An owner could write screenshot_url straight through PostgREST (the RLS
    // insert policy constrains owner_id and status, not this column). The
    // admin clicking "View screenshot" would then run it as an admin.
    expect(safeHttpUrl("javascript:alert(document.cookie)")).toBeNull();
    expect(safeHttpUrl("JavaScript:fetch('/admin')")).toBeNull();
    expect(safeHttpUrl("  javascript:void(0)  ")).toBeNull();
  });

  it("refuses other executable or smuggling schemes", () => {
    expect(safeHttpUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(safeHttpUrl("vbscript:msgbox(1)")).toBeNull();
    expect(safeHttpUrl("file:///etc/passwd")).toBeNull();
  });

  it("refuses junk rather than emitting a broken href", () => {
    expect(safeHttpUrl(null)).toBeNull();
    expect(safeHttpUrl(undefined)).toBeNull();
    expect(safeHttpUrl("")).toBeNull();
    expect(safeHttpUrl("not a url")).toBeNull();
  });
});

describe("availability — an owner may not rewrite booking-owned dates", () => {
  it("accepts every status the calendar can post back", () => {
    // The schema allowed only 3 of the 8 enum values, so the moment a hall had
    // one confirmed booking the calendar echoed back 'full_day_booked' and the
    // WHOLE batch failed validation — the owner could never save again.
    for (const status of [
      "available", "blocked", "booked", "partially_booked",
      "morning_booked", "evening_booked", "full_day_booked", "maintenance",
    ]) {
      const r = parseSafe(availabilityBatchSchema, {
        hallId: "13baf0ec-2e24-40d7-8c02-d985a7c6da08",
        entries: [{ date: "2026-12-01", slot: "full_day", status }],
      });
      expect(r.ok, `status ${status} should parse`).toBe(true);
    }
  });

  it("names only the three statuses an owner may actually set", () => {
    // The action filters writes to this list, so a client cannot flip a
    // booked date back to 'available' and free a confirmed booking's dates.
    expect([...OWNER_EDITABLE_AVAIL_STATUSES].sort()).toEqual(["available", "blocked", "maintenance"]);
    for (const bookingOwned of ["booked", "full_day_booked", "morning_booked", "evening_booked", "partially_booked"]) {
      expect(OWNER_EDITABLE_AVAIL_STATUSES).not.toContain(bookingOwned);
    }
  });

  it("still rejects a status that is not in the database enum at all", () => {
    const r = parseSafe(availabilityBatchSchema, {
      hallId: "13baf0ec-2e24-40d7-8c02-d985a7c6da08",
      entries: [{ date: "2026-12-01", slot: "full_day", status: "definitely_not_a_status" }],
    });
    expect(r.ok).toBe(false);
  });
});
