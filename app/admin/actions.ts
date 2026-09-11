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
  checkCommissionAgainstAdvance,
  ticketResponseSchema,
  couponCreateSchema,
  couponLimitsSchema,
  parseSafe,
} from "@/lib/validation/schemas";
import { sanitizeError } from "@/lib/errors";
import { maxConfiguredCommissionRate } from "@/lib/hall-commission";
import { SUSPENSION_BAN_DURATION } from "@/lib/constants";
import { recordAdminAction } from "@/lib/audit";
import { createCashfreeRefund, getCashfreeRefund, classifyRefundStatus } from "@/lib/cashfree";
import { payOwnerOnAcceptance } from "@/lib/owner-payout";
import { dispatchOwnerPayout, reconcilePayout, registerBeneficiary } from "@/lib/payout-dispatch";
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
import { DEFAULT_ADVANCE_PERCENT, DEFAULT_COMMISSION_PERCENT } from "@/lib/booking-payment";
import { recordBookingRefundOrAlert } from "@/lib/refunds";
import { releaseAvailabilityForBooking } from "@/lib/availability-release";

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

/**
 * Server-side ADMIN gate — the ONLY entry check in this file.
 *
 * There used to be a second one, `getAuthUser()`, which returned the session
 * client and the user and nothing else. It proved *authentication* and was read
 * as authorization, so the actions built on it opened with "if (!user) return
 * Not authenticated" and then left RLS to sort out the rest. RLS does not sort
 * it out in a way a caller can see: a non-admin invoking one of these server
 * actions directly (they are directly invocable) had their statement filtered
 * to 0 rows, which raises NO error — so the action returned { success: true }
 * for a privileged change that never happened, and in some cases went on to
 * write an audit entry and send an SMS about it.
 *
 * That helper is deliberately gone rather than merely unused. While it existed,
 * the cheapest way to write the next admin action was to copy the wrong one.
 * Every action in this file starts here instead, and the pattern is: gate,
 * validate, write with count:"exact", refuse on zero rows, then audit.
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

/**
 * The two money percentages as they stand RIGHT NOW.
 *
 * Read straight off platform_settings with the admin's own session client
 * (platform_settings_admin_read allows it) rather than through the public
 * get_commission_percent / get_public_payment_settings RPCs. Those helpers
 * swallow a failed read and hand back the compile-time default, which is the
 * right behaviour for a customer-facing price but exactly wrong here: the pair
 * below is validated against each other, and silently substituting 25 for a
 * live 5% advance would approve a commission that bricks every checkout.
 *
 * The constants remain the fallback for a row or column that genuinely is not
 * there yet (pre-0012 / pre-0017 database), which is the same value the booking
 * engine itself would use in that state.
 */
async function readMoneyPercents(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
): Promise<{ commission: number; advance: number }> {
  const { data } = await db
    .from("platform_settings")
    .select("commission_percent, default_advance_percentage")
    .eq("id", true)
    .maybeSingle();

  const commission = Number(data?.commission_percent);
  const advance    = Number(data?.default_advance_percentage);
  return {
    commission: Number.isFinite(commission) ? commission : DEFAULT_COMMISSION_PERCENT,
    advance:    Number.isFinite(advance)    ? advance    : DEFAULT_ADVANCE_PERCENT,
  };
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

  // SERVICE ROLE, NOT THE SESSION CLIENT — see migration 0048.
  // 0046 revoked table-wide UPDATE on halls and re-granted only the descriptive
  // columns, deliberately withholding status, rejection_reason, moderated_at
  // and moderated_by. A column GRANT is checked BEFORE row security and knows
  // nothing about is_admin(), so this write raised 42501 for admins too and no
  // hall could ever be approved. requireAdminActor() above is the gate, and
  // trg_prevent_hall_self_approve still refuses anyone who is neither
  // is_admin() nor is_trusted_backend().
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getSupabaseAdminClient() as any;

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
  // RLS is not in play on the service-role client, so 0 rows no longer means
  // "not permitted" — it can only mean the hall was deleted since the read.
  if (count === 0) return { error: "That hall no longer exists. Reload the queue." };

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
  // THE PUBLIC PAGES ARE CACHED NOW, so a status change has to say so or an
  // approved venue would not appear for up to five minutes — and a suspended
  // one would keep appearing, which is worse. layout is used for the city
  // pages because /wedding-halls/[city] is a dynamic segment and each city has
  // its own cache entry; "page" would only clear one of them.
  revalidatePath("/");
  revalidatePath("/halls");
  revalidatePath("/wedding-halls/[city]", "layout");
  revalidatePath("/sitemap.xml");
  return { success: true };
}

// ── Owner approval ────────────────────────────────────────────────────────────
// Approve owner = set profile.role to 'owner_approved' AND verify hall_owners row.
// Both writes are gated by `is_admin()` in RLS + triggers.

/**
 * What role the target currently holds, so a role change can refuse to act on
 * the wrong kind of account.
 *
 * WHY THIS EXISTS: approveOwner and rejectOwner took a profile id and wrote a
 * new role with NO look at the old one. rejectOwner(anotherAdminId) demoted a
 * fellow admin to customer — locking them out of /admin entirely — and
 * approveOwner(anyCustomerId) promoted a plain customer to owner_approved
 * without them ever having applied. Neither is reachable from the owners
 * screen, which only lists applicants, but both are server actions and a
 * server action is a public endpoint that takes whatever id it is given.
 *
 * The user list already refuses to suspend an admin ("Admin accounts cannot be
 * suspended from this screen"). These two are the same intent, unenforced.
 *
 * Deliberately NOT an ownership check — an admin may legitimately act on other
 * people's accounts. It is a check on WHAT KIND of account, which is the part
 * that was missing.
 */
async function targetRole(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  profileId: string,
): Promise<string | null> {
  const { data } = await db.from("profiles").select("role").eq("id", profileId).maybeSingle();
  return (data?.role as string | undefined) ?? null;
}

