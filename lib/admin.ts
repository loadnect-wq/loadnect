// Server-side data layer for the admin dashboard.
// Queries use getSupabaseServerClient() (session-aware, anon key).
// RLS policies all include `or public.is_admin()` exceptions, so admin sessions
// have full read access. The admin client (admin.ts) is reserved for webhooks
// and background jobs — using it here would lose the auth.uid() audit trail.
//
// ONE EXCEPTION, AND THE REASON MATTERS. "Admins have full read access" is a
// statement about RLS POLICIES. It is not true of GRANTS. A column the role
// `authenticated` was never granted stays unreadable no matter who is asking,
// because grants are checked before row security and have no notion of
// is_admin(). Migration 0046 moved `bookings` to per-column grants and withheld
// the commission columns, which silently broke every admin query that touched
// them. Migration 0065 then did the same to `payments`, withholding the gateway
// handles and raw_response so a venue owner could not read the customer's email
// off a payment at their hall — and broke two more. THREE queries here now run
// as the service role behind an explicit admin check that fails closed:
// fetchStuckPayouts, fetchAllPayments and fetchRefundQueue.
//
// Before adding a query here, check the GRANT as well as the policy. A
// "permission denied for table X" is always this, never RLS — RLS filters rows
// silently and returns an empty list instead.

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { readHallCommissionRates, readBookingCommissions } from "@/lib/hall-commission";
import { toBookingMode, type BookingMode } from "@/lib/booking-mode";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getProfile } from "@/lib/auth";
import { PLATFORM_FEE_RUPEES } from "@/lib/booking-payment";

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
  // Bank details. The only payout route that actually works today is a manual
  // transfer, so an admin has to be able to read these — but this shape must
  // stay inside the admin subtree: it is rendered masked by
  // app/admin/owners/page.tsx and belongs in no log, export or CSV.
  payout_account_number: string | null;
  payout_ifsc:           string | null;
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
  price_per_day:  number | null;
  booking_mode:   BookingMode;
  rating_average: number;
  rating_count:   number;
  cover_url:      string | null;
  owner_name:     string | null;
  owner_business: string | null;
  custom_amenities: string[];
  created_at:     string;
  /**
   * The Hallnect commission this hall gives, or null when never configured.
   *
   * Merged in from a SEPARATE service-role query, never added to the select()
   * below. Migration 0072 hides halls.commission_rate from `authenticated`, and
   * this function runs on the session client — so naming the column in that
   * select would raise 42703, which handleError swallows into `return []`,
   * blanking both /admin/halls and the hall-approval queue with no visible
   * error. One extra query per page is the cheaper failure mode.
   */
  commission_rate: number | null;
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
  /** The published policy version this customer accepted (0052). Null on
   *  bookings taken before it was recorded — see the column comment. */
  terms_version:  string | null;
  /**
   * The booking's OWN commission snapshot, merged in from a service-role read.
   *
   * Not part of the select() below and cannot be: migration 0032 hides these
   * three columns from `authenticated`, which includes the admin's session.
   * These are the figures the customer was actually charged against — if the
   * hall's rate has changed since, these do not move.
   */
  commission_rate:   number | null;
  commission_amount: number | null;
  owner_net_advance: number | null;
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
    /** Money owed BACK to customers and not yet sent. */
    refundsOwed:         number;
    /** Money owed to venues whose payout has not completed. */
    stuckPayouts:        number;
    /** Messages that failed and are still retryable. */
    failedNotifications: number;
  };
  /**
   * Sections whose query did not run.
   *
   * EVERY FIGURE BELOW DEFAULTS TO ZERO, so a failed read is indistinguishable
   * from a quiet month unless the caller is told which reads failed. Only
   * usersRes.error was ever checked; the other six results were consumed as
   * `(res.data ?? [])`, so a 42501 — the exact failure 0065 caused on payments
   * — silently produced "Platform fees Rs 0" on the one screen whose job is to
   * state the numbers. Anything named here means the figures derived from it
   * are not facts, and the dashboard must say so rather than print a zero.
   */
  failed: string[];
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
    open:     { pendingHalls: 0, pendingOwners: 0, openTickets: 0, pendingAds: 0,
                refundsOwed: 0, stuckPayouts: 0, failedNotifications: 0 },
    failed:   [],
  };

  /** Records a read that did not run, so the caller can refuse to present its
   *  zeroes as facts. Returns nothing: every block below already tolerates an
   *  empty result, and a partial dashboard plus an honest banner beats an
   *  all-zero one. */
  const noteFailure = (section: string, error: { code?: string; message: string } | null | undefined) => {
    if (!error) return;
    handleError(`fetchAdminStats(${section})`, error);
    empty.failed.push(section);
  };

  const [usersRes, hallsRes, bookingsRes, commissionsRes, ticketsRes, adsRes, paymentsRes] = await Promise.all([
    db.from("profiles").select("role"),
    db.from("halls").select("status"),
    db.from("bookings").select("status, total_amount"),
    db.from("commissions").select("commission_amount, owner_payout_amount, advance_amount, status"),
    db.from("support_tickets").select("status"),
    db.from("advertisements").select("status"),
    // Platform fees + refunds live on payments (0031).
    //
    // NAMED COLUMNS, NOT select("*"). The star was there so a pre-0031 database
    // would simply return the columns it had — but migration 0065 replaced
    // table-wide SELECT on payments with a named grant list, and SELECT *
    // requires privilege on EVERY column, so the star now raises 42501 for
    // everyone including admins (verified against production as an admin
    // session). It failed into this function's catch, which means the dashboard
    // would have reported Rs 0 revenue rather than an error — a silent wrong
    // number on the one screen that exists to state the numbers.
    //
    // These four are what the arithmetic below actually reads, and all four are
    // in 0065's grant list. Any column added here must be added there too.
    db.from("payments")
      .select("amount, status, platform_fee_amount, refund_amount")
      .in("status", ["payment_success", "refunded"]),
  ]);

  // Each result is checked. Previously only this one was, and it returned an
  // all-zero AdminStats that the dashboard rendered as real figures.
  noteFailure("users", usersRes.error);
  noteFailure("halls", hallsRes.error);
  noteFailure("bookings", bookingsRes.error);
  noteFailure("commissions", commissionsRes.error);
  noteFailure("support tickets", ticketsRes.error);
  noteFailure("advertisements", adsRes.error);
  noteFailure("payments", paymentsRes.error);

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
  // Waived commissions were never earned, and 'refunded' ones were un-earned
  // when the booking was cancelled — including either overstates revenue.
  // ownerPayouts had NO status filter at all, so it counted money promised on
  // bookings that never happened.
  const EARNED = (c: { status: string }) => c.status !== "waived" && c.status !== "refunded";
  empty.revenue.commission    = commissions.filter(EARNED)
    .reduce((s, c) => s + Number(c.commission_amount), 0);
  empty.revenue.ownerPayouts  = commissions.filter(EARNED)
    .reduce((s, c) => s + Number(c.owner_payout_amount), 0);
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
    // Number.isFinite, not truthiness: `!fee` is true for a legitimately waived
    // ₹0 fee and dropped the row before the refund branch below could see it.
    // Numerically harmless while the fee is always 200, wrong the moment a
    // coupon exists.
    if (!Number.isFinite(fee)) return s;
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

  // THE MONEY QUEUES. Without these the dashboard showed "0 / 0 / 0 — all
  // clear" over a customer waiting on a refund and a venue waiting on a
  // payout, which with push notifications down is the only place either would
  // ever have surfaced.
  //
  // Counted from the same helpers the /admin/payments page uses, so the badge
  // and the page can never disagree. Failures here must not take the whole
  // dashboard down, so each falls back to 0.
  try {
    const [refundRows, payoutRows] = await Promise.all([
      fetchRefundQueue(),
      fetchStuckPayouts(),
    ]);
    empty.open.refundsOwed  = refundRows.filter((r) => r.state !== "completed").length;
    empty.open.stuckPayouts = payoutRows.length;
  } catch (e) {
    // Both helpers already return [] on a query error, so this catch is the
    // SECOND fail-open layer over the same numbers. Reaching it means
    // "Refunds owed 0 / Stuck payouts 0" is a guess, and the comment above
    // records exactly what that costs: a customer waiting on a refund and a
    // venue waiting on a payout, over an all-clear.
    handleError("fetchAdminStats.moneyQueues", e as { code?: string; message: string });
    empty.failed.push("refund and payout queues");
  }

  try {
    const { count, error } = await db
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed")
      .or("permanent_failure.is.null,permanent_failure.eq.false");
    empty.open.failedNotifications = Number(count ?? 0);
    noteFailure("notifications", error);
  } catch (e) {
    // A missing table must not break the dashboard, but it must not read as
    // "no messages failed" either.
    handleError("fetchAdminStats(notifications)", e as { code?: string; message: string });
    empty.failed.push("notifications");
  }

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
    //
    // payout_account_number / payout_ifsc read fine through the session client,
    // and per this file's header that was checked as a GRANT and not just a
    // policy: information_schema.column_privileges on the live database shows
    // SELECT on both to `authenticated`, and hall_owners_select is
    // `profile_id = auth.uid() or is_admin()`. So no service-role read is
    // needed here.
    //
    // NOT from 0046, despite the obvious guess — that migration grants UPDATE
    // on the payout block (so an owner can maintain their own details) and says
    // nothing about SELECT. The read grant predates it. Attributing a privilege
    // to the wrong migration is how the next person "fixes" the wrong file.
    .select("id, profile_id, business_name, business_email, business_phone, gst_number, pan_number, payout_upi, payout_account_number, payout_ifsc, city, state, is_verified, created_at, profiles!profile_id(full_name, email, role)")
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
    payout_account_number: row.payout_account_number ?? null,
    payout_ifsc:           row.payout_ifsc           ?? null,
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
    .select("id, slug, name, city, state, status, is_premium, capacity_max, price_per_day, booking_mode, rating_average, rating_count, created_at, hall_images(url, is_cover), hall_owners(business_name, profiles!profile_id(full_name)), hall_custom_amenities(name, sort_order)")
    .order("created_at", { ascending: false });

  if (statusFilter) query = query.eq("status", statusFilter);

  const { data, error } = await query;
  if (error) { handleError("fetchAllHalls", error); return []; }

  // One batched service-role read for the whole page, keyed by hall id — not a
  // per-row lookup, which would be an N+1 against a table already queried.
  const rates = await readHallCommissionRates(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (data ?? []).map((r: any) => r.id as string),
  );

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
      // Number(null) is 0; a Rs.0 venue reads as free even in the admin list.
      price_per_day:  row.price_per_day == null ? null : Number(row.price_per_day),
      booking_mode:   toBookingMode(row.booking_mode),
      commission_rate: rates.get(row.id) ?? null,
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
    .select("id, hall_id, event_date, end_date, slot, total_amount, status, created_at, terms_version, halls(name), profiles!bookings_customer_id_fkey(full_name, email)")
    .order("created_at", { ascending: false })
    .limit(200);

  if (statusFilter) query = query.eq("status", statusFilter);

  const { data, error } = await query;
  if (error) { handleError("fetchAllBookings", error); return []; }

  // One batched service-role read for the page's money columns, which the
  // session client above is not permitted to see (migration 0032).
  const money = await readBookingCommissions(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (data ?? []).map((r: any) => r.id as string),
  );

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
    terms_version:  row.terms_version ?? null,
    commission_rate:   money.get(row.id)?.rate ?? null,
    commission_amount: money.get(row.id)?.amount ?? null,
    owner_net_advance: money.get(row.id)?.ownerNetAdvance ?? null,
  }));
}

