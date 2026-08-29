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
  couponCreateSchema,
  parseSafe,
} from "@/lib/validation/schemas";
import { sanitizeError } from "@/lib/errors";
import { recordAdminAction } from "@/lib/audit";
import { createCashfreeRefund, getCashfreeRefund, classifyRefundStatus } from "@/lib/cashfree";
import { payOwnerOnAcceptance } from "@/lib/owner-payout";
import { notifyBookingEvent,
  notifyOwnerAccountDecision,
  notifyAdminOperational,
} from "@/lib/notifications/events";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  notifyHallModerated,
  notifyPremiumChanged,
} from "@/lib/notifications/events";
import type { BookingExpirySummary } from "@/lib/booking-expiry";
import type { PremiumExpirySummary } from "@/lib/premium-expiry";
import { DEFAULT_ADVANCE_PERCENT } from "@/lib/booking-payment";

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

  // Owner WhatsApp: approved / rejected(+reason) / suspended(+reason) / restored.
  // "unsuspend" and a fresh approval both land on status=approved — the action
  // string distinguishes them for the right wording.
  const moderationKind =
    action === "hall.unsuspend" ? "unsuspended"
    : newStatus === "approved"  ? "approved"
    : newStatus === "rejected"  ? "rejected"
    : "suspended";
  await notifyHallModerated(hallId, moderationKind, cleaned);

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
  const actor = await requireAdminActor();
  if (!actor.ok) return { error: actor.error };
  const user = actor.user;
  const idErr = requireUuid(profileId, "profile id");
  if (idErr) return { error: idErr };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = actor.supabase as any;

  // 1. Promote profile role to owner_approved. count:"exact" because an
  //    RLS-filtered update reports 0 rows with NO error — reporting success for
  //    a role change that never happened is exactly the bug fixed elsewhere.
  const { error: roleErr, count } = await db
    .from("profiles")
    .update({ role: "owner_approved" }, { count: "exact" })
    .eq("id", profileId);
  if (roleErr) return { error: sanitizeError(roleErr, "admin") };
  if (count === 0) return { error: "You do not have permission to change this account." };

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

  // Tell them. An owner who signed up and is waiting on a human decision had no
  // way to learn it had been made — they simply had to keep checking.
  await notifyOwnerAccountDecision({ profileId, kind: "approved" });

  revalidatePath("/admin/owners");
  revalidatePath("/admin/users");
  revalidatePath("/admin/dashboard");
  revalidatePath("/admin/audit-logs");
  return { success: true };
}

export async function rejectOwner(profileId: string): Promise<ActionResult> {
  const actor = await requireAdminActor();
  if (!actor.ok) return { error: actor.error };
  const idErr = requireUuid(profileId, "profile id");
  if (idErr) return { error: idErr };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = actor.supabase as any;

  // Downgrade to customer.
  const { error, count } = await db
    .from("profiles")
    .update({ role: "customer" }, { count: "exact" })
    .eq("id", profileId);

  if (error) return { error: sanitizeError(error, "admin") };
  if (count === 0) return { error: "You do not have permission to change this account." };

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
  // Admin-gated and count-checked, like every other privileged write here.
  // With only getAuthUser() any signed-in user could invoke this directly;
  // RLS filtered their update to zero rows WITHOUT raising, so they got
  // {success:true} for a verification that never happened — and an audit entry
  // was attempted for it.
  const actor = await requireAdminActor();
  if (!actor.ok) return { error: actor.error };
  const user = actor.user;
  const idErr = requireUuid(ownerRowId, "owner row id");
  if (idErr) return { error: idErr };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = actor.supabase as any;

  const { error, count } = await db
    .from("hall_owners")
    .update({ is_verified: true, verified_at: new Date().toISOString(), verified_by: user.id }, { count: "exact" })
    .eq("id", ownerRowId);

  if (error) return { error: sanitizeError(error, "admin") };
  if ((count ?? 0) === 0) return { error: "Owner not found, or you do not have permission to verify them." };

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

  // Suspension locks them out immediately — requireAuth() bounces a deactivated
  // profile to /login?error=account_disabled — while their halls stay live and
  // any pending booking request keeps counting down to auto-cancel, which they
  // can no longer answer. The reason the admin typed goes into an audit log
  // only admins can read, so without this the person is locked out with no
  // explanation and no route back. The reason is passed on to them.
  await notifyOwnerAccountDecision({
    profileId,
    kind:   active ? "restored" : "suspended",
    reason: cleanReason(reason),
  });

  revalidatePath("/admin/users");
  revalidatePath("/admin/owners");
  revalidatePath("/admin/audit-logs");
  return { success: true };
}

