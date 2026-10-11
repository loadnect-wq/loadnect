import { beforeEach, describe, expect, it, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Every SMS variable fits 30 characters (2026-10-11).
//
// DLT caps each {#var#} at 30 characters. A longer value gets the whole
// message rejected by the carrier while MSG91 still reports success: a
// 48-character variable failed on 2026-09-10, and the same template with short
// values was delivered. MAX_VARIABLE_LENGTH was 60, so the clamp let those
// through.
//
// The clamp is now 30, but a clamp only hides the problem: "You can now list
// halls, man..." is delivered and reads as broken. So these tests run the REAL
// notify functions against a fake database and check the RAW values they hand
// over. Every fixed piece of wording has to fit before the clamp ever sees it.
// Names here are kept short on purpose, so anything over 30 is wording.
// ─────────────────────────────────────────────────────────────────────────────

type Req = {
  recipientType: "customer" | "owner" | "admin";
  templateKey: string;
  templateVariables: unknown[];
  eventType: string;
};
const sent: Req[] = [];

vi.mock("@/lib/notifications/service", () => ({
  dispatchAll: vi.fn(async (reqs: Req[]) => { sent.push(...reqs); }),
  getAdminNotificationPhone: vi.fn(async () => "+919000000001"),
}));

const OWNER = {
  profile_id: "o1",
  business_phone: "+919876500000",
  business_name: "Ravi Halls",
  profiles: { full_name: "Ravi", phone: "+919876500000", notifications_enabled: true },
};
const rows: Record<string, unknown> = {
  bookings: {
    id: "3f1a2b4c-55d6-4e7f-8a9b-0c1d2e3f4a5b",
    hall_id: "h1",
    customer_id: "c1",
    event_date: "2027-01-12",
    end_date: null,
    total_amount: 1234567,
    contact_phone: "+919876543210",
    halls: { name: "Meenakshi Mahal", owner_id: "o1", hall_owners: OWNER },
    profiles: { full_name: "Priya", phone: "+919876543210", phone_verified: true, notifications_enabled: true },
  },
  halls: { name: "Meenakshi Mahal", hall_owners: OWNER },
  profiles: { id: "o1", phone: "+919876500000", full_name: "Ravi", notifications_enabled: true },
};

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdminClient: () => ({
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
      };
      return chain;
    },
  }),
}));

import {
  notifyBookingEvent,
  notifyHallModerated,
  notifyOwnerAccountDecision,
  notifyPremiumChanged,
  notifySubscriptionStopped,
  balanceNote,
  guestLabel,
  type BookingEventKind,
} from "@/lib/notifications/events";
import { MAX_VARIABLE_LENGTH, coerceVariables, renderTemplate, type SmsTemplateKey } from "@/lib/notifications/sms-templates";

const LONG_REASON = "We are closed for renovation during the whole of that month";

/** Admin `details` is the one value allowed to run long: the webhook shows it whole. */
function rawValuesThatMustFit(r: Req): string[] {
  const vals = r.templateVariables.map((v) => (v === null || v === undefined ? "" : String(v)));
  return r.recipientType === "admin" ? [vals[0], vals[2]] : vals;
}

function expectAllFit(reqs: Req[]) {
  expect(reqs.length).toBeGreaterThan(0);
  for (const r of reqs) {
    for (const v of rawValuesThatMustFit(r)) {
      expect(v.length, `${r.eventType} → ${r.recipientType}: "${v}" is ${v.length} chars`).toBeLessThanOrEqual(30);
    }
  }
}

beforeEach(() => { sent.length = 0; });

describe("the cap itself", () => {
  it("is 30, the DLT per-variable limit", () => {
    expect(MAX_VARIABLE_LENGTH).toBe(30);
  });

  it("clamps an over-long value to 30 and marks the cut", () => {
    const [v] = coerceVariables("OWNER_HALL_LIVE", ["A".repeat(80)]);
    expect(v.length).toBe(30);
    expect(v.endsWith("...")).toBe(true);
  });

  it("lets only an explicit caller (the admin webhook) ask for more", () => {
    const [, details] = coerceVariables("ADMIN_ALERT", ["e", "x".repeat(80), "r"], 300);
    expect(details).toBe("x".repeat(80));
  });
});

