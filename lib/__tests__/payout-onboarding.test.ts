// Owner payout onboarding.
//
// Everything here is a gate an owner hits BEFORE any money can reach them. Each
// case below is a real rejection Cashfree returned during integration — the
// point of validating locally is that the owner is told what to fix while they
// are still on the form, instead of hours later at payout setup.

import { describe, it, expect } from "vitest";
import { ownerBusinessSchema } from "@/lib/validation/schemas";
import { toVendorId, isEasySplitEnabled } from "@/lib/easy-split";

/** A complete, valid set of business details. */
const VALID = {
  businessName: "Grand Lotus Mahal",
  businessEmail: "owner@example.com",
  businessPhone: "9344040013",
  panNumber: "ABCDE1234F",
  payoutAccountNumber: "123456789012",
  payoutIfsc: "HDFC0000001",
};

describe("business details accepted by Cashfree", () => {
  it("accepts a complete, well-formed set", () => {
    expect(ownerBusinessSchema.safeParse(VALID).success).toBe(true);
  });

  it("rejects a PAN that is not the Indian format", () => {
    // The exact class of value that was stored and then rejected at onboarding.
    for (const pan of ["1234566777", "ABCDE1234", "ABCD01234F", "abcde1234"]) {
      expect(ownerBusinessSchema.safeParse({ ...VALID, panNumber: pan }).success).toBe(false);
    }
    expect(ownerBusinessSchema.safeParse({ ...VALID, panNumber: "abcde1234f" }).success).toBe(true);
  });

  it("rejects an IFSC that is not 11 chars with a 0 in position 5", () => {
    for (const ifsc of ["HDFC000001", "HDFC1000001", "HD0FC000001", "HDFC00000012"]) {
      expect(ownerBusinessSchema.safeParse({ ...VALID, payoutIfsc: ifsc }).success).toBe(false);
    }
  });

  it("rejects an account number that is not 6-20 digits", () => {
    for (const acc of ["12345", "1234-5678", "abcdefgh", "1".repeat(21)]) {
      expect(ownerBusinessSchema.safeParse({ ...VALID, payoutAccountNumber: acc }).success).toBe(false);
    }
  });

  it("rejects a 9-digit phone — Cashfree requires a real 10-digit Indian mobile", () => {
    expect(ownerBusinessSchema.safeParse({ ...VALID, businessPhone: "934404001" }).success).toBe(false);
    expect(ownerBusinessSchema.safeParse({ ...VALID, businessPhone: "1344040013" }).success).toBe(false);
    expect(ownerBusinessSchema.safeParse({ ...VALID, businessPhone: "919344040013" }).success).toBe(true);
  });
});

describe("vendor id", () => {
  it("strips the UUID hyphens Cashfree rejects, keeping all 32 hex chars", () => {
    const uuid = "ef52cf9c-717e-4a1b-9c3d-0123456789ab";
    const v = toVendorId(uuid);
    expect(v).toBe("ef52cf9c717e4a1b9c3d0123456789ab");
    expect(v).toMatch(/^[a-zA-Z0-9]+$/);
    expect(v).toHaveLength(32);
  });

  it("is idempotent, so re-normalising a stored id cannot corrupt it", () => {
    // payOwnerOnAcceptance passes the id straight from the database, which is
    // already normalised. Applying it twice must be a no-op.
    const once = toVendorId("ef52cf9c-717e-4a1b-9c3d-0123456789ab");
    expect(toVendorId(once)).toBe(once);
  });

  it("keeps distinct owners distinct", () => {
    expect(toVendorId("aaaaaaaa-0000-0000-0000-000000000001"))
      .not.toBe(toVendorId("aaaaaaaa-0000-0000-0000-000000000002"));
  });
});

describe("the master switch gates onboarding too", () => {
  const prev = process.env.CASHFREE_EASY_SPLIT_ENABLED;
  it("defaults to off, so onboarding cannot start by accident", () => {
    delete process.env.CASHFREE_EASY_SPLIT_ENABLED;
    expect(isEasySplitEnabled()).toBe(false);
    process.env.CASHFREE_EASY_SPLIT_ENABLED = "TRUE";
    expect(isEasySplitEnabled()).toBe(true);   // case-insensitive
    process.env.CASHFREE_EASY_SPLIT_ENABLED = "yes";
    expect(isEasySplitEnabled()).toBe(false);  // only "true" counts
    if (prev === undefined) delete process.env.CASHFREE_EASY_SPLIT_ENABLED;
    else process.env.CASHFREE_EASY_SPLIT_ENABLED = prev;
  });
});