// ── Review moderation ────────────────────────────────────────────────────────

export async function toggleReviewVisible(reviewId: string, visible: boolean): Promise<ActionResult> {
  // requireAdminActor, NOT getAuthUser. getAuthUser proves only that SOMEONE is
  // signed in, and reviews_update RLS is `customer_id = auth.uid() or
  // is_admin()` with no column restriction — so an author could call this
  // server action directly (they are directly invocable) and flip is_visible
  // back to true on their own moderated review. RLS matched their row, the
  // count was 1, and the action reported success: moderation undone, and the
  // audit insert silently dropped because they are not an admin.
  const actor = await requireAdminActor();
  if (!actor.ok) return { error: actor.error };
  const idErr = requireUuid(reviewId, "review id");
  if (idErr) return { error: idErr };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = actor.supabase as any;

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
  // Admin-only, for the same reason as toggleReviewVisible above.
  const actor = await requireAdminActor();
  if (!actor.ok) return { error: actor.error };
  const idErr = requireUuid(reviewId, "review id");
  if (idErr) return { error: idErr };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = actor.supabase as any;

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
  const actor = await requireAdminActor();
  if (!actor.ok) return { error: actor.error };
  const idErr = requireUuid(adId, "ad id");
  if (idErr) return { error: idErr };

  const norm = normalizeAdInput(input);
  if ("error" in norm) return { error: norm.error };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = actor.supabase as any;
  const { error, count } = await db
    .from("advertisements")
    .update(norm.row, { count: "exact" })
    .eq("id", adId);

  if (error) return { error: sanitizeError(error, "admin") };
  if ((count ?? 0) === 0) return { error: "Advertisement not found, or you do not have permission to edit it." };
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

  // Non-critical message — respects the owner's notification preference.
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

  // Non-critical owner message — respects the owner's notification preference.
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

/**
 * Cancels booking requests the owner never answered inside the 48-hour window,
 * refunds the customer and frees the dates.
 *
 * The deadline has always been stamped and displayed; nothing acted on it, so
 * an ignored request held the customer's money and blocked the calendar
 * indefinitely. Also exposed as POST /api/admin/bookings/expire-overdue for a
 * scheduled caller — this button is for running it now.
 */
export async function expireOverdueBookingsAction(): Promise<
  | { success: true; summary: BookingExpirySummary }
  | { error: string }
> {
  const actor = await requireAdminActor();
  if (!actor.ok) return { error: actor.error };

  const { expireOverdueBookingRequests } = await import("@/lib/booking-expiry");
  try {
    const summary = await expireOverdueBookingRequests();

    if (summary.expired > 0) {
      await recordAdminAction({
        action:     "bookings.expire_overdue",
        entityType: "booking",
        entityId:   null,
        reason:     `Expired ${summary.expired} unanswered booking request(s)`,
        metadata:   { found: summary.found, refundsRecorded: summary.refundsRecorded },
      });
    }

    revalidatePath("/admin/bookings");
    revalidatePath("/admin/payments");
    revalidatePath("/admin/dashboard");
    return { success: true, summary };
  } catch {
    return { error: "Expiry sweep failed. Check server logs." };
  }
}

/**
 * Retires premium listings whose paid window has closed and clears any hall
 * still flagged premium without a live listing behind it.
 *
 * Nothing used to do this. recompute_hall_premium() only ran in reaction to a
 * WRITE on premium_listings, so once end_date passed the hall stayed promoted
 * in search and on the homepage forever, while this admin table correctly
 * showed the listing as Expired. Also exposed as GET/POST
 * /api/admin/premium/expire-listings for the scheduled caller — this button is
 * for running it now.
 */
export async function expirePremiumListingsAction(): Promise<
  | { success: true; summary: PremiumExpirySummary }
  | { error: string }
> {
  const actor = await requireAdminActor();
  if (!actor.ok) return { error: actor.error };

  const { expirePremiumListings } = await import("@/lib/premium-expiry");
  try {
    const summary = await expirePremiumListings();

    if (summary.deactivated > 0 || summary.hallsRecomputed > 0) {
      await recordAdminAction({
        action:     "premium.expire_listings",
        entityType: "premium_listing",
        entityId:   null,
        reason:     `Retired ${summary.deactivated} expired listing(s)`,
        metadata:   { ...summary },
      });
    }

    revalidatePath("/admin/premium-listings");
    revalidatePath("/owner/premium");
    revalidatePath("/");
    return { success: true, summary };
  } catch {
    return { error: "Premium expiry sweep failed. Check server logs." };
  }
}

// ── Platform payment settings (advance %, online-payment flag) ───────────────
// The UPI id/QR, commission due-days and the two owner-billing toggles were
// removed with the owner-billed commission model: commission is retained from
// the customer advance and owners are never invoiced, so none of them had any
// effect any more. Their columns are left in place rather than dropped — this
// action simply stops writing them.
export async function updatePlatformPaymentSettings(input: {
  defaultAdvancePercentage?: number;
  enableOnlineCustomerPayment?: boolean;
}): Promise<ActionResult> {
  // This gate used to be a bare 'is someone signed in' check, leaving the
  // write to be refused by RLS. It sets the advance every customer is charged,
  // so it is authorized like every other admin mutation here.
  const actor = await requireAdminActor();
  if (!actor.ok) return { error: actor.error };
  const { supabase, user } = { supabase: actor.supabase, user: actor.user };

  const advancePct = Number(input.defaultAdvancePercentage ?? DEFAULT_ADVANCE_PERCENT);
  if (!Number.isFinite(advancePct) || advancePct < 0 || advancePct > 100) {
    return { error: "Default advance percentage must be between 0 and 100." };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { error } = await db.from("platform_settings").upsert(
    {
      id: true,
      default_advance_percentage:     advancePct,
      enable_online_customer_payment: Boolean(input.enableOnlineCustomerPayment),
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

/** Marks a public contact-form message as read. Count-checked: RLS filtering a
 *  non-admin to zero rows must not report success. */
export async function markContactMessageRead(messageId: string): Promise<ActionResult> {
  const actor = await requireAdminActor();
  if (!actor.ok) return { error: actor.error };
  if (!parseSafe(uuidSchema, messageId).ok) return { error: "Invalid message id." };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = actor.supabase as any;
  const { error, count } = await db
    .from("contact_messages")
    .update({ is_read: true }, { count: "exact" })
    .eq("id", messageId);
  if (error) return { error: sanitizeError(error, "admin") };
  if ((count ?? 0) === 0) return { error: "Message not found." };

  revalidatePath("/admin/support-tickets");
  return { success: true };
}

export async function respondToTicket(
  ticketId: string,
  data: { status: string; adminResponse?: string; internalNotes?: string },
): Promise<ActionResult> {
  const actor = await requireAdminActor();
  if (!actor.ok) return { error: actor.error };
  const user = actor.user;
  const idErr = requireUuid(ticketId, "ticket id");
  if (idErr) return { error: idErr };

  const parsed = parseSafe(ticketResponseSchema, data);
  if (!parsed.ok) return { error: parsed.error };
  const v = parsed.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = actor.supabase as any;

  const update: Record<string, unknown> = {
    status: v.status,
    assigned_to: user.id,
  };
  if (v.adminResponse)              update.admin_response = v.adminResponse;
  if (data.internalNotes !== undefined) update.internal_notes = v.internalNotes || null;

  let { error, count } = await db
    .from("support_tickets").update(update, { count: "exact" }).eq("id", ticketId);

  // 42703 = internal_notes column not yet provisioned (pre-migration 0016) — retry without it.
  if (error?.code === "42703" && "internal_notes" in update) {
    const { internal_notes: _drop, ...rest } = update;
    void _drop;
    ({ error, count } = await db
      .from("support_tickets").update(rest, { count: "exact" }).eq("id", ticketId));
  }

  if (error) return { error: sanitizeError(error, "admin") };
  // A reply that reached no row must not report success — the customer would
  // never see it and the admin would believe it was sent.
  if ((count ?? 0) === 0) return { error: "Ticket not found, or you do not have permission to respond to it." };
  revalidatePath("/admin/support-tickets");
  revalidatePath("/admin/dashboard");
  return { success: true };
}

// ── WhatsApp notification center actions ────────────────────────────────────

/**
 * Sets the phone number that receives platform admin alerts.
 *
 * Stored on platform_settings (the existing single-row admin config table)
 * rather than in an environment variable, so it can be changed without a
 * redeploy. ADMIN_WHATSAPP_NUMBER remains a deployment-level fallback and
 * lib/constants CONTACT.phone the last resort — see getAdminNotificationPhone.
 *
 * Admin-only and audited. Normalised to E.164 before storage: the column has a
 * CHECK constraint requiring it, and an un-normalised number is one we could
 * never actually message.
 */
export async function updateAdminWhatsAppNumber(raw: string): Promise<ActionResult> {
  const actor = await requireAdminActor();
  if (!actor.ok) return { error: actor.error };

  const { normalizePhoneE164 } = await import("@/lib/notifications/phone");
  const trimmed = (raw ?? "").trim();

  // Empty clears the override and falls back to the env var / constant.
  let value: string | null = null;
  if (trimmed !== "") {
    value = normalizePhoneE164(trimmed);
    if (!value) {
      return { error: "Enter a valid mobile number, e.g. +91 98765 43210." };
    }
  }

  const { getSupabaseAdminClient } = await import("@/lib/supabase/admin");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getSupabaseAdminClient() as any;

  const { error } = await db
    .from("platform_settings")
    .upsert({ id: true, admin_whatsapp_phone: value, updated_by: actor.user.id }, { onConflict: "id" });

  if (error) return { error: sanitizeError(error, "admin") };

  await recordAdminAction({
    action:     "settings.admin_whatsapp_number",
    entityType: "platform_settings",
    entityId:   null,
    // The number itself is deliberately NOT recorded in the audit log: the log
    // is readable by every admin and this is a personal phone number. That it
    // changed, and by whom, is what matters.
    metadata:   { cleared: value === null },
  });

  revalidatePath("/admin/notifications");
  return { success: true };
}


/**
 * Retries one failed/skipped message. Admin-only (server-verified), capped at
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
    .select("id, status, recipient_phone, attempt_count, created_at, permanent_failure, " +
            "error_message, provider_message_id, recipient_type, booking_id, hall_id")
    .eq("id", notificationId)
    .maybeSingle();
  if (!row) return { error: "Notification not found." };

  if (row.status === "sent") return { error: "This message was already sent." };
  // failed/skipped are always retryable. pending/processing normally means a
  // send is in flight — but a crash between claim and result strands the row
  // forever, so allow retry once the row is clearly stale (15+ min old).
  if (row.status !== "failed" && row.status !== "skipped") {
    const ageMs = Date.now() - new Date(row.created_at).getTime();
    if ((row.status !== "pending" && row.status !== "processing") || ageMs < 15 * 60 * 1000) {
      return { error: `Only failed or skipped notifications can be retried (this one is ${row.status}).` };
    }
    // A stale row that ALREADY carries a Twilio message id was accepted by
    // Twilio — only the bookkeeping update failed. Resending it would deliver
    // the same message to the customer twice, which is worse than a row that
    // looks stuck. Only rows that never reached Twilio may be re-sent.
    if (row.provider_message_id) {
      return {
        error: "This message was already accepted by Twilio; resending would deliver it twice. Check its delivery status instead.",
      };
    }
  }
  // A row written when the recipient had NO usable number owns its dedupe key
  // forever, so a fresh dispatch can never replace it. Re-derive the recipient
  // from the linked booking/hall — if they have since added a valid number, the
  // message becomes deliverable instead of being lost. The phone is resolved
  // from the database, never from the request, so this cannot redirect it.
  if (!row.recipient_phone) {
    const { resolveRecipientPhoneForNotification } = await import("@/lib/notifications/events");
    const { normalizePhoneE164 } = await import("@/lib/notifications/phone");
    const repaired = normalizePhoneE164(
      (await resolveRecipientPhoneForNotification({
        recipientType: row.recipient_type,
        bookingId: row.booking_id,
        hallId: row.hall_id,
      })) ?? "",
    );
    if (!repaired) {
      return {
        error: "This notification has no valid recipient phone number, and the account still has none on file.",
      };
    }
    await db.from("notifications")
      .update({ recipient_phone: repaired, permanent_failure: false })
      .eq("id", notificationId);
    row.recipient_phone = repaired;
    row.permanent_failure = false;
  }
  if (row.attempt_count >= MAX_SEND_ATTEMPTS) {
    return { error: `Maximum of ${MAX_SEND_ATTEMPTS} attempts reached for this notification.` };
  }
  // A permanent failure (not a WhatsApp user, template unapproved, bad
  // credentials) repeats identically on retry and only burns an attempt.
  // 'skipped' rows are exempt: they are permanent-flagged only when a config
  // gap caused them, and fixing that config is exactly when a retry is right.
  if (row.permanent_failure && row.status === "failed") {
    return {
      error: `This cannot be retried as-is: ${row.error_message ?? "the failure is permanent"}.`,
    };
  }

  // attemptSend re-reads the recipient and template from the row itself, so an
  // admin retry cannot redirect the message or change its content.
  const result = await attemptSend(db, row.id, /* isRetry */ true);

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

// ── Refunds and payouts — moving real money from the dashboard ───────────────
//
// Everything below sends money, so each one holds the same line:
//   • requireAdminActor + a count check — RLS silently filters a write the
//     caller may not make to ZERO ROWS WITHOUT AN ERROR, and reporting success
//     for that would be a lie about a customer's money;
//   • the AMOUNT is read from the database, never from the caller. No action
//     here accepts an amount as an argument;
//   • idempotent by construction, because a double payout cannot be recalled;
//   • written to the append-only audit log before the money is anywhere.

/** Stable, unique refund id for a booking. Reused on every retry ON PURPOSE:
 *  Cashfree treats refund_id as the idempotency key, so replaying it returns
 *  the existing refund instead of issuing a second one. */
function refundIdFor(bookingId: string): string {
  return `HNR_${bookingId.replace(/-/g, "").slice(0, 24)}`;
}

/**
 * Sends a customer the refund a cancellation already recorded as owed.
 *
 * The amount comes from payments.refund_amount, computed at cancellation time
 * by lib/refunds.ts from the published policy. This action cannot change it.
 */
export async function issueRefund(bookingId: string): Promise<ActionResult> {
  const actor = await requireAdminActor();
  if (!actor.ok) return { error: actor.error };

  const idErr = requireUuid(bookingId, "booking id");
  if (idErr) return { error: idErr };

  const admin = getSupabaseAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = admin as any;

  const { data: payment } = await db
    .from("payments")
    .select("id, cashfree_order_id, refund_amount, refund_state, cashfree_refund_id, status, split_status, split_owner_amount")
    .eq("booking_id", bookingId)
    .eq("status", "payment_success")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!payment) return { error: "No successful payment found for this booking." };
  if (payment.refund_state === "completed") return { error: "This refund has already been paid." };

  // THE OWNER'S SHARE MAY ALREADY BE GONE. A settled Easy Split cannot be
  // clawed back, so refunding the customer in full on top of it pays out the
  // same capture twice: on a Rs1,00,000 booking that is Rs22,500 to the owner
  // plus Rs25,000 to the customer against a Rs25,200 capture. Refuse and make
  // the recovery a deliberate, human decision rather than a silent loss.
  if (payment.split_status === "done") {
    const owner = Number(payment.split_owner_amount);
    return {
      error:
        `The owner has already been paid ${Number.isFinite(owner) ? `Rs${owner.toLocaleString("en-IN")}` : "their share"} ` +
        `for this booking, and a settled Cashfree split cannot be reversed. ` +
        `Recover that amount from the owner's next settlement first, then refund from the Cashfree dashboard.`,
    };
  }
  if (payment.refund_state === "processing") {
    return { error: "A refund is already in progress for this booking." };
  }

  const amount = Number(payment.refund_amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: "Nothing is owed on this booking under the cancellation policy." };
  }
  if (!payment.cashfree_order_id) {
    return { error: "This booking has no gateway order — it must be refunded outside Hallnect." };
  }

  const refundId = payment.cashfree_refund_id ?? refundIdFor(bookingId);

  // CLAIM FIRST. A second admin clicking at the same moment matches zero rows
  // and stops here, rather than both of them calling Cashfree.
  const { count: claimed } = await db
    .from("payments")
    .update(
      {
        refund_state:        "processing",
        cashfree_refund_id:  refundId,
        refund_initiated_at: new Date().toISOString(),
        refund_initiated_by: actor.user.id,
        refund_error:        null,
      },
      { count: "exact" },
    )
    .eq("id", payment.id)
    .in("refund_state", ["owed", "failed"]);

  if ((claimed ?? 0) === 0) {
    return { error: "This refund is already being processed." };
  }

  await recordAdminAction({
    action:     "refund_issued",
    entityType: "payment",
    entityId:   payment.id,
    reason:     `Refund of ${amount} sent for booking ${bookingId.slice(0, 8).toUpperCase()}`,
  });

  const result = await createCashfreeRefund({
    orderId:  payment.cashfree_order_id,
    refundId,
    amount,
    note:     "Hallnect booking cancellation refund",
  });

  if (!result.ok) {
    await db.from("payments").update({
      refund_state: "failed",
      refund_error: result.error.slice(0, 500),
    }).eq("id", payment.id);
    revalidatePath("/admin/payments");
    return { error: result.error };
  }

  const outcome = classifyRefundStatus(result.data.refund_status);

  await db.from("payments").update({
    refund_state: outcome.state,
    refund_error: outcome.state === "failed" ? outcome.reason : null,
    // Only stamp completion when Cashfree actually confirms the money went back.
    ...(outcome.state === "completed"
      ? { refund_completed_at: new Date().toISOString(), status: "refunded" }
      : {}),
  }).eq("id", payment.id);

  // Tell the customer only now — the approved template promises the money
  // arrives in 5-7 working days, which is only true once it has actually left.
  if (outcome.state !== "failed") {
    await notifyBookingEvent("refund.sent", bookingId, { amount });
  }

  revalidatePath("/admin/payments");
  revalidatePath("/admin/bookings");
  if (outcome.state === "failed") return { error: outcome.reason };
  return { success: true };
}

/**
 * Re-reads a refund left 'processing' and settles its state.
 *
 * A STANDARD-speed refund is accepted immediately and confirmed by the bank
 * later, so without this a refund sits "processing" forever and an admin cannot
 * tell a slow one from a stuck one.
 */
export async function syncRefundStatus(bookingId: string): Promise<ActionResult> {
  const actor = await requireAdminActor();
  if (!actor.ok) return { error: actor.error };
  const idErr = requireUuid(bookingId, "booking id");
  if (idErr) return { error: idErr };

  const admin = getSupabaseAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = admin as any;

  const { data: payment } = await db
    .from("payments")
    .select("id, cashfree_order_id, cashfree_refund_id, refund_state")
    .eq("booking_id", bookingId)
    .not("cashfree_refund_id", "is", null)
    .limit(1)
    .maybeSingle();

  if (!payment?.cashfree_refund_id || !payment.cashfree_order_id) {
    return { error: "No refund has been issued for this booking." };
  }

  const res = await getCashfreeRefund(payment.cashfree_order_id, payment.cashfree_refund_id);
  if (!res.ok) return { error: res.error };

  const outcome = classifyRefundStatus(res.data.refund_status);
  await db.from("payments").update({
    refund_state: outcome.state,
    refund_error: outcome.state === "failed" ? outcome.reason : null,
    ...(outcome.state === "completed"
      ? { refund_completed_at: new Date().toISOString(), status: "refunded" }
      : {}),
  }).eq("id", payment.id);

  revalidatePath("/admin/payments");
  return { success: true };
}

/**
 * Retries an owner payout that failed.
 *
 * The split itself is idempotent (a status-guarded claim, plus Cashfree's
 * disable_split), so this is safe to press repeatedly — it re-runs the same
 * path the owner's Accept ran, using figures already in the database.
 */
export async function retryOwnerPayout(bookingId: string): Promise<ActionResult> {
  const actor = await requireAdminActor();
  if (!actor.ok) return { error: actor.error };
  const idErr = requireUuid(bookingId, "booking id");
  if (idErr) return { error: idErr };

  await recordAdminAction({
    action:     "owner_payout_retried",
    entityType: "booking",
    entityId:   bookingId,
    reason:     "Manual payout retry from the admin dashboard",
  });

  const outcome = await payOwnerOnAcceptance(bookingId);
  revalidatePath("/admin/payments");

  if (outcome.state === "paid")    return { success: true };
  if (outcome.state === "skipped") return { error: `Not retried: ${outcome.reason}` };
  return { error: outcome.reason };
}

// ── Coupons ───────────────────────────────────────────────────────────────────
//
// A coupon waives the flat ₹200 PLATFORM FEE — Hallnect's own revenue, charged
// on top of the advance. It never touches the commission, so the venue is paid
// exactly the same either way and Hallnect absorbs the whole discount.
//
// There is no delete action ON PURPOSE: bookings.coupon_id is ON DELETE SET
// NULL, so deleting a coupon would quietly orphan the waiver's audit trail on
// every booking that used it. Stopping is reversible; deleting is not.

export async function createCoupon(input: {
  code: string;
  description?: string;
  maxRedemptions?: string;
  expiresAt?: string;
}): Promise<{ success: true; code: string } | { error: string }> {
  const actor = await requireAdminActor();
  if (!actor.ok) return { error: actor.error };

  const parsed = parseSafe(couponCreateSchema, input);
  if (!parsed.ok) return { error: parsed.error };
  const v = parsed.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = actor.supabase as any;
  const { data, error } = await db
    .from("coupons")
    .insert({
      code:            v.code,
      description:     v.description ?? null,
      kind:            "zero_platform_fee",
      is_active:       true,
      max_redemptions: v.maxRedemptions ?? null,
      expires_at:      v.expiresAt ?? null,
      created_by:      actor.user.id,
    })
    .select("id, code")
    .single();

  // 23505 → sanitizeError renders "This record already exists." for a dup code.
  if (error) return { error: sanitizeError(error, "admin") };

  await recordAdminAction({
    action:     "coupon.create",
    entityType: "coupon",
    entityId:   data.id,
    newStatus:  "active",
    metadata: {
      code: data.code,
      kind: "zero_platform_fee",
      maxRedemptions: v.maxRedemptions ?? null,
      expiresAt: v.expiresAt ?? null,
    },
  });

  revalidatePath("/admin/coupons");
  revalidatePath("/admin/audit-logs");
  return { success: true, code: data.code };
}

/** Stop a coupon. New checkouts are refused immediately. */
export async function stopCoupon(couponId: string): Promise<ActionResult> {
  return setCouponActive(couponId, false);
}

/** Put a stopped coupon back into service. */
export async function resumeCoupon(couponId: string): Promise<ActionResult> {
  return setCouponActive(couponId, true);
}

async function setCouponActive(couponId: string, active: boolean): Promise<ActionResult> {
  const actor = await requireAdminActor();
  if (!actor.ok) return { error: actor.error };

  const idErr = requireUuid(couponId, "coupon id");
  if (idErr) return { error: idErr };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = actor.supabase as any;
  const { data: current } = await db
    .from("coupons").select("code, is_active").eq("id", couponId).maybeSingle();
  if (!current) return { error: "Coupon not found." };
  if (current.is_active === active) return { success: true };

  // count:"exact" — an RLS-filtered UPDATE reports zero rows with NO error, so
  // without this a non-admin would be told the coupon had been stopped.
  const { error, count } = await db
    .from("coupons")
    .update(
      active
        ? { is_active: true,  stopped_at: null, stopped_by: null }
        : { is_active: false, stopped_at: new Date().toISOString(), stopped_by: actor.user.id },
      { count: "exact" },
    )
    .eq("id", couponId);

  if (error) return { error: sanitizeError(error, "admin") };
  if (count === 0) return { error: "You do not have permission to change this coupon." };

  await recordAdminAction({
    // NOT "coupon.deactivate": the audit log's toneFor() regex-matches
    // /activate/ first and would colour a STOP green. Same reason premium's
    // off-switch is named "premium.cancel".
    action:         active ? "coupon.reactivate" : "coupon.cancel",
    entityType:     "coupon",
    entityId:       couponId,
    previousStatus: current.is_active ? "active" : "inactive",
    newStatus:      active ? "active" : "inactive",
    metadata:       { code: current.code },
  });

  revalidatePath("/admin/coupons");
  revalidatePath("/admin/audit-logs");
  return { success: true };
}
