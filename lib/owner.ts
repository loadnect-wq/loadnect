// Server-side data layer for the hall-owner dashboard.
// All queries use getSupabaseServerClient() (session-aware, anon key).
// RLS is the primary security enforcer — every write also checks
// owns_hall() or owns_owner_row() at the DB level.

import { getSupabaseServerClient } from "@/lib/supabase/server";

// ── Types ─────────────────────────────────────────────────────────────────────

export type OwnerRow = {
  id:             string; // hall_owners.id — used as owner_id in halls table
  profile_id:     string;
  business_name:  string;
  business_email: string | null;
  business_phone: string | null;
  gst_number:     string | null;
  pan_number:     string | null;
  address:        string | null;
  city:           string | null;
  state:          string | null;
  payout_upi:     string | null;
  /** Cashfree Easy Split vendor state — governs automatic payouts. */
  cashfree_vendor_id: string | null;
  vendor_kyc_status:  string | null;
  vendor_last_error:  string | null;
  is_verified:    boolean;
};

export type OwnerHall = {
  id:             string;
  slug:           string;
  name:           string;
  city:           string;
  state:          string | null;
  capacity_max:   number;
  price_per_day:  number;
  status:         string; // hall_status enum
  is_premium:     boolean;
  rating_average: number;
  rating_count:   number;
  cover_url:      string | null;
  image_count:    number;
  created_at:     string;
  /** Admin's written reason when the hall was rejected or suspended (0025). */
  rejection_reason: string | null;
};

export type OwnerHallDetail = OwnerHall & {
  description:   string | null;
  address:       string | null;
  pincode:       string | null;
  latitude:      number | null;
  longitude:     number | null;
  capacity_min:  number | null;
  price_morning: number | null;
  price_evening: number | null;
  amenity_ids:   string[];
  custom_amenities: string[];
};

export type OwnerAmenity = {
  id:       string;
  name:     string;
  slug:     string;
  icon:     string | null;
  category: string | null;
};

export type OwnerBooking = {
  id:             string;
  hall_id:        string;
  hall_name:      string;
  hall_slug:      string;
  event_date:     string;
  end_date:       string;
  slot:           string;
  guest_count:    number | null;
  base_amount:    number;
  total_amount:   number;
  status:         string;
  customer_notes: string | null;
  owner_notes:    string | null;
  cancel_reason:  string | null;
  created_at:     string;
  /** Customer's contact number for THIS booking (E.164). */
  contact_phone:  string | null;
  /** When an unanswered request auto-expires and releases the dates. */
  owner_response_due_at: string | null;
  /** Advance actually received through the gateway, 0 when none. */
  amount_paid:    number;
};

export type HallImage = {
  id:           string;
  url:          string;
  storage_path: string | null;
  alt_text:     string | null;
  is_cover:     boolean;
  sort_order:   number;
};

export type AvailabilityEntry = {
  id:     string;
  date:   string;
  slot:   string;
  status: string;
  note:   string | null;
};

export type RevenueBooking = {
  id:           string;
  hall_id:      string;
  hall_name:    string;
  event_date:   string;
  slot:         string;
  base_amount:  number;
  total_amount: number;
  status:       string;
  payout_amount: number | null; // from commissions
};

export type PremiumListing = {
  id:         string;
  hall_id:    string;
  hall_name:  string;
  hall_slug:  string;
  plan_slug:  "premium" | "pro";
  start_date: string;
  end_date:   string;
  amount:     number;
  is_active:  boolean;
};

export type OwnerStats = {
  totalHalls:      number;
  approvedHalls:   number;
  pendingHalls:    number;
  pendingBookings: number;
  confirmedBookings: number;
  totalRevenue:    number;
};

// ── Error handling helper ─────────────────────────────────────────────────────

function handleError(fn: string, error: { code?: string; message: string }) {
  if (error.code === "PGRST205" || error.code === "42P01") {
    console.info(`[${fn}] table not provisioned yet — run supabase/migrations.`);
  } else {
    console.error(`[${fn}]`, error.message);
  }
}

// ── Fetch owner row ───────────────────────────────────────────────────────────