describe("every message's fixed wording fits before the clamp", () => {
  const kinds: BookingEventKind[] = [
    "booking.requested", "booking.confirmed", "booking.rejected", "booking.cancelled",
    "payment.success", "payment.failed", "refund.initiated", "refund.sent",
  ];

  for (const kind of kinds) {
    it(`booking event ${kind}`, async () => {
      await notifyBookingEvent(kind, "3f1a2b4c-55d6-4e7f-8a9b-0c1d2e3f4a5b", { amount: 25000, reason: LONG_REASON });
      expectAllFit(sent);
    });
  }

  for (const action of ["approved", "rejected", "suspended", "unsuspended"] as const) {
    it(`hall ${action}`, async () => {
      await notifyHallModerated("h1", action, LONG_REASON);
      expectAllFit(sent);
    });
  }

  for (const kind of ["approved", "verified", "suspended", "restored"] as const) {
    it(`owner account ${kind}`, async () => {
      await notifyOwnerAccountDecision({ profileId: "o1", kind, reason: LONG_REASON });
      expectAllFit(sent);
    });
  }

  for (const activated of [true, false]) {
    it(`premium ${activated ? "activated" : "ended"}`, async () => {
      await notifyPremiumChanged("l1", "h1", activated, "Elite");
      expectAllFit(sent);
    });
  }

  for (const status of ["cancelled", "failed"] as const) {
    for (const paidUntil of ["2026-09-30", null]) {
      it(`subscription ${status}, paid until ${paidUntil ?? "unknown"}`, async () => {
        await notifySubscriptionStopped({ subscriptionId: "s1", hallId: "h1", planLabel: "Elite", status, paidUntil });
        expectAllFit(sent);
      });
    }
  }

  it("the balance note fits even at twelve lakh", () => {
    for (const [paid, total] of [[0, 100], [100, 100], [25000, 1259567]]) {
      expect(balanceNote(paid, total).replace("₹", "Rs.").length).toBeLessThanOrEqual(30);
    }
    expect(balanceNote(25000, 1259567)).toBe("₹12,34,567 due at the venue.");
  });
});

describe("the guest count matches the DLT-registered pattern (HallnectNewLead)", () => {
  // Registered 2026-10-11 with "Guests:" tagged Alphanumeric and the sample
  // "400 people"; the portal refuses a number-only value for that tag.
  it("always carries words, never a bare number", () => {
    expect(guestLabel(400)).toBe("400 people");
    expect(guestLabel(1)).toBe("1 person");
    expect(guestLabel(null)).toBe("Not specified");
    expect(guestLabel(undefined)).toBe("Not specified");
    for (const n of [0, 1, 50, 2500]) expect(guestLabel(n)).toMatch(/[a-z]/);
  });
});

describe("free text is sent whole or not at all, never clipped", () => {
  const variablesOf = (recipient: Req["recipientType"]) =>
    sent.find((r) => r.recipientType === recipient)?.templateVariables ?? [];

  it("a venue's decline reason stays out of the family's SMS", async () => {
    await notifyBookingEvent("booking.rejected", "3f1a2b4c-55d6-4e7f-8a9b-0c1d2e3f4a5b", { reason: "Hall booked" });
    expect(variablesOf("customer")[4]).toBe("Declined by the venue");
  });

  it("a cancellation reason that fits is the whole note; a long one is dropped", async () => {
    await notifyBookingEvent("booking.cancelled", "3f1a2b4c-55d6-4e7f-8a9b-0c1d2e3f4a5b", { reason: "Venue did not respond in time" });
    expect(variablesOf("customer")[4]).toBe("Venue did not respond in time");
    sent.length = 0;
    await notifyBookingEvent("booking.cancelled", "3f1a2b4c-55d6-4e7f-8a9b-0c1d2e3f4a5b", { reason: LONG_REASON });
    expect(variablesOf("customer")[4]).toBe("Cancelled");
  });

  it("an admin's hall reason that fits is sent; a long one points to the Halls page", async () => {
    await notifyHallModerated("h1", "rejected", "Photos are blurry");
    expect(variablesOf("owner")[1]).toBe("Photos are blurry");
    sent.length = 0;
    await notifyHallModerated("h1", "rejected", LONG_REASON);
    expect(variablesOf("owner")[1]).toBe("Shown on your Halls page");
  });

  it("no owner message carries an email address or a phone number", async () => {
    await notifyOwnerAccountDecision({ profileId: "o1", kind: "suspended", reason: null });
    await notifyHallModerated("h1", "suspended", null);
    for (const r of sent) {
      const text = renderTemplate(r.templateKey as SmsTemplateKey, coerceVariables(r.templateKey as SmsTemplateKey, r.templateVariables as string[]));
      expect(text).not.toMatch(/@|\d{10}/);
    }
  });
});
