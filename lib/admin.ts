// Server-side data layer for the admin dashboard.
// All queries use getSupabaseServerClient() (session-aware, anon key).
// RLS policies all include `or public.is_admin()` exceptions, so admin sessions
// have full read access. The admin client (admin.ts) is reserved for webhooks
// and background jobs — using it here would lose the auth.uid() audit trail.

import { getSupabaseServerClient } from "@/lib/supabase/server";

// ── Types ─────────────────────────────────────────────────────────────────────

export type AdminUserRow = {
  id:         string;
  full_name:  string | null;
  email:      string | null;
  phone:      string | null;
  role:       string;
  is_active:  boolean;
  created_at: string;
};

export type AdminOwnerRow = {
  id:             string; // hall_owners.id
  profile_id:     string;
  full_name:      string | null;
  email:          string | null;
  business_name:  string;
  business_email: string | null;
  business_phone: string | null;
  gst_number:     string | null;
  pan_number:     string | null;
  payout_upi:     string | null;
  city:           string | null;
  state:          string | null;
  is_verified:    boolean;
  profile_role:   string;
  created_at:     string;
};

export type AdminHallRow = {
  id:             string;
  slug:           string;
  name:           string;
  city:           string;
  state:          string | null;
  status:         string;
  is_premium:     boolean;
  capacity_max:   number;
  price_per_day:  number;
  rating_average: number;
  rating_count:   number;
  cover_url:      string | null;
  owner_name:     string | null;
  owner_business: string | null;
  created_at:     string;
};

export type AdminBookingRow = {
  id:             string;
  hall_id:        string;
  hall_name:      string;
  customer_name:  string | null;
  customer_email: string | null;
  event_date:     string;
  slot:           string;
  total_amount:   number;
  status:         string;
  created_at:     string;
};

export type AdminPaymentRow = {
  id:                 string;
  booking_id:         string;
  amount:             number;
  currency:           string;
  status:             string;
  payment_method:     string | null;
  cashfree_order_id:  string | null;
  customer_email:     string | null;
  hall_name:          string;
  created_at:         string;
};

export type AdminCommissionRow = {
  id:                  string;
  booking_id:          string;
  hall_owner_id:       string | null;
  owner_business:      string | null;
  hall_name:           string;
  booking_amount:      number;
  commission_rate:     number;
  commission_amount:   number;
  owner_payout_amount: number;
  status:              string;
  created_at:          string;
};

export type AdminReviewRow = {
  id:                 string;
  hall_id:            string;
  hall_name:          string;
  customer_name:      string | null;
  rating:             number;
  title:              string | null;
  comment:            string | null;
  cleanliness_rating: number | null;
  value_rating:       number | null;
  location_rating:    number | null;
  service_rating:     number | null;
  is_visible:         boolean;
  created_at:         string;
};

