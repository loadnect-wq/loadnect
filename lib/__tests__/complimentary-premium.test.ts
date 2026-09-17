import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { premiumListingSchema, revokePremiumOfferSchema } from "@/lib/validation/schemas";

// ─────────────────────────────────────────────────────────────────────────────
// Complimentary premium offers (migration 0091).
//
// The rules with money on the other side of them get tested twice — once in the
// schema here, once by a CHECK constraint in the database — because "do not
// fake a transaction" and "do not add fake revenue" are the two instructions
// this feature could violate silently.
//
// The entitlement itself is deliberately NOT retested: recompute_hall_premium()
// already decides the tier from an active in-window listing and its plan_slug,
// and a complimentary row is just such a listing. That was probed directly
// against the database (paid Premium + complimentary Pro resolved to pro, and
// fell back to premium when the complimentary row was retired).
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const BASE = {
  hallId:    "11111111-1111-4111-8111-111111111111",
  planSlug:  "pro" as const,
  startDate: "2026-09-14",
  endDate:   "2026-10-14",
};

describe("premiumListingSchema", () => {
  it("still accepts an ordinary paid listing with no grant fields", () => {
    // BACKWARD COMPATIBILITY. The Cashfree webhook calls this path and knows
    // nothing about grant_type; it must keep working untouched.
    const r = premiumListingSchema.safeParse({ ...BASE, amount: 9999 });
    expect(r.success).toBe(true);
    expect(r.success && r.data.grantType).toBe("paid");
  });

  it("accepts a complimentary offer at zero", () => {
    const r = premiumListingSchema.safeParse({ ...BASE, amount: 0, grantType: "complimentary" });
    expect(r.success).toBe(true);
  });

  it("REFUSES a complimentary offer carrying an amount", () => {
    // A free grant with a price on it is a fake transaction. Refused here and
    // by premium_listings_complimentary_is_free in the database.
    const r = premiumListingSchema.safeParse({ ...BASE, amount: 4999, grantType: "complimentary" });
    expect(r.success).toBe(false);
  });

  it("refuses an end date before the start date", () => {
    const r = premiumListingSchema.safeParse({
      ...BASE, startDate: "2026-10-14", endDate: "2026-09-14", amount: 0, grantType: "complimentary",
    });
    expect(r.success).toBe(false);
  });

  it("requires a reason to withdraw an offer", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(revokePremiumOfferSchema.safeParse({ listingId: id, reason: "" }).success).toBe(false);
    expect(revokePremiumOfferSchema.safeParse({ listingId: id, reason: "Promo ended" }).success).toBe(true);
  });
});

describe("a complimentary offer can never look like a payment", () => {
  const migration = read("supabase/migrations/0091_complimentary_premium_offers.sql");
  const actions   = read("app/admin/actions.ts");

  it("the database refuses a payment id, purchase id or non-zero amount on one", () => {
    expect(migration).toContain("premium_listings_complimentary_is_free");
    expect(migration).toContain("payment_id is null and plan_purchase_id is null and amount = 0");
  });

  it("every free grant has a named admin behind it", () => {
    expect(migration).toContain("granted_by is not null");
  });

  it("existing listings stay paid, and the default keeps the webhook unchanged", () => {
    expect(migration).toContain("grant_type   text not null default 'paid'");
    expect(migration).toContain("existing listings were not left as paid");
  });

  it("the action never writes a payment reference for a complimentary grant", () => {
    const fn = actions.slice(actions.indexOf("export async function createPremiumListing"));
    const body = fn.slice(0, fn.indexOf("export async function", 10));
    expect(body).toContain("granted_by:   complimentary ? actor.user.id : null");
    // The insert must not set either payment link at all.
    expect(body).not.toMatch(/payment_id:\s/);
    expect(body).not.toMatch(/plan_purchase_id:\s/);
  });

  it("the amount is forced to zero rather than trusted from the caller", () => {
    const fn = actions.slice(actions.indexOf("export async function createPremiumListing"));
    expect(fn.slice(0, 3000)).toContain("complimentary ? 0 :");
  });
});

describe("entitlements are not duplicated", () => {
  const migration = read("supabase/migrations/0091_complimentary_premium_offers.sql");

  it("the migration pins recompute_hall_premium against accidental change", () => {
    // That function is what grants the features, for PAID listings too. A
    // change to it while adding a free tier would be a change to every paying
    // customer's entitlement.
    expect(migration).toContain("recompute_hall_premium changed unexpectedly");
  });

  it("no second entitlement path was introduced", () => {
    // If a complimentary-specific tier check ever appears, the two paths will
    // drift and a free Pro will stop matching a paid Pro.
    const halls = read("lib/halls.ts");
    expect(halls).not.toContain("grant_type");
  });
});

