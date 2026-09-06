// Server-side data layer for hall listing, search, and detail.
// Import only from Server Components, Route Handlers, or Server Actions.

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { todayInBusinessTz, addDaysToIsoDate } from "@/lib/dates";
import { FULL_BLOCK_STATUSES } from "@/lib/availability-status";
import type { PremiumTier } from "@/lib/premium-plans";

// ── Types ─────────────────────────────────────────────────────────────────────

export type HallListing = {
  id:             string;
  slug:           string;
  name:           string;
  city:           string;
  address:        string | null;
  capacity_max:   number;
  price_per_day:  number;
  is_premium:     boolean;          // legacy boolean — true if any premium tier is active
  premium_tier:   PremiumTier | null; // 'premium' | 'pro' | null
  rating_average: number;
  rating_count:   number;
  cover_url:      string | null;
  amenities:      string[];
};

/** Event types a venue can serve — pinned by a CHECK constraint in 0037. */
export const VENUE_TYPE_CATEGORIES = ["wedding", "reception", "party", "banquet"] as const;
export type VenueType = (typeof VENUE_TYPE_CATEGORIES)[number];

export type HallsFilters = {
  q?:         string; // free-text: name, city, address
  city?:      string; // exact city
  area?:      string; // partial match on address
  capacity?:  string; // min guests (capacity_max >=)
  priceMin?:  string; // min price_per_day
  priceMax?:  string; // max price_per_day
  amenity?:   string; // single amenity slug
  category?:  string; // premium | budget | wedding | banquet | party
  date?:      string; // YYYY-MM-DD — exclude fully-blocked halls
  sort?:      string; // recommended | price-asc | price-desc | rating | capacity
  /** Restrict to these hall ids (validated UUIDs). Used by the saved-halls
   *  view, which stores ids client-side. RLS + the status filter still apply,
   *  so an id for a non-approved hall simply returns nothing. */
  ids?:       string[];
};

// Availability statuses that make a hall fully unavailable for the day.
//
// This WAS a fourth hardcoded copy, and it had gone stale: `offline_booked` was
// added in 0056 and never added here, so a venue that blocked a date for a
// phone booking still appeared in a customer's search for that exact date.

/** Columns the free-text `q` filter searches, in one PostgREST or-group. */
const FREE_TEXT_COLUMNS = ["name", "city", "address"] as const;

/**
 * Builds the `or=` group for a free-text search, with the term QUOTED.
 *
 * PostgREST's `or` filter is a string grammar and postgrest-js escapes NOTHING
 * you interpolate into it. The previous form —
 *   q.or(`name.ilike.%${t}%,city.ilike.%${t}%,address.ilike.%${t}%`)
 * — meant a comma in the term split the group into extra members and a
 * parenthesis opened a nested one, so ordinary searches like
 *   "Sri Krishna, Madurai"   "Grand Hall (AC)"   "Anna Nagar, Chennai"
 * produced a malformed filter. The request failed with PGRST100, fetchHalls
 * logged it and returned [], and the page rendered "No halls found" — telling
 * the visitor we have no venues when in fact we had broken the query.
 *
 * PostgREST's own remedy is to double-quote the value: inside quotes a comma,
 * dot, colon and parenthesis are literal. Only `"` and `\` still need escaping,
 * and the backslash MUST be escaped first or the escapes double up.
 *
 * Do not "simplify" this back to a bare interpolation. Exported so
 * lib/__tests__/halls-search.test.ts can pin the escaping.
 */
export function buildFreeTextOrFilter(
  term: string,
  columns: readonly string[] = FREE_TEXT_COLUMNS,
): string {
  const quoted = term.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return columns.map((c) => `${c}.ilike."%${quoted}%"`).join(",");
}

// ── Detail types ─────────────────────────────────────────────────────────────

export type HallImage = {
  url:        string;
  is_cover:   boolean;
  alt_text:   string | null;
  sort_order: number;
};

export type HallAmenity = {
  name: string;
  slug: string;
  icon: string | null;
};

export type AvailabilityRow = {
  date:   string; // YYYY-MM-DD
  slot:   "morning" | "evening" | "full_day";
  status: string; // availability_status enum value
};

export type HallReview = {
  rating:             number;
  title:              string | null;
  comment:            string | null;
  cleanliness_rating: number | null;
  value_rating:       number | null;
  location_rating:    number | null;
  service_rating:     number | null;
  created_at:         string;
};

