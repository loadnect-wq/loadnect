"use server";

// ─────────────────────────────────────────────────────────────────────────────
// Phone-verification server actions (MSG91 OTP over SMS).
//
// SECURITY
//   • Session-derived identity only — the phone is verified FOR the logged-in
//     user; no user id is ever accepted from the client.
//   • MSG91 credentials never leave the server (lib/msg91 is server-only).
//   • OTP values are never generated, stored or logged here. MSG91 owns the
//     code; the only OTP that enters this process is the one the user types,
//     and it goes straight back out to MSG91 for checking.
//   • RATE LIMITING IS IN THE DATABASE, not in a module-level Map.
//     The previous in-memory buckets reset on every cold start and were not
//     shared between instances, so on serverless the cap was "5 per hour per
//     instance" — i.e. no cap at all against anyone willing to retry until
//     they landed on a fresh lambda. Each attempt is now a row, so the ceiling
//     holds across instances and restarts. Rows record WHETHER an attempt
//     happened, never the code.
//   • THE ROW IS WRITTEN BEFORE THE SMS, NOT AFTER. Reading every ceiling and
//     then sending is a read-then-act race: requests fired in parallel all read
//     the same counts, all decide they are under the limit, and each one spends
//     a message. The attempt row is therefore a RESERVATION — inserted first,
//     then the ceilings are re-counted with that row included, and only then is
//     anything sent. A request that loses the race leaves a consumed row and
//     sends nothing, which is the direction that cannot cost money.
//   • Three independent ceilings, because they stop different attacks:
//       – per user+phone : ordinary abuse and accidental hammering
//       – per phone      : one attacker rotating ACCOUNTS to SMS-bomb a victim
//       – failed checks  : brute-forcing a 6-digit code
//   • Verification alone NEVER changes roles — it only marks the phone
//     verified on the caller's own profile row.
// ─────────────────────────────────────────────────────────────────────────────

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  isOtpConfigured,
  normalizePhoneE164,
  sendVerificationOtp,
  resendVerificationOtp,
  checkVerificationOtp,
} from "@/lib/msg91";

const RESEND_COOLDOWN_SECONDS = 60;
const MAX_SENDS_PER_USER_PHONE_PER_HOUR = 5;
const MAX_SENDS_PER_PHONE_PER_DAY = 10;
const MAX_FAILED_CHECKS = 5;
const FAILED_CHECK_WINDOW_MINUTES = 15;

// EVERY CEILING ABOVE IS SCOPED TO ONE PHONE NUMBER, WHICH LEAVES A HOLE.
//
// The resend cooldown and the hourly cap are keyed on (user_id, phone); the
// daily cap is keyed on phone. So they all reset the moment the attacker types
// a DIFFERENT number. One signed-in account could walk a list of strangers'
// numbers and send each of them a code, hitting no limit at all — every counter
// reads zero for a phone that has never been texted before.
//
// Each of those is a billed SMS to someone who never asked for it. These two
// ceilings are the ones that do not reset per number: what a single account may
// spend in a day, and what the whole platform may spend in a day. They mirror
// MAX_PER_ACCOUNT_PER_DAY / MAX_GLOBAL_PER_DAY in lib/notifications/service.ts,
// which already guards the notification path for exactly this reason.
const MAX_SENDS_PER_ACCOUNT_PER_DAY = 15;
const MAX_OTP_SENDS_GLOBAL_PER_DAY = 300;

export type OtpActionResult =
  | { success: true; cooldownSeconds?: number }
  | { error: string };

/** Every failure the user sees. Kept identical in shape so nothing here leaks
 *  whether a number is registered to somebody else. */
const GENERIC_SEND_ERROR = "Could not send the code. Please try again.";

type Db = ReturnType<typeof getSupabaseAdminClient>;

