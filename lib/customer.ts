// Server-side data layer for the customer dashboard.
// All queries use getSupabaseServerClient() (session-aware, anon key).
// RLS is the primary security enforcer — every query is additionally filtered
// by customer_id = auth.uid() as defense-in-depth.

import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { HallListing } from "@/lib/halls";

// ── Types ─────────────────────────────────────────────────────────────────────

export type CustomerPayment = {
  id:             string;
  amount:         number;
  currency:       string;
  status:         string; // payment_status enum
  payment_method: string | null;
  created_at:     string;
};

export type CustomerBooking = {
  id:             string;
  hall_id:        string;
  hall_name:      string;
  hall_slug:      string;
  hall_city:      string;
  hall_state:     string | null;
  hall_address:   string | null;
  hall_cover_url: string | null;
  event_date:     string;
  end_date:       string;           // YYYY-MM-DD
  slot:           "morning" | "evening" | "full_day";
  guest_count:    number | null;
  base_amount:    number;
  platform_fee:   number;
  total_amount:   number;
  status:         string;           // booking_status enum
  customer_notes: string | null;
  owner_notes:    string | null;
  cancel_reason:  string | null;
  created_at:     string;
  updated_at:     string;
  payment:        CustomerPayment | null;
};

export type MySavedHall = {
  hall_id:  string;
  saved_at: string;
  hall:     HallListing | null;
};

export type MyReview = {
  id:                 string;
  hall_id:            string;
  hall_name:          string;
  hall_slug:          string;
  booking_id:         string | null;
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

export type CustomerStats = {
  upcomingCount:  number;
  pendingCount:   number;
  completedCount: number;
  savedCount:     number;
};

export type BookingTab = "upcoming" | "past" | "all";

// Statuses the customer is allowed to cancel
export const CANCELLABLE_STATUSES = new Set([
  "payment_success",
  "booking_requested",
  "owner_confirmed",
]);

const UPCOMING_STATUSES = ["payment_success", "booking_requested", "owner_confirmed"];

// ── Helpers ───────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function handleErr(label: string, error: { code?: string; message: string }) {
  if (error.code === "PGRST205" || error.code === "42P01") {
    console.info(`[${label}] table not provisioned yet — run supabase/migrations.`);
  } else {
    console.error(`[${label}]`, error.message);
  }
}

const BOOKING_SELECT = `
  id, hall_id, event_date, end_date, slot, guest_count,
  base_amount, platform_fee, total_amount,
  status, customer_notes, owner_notes, cancel_reason,
  created_at, updated_at,
  halls(id, name, slug, city, state, address, hall_images(url, is_cover)),
  payments(id, amount, currency, status, payment_method, created_at)
`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapBooking(row: any): CustomerBooking {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hall = row.halls as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const imgs: { url: string; is_cover: boolean }[] = hall?.hall_images ?? [];
  const coverUrl = imgs.find((i) => i.is_cover)?.url ?? imgs[0]?.url ?? null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payments: any[] = Array.isArray(row.payments) ? row.payments : [];
  const payment = payments.find((p) => p.status === "payment_success") ?? payments[0] ?? null;

  return {
    id:             row.id,
    hall_id:        row.hall_id,
    hall_name:      hall?.name      ?? "Venue",
    hall_slug:      hall?.slug      ?? "",
    hall_city:      hall?.city      ?? "",
    hall_state:     hall?.state     ?? null,
    hall_address:   hall?.address   ?? null,
    hall_cover_url: coverUrl,
    event_date:     row.event_date,
    end_date:       row.end_date ?? row.event_date,
    slot:           row.slot,
    guest_count:    row.guest_count ?? null,
    base_amount:    Number(row.base_amount),
    platform_fee:   Number(row.platform_fee),
    total_amount:   Number(row.total_amount),
    status:         row.status,
    customer_notes: row.customer_notes ?? null,
    owner_notes:    row.owner_notes    ?? null,
    cancel_reason:  row.cancel_reason  ?? null,
    created_at:     row.created_at,
    updated_at:     row.updated_at ?? row.created_at,
    payment: payment ? {
      id:             payment.id,
      amount:         Number(payment.amount),
      currency:       payment.currency       ?? "INR",
      status:         payment.status,
      payment_method: payment.payment_method ?? null,
      created_at:     payment.created_at,
    } : null,
  };
}

// ── Queries ───────────────────────────────────────────────────────────────────

export async function fetchMyBookings(tab: BookingTab = "all"): Promise<CustomerBooking[]> {
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const today = new Date().toISOString().split("T")[0];

  let query = db.from("bookings").select(BOOKING_SELECT).eq("customer_id", user.id);

  if (tab === "upcoming") {
    query = query
      .in("status", UPCOMING_STATUSES)
      .gte("event_date", today)
      .order("event_date", { ascending: true });
  } else if (tab === "past") {
    // Past = event happened already, OR booking reached a terminal state
    query = query
      .or(`event_date.lt.${today},status.in.(completed,cancelled,owner_rejected,refunded)`)
      .order("event_date", { ascending: false });
  } else {
    query = query.order("created_at", { ascending: false });
  }

  const { data, error } = await query;
  if (error) { handleErr("fetchMyBookings", error); return []; }
  return (data ?? []).map(mapBooking);
}

