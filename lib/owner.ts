// Server-side data layer for the hall-owner dashboard.
// All queries use getSupabaseServerClient() (session-aware, anon key).
// RLS is the primary security enforcer — every write also checks
// owns_hall() or owns_owner_row() at the DB level.

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { readHallCommissionRate, readHallCommissionRates } from "@/lib/hall-commission";
import { toBookingMode, type BookingMode } from "@/lib/booking-mode";

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
  /** Bank payout destination. Owner-supplied, but no longer owner-WRITABLE:
   *  migration 0068 revoked the `authenticated` UPDATE grant on these columns
   *  because under Payouts they are the destination of real money. */
  payout_account_holder: string | null;
  payout_account_number: string | null;
  payout_ifsc:           string | null;
  /** Cashfree PAYOUTS beneficiary state. Only VERIFIED can be paid. */
  payout_beneficiary_id:         string | null;
  payout_beneficiary_status:     string | null;
  payout_beneficiary_last_error: string | null;
  /** Cashfree Easy Split vendor state — legacy, retained only so historical
   *  rows still read. Nothing dispatches money from these any more. */
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
  /** NULL only for a LEAD_GENERATION venue that publishes no price. */
  price_per_day:  number | null;
  booking_mode:   BookingMode;
  status:         string; // hall_status enum
  is_premium:     boolean;
  rating_average: number;
  rating_count:   number;
  cover_url:      string | null;
  image_count:    number;
  created_at:     string;
  /** Admin's written reason when the hall was rejected or suspended (0025). */
  rejection_reason: string | null;
  /**
   * The Hallnect commission this hall gives, or null when never configured.
   * Merged in from a service-role read — the column is hidden from the session
   * client this query uses (migration 0072).
   */
  commission_rate: number | null;
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
  /** Event types this venue serves (0037). Drives the category filters. */
  venue_types:   string[];
  /**
   * The Hallnect commission this hall gives, or null when never configured.
   *
   * NOT part of the select() below, and it cannot be: migration 0072 hides
   * halls.commission_rate from `authenticated`, which is the role this
   * session-client read runs as. It is fetched separately through the service
   * role and merged in. Asking for it in the main select would fail the entire
   * query with 42501 and blank the owner's whole listing page.
   */
  commission_rate: number | null;
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

/**
 * Has Hallnect actually sent the owner the advance for this booking?
 *
 * DELIBERATELY NOT the same figure as RevenueBooking.payout_amount. That one
 * is the hall price less commission — most of which the venue collects itself
 * at the event. This is only the part that MOVES: the customer's advance minus
 * the commission retained from it.
 *
 * `amount` is whatever the payout run recorded in payments.split_owner_amount
 * and nothing else. It is never re-derived here: computeOwnerShare refuses to
 * guess a share it cannot compute precisely because a wrong payout figure is
 * worse than a missing one, and this screen would be quoting that guess back
 * to the person waiting for the money.
 */
