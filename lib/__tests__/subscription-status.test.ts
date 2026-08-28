import { describe, it, expect } from "vitest";
import { mapSubscriptionStatus } from "@/lib/cashfree-subscriptions";
import { isPlanSubscriptionId, SUBSCRIPTION_ID_PREFIX } from "@/lib/plan-subscriptions";

// ─────────────────────────────────────────────────────────────────────────────
// This mapping decides whether an owner's hall is promoted and whether they are
// still being billed. Getting a state wrong in either direction is expensive:
// treating a dead mandate as live gives away promotion, treating a live one as
// dead invites a second mandate on top of the first.
// ─────────────────────────────────────────────────────────────────────────────

describe("Cashfree subscription status mapping", () => {
  it("only ACTIVE counts as actually subscribed", () => {
    expect(mapSubscriptionStatus("ACTIVE")).toBe("active");
    for (const s of ["INITIALIZED", "PENDING", "BANK_APPROVAL_PENDING", "ON_HOLD", "PAUSED", "CANCELLED", "COMPLETED"]) {
      expect(mapSubscriptionStatus(s)).not.toBe("active");
    }
  });

  it("states that are still on their way are 'created', not failures", () => {
    // An owner whose bank is still approving the auto-pay must not be told it
    // failed — they would set it up a second time and be billed twice.
    expect(mapSubscriptionStatus("INITIALIZED")).toBe("created");
    expect(mapSubscriptionStatus("PENDING")).toBe("created");
    expect(mapSubscriptionStatus("BANK_APPROVAL_PENDING")).toBe("created");
  });

  it("a paused or held mandate is neither active nor cancelled", () => {
    // It can resume, so it must keep blocking a duplicate subscription.
    expect(mapSubscriptionStatus("ON_HOLD")).toBe("on_hold");
    expect(mapSubscriptionStatus("PAUSED")).toBe("paused");
  });

  it("terminal states are distinguished from each other", () => {
    expect(mapSubscriptionStatus("CANCELLED")).toBe("cancelled");
    expect(mapSubscriptionStatus("COMPLETED")).toBe("completed");
  });

  it("an unknown or missing status is treated as failed, never as active", () => {
    // Fail closed: a status we do not recognise must never grant promotion.
    expect(mapSubscriptionStatus("SOMETHING_NEW")).toBe("failed");
    expect(mapSubscriptionStatus(undefined)).toBe("failed");
    expect(mapSubscriptionStatus(null)).toBe("failed");
    expect(mapSubscriptionStatus("")).toBe("failed");
  });

  it("is case-insensitive, since the field is free text on the wire", () => {
    expect(mapSubscriptionStatus("active")).toBe("active");
  });
});

describe("subscription ids", () => {
  it("are distinguishable from one-off plan orders", () => {
    // The webhook and the status page both branch on this. A subscription id
    // mistaken for an order id would be looked up as an order and never found.
    expect(isPlanSubscriptionId(`${SUBSCRIPTION_ID_PREFIX}abc_1`)).toBe(true);
    expect(isPlanSubscriptionId("HNP_abc_1")).toBe(false);
    expect(isPlanSubscriptionId("HN_abc_1")).toBe(false);
  });
});