// Returns the hall_owners row for the current authenticated user, or null if
// it hasn't been created yet (owner needs to complete their business profile).
// RLS: profile_id = auth.uid()
export async function fetchOwnerRow(): Promise<OwnerRow | null> {
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Identity from the session — never inferred from the row set.
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // EXPLICIT profile_id filter (defense in depth). Previously this relied
  // solely on RLS to scope the row, which is wrong for any caller that can see
  // more than their own row: hall_owners_select also permits is_admin(), so an
  // admin got EVERY owner row and .maybeSingle() then errored (or, worse, a
  // single-row DB would hand back somebody else's owner id — which then fails
  // the halls_insert WITH CHECK owns_owner_row() test as a 42501).
  const { data, error } = await db
    .from("hall_owners")
    .select("id, profile_id, business_name, business_email, business_phone, gst_number, pan_number, address, city, state, payout_upi, is_verified, cashfree_vendor_id, vendor_kyc_status, vendor_last_error")
    .eq("profile_id", user.id)
    .maybeSingle();

  if (error) { handleError("fetchOwnerRow", error); return null; }
  if (!data) return null;

  return data as OwnerRow;
}

// ── Fetch halls for this owner ────────────────────────────────────────────────

// RLS: owns_hall(id) — owner can read all their halls regardless of status.
export async function fetchOwnerHalls(ownerId: string): Promise<OwnerHall[]> {
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data, error } = await db
    .from("halls")
    .select("id, slug, name, city, state, capacity_max, price_per_day, status, is_premium, rating_average, rating_count, created_at, rejection_reason, hall_images(url, is_cover)")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false });

  if (error) { handleError("fetchOwnerHalls", error); return []; }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any): OwnerHall => {
    const imgs: { url: string; is_cover: boolean }[] = row.hall_images ?? [];
    const coverUrl = imgs.find((i) => i.is_cover)?.url ?? imgs[0]?.url ?? null;
    return {
      image_count:    imgs.length,
      id:             row.id,
      slug:           row.slug,
      name:           row.name,
      city:           row.city,
      state:          row.state ?? null,
      capacity_max:   row.capacity_max,
      price_per_day:  Number(row.price_per_day),
      status:         row.status,
      is_premium:     row.is_premium,
      rating_average: Number(row.rating_average),
      rating_count:   row.rating_count,
      cover_url:      coverUrl,
      created_at:     row.created_at,
      rejection_reason: row.rejection_reason ?? null,
    };
  });
}

// ── Fetch single hall (for edit) ──────────────────────────────────────────────

// SECURITY: scoped to the caller's OWN hall. RLS alone is NOT sufficient here:
// halls_select also permits `status = 'approved'`, so every approved hall in the
// marketplace is readable by any signed-in user. Without this filter an owner
// could open another owner's approved hall in the edit/images/availability
// screens (and any save would then silently affect 0 rows while reporting
// success, because halls_update USING owns_hall() filters the row out).
export async function fetchOwnerHall(hallId: string): Promise<OwnerHallDetail | null> {
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: ownerRow } = await db
    .from("hall_owners").select("id").eq("profile_id", user.id).maybeSingle();
  if (!ownerRow?.id) return null;

  const { data, error } = await db
    .from("halls")
    .select("id, slug, name, city, state, address, pincode, latitude, longitude, capacity_min, capacity_max, price_per_day, price_morning, price_evening, description, status, is_premium, rating_average, rating_count, created_at, rejection_reason, hall_images(url, is_cover), hall_amenities(amenity_id), hall_custom_amenities(name, sort_order)")
    .eq("id", hallId)
    .eq("owner_id", ownerRow.id)   // ← ownership, not just visibility
    .maybeSingle();

  if (error) { handleError("fetchOwnerHall", error); return null; }
  if (!data) return null;

  const imgs: { url: string; is_cover: boolean }[] = data.hall_images ?? [];
  const coverUrl = imgs.find((i: { is_cover: boolean }) => i.is_cover)?.url ?? imgs[0]?.url ?? null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const amenityIds: string[] = (data.hall_amenities ?? []).map((ha: any) => ha.amenity_id as string);

  const customAmenities: string[] = ((data.hall_custom_amenities ?? []) as { name: string; sort_order: number }[])
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((c) => c.name);

  return {
    custom_amenities: customAmenities,
    image_count:    imgs.length,
    id:             data.id,
    slug:           data.slug,
    name:           data.name,
    city:           data.city,
    state:          data.state ?? null,
    address:        data.address ?? null,
    pincode:        data.pincode ?? null,
    latitude:       data.latitude  != null ? Number(data.latitude)  : null,
    longitude:      data.longitude != null ? Number(data.longitude) : null,
    capacity_min:   data.capacity_min ?? null,
    capacity_max:   data.capacity_max,
    price_per_day:  Number(data.price_per_day),
    price_morning:  data.price_morning  != null ? Number(data.price_morning)  : null,
    price_evening:  data.price_evening  != null ? Number(data.price_evening)  : null,
    description:    data.description ?? null,
    status:         data.status,
    is_premium:     data.is_premium,
    rating_average: Number(data.rating_average),
    rating_count:   data.rating_count,
    cover_url:      coverUrl,
    created_at:     data.created_at,
    rejection_reason: data.rejection_reason ?? null,
    amenity_ids:    amenityIds,
  };
}