// ── Payments ──────────────────────────────────────────────────────────────────

export async function fetchAllPayments(statusFilter?: string): Promise<AdminPaymentRow[]> {
    // SERVICE ROLE, for the same reason fetchStuckPayouts uses it — and this time
  // the withheld columns are on `payments`, not `bookings`.
  //
  // Migration 0065 replaced table-wide SELECT on payments with a named column
  // list, because `authenticated` could otherwise read raw_response (which
  // carries the CUSTOMER'S EMAIL) and payment_session_id for any booking at
  // their venue. The gateway handles were deliberately withheld — and this
  // query embeds one, so it began throwing "permission denied for table
  // payments" for everyone, admins included. Observed in production runtime
  // errors at 2026-09-06T17:13Z, from /admin/payments.
  //
  // Granting the handles back to `authenticated` would undo exactly what 0065
  // closed. So this read runs as the service role behind an explicit admin
  // check that fails closed — a read, not a write, so no audit trail is lost.
  const viewer = await getProfile();
  if (viewer?.role !== "admin") return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getSupabaseAdminClient() as any;

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
  /** True when owner_amount had to be inferred from the captured total because
   *  the booking carries no commission snapshot — pay it only after checking. */
  amount_is_estimated: boolean;
  /** The venue owner, so a beneficiary can be registered from this screen. */
  hall_owner_id: string | null;
  /** Cashfree's verdict on the destination. Only VERIFIED can be paid. */
  beneficiary_status: string | null;
  /** The most recent transfer ATTEMPT, if any. owner_payouts is the authority;
   *  split_status is only its summary. */
  payout_id: string | null;
  payout_status: string | null;
  payout_status_code: string | null;
  payout_is_terminal: boolean;
  payout_utr: string | null;
  /** Last four of the destination account, so an admin can sanity-check where
   *  the money is about to go without the full number being on screen. */
  account_hint: string | null;
};

