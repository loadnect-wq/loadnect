// ─────────────────────────────────────────────────────────────────────────────
// lib/__tests__/coupon-schema.test.ts — the admin create-coupon form contract.
//
// THE BUG THIS EXISTS FOR: a Next.js server action DROPS `undefined` properties
// when it serialises its argument across the RSC boundary. The admin form sends
// `maxRedemptions: value || undefined`, so a blank field arrives at the server
// as a MISSING KEY — not as a key holding undefined.
//
// Zod 4 treats a `.transform()` pipe as a REQUIRED object key unless the pipe
// itself is `.optional()`, so every blank optional failed with "expected
// nonoptional, received undefined" in production while the unit tests passed —
// because an in-process call keeps the key.
//
// Every optional field is therefore asserted in BOTH shapes: key missing, and
// key present-but-undefined.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { couponCreateSchema,
  couponLimitsSchema,
} from "@/lib/validation/schemas";

const CODE = "LAUNCH2026";

describe("couponCreateSchema — the shape a server action actually receives", () => {
  it("accepts a code alone, with every optional key ABSENT", () => {
    const r = couponCreateSchema.safeParse({ code: CODE });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.code).toBe(CODE);
    expect(r.data.maxRedemptions).toBeUndefined();
    expect(r.data.expiresAt).toBeUndefined();
  });

  it("accepts the same payload with optional keys present but undefined", () => {
    const r = couponCreateSchema.safeParse({
      code: CODE, description: undefined, maxRedemptions: undefined, expiresAt: undefined,
    });
    expect(r.success).toBe(true);
  });

  it("accepts empty strings, which is what an untouched input actually sends", () => {
    const r = couponCreateSchema.safeParse({
      code: CODE, description: "", maxRedemptions: "", expiresAt: "",
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.maxRedemptions).toBeUndefined();
    expect(r.data.expiresAt).toBeUndefined();
  });
});

describe("couponCreateSchema — canonicalisation and validation", () => {
  it("upper-cases and strips whitespace from the code", () => {
    const r = couponCreateSchema.safeParse({ code: "  launch 2026 " });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.code).toBe("LAUNCH2026");
  });

  it("rejects a code under the 8-character floor", () => {
    expect(couponCreateSchema.safeParse({ code: "HALL200" }).success).toBe(false);
  });

  it("parses a supplied cap and rejects a nonsense one", () => {
    const ok = couponCreateSchema.safeParse({ code: CODE, maxRedemptions: "100" });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.maxRedemptions).toBe(100);

    for (const bad of ["0", "-5", "abc"]) {
      expect(couponCreateSchema.safeParse({ code: CODE, maxRedemptions: bad }).success).toBe(false);
    }
  });

  it("accepts an ISO date and rejects anything else", () => {
    expect(couponCreateSchema.safeParse({ code: CODE, expiresAt: "2026-12-31" }).success).toBe(true);
    expect(couponCreateSchema.safeParse({ code: CODE, expiresAt: "31/12/2026" }).success).toBe(false);
  });
});

// ── Editing the limits of a coupon that already exists ──────────────────────
//
// couponLimitsSchema is picked from couponCreateSchema so the two can never
// disagree; these assert that the pick actually preserves the behaviour that
// matters, rather than trusting the derivation.
describe("couponLimitsSchema", () => {
  it("accepts a cap and an expiry", () => {
    const r = couponLimitsSchema.safeParse({ maxRedemptions: "50", expiresAt: "2026-10-09" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.maxRedemptions).toBe(50);
      expect(r.data.expiresAt).toBe("2026-10-09");
    }
  });

  it("treats whitespace as blank, not as a bad value", () => {
    const r = couponLimitsSchema.safeParse({ maxRedemptions: "   " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.maxRedemptions).toBeUndefined();
  });

  it("treats blank as no limit, the same as the create form does", () => {
    const r = couponLimitsSchema.safeParse({ maxRedemptions: "", expiresAt: "" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.maxRedemptions).toBeUndefined();
      expect(r.data.expiresAt).toBeUndefined();
    }
  });

  it("accepts MISSING keys — a server action drops undefined in transit", () => {
    // The trailing .optional() on both pipes is what makes this pass. Without
    // it Zod 4 reports "expected nonoptional, received undefined" and the admin
    // form fails on every blank field.
    expect(couponLimitsSchema.safeParse({}).success).toBe(true);
  });

  // "2.5" and "50%" are the interesting ones: a bare parseInt turns them into
  // 2 and 50 — a DIFFERENT, valid-looking cap rather than an error. An admin who
  // typed 2.5 used to get a coupon that died after two redemptions.
  it("rejects a cap that is not a positive whole number", () => {
    for (const bad of ["0", "-5", "2.5", "abc", "50%", "1e3", "0x10"]) {
      expect(couponLimitsSchema.safeParse({ maxRedemptions: bad }).success).toBe(false);
    }
  });

  it("rejects a malformed expiry", () => {
    for (const bad of ["09-10-2026", "2026/10/09", "tomorrow", "2026-10"]) {
      expect(couponLimitsSchema.safeParse({ expiresAt: bad }).success).toBe(false);
    }
  });

  it("agrees with couponCreateSchema on the same values", () => {
    // If these two ever diverge, a cap acceptable on the create form becomes an
    // error on the edit form for the identical input.
    for (const v of [{ maxRedemptions: "50" }, { maxRedemptions: "" }, { expiresAt: "2026-10-09" }]) {
      const asCreate = couponCreateSchema.safeParse({ code: "LAUNCH2026", description: "", ...v });
      const asLimits = couponLimitsSchema.safeParse(v);
      expect(asLimits.success).toBe(asCreate.success);
    }
  });
});