/**
 * The seller behind a listing, as published on the venue page.
 *
 * EXACTLY THREE FIELDS, AND THEY ARE THE THREE THE LAW ASKS FOR. Rule 5(3)(a)
 * of the Consumer Protection (E-Commerce) Rules 2020 obliges a marketplace to
 * display each seller's business name and geographic address. Everything else
 * on hall_owners — gst_number, pan_number, payout_upi, payout_account_number,
 * payout_ifsc, cashfree_vendor_id — is collected at onboarding and must NEVER
 * reach a public page. Widening this type is how that happens by accident.
 */
export type HallSeller = {
  business_name: string;
  address:       string | null;
  city:          string | null;
};

export type HallDetail = {
  id:             string;
  slug:           string;
  name:           string;
  city:           string;
  state:          string | null;
  address:        string | null;
  pincode:        string | null;
  latitude:       number | null;
  longitude:      number | null;
  capacity_min:   number | null;
  capacity_max:   number;
  price_per_day:  number;
  price_morning:  number | null;
  price_evening:  number | null;
  description:    string | null;
  status:         string; // hall_status enum value
  is_premium:     boolean;
  premium_tier:   PremiumTier | null;
  rating_average: number;
  rating_count:   number;
  images:         HallImage[];
  amenities:      HallAmenity[];
  custom_amenities: string[];
  availability:   AvailabilityRow[];
  reviews:        HallReview[];
  /** Published seller identity; null when it cannot be read (see fetchHallSeller). */
  seller:         HallSeller | null;
};

// ── Main query ────────────────────────────────────────────────────────────────