describe("admin-only, and audited", () => {
  const actions = read("app/admin/actions.ts");

  it.each(["createPremiumListing", "checkPremiumOverlap", "togglePremiumActive"])(
    "%s starts with the admin gate",
    (name) => {
      const fn = actions.slice(actions.indexOf(`export async function ${name}`));
      expect(fn.slice(0, 2000)).toContain("requireAdminActor()");
    },
  );

  it("granting and revoking a free plan are audited distinctly from paid ones", () => {
    // "premium.grant" on a free giveaway would be indistinguishable from a
    // ₹9,999 sale in the trail.
    expect(actions).toContain('"premium.grant_complimentary"');
    expect(actions).toContain('"premium.revoke_complimentary"');
  });

  it("revoking records who did it and when", () => {
    const fn = actions.slice(actions.indexOf("export async function togglePremiumActive"));
    expect(fn.slice(0, 2000)).toContain("revoked_at");
    expect(fn.slice(0, 2000)).toContain("revoked_by");
  });

  it("the overlap check surfaces a failure instead of reporting no conflicts", () => {
    // Returning [] on error is how an existing offer gets silently overwritten.
    const fn = actions.slice(actions.indexOf("export async function checkPremiumOverlap"));
    expect(fn.slice(0, 2000)).toContain("sanitizeError");
  });
});

describe("the owner is told the truth about what they have", () => {
  const page = read("app/owner/(dashboard)/premium/page.tsx");

  it("shows a complimentary badge", () => {
    expect(page).toContain('grant_type === "complimentary"');
  });

  it("never offers to cancel a subscription that does not exist", () => {
    // A complimentary grant has no Cashfree subscription. Showing "Renews
    // automatically — ₹9,999/month" would be a false charge notice.
    const idx = page.indexOf('activeListing.grant_type === "complimentary" ? (');
    expect(idx).toBeGreaterThan(-1);
    expect(page).toContain("nothing to pay and nothing to cancel");
  });
});

describe("complimentary offers are not revenue", () => {
  const adminPage = read("app/admin/premium-listings/page.tsx");

  it("the revenue total excludes them explicitly", () => {
    expect(adminPage).toContain("paidListings");
    expect(adminPage).toContain('l.grant_type !== "complimentary"');
  });

  it("they are counted, but on their own", () => {
    expect(adminPage).toContain("compActive");
    expect(adminPage).toContain("Complimentary");
  });
});

describe("an admin's grant reaches the hall's tier (0096)", () => {
  // "Grant Premium" failed for a real admin with "You don't have permission to
  // do this." — Postgres 42501, permission denied for function
  // recompute_hall_premium. The premium_listings sync trigger ran as the
  // admin's session role, which 0034 had (correctly) barred from calling that
  // function. The fix makes the TRIGGER run as its owner; it must not do it by
  // handing EXECUTE back to API roles, and it must not touch who may write.
  const sql = read("supabase/migrations/0096_premium_sync_trigger_runs_as_owner.sql");
  const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

  it("makes the sync trigger function SECURITY DEFINER", () => {
    expect(code).toContain("alter function public.trg_recompute_hall_premium() security definer;");
  });

  it("keeps recompute_hall_premium out of reach of the API roles", () => {
    expect(code).toContain("revoke execute on function public.recompute_hall_premium(uuid) from public, anon, authenticated;");
    expect(code).not.toMatch(/grant\s+execute[^;]*recompute_hall_premium[^;]*(authenticated|anon|public)/i);
  });

  it("does not loosen who may write premium_listings", () => {
    expect(code).not.toMatch(/create\s+policy|drop\s+policy|disable\s+row\s+level\s+security/i);
    expect(code).toContain("qual = 'is_admin()' and with_check = 'is_admin()'");
    expect(code).toContain("trg_guard_premium_listing_writes");
  });

  it("the grant action still starts at the server-side admin gate and records the admin from the session", () => {
    const actions = read("app/admin/actions.ts");
    const fn = actions.slice(actions.indexOf("export async function createPremiumListing"));
    const body = fn.slice(0, fn.indexOf("\nexport async function", 10));
    expect(body.indexOf("requireAdminActor()")).toBeGreaterThan(0);
    expect(body.indexOf("requireAdminActor()")).toBeLessThan(body.indexOf("parseSafe("));
    expect(body).toContain("granted_by:   complimentary ? actor.user.id : null");
  });
});