export type AdvancePayout = {
  /** paid = the transfer is recorded as made. pending = not sent yet.
   *  refunding = a refund is owed or already sent, so this advance is the
   *  CUSTOMER's money and no payout is coming. */
  state:   "paid" | "pending" | "refunding";
  amount:  number | null;
  /** Only an Easy Split payout stamps split_at. A transfer an admin made by
   *  hand records the reference but no timestamp, so this is null and the UI
   *  must not print a date it does not have. */
  paid_at: string | null;
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
  /** Null when no successful gateway payment funded this booking — there is
   *  no advance to transfer, so there is nothing to say about a payout. */
  advance_payout: AdvancePayout | null;
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
  /**
   * 'complimentary' when Hallnect granted this at no charge.
   *
   * The owner's screen must not print a price they never paid — and must not
   * offer to cancel a subscription that does not exist. Defaults to 'paid' for
   * rows written before migration 0091 and on the legacy-select path.
   */
  grant_type: "paid" | "complimentary";
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
/**
 * Does this owner have any venue that takes payment through Hallnect?
 *
 * WHY THIS EXISTS: a payout account is only ever needed by a DIRECT_BOOKING
 * venue. Under that mode the customer pays the advance to Hallnect, which then
 * transfers the owner's share — so there has to be a destination. A
 * LEAD_GENERATION venue is the opposite flow end to end: the customer contacts
 * the venue and pays the venue directly, and the OWNER later pays Hallnect its
 * commission. No money ever travels toward the owner, so there is nothing to
 * pay out and no account to ask for.
 *
 * Asking anyway is not merely a redundant field. It is asking a stranger for
 * their bank account, their PAN and their account-holder name for a purpose
 * that does not exist, on the first screen they see — which is both a privacy
 * cost we have no justification for and the sort of thing that makes a venue
 * owner close the tab.
 *
 * EVERY STATUS COUNTS, not just approved. An owner whose direct-booking hall is
 * still in review will need a payout account the moment it goes live, and
 * discovering that at the first booking is too late.
 *
 * Returns false when the owner has no halls at all: at that point nothing is
 * known about how they intend to sell, and the honest thing is to ask once
 * there is something to be paid for.
 */
export type PayoutNeed = {
  /** True when at least one venue takes payment through Hallnect. */
  takesOnlinePayments: boolean;
  /** How many venues this owner has at all, in ANY status. Lets the caller tell
   *  "your venues take enquiries" from "you have no venues yet", which are
   *  different sentences and only one of them is ever true. */
  hallCount: number;
};

export async function ownerTakesOnlinePayments(): Promise<PayoutNeed> {
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { takesOnlinePayments: false, hallCount: 0 };

  const { data: owner } = await db
    .from("hall_owners").select("id").eq("profile_id", user.id).maybeSingle();
  if (!owner?.id) return { takesOnlinePayments: false, hallCount: 0 };

  // Modes only — no other column, because this runs on every profile render.
  // RLS (owns_hall) already scopes it to this owner; the explicit owner_id is
  // defence in depth, matching the rest of this file.
  const { data, error } = await db
    .from("halls")
    .select("booking_mode")
    .eq("owner_id", owner.id);

  // A failed read must not HIDE the payout form from somebody who needs it:
  // an owner who cannot see the field cannot get paid, which is worse than an
  // owner seeing a field they do not need. Fails toward showing it.
  if (error) {
    handleError("ownerTakesOnlinePayments", error);
    return { takesOnlinePayments: true, hallCount: 0 };
  }

  const rows = (data ?? []) as { booking_mode: string | null }[];
  return {
    takesOnlinePayments: rows.some((r) => toBookingMode(r.booking_mode) === "DIRECT_BOOKING"),
    hallCount: rows.length,
  };
}

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
    .select("id, profile_id, business_name, business_email, business_phone, gst_number, pan_number, address, city, state, payout_upi, payout_account_holder, payout_account_number, payout_ifsc, payout_beneficiary_id, payout_beneficiary_status, payout_beneficiary_last_error, is_verified, cashfree_vendor_id, vendor_kyc_status, vendor_last_error")
    .eq("profile_id", user.id)
    .maybeSingle();

  if (error) { handleError("fetchOwnerRow", error); return null; }
  if (!data) return null;

  return data as OwnerRow;
}

// ── Fetch halls for this owner ────────────────────────────────────────────────