export async function fetchHalls(filters: HallsFilters): Promise<HallListing[]> {
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any; // Database type is a placeholder until `supabase gen types` runs

  // Step 1: find hall IDs that are fully blocked on the requested date
  let unavailableIds: string[] = [];
  if (filters.date) {
    const { data: blocked } = await db
      .from("availability")
      .select("hall_id")
      .eq("date", filters.date)
      .in("status", FULL_BLOCK_STATUSES);
    unavailableIds = (blocked ?? []).map((r: { hall_id: string }) => r.hall_id);
  }

  // Step 2: find hall IDs that have the requested amenity
  let amenityFilterIds: string[] | null = null;
  if (filters.amenity) {
    const { data: amenityRow } = await db
      .from("amenities")
      .select("id")
      .eq("slug", filters.amenity)
      .maybeSingle();

    if (amenityRow?.id) {
      const { data: haRows } = await db
        .from("hall_amenities")
        .select("hall_id")
        .eq("amenity_id", amenityRow.id);
      amenityFilterIds = (haRows ?? []).map((r: { hall_id: string }) => r.hall_id);
    } else {
      return []; // slug not in DB → no results
    }
  }

  // Step 3: build the main halls query
  // SECURITY: always filter status = 'approved'.
  // RLS (0007) also enforces this — two layers of defence.
  // We never join hall_owners/profiles, so owner private data is never exposed.
  // Forwards-compat: build & run once with premium_tier; if the column doesn't
  // exist (migration 0013 not yet applied → Postgres error 42703), fall back
  // to the legacy projection so the list still renders.  All tier-aware code
  // paths (sort/category/badge) just see null and degrade gracefully.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function buildQuery(includeTier: boolean): any {
    const select = includeTier
      ? `id, slug, name, city, address,
         capacity_max, price_per_day, is_premium, premium_tier,
         rating_average, rating_count,
         hall_images(url, is_cover),
         hall_amenities(amenities(name))`
      : `id, slug, name, city, address,
         capacity_max, price_per_day, is_premium,
         rating_average, rating_count,
         hall_images(url, is_cover),
         hall_amenities(amenities(name))`;

    let q = db.from("halls").select(select).eq("status", "approved");

    if (filters.q?.trim()) {
      q = q.or(buildFreeTextOrFilter(filters.q.trim()));
    }
    if (filters.city) q = q.eq("city", filters.city);
    if (filters.area) q = q.ilike("address", `%${filters.area.trim()}%`);

    if (filters.capacity) {
      const cap = parseInt(filters.capacity, 10);
      if (!isNaN(cap)) q = q.gte("capacity_max", cap);
    }
    if (filters.priceMin) {
      const min = parseFloat(filters.priceMin);
      if (!isNaN(min)) q = q.gte("price_per_day", min);
    }
    if (filters.priceMax) {
      const max = parseFloat(filters.priceMax);
      if (!isNaN(max)) q = q.lte("price_per_day", max);
    }

    // Category chips
    if (filters.category === "premium") {
      q = includeTier ? q.in("premium_tier", ["premium", "pro"]) : q.eq("is_premium", true);
    }
    if (filters.category === "pro" && includeTier) {
      q = q.eq("premium_tier", "pro");
    }
    if (filters.category === "budget") q = q.lte("price_per_day", 100000);

    // Venue-type categories (0037). These four tiles used to filter NOTHING:
    // the category was read and then never applied, so "Party Halls" returned
    // every hall on the platform. `overlaps` matches a hall that declares this
    // type among the several it may serve. A hall with no types declared is
    // deliberately absent here rather than assumed into every category.
    if (VENUE_TYPE_CATEGORIES.includes(filters.category as VenueType)) {
      q = q.overlaps("venue_types", [filters.category]);
    }

    if (filters.ids && filters.ids.length > 0) {
      q = q.in("id", filters.ids);
    }
    if (unavailableIds.length > 0) {
      q = q.not("id", "in", `(${unavailableIds.join(",")})`);
    }
    if (amenityFilterIds !== null) {
      q = q.in("id", amenityFilterIds);
    }

    switch (filters.sort) {
      case "price-asc":  q = q.order("price_per_day",  { ascending: true  }); break;
      case "price-desc": q = q.order("price_per_day",  { ascending: false }); break;
      case "rating":     q = q.order("rating_average", { ascending: false }); break;
      case "capacity":   q = q.order("capacity_max",   { ascending: false }); break;
      default:
        // pro → premium → rest, then rating. Falls back to is_premium pre-0013.
        q = includeTier
          ? q.order("premium_tier", { ascending: false, nullsFirst: false }).order("rating_average", { ascending: false })
          : q.order("is_premium",   { ascending: false }).order("rating_average", { ascending: false });
    }
    return q;
  }

  // Bail early if the amenity filter narrowed to nothing.
  if (amenityFilterIds !== null && amenityFilterIds.length === 0) return [];

  let { data, error } = await buildQuery(true);

  // Pre-migration fallback: re-run without premium_tier.
  if (error?.code === "42703") {
    console.info("[fetchHalls] halls.premium_tier missing — run migration 0013 for tier sorting/badges.");
    ({ data, error } = await buildQuery(false));
  }

  if (error) {
    // PGRST205 / 42P01 = table/relation not found. This is expected before the
    // Supabase migrations have been run on a fresh setup — emit a one-line
    // info note instead of a console.error (which would surface as a Next.js
    // dev-tools "Issue" on every page render). Real query errors still log.
    if (error.code === "PGRST205" || error.code === "42P01") {
      console.info("[fetchHalls] halls table not provisioned yet — run supabase/migrations.");
    } else {
      console.error("[fetchHalls]", error.message);
    }
    return [];
  }

  // Normalise the nested Supabase response into HallListing[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any): HallListing => {
    const imgs: { url: string; is_cover: boolean }[] = row.hall_images ?? [];
    const coverUrl = imgs.find((i) => i.is_cover)?.url ?? imgs[0]?.url ?? null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const amenityNames: string[] = (row.hall_amenities ?? [])
      .map((ha: any) => ha.amenities?.name as string | undefined)
      .filter((n: string | undefined): n is string => Boolean(n));

    return {
      id:             row.id,
      slug:           row.slug,
      name:           row.name,
      city:           row.city,
      address:        row.address ?? null,
      capacity_max:   row.capacity_max,
      price_per_day:  Number(row.price_per_day),
      is_premium:     row.is_premium,
      premium_tier:   (row.premium_tier ?? null) as PremiumTier | null,
      rating_average: Number(row.rating_average),
      rating_count:   row.rating_count,
      cover_url:      coverUrl,
      amenities:      amenityNames,
    };
  });
}

// ── Premium inventory gate ────────────────────────────────────────────────────

