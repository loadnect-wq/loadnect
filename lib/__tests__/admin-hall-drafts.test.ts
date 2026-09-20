import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { adminHallDraftSchema, cancelHallDraftSchema, claimHallDraftSchema } from "@/lib/validation/schemas";

// ─────────────────────────────────────────────────────────────────────────────
// The admin-onboarding pathway (migration 0090).
//
// Two kinds of assertion here, deliberately:
//
//   1. SCHEMA BEHAVIOUR, exercised for real. The validation layer is what an
//      admin actually hits, and it is where a mistyped phone number becomes a
//      listing nobody can ever claim.
//   2. SOURCE-LEVEL INVARIANTS about the security design, in the same style as
//      seo-invariants.test.ts. These cannot prove the database refuses a bad
//      claim — only the database can, and it was probed directly — but they
//      DO fail the build if someone later moves the claim out of the SQL
//      function into TypeScript, or drops a guard.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const VALID = {
  name: "NS Kalyana Mandapam",
  city: "Madurai",
  capacityMax: 500,
  bookingMode: "LEAD_GENERATION" as const,
  ownerName: "A Venue Owner",
  ownerPhone: "9344040013",
  venueTypes: ["wedding"],
};

describe("adminHallDraftSchema", () => {
  it("accepts a minimal enquiry-mode listing", () => {
    const r = adminHallDraftSchema.safeParse(VALID);
    expect(r.success, r.success ? "" : JSON.stringify(r.error.issues)).toBe(true);
  });

  it("normalises a bare 10-digit mobile to E.164", () => {
    // THE CRUX OF THE WHOLE FEATURE. The claim matches profiles.phone with
    // plain equality, and profiles stores E.164. A draft saved as "9344040013"
    // would never match, and the owner would never see their hall — with
    // nothing anywhere reporting a fault.
    const r = adminHallDraftSchema.parse(VALID);
    expect(r.ownerPhone).toBe("+919344040013");
  });

  it.each([
    ["+91 93440 40013", "+919344040013"],
    ["09344040013",     "+919344040013"],
    ["919344040013",    "+919344040013"],
  ])("normalises %s", (input, expected) => {
    expect(adminHallDraftSchema.parse({ ...VALID, ownerPhone: input }).ownerPhone).toBe(expected);
  });

  it("rejects a phone number it cannot confidently normalise", () => {
    // Guessing is worse than refusing: a wrong guess is a listing that can
    // never be claimed by anyone.
    for (const bad of ["12345", "not a phone", "", "+1"]) {
      expect(adminHallDraftSchema.safeParse({ ...VALID, ownerPhone: bad }).success).toBe(false);
    }
  });

  it("refuses direct booking without a day rate", () => {
    // Mirrors halls_direct_booking_needs_price. Without this the CHECK fires
    // later, on the halls INSERT inside the claim — i.e. the OWNER gets a
    // database error for the ADMIN's omission, weeks after the fact.
    const r = adminHallDraftSchema.safeParse({ ...VALID, bookingMode: "DIRECT_BOOKING" });
    expect(r.success).toBe(false);
  });

  it("accepts direct booking when a day rate is present", () => {
    const r = adminHallDraftSchema.safeParse({ ...VALID, bookingMode: "DIRECT_BOOKING", pricePerDay: 50000 });
    expect(r.success).toBe(true);
  });

  it("refuses a minimum capacity above the maximum", () => {
    expect(adminHallDraftSchema.safeParse({ ...VALID, capacityMin: 900, capacityMax: 500 }).success).toBe(false);
  });

  // ── The vocabulary moved to the database in 0102 ──────────────────────────
  //
  // This used to be `venueTypes: ["nightclub"]` -> false, because the schema
  // held a four-value z.enum. An admin can now ADD a category from a form, so
  // a closed enum here would make the feature impossible — and this module is
  // imported by the browser, which cannot read the catalogue.
  //
  // Membership is therefore enforced by assert_venue_categories() behind a
  // BEFORE trigger on admin_hall_drafts (migration 0102), which no client can
  // bypass. What is left to assert at THIS layer is the shape guard and the
  // deduplication, which is what these two do. "nightclub" is now a
  // well-formed slug that the DATABASE rejects, not the schema.
  it("accepts a well-formed slug and leaves membership to the database", () => {
    expect(adminHallDraftSchema.safeParse({ ...VALID, venueTypes: ["birthday-party"] }).success).toBe(true);
  });

  it("refuses a value that is not slug-shaped at all", () => {
    for (const bad of ["Wedding", "wedding hall", "wedding_hall", "-wedding", "w", "a".repeat(49)]) {
      expect(adminHallDraftSchema.safeParse({ ...VALID, venueTypes: [bad] }).success).toBe(false);
    }
  });

  it("deduplicates, because assert_venue_categories raises on a repeat", () => {
    const r = adminHallDraftSchema.safeParse({ ...VALID, venueTypes: ["wedding", "wedding", "party"] });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.venueTypes).toEqual(["wedding", "party"]);
  });

  it("requires a reason to withdraw a draft", () => {
    const id = "00000000-0000-0000-0000-000000000000";
    expect(cancelHallDraftSchema.safeParse({ draftId: id, reason: "" }).success).toBe(false);
    expect(cancelHallDraftSchema.safeParse({ draftId: id, reason: "Duplicate" }).success).toBe(true);
  });

  it("takes nothing from the claimant but the draft id", () => {
    // No phone, no email, no owner id. Anything else would be a value an
    // attacker could vary; the identity is re-derived server-side from the
    // session.
    expect(Object.keys(claimHallDraftSchema.shape)).toEqual(["draftId"]);
  });
});