export async function approveOwner(profileId: string): Promise<ActionResult> {
  const actor = await requireAdminActor();
  if (!actor.ok) return { error: actor.error };
  const user = actor.user;
  const idErr = requireUuid(profileId, "profile id");
  if (idErr) return { error: idErr };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = actor.supabase as any;

  // Only an actual applicant may be approved. Approving a customer who never
  // applied hands them an owner dashboard; approving an admin would demote one.
  const current = await targetRole(db, profileId);
  if (current === null) return { error: "That account could not be found." };
  if (current === "admin") {
    return { error: "That is an admin account. Change an admin's role from the user list, not the owner queue." };
  }
  if (current !== "owner_pending" && current !== "owner_approved") {
    return { error: "That account has not applied to list a venue, so there is nothing to approve." };
  }

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
  //
  // Service role: 0046 withheld hall_owners.is_verified from `authenticated`,
  // so this raised 42501 — and because the result was never destructured,
  // nothing noticed. Step 1 succeeded, so the account flipped to
  // owner_approved while the owner stayed unverified: a half-approved state
  // that only shows up later, when something checks is_verified.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adminDb = getSupabaseAdminClient() as any;
  const { error: verifyErr } = await adminDb
    .from("hall_owners")
    .update({ is_verified: true, verified_at: new Date().toISOString(), verified_by: user.id })
    .eq("profile_id", profileId);
  // Not every approved profile has a hall_owners row yet, so matching no row is
  // fine and stays unchecked. A genuine write failure is not.
  if (verifyErr) return { error: sanitizeError(verifyErr, "admin") };

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

  // See targetRole. Without this, rejectOwner(anotherAdminId) quietly demoted a
  // fellow admin to customer and locked them out of /admin.
  const current = await targetRole(db, profileId);
  if (current === null) return { error: "That account could not be found." };
  if (current === "admin") {
    return { error: "That is an admin account. Change an admin's role from the user list, not the owner queue." };
  }
  if (current === "customer") {
    // Already where this would put them. Idempotent rather than an error, but
    // it must not write an audit entry claiming a change happened.
    return { success: true };
  }

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
  // Service role — hall_owners.is_verified is not granted to `authenticated`
  // (0046), so this raised 42501 for admins too. requireAdminActor() above is
  // the gate; trg_prevent_owner_self_verify is the DB-side backstop.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getSupabaseAdminClient() as any;

  const { error, count } = await db
    .from("hall_owners")
    .update({ is_verified: true, verified_at: new Date().toISOString(), verified_by: user.id }, { count: "exact" })
    .eq("id", ownerRowId);

  if (error) return { error: sanitizeError(error, "admin") };
  if ((count ?? 0) === 0) return { error: "That owner record no longer exists. Reload the page." };

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

/**
 * How long a suspended account is banned for in GoTrue.
 *
 * The duration itself lives in lib/constants.ts because lib/account-deletion.ts
 * bans for the same reason, and a security constant kept in two places drifts.
 */

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

  // ── The half that actually enforces it ──────────────────────────────────────
  // profiles.is_active stops the Next.js layer and NOTHING BELOW IT. Verified
  // against the live database: no RLS policy anywhere references is_active, so
  // a suspended user's existing JWT still satisfies every policy when it is
  // sent straight to PostgREST with the public anon key — no requireAuth(), no
  // server action, no gate. Their refresh token also keeps minting new ones, so
  // the flag alone expires never. Banning the auth user is the part that bites.
  //
  // What the ban does and does not do, so nobody reads more into it than is
  // there: GoTrue refuses sign-in and refresh for a banned user, so the session
  // dies when the access token in hand expires (one hour on the default
  // setting), not the instant this runs. auth.admin.signOut() needs the user's
  // own JWT, which an admin does not have, so that last hour is not closable
  // from here. Every profiles row has an auth user to ban — profiles.id is a
  // FK to auth.users with ON DELETE CASCADE.
  //
  // The flag goes first because it is the revertible half and its update is
  // count-checked, so an admin who may not touch this row is turned away before
  // anything happens in auth.
  // CONSTRUCTED INSIDE THE TRY, not just called there. getSupabaseAdminClient()
  // runs requireEnv("SUPABASE_SERVICE_ROLE_KEY"), which THROWS rather than
  // returning an error — and by this line the flag has already moved. An
  // uncaught throw would leave is_active changed, no ban applied and no revert
  // run: exactly the silent disagreement the block below exists to prevent.
  let banErr: { status?: number; message: string } | null = null;
  try {
    const { error } = await getSupabaseAdminClient().auth.admin.updateUserById(profileId, {
      ban_duration: active ? "none" : SUSPENSION_BAN_DURATION,
    });
    banErr = error;
  } catch (e) {
    banErr = { message: e instanceof Error ? e.message : String(e) };
  }

  if (banErr) {
    // The flag and the ban must not disagree quietly. An admin told "suspended"
    // while the account can still refresh a token has been lied to, and the
    // person on the other end of a failed reactivation is still locked out
    // while the screen says they are back. So put the flag back the way it was,
    // report the failure, and send no notification about a change that did not
    // happen.
    //
    // Reverting restores the state this action started from, in BOTH
    // directions — it does not "fail suspended". On a failed suspension the
    // account goes back to fully active, which is the honest outcome: nothing
    // was revoked, so nothing should claim to be. The messages below say so
    // per direction rather than implying a safe default that does not exist.
    // status is absent on the thrown path (requireEnv), so it is not printed
    // as a bare `undefined` next to a message that does explain itself.
    console.error(
      "[admin] auth ban toggle failed:",
      banErr.status !== undefined ? `status ${banErr.status}` : "threw before the call",
      banErr.message,
    );
    const { error: revertErr, count: revertCount } = await db
      .from("profiles")
      .update({ is_active: before.is_active }, { count: "exact" })
      .eq("id", profileId);

    // An RLS-filtered UPDATE affects 0 rows WITHOUT raising, so the error check
    // alone would report a clean revert that never happened — the same trap the
    // forward update guards against a few lines above.
    if (revertErr || revertCount === 0) {
      // revertErr is null on the zero-rows path, so it cannot be dereferenced.
      console.error(
        "[admin] is_active revert failed:",
        revertErr ? `${revertErr.code} ${revertErr.message}` : "0 rows matched (filtered by RLS)",
      );
      return {
        error: active
          ? "Could not restore this account's sign-in, and could not undo the profile change either — it now shows active but cannot sign in. Retry; if it fails again the ban must be lifted in Supabase Auth."
          : "Suspended the profile but could not revoke this account's sign-in, and could not undo the profile change either — they can still reach the database directly. Retry; if it fails again ban the user in Supabase Auth.",
      };
    }

    return {
      error: active
        ? "Could not restore this account's sign-in. Nothing was changed — please retry."
        : "Could not revoke this account's sign-in, so suspending it would not have stopped them. Nothing was changed — please retry.",
    };
  }

  await recordAdminAction({
    action:         active ? "user.reactivate" : "user.suspend",
    entityType:     "user",
    entityId:       profileId,
    previousStatus: before.is_active ? "active" : "suspended",
    newStatus:      active ? "active" : "suspended",
    reason:         cleanReason(reason),
    // auth_ban records that the enforcing half ran, not just the flag — the
    // audit trail is where a later "were they really locked out?" is settled.
    metadata:       { role: before.role, auth_ban: active ? "lifted" : "applied" },
  });

  // Suspension locks them out — requireAuth() bounces a deactivated profile to
  // /login?error=account_disabled and the ban above stops them signing back in
  // to get a fresh session — while their halls stay live and
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
  //
  // That hardening was necessary but never sufficient: a server action is not
  // the only door to the table. The same author could PATCH PostgREST directly
  // with their own JWT and the public anon key — and, because reviews_update
  // leaves hall_id unrestricted too, move the review onto a venue they never
  // booked, where SECURITY DEFINER recalc_hall_rating() rewrites that hall's
  // rating past guard_hall_privileged_columns. Migration 0048 revokes UPDATE on
  // reviews from every client role and adds a guard trigger, making this the
  // only door — which is why the write below runs as the service role.
  const actor = await requireAdminActor();
  if (!actor.ok) return { error: actor.error };
  const idErr = requireUuid(reviewId, "review id");
  if (idErr) return { error: idErr };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getSupabaseAdminClient() as any;

  const { error, count } = await db
    .from("reviews")
    .update({ is_visible: visible }, { count: "exact" })
    .eq("id", reviewId);

  if (error) return { error: sanitizeError(error, "admin") };
  if (count === 0) return { error: "That review no longer exists. Reload the page." };

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
  // requireAdminActor, not getAuthUser — this publishes a clickable third-party
  // banner on the public homepage, and "signed in" is not "admin". Server
  // actions are directly invocable, so without a role check the ads_write RLS
  // policy was the only thing standing between any customer session and the
  // ad slots. Matches updateAdvertisement / deleteAdvertisement below.
  const actor = await requireAdminActor();
  if (!actor.ok) return { error: actor.error };

  const norm = normalizeAdInput(input);
  if ("error" in norm) return { error: norm.error };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = actor.supabase as any;
  // count:"exact" for the same reason every other write here carries it. An
  // ads_write refusal on INSERT does raise 42501 rather than reporting zero
  // rows — the silent-zero trap is an UPDATE/DELETE one — so this is the
  // belt to that policy's braces, and it means no caller can ever be told an
  // ad was created when nothing was written.
  const { error, count } = await db
    .from("advertisements").insert(norm.row, { count: "exact" });

  if (error) {
    if (error.code === "42703") return { error: "Database not migrated — apply migration 0014." };
    return { error: sanitizeError(error, "createAdvertisement") };
  }
  if ((count ?? 0) === 0) return { error: "The advertisement was not created. Reload and try again." };

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
  // The count check below has been here all along; the ROLE check had not, and
  // one without the other is a half-guard. premium_admin_write (0022) is
  // `for all using (is_admin())`, so a non-admin invoking this server action
  // directly matched zero rows — and this function then correctly refused. What
  // it could not refuse was the audit entry and the owner SMS that a genuine
  // admin's toggle triggers, or the reconnaissance of a "not permitted" reply
  // that confirms the listing id exists. Authorize first, then write.
  const actor = await requireAdminActor();
  if (!actor.ok) return { error: actor.error };
  const idErr = requireUuid(listingId, "listing id");
  if (idErr) return { error: idErr };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = actor.supabase as any;

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
  // This cancels other people's bookings in bulk, so it is admin-gated like
  // every other privileged write here. getAuthUser() proved only that SOMEONE
  // was signed in, and neither branch below could tell an unauthorized caller
  // apart from a quiet night: the RPC is SECURITY DEFINER (it does not care who
  // called it), and the fallback UPDATE is RLS-filtered to zero rows WITHOUT
  // raising — which this function then reported as `cleaned: 0`, i.e. success.
  const actor = await requireAdminActor();
  if (!actor.ok) return { error: actor.error };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = actor.supabase as any;

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

    // sanitizeError, like every other error return in this file. The raw
    // PostgREST message names tables, columns, constraints and trigger
    // functions, and this was the one place it went straight to the client.
    if (fallback.error) return { error: sanitizeError(fallback.error, "admin") };
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
  // The block above says owners cannot call this — that was a statement about
  // the DATABASE, not about this function. getAuthUser() let any signed-in
  // session in and left premium_admin_write / guard_premium_listing_writes as
  // the only defence, which is precisely the arrangement that grants a paid
  // placement on the homepage if either one is ever loosened. Gate it here too.
  const actor = await requireAdminActor();
  if (!actor.ok) return { error: actor.error };

  const parsed = parseSafe(premiumListingSchema, input);
  if (!parsed.ok) return { error: parsed.error };
  const v = parsed.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = actor.supabase as any;

  // .select("id").single() IS the zero-row check on this path: an insert that
  // wrote nothing comes back as PGRST116 and lands in the `if (error)` below,
  // so there is no count:"exact" variant to add here. Reading the id back is
  // also what notifyPremiumChanged needs, so it cannot be dropped.
  const { data: listing, error } = await db.from("premium_listings").insert({
    hall_id:    v.hallId,
    plan_slug:  v.planSlug,
    start_date: v.startDate,
    end_date:   v.endDate,
    amount:     Math.round(v.amount * 100) / 100,
    is_active:  true,
  }).select("id").single();

  if (error) return { error: sanitizeError(error, "admin") };

  // AUDITED. A premium listing is a paid placement on the homepage granted by
  // hand, so "who granted this venue prominence, when, and for how much" is
  // exactly the question an audit trail exists to answer. It was unlogged.
  await recordAdminAction({
    action:     "premium.grant",
    entityType: "premium_listing",
    entityId:   listing.id,
    newStatus:  `${v.planSlug} ${v.startDate} to ${v.endDate}, Rs.${Math.round(v.amount * 100) / 100}`,
  });

  // Non-critical owner message — respects the owner's notification preference.
  await notifyPremiumChanged(listing.id, v.hallId, true, v.planSlug === "pro" ? "Pro" : "Premium");

  revalidatePath("/admin/premium-listings");
  revalidatePath("/admin/dashboard");
  revalidatePath("/admin/audit-logs");
  return { success: true };
}