// RLS: owns_hall(id) — owner can read all their halls regardless of status.
//
// THROWS ON A QUERY ERROR, AND THAT IS DELIBERATE. This is the root of the
// owner dashboard: the hall ids it returns feed fetchOwnerBookings,
// fetchOwnerRevenue, fetchOwnerCommissions, fetchOwnerPremiumListings and
// fetchOwnerStats, and every one of them opens with `if (hallIds.length === 0)
// return []`. So returning [] on failure short-circuited all six screens before
// their queries were even issued, and produced a perfectly self-consistent "you
// have nothing" — an owner with a live, approved, booked venue shown the
// new-owner empty state and an "Add your first hall" prompt, with no error
// anywhere. The realistic response to that is to list the venue again.
//
// A throw reaches app/error.tsx, which says we hit an error and offers a retry
// and a reference. "We could not load this" is worth far more to an owner than
// a confident, wrong "you have no halls", and no caller has to be taught the
// difference.
export async function fetchOwnerHalls(ownerId: string): Promise<OwnerHall[]> {
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data, error } = await db
    .from("halls")
    .select("id, slug, name, city, state, capacity_max, price_per_day, booking_mode, status, is_premium, rating_average, rating_count, created_at, rejection_reason, hall_images(url, is_cover)")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false });

  if (error) {
    handleError("fetchOwnerHalls", error);
    // The message is deliberately generic: Next replaces it in production
    // anyway, and the redacted detail is already in the server log above.
    throw new Error("Could not load your venues.");
  }

  // One batched service-role read for the whole list, not one per hall.
  const rates = await readHallCommissionRates(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (data ?? []).map((r: any) => r.id as string),
  );

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
      // Number(null) is 0 and a Rs.0 venue reads as free. Keep it null.
      price_per_day:  row.price_per_day == null ? null : Number(row.price_per_day),
      booking_mode:   toBookingMode(row.booking_mode),
      status:         row.status,
      is_premium:     row.is_premium,
      rating_average: Number(row.rating_average),
      rating_count:   row.rating_count,
      cover_url:      coverUrl,
      created_at:     row.created_at,
      rejection_reason: row.rejection_reason ?? null,
      commission_rate: rates.get(row.id) ?? null,
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
    .select("id, slug, name, city, state, address, pincode, latitude, longitude, capacity_min, capacity_max, price_per_day, price_morning, price_evening, booking_mode, description, status, is_premium, rating_average, rating_count, created_at, rejection_reason, venue_types, hall_images(url, is_cover), hall_amenities(amenity_id), hall_custom_amenities(name, sort_order)")
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
    price_per_day:  data.price_per_day == null ? null : Number(data.price_per_day),
    booking_mode:   toBookingMode(data.booking_mode),
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
    venue_types:    Array.isArray(data.venue_types) ? data.venue_types : [],
    // Service-role read: the column is hidden from this session client. One
    // extra query on a single-hall page, which is the price of the column not
    // being visible to the customer role that also holds `authenticated`.
    commission_rate: await readHallCommissionRate(data.id),
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
//
// fetchHallAvailability WAS HERE. It read raw availability rows for the owner's
// hand-maintained grid, which no longer exists. The owner calendar is derived
// from the records that actually create a claim — see lib/owner-calendar.ts.

/**
 * Booking statuses at which the customer's phone number is the venue's to have.
 *
 * Everything here means the customer either paid or asked the venue to act.
 * pending_payment does NOT: the row exists because checkout was opened, which
 * is not a relationship with the venue. Terminal failure states are excluded
 * for the same reason — a checkout that expired or was cancelled before
 * payment never became a booking, and the number should not outlive it.
 */
