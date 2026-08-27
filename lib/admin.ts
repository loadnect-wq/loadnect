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
  custom_amenities: string[];
  created_at:     string;
};

export type AdminBookingRow = {
  id:             string;
  hall_id:        string;
  hall_name:      string;
  customer_name:  string | null;
  customer_email: string | null;
  event_date:     string;
  end_date:       string;
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
  /** Gross advance the customer paid — the commission base. 0 on very old rows. */
  advance_amount:      number;
  commission_rate:     number;
  commission_amount:   number;
  owner_payout_amount: number;
  /** advance − commission: the owner's net advance settlement. */
  owner_net_advance:   number;
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
    grossAdvances:  number;
    commission:     number;
    platformFees:   number;
    netRevenue:     number;   // commission + platform fees
    ownerPayouts:   number;
    refunds:        number;
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
    revenue:  { grossBookings: 0, grossAdvances: 0, commission: 0, platformFees: 0, netRevenue: 0, ownerPayouts: 0, refunds: 0 },
    open:     { pendingHalls: 0, pendingOwners: 0, openTickets: 0, pendingAds: 0 },
  };

  const [usersRes, hallsRes, bookingsRes, commissionsRes, ticketsRes, adsRes, paymentsRes] = await Promise.all([
    db.from("profiles").select("role"),
    db.from("halls").select("status"),
    db.from("bookings").select("status, total_amount"),
    db.from("commissions").select("commission_amount, owner_payout_amount, advance_amount, status"),
    db.from("support_tickets").select("status"),
    db.from("advertisements").select("status"),
    // Platform fees + refunds live on payments (0031). select("*") keeps this
    // working on a pre-0031 database, where the columns simply come back absent.
    db.from("payments").select("*").in("status", ["payment_success", "refunded"]),
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

  const commissions = (commissionsRes.data ?? []) as {
    commission_amount: number | string; owner_payout_amount: number | string;
    advance_amount: number | string | null; status: string;
  }[];
  // Waived commissions were never earned — including them overstated revenue.
  empty.revenue.commission    = commissions
    .filter((c) => c.status !== "waived")
    .reduce((s, c) => s + Number(c.commission_amount), 0);
  empty.revenue.ownerPayouts  = commissions.reduce((s, c) => s + Number(c.owner_payout_amount), 0);
  empty.revenue.grossAdvances = commissions.reduce((s, c) => s + Number(c.advance_amount ?? 0), 0);

  const payments = (paymentsRes.data ?? []) as {
    status: string; amount: number | string;
    platform_fee_amount?: number | string | null; refund_amount?: number | string | null;
  }[];
  // Platform fees retained: every successful payment's fee counts; on refunded
  // payments the fee still counts UNLESS the refund returned the full charge
  // (platform-caused cancellations refund fee included — refund_amount equals
  // payments.amount there; policy refunds are advance-only and keep the fee).
  empty.revenue.platformFees = payments.reduce((s, p) => {
    const fee = Number(p.platform_fee_amount ?? 0);
    if (!fee) return s;
    if (p.status !== "refunded") return s + fee;
    const refunded = Number(p.refund_amount ?? 0);
    const fullRefund = refunded >= Number(p.amount) - 0.01;
    return s + (fullRefund ? 0 : fee);
  }, 0);
  empty.revenue.refunds    = payments.reduce((s, p) => s + Number(p.refund_amount ?? 0), 0);
  empty.revenue.netRevenue = empty.revenue.commission + empty.revenue.platformFees;

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
    .select("id, slug, name, city, state, status, is_premium, capacity_max, price_per_day, rating_average, rating_count, created_at, hall_images(url, is_cover), hall_owners(business_name, profiles!profile_id(full_name)), hall_custom_amenities(name, sort_order)")
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
      // Owner-defined amenities so the reviewer sees exactly what was submitted.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      custom_amenities: ((row.hall_custom_amenities ?? []) as any[])
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .map((c) => (c.name as string) ?? "")
        .filter(Boolean),
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
    .select("id, hall_id, event_date, end_date, slot, total_amount, status, created_at, halls(name), profiles!bookings_customer_id_fkey(full_name, email)")
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
    end_date:       row.end_date ?? row.event_date,
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

/**
 * Payouts that were attempted and did NOT reach the owner.
 *
 * These are real money stuck in Hallnect's account: the booking is confirmed,
 * the customer was charged, and the owner's share never left. The column has
 * always been written; nothing rendered it, so the failure was invisible until
 * an owner asked where their money was.
 */
export type StuckPayoutRow = {
  payment_id: string;
  booking_id: string;
  owner_amount: number;
  split_status: string;
  split_error: string | null;
  hall_name: string;
  created_at: string;
};

export async function fetchStuckPayouts(): Promise<StuckPayoutRow[]> {
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // THE QUESTION IS "WHOSE MONEY IS THIS", NOT "WHAT DOES split_status SAY".
  //
  // Filtering on split_status in (failed, pending) got BOTH halves wrong
  // against real data. It missed the money genuinely owed — a completed
  // booking whose payout was never even ATTEMPTED sits at split_status='none'
  // and so was invisible, which is exactly the case that exists today because
  // Easy Split is not yet enabled. And it showed money that is NOT owed — a
  // failed payout on a booking that was later cancelled, where the advance
  // belongs to the customer, not the venue.
  //
  // So: any successful payment, not yet paid out, whose BOOKING is still in a
  // payable state and which has no refund in flight.
  const { data, error } = await db
    .from("payments")
    .select("id, booking_id, amount, split_owner_amount, split_status, split_error, refund_state, advance_amount, created_at, bookings(status, halls(name))")
    .eq("status", "payment_success")
    .order("created_at", { ascending: false })
    .limit(200);

  // A missing column (pre-0031 database) must not break the payments page.
  if (error) { handleError("fetchStuckPayouts", error); return []; }

  const PAYABLE_BOOKING = new Set(["owner_confirmed", "completed"]);
  const REFUND_IN_FLIGHT = new Set(["owed", "processing", "completed"]);

  return ((data ?? []) as unknown[])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((row: any) => {
      if (String(row.split_status ?? "none") === "done") return false;
      // not_applicable = Easy Split switched off for the deployment; still owed
      // to the owner, and still worth showing, so it is NOT excluded here.
      if (REFUND_IN_FLIGHT.has(String(row.refund_state ?? "none"))) return false;
      return PAYABLE_BOOKING.has(String(row.bookings?.status ?? ""));
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((row: any): StuckPayoutRow => ({
      payment_id:   row.id,
      booking_id:   row.booking_id,
      // A payout never ATTEMPTED has no split_owner_amount, and a pre-0031 row
      // has no advance_amount either — so falling through to 0 would print
      // "Rs0 owed" over money that is genuinely outstanding. Fall back to the
      // captured amount, which overstates the owner's share by at most the
      // Rs200 fee but never understates it to nothing.
      owner_amount: Number(row.split_owner_amount ?? row.advance_amount ?? row.amount ?? 0),
      split_status: row.split_status ?? "none",
      split_error:  row.split_error ?? null,
      hall_name:    row.bookings?.halls?.name ?? "Hall",
      created_at:   row.created_at,
    }));
}

/**
 * Refunds the platform OWES or has in flight.
 *
 * refund_amount says what a cancellation decided a customer is due;
 * refund_state says whether it has actually been sent. Before this existed the
 * two were conflated and a cancelled booking simply read "refunded" while the
 * money was still sitting in Hallnect's account.
 */
export type RefundQueueRow = {
  payment_id:   string;
  booking_id:   string;
  amount:       number;
  state:        string;
  error:        string | null;
  refund_id:    string | null;
  hall_name:    string;
  event_date:   string | null;
  created_at:   string;
};

export async function fetchRefundQueue(): Promise<RefundQueueRow[]> {
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data, error } = await db
    .from("payments")
    .select("id, booking_id, refund_amount, refund_state, refund_error, cashfree_refund_id, created_at, bookings(event_date, halls(name))")
    .in("refund_state", ["owed", "processing", "failed"])
    .order("created_at", { ascending: false })
    .limit(100);

  // A missing column (pre-0033 database) must not break the payments page.
  if (error) { handleError("fetchRefundQueue", error); return []; }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any): RefundQueueRow => ({
    payment_id: row.id,
    booking_id: row.booking_id,
    amount:     Number(row.refund_amount ?? 0),
    state:      row.refund_state ?? "owed",
    error:      row.refund_error ?? null,
    refund_id:  row.cashfree_refund_id ?? null,
    hall_name:  row.bookings?.halls?.name ?? "Hall",
    event_date: row.bookings?.event_date ?? null,
    created_at: row.created_at,
  }));
}

/** Messages from the public /contact form. Reads via the session client, so
 *  RLS (is_admin) is the gate — a non-admin calling this gets an empty list. */
export type ContactMessageRow = {
  id: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  is_read: boolean;
  created_at: string;
};

export async function fetchContactMessages(limit = 100): Promise<ContactMessageRow[]> {
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data, error } = await db
    .from("contact_messages")
    .select("id, name, email, subject, message, is_read, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) { handleError("fetchContactMessages", error); return []; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []) as ContactMessageRow[];
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
    .select("id, booking_id, hall_id, hall_owner_id, booking_amount, advance_amount, commission_rate, commission_amount, owner_payout_amount, status, created_at, bookings(halls(name)), hall_owners(business_name)")
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
    advance_amount:      row.advance_amount == null ? 0 : Number(row.advance_amount),
    commission_rate:     Number(row.commission_rate),
    commission_amount:   Number(row.commission_amount),
    owner_payout_amount: Number(row.owner_payout_amount),
    owner_net_advance:   Math.max(
      0,
      Math.round(((row.advance_amount == null ? 0 : Number(row.advance_amount)) - Number(row.commission_amount)) * 100) / 100,
    ),
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

// ── Admin audit log (migration 0025) ─────────────────────────────────────────
// Append-only trail of privileged actions. Readable by admins only (RLS), and
// protected against modification by both RLS and a guard trigger — so what this
// returns is the authoritative record of what actually happened.

export type AdminAuditRow = {
  id:              string;
  actor_email:     string | null;
  action:          string;
  entity_type:     string;
  entity_id:       string | null;
  previous_status: string | null;
  new_status:      string | null;
  reason:          string | null;
  created_at:      string;
};

export type AuditLogPage = {
  rows:    AdminAuditRow[];
  total:   number;
  page:    number;
  pages:   number;
  /** True when migration 0025 has not been applied yet. */
  unavailable?: boolean;
};

const AUDIT_PAGE_SIZE = 50;

export async function fetchAuditLog(opts: {
  entityType?: string;
  action?:     string;
  search?:     string;
  page?:       number;
} = {}): Promise<AuditLogPage> {
  const supabase = await getSupabaseServerClient();
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const from = (page - 1) * AUDIT_PAGE_SIZE;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (supabase as any)
    .from("admin_audit_log")
    .select(
      "id, actor_email, action, entity_type, entity_id, previous_status, new_status, reason, created_at",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(from, from + AUDIT_PAGE_SIZE - 1);

  if (opts.entityType) q = q.eq("entity_type", opts.entityType);
  if (opts.action)     q = q.eq("action", opts.action);
  if (opts.search) {
    // Escape PostgREST's `or` filter separators so a search string can't alter
    // the filter expression.
    const term = opts.search.replace(/[(),*]/g, " ").trim().slice(0, 80);
    if (term) q = q.or(`actor_email.ilike.%${term}%,reason.ilike.%${term}%,action.ilike.%${term}%`);
  }

  const { data, error, count } = await q;

  if (error) {
    // Table not provisioned yet (migration 0025 not applied) — render an
    // explanatory empty state instead of a 500.
    if (error.code === "42P01" || error.code === "PGRST205") {
      return { rows: [], total: 0, page: 1, pages: 1, unavailable: true };
    }
    throw error;
  }

  const total = count ?? 0;
  return {
    rows:  (data ?? []) as AdminAuditRow[],
    total,
    page,
    pages: Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE)),
  };
}

// ── WhatsApp notification center (migrations 0026 + 0030) ───────────────────
// The outbox is written exclusively by the trusted backend (lib/notifications).
// This fetcher runs on the ADMIN's session client, so RLS enforces is_admin().

export type AdminNotificationRow = {
  id:                  string;
  event_type:          string;
  recipient_type:      "customer" | "owner" | "admin";
  recipient_phone:     string | null;
  booking_id:          string | null;
  hall_id:             string | null;
  message:             string;
  status:              "pending" | "processing" | "sent" | "failed" | "skipped" | "cancelled";
  provider_message_id: string | null;
  error_message:       string | null;
  attempt_count:       number;
  is_read:             boolean;
  created_at:          string;
  sent_at:             string | null;
  failed_at:           string | null;
  // WhatsApp (migration 0030). `status` is OUR send-side state; delivery_status
  // is what WhatsApp reported afterwards over the status callback — a message
  // can be status='sent' but delivery_status='undelivered'.
  channel:             string | null;
  template_key:        string | null;
  template_sid:        string | null;
  delivery_status:     string | null;
  delivery_updated_at: string | null;
  error_code:          string | null;
  permanent_failure:   boolean | null;
  test_mode:           boolean | null;
};

export type NotificationsPage = {
  rows:  AdminNotificationRow[];
  total: number;
  page:  number;
  pages: number;
  unavailable?: boolean;
};

const NOTIF_PAGE_SIZE = 50;

/** Event-type prefixes behind each dashboard category chip. */
const NOTIF_CATEGORY_PREFIXES: Record<string, string[]> = {
  booking:    ["booking."],
  payment:    ["payment.", "refund."],
  hall:       ["hall."],
  commission: ["commission.", "premium."],
};

export async function fetchNotifications(opts: {
  status?:    string;
  unread?:    boolean;
  search?:    string;
  page?:      number;
  /** customer | owner | admin */
  recipient?: string;
  /** booking | payment | hall | commission */
  category?:  string;
} = {}): Promise<NotificationsPage> {
  const supabase = await getSupabaseServerClient();
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const from = (page - 1) * NOTIF_PAGE_SIZE;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (supabase as any)
    .from("notifications")
    .select(
      "id, event_type, recipient_type, recipient_phone, booking_id, hall_id, message, status, " +
      "provider_message_id, error_message, attempt_count, is_read, created_at, sent_at, failed_at, " +
      "channel, template_key, template_sid, delivery_status, delivery_updated_at, error_code, " +
      "permanent_failure, test_mode",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(from, from + NOTIF_PAGE_SIZE - 1);

  if (opts.status) q = q.eq("status", opts.status);
  if (opts.unread) q = q.eq("is_read", false);

  // Whitelisted, never interpolated: both values index fixed maps, so a crafted
  // query string cannot reach the filter expression.
  if (opts.recipient && ["customer", "owner", "admin"].includes(opts.recipient)) {
    q = q.eq("recipient_type", opts.recipient);
  }
  const prefixes = opts.category ? NOTIF_CATEGORY_PREFIXES[opts.category] : undefined;
  if (prefixes) {
    q = q.or(prefixes.map((pre) => `event_type.like.${pre}*`).join(","));
  }
  if (opts.search) {
    // Strip PostgREST `or` filter separators so search terms cannot alter the
    // filter expression.
    const term = opts.search.replace(/[(),*]/g, " ").trim().slice(0, 80);
    if (term) q = q.or(`recipient_phone.ilike.%${term}%,event_type.ilike.%${term}%,message.ilike.%${term}%`);
  }

  const { data, error, count } = await q;

  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") {
      return { rows: [], total: 0, page: 1, pages: 1, unavailable: true };
    }
    throw error;
  }

  const total = count ?? 0;
  return {
    rows:  (data ?? []) as AdminNotificationRow[],
    total,
    page,
    pages: Math.max(1, Math.ceil(total / NOTIF_PAGE_SIZE)),
  };
}