export async function updatePremiumPlan(input: {
  slug:          "premium" | "pro";
  monthly_price: number;
  duration_days: number;
}): Promise<ActionResult> {
  // requireAdminActor, not getAuthUser: this sets the price every owner is
  // charged, and "signed in" is not the same as "admin".
  const actor = await requireAdminActor();
  if (!actor.ok) return { error: actor.error };
  const { supabase } = actor;

  const parsed = parseSafe(premiumPlanUpdateSchema, input);
  if (!parsed.ok) return { error: parsed.error };
  const v = parsed.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // count:"exact" — an RLS-filtered UPDATE reports zero rows with NO error, so
  // an unguarded version returned {success:true} for a price change that never
  // happened, and the admin would go on believing plans cost what they typed.
  const { error, count } = await db
    .from("premium_plans")
    .update({
      monthly_price: Math.round(v.monthly_price * 100) / 100,
      duration_days: v.duration_days,
    }, { count: "exact" })
    .eq("slug", v.slug);

  if (error)       return { error: sanitizeError(error, "admin") };
  if (count === 0) return { error: "That plan could not be updated — check you are signed in as an admin." };

  // Audited: this is the price every owner is charged for a plan.
  await recordAdminAction({
    action:     "premium.plan_price",
    entityType: "premium_plan",
    entityId:   null,
    newStatus:  `${v.slug} Rs.${Math.round(v.monthly_price * 100) / 100} / ${v.duration_days} days`,
  });

  revalidatePath("/admin/settings");
  revalidatePath("/owner/premium/upgrade");
  revalidatePath("/admin/audit-logs");
  return { success: true };
}

