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
import { recordAdminAction } from "@/lib/audit";
import {
  notifyHallModerated,
  notifyCommissionVerification,
  notifyPremiumChanged,
} from "@/lib/notifications/events";
import type { OverdueRunSummary } from "@/lib/commissions";

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

/**
 * Server-side ADMIN gate for privileged actions.
 *
 * getAuthUser() only proves *authentication*. Without a role check, a
 * non-admin calling one of these server actions directly hit RLS, which
 * silently filtered the rows — the statement affected 0 rows, raised no error,
 * and the action returned { success: true }. That reported a privileged change
 * that never happened. Every sensitive admin action now starts here.
 */
async function requireAdminActor() {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Not authenticated" };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: profile } = await (supabase as any)
    .from("profiles").select("role, is_active").eq("id", user.id).maybeSingle();

  if (profile?.role !== "admin") return { ok: false as const, error: "Admin access required." };
  if (profile?.is_active === false) return { ok: false as const, error: "This admin account is deactivated." };
  return { ok: true as const, supabase, user };
}

/** Moderation reason: trimmed, length-capped, plain text. */
function cleanReason(raw?: string | null): string | null {
  const t = (raw ?? "").toString().trim();
  if (t === "") return null;
  return t.replace(/\s+/g, " ").slice(0, 1000);
}

// ── Hall approval ─────────────────────────────────────────────────────────────

export async function approveHall(hallId: string): Promise<ActionResult> {
  return moderateHall(hallId, "approved", "hall.approve");
}

export async function rejectHall(hallId: string, reason?: string): Promise<ActionResult> {
  return moderateHall(hallId, "rejected", "hall.reject", reason);
}

export async function suspendHall(hallId: string, reason?: string): Promise<ActionResult> {
  return moderateHall(hallId, "suspended", "hall.suspend", reason);
}

export async function unsuspendHall(hallId: string): Promise<ActionResult> {
  return moderateHall(hallId, "approved", "hall.unsuspend");
}

/**
 * Single authoritative path for every hall status change.
 *
 * Verifies the admin role SERVER-SIDE, captures the previous status, requires
 * the update to actually affect a row (an RLS-filtered write reports 0 rows
 * with NO error and would otherwise look like success), stores the moderation
 * reason so the owner can see why, and appends an attributable audit entry.
 */
async function moderateHall(
  hallId: string,
  newStatus: "approved" | "rejected" | "suspended",
  action: string,
  reason?: string,
): Promise<ActionResult> {
  const actor = await requireAdminActor();
  if (!actor.ok) return { error: actor.error };

  const idErr = requireUuid(hallId, "hall id");
  if (idErr) return { error: idErr };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = actor.supabase as any;

  const { data: current } = await db
    .from("halls").select("status").eq("id", hallId).maybeSingle();
  if (!current) return { error: "Hall not found." };

  const cleaned = cleanReason(reason);
  if ((newStatus === "rejected" || newStatus === "suspended") && !cleaned) {
    return { error: "Please provide a reason — the owner will see it." };
  }

  const { error, count } = await db
    .from("halls")
    .update({
      status:           newStatus,
      rejection_reason: newStatus === "approved" ? null : cleaned,
      moderated_at:     new Date().toISOString(),
      moderated_by:     actor.user.id,
    }, { count: "exact" })
    .eq("id", hallId);

  if (error) return { error: sanitizeError(error, "admin") };
  if (count === 0) return { error: "You do not have permission to moderate this hall." };

  await recordAdminAction({
    action,
    entityType:     "hall",
    entityId:       hallId,
    previousStatus: current.status,
    newStatus,
    reason:         cleaned,
  });

  // Owner SMS: approved / rejected(+reason) / suspended(+reason) / restored.
  // "unsuspend" and a fresh approval both land on status=approved — the action
  // string distinguishes them for the right wording.
  const smsKind =
    action === "hall.unsuspend" ? "unsuspended"
    : newStatus === "approved"  ? "approved"
    : newStatus === "rejected"  ? "rejected"
    : "suspended";
  await notifyHallModerated(hallId, smsKind, cleaned);

  revalidatePath("/admin/halls");
  revalidatePath("/admin/hall-approvals");
  revalidatePath("/admin/dashboard");
  revalidatePath("/admin/audit-logs");
  revalidatePath("/owner/halls");
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

  await recordAdminAction({
    action:     "owner.approve",
    entityType: "user",
    entityId:   profileId,
    newStatus:  "owner_approved",
  });

  revalidatePath("/admin/owners");
  revalidatePath("/admin/users");
  revalidatePath("/admin/dashboard");
  revalidatePath("/admin/audit-logs");
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

  await recordAdminAction({
    action:     "owner.reject",
    entityType: "user",
    entityId:   profileId,
    newStatus:  "customer",
  });

  revalidatePath("/admin/owners");
  revalidatePath("/admin/users");
  revalidatePath("/admin/audit-logs");
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

  await recordAdminAction({
    action:     "owner.verify",
    entityType: "hall_owner",
    entityId:   ownerRowId,
    newStatus:  "verified",
  });

  revalidatePath("/admin/owners");
  revalidatePath("/admin/audit-logs");
  return { success: true };
}

