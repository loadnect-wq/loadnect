// ─────────────────────────────────────────────────────────────────────────────
// lib/admin-hall-drafts.ts — reads for the admin-onboarding pathway.
//
// An admin records a venue before its owner has an account; the owner later
// claims it and it becomes an ordinary hall. See migration 0090 for why this is
// a separate table rather than columns on halls (halls.owner_id is NOT NULL and
// resolves through hall_owners, so an unclaimed listing has nowhere to hang).
//
// SERVER ONLY. Every function here reads through the session client, so RLS is
// the authorisation boundary rather than anything in this file:
//   • an admin sees every draft            (admin_hall_drafts_admin_all)
//   • a prospective owner sees only the unclaimed draft matching their VERIFIED
//     phone                                (admin_hall_drafts_claimant_read)
//   • everyone else sees nothing, and anon has no grant at all.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { normalizePhoneE164 } from "@/lib/notifications/phone";

export type DraftClaimStatus = "unclaimed" | "claimed" | "cancelled";

export type AdminHallDraft = {
  id:              string;
  name:            string;
  description:     string | null;
  city:            string;
  state:           string | null;
  address:         string | null;
  pincode:         string | null;
  capacityMin:     number | null;
  capacityMax:     number;
  pricePerDay:     number | null;
  /** Read back so a draft written WITH slot prices is visible in the admin list;
   *  the SELECT omitted both, so they were invisible even once stored. */
  priceMorning:    number | null;
  priceEvening:    number | null;
  bookingMode:     string;
  venueTypes:      string[];
  amenitySlugs:    string[];
  customAmenities: string[];
  photoUrls:       string[];
  ownerName:       string;
  ownerPhone:      string;
  ownerEmail:      string | null;
  claimStatus:     DraftClaimStatus;
  claimedHallId:   string | null;
  claimedAt:       string | null;
  adminNotes:      string | null;
  createdAt:       string;
};

const SELECT = `
  id, name, description, city, state, address, pincode,
  capacity_min, capacity_max, price_per_day, price_morning, price_evening,
  booking_mode, venue_types,
  amenity_slugs, custom_amenities, photo_urls,
  owner_name, owner_phone, owner_email,
  claim_status, claimed_hall_id, claimed_at, admin_notes, created_at
`;

/* eslint-disable @typescript-eslint/no-explicit-any */
function toDraft(r: any): AdminHallDraft {
  return {
    id:              r.id,
    name:            r.name,
    description:     r.description ?? null,
    city:            r.city,
    state:           r.state ?? null,
    address:         r.address ?? null,
    pincode:         r.pincode ?? null,
    capacityMin:     r.capacity_min != null ? Number(r.capacity_min) : null,
    capacityMax:     Number(r.capacity_max),
    pricePerDay:     r.price_per_day != null ? Number(r.price_per_day) : null,
    priceMorning:    r.price_morning != null ? Number(r.price_morning) : null,
    priceEvening:    r.price_evening != null ? Number(r.price_evening) : null,
    bookingMode:     r.booking_mode,
    // Array.isArray, not `?? []`: PostgREST can hand back null for an array
    // column, and .map on null throws inside the render.
    venueTypes:      Array.isArray(r.venue_types) ? r.venue_types : [],
    amenitySlugs:    Array.isArray(r.amenity_slugs) ? r.amenity_slugs : [],
    customAmenities: Array.isArray(r.custom_amenities) ? r.custom_amenities : [],
    photoUrls:       Array.isArray(r.photo_urls) ? r.photo_urls : [],
    ownerName:       r.owner_name,
    ownerPhone:      r.owner_phone,
    ownerEmail:      r.owner_email ?? null,
    claimStatus:     r.claim_status,
    claimedHallId:   r.claimed_hall_id ?? null,
    claimedAt:       r.claimed_at ?? null,
    adminNotes:      r.admin_notes ?? null,
    createdAt:       r.created_at,
  };
}

/**
 * The draft waiting for the SIGNED-IN user, or null.
 *
 * NOTE WHAT THIS DOES NOT DO: it does not take a phone number. It selects from
 * a table whose RLS already restricts the caller to their own verified match,
 * so there is no parameter an attacker could vary. Passing a phone in would
 * have made this an enumeration oracle — the exact "knowing the number is
 * enough" failure the brief rules out.
 *
 * Fails CLOSED. A read error returns null and the owner simply sees no claim
 * card, which is the safe direction: the alternative is offering a claim we
 * could not verify.
 */
