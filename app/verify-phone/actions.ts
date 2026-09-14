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
  hasRecentSendFor,
  recordCheckAttempt,
  RESEND_COOLDOWN_SECONDS,
  GENERIC_SEND_ERROR,
} from "@/lib/otp-guard";

export type OtpActionResult =
  | { success: true; cooldownSeconds?: number }
  /** `conflict` marks the one failure a retry can never fix: the number is
   *  verified on a DIFFERENT account. The UI must offer support, not "try
   *  again" — see the pre-check in verifyPhoneOtp. */
  | { error: string; conflict?: true };

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

  const guard = await guardOtpSend({ actor: { userId: user.id }, phone });
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

  // THE PHONE HERE COMES FROM THE CLIENT, which is what made the check-side
  // ceiling a weapon: five wrong codes for a stranger's number used to consume
  // that number's whole budget, and the owner of it — who needs phone_verified
  // to see a single lead — was refused their own correct code for the next
  // fifteen minutes, repeatable indefinitely.
  //
  // So a check is only allowed for a number THIS ACCOUNT ASKED FOR A CODE FOR.
  // Refused before MSG91 is consulted and before anything is recorded, so a
  // request for somebody else's number cannot spend their allowance, cannot
  // bill us for a provider call, and leaves no trace on their ceiling.
  //
  // The message is the generic one: saying "you never requested a code for
  // that number" would confirm to an attacker which numbers they have not yet
  // touched, and saying anything about the number's state would be worse.
  if (!(await hasRecentSendFor({ userId: user.id }, phone))) {
    return { error: "That code is incorrect or has expired." };
  }

  const ceiling = await failedCheckLimitReached(phone, { userId: user.id });
  if (ceiling) return { error: ceiling };

  const result = await checkVerificationOtp(phone, clean);

  // A provider outage is NOT a failed attempt. Counting it would let MSG91
  // being down lock a legitimate user out of their own account.
  if (!result.ok) {
    return { error: "Could not verify the code right now. Please try again." };
  }

  await recordCheckAttempt({ actor: { userId: user.id }, phone, approved: result.approved });

  if (!result.approved) {
    return { error: "That code is incorrect or has expired." };
  }

  // ── DOES THIS NUMBER ALREADY BELONG TO SOMEBODY? ──────────────────────────
  //
  // THIS BLOCK REPLACES A SILENT TRANSFER. The previous code verified the
  // number onto the caller's row and THEN cleared the verified flag on any
  // other account holding it, with the comment that the loser "may have
  // released the SIM long ago". That was defensible while a verified phone was
  // only a notification-routing hint. It is not defensible now: migration 0086
  // makes a verified number resolve to exactly one account, which is what lets
  // a person sign in with it — so moving one silently is moving an account.
  //
  // The losing account was never told, never asked, and could not object. That
  // is the "silently merge two accounts" case the linking design forbids.
  //
  // Refused instead, and the caller is told to contact support. Deliberately a
  // human step: proving the number is genuinely theirs now — rather than
  // theirs because they hold the SIM this minute — is exactly the judgement a
  // machine should not make on its own when the outcome is somebody else's
  // account. The number is not revealed to be linked to any particular person.
  //
  // Checked BEFORE the write, not after: uq_profiles_verified_phone would
  // refuse the UPDATE with 23505 anyway, but a raw constraint error reaches the
  // user as "we could not save it", which is both wrong and unactionable.
  const { data: holder } = await anyDb
    .from("profiles")
    .select("id")
    .eq("phone", phone)
    .eq("phone_verified", true)
    .neq("id", user.id)
    .maybeSingle();

  if (holder) {
    return {
      error:
        "This mobile number is already verified on another Hallnect account. " +
        "Contact support so we can check it belongs to you and link the two.",
      conflict: true,
    };
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
  let { error: upErr } = await anyDb
    .from("profiles")
    .update({ phone, phone_verified: true, phone_verified_at: new Date().toISOString() })
    .eq("id", user.id);

  if (upErr?.code === "42703") {
    ({ error: upErr } = await anyDb.from("profiles").update({ phone }).eq("id", user.id));
  }
  // 23505 = uq_profiles_verified_phone. The pre-check above should have caught
  // this, so reaching here means somebody verified the same number in the
  // moment between that read and this write. The constraint is what actually
  // guarantees one account per verified number; the pre-check only exists to
  // produce a sentence a person can act on. Both say the same thing.
  if (upErr?.code === "23505") {
    return {
      error:
        "This mobile number is already verified on another Hallnect account. " +
        "Contact support so we can check it belongs to you and link the two.",
      conflict: true,
    };
  }
  if (upErr) {
    console.error("[verify-phone] profile update failed:", upErr.message);
    return { error: "Verified, but we could not save it. Please try again." };
  }

  revalidatePath("/verify-phone");
  revalidatePath("/customer/profile");
  revalidatePath("/owner/profile");
  return { success: true };
}