const PHONE_VISIBLE_STATUSES = new Set([
  "payment_success",
  "booking_requested",
  "owner_confirmed",
  "completed",
  // Cancelled and refunded AFTER money moved: the venue may genuinely need to
  // reach the customer about a date they had held, so the number stays.
  "cancelled",
  "refunded",
  "owner_rejected",
]);

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
    .select("id, hall_id, event_date, end_date, slot, guest_count, base_amount, total_amount, status, customer_notes, owner_notes, cancel_reason, created_at, contact_phone, owner_response_due_at, halls(name, slug), payments(amount, advance_amount, status)")
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
    // THE NUMBER IS RELEASED WHEN THE BOOKING BECOMES REAL, NOT WHEN CHECKOUT
    // STARTS. A bookings row exists with the customer's typed contact_phone
    // from the moment they open checkout — before any money moves and before
    // the request is ever put to the venue. The dashboard rendered that as a
    // clickable tel: link on a card badged "Payment Pending", so a customer who
    // got as far as the payment page and changed their mind had handed the
    // venue their phone number. Abandoned checkouts then sit there until the
    // expiry cron runs, hours later.
    //
    // The lead flow already draws this line correctly — a customer's number
    // reaches the venue only after OTP verification, and the venue's number
    // reaches the customer only once the lead is pending (lib/leads.ts). The
    // booking flow simply never had the equivalent gate. This is it.
    //
    // Withheld rather than the row hidden: the owner still needs to see that a
    // date is being held, and hiding the booking entirely would make the
    // calendar lie.
    contact_phone:  PHONE_VISIBLE_STATUSES.has(String(row.status)) ? (row.contact_phone ?? null) : null,
    owner_response_due_at: row.owner_response_due_at ?? null,
    // Only a gateway-verified payment counts as money received — and only its
    // ADVANCE portion. payments.amount now includes the customer's ₹200
    // platform fee, which is Hallnect's and is NOT a rupee toward the hall
    // total; counting it here understated "balance at venue" by ₹200 on every
    // online-paid booking. Legacy rows have no advance_amount and their amount
    // WAS the advance, so the fallback keeps them correct.

    amount_paid: (row.payments ?? [])
      .filter((p: any) => p?.status === "payment_success")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .reduce((sum: number, p: any) => sum + Number(p.advance_amount ?? p.amount ?? 0), 0),
  }));
}

// ── Fetch revenue (confirmed + completed bookings) ────────────────────────────

// A refund in flight means the advance belongs to the customer again — the
// same three states payOwnerOnAcceptance and fetchStuckPayouts refuse to pay
// out on. Without this the screen would tell an owner they are "awaiting
// transfer" for money that is on its way back to the person who paid it.
const REFUND_IN_FLIGHT = new Set(["owed", "processing", "completed"]);