// ── Fetch all amenities (public catalogue) ────────────────────────────────────

export async function fetchAllAmenities(): Promise<OwnerAmenity[]> {
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data, error } = await db
    .from("amenities")
    .select("id, name, slug, icon, category")
    .order("name");

  if (error) { handleError("fetchAllAmenities", error); return []; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((a: any): OwnerAmenity => ({
    id:       a.id,
    name:     a.name,
    slug:     a.slug,
    icon:     a.icon ?? null,
    category: a.category ?? null,
  }));
}

// ── Fetch hall images ─────────────────────────────────────────────────────────

export async function fetchHallImages(hallId: string): Promise<HallImage[]> {
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data, error } = await db
    .from("hall_images")
    .select("id, url, storage_path, alt_text, is_cover, sort_order")
    .eq("hall_id", hallId)
    .order("sort_order");

  if (error) { handleError("fetchHallImages", error); return []; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((img: any): HallImage => ({
    id:           img.id,
    url:          img.url,
    storage_path: img.storage_path ?? null,
    alt_text:     img.alt_text ?? null,
    is_cover:     img.is_cover,
    sort_order:   img.sort_order,
  }));
}

// ── Fetch availability ────────────────────────────────────────────────────────

export async function fetchHallAvailability(
  hallId: string,
  from:   string,
  to:     string,
): Promise<AvailabilityEntry[]> {
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data, error } = await db
    .from("availability")
    .select("id, date, slot, status, note")
    .eq("hall_id", hallId)
    .gte("date", from)
    .lte("date", to)
    .order("date")
    .order("slot");

  if (error) { handleError("fetchHallAvailability", error); return []; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any): AvailabilityEntry => ({
    id:     r.id,
    date:   r.date,
    slot:   r.slot,
    status: r.status,
    note:   r.note ?? null,
  }));
}

// ── Fetch bookings for owner's halls ─────────────────────────────────────────

// SECURITY: RLS bookings_select — owns_hall(hall_id) — limits to this owner's halls.
// We also explicitly filter by hallIds for defense-in-depth.
export async function fetchOwnerBookings(
  hallIds:    string[],
  statusFilter?: string,
): Promise<OwnerBooking[]> {
  if (hallIds.length === 0) return [];

  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  let query = db
    .from("bookings")
    .select("id, hall_id, event_date, end_date, slot, guest_count, base_amount, total_amount, status, customer_notes, owner_notes, cancel_reason, created_at, contact_phone, owner_response_due_at, halls(name, slug), payments(amount, status)")
    .in("hall_id", hallIds)
    .order("event_date", { ascending: true });

  if (statusFilter) query = query.eq("status", statusFilter);

  const { data, error } = await query;
  if (error) { handleError("fetchOwnerBookings", error); return []; }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any): OwnerBooking => ({
    id:             row.id,
    hall_id:        row.hall_id,
    hall_name:      row.halls?.name ?? "Hall",
    hall_slug:      row.halls?.slug ?? "",
    event_date:     row.event_date,
    end_date:       row.end_date ?? row.event_date,
    slot:           row.slot,
    guest_count:    row.guest_count ?? null,
    base_amount:    Number(row.base_amount),
    total_amount:   Number(row.total_amount),
    status:         row.status,
    customer_notes: row.customer_notes ?? null,
    owner_notes:    row.owner_notes ?? null,
    cancel_reason:  row.cancel_reason ?? null,
    created_at:     row.created_at,
    contact_phone:  row.contact_phone ?? null,
    owner_response_due_at: row.owner_response_due_at ?? null,
    // Only a gateway-verified payment counts as money received.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    amount_paid: (row.payments ?? [])
      .filter((p: any) => p?.status === "payment_success")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .reduce((sum: number, p: any) => sum + Number(p.amount ?? 0), 0),
  }));
}

