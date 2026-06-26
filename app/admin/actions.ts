"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  validateTargetUrl,
  validateImageUrl,
  sanitizeAdText,
  isValidPlacement,
} from "@/lib/ads";
import {
  uuidSchema,
  premiumListingSchema,
  premiumPlanUpdateSchema,
  commissionPercentSchema,
  ticketResponseSchema,
  parseSafe,
} from "@/lib/validation/schemas";
import { sanitizeError } from "@/lib/errors";

function requireUuid(id: string, label = "id"): string | null {
  return parseSafe(uuidSchema, id).ok ? null : `Invalid ${label}.`;
}

type ActionResult = { success: true } | { error: string };

// All admin actions use the SESSION-AWARE server client (anon key + cookies).
// RLS policies + DB triggers all include `is_admin()` exceptions, so admin
// sessions have full write access. Using the service-role admin client here
// would bypass RLS but lose the auth.uid() audit trail — and crucially, the
// is_trusted_backend() flag would bypass the prevent_role_change /
// prevent_hall_self_approve / prevent_owner_self_verify triggers entirely,
// disabling audit even for admin actions. So we deliberately don't use it.

async function getAuthUser() {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

// ── Hall approval ─────────────────────────────────────────────────────────────

export async function approveHall(hallId: string): Promise<ActionResult> {
  const { supabase, user } = await getAuthUser();
  if (!user) return { error: "Not authenticated" };
  const idErr = requireUuid(hallId, "hall id");
  if (idErr) return { error: idErr };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { error } = await db
    .from("halls")
    .update({ status: "approved" })
    .eq("id", hallId);

  if (error) return { error: sanitizeError(error, "admin") };
  revalidatePath("/admin/halls");
  revalidatePath("/admin/hall-approvals");
  revalidatePath("/admin/dashboard");
  return { success: true };
}

export async function rejectHall(hallId: string): Promise<ActionResult> {
  const { supabase, user } = await getAuthUser();
  if (!user) return { error: "Not authenticated" };
  const idErr = requireUuid(hallId, "hall id");
  if (idErr) return { error: idErr };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { error } = await db
    .from("halls")
    .update({ status: "rejected" })
    .eq("id", hallId);

  if (error) return { error: sanitizeError(error, "admin") };
  revalidatePath("/admin/halls");
  revalidatePath("/admin/hall-approvals");
  revalidatePath("/admin/dashboard");
  return { success: true };
}

export async function suspendHall(hallId: string): Promise<ActionResult> {
  const { supabase, user } = await getAuthUser();
  if (!user) return { error: "Not authenticated" };
  const idErr = requireUuid(hallId, "hall id");
  if (idErr) return { error: idErr };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { error } = await db
    .from("halls")
    .update({ status: "suspended" })
    .eq("id", hallId);

  if (error) return { error: sanitizeError(error, "admin") };
  revalidatePath("/admin/halls");
  revalidatePath("/admin/dashboard");
  return { success: true };
}

export async function unsuspendHall(hallId: string): Promise<ActionResult> {
  const { supabase, user } = await getAuthUser();
  if (!user) return { error: "Not authenticated" };
  const idErr = requireUuid(hallId, "hall id");
  if (idErr) return { error: idErr };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { error } = await db
    .from("halls")
    .update({ status: "approved" })
    .eq("id", hallId);

  if (error) return { error: sanitizeError(error, "admin") };
  revalidatePath("/admin/halls");
  return { success: true };
}

// ── Owner approval ────────────────────────────────────────────────────────────
// Approve owner = set profile.role to 'owner_approved' AND verify hall_owners row.
// Both writes are gated by `is_admin()` in RLS + triggers.

export async function approveOwner(profileId: string): Promise<ActionResult> {
  const { supabase, user } = await getAuthUser();
  if (!user) return { error: "Not authenticated" };
  const idErr = requireUuid(profileId, "profile id");
  if (idErr) return { error: idErr };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // 1. Promote profile role to owner_approved.
  const { error: roleErr } = await db
    .from("profiles")
    .update({ role: "owner_approved" })
    .eq("id", profileId);
  if (roleErr) return { error: roleErr.message };

  // 2. Mark their hall_owners row as verified, if it exists.
  await db
    .from("hall_owners")
    .update({ is_verified: true, verified_at: new Date().toISOString(), verified_by: user.id })
    .eq("profile_id", profileId);

  revalidatePath("/admin/owners");
  revalidatePath("/admin/users");
  revalidatePath("/admin/dashboard");
  return { success: true };
}

export async function rejectOwner(profileId: string): Promise<ActionResult> {
  const { supabase, user } = await getAuthUser();
  if (!user) return { error: "Not authenticated" };
  const idErr = requireUuid(profileId, "profile id");
  if (idErr) return { error: idErr };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Downgrade to customer.
  const { error } = await db
    .from("profiles")
    .update({ role: "customer" })
    .eq("id", profileId);

  if (error) return { error: sanitizeError(error, "admin") };
  revalidatePath("/admin/owners");
  revalidatePath("/admin/users");
  return { success: true };
}

export async function verifyOwnerRow(ownerRowId: string): Promise<ActionResult> {
  const { supabase, user } = await getAuthUser();
  if (!user) return { error: "Not authenticated" };
  const idErr = requireUuid(ownerRowId, "owner row id");
  if (idErr) return { error: idErr };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { error } = await db
    .from("hall_owners")
    .update({ is_verified: true, verified_at: new Date().toISOString(), verified_by: user.id })
    .eq("id", ownerRowId);

  if (error) return { error: sanitizeError(error, "admin") };
  revalidatePath("/admin/owners");
  return { success: true };
}

// ── User management ───────────────────────────────────────────────────────────

export async function toggleUserActive(profileId: string, active: boolean): Promise<ActionResult> {
  const { supabase, user } = await getAuthUser();
  if (!user) return { error: "Not authenticated" };
  const idErr = requireUuid(profileId, "profile id");
  if (idErr) return { error: idErr };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Safety: never let an admin deactivate themselves.
  if (profileId === user.id && !active) {
    return { error: "You cannot deactivate your own account." };
  }

  const { error } = await db
    .from("profiles")
    .update({ is_active: active })
    .eq("id", profileId);

  if (error) return { error: sanitizeError(error, "admin") };
  revalidatePath("/admin/users");
  return { success: true };
}

// ── Review moderation ────────────────────────────────────────────────────────

export async function toggleReviewVisible(reviewId: string, visible: boolean): Promise<ActionResult> {
  const { supabase, user } = await getAuthUser();
  if (!user) return { error: "Not authenticated" };
  const idErr = requireUuid(reviewId, "review id");
  if (idErr) return { error: idErr };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { error } = await db
    .from("reviews")
    .update({ is_visible: visible })
    .eq("id", reviewId);

  if (error) return { error: sanitizeError(error, "admin") };
  revalidatePath("/admin/reviews");
  return { success: true };
}

export async function deleteReview(reviewId: string): Promise<ActionResult> {
  const { supabase, user } = await getAuthUser();
  if (!user) return { error: "Not authenticated" };
  const idErr = requireUuid(reviewId, "review id");
  if (idErr) return { error: idErr };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { error } = await db.from("reviews").delete().eq("id", reviewId);
  if (error) return { error: sanitizeError(error, "admin") };
  revalidatePath("/admin/reviews");
  return { success: true };
}

// ── Ads ───────────────────────────────────────────────────────────────────────

export async function updateAdStatus(
  adId: string,
  status: "active" | "paused" | "rejected" | "expired",
): Promise<ActionResult> {
  const { supabase, user } = await getAuthUser();
  if (!user) return { error: "Not authenticated" };
  const idErr = requireUuid(adId, "ad id");
  if (idErr) return { error: idErr };
  if (!["active", "paused", "rejected", "expired"].includes(status)) {
    return { error: "Invalid ad status." };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { error } = await db
    .from("advertisements")
    .update({ status })
    .eq("id", adId);

  if (error) return { error: sanitizeError(error, "admin") };
  revalidatePath("/admin/advertisements");
  revalidatePath("/");
  return { success: true };
}

// Admin: create a new ad. RLS (ads_write) requires is_admin() — anon/customer/
// owner sessions are rejected by Postgres even if they reach here.
// All free-text fields pass through sanitizeAdText; URLs go through
// validateTargetUrl which rejects javascript:/data:/file: and non-http(s).
export type AdInput = {
  title:           string;
  imageUrl:        string;
  targetUrl:       string;
  advertiserName:  string;
  placement:       string;
  startDate:       string | null;
  endDate:         string | null;
  status?:         "pending" | "active" | "paused" | "rejected";
};

function normalizeAdInput(input: AdInput): { row: Record<string, unknown> } | { error: string } {
  const title = sanitizeAdText(input.title, 200);
  if (!title) return { error: "Title is required." };

  const advertiser = sanitizeAdText(input.advertiserName, 120);
  if (!advertiser) return { error: "Advertiser name is required." };

  if (!isValidPlacement(input.placement)) return { error: "Invalid placement." };

  const target = validateTargetUrl(input.targetUrl);
  if (!target.ok) return { error: target.error };

  const image = validateImageUrl(input.imageUrl);
  if (!image.ok) return { error: `Image URL: ${image.error}` };

  const startDate = input.startDate || null;
  const endDate   = input.endDate   || null;
  if (startDate && endDate && endDate < startDate) {
    return { error: "End date must be after start date." };
  }

  const allowedStatus = new Set(["pending", "active", "paused", "rejected"]);
  const status = input.status && allowedStatus.has(input.status) ? input.status : "active";

  return {
    row: {
      title,
      advertiser_name: advertiser,
      image_url: image.url,
      target_url: target.url,
      placement: input.placement,
      start_date: startDate,
      end_date: endDate,
      status,
    },
  };
}

export async function createAdvertisement(input: AdInput): Promise<ActionResult> {
  const { supabase, user } = await getAuthUser();
  if (!user) return { error: "Not authenticated" };

  const norm = normalizeAdInput(input);
  if ("error" in norm) return { error: norm.error };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { error } = await db.from("advertisements").insert(norm.row);

  if (error) {
    if (error.code === "42703") return { error: "Database not migrated — apply migration 0014." };
    return { error: sanitizeError(error, "createAdvertisement") };
  }

  revalidatePath("/admin/advertisements");
  revalidatePath("/");
  return { success: true };
}

export async function updateAdvertisement(
  adId: string,
  input: AdInput,
): Promise<ActionResult> {
  const { supabase, user } = await getAuthUser();
  if (!user) return { error: "Not authenticated" };
  const idErr = requireUuid(adId, "ad id");
  if (idErr) return { error: idErr };

  const norm = normalizeAdInput(input);
  if ("error" in norm) return { error: norm.error };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { error } = await db
    .from("advertisements")
    .update(norm.row)
    .eq("id", adId);

  if (error) return { error: sanitizeError(error, "admin") };
  revalidatePath("/admin/advertisements");
  revalidatePath("/");
  return { success: true };
}

export async function deleteAdvertisement(adId: string): Promise<ActionResult> {
  const { supabase, user } = await getAuthUser();
  if (!user) return { error: "Not authenticated" };
  const idErr = requireUuid(adId, "ad id");
  if (idErr) return { error: idErr };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { error } = await db.from("advertisements").delete().eq("id", adId);

  if (error) return { error: sanitizeError(error, "admin") };
  revalidatePath("/admin/advertisements");
  revalidatePath("/");
  return { success: true };
}

// ── Premium listings ──────────────────────────────────────────────────────────

export async function togglePremiumActive(listingId: string, isActive: boolean): Promise<ActionResult> {
  const { supabase, user } = await getAuthUser();
  if (!user) return { error: "Not authenticated" };
  const idErr = requireUuid(listingId, "listing id");
  if (idErr) return { error: idErr };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { error } = await db
    .from("premium_listings")
    .update({ is_active: isActive })
    .eq("id", listingId);

  if (error) return { error: sanitizeError(error, "admin") };
  revalidatePath("/admin/premium-listings");
  return { success: true };
}

// ── Booking cleanup ───────────────────────────────────────────────────────────
// Manually runs the expired-pending-bookings cleanup function (migration 0011).
// Normally driven by pg_cron; this is the on-demand admin button.

export async function cleanupExpiredBookings(): Promise<
  { success: true; cleaned: number } | { error: string }
> {
  const { supabase, user } = await getAuthUser();
  if (!user) return { error: "Not authenticated" };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Fallback path: if the cleanup RPC isn't deployed, do it inline through
  // a regular UPDATE — admins satisfy the validate_booking_transition trigger
  // because is_admin() bypasses it.
  const { data, error } = await db.rpc("cleanup_expired_pending_bookings");

  if (error) {
    // Function not deployed yet — fall back to the same logic via SQL.
    const fallback = await db
      .from("bookings")
      .update({ status: "cancelled", cancel_reason: "Payment window expired" })
      .eq("status", "pending_payment")
      .lt("expires_at", new Date().toISOString())
      .select("id");

    if (fallback.error) return { error: fallback.error.message };
    revalidatePath("/admin/bookings");
    revalidatePath("/admin/dashboard");
    return { success: true, cleaned: fallback.data?.length ?? 0 };
  }

  revalidatePath("/admin/bookings");
  revalidatePath("/admin/dashboard");
  return { success: true, cleaned: Number(data ?? 0) };
}

// ── Premium listings (admin manual activation) ───────────────────────────────
// Owners CANNOT call these. The premium_listings table has no client write
// policy (RLS), and the guard_premium_listing_writes trigger (migration 0013)
// rejects any write that isn't from a trusted backend or admin. So this action
// is the ONLY path an admin uses to manually grant premium during MVP, and the
// payment webhook is the other path post-launch.

export async function createPremiumListing(input: {
  hallId:    string;
  planSlug:  "premium" | "pro";
  startDate: string; // YYYY-MM-DD
  endDate:   string; // YYYY-MM-DD
  amount:    number;
}): Promise<ActionResult> {
  const { supabase, user } = await getAuthUser();
  if (!user) return { error: "Not authenticated" };

  const parsed = parseSafe(premiumListingSchema, input);
  if (!parsed.ok) return { error: parsed.error };
  const v = parsed.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { error } = await db.from("premium_listings").insert({
    hall_id:    v.hallId,
    plan_slug:  v.planSlug,
    start_date: v.startDate,
    end_date:   v.endDate,
    amount:     Math.round(v.amount * 100) / 100,
    is_active:  true,
  });

  if (error) return { error: sanitizeError(error, "admin") };
  revalidatePath("/admin/premium-listings");
  revalidatePath("/admin/dashboard");
  return { success: true };
}

export async function updatePremiumPlan(input: {
  slug:          "premium" | "pro";
  monthly_price: number;
  duration_days: number;
}): Promise<ActionResult> {
  const { supabase, user } = await getAuthUser();
  if (!user) return { error: "Not authenticated" };

  const parsed = parseSafe(premiumPlanUpdateSchema, input);
  if (!parsed.ok) return { error: parsed.error };
  const v = parsed.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { error } = await db
    .from("premium_plans")
    .update({
      monthly_price: Math.round(v.monthly_price * 100) / 100,
      duration_days: v.duration_days,
    })
    .eq("slug", v.slug);

  if (error) return { error: sanitizeError(error, "admin") };
  revalidatePath("/admin/settings");
  revalidatePath("/owner/premium/upgrade");
  return { success: true };
}

// ── Platform settings ─────────────────────────────────────────────────────────
// Updates the global commission percentage. RLS allows only admins to write
// the platform_settings row; validation is also done server-side here so a
// malicious form post can't sneak past the UI.

export async function updateCommissionPercent(
  percent: number,
): Promise<ActionResult> {
  const { supabase, user } = await getAuthUser();
  if (!user) return { error: "Not authenticated" };

  const parsed = parseSafe(commissionPercentSchema, percent);
  if (!parsed.ok) return { error: parsed.error };
  const clean = Math.round(parsed.data * 100) / 100; // 2-decimal precision

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { error } = await db
    .from("platform_settings")
    .upsert(
      { id: true, commission_percent: clean, updated_by: user.id },
      { onConflict: "id" },
    );

  if (error) return { error: sanitizeError(error, "admin") };
  revalidatePath("/admin/settings");
  revalidatePath("/admin/commissions");
  revalidatePath("/admin/dashboard");
  return { success: true };
}

// ── Support tickets ───────────────────────────────────────────────────────────

export async function respondToTicket(
  ticketId: string,
  data: { status: string; adminResponse?: string; internalNotes?: string },
): Promise<ActionResult> {
  const { supabase, user } = await getAuthUser();
  if (!user) return { error: "Not authenticated" };
  const idErr = requireUuid(ticketId, "ticket id");
  if (idErr) return { error: idErr };

  const parsed = parseSafe(ticketResponseSchema, data);
  if (!parsed.ok) return { error: parsed.error };
  const v = parsed.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const update: Record<string, unknown> = {
    status: v.status,
    assigned_to: user.id,
  };
  if (v.adminResponse)              update.admin_response = v.adminResponse;
  if (data.internalNotes !== undefined) update.internal_notes = v.internalNotes || null;

  let { error } = await db.from("support_tickets").update(update).eq("id", ticketId);

  // 42703 = internal_notes column not yet provisioned (pre-migration 0016) — retry without it.
  if (error?.code === "42703" && "internal_notes" in update) {
    const { internal_notes: _drop, ...rest } = update;
    void _drop;
    ({ error } = await db.from("support_tickets").update(rest).eq("id", ticketId));
  }

  if (error) return { error: sanitizeError(error, "admin") };
  revalidatePath("/admin/support-tickets");
  revalidatePath("/admin/dashboard");
  return { success: true };
}