/** The payout state of the payment that funded a booking, or null if none did. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapAdvancePayout(row: any): AdvancePayout | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payments: any[] = Array.isArray(row.payments) ? row.payments : [];
  const paid = payments.find((p) => p?.status === "payment_success") ?? null;
  if (!paid) return null;

  if (REFUND_IN_FLIGHT.has(String(paid.refund_state ?? "none"))) {
    return { state: "refunding", amount: null, paid_at: null };
  }

  const amount = paid.split_owner_amount == null ? null : Number(paid.split_owner_amount);

  // 'done' is the ONLY value that means the money left, and it is written by
  // both routes that can send it: an Easy Split dispatch, and an admin
  // recording a transfer they made by hand (markPayoutSettledManually).
  // Everything else — 'none' (never attempted), 'not_applicable' (the payout
  // ran while Easy Split was switched off, so a person has to send it),
  // 'pending', 'failed' — means one thing to the owner: not sent yet. Which of
  // them it is, and why, is Hallnect's problem to fix, so split_error is
  // deliberately not surfaced to the owner.
  return String(paid.split_status ?? "none") === "done"
    ? { state: "paid",    amount, paid_at: paid.split_at ?? null }
    : { state: "pending", amount, paid_at: null };
}

export async function fetchOwnerRevenue(hallIds: string[]): Promise<RevenueBooking[]> {
  if (hallIds.length === 0) return [];

  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // The payments embed is readable by the owner: payments_select admits
  // `owns_hall(b.hall_id)` for the booking.
  //
  // THE GRANT IS NO LONGER TABLE-WIDE, and this list depends on that. Migration
  // 0065 revoked table-level SELECT on payments — an owner could otherwise read
  // raw_response, which carries the customer's email — and re-granted a named
  // column list. Every column embedded below is in that list; adding one that
  // is not returns 42501 and blanks this page. Check 0065 before extending it.
  //
  // The split_* columns arrived in migration 0028, so a database that has not
  // run it yet falls back to the original column list rather than rendering an
  // empty revenue page.
  const SELECT_WITH_PAYOUT =
    "id, hall_id, event_date, slot, base_amount, total_amount, status, halls(name), commissions(owner_payout_amount), payments(status, refund_state, split_status, split_owner_amount, split_at)";
  const SELECT_LEGACY =
    "id, hall_id, event_date, slot, base_amount, total_amount, status, halls(name), commissions(owner_payout_amount)";

  let { data, error } = await db
    .from("bookings")
    .select(SELECT_WITH_PAYOUT)
    .in("hall_id", hallIds)
    .in("status", ["owner_confirmed", "completed"])
    .order("event_date", { ascending: false });

  if (error?.code === "42703") {
    ({ data, error } = await db
      .from("bookings")
      .select(SELECT_LEGACY)
      .in("hall_id", hallIds)
      .in("status", ["owner_confirmed", "completed"])
      .order("event_date", { ascending: false }));
  }

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
    advance_payout: mapAdvancePayout(row),
  }));
}

// ── Owner commissions ─────────────────────────────────────────────────────────
// Returns the commissions table rows for the owner's halls. RLS on the
// commissions table (migration 0007) restricts SELECT to `owns_hall(hall_id)`
// for non-admins, so even without the explicit hall_id filter here a malicious
// caller cannot read other owners' rows. The filter is defense in depth.

export type OwnerCommissionRow = {
  id:                  string;
  /** NULL on a LEAD commission — commissions_one_source (0073) guarantees that
   *  exactly one of booking_id and lead_id is set. */
  booking_id:          string | null;
  /** Set only on a LEAD commission. This is the one the owner actually OWES:
   *  a booking commission was already retained from the customer's advance. */
  lead_id:             string | null;
  hall_id:             string | null;
  hall_name:           string;
  /** Full hall price — the base the 2.5% commission is charged on. */
  booking_amount:      number;
  /** Gross advance the customer paid. 0 on very old rows written before the
   *  column existed. NOT the commission base: the rate applies to the hall
   *  price, and the commission is merely RETAINED out of this advance. */
  advance_amount:      number;
  commission_rate:     number;
  commission_amount:   number;
  owner_payout_amount: number;
  status:              string;
  created_at:          string;
  paid_at:             string | null;
  due_date:            string | null;
  settlement_adjustment_status: string | null;
};