export type NotificationStats = {
  totalSent:   number;
  totalFailed: number;
  totalSkipped: number;
  totalPending: number;
  /** Handed to Twilio successfully, but WhatsApp then reported non-delivery. */
  undelivered: number;
  unread:      number;
  lastSentAt:  string | null;
  lastFailedAt: string | null;
};

export async function fetchNotificationStats(): Promise<NotificationStats> {
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const empty: NotificationStats = {
    totalSent: 0, totalFailed: 0, totalSkipped: 0, totalPending: 0, undelivered: 0,
    unread: 0, lastSentAt: null, lastFailedAt: null,
  };
  try {
    const [sent, failed, skipped, pending, undelivered, unread, lastSent, lastFailed] = await Promise.all([
      db.from("notifications").select("id", { count: "exact", head: true }).eq("status", "sent"),
      db.from("notifications").select("id", { count: "exact", head: true }).eq("status", "failed"),
      db.from("notifications").select("id", { count: "exact", head: true }).eq("status", "skipped"),
      db.from("notifications").select("id", { count: "exact", head: true }).in("status", ["pending", "processing"]),
      db.from("notifications").select("id", { count: "exact", head: true }).in("delivery_status", ["undelivered", "failed"]),
      db.from("notifications").select("id", { count: "exact", head: true }).eq("is_read", false),
      db.from("notifications").select("sent_at").eq("status", "sent").order("sent_at", { ascending: false }).limit(1).maybeSingle(),
      db.from("notifications").select("failed_at").eq("status", "failed").order("failed_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    return {
      totalSent:    sent.count ?? 0,
      totalFailed:  failed.count ?? 0,
      totalSkipped: skipped.count ?? 0,
      totalPending: pending.count ?? 0,
      undelivered:  undelivered.count ?? 0,
      unread:       unread.count ?? 0,
      lastSentAt:   lastSent.data?.sent_at ?? null,
      lastFailedAt: lastFailed.data?.failed_at ?? null,
    };
  } catch {
    return empty;
  }
}