/**
 * How many APPROVED halls currently hold a paid premium tier.
 *
 * WHY THIS EXISTS. The homepage "Premium" quick action, the "Premium Halls"
 * category tile and the "✦ Premium" filter chip on /halls were all rendered
 * unconditionally. premium_listings is empty and every approved hall has
 * premium_tier null, so all three advertised a shelf that does not exist and
 * dead-ended on "No halls found". Gate them on this count and they come back by
 * themselves the moment an owner buys a plan — no code change, no stale flag.
 *
 * IT COUNTS halls, NOT premium_listings, and that is deliberate: RLS on
 * premium_listings is owner-or-admin (0007), so an anonymous visitor's client
 * sees zero rows there no matter how many exist. halls.premium_tier is kept in
 * sync from premium_listings by recompute_hall_premium() (0013) and IS publicly
 * readable for approved halls, which makes it the only correct public source.
 */
export async function countActivePremiumHalls(): Promise<number> {
  try {
    const supabase = await getSupabaseServerClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;

    // head:true — we want the number, not the rows.
    let { count, error } = await db
      .from("halls")
      .select("id", { count: "exact", head: true })
      .eq("status", "approved")
      .in("premium_tier", ["premium", "pro"]);

    // Pre-0013 fallback, same as fetchHalls: the column may not exist yet.
    if (error?.code === "42703") {
      ({ count, error } = await db
        .from("halls")
        .select("id", { count: "exact", head: true })
        .eq("status", "approved")
        .eq("is_premium", true));
    }

    // FAIL CLOSED. If we cannot prove premium inventory exists we advertise
    // none of it: a hidden entry point is a far smaller failure than a paid-
    // placement promise that lands the visitor on an empty page.
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}

// ── Hall detail ───────────────────────────────────────────────────────────────

/**
 * The seller identity Hallnect is obliged to publish for one listing.
 *
 * Rule 5(3)(a) of the Consumer Protection (E-Commerce) Rules 2020: a
 * marketplace must display the seller's business name and geographic address on
 * the listing. The venue page previously showed only the venue's own street
 * address, so a customer could not tell who they were contracting with.
 *
 * WHY AN RPC, AND WHY NOT JUST EMBED hall_owners(...).
 * The obvious fix — adding `hall_owners(business_name, address, city)` to the
 * select above — silently returns null for the public. hall_owners_select (0007)
 * is `profile_id = auth.uid() or is_admin()`, so an anonymous visitor's client
 * reads no rows and PostgREST embeds nothing without erroring. The block would
 * render for admins in testing and for nobody in production.
 *
 * AND WIDENING THAT POLICY WOULD BE A LEAK, NOT A FIX. RLS is row-level, and
 * hall_owners has no column-level SELECT grants — a public select policy would
 * hand every visitor gst_number, pan_number, payout_upi, payout_account_number
 * and payout_ifsc off the same row.
 *
 * So the three published fields are returned by hall_seller_public(uuid)
 * (migration 0054): a SECURITY DEFINER function whose PROJECTION is the whole
 * allow-list, so there is no column list on this side that a later edit could
 * widen by accident. It also gates on halls.status = 'approved', so seller
 * identity is published only for a listing that is itself public rather than
 * being enumerable through a draft or suspended hall.
 *
 * This replaced a service-role read. That worked, but it made a statutory
 * disclosure depend on SUPABASE_SERVICE_ROLE_KEY being present — and its
 * absence degraded to "no seller block", i.e. the Rule 5(3)(a) obligation
 * silently unmet on every venue page, with only an info-level log to say so.
 */
async function fetchHallSeller(hallId: string): Promise<HallSeller | null> {
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data, error } = await db.rpc("hall_seller_public", { _hall_id: hallId });

  // A database without 0054 (42883 = undefined_function) must not 500 a venue
  // page — the listing is still perfectly usable without the block.
  if (error) {
    if (error.code === "42883" || error.code === "PGRST202") {
      console.info("[fetchHallSeller] hall_seller_public missing — apply migration 0054");
    } else {
      console.error("[fetchHallSeller]", error.code, error.message);
    }
    return null;
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.business_name) return null;

  return {
    business_name: row.business_name as string,
    address:       (row.address as string | null) ?? null,
    city:          (row.city    as string | null) ?? null,
  };
}