export async function fetchClaimableDraft(): Promise<AdminHallDraft | null> {
  try {
    const supabase = await getSupabaseServerClient();
    const db = supabase as any;
    const { data, error } = await db
      .from("admin_hall_drafts")
      .select(SELECT)
      .eq("claim_status", "unclaimed")
      .order("created_at", { ascending: true })
      .limit(1);

    if (error) {
      console.error("[admin-hall-drafts] claimable read failed:", error.message);
      return null;
    }
    const row = (data ?? [])[0];
    return row ? toDraft(row) : null;
  } catch (e) {
    console.error("[admin-hall-drafts] claimable read failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Every draft, newest first. Admin-only by RLS. */
export async function fetchAdminHallDrafts(
  status?: DraftClaimStatus,
): Promise<{ drafts: AdminHallDraft[]; failed: boolean }> {
  try {
    const supabase = await getSupabaseServerClient();
    const db = supabase as any;
    let q = db.from("admin_hall_drafts").select(SELECT).order("created_at", { ascending: false });
    if (status) q = q.eq("claim_status", status);

    const { data, error } = await q;
    if (error) {
      console.error("[admin-hall-drafts] list failed:", error.message);
      // `failed`, not an empty list. An admin screen that says "no drafts"
      // when the query broke is the fail-open defect this project keeps
      // rediscovering — the caller renders a different message for this.
      return { drafts: [], failed: true };
    }
    return { drafts: (data ?? []).map(toDraft), failed: false };
  } catch (e) {
    console.error("[admin-hall-drafts] list failed:", e instanceof Error ? e.message : e);
    return { drafts: [], failed: true };
  }
}

export type DuplicateMatch = {
  kind:   "hall" | "draft";
  id:     string;
  name:   string;
  city:   string;
  reason: string;
  href:   string | null;
};

/**
 * Possible existing listings for a venue an admin is about to add.
 *
 * A WARNING, NOT A BLOCK — brief section 11. Two venues can legitimately share
 * a name in different cities, and an owner may legitimately list a second hall,
 * so this surfaces what it found and lets the admin decide. It never refuses a
 * write and it never merges anything.
 *
 * Deliberately simple: ILIKE over halls and over unclaimed drafts. At the
 * current catalogue size (single digits) that is a sequential scan of a tiny
 * table, and a trigram index would be premature. If the catalogue reaches the
 * thousands this needs pg_trgm and a similarity threshold — the shape of the
 * function does not change, only the predicate.
 */
export async function findPossibleDuplicates(input: {
  name:  string;
  city?: string | null;
  phone?: string | null;
  email?: string | null;
}): Promise<DuplicateMatch[]> {
  const name = (input.name ?? "").trim();
  if (name.length < 3) return [];

  const phone = input.phone ? normalizePhoneE164(input.phone) : null;
  const email = (input.email ?? "").trim().toLowerCase() || null;
  // Escape the ILIKE metacharacters so a venue called "100% Mahal" does not
  // turn into a wildcard that matches the whole catalogue.
  const pattern = `%${name.replace(/[\\%_]/g, (m) => "\\" + m)}%`;

  const out: DuplicateMatch[] = [];
  try {
    const supabase = await getSupabaseServerClient();
    const db = supabase as any;

    const { data: halls } = await db
      .from("halls")
      .select("id, name, city, slug, status")
      .ilike("name", pattern)
      .limit(5);

    for (const h of halls ?? []) {
      out.push({
        kind: "hall",
        id: h.id,
        name: h.name,
        city: h.city,
        reason: `A listing with a similar name already exists in ${h.city} (${h.status}).`,
        href: `/admin/halls?q=${encodeURIComponent(h.name)}`,
      });
    }

    // Unclaimed drafts too — the likeliest duplicate is the one another admin
    // added last week, and it is invisible in the halls table by design.
    let dq = db
      .from("admin_hall_drafts")
      .select("id, name, city, owner_phone, owner_email, claim_status")
      .eq("claim_status", "unclaimed")
      .limit(5);
    dq = phone ? dq.or(`name.ilike.${pattern},owner_phone.eq.${phone}`) : dq.ilike("name", pattern);

    const { data: drafts } = await dq;
    for (const d of drafts ?? []) {
      const samePhone = phone && d.owner_phone === phone;
      const sameEmail = email && (d.owner_email ?? "").toLowerCase() === email;
      out.push({
        kind: "draft",
        id: d.id,
        name: d.name,
        city: d.city,
        reason: samePhone
          ? "An unclaimed draft already exists for this mobile number."
          : sameEmail
            ? "An unclaimed draft already exists for this email address."
            : `An unclaimed draft with a similar name already exists in ${d.city}.`,
        href: `/admin/hall-drafts`,
      });
    }
  } catch (e) {
    // A duplicate check that cannot run must not stop an admin working — but it
    // must not silently claim "no duplicates" either. The caller distinguishes
    // an empty result from a failed check via this thrown-then-caught path.
    console.error("[admin-hall-drafts] duplicate check failed:", e instanceof Error ? e.message : e);
  }
  return out;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