// ── Fetch revenue (confirmed + completed bookings) ────────────────────────────

export async function fetchOwnerRevenue(hallIds: string[]): Promise<RevenueBooking[]> {
  if (hallIds.length === 0) return [];

  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data, error } = await db
    .from("bookings")
    .select("id, hall_id, event_date, slot, base_amount, total_amount, status, halls(name), commissions(owner_payout_amount)")
    .in("hall_id", hallIds)
    .in("status", ["owner_confirmed", "completed"])
    .order("event_date", { ascending: false });

  if (error) { handleError("fetchOwnerRevenue", error); return []; }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any): RevenueBooking => ({
    id:           row.id,
    hall_id:      row.hall_id,
    hall_name:    row.halls?.name ?? "Hall",
    event_date:   row.event_date,
    slot:         row.slot,
    base_amount:  Number(row.base_amount),
    total_amount: Number(row.total_amount),
    status:       row.status,
    payout_amount: row.commissions?.owner_payout_amount != null
      ? Number(row.commissions.owner_payout_amount)
      : null,
  }));
}

// ── Owner commissions ─────────────────────────────────────────────────────────
// Returns the commissions table rows for the owner's halls. RLS on the
// commissions table (migration 0007) restricts SELECT to `owns_hall(hall_id)`
// for non-admins, so even without the explicit hall_id filter here a malicious
// caller cannot read other owners' rows. The filter is defense in depth.

export type OwnerCommissionRow = {
  id:                  string;
  booking_id:          string;
  hall_id:             string | null;
  hall_name:           string;
  booking_amount:      number;
  commission_rate:     number;
  commission_amount:   number;
  owner_payout_amount: number;
  status:              string;
  created_at:          string;
  due_date:            string | null;
  paid_at:             string | null;
  settlement_adjustment_status: string | null;
  // Present when the owner has a submission awaiting/decided for this commission.
  submission_status:   string | null;
};

export async function fetchOwnerCommissions(hallIds: string[]): Promise<OwnerCommissionRow[]> {
  if (hallIds.length === 0) return [];

  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Newer columns (due_date/paid_at/settlement_adjustment_status) exist after
  // migration 0017. Fall back gracefully if the migration hasn't run yet.
  const fullCols =
    "id, booking_id, hall_id, booking_amount, commission_rate, commission_amount, owner_payout_amount, status, created_at, due_date, paid_at, settlement_adjustment_status, bookings(halls(name))";
  const baseCols =
    "id, booking_id, hall_id, booking_amount, commission_rate, commission_amount, owner_payout_amount, status, created_at, bookings(halls(name))";

  let { data, error } = await db
    .from("commissions")
    .select(fullCols)
    .in("hall_id", hallIds)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error?.code === "42703") {
    ({ data, error } = await db
      .from("commissions")
      .select(baseCols)
      .in("hall_id", hallIds)
      .order("created_at", { ascending: false })
      .limit(200));
  }

  if (error) { handleError("fetchOwnerCommissions", error); return []; }

  // Latest submission status per commission (so the UI can show "under review").
  const commissionIds = (data ?? []).map((r: { id: string }) => r.id);
  const latestSubmission = new Map<string, string>();
  if (commissionIds.length > 0) {
    const { data: subs } = await db
      .from("owner_commission_payments")
      .select("commission_id, status, submitted_at")
      .in("commission_id", commissionIds)
      .order("submitted_at", { ascending: false });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const s of (subs ?? []) as any[]) {
      if (!latestSubmission.has(s.commission_id)) latestSubmission.set(s.commission_id, s.status);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any): OwnerCommissionRow => ({
    id:                  row.id,
    booking_id:          row.booking_id,
    hall_id:             row.hall_id ?? null,
    hall_name:           row.bookings?.halls?.name ?? "Hall",
    booking_amount:      Number(row.booking_amount),
    commission_rate:     Number(row.commission_rate),
    commission_amount:   Number(row.commission_amount),
    owner_payout_amount: Number(row.owner_payout_amount),
    status:              row.status,
    created_at:          row.created_at,
    due_date:            row.due_date ?? null,
    paid_at:             row.paid_at ?? null,
    settlement_adjustment_status: row.settlement_adjustment_status ?? null,
    submission_status:   latestSubmission.get(row.id) ?? null,
  }));
}