// SECURITY: uses getSupabaseServerClient() (session-aware, anon key).
// RLS on halls:  status='approved' OR owns_hall() OR is_admin()
// RLS on availability/hall_images/hall_amenities: mirrors the same rule.
// Reviews:       is_visible=true is public; profiles are NOT joined (RLS blocks
//                anonymous reads of other users' profiles — reviewer names are
//                not exposed).
export async function fetchHallBySlug(slug: string): Promise<HallDetail | null> {
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Forwards-compat: try with premium_tier; fall back if column missing.
  // owner_id is selected so the published seller identity can be resolved
  // below. It is a hall_owners PK, not a person's id, and it never leaves the
  // server — HallDetail carries `seller`, not `owner_id`.
  const SELECT_WITH_TIER = `
      id, slug, name, city, state, address, pincode,
      latitude, longitude, capacity_min, capacity_max,
      price_per_day, price_morning, price_evening,
      description, status, is_premium, premium_tier, owner_id,
      rating_average, rating_count,
      hall_images(url, is_cover, alt_text, sort_order),
      hall_amenities(amenities(name, slug, icon)),
      hall_custom_amenities(name, sort_order)
    `;
  const SELECT_LEGACY = SELECT_WITH_TIER.replace(", premium_tier", "");

  let { data: hall, error } = await db
    .from("halls")
    .select(SELECT_WITH_TIER)
    .eq("slug", slug)
    .maybeSingle();

  if (error?.code === "42703") {
    console.info("[fetchHallBySlug] halls.premium_tier missing — run migration 0013.");
    ({ data: hall, error } = await db
      .from("halls")
      .select(SELECT_LEGACY)
      .eq("slug", slug)
      .maybeSingle());
  }

  if (error) {
    if (error.code === "PGRST205" || error.code === "42P01") {
      console.info("[fetchHallBySlug] halls table not provisioned yet.");
    } else {
      console.error("[fetchHallBySlug]", error.message);
    }
    return null;
  }

  if (!hall) return null;

  // Published seller identity (Rule 5(3)(a)). Fetched alongside availability
  // rather than embedded — see fetchHallSeller for why an embed cannot work.
  const seller = await fetchHallSeller(hall.id as string);

  // Availability for next 30 days (separate query — embedding with date filter
  // is cleaner here since we don't want to pull years of rows)
  //
  // IN IST, not UTC. toISOString() here resolved to YESTERDAY for the five and
  // a half hours between 00:00 and 05:30 India time, so early-morning visitors
  // got a window starting on a day that had already passed and ending one short
  // — the same drift lib/dates.ts exists to eliminate, and the same one already
  // fixed in the owner calendar.
  const today = todayInBusinessTz();
  const in30  = addDaysToIsoDate(today, 30);
  const { data: availRows } = await db
    .from("availability")
    .select("date, slot, status")
    .eq("hall_id", hall.id)
    .gte("date", today)
    .lte("date", in30)
    .order("date");

  // Visible reviews — profiles NOT joined (RLS blocks anon reads of other profiles)
  const REVIEW_SELECT_FULL = "rating, title, comment, cleanliness_rating, value_rating, location_rating, service_rating, created_at";
  const REVIEW_SELECT_LEGACY = "rating, comment, created_at";

  let { data: reviewRows, error: reviewErr } = await db
    .from("reviews")
    .select(REVIEW_SELECT_FULL)
    .eq("hall_id", hall.id)
    .eq("is_visible", true)
    .order("created_at", { ascending: false })
    .limit(10);

  if (reviewErr?.code === "42703") {
    ({ data: reviewRows } = await db
      .from("reviews")
      .select(REVIEW_SELECT_LEGACY)
      .eq("hall_id", hall.id)
      .eq("is_visible", true)
      .order("created_at", { ascending: false })
      .limit(10));
  }

  // Normalise
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const images: HallImage[] = ((hall.hall_images ?? []) as any[])
    .map((img) => ({
      url:        img.url as string,
      is_cover:   img.is_cover as boolean,
      alt_text:   (img.alt_text as string | null) ?? null,
      sort_order: (img.sort_order as number) ?? 0,
    }))
    .sort((a, b) => {
      if (a.is_cover && !b.is_cover) return -1;
      if (!a.is_cover && b.is_cover) return  1;
      return a.sort_order - b.sort_order;
    });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const amenities: HallAmenity[] = ((hall.hall_amenities ?? []) as any[])
    .map((ha) => ({
      name: (ha.amenities?.name  as string) ?? "",
      slug: (ha.amenities?.slug  as string) ?? "",
      icon: (ha.amenities?.icon  as string | null) ?? null,
    }))
    .filter((a) => !!a.name);

  // Owner-defined amenities. RLS (hall_custom_amenities_select) only returns
  // these when the hall is approved or the caller owns it / is admin, so a
  // pending hall never leaks its wording.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const customAmenities: string[] = ((hall.hall_custom_amenities ?? []) as any[])
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((c) => (c.name as string) ?? "")
    .filter(Boolean);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const availability: AvailabilityRow[] = ((availRows ?? []) as any[]).map((r) => ({
    date:   r.date   as string,
    slot:   r.slot   as AvailabilityRow["slot"],
    status: r.status as string,
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reviews: HallReview[] = ((reviewRows ?? []) as any[]).map((r) => ({
    rating:             r.rating     as number,
    title:              (r.title     as string | null) ?? null,
    comment:            (r.comment   as string | null) ?? null,
    cleanliness_rating: r.cleanliness_rating != null ? Number(r.cleanliness_rating) : null,
    value_rating:       r.value_rating       != null ? Number(r.value_rating)       : null,
    location_rating:    r.location_rating    != null ? Number(r.location_rating)    : null,
    service_rating:     r.service_rating     != null ? Number(r.service_rating)     : null,
    created_at:         r.created_at as string,
  }));

  return {
    id:             hall.id,
    slug:           hall.slug,
    name:           hall.name,
    city:           hall.city,
    state:          hall.state          ?? null,
    address:        hall.address        ?? null,
    pincode:        hall.pincode        ?? null,
    latitude:       hall.latitude  != null ? Number(hall.latitude)  : null,
    longitude:      hall.longitude != null ? Number(hall.longitude) : null,
    capacity_min:   hall.capacity_min   ?? null,
    capacity_max:   hall.capacity_max,
    price_per_day:  Number(hall.price_per_day),
    price_morning:  hall.price_morning  != null ? Number(hall.price_morning)  : null,
    price_evening:  hall.price_evening  != null ? Number(hall.price_evening)  : null,
    description:    hall.description    ?? null,
    status:         hall.status,
    is_premium:     hall.is_premium,
    premium_tier:   (hall.premium_tier ?? null) as PremiumTier | null,
    rating_average: Number(hall.rating_average),
    rating_count:   hall.rating_count,
    images,
    amenities,
    custom_amenities: customAmenities,
    availability,
    reviews,
    seller,
  };
}

// Approved halls in the same city, excluding the current hall
export async function fetchSimilarHalls(
  hallId: string,
  city:   string,
  limit   = 6,
): Promise<HallListing[]> {
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const SELECT_WITH_TIER = `
      id, slug, name, city, address,
      capacity_max, price_per_day, is_premium, premium_tier,
      rating_average, rating_count,
      hall_images(url, is_cover)
    `;
  const SELECT_LEGACY = SELECT_WITH_TIER.replace(", premium_tier", "");

  let { data, error } = await db
    .from("halls")
    .select(SELECT_WITH_TIER)
    .eq("status", "approved")
    .eq("city", city)
    .neq("id", hallId)
    .limit(limit);

  if (error?.code === "42703") {
    ({ data } = await db
      .from("halls")
      .select(SELECT_LEGACY)
      .eq("status", "approved")
      .eq("city", city)
      .neq("id", hallId)
      .limit(limit));
  }

  if (!data) return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any[]).map((row): HallListing => {
    const imgs: { url: string; is_cover: boolean }[] = row.hall_images ?? [];
    const coverUrl = imgs.find((i) => i.is_cover)?.url ?? imgs[0]?.url ?? null;
    return {
      id:             row.id,
      slug:           row.slug,
      name:           row.name,
      city:           row.city,
      address:        row.address ?? null,
      capacity_max:   row.capacity_max,
      price_per_day:  Number(row.price_per_day),
      is_premium:     row.is_premium,
      premium_tier:   (row.premium_tier ?? null) as PremiumTier | null,
      rating_average: Number(row.rating_average),
      rating_count:   row.rating_count,
      cover_url:      coverUrl,
      amenities:      [],
    };
  });
}