export type AdminPremiumRow = {
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

export type AdminAdRow = {
  id:         string;
  title:      string;
  image_url:  string | null;
  target_url: string | null;
  placement:  string | null;
  status:     string;
  start_date: string | null;
  end_date:   string | null;
  amount:     number | null;
  advertiser_name: string | null;
  owner_business: string | null;
  hall_name:  string | null;
  created_at: string;
};

export type AdminTicketRow = {
  id:             string;
  user_id:        string;
  user_name:      string | null;
  user_email:     string | null;
  subject:        string;
  message:        string;
  category:       string | null;
  status:         string;
  priority:       string;
  admin_response: string | null;
  internal_notes: string | null;
  created_at:     string;
  updated_at:     string;
};

export type AdminStats = {
  users: {
    total:    number;
    customers: number;
    ownersPending: number;
    ownersApproved: number;
    admins:   number;
  };
  halls: {
    total:    number;
    approved: number;
    pending:  number;
    rejected: number;
    suspended: number;
  };
  bookings: {
    total:      number;
    requested:  number;
    confirmed:  number;
    completed:  number;
    cancelled:  number;
  };
  revenue: {
    grossBookings:  number;
    commission:     number;
    ownerPayouts:   number;
  };
  open: {
    pendingHalls:   number;
    pendingOwners:  number;
    openTickets:    number;
    pendingAds:     number;
  };
};

// ── Error helper ──────────────────────────────────────────────────────────────

function handleError(fn: string, error: { code?: string; message: string }) {
  if (error.code === "PGRST205" || error.code === "42P01") {
    console.info(`[${fn}] table not provisioned yet — run supabase/migrations.`);
  } else {
    console.error(`[${fn}]`, error.message);
  }
}

// ── Dashboard stats ───────────────────────────────────────────────────────────

export async function fetchAdminStats(): Promise<AdminStats> {
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const empty: AdminStats = {
    users:    { total: 0, customers: 0, ownersPending: 0, ownersApproved: 0, admins: 0 },
    halls:    { total: 0, approved: 0, pending: 0, rejected: 0, suspended: 0 },
    bookings: { total: 0, requested: 0, confirmed: 0, completed: 0, cancelled: 0 },
    revenue:  { grossBookings: 0, commission: 0, ownerPayouts: 0 },
    open:     { pendingHalls: 0, pendingOwners: 0, openTickets: 0, pendingAds: 0 },
  };

  const [usersRes, hallsRes, bookingsRes, commissionsRes, ticketsRes, adsRes] = await Promise.all([
    db.from("profiles").select("role"),
    db.from("halls").select("status"),
    db.from("bookings").select("status, total_amount"),
    db.from("commissions").select("commission_amount, owner_payout_amount, status"),
    db.from("support_tickets").select("status"),
    db.from("advertisements").select("status"),
  ]);

  if (usersRes.error) { handleError("fetchAdminStats(users)", usersRes.error); return empty; }

  const roles = (usersRes.data ?? []) as { role: string }[];
  empty.users.total          = roles.length;
  empty.users.customers      = roles.filter((r) => r.role === "customer").length;
  empty.users.ownersPending  = roles.filter((r) => r.role === "owner_pending").length;
  empty.users.ownersApproved = roles.filter((r) => r.role === "owner_approved").length;
  empty.users.admins         = roles.filter((r) => r.role === "admin").length;

  const hallStatuses = (hallsRes.data ?? []) as { status: string }[];
  empty.halls.total     = hallStatuses.length;
  empty.halls.approved  = hallStatuses.filter((h) => h.status === "approved").length;
  empty.halls.pending   = hallStatuses.filter((h) => h.status === "pending_approval").length;
  empty.halls.rejected  = hallStatuses.filter((h) => h.status === "rejected").length;
  empty.halls.suspended = hallStatuses.filter((h) => h.status === "suspended").length;

  const bookings = (bookingsRes.data ?? []) as { status: string; total_amount: number | string }[];
  empty.bookings.total     = bookings.length;
  empty.bookings.requested = bookings.filter((b) => b.status === "booking_requested").length;
  empty.bookings.confirmed = bookings.filter((b) => b.status === "owner_confirmed").length;
  empty.bookings.completed = bookings.filter((b) => b.status === "completed").length;
  empty.bookings.cancelled = bookings.filter((b) => b.status === "cancelled" || b.status === "owner_rejected").length;
  empty.revenue.grossBookings = bookings
    .filter((b) => ["owner_confirmed", "completed"].includes(b.status))
    .reduce((sum, b) => sum + Number(b.total_amount), 0);

  const commissions = (commissionsRes.data ?? []) as { commission_amount: number | string; owner_payout_amount: number | string }[];
  empty.revenue.commission   = commissions.reduce((s, c) => s + Number(c.commission_amount),   0);
  empty.revenue.ownerPayouts = commissions.reduce((s, c) => s + Number(c.owner_payout_amount), 0);

  empty.open.pendingHalls  = empty.halls.pending;
  // Owner joining approval was removed (migration 0019) — the hall is the only
  // approval gate, so there is never an owner waiting to be let in.
  empty.open.pendingOwners = 0;
  empty.open.openTickets   = ((ticketsRes.data ?? []) as { status: string }[])
    .filter((t) => t.status === "open" || t.status === "in_progress").length;
  empty.open.pendingAds    = ((adsRes.data ?? []) as { status: string }[])
    .filter((a) => a.status === "pending").length;

  return empty;
}

// ── Users ─────────────────────────────────────────────────────────────────────

export async function fetchAllUsers(roleFilter?: string): Promise<AdminUserRow[]> {
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  let query = db
    .from("profiles")
    .select("id, full_name, email, phone, role, is_active, created_at")
    .order("created_at", { ascending: false });

  if (roleFilter) query = query.eq("role", roleFilter);

  const { data, error } = await query;
  if (error) { handleError("fetchAllUsers", error); return []; }
  return (data ?? []) as AdminUserRow[];
}

// ── Owners ────────────────────────────────────────────────────────────────────

export async function fetchAllOwners(verifiedFilter?: "verified" | "unverified"): Promise<AdminOwnerRow[]> {
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  let query = db
    .from("hall_owners")
    // profiles!profile_id — hall_owners has TWO FKs to profiles (profile_id and
    // verified_by), so the embed must name which one, or PostgREST errors with
    // "more than one relationship was found" and the page shows no owners.
    .select("id, profile_id, business_name, business_email, business_phone, gst_number, pan_number, payout_upi, city, state, is_verified, created_at, profiles!profile_id(full_name, email, role)")
    .order("created_at", { ascending: false });

  if (verifiedFilter === "verified")   query = query.eq("is_verified", true);
  if (verifiedFilter === "unverified") query = query.eq("is_verified", false);

  const { data, error } = await query;
  if (error) { handleError("fetchAllOwners", error); return []; }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any): AdminOwnerRow => ({
    id:             row.id,
    profile_id:     row.profile_id,
    full_name:      row.profiles?.full_name ?? null,
    email:          row.profiles?.email     ?? null,
    profile_role:   row.profiles?.role      ?? "unknown",
    business_name:  row.business_name,
    business_email: row.business_email ?? null,
    business_phone: row.business_phone ?? null,
    gst_number:     row.gst_number     ?? null,
    pan_number:     row.pan_number     ?? null,
    payout_upi:     row.payout_upi     ?? null,
    city:           row.city           ?? null,
    state:          row.state          ?? null,
    is_verified:    row.is_verified,
    created_at:     row.created_at,
  }));
}

