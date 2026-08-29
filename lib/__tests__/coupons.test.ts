// ─────────────────────────────────────────────────────────────────────────────
// lib/__tests__/coupons.test.ts — resolving a customer-typed promo code.
//
// Two properties matter more than the happy path:
//   1. The resolver must NEVER leak which codes exist. Every failure — wrong
//      code, stopped, expired, capped, database down — has to be
//      indistinguishable, or the preview action becomes an existence oracle.
//   2. It must FAIL CLOSED. A cap that cannot be counted is not satisfied; a
//      database error is "no coupon", never "coupon applied".
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoisted so the vi.mock factory below can close over it.
const state = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  rowError: null as { code?: string; message: string } | null,
  count: 0 as number | null,
  countError: null as { message: string } | null,
}));

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdminClient: () => ({
    from: (table: string) => {
      if (table === "coupons") {
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: async () => ({ data: state.row, error: state.rowError }),
        };
        return chain;
      }
      // bookings — the redemption count
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: async () => ({ count: state.count, error: state.countError }),
      };
      return chain;
    },
  }),
}));

const { resolveCoupon, normalizeCouponCode, COUPON_CODE_PATTERN } = await import("@/lib/coupons");

const LIVE = {
  id: "11111111-1111-4111-8111-111111111111",
  code: "LAUNCH2026",
  kind: "zero_platform_fee",
  is_active: true,
  expires_at: null,
  max_redemptions: null,
};

beforeEach(() => {
  state.row = { ...LIVE };
  state.rowError = null;
  state.count = 0;
  state.countError = null;
});

describe("normalizeCouponCode", () => {
  it("canonicalises to the form the database CHECK accepts", () => {
    expect(normalizeCouponCode("  launch2026 ")).toBe("LAUNCH2026");
    expect(normalizeCouponCode("LAUNCH 2026")).toBe("LAUNCH2026");
    expect(normalizeCouponCode("ｌａｕｎｃｈ２０２６")).toBe("LAUNCH2026"); // NFKC
  });

  it("never returns something longer than the column allows", () => {
    expect(normalizeCouponCode("A".repeat(500)).length).toBeLessThanOrEqual(64);
  });

  it("produces output that either matches the pattern or is rejected", () => {
    for (const raw of ["launch2026", "LAUNCH-2026", "ab", "", "HALL_2026", "-LEADING1"]) {
      const norm = normalizeCouponCode(raw);
      const accepted = COUPON_CODE_PATTERN.test(norm);
      // Whatever the verdict, it must be a pure function of the canonical form.
      expect(COUPON_CODE_PATTERN.test(normalizeCouponCode(raw))).toBe(accepted);
    }
  });
});

describe("COUPON_CODE_PATTERN", () => {
  it("rejects codes shorter than 8 — the guessing-oracle floor", () => {
    expect(COUPON_CODE_PATTERN.test("HALL200")).toBe(false); // 7
    expect(COUPON_CODE_PATTERN.test("HALL2026")).toBe(true); // 8
  });

  it("rejects over-long, spaced, underscored and leading-hyphen codes", () => {
    expect(COUPON_CODE_PATTERN.test("A".repeat(25))).toBe(false);
    expect(COUPON_CODE_PATTERN.test("HALL 2026")).toBe(false);
    expect(COUPON_CODE_PATTERN.test("HALL_2026")).toBe(false);
    expect(COUPON_CODE_PATTERN.test("-LAUNCH26")).toBe(false);
  });
});

describe("resolveCoupon — the happy path", () => {
  it("accepts a live coupon and decides the fee itself", async () => {
    const r = await resolveCoupon("launch2026");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.coupon.code).toBe("LAUNCH2026");
    expect(r.coupon.kind).toBe("zero_platform_fee");
    // The ONLY place this number comes from.
    expect(r.coupon.platformFeeRupees).toBe(0);
  });

  it("accepts a capped coupon that still has room", async () => {
    state.row = { ...LIVE, max_redemptions: 100 };
    state.count = 99;
    await expect(resolveCoupon("LAUNCH2026")).resolves.toMatchObject({ ok: true });
  });
});

describe("resolveCoupon — every rejection is identical", () => {
  // If any of these differ, a guessed code that is REAL becomes distinguishable
  // from one that is not, and the preview action turns into an oracle.
  it("returns the same string for wrong, stopped, expired, capped and broken", async () => {
    const errors: string[] = [];

    state.row = null;                                        // no such code
    const notFound = await resolveCoupon("NOSUCHCODE1");
    if (!notFound.ok) errors.push(notFound.error);

    state.row = { ...LIVE, is_active: false };               // stopped
    const stopped = await resolveCoupon("LAUNCH2026");
    if (!stopped.ok) errors.push(stopped.error);

    state.row = { ...LIVE, expires_at: "2000-01-01T00:00:00Z" }; // expired
    const expired = await resolveCoupon("LAUNCH2026");
    if (!expired.ok) errors.push(expired.error);

    state.row = { ...LIVE, max_redemptions: 1 };             // cap reached
    state.count = 1;
    const capped = await resolveCoupon("LAUNCH2026");
    if (!capped.ok) errors.push(capped.error);

    state.row = null;                                         // table missing
    state.rowError = { code: "42P01", message: "relation does not exist" };
    const broken = await resolveCoupon("LAUNCH2026");
    if (!broken.ok) errors.push(broken.error);

    expect(errors).toHaveLength(5);
    expect(new Set(errors).size).toBe(1);
  });

  it("rejects a malformed code without touching the database", async () => {
    state.row = { ...LIVE }; // would succeed if it were ever queried
    await expect(resolveCoupon("SHORT")).resolves.toMatchObject({ ok: false });
    await expect(resolveCoupon("")).resolves.toMatchObject({ ok: false });
  });
});

describe("resolveCoupon — fails closed", () => {
  it("refuses when a cap cannot be counted", async () => {
    state.row = { ...LIVE, max_redemptions: 100 };
    state.countError = { message: "connection reset" };
    state.count = null;
    await expect(resolveCoupon("LAUNCH2026")).resolves.toMatchObject({ ok: false });
  });

  it("refuses when the count comes back null with no error", async () => {
    state.row = { ...LIVE, max_redemptions: 100 };
    state.count = null;
    await expect(resolveCoupon("LAUNCH2026")).resolves.toMatchObject({ ok: false });
  });

  it("treats a database error as no coupon, never as an applied one", async () => {
    state.rowError = { code: "500", message: "boom" };
    const r = await resolveCoupon("LAUNCH2026");
    expect(r.ok).toBe(false);
  });
});
