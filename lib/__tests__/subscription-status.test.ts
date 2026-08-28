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

// ─────────────────────────────────────────────────────────────────────────────
// The bug this pins: pressing Subscribe created a row at status 'created' and
// every surface immediately called it a live subscription — "Subscribed —
// renews monthly" — while nothing had been authorised and nothing charged. It
// also hid the button, so the owner could not finish paying.
//
// 'created' means an unauthorised attempt. It must never read as subscribed.
// ─────────────────────────────────────────────────────────────────────────────

/** Mirrors the split in fetchOwnerBuyableHalls / the owner premium page. */
function classify(status: string): "live" | "unfinished" | "gone" {
  if (status === "created") return "unfinished";
  if (["active", "on_hold", "paused"].includes(status)) return "live";
  return "gone";
}

describe("a started-but-unpaid subscription is not a subscription", () => {
  it("'created' is unfinished, never live", () => {
    expect(classify("created")).toBe("unfinished");
  });

  it("only an authorised mandate counts as live", () => {
    expect(classify("active")).toBe("live");
    // on_hold / paused are live mandates that are temporarily interrupted — the
    // owner must not be offered a SECOND one, but they are not 'created'.
    expect(classify("on_hold")).toBe("live");
    expect(classify("paused")).toBe("live");
  });

  it("terminal states free the hall to subscribe again", () => {
    expect(classify("cancelled")).toBe("gone");
    expect(classify("failed")).toBe("gone");
    expect(classify("completed")).toBe("gone");
  });

  it("INITIALIZED from Cashfree lands on 'created', so it cannot read as live", () => {
    // The end-to-end version of the bug: Cashfree says INITIALIZED right after
    // the subscription is opened, that maps to 'created', and 'created' must
    // classify as unfinished.
    expect(classify(mapSubscriptionStatus("INITIALIZED"))).toBe("unfinished");
    expect(classify(mapSubscriptionStatus("BANK_APPROVAL_PENDING"))).toBe("unfinished");
    expect(classify(mapSubscriptionStatus("ACTIVE"))).toBe("live");
  });
});