describe("the claim stays in the database", () => {
  const migration = read("supabase/migrations/0090_admin_hall_drafts.sql");
  const action    = read("app/owner/(dashboard)/actions.ts");

  it("the owner action only calls the RPC — it does not reimplement the checks", () => {
    // If the identity check ever moves into TypeScript there is a window
    // between checking and writing, and "two owners claimed the same venue" is
    // precisely what the brief rules out. The function is the only writer.
    const claim = action.slice(action.indexOf("export async function claimHallDraft"));
    expect(claim).toContain('rpc("claim_admin_hall_draft"');
    expect(claim).not.toMatch(/from\(["']admin_hall_drafts["']\)[\s\S]{0,200}\.update\(/);
    expect(claim).not.toMatch(/from\(["']halls["']\)[\s\S]{0,200}\.insert\(/);
  });

  it("the function demands a verified phone that matches", () => {
    expect(migration).toContain("phone_verified is not true");
    expect(migration).toContain("v_profile.phone <> v_draft.owner_phone");
  });

  it("the function locks the draft and re-checks the status when flipping it", () => {
    // FOR UPDATE serialises two simultaneous claims; the guarded UPDATE is the
    // second line of defence, in the same transaction as the halls INSERT.
    expect(migration).toContain("for update");
    expect(migration).toMatch(/where id = _draft_id\s*\n?\s*and claim_status = 'unclaimed'/);
  });

  it("a claimed hall starts at draft, not in the approval queue", () => {
    // The owner has not seen the listing yet. Sending an admin's notes straight
    // to a reviewer asks them to approve something nobody has confirmed.
    expect(migration).toMatch(/venue_types, booking_mode, status\s*\n?\s*\)\s*values[\s\S]*'draft'/);
  });

  it("anon can neither read the table nor run the claim", () => {
    expect(migration).toContain("revoke all on public.admin_hall_drafts from anon");
    expect(migration).toContain("revoke all on function public.claim_admin_hall_draft(uuid) from public, anon");
  });

  it("the migration asserts it did not touch halls", () => {
    // halls.owner_id going nullable would change the meaning of every existing
    // query. The migration fails loudly rather than allowing that drift.
    expect(migration).toContain("halls.owner_id nullability changed");
  });
});

describe("admin write paths are gated and audited", () => {
  const adminActions = read("app/admin/actions.ts");

  it.each(["createAdminHallDraft", "cancelAdminHallDraft", "checkHallDraftDuplicates"])(
    "%s starts with the admin gate",
    (name) => {
      const fn = adminActions.slice(adminActions.indexOf(`export async function ${name}`));
      expect(fn.slice(0, 400)).toContain("requireAdminActor()");
    },
  );

  it("creating and withdrawing a draft are both recorded", () => {
    expect(adminActions).toContain('action:     "hall_draft.create"');
    expect(adminActions).toContain('action:         "hall_draft.cancel"');
  });

  it("withdrawing only applies to an unclaimed draft", () => {
    // Cancelling a claimed draft would say the listing was withdrawn while the
    // hall it produced carries on existing.
    const fn = adminActions.slice(adminActions.indexOf("export async function cancelAdminHallDraft"));
    expect(fn).toContain('.eq("claim_status", "unclaimed")');
  });

  it("the duplicate check warns and never blocks", () => {
    // Two venues can share a name in different cities, and an owner may
    // legitimately list a second hall. A blocker makes the honest case
    // impossible to record.
    const fn = adminActions.slice(adminActions.indexOf("export async function checkHallDraftDuplicates"));
    expect(fn).toContain("matches");
    expect(fn).not.toContain("return { error: \"Duplicate");
  });
});

describe("an admin-recorded venue claims into a usable listing", () => {
  const form = read("app/admin/hall-drafts/_components/AddHallDraftForm.tsx");
  const reader = read("lib/admin-hall-drafts.ts");

  it("the form collects amenities instead of hard-coding none", () => {
    // It sent `amenitySlugs: []` unconditionally, so EVERY venue an admin
    // recorded claimed into a hall with no amenities — invisible in every
    // filtered search and publishing no amenityFeature, from the day the owner
    // claimed it. The schema, the table and claim_admin_hall_draft() had
    // supported them since 0090.
    expect(form).not.toContain("amenitySlugs: []");
    expect(form).toContain("amenitySlugs,");
    expect(form).toContain("setAmenitySlugs");
  });

  it("the form collects the slot prices the claim function already copies", () => {
    expect(form).not.toContain("priceMorning: undefined");
    expect(form).not.toContain("priceEvening: undefined");
    expect(form).toContain('set("priceMorning")');
    expect(form).toContain('set("priceEvening")');
  });

  it("photos stay empty, and the reason is written down", () => {
    // photo_urls is an unconstrained text[], but the claim function copies each
    // entry into hall_images where CHECK hall_images_url_is_our_storage (0083)
    // demands our own bucket. A pasted URL would save here and fail weeks later
    // ON THE OWNER. This must stay empty until there is a real uploader.
    expect(form).toContain("photoUrls: []");
    expect(form).toContain("hall_images_url_is_our_storage");
  });

  it("the admin list reads back the slot prices it now stores", () => {
    // The SELECT omitted both, so a draft written with them was invisible.
    expect(reader).toContain("price_morning");
    expect(reader).toContain("price_evening");
    expect(reader).toContain("priceMorning:");
  });
});