// ── User management ───────────────────────────────────────────────────────────

export async function toggleUserActive(
  profileId: string,
  active: boolean,
  reason?: string,
): Promise<ActionResult> {
  const actor = await requireAdminActor();
  if (!actor.ok) return { error: actor.error };
  const idErr = requireUuid(profileId, "profile id");
  if (idErr) return { error: idErr };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = actor.supabase as any;

  // Safety: never let an admin deactivate themselves.
  if (profileId === actor.user.id && !active) {
    return { error: "You cannot deactivate your own account." };
  }

  const { data: before } = await db
    .from("profiles").select("role, is_active").eq("id", profileId).maybeSingle();
  if (!before) return { error: "User not found." };

  // Suspending an admin would lock a colleague out of the control centre —
  // require it to be done deliberately, not from a one-click list row.
  if (before.role === "admin" && !active) {
    return { error: "Admin accounts cannot be suspended from this screen." };
  }

  const { error, count } = await db
    .from("profiles")
    .update({ is_active: active }, { count: "exact" })
    .eq("id", profileId);

  if (error) return { error: sanitizeError(error, "admin") };
  if (count === 0) return { error: "You do not have permission to change this account." };

  await recordAdminAction({
    action:         active ? "user.reactivate" : "user.suspend",
    entityType:     "user",
    entityId:       profileId,
    previousStatus: before.is_active ? "active" : "suspended",
    newStatus:      active ? "active" : "suspended",
    reason:         cleanReason(reason),
    metadata:       { role: before.role },
  });

  revalidatePath("/admin/users");
  revalidatePath("/admin/owners");
  revalidatePath("/admin/audit-logs");
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

  const { error, count } = await db
    .from("reviews")
    .update({ is_visible: visible }, { count: "exact" })
    .eq("id", reviewId);

  if (error) return { error: sanitizeError(error, "admin") };
  if (count === 0) return { error: "You do not have permission to moderate this review." };

  await recordAdminAction({
    action:         visible ? "review.show" : "review.hide",
    entityType:     "review",
    entityId:       reviewId,
    previousStatus: visible ? "hidden" : "visible",
    newStatus:      visible ? "visible" : "hidden",
  });

  revalidatePath("/admin/reviews");
  revalidatePath("/admin/audit-logs");
  return { success: true };
}

export async function deleteReview(reviewId: string): Promise<ActionResult> {
  const { supabase, user } = await getAuthUser();
  if (!user) return { error: "Not authenticated" };
  const idErr = requireUuid(reviewId, "review id");
  if (idErr) return { error: idErr };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Snapshot first: once the row is gone the audit entry is the only record
  // that it ever existed, so capture the identifying details up front.
  const { data: before } = await db
    .from("reviews").select("hall_id, rating, is_visible").eq("id", reviewId).maybeSingle();
  if (!before) return { error: "Review not found." };

  const { error, count } = await db
    .from("reviews").delete({ count: "exact" }).eq("id", reviewId);
  if (error) return { error: sanitizeError(error, "admin") };
  if (count === 0) return { error: "You do not have permission to delete this review." };

  await recordAdminAction({
    action:         "review.delete",
    entityType:     "review",
    entityId:       reviewId,
    previousStatus: before.is_visible ? "visible" : "hidden",
    newStatus:      "deleted",
    metadata:       { hall_id: before.hall_id, rating: before.rating },
  });

  revalidatePath("/admin/reviews");
  revalidatePath("/admin/audit-logs");
  return { success: true };
}

// ── Ads ───────────────────────────────────────────────────────────────────────