/** The owner's share of a payment, from the most authoritative source present. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ownerShareOf(row: any): number {
  const dispatched = Number(row.split_owner_amount);
  if (row.split_owner_amount != null && Number.isFinite(dispatched)) return dispatched;

  const snapshot = Number(row.bookings?.owner_net_advance);
  if (row.bookings?.owner_net_advance != null && Number.isFinite(snapshot)) return snapshot;

  const advance    = Number(row.advance_amount);
  const commission = Number(row.bookings?.commission_amount);
  if (Number.isFinite(advance) && Number.isFinite(commission)) {
    return Math.round((advance - commission) * 100) / 100;
  }
  return Number(row.amount ?? 0);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isEstimatedShare(row: any): boolean {
  return row.split_owner_amount == null
    && row.bookings?.owner_net_advance == null
    && !(Number.isFinite(Number(row.advance_amount))
         && Number.isFinite(Number(row.bookings?.commission_amount)));
}

export async function fetchStuckPayouts(): Promise<StuckPayoutRow[]> {
  // THE ONE QUERY IN THIS FILE THAT CANNOT USE THE SESSION CLIENT.
  //
  // This file's header says admin sessions have full read access because every
  // RLS policy carries an `or is_admin()` exception. That is true of POLICIES
  // and false of GRANTS. Migration 0046 replaced table-wide SELECT on
  // `bookings` with per-column grants and deliberately withheld
  // commission_amount, commission_rate and owner_net_advance, so that a
  // customer or a venue owner cannot read Hallnect's own economics.
  //
  // Column grants are checked BEFORE row security and know nothing about
  // is_admin(). So this query — the only one that embeds those columns — threw
  // "permission denied for table bookings" for everyone, admins included. It
  // failed 17 times for 3 users across /admin/payments, /admin/dashboard,
  // /admin/notifications, /admin/settings and /admin/coupons between
  // 2026-08-30 and 2026-09-04, taking the money queue with it. That queue is
  // how venues actually get paid while Cashfree Easy Split is still off, so
  // the payout list read empty exactly when it mattered.
  //
  // Granting the three columns to `authenticated` would clear the error by
  // undoing the protection 0046 added. Instead this single read runs as the
  // service role behind an explicit admin check that fails closed — a read,
  // not a write, so no audit trail is lost.
  const viewer = await getProfile();
  if (viewer?.role !== "admin") return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getSupabaseAdminClient() as any;

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
    .select("id, booking_id, amount, split_owner_amount, split_status, split_error, refund_state, advance_amount, platform_fee_amount, created_at, bookings(status, commission_amount, owner_net_advance, halls(name, owner_id, hall_owners(id, payout_beneficiary_status, payout_account_number)))")
    .eq("status", "payment_success")
    .order("created_at", { ascending: false })
    .limit(200);

  // A missing column (pre-0031 database) must not break the payments page.
  if (error) {
    handleError("fetchStuckPayouts", error);
    // THROWS. Returning [] told /admin/payments there were no stuck payouts and
    // the dashboard tile "Payouts owed to venues: 0" — the all-clear — from the
    // one query whose job is to notice money that never reached a venue. The
    // header above records this exact query reading empty through 17 failures
    // across five days; the service-role fix removed that cause and left the
    // swallow that made it invisible.
    //
    // It matters more than a wrong number: RetryPayoutButton and
    // MarkPaidManuallyButton are rendered ONLY inside this list, so an empty
    // result also removes the only way to pay or record a payout anywhere in
    // the product — and with Easy Split off, this hand-worked queue is how
    // venues actually get paid. fetchAdminStats catches this and marks the
    // dashboard degraded rather than printing a 0.
    throw new Error("Could not read the payout queue.");
  }

  const PAYABLE_BOOKING = new Set(["owner_confirmed", "completed"]);
  const REFUND_IN_FLIGHT = new Set(["owed", "processing", "completed"]);

  // The latest transfer attempt per booking. owner_payouts is the authority for
  // payout state; payments.split_status is only its summary, and the two can
  // legitimately disagree for the moment between a dispatch and its reconcile.
  const transfers = new Map<string, {
    id: string; status: string; status_code: string | null;
    is_terminal: boolean; transfer_utr: string | null;
  }>();
  {
    const { data: rows } = await db
      .from("owner_payouts")
      .select("id, booking_id, status, status_code, is_terminal, transfer_utr, attempt")
      .order("attempt", { ascending: true });
    for (const t of (rows ?? []) as Record<string, unknown>[]) {
      // Ascending, so the last write per booking is the highest attempt.
      transfers.set(String(t.booking_id), {
        id: String(t.id),
        status: String(t.status),
        status_code: (t.status_code as string | null) ?? null,
        is_terminal: Boolean(t.is_terminal),
        transfer_utr: (t.transfer_utr as string | null) ?? null,
      });
    }
  }

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
      // THIS FIGURE IS PAID BY HAND, so it has to be the owner's share and not
      // the gross advance.
      //
      // The previous fallback used advance_amount and claimed in a comment to
      // overstate "by at most the Rs200 fee". That was wrong by the COMMISSION,
      // not the fee: the advance is what the customer paid toward the hall, and
      // the owner's share is that MINUS Hallnect's commission. On a Rs1,00,000
      // hall it printed Rs25,000 where Rs22,500 is owed — an admin following the
      // screen hands the venue Hallnect's own Rs2,500 commission, every time.
      //
      // Order of preference, most authoritative first:
      //   1. split_owner_amount — what a dispatched split actually carried.
      //   2. owner_net_advance  — the booking's own snapshot of the same figure.
      //   3. advance - commission, recomputed from the snapshot.
      // Only if all three are absent (a pre-0031 row) does it fall back to the
      // captured amount, and that case is flagged rather than shown as exact.
      owner_amount: ownerShareOf(row),
      amount_is_estimated: isEstimatedShare(row),
      split_status: row.split_status ?? "none",
      split_error:  row.split_error ?? null,
      hall_name:    row.bookings?.halls?.name ?? "Hall",
      created_at:   row.created_at,
      hall_owner_id: row.bookings?.halls?.hall_owners?.id ?? null,
      beneficiary_status: row.bookings?.halls?.hall_owners?.payout_beneficiary_status ?? null,
      // Last four only. An admin needs to recognise the account, not read it.
      account_hint: (() => {
        const acct = String(row.bookings?.halls?.hall_owners?.payout_account_number ?? "");
        return acct.length >= 4 ? acct.slice(-4) : null;
      })(),
      payout_id:          transfers.get(row.booking_id)?.id ?? null,
      payout_status:      transfers.get(row.booking_id)?.status ?? null,
      payout_status_code: transfers.get(row.booking_id)?.status_code ?? null,
      payout_is_terminal: transfers.get(row.booking_id)?.is_terminal ?? true,
      payout_utr:         transfers.get(row.booking_id)?.transfer_utr ?? null,
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
    // SERVICE ROLE, for the same reason fetchStuckPayouts uses it — and this time
  // the withheld columns are on `payments`, not `bookings`.
  //
  // Migration 0065 replaced table-wide SELECT on payments with a named column
  // list, because `authenticated` could otherwise read raw_response (which
  // carries the CUSTOMER'S EMAIL) and payment_session_id for any booking at
  // their venue. The gateway handles were deliberately withheld — and this
  // query embeds one, so it began throwing "permission denied for table
  // payments" for everyone, admins included. Observed in production runtime
  // errors at 2026-09-06T17:13Z, from /admin/payments.
  //
  // Granting the handles back to `authenticated` would undo exactly what 0065
  // closed. So this read runs as the service role behind an explicit admin
  // check that fails closed — a read, not a write, so no audit trail is lost.
  const viewer = await getProfile();
  if (viewer?.role !== "admin") return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getSupabaseAdminClient() as any;

  const { data, error } = await db
    .from("payments")
    .select("id, booking_id, refund_amount, refund_state, refund_error, cashfree_refund_id, created_at, bookings(event_date, halls(name))")
    .in("refund_state", ["owed", "processing", "failed"])
    .order("created_at", { ascending: false })
    .limit(100);

  // A missing column (pre-0033 database) must not break the payments page.
  if (error) {
    handleError("fetchRefundQueue", error);
    // Same reasoning as fetchStuckPayouts: [] here is "no customer is owed
    // money", which is the one answer this queue must never give by accident.
    throw new Error("Could not read the refund queue.");
  }

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

export async function fetchAllPremium(): Promise<{
  rows: AdminPremiumRow[];
  /** Each row here is Rs 4,999 or Rs 9,999 an owner already paid. An empty
   *  table reads as "nobody bought premium", which is what a fresh install
   *  looks like, so a failed query is never questioned. */
  unavailable: boolean;
}> {
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

  // The 42703 retry above only covers a missing plan_slug. Anything else — a
  // failure on the halls(name, slug) embed, a grant change, a timeout — used to
  // return [] and render "no premium listings", which is indistinguishable from
  // a fresh install. Combined with the same fail-open in fetchStuckPlanPurchases,
  // BOTH screens that would catch a paid-but-not-activated plan went quiet at
  // once, which is precisely the case an owner is complaining about when an
  // admin opens this page.
  if (error) { handleError("fetchAllPremium", error); return { rows: [], unavailable: true }; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (data ?? []).map((row: any): AdminPremiumRow => ({
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

  return { rows, unavailable: false };
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

// ── SMS notification center (migrations 0026 + 0030 + 0047) ─────────────────
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
  // `status` is OUR send-side state; delivery_status is the operator's verdict,
  // which arrives later on the MSG91 delivery-report webhook — a message can be
  // status='sent' but delivery_status='undelivered'.
  channel:             string | null;
  template_key:        string | null;
  provider_template_id: string | null;
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
  /**
   * One status, or a SET of them.
   *
   * The set is not a convenience. 'pending' (queued, never claimed) and
   * 'processing' (claimed by a sender that never came back) are two halves of
   * the same operational state — "this message has not gone out yet" — and
   * fetchNotificationStats counts them together as totalPending. While this was
   * a bare .eq() the Pending chip could only ever match the first half, so a
   * message stranded in 'processing' by a crash between claim and result was
   * counted on the tile and reachable from no filter on the page. The retry
   * button for exactly that row lives on the row.
   */
  status?:    string | string[];
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
      "channel, template_key, provider_template_id, delivery_status, delivery_updated_at, error_code, " +
      "permanent_failure, test_mode",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(from, from + NOTIF_PAGE_SIZE - 1);

  // An EMPTY array must mean "no status filter", not .in("status", []) — which
  // PostgREST answers with zero rows and would render as "no notifications".
  if (Array.isArray(opts.status)) {
    if (opts.status.length === 1) q = q.eq("status", opts.status[0]);
    else if (opts.status.length > 1) q = q.in("status", opts.status);
  } else if (opts.status) {
    q = q.eq("status", opts.status);
  }
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
  /** Queued AND in-flight — status 'pending' plus status 'processing'. The
   *  Pending filter on /admin/notifications MUST select the same two, or the
   *  tile counts rows the page cannot open. */
  totalPending: number;
  /** Accepted by MSG91, then reported as not delivered by the operator. */
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

export type StuckPlanPurchaseRow = {
  id:            string;
  hall_name:     string;
  owner_business: string | null;
  plan_slug:     string;
  amount:        number;
  paid_at:       string | null;
  order_id:      string | null;
};

/**
 * Plan purchases where the OWNER PAID BUT NO LISTING EXISTS.
 *
 * Activation retries itself on every webhook redelivery and every visit to the
 * return page, so a row only lingers here if it keeps failing. When one does,
 * somebody has to know: an owner has been charged ₹4,999 or ₹9,999 and has
 * nothing to show for it, and until this panel existed the only trace was a
 * single server log line.
 *
 * Keyed on the LISTING being absent, not on premium_listing_id being null —
 * the link-back write is best-effort and its failure does not mean the listing
 * is missing.
 */
export async function fetchStuckPlanPurchases(): Promise<{
  rows: StuckPlanPurchaseRow[];
  /** The query did not run. An empty list is then NOT an all-clear, and the
   *  panel must say so — the ambiguous-embed bug hid behind exactly this for
   *  ten days, because a healthy system and a broken one both rendered "none". */
  unavailable: boolean;
}> {
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // premium_listings MUST name its constraint. plan_purchases and
  // premium_listings reference each other — plan_purchases.premium_listing_id
  // forward, premium_listings.plan_purchase_id back — so a bare
  // `premium_listings(id)` is ambiguous and PostgREST refuses the whole query
  // with "more than one relationship was found". It had done since 28 August;
  // handleError swallows it and returns [], so this panel reported "no stuck
  // purchases" every time it was opened. Fail-open on the one screen whose job
  // is to notice that an owner paid Rs 4,999 and got nothing.
  //
  // The named constraint is the REVERSE one, which is the relationship this
  // function is documented to want: listings that point AT this purchase. The
  // forward link-back is best-effort (see applyPlanPayment) and its absence
  // does not mean the listing is missing.
  const { data, error } = await db
    .from("plan_purchases")
    .select("id, plan_slug, amount, paid_at, cashfree_order_id, halls(name), hall_owners(business_name), premium_listings!premium_listings_plan_purchase_id_fkey(id)")
    .eq("status", "paid")
    .order("paid_at", { ascending: false })
    .limit(100);

  // The embed was fixed by naming its constraint, but the handler that HID it
  // was the reason nobody noticed for ten days. Three embeds remain (halls,
  // hall_owners, the constraint-named premium_listings), so any future RLS
  // change or 0065-style grant narrowing re-throws here.
  if (error) { handleError("fetchStuckPlanPurchases", error); return { rows: [], unavailable: true }; }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (data ?? [])
    .filter((row: any) => !row.premium_listings || row.premium_listings.length === 0)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((row: any): StuckPlanPurchaseRow => ({
      id:             row.id,
      hall_name:      row.halls?.name ?? "Hall",
      owner_business: row.hall_owners?.business_name ?? null,
      plan_slug:      row.plan_slug,
      amount:         Number(row.amount),
      paid_at:        row.paid_at ?? null,
      order_id:       row.cashfree_order_id ?? null,
    }));

  return { rows, unavailable: false };
}

// ── Coupons ───────────────────────────────────────────────────────────────────

export type AdminCouponRow = {
  id:              string;
  code:            string;
  description:     string | null;
  kind:            string;
  is_active:       boolean;
  max_redemptions: number | null;
  expires_at:      string | null;
  created_at:      string;
  stopped_at:      string | null;
  /** Live pending holds — not yet paid, may still lapse. */
  held:            number;
  /** Bookings where money actually moved. This is what a cap counts. */
  paid:            number;
  /** What the waivers have cost Hallnect so far, in rupees. */
  feesForgone:     number;
  /** The usage query did not run, so held/paid/feesForgone are NOT zero —
   *  they are unknown, and the table must print that rather than a 0. */
  usageUnavailable?: boolean;
};

/**
 * Coupons plus their usage. `unavailable` distinguishes "migration 0045 has not
 * run" from "no coupons yet", so a fresh deploy renders an explanation instead
 * of an empty table that looks like a bug (the fetchAuditLog precedent).
 */
export async function fetchCoupons(): Promise<
  { unavailable: true } | { unavailable: false; rows: AdminCouponRow[] }
> {
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data, error } = await db
    .from("coupons")
    .select("id, code, description, kind, is_active, max_redemptions, expires_at, created_at, stopped_at")
    .order("created_at", { ascending: false });

  if (error?.code === "42P01" || error?.code === "PGRST205") return { unavailable: true };
  if (error) {
    handleError("fetchCoupons", error);
    return { unavailable: false, rows: [] };
  }

  const rows: AdminCouponRow[] = await Promise.all(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (data ?? []).map(async (c: any) => {
      // coupon_usage() is SECURITY DEFINER and admin-gated; it raises for a
      // non-admin rather than returning zeroes, so a failure here means the
      // caller is not an admin and the page would not have rendered anyway.
      //
      // THAT REASONING COVERS ONE FAILURE MODE AND THE CODE ASSUMED IT COVERED
      // ALL OF THEM. `error` was destructured away entirely, so a renamed or
      // dropped function after a migration, a permission change on the routine,
      // or a statement timeout each left `u` null and rendered "Held 0, Paid 0,
      // Fees forgone Rs 0" for a real admin — identical to a coupon nobody has
      // used. `paid` is what a redemption cap is judged against and feesForgone
      // is the running rupee cost of the campaign, so both being wrong AND
      // reassuring is the worst combination available.
      const { data: u, error: usageError } = await db.rpc("coupon_usage", { _coupon_id: c.id });
      if (usageError) {
        handleError(`fetchCoupons(usage:${c.code})`, usageError);
        return { ...c, held: 0, paid: 0, feesForgone: 0, usageUnavailable: true };
      }
      const usage = Array.isArray(u) ? u[0] : u;
      const paid = Number(usage?.paid ?? 0);
      return {
        ...c,
        held:        Number(usage?.held ?? 0),
        paid,
        feesForgone: paid * PLATFORM_FEE_RUPEES,
        usageUnavailable: false,
      };
    }),
  );

  return { unavailable: false, rows };
}