// Also return owner_pending profiles that haven't created a hall_owners row yet
export async function fetchPendingOwnerProfiles(): Promise<AdminUserRow[]> {
  return fetchAllUsers("owner_pending");
}

// ── Halls ─────────────────────────────────────────────────────────────────────

export async function fetchAllHalls(statusFilter?: string): Promise<AdminHallRow[]> {
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  let query = db
    .from("halls")
    // profiles!profile_id — see fetchAllOwners: the hall_owners→profiles embed
    // is ambiguous (profile_id vs verified_by) and must be disambiguated.
    .select("id, slug, name, city, state, status, is_premium, capacity_max, price_per_day, rating_average, rating_count, created_at, hall_images(url, is_cover), hall_owners(business_name, profiles!profile_id(full_name))")
    .order("created_at", { ascending: false });

  if (statusFilter) query = query.eq("status", statusFilter);

  const { data, error } = await query;
  if (error) { handleError("fetchAllHalls", error); return []; }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any): AdminHallRow => {
    const imgs: { url: string; is_cover: boolean }[] = row.hall_images ?? [];
    const coverUrl = imgs.find((i) => i.is_cover)?.url ?? imgs[0]?.url ?? null;
    return {
      id:             row.id,
      slug:           row.slug,
      name:           row.name,
      city:           row.city,
      state:          row.state ?? null,
      status:         row.status,
      is_premium:     row.is_premium,
      capacity_max:   row.capacity_max,
      price_per_day:  Number(row.price_per_day),
      rating_average: Number(row.rating_average),
      rating_count:   row.rating_count,
      cover_url:      coverUrl,
      owner_name:     row.hall_owners?.profiles?.full_name ?? null,
      owner_business: row.hall_owners?.business_name      ?? null,
      created_at:     row.created_at,
    };
  });
}

// ── Bookings ──────────────────────────────────────────────────────────────────

export async function fetchAllBookings(statusFilter?: string): Promise<AdminBookingRow[]> {
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  let query = db
    .from("bookings")
    .select("id, hall_id, event_date, slot, total_amount, status, created_at, halls(name), profiles!bookings_customer_id_fkey(full_name, email)")
    .order("created_at", { ascending: false })
    .limit(200);

  if (statusFilter) query = query.eq("status", statusFilter);

  const { data, error } = await query;
  if (error) { handleError("fetchAllBookings", error); return []; }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any): AdminBookingRow => ({
    id:             row.id,
    hall_id:        row.hall_id,
    hall_name:      row.halls?.name ?? "Hall",
    customer_name:  row.profiles?.full_name ?? null,
    customer_email: row.profiles?.email     ?? null,
    event_date:     row.event_date,
    slot:           row.slot,
    total_amount:   Number(row.total_amount),
    status:         row.status,
    created_at:     row.created_at,
  }));
}

