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
import { couponCreateSchema } from "@/lib/validation/schemas";

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
