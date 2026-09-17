import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { TIER_LABEL, planDisplayName } from "@/lib/plan-names";
import { PLAN_FEATURES } from "@/lib/premium-plans";

// ─────────────────────────────────────────────────────────────────────────────
// The listing plans are called Free, Pro and Elite (migration 0098).
//
// The slugs are internal and unchanged — "premium" is the ₹4,999 plan named
// Pro, "pro" is the ₹9,999 plan named Elite — because they are stored on live
// listings, hall tiers and Cashfree subscription plan ids. These tests pin the
// mapping, and that no surface prints a slug-derived or old name instead.
// Verified live after 0098: premium_plans reads Free ₹0 / Pro ₹4,999 / Elite
// ₹9,999, prices unchanged.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const code = (rel: string) =>
  read(rel).replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("plan names", () => {
  it("are Free, Pro and Elite, mapped from the unchanged slugs", () => {
    expect(TIER_LABEL).toEqual({ free: "Free", premium: "Pro", pro: "Elite" });
  });

  it("resolve any slug safely", () => {
    expect(planDisplayName("premium")).toBe("Pro");
    expect(planDisplayName("pro")).toBe("Elite");
    expect(planDisplayName("free")).toBe("Free");
    expect(planDisplayName(null)).toBe("Free");
    expect(planDisplayName("elite")).toBe("Free"); // not a slug — never guessed
  });

  it("the Elite feature list refers to Pro, not the old name", () => {
    expect(PLAN_FEATURES.pro[0].label).toBe("Everything in Pro");
    expect(JSON.stringify(PLAN_FEATURES)).not.toContain("Premium");
  });

  it("the offline fallback catalogue uses the same names and the same prices", () => {
    const src = read("lib/premium-plans.ts");
    expect(src).toContain('{ slug: "premium", name: "Pro",');
    expect(src).toContain('{ slug: "pro",     name: "Elite",');
    expect(src).toContain("monthly_price: 4999");
    expect(src).toContain("monthly_price: 9999");
  });
});

describe("no surface still shows a tier by its old name", () => {
  const files = [
    "app/halls/_components/HallCard.tsx",
    "app/halls/[slug]/_components/HallDetailView.tsx",
    "app/admin/premium-listings/page.tsx",
    "app/admin/premium-listings/_components/CreateListingForm.tsx",
    "app/admin/premium-listings/_components/GrantComplimentaryForm.tsx",
    "app/owner/(dashboard)/premium/page.tsx",
    "app/owner/(dashboard)/premium/upgrade/page.tsx",
    "app/admin/actions.ts",
    "lib/plan-subscriptions.ts",
  ];
  for (const f of files) {
    it(f, () => {
      const src = code(f);
      expect(src).not.toMatch(/"★ Pro"|"✦ Premium"|>★ Pro<|>✦ Premium</);
      expect(src).not.toMatch(/=== "pro" \? "Pro" : "Premium"/);
      expect(src).not.toMatch(/Premium (and|or) Pro|Pro or Premium/);
    });
  }

  it("owner subscription messages use the display name, not the capitalised slug", () => {
    const src = code("lib/plan-subscriptions.ts");
    expect(src).toContain("return planDisplayName(slug);");
    expect(src).not.toContain("slug.charAt(0).toUpperCase()");
  });

  it("the Terms and Refund policy name the plans Pro and Elite at the same prices", () => {
    const terms = code("app/(legal)/terms/page.tsx");
    expect(terms).toContain("Venue Owner Subscriptions (Pro and Elite)");
    expect(terms).toMatch(/4,999 per month<\/strong> for Pro/);
    expect(terms).toMatch(/9,999 per month<\/strong> for Elite/);
    expect(code("app/(legal)/refund-policy/page.tsx")).toContain("Pro and Elite listing plans");
  });

  it("the migration only renames — no price, slug or Cashfree id changes", () => {
    const sql = read("supabase/migrations/0098_plan_names_free_pro_elite.sql")
      .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    // Only what sits between SET and WHERE is written.
    const setClauses = [...sql.matchAll(/\bupdate\s+public\.premium_plans\s+set\b([\s\S]*?)\bwhere\b/gi)].map((m) => m[1]);
    expect(setClauses.length).toBe(3);
    for (const clause of setClauses) {
      expect(clause).not.toMatch(/monthly_price|\bslug\b|cf_plan_id|duration_days|is_purchasable/i);
    }
  });
});