// ── Payments ──────────────────────────────────────────────────────────────────

export async function fetchAllPayments(statusFilter?: string): Promise<AdminPaymentRow[]> {
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  let query = db
    .from("payments")
    .select("id, booking_id, amount, currency, status, payment_method, cashfree_order_id, created_at, bookings(halls(name), profiles!bookings_customer_id_fkey(email))")
    .order("created_at", { ascending: false })
    .limit(200);

  if (statusFilter) query = query.eq("status", statusFilter);

  const { data, error } = await query;
  if (error) { handleError("fetchAllPayments", error); return []; }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any): AdminPaymentRow => ({
    id:                row.id,
    booking_id:        row.booking_id,
    amount:            Number(row.amount),
    currency:          row.currency ?? "INR",
    status:            row.status,
    payment_method:    row.payment_method    ?? null,
    cashfree_order_id: row.cashfree_order_id ?? null,
    customer_email:    row.bookings?.profiles?.email ?? null,
    hall_name:         row.bookings?.halls?.name     ?? "Hall",
    created_at:        row.created_at,
  }));
}

// ── Commissions ───────────────────────────────────────────────────────────────

export type CommissionFilters = {
  status?: string;          // commission_status enum
  ownerId?: string;         // hall_owners.id
  from?: string;            // YYYY-MM-DD (inclusive)
  to?:   string;            // YYYY-MM-DD (inclusive — converted to < to+1d)
};

export async function fetchAllCommissions(
  filters: CommissionFilters = {},
): Promise<AdminCommissionRow[]> {
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  let query = db
    .from("commissions")
    .select("id, booking_id, hall_id, hall_owner_id, booking_amount, commission_rate, commission_amount, owner_payout_amount, status, created_at, bookings(halls(name)), hall_owners(business_name)")
    .order("created_at", { ascending: false })
    .limit(500);

  if (filters.status)  query = query.eq("status", filters.status);
  if (filters.ownerId) query = query.eq("hall_owner_id", filters.ownerId);

  // Date filter on created_at. We treat `to` as inclusive of the whole day.
  if (filters.from) query = query.gte("created_at", `${filters.from}T00:00:00`);
  if (filters.to) {
    // Inclusive end-of-day in local-ish UTC; ok for admin reporting precision.
    const next = new Date(filters.to + "T00:00:00Z");
    next.setUTCDate(next.getUTCDate() + 1);
    query = query.lt("created_at", next.toISOString());
  }

  const { data, error } = await query;
  if (error) { handleError("fetchAllCommissions", error); return []; }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any): AdminCommissionRow => ({
    id:                  row.id,
    booking_id:          row.booking_id,
    hall_owner_id:       row.hall_owner_id ?? null,
    owner_business:      row.hall_owners?.business_name ?? null,
    hall_name:           row.bookings?.halls?.name      ?? "Hall",
    booking_amount:      Number(row.booking_amount),
    commission_rate:     Number(row.commission_rate),
    commission_amount:   Number(row.commission_amount),
    owner_payout_amount: Number(row.owner_payout_amount),
    status:              row.status,
    created_at:          row.created_at,
  }));
}

export type AdminCommissionPaymentRow = {
  id:             string;
  commission_id:  string;
  owner_business: string | null;
  hall_name:      string;
  booking_id:     string | null;
  amount:         number;
  upi_reference:  string | null;
  screenshot_url: string | null;
  status:         string;
  submitted_at:   string;
  admin_note:     string | null;
};

/** Owner UPI payment submissions for admin verification. Defaults to the ones
 *  awaiting a decision; pass `all` to include verified/rejected history. */