// ── Platform settings ─────────────────────────────────────────────────────────
// Updates the global commission percentage. RLS allows only admins to write
// the platform_settings row; validation is also done server-side here so a
// malicious form post can't sneak past the UI.

export async function updateCommissionPercent(
  percent: number,
): Promise<ActionResult> {
  // requireAdminActor, not getAuthUser: this sets the rate every venue in the
  // country is charged. Same reasoning as updatePremiumPlan.
  const actor = await requireAdminActor();
  if (!actor.ok) return { error: actor.error };

  const parsed = parseSafe(commissionPercentSchema, percent);
  if (!parsed.ok) return { error: parsed.error };
  const clean = Math.round(parsed.data * 100) / 100; // 2-decimal precision

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = actor.supabase as any;

  // THE RANGE CHECK ALONE WAS NOT A VALIDATION. commissionPercentSchema accepts
  // anything in [0,100], but the commission is charged on the full hall price
  // and retained out of the advance, so a rate that is fine in isolation can be
  // impossible against the live advance percentage — and calculateBookingPayment
  // THROWS on that pair. Typing 40 here used to save cleanly and then fail every
  // single checkout, sitewide, with the settings page still showing 40% as
  // accepted. Checked against what the advance actually is right now, not
  // against the constant.
  const live = await readMoneyPercents(db);
  const bound = checkCommissionAgainstAdvance(clean, live.advance, "commission");
  if (!bound.ok) return { error: bound.error };

  const { error, count } = await db
    .from("platform_settings")
    .upsert(
      { id: true, commission_percent: clean, updated_by: actor.user.id },
      { onConflict: "id", count: "exact" },
    );

  if (error) return { error: sanitizeError(error, "admin") };
  // Never report a rate change that touched no row — the admin would go on
  // believing venues are charged what they typed. Same guard as updatePremiumPlan.
  if ((count ?? 0) === 0) return { error: "The commission rate could not be saved. Reload and try again." };

  // AUDITED, because this is the single number every venue in the country is
  // charged on, and it was the largest unlogged change in the product: the live
  // admin_audit_log carried fifteen distinct actions and not one settings.*
  // entry, despite the rate having been configured in production. previous is
  // read from the value we just replaced so the trail says what it moved FROM,
  // which is the only part that makes a rate change reviewable after the fact.
  await recordAdminAction({
    action:         "settings.commission_percent",
    entityType:     "platform_settings",
    entityId:       null,
    previousStatus: String(live.commission),
    newStatus:      String(clean),
  });

  revalidatePath("/admin/settings");
  revalidatePath("/admin/commissions");
  revalidatePath("/admin/dashboard");
  revalidatePath("/admin/audit-logs");
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // THE MIRROR OF updateCommissionPercent, and it breaks the catalogue from the
  // other end. The old check was `0 <= advance <= 100` with no reference to the
  // commission, so lowering the advance under the live rate — or to 0, which
  // advanceFromTotal() rejects outright — saved happily and then threw a
  // RangeError on every booking of every hall. The bound is symmetric and lives
  // in one place, so the two settings screens can never disagree about it.
  const liveRates = await readMoneyPercents(db);
  const bound = checkCommissionAgainstAdvance(liveRates.commission, advancePct, "advance");
  if (!bound.ok) return { error: bound.error };

  // AND AGAINST THE HIGHEST RATE ANY HALL ACTUALLY CARRIES, which since halls
  // gained their own commission_rate is no longer the platform figure above.
  // An advance that clears the platform default can still be too small for a
  // hall that agreed to more, and nothing would surface that until a customer
  // tried to book THAT hall and calculateBookingPayment threw at checkout —
  // one venue silently unbookable, with the settings page reporting success.
  const highest = await maxConfiguredCommissionRate();
  if (highest != null && highest > liveRates.commission) {
    const hallBound = checkCommissionAgainstAdvance(highest, advancePct, "advance");
    if (!hallBound.ok) {
      return {
        error:
          `${hallBound.error} (The highest commission any hall currently gives is ` +
          `${highest}%, which is what this has to cover — not the ${liveRates.commission}% ` +
          `platform default.)`,
      };
    }
  }

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

  // Audited for the same reason as the commission rate: the advance percentage
  // decides what every customer is asked to pay up front, and the online-payment
  // switch can stop the platform taking money at all. Both were unlogged.
  await recordAdminAction({
    action:         "settings.payment",
    entityType:     "platform_settings",
    entityId:       null,
    previousStatus: `advance ${liveRates.advance}%`,
    newStatus:      `advance ${advancePct}%, online payment ${input.enableOnlineCustomerPayment ? "on" : "off"}`,
  });

  revalidatePath("/admin/settings");
  revalidatePath("/admin/commissions");
  revalidatePath("/admin/audit-logs");
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

  // Audited: a ticket response is Hallnect speaking to a customer in its own
  // voice, and it can close a complaint. The reply TEXT is not recorded here —
  // it already lives on the ticket, and copying customer correspondence into a
  // second table widens where personal data sits for no investigative gain.
  await recordAdminAction({
    action:     "ticket.respond",
    entityType: "support_ticket",
    entityId:   ticketId,
    newStatus:  v.status,
  });

  revalidatePath("/admin/support-tickets");
  revalidatePath("/admin/dashboard");
  revalidatePath("/admin/audit-logs");
  return { success: true };
}

// ── SMS notification center actions ─────────────────────────────────────────

/**
 * Sets the phone number that receives platform admin alerts.
 *
 * Stored on platform_settings (the existing single-row admin config table)
 * rather than in an environment variable, so it can be changed without a
 * redeploy. ADMIN_ALERT_PHONE remains a deployment-level fallback and
 * lib/constants CONTACT.phone the last resort — see getAdminNotificationPhone.
 *
 * Admin-only and audited. Normalised to E.164 before storage: the column has a
 * CHECK constraint requiring it, and an un-normalised number is one we could
 * never actually message.
 */