export async function fetchBookingById(id: string): Promise<CustomerBooking | null> {
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await db
    .from("bookings")
    .select(BOOKING_SELECT)
    .eq("id", id)
    .eq("customer_id", user.id) // defense-in-depth; RLS also enforces
    .maybeSingle();

  if (error) { handleErr("fetchBookingById", error); return null; }
  if (!data) return null;
  return mapBooking(data);
}

export async function fetchMyReviewForHall(hallId: string): Promise<{ id: string } | null> {
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await db
    .from("reviews")
    .select("id")
    .eq("customer_id", user.id)
    .eq("hall_id", hallId)
    .maybeSingle();

  return data ?? null;
}

export async function fetchMySavedHalls(): Promise<MySavedHall[]> {
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const SELECT_WITH_TIER = `
      hall_id, created_at,
      halls(
        id, slug, name, city, address,
        capacity_max, price_per_day, is_premium, premium_tier,
        rating_average, rating_count,
        hall_images(url, is_cover)
      )
    `;
  const SELECT_LEGACY = SELECT_WITH_TIER.replace(", premium_tier", "");

  let { data, error } = await db
    .from("saved_halls")
    .select(SELECT_WITH_TIER)
    .eq("customer_id", user.id)
    .order("created_at", { ascending: false });

  if (error?.code === "42703") {
    ({ data, error } = await db
      .from("saved_halls")
      .select(SELECT_LEGACY)
      .eq("customer_id", user.id)
      .order("created_at", { ascending: false }));
  }

  if (error) { handleErr("fetchMySavedHalls", error); return []; }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any): MySavedHall => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hall = row.halls as any;
    if (!hall) return { hall_id: row.hall_id, saved_at: row.created_at, hall: null };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const imgs: { url: string; is_cover: boolean }[] = hall.hall_images ?? [];
    const coverUrl = imgs.find((i) => i.is_cover)?.url ?? imgs[0]?.url ?? null;
    return {
      hall_id:  row.hall_id,
      saved_at: row.created_at,
      hall: {
        id:             hall.id,
        slug:           hall.slug,
        name:           hall.name,
        city:           hall.city,
        address:        hall.address        ?? null,
        capacity_max:   hall.capacity_max,
        price_per_day:  Number(hall.price_per_day),
        is_premium:     hall.is_premium,
        premium_tier:   hall.premium_tier ?? null,
        rating_average: Number(hall.rating_average),
        rating_count:   hall.rating_count,
        cover_url:      coverUrl,
        amenities:      [],
      },
    };
  });
}

export async function fetchMyReviews(): Promise<MyReview[]> {
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const SELECT_FULL = "id, hall_id, booking_id, rating, title, comment, cleanliness_rating, value_rating, location_rating, service_rating, is_visible, created_at, halls(name, slug)";
  const SELECT_LEGACY = "id, hall_id, booking_id, rating, comment, is_visible, created_at, halls(name, slug)";

  let { data, error } = await db
    .from("reviews")
    .select(SELECT_FULL)
    .eq("customer_id", user.id)
    .order("created_at", { ascending: false });

  if (error?.code === "42703") {
    ({ data, error } = await db
      .from("reviews")
      .select(SELECT_LEGACY)
      .eq("customer_id", user.id)
      .order("created_at", { ascending: false }));
  }

  if (error) { handleErr("fetchMyReviews", error); return []; }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any): MyReview => ({
    id:                 row.id,
    hall_id:            row.hall_id,
    hall_name:          row.halls?.name ?? "Venue",
    hall_slug:          row.halls?.slug ?? "",
    booking_id:         row.booking_id ?? null,
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

export async function fetchCustomerStats(): Promise<CustomerStats> {
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { upcomingCount: 0, pendingCount: 0, completedCount: 0, savedCount: 0 };

  const today = new Date().toISOString().split("T")[0];

  const [{ data: bookings }, { count: savedCount }] = await Promise.all([
    db.from("bookings").select("status, event_date").eq("customer_id", user.id),
    db.from("saved_halls").select("*", { count: "exact", head: true }).eq("customer_id", user.id),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bkgs: any[] = bookings ?? [];
  return {
    upcomingCount:  bkgs.filter((b) => UPCOMING_STATUSES.includes(b.status) && b.event_date >= today).length,
    pendingCount:   bkgs.filter((b) => b.status === "pending_payment").length,
    completedCount: bkgs.filter((b) => b.status === "completed").length,
    savedCount:     savedCount ?? 0,
  };
}
