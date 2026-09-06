// ─────────────────────────────────────────────────────────────────────────────
// lib/account-deletion.ts — closing a customer account. SERVER-ONLY.
//
// WHY THIS ANONYMISES RATHER THAN DELETES, AND WHY THAT IS NOT A DODGE.
//
// bookings.customer_id and payments.customer_id are ON DELETE **RESTRICT**.
// Postgres will refuse to remove a profiles row while either exists, and that
// is correct: /privacy §7 says booking and transaction records are retained for
// seven years because tax and consumer law require it, and a marketplace that
// could erase its own payment trail on request would be unable to answer a
// chargeback, a GST assessment or a consumer complaint.
//
// So "delete my account" means: the PERSON becomes unidentifiable, and the
// TRANSACTION survives as an amount against an id. That is what the DPDP Act
// asks for — erasure of personal data no longer necessary for the purpose it
// was collected for — not destruction of records another statute compels.
//
// WHAT ACTUALLY HAPPENS
//   • Every identifying field on the profile is overwritten. Not nulled where
//     the column is NOT NULL, not left "mostly" scrubbed.
//   • The auth user is deleted, so the account cannot be signed into again and
//     the email is freed for re-registration. profiles has NO foreign key to
//     auth.users, so this does not cascade into the financial rows.
//   • saved halls and OTP attempts are deleted outright. Neither is a record of
//     a transaction; the first is a preference list and the second is a log of
//     which account proved which phone number, which is exactly the kind of
//     personal data that should not outlive the account.
//   • Bookings, payments, commissions, reviews and support tickets stay, now
//     attached to an anonymous profile.
//
// WHY AN OWNER CANNOT USE THIS. A venue owner's halls, their live bookings and
// their payout identity are other people's business too — a customer holding a
// confirmed booking would lose the venue's identity mid-contract. Owners are
// refused here and pointed at the grievance channel, where it is a human
// decision. Saying so is better than a control that half-works.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { SUSPENSION_BAN_DURATION } from "@/lib/constants";

export type DeleteAccountOutcome =
  | { ok: true }
  | { ok: false; error: string };

/** Statuses where the customer still has something live with a venue. */
const LIVE_BOOKING_STATUSES = [
  "pending_payment",
  "payment_success",
  "booking_requested",
  "owner_confirmed",
];

/**
 * Anonymises a customer account and removes its sign-in.
 *
 * Refuses when the customer has a live booking or an unpaid refund, because
 * both are open obligations between two parties and neither survives losing one
 * side's contact details: a venue cannot reach them about a confirmed event,
 * and a refund cannot be chased by someone who no longer exists.
 */
export async function deleteCustomerAccount(userId: string): Promise<DeleteAccountOutcome> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getSupabaseAdminClient() as any;

  const { data: profile, error: pErr } = await db
    .from("profiles").select("id, role").eq("id", userId).maybeSingle();
  if (pErr)      return { ok: false, error: "Could not read the account. Please try again." };
  if (!profile)  return { ok: false, error: "Account not found." };

  if (profile.role !== "customer") {
    return {
      ok: false,
      error:
        "Venue owner and administrator accounts cannot be closed from here, because " +
        "listings and payouts involve other people. Email us from the Grievance " +
        "Redressal page and we will handle it directly.",
    };
  }

  // OPEN OBLIGATIONS BLOCK CLOSURE, in both directions.
  const { data: liveBookings, error: bErr } = await db
    .from("bookings")
    .select("id")
    .eq("customer_id", userId)
    .in("status", LIVE_BOOKING_STATUSES)
    .limit(1);
  if (bErr) return { ok: false, error: "Could not check your bookings. Please try again." };
  if (liveBookings?.length) {
    return {
      ok: false,
      error:
        "You still have a booking in progress. Cancel or complete it first — a venue " +
        "needs to be able to reach you about a booking they are holding.",
    };
  }

  const { data: owedRefunds, error: rErr } = await db
    .from("payments")
    .select("id")
    .eq("customer_id", userId)
    .in("refund_state", ["owed", "processing", "failed"])
    .limit(1);
  if (rErr) return { ok: false, error: "Could not check your refunds. Please try again." };
  if (owedRefunds?.length) {
    return {
      ok: false,
      error:
        "You have a refund still being processed. We cannot close the account while " +
        "money is owed to you — please wait for it to arrive, or contact us.",
    };
  }

  // ── Scrub ──────────────────────────────────────────────────────────────────
  // Overwritten, not nulled: role and is_active are NOT NULL, and a blank name
  // reads as a bug to whoever sees it next. A tombstone says what happened.
  const { error: scrubErr } = await db
    .from("profiles")
    .update({
      full_name:  "Deleted account",
      email:      null,
      phone:      null,
      avatar_url: null,
      is_active:  false,
      phone_verified: false,
      phone_verified_at: null,
      // Belt and braces: an anonymised profile must never be a notification
      // recipient. events.ts resolves recipients from these columns, and a
      // scrubbed phone already makes that impossible — this makes it explicit.
      notifications_enabled: false,
      sms_notifications_enabled: false,
    })
    .eq("id", userId);

  if (scrubErr) {
    console.error("[account-deletion] scrub failed:", scrubErr.code, scrubErr.message);
    return { ok: false, error: "Could not close the account. Please contact support." };
  }

  // ── Purge what is purely personal ──────────────────────────────────────────
  // Best-effort and AFTER the scrub: the identity is already gone at this point,
  // so a failure here leaves residue rather than an identifiable account. Logged
  // so it is not silent.
  for (const table of ["saved_halls", "otp_attempts"] as const) {
    const col = table === "saved_halls" ? "customer_id" : "user_id";
    const { error } = await db.from(table).delete().eq(col, userId);
    if (error) console.error(`[account-deletion] ${table} purge failed:`, error.message);
  }

  // ── Remove the sign-in ─────────────────────────────────────────────────────
  // Last, deliberately. If this fails the account is already anonymous, which is
  // the part that matters legally; a lingering auth row is a support fix. Doing
  // it first would risk an account that cannot sign in but still carries a name
  // and a phone number.
  // BAN FIRST, THEN DELETE. The delete used to stand alone and swallow its
  // error, which left the one state this whole function exists to avoid: a
  // profile scrubbed and is_active=false, with a LIVE, unbanned auth user
  // behind it. profiles.is_active is invisible to RLS — verified against the
  // live database, no policy anywhere references it — so the person's existing
  // refresh token keeps minting JWTs and PostgREST keeps serving them. The
  // account would read as closed on every Hallnect screen while still being a
  // working API credential.
  //
  // A ban is cheap, is the same mechanism the admin suspension uses, and is
  // redundant the moment the delete below succeeds. Its whole value is the path
  // where the delete does NOT.
  const { error: banErr } = await db.auth.admin.updateUserById(userId, {
    ban_duration: SUSPENSION_BAN_DURATION,
  });
  if (banErr) {
    console.error("[account-deletion] auth ban failed:", banErr.message);
  }

  const { error: authErr } = await db.auth.admin.deleteUser(userId);
  if (authErr) {
    console.error("[account-deletion] auth user delete failed:", authErr.message);
    // Still not surfaced as a failure: the identity is already gone, which is
    // what the person asked for and what the policy promises. The difference
    // now is that a lingering auth row is inert — banned above — rather than a
    // usable credential waiting for someone to notice.
  }

  return { ok: true };
}