function since(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

/**
 * Counts prior attempts. Returns null when the table is missing (an
 * un-migrated environment) so the caller can decide — and it decides to ALLOW,
 * because a missing rate-limit table must not lock every user out of
 * verifying their phone. MSG91 enforces its own service-side ceilings under
 * this one.
 */
async function countAttempts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  // `phone` is optional so the same helper can count the two ceilings that must
  // NOT be scoped to a number — per account, and platform-wide.
  filters: { phone?: string; userId?: string; kind: "send" | "check"; succeeded?: boolean; sinceIso: string },
): Promise<number | null> {
  let q = db
    .from("otp_attempts")
    .select("id", { count: "exact", head: true })
    .eq("kind", filters.kind)
    .gte("created_at", filters.sinceIso);
  if (filters.phone) q = q.eq("phone", filters.phone);
  if (filters.userId) q = q.eq("user_id", filters.userId);
  if (filters.succeeded !== undefined) q = q.eq("succeeded", filters.succeeded);

  const { count, error } = await q;
  if (error) {
    console.error("[verify-phone] attempt count failed:", error.code, error.message);
    return null;
  }
  return count ?? 0;
}

/**
 * Writes one attempt row and hands back its identity.
 *
 * The identity matters for a send: that row is the caller's RESERVATION, and
 * every re-count below has to be able to tell it apart from a row a parallel
 * request inserted at the same moment. Returns null when the row could not be
 * written, which for a send means the attempt cannot be metered at all.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function recordAttempt(db: any, row: {
  userId: string; phone: string; kind: "send" | "check"; succeeded: boolean;
}): Promise<{ id: string; createdAt: string } | null> {
  const { data, error } = await db.from("otp_attempts").insert({
    user_id: row.userId,
    phone: row.phone,
    kind: row.kind,
    succeeded: row.succeeded,
  })
    .select("id, created_at")
    .single();
  if (error) {
    console.error("[verify-phone] attempt record failed:", error.code, error.message);
    return null;
  }
  return { id: data.id, createdAt: data.created_at };
}

/** Marks a reserved send as delivered. Best-effort: the row already counts
 *  against every ceiling whatever this says, so a failure here costs nothing
 *  but accuracy in the admin's view of what happened. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function markAttemptSucceeded(db: any, attemptId: string): Promise<void> {
  const { error } = await db.from("otp_attempts").update({ succeeded: true }).eq("id", attemptId);
  if (error) console.error("[verify-phone] attempt update failed:", error.code, error.message);
}

/**
 * Seconds still to wait before another send is allowed, or 0.
 *
 * `reservation` is the caller's OWN attempt row. Once that row exists it is the
 * most recent send, so without excluding it every request would read itself back
 * and refuse. Rows at or before its timestamp still count — including one a
 * parallel request inserted in the same instant — which is what stops two
 * simultaneous requests both concluding they were first.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function cooldownRemaining(db: any, userId: string, phone: string,
  reservation?: { id: string; createdAt: string }): Promise<number> {
  let q = db
    .from("otp_attempts")
    .select("created_at")
    .eq("user_id", userId)
    .eq("phone", phone)
    .eq("kind", "send");
  if (reservation) {
    q = q.neq("id", reservation.id).lte("created_at", reservation.createdAt);
  }
  const { data, error } = await q
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data?.created_at) return 0;

  const elapsed = (Date.now() - new Date(data.created_at).getTime()) / 1000;
  return Math.max(0, Math.ceil(RESEND_COOLDOWN_SECONDS - elapsed));
}

/**
 * Every send ceiling, in the order they are tested. Returns the message to show
 * the user, or null when the send may proceed.
 *
 * `own` is how many of the caller's own rows are already in the table: 0 before
 * reserving, 1 afterwards. Adding it to each limit is what lets the SAME
 * ceilings be applied on both sides of the reservation without re-tuning any of
 * them. Take the hourly cap of 5: before the row exists, four prior sends must
 * pass and five must not; once the reservation is counted those same two states
 * read five and six, so the limit has to move by exactly the one row we added.
 */