export async function fetchCommissionPaymentSubmissions(
  scope: "open" | "all" = "open",
): Promise<AdminCommissionPaymentRow[]> {
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  let query = db
    .from("owner_commission_payments")
    .select("id, commission_id, owner_id, amount, upi_reference, screenshot_url, status, submitted_at, admin_note, hall_owners(business_name), commissions(booking_id, bookings(halls(name)))")
    .order("submitted_at", { ascending: false })
    .limit(300);

  if (scope === "open") query = query.in("status", ["payment_submitted", "payment_under_review"]);

  const { data, error } = await query;
  if (error) { handleError("fetchCommissionPaymentSubmissions", error); return []; }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any): AdminCommissionPaymentRow => ({
    id:             row.id,
    commission_id:  row.commission_id,
    owner_business: row.hall_owners?.business_name ?? null,
    hall_name:      row.commissions?.bookings?.halls?.name ?? "Hall",
    booking_id:     row.commissions?.booking_id ?? null,
    amount:         Number(row.amount),
    upi_reference:  row.upi_reference ?? null,
    screenshot_url: row.screenshot_url ?? null,
    status:         row.status,
    submitted_at:   row.submitted_at,
    admin_note:     row.admin_note ?? null,
  }));
}

export type AdminSettlementAdjustmentRow = {
  id:             string;
  owner_business: string | null;
  booking_id:     string | null;
  commission_id:  string;
  amount:         number;
  reason:         string | null;
  status:         string;
  applied_at:     string;
};

/** Owner settlement adjustment history for the admin dashboard. */
export async function fetchSettlementAdjustments(): Promise<AdminSettlementAdjustmentRow[]> {
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data, error } = await db
    .from("owner_settlement_adjustments")
    .select("id, booking_id, commission_id, amount, reason, status, applied_at, hall_owners(business_name)")
    .order("applied_at", { ascending: false })
    .limit(300);
  if (error) { handleError("fetchSettlementAdjustments", error); return []; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any): AdminSettlementAdjustmentRow => ({
    id:             row.id,
    owner_business: row.hall_owners?.business_name ?? null,
    booking_id:     row.booking_id ?? null,
    commission_id:  row.commission_id,
    amount:         Number(row.amount),
    reason:         row.reason ?? null,
    status:         row.status,
    applied_at:     row.applied_at,
  }));
}

// Minimal owner list for the commission filter dropdown.
export async function fetchOwnerOptions(): Promise<{ id: string; business_name: string }[]> {
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data, error } = await db
    .from("hall_owners")
    .select("id, business_name")
    .order("business_name", { ascending: true });
  if (error) { handleError("fetchOwnerOptions", error); return []; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []) as { id: string; business_name: string }[];
}

// ── Reviews ───────────────────────────────────────────────────────────────────

export async function fetchAllReviews(visibilityFilter?: "visible" | "hidden"): Promise<AdminReviewRow[]> {
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const SELECT_FULL   = "id, hall_id, rating, title, comment, cleanliness_rating, value_rating, location_rating, service_rating, is_visible, created_at, halls(name), profiles(full_name)";
  const SELECT_LEGACY = "id, hall_id, rating, comment, is_visible, created_at, halls(name), profiles(full_name)";

  const run = (sel: string) => {
    let q = db.from("reviews").select(sel).order("created_at", { ascending: false }).limit(200);
    if (visibilityFilter === "visible") q = q.eq("is_visible", true);
    if (visibilityFilter === "hidden")  q = q.eq("is_visible", false);
    return q;
  };

  let { data, error } = await run(SELECT_FULL);
  if (error?.code === "42703") {
    ({ data, error } = await run(SELECT_LEGACY));
  }
  if (error) { handleError("fetchAllReviews", error); return []; }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any): AdminReviewRow => ({
    id:                 row.id,
    hall_id:            row.hall_id,
    hall_name:          row.halls?.name ?? "Hall",
    customer_name:      row.profiles?.full_name ?? null,
    rating:             row.rating,
    title:              row.title   ?? null,
    comment:            row.comment ?? null,
    cleanliness_rating: row.cleanliness_rating != null ? Number(row.cleanliness_rating) : null,
    value_rating:       row.value_rating       != null ? Number(row.value_rating)       : null,
    location_rating:    row.location_rating    != null ? Number(row.location_rating)    : null,
    service_rating:     row.service_rating     != null ? Number(row.service_rating)     : null,
    is_visible:         row.is_visible,
    created_at:         row.created_at,
  }));
}

// ── Premium listings ──────────────────────────────────────────────────────────