export async function updateAdminAlertPhone(raw: string): Promise<ActionResult> {
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
    .upsert({ id: true, admin_alert_phone: value, updated_by: actor.user.id }, { onConflict: "id" });

  if (error) return { error: sanitizeError(error, "admin") };

  await recordAdminAction({
    action:     "settings.admin_alert_phone",
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
/**
 * Re-send every notification still sitting failed and retryable.
 *
 * WHY: the only retry was one button per row. When an outage ends — a DLT
 * template finally approved, say — nothing re-sends anything. Every message
 * generated during the outage waits for a human to find and click each row
 * individually, which for a booking confirmation is the same as never.
 *
 * Bounded to 25 per run so one click cannot fan out into an unbounded burst
 * against the provider, and it skips rows already at MAX_SEND_ATTEMPTS or
 * marked permanently failed — a template the operator has not approved will be
 * dropped no matter how often it is retried.
 */
export async function retryAllFailedNotifications(): Promise<
  { success: true; sent: number; failed: number; skipped: number } | { error: string }
> {
  const actor = await requireAdminActor();
  if (!actor.ok) return { error: actor.error };

  const { getSupabaseAdminClient } = await import("@/lib/supabase/admin");
  const { attemptSend, MAX_SEND_ATTEMPTS } = await import("@/lib/notifications/service");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getSupabaseAdminClient() as any;

  const { data: rows, error } = await db
    .from("notifications")
    .select("id, attempt_count")
    .eq("status", "failed")
    .or("permanent_failure.is.null,permanent_failure.eq.false")
    .order("created_at", { ascending: true })
    .limit(25);

  if (error) return { error: sanitizeError(error, "admin") };

  let sent = 0, failed = 0, skipped = 0;
  for (const row of (rows ?? []) as { id: string; attempt_count: number | null }[]) {
    if ((row.attempt_count ?? 0) >= MAX_SEND_ATTEMPTS) { skipped++; continue; }
    try {
      const result = await attemptSend(db, row.id, /* isRetry */ true);
      if (result.sent) sent++; else failed++;
    } catch {
      failed++;
    }
  }

  await recordAdminAction({
    action:     "notifications.retried_all",
    entityType: "notification",
    entityId:   null,
    metadata:   { sent, failed, skipped },
  });

  revalidatePath("/admin/notifications");
  return { success: true, sent, failed, skipped };
}

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
    // A stale row that ALREADY carries an MSG91 request id was accepted by
    // MSG91 — only the bookkeeping update failed. Resending it would deliver
    // the same message to the customer twice, which is worse than a row that
    // looks stuck. Only rows that never reached MSG91 may be re-sent.
    if (row.provider_message_id) {
      return {
        error: "This message was already accepted by MSG91; resending would deliver it twice. Check its delivery status instead.",
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
  // A permanent failure (template not DLT-approved, blocked recipient, bad
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
/**
 * The Cashfree refund_id for ONE payment row.
 *
 * KEYED ON THE PAYMENT, NOT THE BOOKING, and that is the whole point.
 * issueRefund was deliberately rewritten to take a payment id so that a
 * DOUBLE-CAPTURED booking could have both captures refunded — but this helper
 * still derived the id from the booking, so every payments row on that booking
 * produced the same `HNR_<booking>`. payments.cashfree_refund_id is UNIQUE
 * (migration 0033), so once one row claimed it the claim UPDATE for the second
 * row failed with 23505 — and the caller read only `count`, discarded `error`,
 * and told the admin "This refund is already being processed".
 *
 * The second refund could therefore never be issued from the product. A
 * customer charged twice got one capture back and the other required somebody
 * to go into the Cashfree dashboard by hand.
 *
 * The payment id is a uuid, so this is unique under the strictest reading of
 * Cashfree's scope (per merchant), not merely per order. Still deterministic,
 * which is what makes it an idempotency key: re-issuing the same refund cannot
 * become a second one.
 */
function refundIdFor(paymentId: string): string {
  return `HNR_${paymentId.replace(/-/g, "").slice(0, 24)}`;
}

/**
 * Sends a customer the refund a cancellation already recorded as owed.
 *
 * The amount comes from payments.refund_amount, computed at cancellation time
 * by lib/refunds.ts from the published policy. This action cannot change it.
 */
/**
 * Sends a refund for ONE payment row, identified by its own id.
 *
 * IT TAKES A PAYMENT ID, NOT A BOOKING ID, AND THAT IS THE WHOLE FIX.
 *
 * This used to resolve the row itself: newest payment on the booking with
 * status='payment_success'. On a DOUBLE CAPTURE that finds the wrong one. When
 * a customer is told their first payment did not land and pays again, both are
 * captured; verifyAndApplyPayment stamps the duplicate refund_state='owed' with
 * the full amount but CANNOT stamp it payment_success, because
 * uq_payment_success_per_booking permits one per booking. So the duplicate sits
 * at status='created'.
 *
 * fetchRefundQueue has no status filter, so the duplicate DID appear in the
 * admin queue — and clicking Refund on it resolved the OTHER row, the
 * legitimate payment_success one, which has nothing owed. The customer's second
 * payment was visible, listed, clickable, and unrefundable from inside the
 * product.
 *
 * Selecting by the id the queue already carries removes the guessing entirely:
 * the row the admin clicked is the row that gets refunded.
 */
export async function issueRefund(paymentId: string): Promise<ActionResult> {
  const actor = await requireAdminActor();
  if (!actor.ok) return { error: actor.error };

  const idErr = requireUuid(paymentId, "payment id");
  if (idErr) return { error: idErr };

  const admin = getSupabaseAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = admin as any;

  const { data: payment } = await db
    .from("payments")
    .select("id, booking_id, cashfree_order_id, refund_amount, refund_state, cashfree_refund_id, status, split_status, split_owner_amount")
    .eq("id", paymentId)
    .maybeSingle();

  if (!payment) return { error: "That payment no longer exists. Reload the queue." };

  // Derived from the row rather than trusted from the caller, so the audit
  // entry and the customer notification below can never describe a different
  // booking from the one whose money is actually moving.
  const bookingId: string = payment.booking_id;

  // A capture is required, but NOT status='payment_success' — see the docblock.
  // A duplicate capture is real money that was taken and is genuinely owed
  // back; refusing it here is what made it unrefundable in the first place.
  if (!payment.cashfree_order_id) {
    return { error: "That payment was never sent to the gateway, so there is nothing to refund." };
  }
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
  // AND THE MONEY MAY BE ON ITS WAY RIGHT NOW. Under Easy Split 'pending'
  // lasted milliseconds, so refusing only on 'done' was enough. A Cashfree
  // Payouts transfer is asynchronous by definition and can sit in flight
  // overnight — SCHEDULED_FOR_NEXT_WORKINGDAY is a documented PENDING code, and
  // NEFT does not run on Sundays. That is a real window in which a full refund
  // to the customer and a transfer to the owner are both live against one
  // capture.
  //
  // THIS USED TO BE A DEAD END. It refused and told the admin to "reconcile it
  // in the payout queue first" — but fetchStuckPayouts excludes any booking
  // with a refund owed, so the row was not in that queue, and Mark-paid-
  // manually refuses while a transfer is open too. The customer was owed a
  // refund the product had no way to release, against a policy promising 5-7
  // business days.
  //
  // So it resolves the transfer itself rather than sending someone to look for
  // a button that is not there. Reconcile only READS from Cashfree, so this is
  // safe to do inline: it cannot move money, only find out what already
  // happened.
  if (payment.split_status === "in_flight" || payment.split_status === "pending") {
    let settled = false;
    if (payment.split_payout_id) {
      const r = await reconcilePayout(String(payment.split_payout_id));
      if (r.ok) {
        // done = the owner really was paid, and the refund must not go out on
        // top. Anything else releases the block.
        settled = r.summary === "done";
        if (!settled) {
          const { data: fresh } = await db
            .from("payments").select("split_status").eq("id", payment.id).maybeSingle();
          payment.split_status = fresh?.split_status ?? payment.split_status;
        }
      } else {
        return {
          error:
            `A payout to the owner is in progress and Cashfree could not be reached to check it (${r.error}). `
            + "Try again shortly — refunding now could pay out the same capture twice.",
        };
      }
    }
    if (settled || payment.split_status === "done") {
      const owed = Number(payment.split_owner_amount);
      return {
        error:
          `That transfer has now completed — the owner was paid `
          + `${Number.isFinite(owed) ? `Rs${owed.toLocaleString("en-IN")}` : "their share"}. `
          + "Recover it from the owner before refunding the customer.",
      };
    }
    if (payment.split_status === "in_flight" || payment.split_status === "pending") {
      return {
        error:
          "A payout to the owner is still in flight at Cashfree for this booking. It has just been "
          + "re-checked and is not final yet — try again once it settles or reverses.",
      };
    }
    // Terminal and not paid (failed / reversed): the advance is the customer's,
    // and the refund may proceed.
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

  const refundId = payment.cashfree_refund_id ?? refundIdFor(String(payment.id));

  // CLAIM FIRST. A second admin clicking at the same moment matches zero rows
  // and stops here, rather than both of them calling Cashfree.
  const { count: claimed, error: claimErr } = await db
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

  // THE ERROR WAS DISCARDED HERE, and that is how the bug above stayed
  // invisible: a 23505 on cashfree_refund_id left `claimed` undefined, which
  // fell into the same branch as a lost race and reported the refund as
  // already in progress. A unique-violation is not contention — it means two
  // payment rows are trying to use one refund id, which after the change above
  // should be impossible and is worth saying out loud rather than absorbing.
  if (claimErr) {
    if (claimErr.code === "23505") {
      console.error("[refund] refund id collision on payment", payment.id, refundId);
      return {
        error:
          "That refund id is already in use on another payment. This needs a look before it is sent — nothing has been refunded.",
      };
    }
    return { error: sanitizeError(claimErr, "admin") };
  }

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
export async function syncRefundStatus(paymentId: string): Promise<ActionResult> {
  const actor = await requireAdminActor();
  if (!actor.ok) return { error: actor.error };
  const idErr = requireUuid(paymentId, "payment id");
  if (idErr) return { error: idErr };

  const admin = getSupabaseAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = admin as any;

  // Keyed on the payment for the same reason issueRefund is: a booking can hold
  // two captures, and "any row on this booking with a refund id" picks between
  // them arbitrarily — so the admin could poll one refund's status and be shown
  // the other's.
  const { data: payment } = await db
    .from("payments")
    .select("id, booking_id, cashfree_order_id, cashfree_refund_id, refund_state")
    .eq("id", paymentId)
    .maybeSingle();

  if (!payment) return { error: "That payment no longer exists. Reload the queue." };
  if (!payment.cashfree_refund_id || !payment.cashfree_order_id) {
    return { error: "No refund has been issued for this payment." };
  }

  const res = await getCashfreeRefund(payment.cashfree_order_id, payment.cashfree_refund_id);
  if (!res.ok) return { error: res.error };

  const outcome = classifyRefundStatus(res.data.refund_status);

  // NEVER MOVES A REFUND BACK OUT OF 'completed'. The webhook path guards this
  // the same way, and the three writers of refund_state have to agree or the
  // guard reads as arbitrary and the next person deletes it.
  //
  // `completed` is the one state backed by an event that already happened —
  // the money left. If Cashfree later reports something else for the same
  // refund, that is worth an admin looking at it, not worth the row quietly
  // flipping to "in progress" on a customer who has already been repaid.
  await db.from("payments").update({
    refund_state: outcome.state,
    refund_error: outcome.state === "failed" ? outcome.reason : null,
    ...(outcome.state === "completed"
      ? { refund_completed_at: new Date().toISOString(), status: "refunded" }
      : {}),
  }).eq("id", payment.id).neq("refund_state", "completed");

  revalidatePath("/admin/payments");
  return { success: true };
}


/**
 * SEND an owner their advance through Cashfree Payouts.
 *
 * This is the button that moves real money, so it does the least it can: every
 * guard is re-run inside dispatchOwnerPayout against the database, regardless
 * of what the screen believed when it rendered. The admin's identity is
 * recorded on the payout row and in the audit log, because "who authorised
 * this transfer" is the first question anyone asks about a payment that went
 * to the wrong place.
 */
export async function sendOwnerPayout(bookingId: string): Promise<ActionResult> {
  const actor = await requireAdminActor();
  if (!actor.ok) return { error: actor.error };

  const idErr = requireUuid(bookingId, "booking id");
  if (idErr) return { error: idErr };

  await recordAdminAction({
    action:     "owner_payout_sent",
    entityType: "booking",
    entityId:   bookingId,
    reason:     "Payout dispatched from the admin dashboard",
  });

  const outcome = await dispatchOwnerPayout(bookingId, actor.user.id);
  revalidatePath("/admin/payments");

  switch (outcome.state) {
    case "sent":
      return { success: true };
    case "in_flight":
      return { success: true };
    case "unknown":
      // Deliberately NOT an error the admin can "fix" by pressing Send again.
      return {
        error:
          "The transfer was sent but Cashfree did not confirm it. Do NOT send again — "
          + "press Reconcile on this payout to find out what happened.",
      };
    case "refused":
      return { error: outcome.reason };
    default:
      return { error: outcome.reason };
  }
}

/** Ask Cashfree what actually happened to a transfer. The primary status source. */
export async function reconcileOwnerPayout(payoutId: string): Promise<ActionResult> {
  const actor = await requireAdminActor();
  if (!actor.ok) return { error: actor.error };
  const idErr = requireUuid(payoutId, "payout id");
  if (idErr) return { error: idErr };

  const res = await reconcilePayout(payoutId);
  revalidatePath("/admin/payments");
  if (!res.ok) return { error: res.error };
  return { success: true };
}

/**
 * Register (or re-read) an owner's payout destination at Cashfree.
 *
 * Only a VERIFIED beneficiary can be paid, and verification is Cashfree's call,
 * not ours — so this is a button an admin presses rather than something that
 * silently happens in the background and is never looked at again.
 */
export async function registerOwnerBeneficiary(hallOwnerId: string): Promise<ActionResult> {
  const actor = await requireAdminActor();
  if (!actor.ok) return { error: actor.error };
  const idErr = requireUuid(hallOwnerId, "owner id");
  if (idErr) return { error: idErr };

  const res = await registerBeneficiary(hallOwnerId);
  await recordAdminAction({
    action:     "owner_beneficiary_registered",
    entityType: "hall_owner",
    entityId:   hallOwnerId,
    newStatus:  res.ok ? (res.status ?? "unknown") : "error",
    reason:     res.ok ? "Payout account registered with Cashfree" : res.error,
  });

  revalidatePath("/admin/payments");
  revalidatePath("/admin/owners");
  if (!res.ok) return { error: res.error };
  if (String(res.status ?? "").toUpperCase() !== "VERIFIED") {
    return { error: `Registered, but Cashfree reports the account as ${res.status ?? "unverified"}. It cannot be paid until it is VERIFIED.` };
  }
  return { success: true };
}

/**
 * Record that an owner was paid OUTSIDE the gateway — by NEFT/UPI, by hand.
 *
 * WHY THIS EXISTS: until Cashfree activates Easy Split there is no automatic
 * payout at all, so every accepted booking has to be settled by bank transfer.
 * Before this action there was no way to write that fact down, and the gap cost
 * money twice over:
 *
 *   • dispatchOwnerPayout refuses a booking already marked done,
 *     so a booking already paid by NEFT could be dispatched again the moment
 *     Easy Split came online — paying the owner twice.
 *   • issueRefund's double-spend guard is `split_status === "done"`, which a
 *     hand transfer never wrote. So a later cancellation would refund the
 *     customer on top of a share already sent to the venue.
 *
 * Writing 'done' closes both, because both already key off exactly that value.
 * The reference is required: an untraceable "trust me, I paid it" is what this
 * is meant to replace.
 */
export async function markPayoutSettledManually(
  bookingId: string,
  reference: string,
): Promise<ActionResult> {
  const actor = await requireAdminActor();
  if (!actor.ok) return { error: actor.error };
  const idErr = requireUuid(bookingId, "booking id");
  if (idErr) return { error: idErr };

  const ref = (reference ?? "").trim().replace(/\s+/g, " ").slice(0, 200);
  if (ref.length < 4) {
    return { error: "Enter the bank/UPI reference for the transfer you made." };
  }

  // SERVICE ROLE — 0046 revoked every client write on payments and restored
  // none, by design, so split_status is unwritable by `authenticated` and this
  // raised 42501 every time. It matters more than a broken button: this is the
  // ONLY writer of split_status='done', and issueRefund's double-spend guard
  // reads exactly that value. While this failed, a venue could be paid by hand
  // and the customer still refunded in full on top of it. Same pattern as
  // issueRefund — requireAdminActor() gates it, guard_payment_split_writes()
  // backs it, recordAdminAction below keeps the trail.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getSupabaseAdminClient() as any;

  const { data: payment } = await db
    .from("payments")
    .select("id, split_status, refund_state, status")
    .eq("booking_id", bookingId)
    .eq("status", "payment_success")
    .maybeSingle();

  if (!payment) return { error: "No successful payment found for this booking." };
  if (payment.split_status === "done") {
    return { error: "This payout is already recorded as settled." };
  }
  // A refund in flight means the money is the CUSTOMER's. Recording a payout
  // here would assert the opposite.
  if (["owed", "processing", "completed"].includes(String(payment.refund_state ?? "none"))) {
    return { error: "A refund is in progress on this booking — resolve that first." };
  }

  // AND NOT WHILE A MACHINE TRANSFER IS LIVE. Asserting by hand that money was
  // sent, while Cashfree is moving money to the same account, is precisely the
  // double payment this queue exists to prevent. The non-terminal row is the
  // authority; clear it with Reconcile before recording anything manually.
  const { data: liveTransfer } = await db
    .from("owner_payouts")
    .select("id, transfer_id, status")
    .eq("booking_id", bookingId)
    .eq("is_terminal", false)
    .maybeSingle();
  if (liveTransfer) {
    return {
      error:
        `A Cashfree transfer for this booking is still open (${liveTransfer.status}). `
        + "Press Reconcile on it first — recording a manual payment now could send the money twice.",
    };
  }

  // count:"exact" — an RLS-filtered update reports zero rows with no error, and
  // silently claiming a payout is settled is the one outcome worse than the bug.
  const { error, count } = await db
    .from("payments")
    .update(
      { split_status: "done", split_error: `Settled manually: ${ref}` },
      { count: "exact" },
    )
    .eq("id", payment.id)
    .neq("split_status", "done");

  if (error)       return { error: sanitizeError(error, "admin") };
  if (count === 0) return { error: "Could not record the payout — reload and try again." };

  await recordAdminAction({
    action:     "owner_payout_settled_manually",
    entityType: "booking",
    entityId:   bookingId,
    newStatus:  "done",
    reason:     `Paid outside the gateway. Reference: ${ref}`,
  });

  revalidatePath("/admin/payments");
  return { success: true };
}

/**
 * Cancel a booking on behalf of the VENUE or the PLATFORM.
 *
 * WHY THIS EXISTS: before it, the only way out of an `owner_confirmed` booking
 * was the customer's own cancel button — which passes initiator "customer" and
 * therefore applies the customer PENALTY schedule. So when a venue flooded five
 * days before a wedding, the customer cancelled and got back **nothing**:
 * `customerRefundPercent(5)` is 0% and the platform fee is retained. On a
 * ₹1,00,000 hall that is ₹25,200 forfeited for a cancellation the venue caused.
 * The admin could not originate a refund either — `issueRefund` can only pay
 * out a row that `recordBookingRefund` has already marked 'owed'.
 *
 * Passing "owner" or "platform" gives the customer 100% of the advance AND the
 * platform fee back, which is exactly what /refund-policy §6 already promises
 * in writing.
 *
 * The service role is used for the status write on purpose: the DB trigger
 * validate_booking_transition() only allows the CUSTOMER or the OWNER of the
 * hall to move a booking, and an admin is neither.
 */
export async function cancelBookingAsAdmin(
  bookingId: string,
  reason: string,
  initiator: "owner" | "platform",
): Promise<ActionResult> {
  const actor = await requireAdminActor();
  if (!actor.ok) return { error: actor.error };
  const idErr = requireUuid(bookingId, "booking id");
  if (idErr) return { error: idErr };

  const cleanReason = (reason ?? "").replace(/[<>]/g, "").trim().slice(0, 500);
  if (cleanReason.length < 10) {
    return { error: "Give a reason of at least 10 characters — the customer is told it." };
  }

  const CANCELLABLE = ["payment_success", "booking_requested", "owner_confirmed"];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adminDb = getSupabaseAdminClient() as any;

  const { data: booking } = await adminDb
    .from("bookings").select("id, status").eq("id", bookingId).maybeSingle();
  if (!booking) return { error: "Booking not found." };
  if (!CANCELLABLE.includes(String(booking.status))) {
    return { error: `A booking in "${String(booking.status).replace(/_/g, " ")}" cannot be cancelled.` };
  }

  const { error, count } = await adminDb
    .from("bookings")
    .update(
      {
        status: "cancelled",
        cancel_reason:
          initiator === "owner"
            ? `Cancelled by the venue: ${cleanReason}`
            : `Cancelled by Hallnect: ${cleanReason}`,
      },
      { count: "exact" },
    )
    .eq("id", bookingId)
    .in("status", CANCELLABLE);

  if (error)       return { error: sanitizeError(error, "admin") };
  if (count === 0) return { error: "This booking changed state — reload and try again." };

  // Give the dates back, or the venue loses them forever.
  await releaseAvailabilityForBooking(bookingId);

  await recordAdminAction({
    action:         initiator === "owner" ? "booking.cancelled_by_venue" : "booking.cancelled_by_platform",
    entityType:     "booking",
    entityId:       bookingId,
    previousStatus: String(booking.status),
    newStatus:      "cancelled",
    reason:         cleanReason,
  });

  await notifyBookingEvent("booking.cancelled", bookingId, { reason: cleanReason });

  // THE POINT OF THE WHOLE ACTION: initiator decides the refund. "owner" and
  // "platform" both return the full advance AND the platform fee.
  // OrAlert — see the note in app/customer/actions.ts.
  const { refund } = await recordBookingRefundOrAlert(bookingId, initiator);
  if (refund && refund.refundAmount > 0) {
    await notifyBookingEvent("refund.initiated", bookingId, { amount: refund.refundAmount });
  }

  revalidatePath("/admin/bookings");
  revalidatePath("/admin/payments");
  revalidatePath(`/customer/bookings/${bookingId}`);
  return { success: true };
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
      description:     v.description || null,
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

/**
 * Change a live coupon's redemption cap and expiry.
 *
 * WHY THIS EXISTS. createCoupon could set both, and stopCoupon/resumeCoupon
 * could switch a coupon off and on — but nothing could change the LIMITS once a
 * coupon existed. So the only way to bound an uncapped code was to stop it and
 * create a replacement under a different name, which breaks every link and
 * poster already carrying the old one. LAUNCH2026 shipped uncapped and
 * unexpiring for that reason, waiving the platform fee without limit.
 *
 * Both fields are OPTIONAL and blank means "no limit", exactly as on create —
 * so this can also lift a cap, deliberately. The audit row records the before
 * and after of both, because that pair is the whole commercial content of the
 * change.
 *
 * The DATABASE is the real enforcement either way: guard_booking_coupon_integrity
 * re-checks is_active, expiry and the redemption count on every booking INSERT,
 * so a cap set here binds even against a booking that never went through
 * resolveCoupon.
 */
export async function updateCouponLimits(couponId: string, input: {
  maxRedemptions?: string;
  expiresAt?: string;
}): Promise<ActionResult> {
  const actor = await requireAdminActor();
  if (!actor.ok) return { error: actor.error };

  const idErr = requireUuid(couponId, "coupon id");
  if (idErr) return { error: idErr };

  const parsed = parseSafe(couponLimitsSchema, input);
  if (!parsed.ok) return { error: parsed.error };
  const v = parsed.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = actor.supabase as any;

  const { data: before } = await db
    .from("coupons")
    .select("code, max_redemptions, expires_at")
    .eq("id", couponId)
    .maybeSingle();
  if (!before) return { error: "Coupon not found." };

  // REFUSE A CAP THAT IS ALREADY BEHIND. Setting max_redemptions below what has
  // already been redeemed would not claw anything back — those bookings are
  // paid and their fee is waived for good — it would only make the coupon dead
  // on arrival while looking like it still had room. Say so instead.
  if (v.maxRedemptions != null) {
    const { count, error: countErr } = await db
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("coupon_id", couponId)
      .in("status", ["payment_success", "booking_requested", "owner_confirmed", "completed"]);
    if (countErr || count == null) {
      return { error: "Could not read how many times this coupon has been used." };
    }
    if (v.maxRedemptions < count) {
      return {
        error:
          `This coupon has already been redeemed ${count} time${count === 1 ? "" : "s"}. ` +
          `A cap below that would stop it immediately — enter ${count} or more, or stop the coupon.`,
      };
    }
  }

  // count:"exact" — an RLS-filtered UPDATE reports zero rows with NO error, so
  // without this a non-admin would be told the limits had changed.
  const { error, count } = await db
    .from("coupons")
    .update(
      {
        max_redemptions: v.maxRedemptions ?? null,
        expires_at:      v.expiresAt ?? null,
      },
      { count: "exact" },
    )
    .eq("id", couponId);

  if (error) return { error: sanitizeError(error, "admin") };
  if (count === 0) return { error: "You do not have permission to change this coupon." };

  const describe = (max: unknown, exp: unknown) =>
    `${max == null ? "unlimited" : `${max} redemptions`}, ` +
    `${exp == null ? "no expiry" : `expires ${String(exp).slice(0, 10)}`}`;

  await recordAdminAction({
    action:     "coupon.limits_changed",
    entityType: "coupon",
    entityId:   couponId,
    // The audit page renders `reason` and not `metadata`, so the whole change
    // has to be legible here.
    reason:
      `Coupon ${before.code}: ${describe(before.max_redemptions, before.expires_at)} ` +
      `-> ${describe(v.maxRedemptions ?? null, v.expiresAt ?? null)}.`,
    metadata: {
      code: before.code,
      previous: { max_redemptions: before.max_redemptions, expires_at: before.expires_at },
      next:     { max_redemptions: v.maxRedemptions ?? null, expires_at: v.expiresAt ?? null },
    },
  });

  revalidatePath("/admin/coupons");
  return { success: true };
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