async function ceilingReached(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any, userId: string, phone: string, own: 0 | 1,
): Promise<string | null> {
  const perUser = await countAttempts(db, {
    phone, userId, kind: "send", sinceIso: since(60),
  });
  if (perUser !== null && perUser >= MAX_SENDS_PER_USER_PHONE_PER_HOUR + own) {
    return "Too many codes requested. Please try again in an hour.";
  }

  // Deliberately NOT scoped to the user: this is the ceiling that stops one
  // attacker creating accounts to SMS-bomb somebody else's phone.
  const perPhone = await countAttempts(db, {
    phone, kind: "send", sinceIso: since(60 * 24),
  });
  if (perPhone !== null && perPhone >= MAX_SENDS_PER_PHONE_PER_DAY + own) {
    return "Too many codes requested for this number today. Please try again tomorrow.";
  }

  // Not scoped to a phone: this is what stops ONE account rotating through
  // other people's numbers, where every phone-keyed counter above reads zero.
  const perAccount = await countAttempts(db, {
    userId, kind: "send", sinceIso: since(60 * 24),
  });
  if (perAccount !== null && perAccount >= MAX_SENDS_PER_ACCOUNT_PER_DAY + own) {
    return "Too many codes requested from this account today. Please try again tomorrow.";
  }

  // The cost fuse. Every send below is a billed SMS out of a shared prepaid
  // wallet, so this bounds what any pattern — including one nobody has thought
  // of — can spend in a day.
  //
  // This one FAILS CLOSED, unlike its siblings. They allow on a count error
  // because a rate-limit table that cannot be read must not lock everyone out
  // of verifying a phone. That reasoning inverts here: null means either the
  // query failed or otp_attempts does not exist, and in BOTH cases every
  // ceiling above is reading zero and no attempt row is being written — the
  // guard rails are down, not merely noisy. Sending on regardless would spend
  // real money with nothing counting it.
  //
  // The cost is that an environment without otp_attempts cannot send codes at
  // all, rather than sending them unmetered. countAttempts logs the underlying
  // error, so that shows up as a missing migration rather than a mystery.
  const globalToday = await countAttempts(db, { kind: "send", sinceIso: since(60 * 24) });
  if (globalToday === null || globalToday >= MAX_OTP_SENDS_GLOBAL_PER_DAY + own) {
    return GENERIC_SEND_ERROR;
  }

  return null;
}

/**
 * Sends a code to the caller's chosen number.
 *
 * `resend` uses MSG91's retry endpoint, which re-delivers the SAME code rather
 * than minting a new one — so a user who eventually receives the first SMS can
 * still use it instead of being told it is wrong.
 */