export async function fetchOwnerCommissions(hallIds: string[]): Promise<OwnerCommissionRow[]> {
  if (hallIds.length === 0) return [];

  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // paid_at / settlement_adjustment_status exist after migration 0017. Fall
  // back gracefully if the migration has not run yet.
  //
  // halls!hall_id(name) is embedded ALONGSIDE the bookings join, not instead of
  // it. A lead commission has no booking, so `bookings(halls(name))` resolves to
  // null and every lead row would have rendered as the literal word "Hall".
  // commissions.hall_id carries its own FK (commissions_hall_id_fkey), so the
  // direct embed works for both shapes; the booking join stays as the fallback
  // for any historical row whose hall_id was never backfilled.
  const fullCols =
    "id, booking_id, lead_id, hall_id, booking_amount, advance_amount, commission_rate, commission_amount, owner_payout_amount, status, created_at, paid_at, settlement_adjustment_status, due_date, halls!hall_id(name), bookings(halls(name))";
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any): OwnerCommissionRow => ({
    id:                  row.id,
    booking_id:          row.booking_id ?? null,
    lead_id:             row.lead_id ?? null,
    hall_id:             row.hall_id ?? null,
    hall_name:           row.halls?.name ?? row.bookings?.halls?.name ?? "Hall",
    booking_amount:      Number(row.booking_amount),
    advance_amount:      row.advance_amount == null ? 0 : Number(row.advance_amount),
    commission_rate:     Number(row.commission_rate),
    commission_amount:   Number(row.commission_amount),
    owner_payout_amount: Number(row.owner_payout_amount),
    status:              row.status,
    created_at:          row.created_at,
    paid_at:             row.paid_at ?? null,
    due_date:            row.due_date ?? null,
    settlement_adjustment_status: row.settlement_adjustment_status ?? null,
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

  // grant_type is appended AFTER plan_slug so SELECT_LEGACY's replace() still
  // matches the exact ", plan_slug" substring it was written against.
  const SELECT_WITH_PLAN = "id, hall_id, plan_slug, start_date, end_date, amount, is_active, grant_type, halls(name, slug)";
  const SELECT_LEGACY    = SELECT_WITH_PLAN.replace(", plan_slug", "").replace(", grant_type", "");

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
    grant_type: (row.grant_type ?? "paid") as PremiumListing["grant_type"],
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

/**
 * The owner's halls that a premium plan can actually be bought for: approved,
 * and therefore visible to customers. Carries the current tier so the plan page
 * can say what each hall is already on, and offer a renewal rather than a
 * duplicate purchase.
 *
 * Deliberately NOT derived from fetchOwnerHalls: that returns every hall
 * regardless of status, and selling promotion for a pending or suspended
 * listing would be selling nothing.
 */
export async function fetchOwnerBuyableHalls(
  ownerId: string,
): Promise<{
  id: string;
  name: string;
  tier: string | null;
  /** A LIVE monthly mandate — the owner is actually being billed for this plan. */
  subscribedTo: string | null;
  /** A subscription that was STARTED but never authorised. Not a subscription. */
  pendingPlan: string | null;
}[]> {
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data, error } = await db
    .from("halls")
    .select("id, name, premium_tier")
    .eq("owner_id", ownerId)
    .eq("status", "approved")
    .order("name", { ascending: true });

  if (error) {
    // premium_tier arrived in migration 0013; fall back so a pre-migration
    // database still lists the halls rather than showing none.
    if (error.code === "42703") {
      const { data: legacy } = await db
        .from("halls")
        .select("id, name")
        .eq("owner_id", ownerId)
        .eq("status", "approved")
        .order("name", { ascending: true });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (legacy ?? []).map((r: any) => ({
        id: r.id, name: r.name, tier: null, subscribedTo: null, pendingPlan: null,
      }));
    }
    handleError("fetchOwnerBuyableHalls", error);
    return [];
  }

  // Which halls already have a LIVE monthly subscription. Without this the
  // plans page would offer "Subscribe" for a plan the owner is already paying
  // for every month, and the server would (correctly) refuse — an avoidable
  // dead end.
  const { data: subs } = await db
    .from("plan_subscriptions")
    .select("hall_id, plan_slug, status")
    .eq("owner_id", ownerId)
    .in("status", ["created", "active", "on_hold", "paused"]);

  // 'created' IS NOT SUBSCRIBED. It means the owner pressed Subscribe and a
  // mandate was opened at Cashfree — nothing has been authorised and nothing
  // has been charged. Treating it as a subscription told an owner "Subscribed —
  // renews monthly" the instant they clicked, and then hid the button, so they
  // could not even finish paying. The two facts are kept apart deliberately.
  const live    = new Map<string, string>();
  const pending = new Map<string, string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of (subs ?? []) as any[]) {
    if (row.status === "created") pending.set(row.hall_id, row.plan_slug);
    else                          live.set(row.hall_id, row.plan_slug);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => ({
    id:   r.id,
    name: r.name,
    tier: r.premium_tier ?? null,
    subscribedTo: live.get(r.id)    ?? null,
    pendingPlan:  pending.get(r.id) ?? null,
  }));
}