export async function updateAdStatus(
  adId: string,
  status: "active" | "paused" | "rejected" | "expired",
): Promise<ActionResult> {
  const actor = await requireAdminActor();
  if (!actor.ok) return { error: actor.error };
  const idErr = requireUuid(adId, "ad id");
  if (idErr) return { error: idErr };
  if (!["active", "paused", "rejected", "expired"].includes(status)) {
    return { error: "Invalid ad status." };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = actor.supabase as any;

  const { data: before } = await db
    .from("advertisements").select("status, title").eq("id", adId).maybeSingle();
  if (!before) return { error: "Advertisement not found." };

  const { error, count } = await db
    .from("advertisements")
    .update({ status }, { count: "exact" })
    .eq("id", adId);

  if (error) return { error: sanitizeError(error, "admin") };
  if (count === 0) return { error: "You do not have permission to change this advertisement." };

  await recordAdminAction({
    action:         `ad.${status === "active" ? "approve" : status}`,
    entityType:     "advertisement",
    entityId:       adId,
    previousStatus: before.status,
    newStatus:      status,
    metadata:       { title: before.title },
  });
  revalidatePath("/admin/audit-logs");
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
  const actor = await requireAdminActor();
  if (!actor.ok) return { error: actor.error };
  const idErr = requireUuid(adId, "ad id");
  if (idErr) return { error: idErr };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = actor.supabase as any;

  // Snapshot before the row disappears — afterwards the audit entry is the only
  // record the ad ever existed.
  const { data: before } = await db
    .from("advertisements").select("status, title").eq("id", adId).maybeSingle();
  if (!before) return { error: "Advertisement not found." };

  const { error, count } = await db
    .from("advertisements").delete({ count: "exact" }).eq("id", adId);
  if (error) return { error: sanitizeError(error, "admin") };
  if (count === 0) return { error: "You do not have permission to delete this advertisement." };

  // Logged only AFTER the delete actually affected a row.
  await recordAdminAction({
    action:         "ad.delete",
    entityType:     "advertisement",
    entityId:       adId,
    previousStatus: before.status,
    newStatus:      "deleted",
    metadata:       { title: before.title },
  });

  revalidatePath("/admin/advertisements");
  revalidatePath("/admin/audit-logs");
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

  const { data: before } = await db
    .from("premium_listings").select("hall_id, is_active, plan_slug").eq("id", listingId).maybeSingle();
  if (!before) return { error: "Premium listing not found." };

  const { error, count } = await db
    .from("premium_listings")
    .update({ is_active: isActive }, { count: "exact" })
    .eq("id", listingId);

  if (error) return { error: sanitizeError(error, "admin") };
  // premium_listings had NO update policy at one point, so a "successful"
  // deactivate silently changed nothing. Never report success on 0 rows.
  if (count === 0) return { error: "You do not have permission to change this listing." };

  await recordAdminAction({
    action:         isActive ? "premium.activate" : "premium.cancel",
    entityType:     "premium_listing",
    entityId:       listingId,
    previousStatus: before.is_active ? "active" : "inactive",
    newStatus:      isActive ? "active" : "inactive",
    metadata:       { hall_id: before.hall_id },
  });

  // Non-critical SMS — respects the owner's notification preference.
  await notifyPremiumChanged(listingId, before.hall_id, isActive, before.plan_slug === "pro" ? "Pro" : "Premium");

  revalidatePath("/admin/premium-listings");
  revalidatePath("/admin/audit-logs");
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

  const { data: listing, error } = await db.from("premium_listings").insert({
    hall_id:    v.hallId,
    plan_slug:  v.planSlug,
    start_date: v.startDate,
    end_date:   v.endDate,
    amount:     Math.round(v.amount * 100) / 100,
    is_active:  true,
  }).select("id").single();

  if (error) return { error: sanitizeError(error, "admin") };

  // Non-critical owner SMS — respects the owner's notification preference.
  await notifyPremiumChanged(listing.id, v.hallId, true, v.planSlug === "pro" ? "Pro" : "Premium");

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

// ── Owner commission UPI payment verification ───────────────────────────────────
// Admin approves or rejects an owner's manual UPI payment submission. On
// approval the linked commission is marked paid (this is the ONLY path that
// marks a manual commission paid — owners can never do it themselves). All
// writes use the admin SESSION client so is_admin() satisfies RLS + the guard
// triggers while preserving the auth.uid() audit trail.
export async function verifyCommissionPayment(
  paymentId: string,
  decision: "approve" | "reject",
  adminNote?: string,
): Promise<ActionResult> {
  const actor = await requireAdminActor();
  if (!actor.ok) return { error: actor.error };
  const { supabase, user } = { supabase: actor.supabase, user: actor.user };
  const idErr = requireUuid(paymentId, "payment id");
  if (idErr) return { error: idErr };
  if (decision !== "approve" && decision !== "reject") return { error: "Invalid decision." };

  const note = (adminNote ?? "").toString().slice(0, 500).trim() || null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Load the submission (admin RLS = full read).
  const { data: pay, error: pErr } = await db
    .from("owner_commission_payments")
    .select("id, commission_id, upi_reference, status")
    .eq("id", paymentId)
    .maybeSingle();
  if (pErr) return { error: sanitizeError(pErr, "admin") };
  if (!pay) return { error: "Payment submission not found." };

  // Idempotency: don't re-verify an already-resolved submission.
  if (pay.status === "verified" || pay.status === "rejected") {
    return { error: `This submission is already ${pay.status}.` };
  }

  if (decision === "approve") {
    const { error: upErr } = await db
      .from("owner_commission_payments")
      .update({
        status:      "verified",
        verified_at: new Date().toISOString(),
        verified_by: user.id,
        admin_note:  note,
      })
      .eq("id", paymentId);
    if (upErr) return { error: sanitizeError(upErr, "admin") };

    // Mark the commission paid — server-authoritative, admin only.
    const { error: cErr } = await db
      .from("commissions")
      .update({
        status:            "paid",
        paid_at:           new Date().toISOString(),
        payment_method:    "upi_manual",
        payment_reference: pay.upi_reference ?? null,
        admin_note:        note,
      })
      .eq("id", pay.commission_id);
    if (cErr) return { error: sanitizeError(cErr, "admin") };
  } else {
    const { error: upErr } = await db
      .from("owner_commission_payments")
      .update({ status: "rejected", verified_by: user.id, admin_note: note })
      .eq("id", paymentId);
    if (upErr) return { error: sanitizeError(upErr, "admin") };
    // Commission stays pending/overdue so the owner can re-submit.
  }

  await notifyCommissionVerification(paymentId, decision, note);

  await recordAdminAction({
    action:         decision === "approve" ? "commission.payment.approve" : "commission.payment.reject",
    entityType:     "commission_payment",
    entityId:       paymentId,
    previousStatus: pay.status,
    newStatus:      decision === "approve" ? "verified" : "rejected",
    reason:         note,
    // upi_reference is a payment identifier, not a secret/credential.
    metadata:       { commission_id: pay.commission_id },
  });

  revalidatePath("/admin/commissions");
  revalidatePath("/owner/commissions");
  revalidatePath("/admin/audit-logs");
  return { success: true };
}

// ── Manual overdue-commission sweep (admin button) ──────────────────────────────
// Verifies admin session server-side, then runs the same idempotent engine the
// cron route uses. The engine (lib/commissions) uses the service-role client for
// its system writes; the admin check here is the authorization gate.
export async function runOverdueCommissionCheckAction(): Promise<
  | { success: true; summary: OverdueRunSummary }
  | { error: string }
> {
  const { user } = await getAuthUser();
  if (!user) return { error: "Not authenticated" };

  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: profile } = await (supabase as any)
    .from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") return { error: "Admin access required." };

  const { runOverdueCommissionCheck } = await import("@/lib/commissions");
  try {
    const summary = await runOverdueCommissionCheck();
    revalidatePath("/admin/commissions");
    return { success: true, summary };
  } catch {
    return { error: "Overdue check failed. Check server logs." };
  }
}

// ── Platform payment settings (UPI, due days, advance %, feature flags) ─────────
export async function updatePlatformPaymentSettings(input: {
  hallnectUpiId?: string;
  hallnectUpiQrUrl?: string;
  commissionDueDays?: number;
  defaultAdvancePercentage?: number;
  enableOnlineCustomerPayment?: boolean;
  enableOwnerUpiPayment?: boolean;
  enableAutoCommissionAdjustment?: boolean;
}): Promise<ActionResult> {
  const { supabase, user } = await getAuthUser();
  if (!user) return { error: "Not authenticated" };

  // Validate + normalise (never trust the client blindly).
  const upiId = (input.hallnectUpiId ?? "").trim().slice(0, 120);
  if (upiId && !/^[\w.\-]{2,64}@[a-zA-Z]{2,64}$/.test(upiId)) {
    return { error: "Enter a valid UPI ID (e.g. hallnect@okicici)." };
  }
  const qr = (input.hallnectUpiQrUrl ?? "").trim().slice(0, 500);
  if (qr && !/^https?:\/\//i.test(qr)) return { error: "UPI QR must be a valid URL." };

  const dueDays = Number(input.commissionDueDays ?? 7);
  if (!Number.isInteger(dueDays) || dueDays < 1 || dueDays > 90) {
    return { error: "Commission due days must be between 1 and 90." };
  }
  const advancePct = Number(input.defaultAdvancePercentage ?? 20);
  if (!Number.isFinite(advancePct) || advancePct < 0 || advancePct > 100) {
    return { error: "Default advance percentage must be between 0 and 100." };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { error } = await db.from("platform_settings").upsert(
    {
      id: true,
      hallnect_upi_id:                 upiId || null,
      hallnect_upi_qr_url:             qr || null,
      commission_due_days:             dueDays,
      default_advance_percentage:      advancePct,
      enable_online_customer_payment:  Boolean(input.enableOnlineCustomerPayment),
      enable_owner_upi_payment:        Boolean(input.enableOwnerUpiPayment),
      enable_auto_commission_adjustment: Boolean(input.enableAutoCommissionAdjustment),
      updated_by: user.id,
    },
    { onConflict: "id" },
  );

  if (error) return { error: sanitizeError(error, "admin") };
  revalidatePath("/admin/settings");
  revalidatePath("/admin/commissions");
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

// ── SMS notification center actions ─────────────────────────────────────────

/**
 * Retries one failed/skipped SMS. Admin-only (server-verified), capped at
 * MAX_SEND_ATTEMPTS per notification, audit-logged. This is the ONLY manual
 * send path in the app — and even it cannot choose a phone number or message:
 * both are locked into the outbox row that the server composed originally.
 */
export async function retryNotification(notificationId: string): Promise<ActionResult> {
  const actor = await requireAdminActor();
  if (!actor.ok) return { error: actor.error };
  const idErr = requireUuid(notificationId, "notification id");
  if (idErr) return { error: idErr };

  // Service-role client: status updates on the outbox are trusted-backend writes.
  const { getSupabaseAdminClient } = await import("@/lib/supabase/admin");
  const { attemptSend, MAX_SEND_ATTEMPTS } = await import("@/lib/notifications/service");
  const admin = getSupabaseAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = admin as any;

  const { data: row } = await db
    .from("notifications")
    .select("id, status, recipient_phone, message, attempt_count, created_at")
    .eq("id", notificationId)
    .maybeSingle();
  if (!row) return { error: "Notification not found." };

  if (row.status === "sent") return { error: "This SMS was already sent." };
  // failed/skipped are always retryable. pending/processing normally means a
  // send is in flight — but a crash between claim and result strands the row
  // forever, so allow retry once the row is clearly stale (15+ min old).
  if (row.status !== "failed" && row.status !== "skipped") {
    const ageMs = Date.now() - new Date(row.created_at).getTime();
    if ((row.status !== "pending" && row.status !== "processing") || ageMs < 15 * 60 * 1000) {
      return { error: `Only failed or skipped notifications can be retried (this one is ${row.status}).` };
    }
  }
  if (!row.recipient_phone) return { error: "This notification has no valid recipient phone number." };
  if (row.attempt_count >= MAX_SEND_ATTEMPTS) {
    return { error: `Maximum of ${MAX_SEND_ATTEMPTS} attempts reached for this notification.` };
  }

  const result = await attemptSend(db, row.id, row.recipient_phone, row.message, /* isRetry */ true);

  await recordAdminAction({
    action:     "notification.retry",
    entityType: "notification",
    entityId:   notificationId,
    newStatus:  result.sent ? "sent" : "failed",
    reason:     result.sent ? null : result.error ?? null,
  });

  revalidatePath("/admin/notifications");
  if (!result.sent) return { error: result.error ?? "Send failed. See the notification's error details." };
  return { success: true };
}

/** Marks all currently-unread notifications as read. */
export async function markAllNotificationsRead(): Promise<ActionResult> {
  const actor = await requireAdminActor();
  if (!actor.ok) return { error: actor.error };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = actor.supabase as any;
  const { error } = await db
    .from("notifications")
    .update({ is_read: true })
    .eq("is_read", false);

  if (error) return { error: sanitizeError(error, "admin") };
  revalidatePath("/admin/notifications");
  return { success: true };
}

/** Marks one notification as read. */
export async function markNotificationRead(notificationId: string): Promise<ActionResult> {
  const actor = await requireAdminActor();
  if (!actor.ok) return { error: actor.error };
  const idErr = requireUuid(notificationId, "notification id");
  if (idErr) return { error: idErr };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = actor.supabase as any;
  const { error } = await db
    .from("notifications")
    .update({ is_read: true })
    .eq("id", notificationId);

  if (error) return { error: sanitizeError(error, "admin") };
  revalidatePath("/admin/notifications");
  return { success: true };
}