export type OwnerSettlementAdjustmentRow = {
  id:            string;
  booking_id:    string | null;
  commission_id: string;
  amount:        number;
  reason:        string | null;
  status:        string;
  applied_at:    string;
};

/** Settlement adjustments (owner payout deductions) for this owner. */
export async function fetchOwnerSettlementAdjustments(
  ownerId: string,
): Promise<OwnerSettlementAdjustmentRow[]> {
  if (!ownerId) return [];
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data, error } = await db
    .from("owner_settlement_adjustments")
    .select("id, booking_id, commission_id, amount, reason, status, applied_at")
    .eq("owner_id", ownerId)
    .order("applied_at", { ascending: false })
    .limit(100);

  if (error) { handleError("fetchOwnerSettlementAdjustments", error); return []; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any): OwnerSettlementAdjustmentRow => ({
    id:            r.id,
    booking_id:    r.booking_id ?? null,
    commission_id: r.commission_id,
    amount:        Number(r.amount),
    reason:        r.reason ?? null,
    status:        r.status,
    applied_at:    r.applied_at,
  }));
}

// ── Fetch premium listings ────────────────────────────────────────────────────

export async function fetchOwnerPremiumListings(hallIds: string[]): Promise<PremiumListing[]> {
  if (hallIds.length === 0) return [];

  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const SELECT_WITH_PLAN = "id, hall_id, plan_slug, start_date, end_date, amount, is_active, halls(name, slug)";
  const SELECT_LEGACY    = SELECT_WITH_PLAN.replace(", plan_slug", "");

  let { data, error } = await db
    .from("premium_listings")
    .select(SELECT_WITH_PLAN)
    .in("hall_id", hallIds)
    .order("end_date", { ascending: false });

  if (error?.code === "42703") {
    ({ data, error } = await db
      .from("premium_listings")
      .select(SELECT_LEGACY)
      .in("hall_id", hallIds)
      .order("end_date", { ascending: false }));
  }

  if (error) { handleError("fetchOwnerPremiumListings", error); return []; }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any): PremiumListing => ({
    id:         row.id,
    hall_id:    row.hall_id,
    hall_name:  row.halls?.name ?? "Hall",
    hall_slug:  row.halls?.slug ?? "",
    plan_slug:  (row.plan_slug ?? "premium") as PremiumListing["plan_slug"],
    start_date: row.start_date,
    end_date:   row.end_date,
    amount:     Number(row.amount),
    is_active:  row.is_active,
  }));
}

// ── Dashboard stats ───────────────────────────────────────────────────────────

export async function fetchOwnerStats(
  ownerId: string,
  hallIds: string[],
): Promise<OwnerStats> {
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Hall counts by status
  const { data: halls } = await db
    .from("halls")
    .select("status")
    .eq("owner_id", ownerId);

  const totalHalls    = (halls ?? []).length;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const approvedHalls = (halls ?? []).filter((h: any) => h.status === "approved").length;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pendingHalls  = (halls ?? []).filter((h: any) => h.status === "pending_approval").length;

  if (hallIds.length === 0) {
    return { totalHalls, approvedHalls, pendingHalls, pendingBookings: 0, confirmedBookings: 0, totalRevenue: 0 };
  }

  // Booking counts + revenue
  const { data: bookings } = await db
    .from("bookings")
    .select("status, total_amount")
    .in("hall_id", hallIds)
    .in("status", ["booking_requested", "owner_confirmed", "completed"]);

  const pendingBookings   = (bookings ?? []).filter((b: { status: string }) => b.status === "booking_requested").length;
  const confirmedBookings = (bookings ?? []).filter((b: { status: string }) => ["owner_confirmed", "completed"].includes(b.status)).length;
  const totalRevenue      = (bookings ?? [])
    .filter((b: { status: string }) => ["owner_confirmed", "completed"].includes(b.status))
    .reduce((sum: number, b: { total_amount: string | number }) => sum + Number(b.total_amount), 0);

  return { totalHalls, approvedHalls, pendingHalls, pendingBookings, confirmedBookings, totalRevenue };
}

// ── Slug generation ───────────────────────────────────────────────────────────

export function generateSlug(name: string, city: string): string {
  const raw = `${name} ${city}`
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
    .replace(/\s+/g, "-");
  return raw || "hall";
}