export async function sendPhoneOtp(rawPhone: string, resend = false): Promise<OtpActionResult> {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in to verify your phone." };

  if (!isOtpConfigured()) {
    return { error: "Phone verification is not available yet. Please try again later." };
  }

  const phone = normalizePhoneE164(rawPhone);
  if (!phone) return { error: "Enter a valid mobile number." };

  let db: Db;
  try {
    db = getSupabaseAdminClient();
  } catch {
    return { error: GENERIC_SEND_ERROR };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;

  // ── Pass one: refuse without spending an attempt ──────────────────────────
  // The ordinary refusals are decided BEFORE any row is written, exactly as
  // they always were. That is not redundant with the re-check below, it is what
  // keeps a refusal free: a user who taps Resend early must not burn one of
  // their five hourly attempts on an answer we already know, and a request
  // refused here must not add a row to the platform-wide fuse, which would let
  // anyone shut phone verification down for the whole platform without a single
  // SMS being sent.
  const wait = await cooldownRemaining(anyDb, user.id, phone);
  if (wait > 0) {
    return { error: `Please wait ${wait}s before requesting another code.` };
  }

  const blocked = await ceilingReached(anyDb, user.id, phone, 0);
  if (blocked) return { error: blocked };

  // ── Reserve, then re-check, then spend ────────────────────────────────────
  // Everything above is a read, and reads do not exclude each other: requests
  // fired in parallel all saw room and all sent. The row goes in FIRST and is
  // the reservation — from here on, every ceiling is re-counted with this row
  // included, so a concurrent request is visible instead of invisible.
  //
  // It is inserted as not-yet-succeeded and flipped only if MSG91 accepts it.
  // Either way it counts, because a failed send still consumed an attempt and
  // not counting it would leave a free retry loop against MSG91.
  const reservation = await recordAttempt(anyDb, {
    userId: user.id, phone, kind: "send", succeeded: false,
  });
  // No reservation means nothing is counting this send. Same call as the global
  // fuse makes: refuse rather than spend unmetered.
  if (!reservation) return { error: GENERIC_SEND_ERROR };

  const raceWait = await cooldownRemaining(anyDb, user.id, phone, reservation);
  if (raceWait > 0) {
    return { error: `Please wait ${raceWait}s before requesting another code.` };
  }

  const raceBlocked = await ceilingReached(anyDb, user.id, phone, 1);
  if (raceBlocked) return { error: raceBlocked };

  const result = resend
    ? await resendVerificationOtp(phone)
    : await sendVerificationOtp(phone);

  if (result.ok) await markAttemptSucceeded(anyDb, reservation.id);

  if (!result.ok) {
    switch (result.error) {
      case "invalid_phone":  return { error: "This number cannot receive verification codes." };
      case "rate_limited":   return { error: "Too many attempts. Please try again shortly." };
      case "not_configured": return { error: "Phone verification is not available yet." };
      default:               return { error: GENERIC_SEND_ERROR };
    }
  }

  return { success: true, cooldownSeconds: RESEND_COOLDOWN_SECONDS };
}

export async function verifyPhoneOtp(
  rawPhone: string,
  code: string,
): Promise<OtpActionResult> {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in to verify your phone." };

  if (!isOtpConfigured()) {
    return { error: "Phone verification is not available yet. Please try again later." };
  }

  const phone = normalizePhoneE164(rawPhone);
  if (!phone) return { error: "Enter a valid mobile number." };

  const clean = (code ?? "").replace(/\D/g, "");
  if (!/^\d{4,8}$/.test(clean)) return { error: "Enter the code you received." };

  let db: Db;
  try {
    db = getSupabaseAdminClient();
  } catch {
    return { error: "Could not verify the code. Please try again." };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;

  // Brute-force ceiling. Scoped to the PHONE, not the account: a 6-digit code
  // has a million values, and an attacker with several accounts pointed at one
  // number would otherwise get a fresh allowance with each of them.
  const failed = await countAttempts(anyDb, {
    phone, kind: "check", succeeded: false, sinceIso: since(FAILED_CHECK_WINDOW_MINUTES),
  });
  if (failed !== null && failed >= MAX_FAILED_CHECKS) {
    return { error: "Too many incorrect attempts. Request a new code in a few minutes." };
  }

  const result = await checkVerificationOtp(phone, clean);

  // A provider outage is NOT a failed attempt. Counting it would let MSG91
  // being down lock a legitimate user out of their own account.
  if (!result.ok) {
    return { error: "Could not verify the code right now. Please try again." };
  }

  await recordAttempt(anyDb, { userId: user.id, phone, kind: "check", succeeded: result.approved });

  if (!result.approved) {
    return { error: "That code is incorrect or has expired." };
  }

  // Success — record verification on the caller's OWN profile row.
  //
  // WRITTEN WITH THE SERVICE ROLE, and the reason is the whole point of this
  // function. Migration 0066 blocks a client from setting phone_verified=true
  // on its own row, because otherwise a PATCH straight to PostgREST grants the
  // exact status this OTP exists to confer — and an OTP-verified profile phone
  // outranks the booking's contact_phone when notifications are routed. The
  // flag is the OUTCOME of a check the server just performed, so the server
  // writes it; the session client can still clear it (changing your number
  // does), which the trigger deliberately allows.
  //
  // The row is still pinned to user.id, so this is not a widening: it is the
  // same single row the session client was writing, with the authority moved to
  // the side that actually verified something. 42703 = columns pre-0023; retry
  // without them so the flow degrades instead of crashing.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let { error: upErr } = await anyDb
    .from("profiles")
    .update({ phone, phone_verified: true, phone_verified_at: new Date().toISOString() })
    .eq("id", user.id);

  if (upErr?.code === "42703") {
    ({ error: upErr } = await anyDb.from("profiles").update({ phone }).eq("id", user.id));
  }
  if (upErr) {
    console.error("[verify-phone] profile update failed:", upErr.message);
    return { error: "Verified, but we could not save it. Please try again." };
  }

  // Only ONE person can control a number at a time. Any OTHER profile still
  // claiming this number as verified proves nothing any more — that account
  // may have released the SIM long ago — so its verified flag is cleared.
  // The number itself is left in place: it is that account's contact detail,
  // and silently blanking it would strand its bookings. Best-effort; a failure
  // here must not undo the verification we just completed.
  try {
    await anyDb
      .from("profiles")
      .update({ phone_verified: false, phone_verified_at: null })
      .eq("phone", phone)
      .eq("phone_verified", true)
      .neq("id", user.id);
  } catch (e) {
    console.error("[verify-phone] stale verification cleanup failed:",
      e instanceof Error ? e.message : "unknown");
  }

  revalidatePath("/verify-phone");
  revalidatePath("/customer/profile");
  revalidatePath("/owner/profile");
  return { success: true };
}
