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
//   • RATE LIMITING LIVES IN lib/otp-guard.ts, in the DATABASE, and is SHARED
//     with the lead-enquiry flow. The ceilings, the reservation-then-re-check
//     ordering and the reasoning behind each limit all moved there unchanged
//     when a second flow began sending codes — so a number hammered through
//     the enquiry form and the same number hammered here hit the SAME counters
//     rather than getting an allowance each. Read that file for why the row is
//     written BEFORE the SMS and why the global fuse fails closed.
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
import {
  guardOtpSend,
  failedCheckLimitReached,
  recordCheckAttempt,
  RESEND_COOLDOWN_SECONDS,
  GENERIC_SEND_ERROR,
} from "@/lib/otp-guard";

export type OtpActionResult =
  | { success: true; cooldownSeconds?: number }
  | { error: string };

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

  const guard = await guardOtpSend({ userId: user.id, phone });
  if (!guard.ok) return { error: guard.error };

  const result = resend
    ? await resendVerificationOtp(phone)
    : await sendVerificationOtp(phone);

  // The attempt row already counts against every ceiling whatever this says —
  // a failed send still consumed an attempt, and not counting it would leave a
  // free retry loop against MSG91.
  await guard.settle(result.ok);

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

  let db: ReturnType<typeof getSupabaseAdminClient>;
  try {
    db = getSupabaseAdminClient();
  } catch {
    return { error: "Could not verify the code. Please try again." };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;

  // Brute-force ceiling, scoped to the PHONE rather than the account.
  if (await failedCheckLimitReached(phone)) {
    return { error: "Too many incorrect attempts. Request a new code in a few minutes." };
  }

  const result = await checkVerificationOtp(phone, clean);

  // A provider outage is NOT a failed attempt. Counting it would let MSG91
  // being down lock a legitimate user out of their own account.
  if (!result.ok) {
    return { error: "Could not verify the code right now. Please try again." };
  }

  await recordCheckAttempt({ userId: user.id, phone, approved: result.approved });

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