export async function fetchAllPremium(): Promise<AdminPremiumRow[]> {
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const SELECT_WITH_PLAN = "id, hall_id, plan_slug, start_date, end_date, amount, is_active, halls(name, slug)";
  const SELECT_LEGACY    = SELECT_WITH_PLAN.replace(", plan_slug", "");

  let { data, error } = await db
    .from("premium_listings")
    .select(SELECT_WITH_PLAN)
    .order("end_date", { ascending: false })
    .limit(200);

  if (error?.code === "42703") {
    ({ data, error } = await db
      .from("premium_listings")
      .select(SELECT_LEGACY)
      .order("end_date", { ascending: false })
      .limit(200));
  }

  if (error) { handleError("fetchAllPremium", error); return []; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any): AdminPremiumRow => ({
    id:         row.id,
    hall_id:    row.hall_id,
    hall_name:  row.halls?.name ?? "Hall",
    hall_slug:  row.halls?.slug ?? "",
    plan_slug:  (row.plan_slug ?? "premium") as AdminPremiumRow["plan_slug"],
    start_date: row.start_date,
    end_date:   row.end_date,
    amount:     Number(row.amount),
    is_active:  row.is_active,
  }));
}

// Lightweight hall lookup for the admin "create premium listing" form.
export async function fetchHallOptionsForPremium(): Promise<{ id: string; name: string; slug: string }[]> {
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data, error } = await db
    .from("halls")
    .select("id, name, slug, status")
    .eq("status", "approved")
    .order("name", { ascending: true })
    .limit(500);
  if (error) { handleError("fetchHallOptionsForPremium", error); return []; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => ({ id: r.id as string, name: r.name as string, slug: r.slug as string }));
}

// ── Advertisements ────────────────────────────────────────────────────────────

export async function fetchAllAds(statusFilter?: string): Promise<AdminAdRow[]> {
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const SELECT_FULL =
    "id, title, image_url, target_url, placement, status, start_date, end_date, amount, advertiser_name, created_at, hall_owners(business_name), halls(name)";
  const SELECT_LEGACY = SELECT_FULL.replace(", advertiser_name", "");

  const run = (selection: string) => {
    let q = db
      .from("advertisements")
      .select(selection)
      .order("created_at", { ascending: false })
      .limit(200);
    if (statusFilter) q = q.eq("status", statusFilter);
    return q;
  };

  let { data, error } = await run(SELECT_FULL);
  if (error?.code === "42703") {
    ({ data, error } = await run(SELECT_LEGACY));
  }
  if (error) { handleError("fetchAllAds", error); return []; }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any): AdminAdRow => ({
    id:              row.id,
    title:           row.title,
    image_url:       row.image_url  ?? null,
    target_url:      row.target_url ?? null,
    placement:       row.placement  ?? null,
    status:          row.status,
    start_date:      row.start_date ?? null,
    end_date:        row.end_date   ?? null,
    amount:          row.amount != null ? Number(row.amount) : null,
    advertiser_name: row.advertiser_name ?? null,
    owner_business:  row.hall_owners?.business_name ?? null,
    hall_name:       row.halls?.name ?? null,
    created_at:      row.created_at,
  }));
}

// ── Support tickets ───────────────────────────────────────────────────────────

export async function fetchAllTickets(statusFilter?: string): Promise<AdminTicketRow[]> {
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const SELECT_FULL   = "id, user_id, subject, message, category, status, priority, admin_response, internal_notes, created_at, updated_at, profiles!support_tickets_user_id_fkey(full_name, email)";
  const SELECT_LEGACY = "id, user_id, subject, message, category, status, priority, admin_response, created_at, updated_at, profiles!support_tickets_user_id_fkey(full_name, email)";

  const run = (sel: string) => {
    let q = db.from("support_tickets").select(sel).order("created_at", { ascending: false }).limit(200);
    if (statusFilter) q = q.eq("status", statusFilter);
    return q;
  };

  let { data, error } = await run(SELECT_FULL);
  if (error?.code === "42703") {
    ({ data, error } = await run(SELECT_LEGACY));
  }
  if (error) { handleError("fetchAllTickets", error); return []; }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any): AdminTicketRow => ({
    id:             row.id,
    user_id:        row.user_id,
    user_name:      row.profiles?.full_name ?? null,
    user_email:     row.profiles?.email     ?? null,
    subject:        row.subject,
    message:        row.message,
    category:       row.category ?? null,
    status:         row.status,
    priority:       row.priority,
    admin_response: row.admin_response ?? null,
    internal_notes: row.internal_notes ?? null,
    created_at:     row.created_at,
    updated_at:     row.updated_at,
  }));
}
