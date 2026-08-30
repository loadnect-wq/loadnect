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
  filters: { phone: string; userId?: string; kind: "send" | "check"; succeeded?: boolean; sinceIso: string },
): Promise<number | null> {
  let q = db
    .from("otp_attempts")
    .select("id", { count: "exact", head: true })
    .eq("phone", filters.phone)
    .eq("kind", filters.kind)
    .gte("created_at", filters.sinceIso);
  if (filters.userId) q = q.eq("user_id", filters.userId);
  if (filters.succeeded !== undefined) q = q.eq("succeeded", filters.succeeded);

  const { count, error } = await q;
  if (error) {
    console.error("[verify-phone] attempt count failed:", error.code, error.message);
    return null;
  }
  return count ?? 0;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function recordAttempt(db: any, row: {
  userId: string; phone: string; kind: "send" | "check"; succeeded: boolean;
}): Promise<void> {
  const { error } = await db.from("otp_attempts").insert({
    user_id: row.userId,
    phone: row.phone,
    kind: row.kind,
    succeeded: row.succeeded,
  });
  if (error) console.error("[verify-phone] attempt record failed:", error.code, error.message);
}

/** Seconds still to wait before another send is allowed, or 0. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function cooldownRemaining(db: any, userId: string, phone: string): Promise<number> {
  const { data, error } = await db
    .from("otp_attempts")
    .select("created_at")
    .eq("user_id", userId)
    .eq("phone", phone)
    .eq("kind", "send")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data?.created_at) return 0;

  const elapsed = (Date.now() - new Date(data.created_at).getTime()) / 1000;
  return Math.max(0, Math.ceil(RESEND_COOLDOWN_SECONDS - elapsed));
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

  const wait = await cooldownRemaining(anyDb, user.id, phone);
  if (wait > 0) {
    return { error: `Please wait ${wait}s before requesting another code.` };
  }

  const perUser = await countAttempts(anyDb, {
    phone, userId: user.id, kind: "send", sinceIso: since(60),
  });
  if (perUser !== null && perUser >= MAX_SENDS_PER_USER_PHONE_PER_HOUR) {
    return { error: "Too many codes requested. Please try again in an hour." };
  }

  // Deliberately NOT scoped to the user: this is the ceiling that stops one
  // attacker creating accounts to SMS-bomb somebody else's phone.
  const perPhone = await countAttempts(anyDb, {
    phone, kind: "send", sinceIso: since(60 * 24),
  });
  if (perPhone !== null && perPhone >= MAX_SENDS_PER_PHONE_PER_DAY) {
    return { error: "Too many codes requested for this number today. Please try again tomorrow." };
  }

  const result = resend
    ? await resendVerificationOtp(phone)
    : await sendVerificationOtp(phone);

  // Recorded whatever the outcome: a failed send still consumed an attempt, and
  // not counting it would leave a free retry loop against MSG91.
  await recordAttempt(anyDb, { userId: user.id, phone, kind: "send", succeeded: result.ok });

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
  // (profiles_update RLS restricts to auth.uid(); the role column stays locked
  // by the prevent_role_change trigger. 42703 = columns pre-migration-0023;
  // retry without them so the flow degrades instead of crashing.)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sessionDb = supabase as any;
  let { error: upErr } = await sessionDb
    .from("profiles")
    .update({ phone, phone_verified: true, phone_verified_at: new Date().toISOString() })
    .eq("id", user.id);

  if (upErr?.code === "42703") {
    ({ error: upErr } = await sessionDb.from("profiles").update({ phone }).eq("id", user.id));
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
