"use server";

// ─────────────────────────────────────────────────────────────────────────────
// Sign in with a mobile number. SERVER ACTIONS.
//
// THE FIRST UNAUTHENTICATED ENDPOINT IN HALLNECT THAT SPENDS MONEY. Everything
// else that sends an SMS requires a session; this cannot, because the whole
// point is that the caller has no session yet. That shapes every decision here.
//
// HOW A SESSION IS PRODUCED, in one line: MSG91 proves possession of the
// number exactly as it does for profile verification today, the account is
// resolved SERVER-SIDE from that verified number, and lib/auth/session-mint.ts
// turns the resolved account into a real Supabase session. Read that file
// before changing anything here — it grants a session for whatever id it is
// given, so this file is a trust boundary.
//
// WHY THE ACCOUNT IS RESOLVED FROM THE PHONE AND NEVER FROM THE CLIENT: a user
// id crossing the wire would be the entire authentication. The only input
// accepted is a phone number and a code, and the number is only meaningful
// after MSG91 says the caller holds it.
//
// ONE ACCOUNT PER VERIFIED NUMBER is what makes "resolve the account from the
// phone" a well-defined operation at all. Migration 0086 enforces it with a
// partial unique index; without that this lookup could return two rows and
// there would be no correct answer.
//
// ── ENUMERATION, AND WHY THE CODE IS SENT FIRST ─────────────────────────────
// A number with no account still receives a code, and only AFTER the code is
// verified is the caller told there is no account. That ordering is deliberate
// and it is the standard answer: checking first and refusing would tell anyone,
// for free, which numbers belong to Hallnect users. This way learning that fact
// requires controlling the number — which is not an attack, it is your own
// phone. The cost is bounded by the ceilings in lib/otp-guard.ts, which are
// shared with every other OTP flow.
// ─────────────────────────────────────────────────────────────────────────────

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
  type OtpActor,
} from "@/lib/otp-guard";
import { clientActorKey } from "@/lib/auth/actor-key";
import { mintSessionForUser } from "@/lib/auth/session-mint";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export type PhoneSignInStart =
  | { success: true; cooldownSeconds: number }
  | { error: string };

export type PhoneSignInVerify =
  | { success: true }
  /** The number is genuinely theirs, but no Hallnect account uses it. Told only
   *  AFTER possession is proven — see the header. */
  | { noAccount: true }
  | { error: string };

/** The caller, for the ceilings. Anonymous by definition on this path. */
async function actor(): Promise<OtpActor> {
  return { actorKey: await clientActorKey() };
}

/**
 * Sends a sign-in code.
 *
 * `resend` uses MSG91's retry endpoint, which re-delivers the SAME code rather
 * than minting a new one — so somebody who taps Resend and then receives the
 * first SMS can still use it, instead of being told the code they are looking
 * at is wrong.
 */
export async function startPhoneSignIn(
  rawPhone: string,
  resend = false,
): Promise<PhoneSignInStart> {
  if (!isOtpConfigured()) {
    return { error: "Signing in by mobile is not available right now. Please use email." };
  }

  const phone = normalizePhoneE164(rawPhone);
  if (!phone) return { error: "Enter a valid mobile number." };

  // Every ceiling: the 60s cooldown, 5/hour per (actor, phone), 10/day per
  // PHONE, 15/day per actor and the fail-closed 300/day global fuse. The
  // per-phone and global ones are SHARED with the signed-in flows, so this new
  // endpoint is not a second allowance against the same number.
  const guard = await guardOtpSend({ actor: await actor(), phone });
  if (!guard.ok) return { error: guard.error };

  const sent = resend
    ? await resendVerificationOtp(phone)
    : await sendVerificationOtp(phone);

  // The reservation counts against every ceiling whatever this says: a failed
  // send still consumed an attempt, and not counting it leaves a free retry
  // loop against MSG91.
  await guard.settle(sent.ok);

  if (!sent.ok) {
    switch (sent.error) {
      case "invalid_phone":  return { error: "This number cannot receive verification codes." };
      case "rate_limited":   return { error: "Too many attempts. Please try again shortly." };
      case "not_configured": return { error: "Signing in by mobile is not available right now." };
      default:               return { error: GENERIC_SEND_ERROR };
    }
  }

  return { success: true, cooldownSeconds: RESEND_COOLDOWN_SECONDS };
}

/**
 * Checks the code and, on success, signs the caller in.
 *
 * THE ORDER OF THE CHECKS IS THE SECURITY. Possession is proven before the
 * account is looked up, and the account is looked up before a session exists.
 * No step may move.
 */
export async function verifyPhoneSignIn(
  rawPhone: string,
  code: string,
): Promise<PhoneSignInVerify> {
  if (!isOtpConfigured()) {
    return { error: "Signing in by mobile is not available right now. Please use email." };
  }

  const phone = normalizePhoneE164(rawPhone);
  if (!phone) return { error: "Enter a valid mobile number." };

  const clean = (code ?? "").replace(/\D/g, "");
  if (!/^\d{4,8}$/.test(clean)) return { error: "Enter the code you received." };

  const me = await actor();

  // A code may only be CHECKED for a number this caller asked for one for.
  // Without it, one client could spend a stranger's failed-check budget and
  // lock them out of their own sign-in — finding OTP-2, which is fixed and must
  // stay fixed. The message is the generic wrong-code line on purpose: "you
  // never requested a code for that number" would confirm which numbers a
  // prober has not yet touched.
  if (!(await hasRecentSendFor(me, phone))) {
    return { error: "That code is incorrect or has expired." };
  }

  const ceiling = await failedCheckLimitReached(phone, me);
  if (ceiling) return { error: ceiling };

  const result = await checkVerificationOtp(phone, clean);

  // A provider outage is NOT a failed attempt, and above all it is NOT an
  // approval. Collapsing the two would let an MSG91 hiccup either lock out a
  // real user or — far worse — sign somebody in.
  if (!result.ok) {
    return { error: "Could not check that code right now. Please try again." };
  }

  await recordCheckAttempt({ actor: me, phone, approved: result.approved });

  if (!result.approved) return { error: "That code is incorrect or has expired." };

  // ── POSSESSION IS PROVEN. Resolve the account. ────────────────────────────
  //
  // Only a VERIFIED phone resolves. An unverified profiles.phone is a string
  // somebody typed into a form — it proves nothing, and letting it resolve
  // would mean typing a stranger's number into your own profile granted you
  // their account. uq_profiles_verified_phone guarantees at most one row.
  let admin: ReturnType<typeof getSupabaseAdminClient>;
  try {
    admin = getSupabaseAdminClient();
  } catch {
    return { error: "Could not sign you in right now. Please try again." };
  }

  const { data: match, error: lookupErr } = await admin
    .from("profiles")
    .select("id")
    .eq("phone", phone)
    .eq("phone_verified", true)
    .maybeSingle();

  if (lookupErr) {
    console.error("[phone-signin] account lookup failed:", lookupErr.message);
    return { error: "Could not sign you in right now. Please try again." };
  }
  if (!match) return { noAccount: true };

  const minted = await mintSessionForUser((match as { id: string }).id);
  if (!minted.ok) {
    if (minted.reason === "suspended") {
      // Same wording the password path uses for a disabled account, so mobile
      // sign-in is not a way to find out something the other doors will not say.
      return { error: "This account has been deactivated. Contact Hallnect support if you think this is a mistake." };
    }
    if (minted.reason === "no_login_email") {
      // Phase 2 territory: an account with a verified phone and no email at
      // all. None exists today, and until phone SIGN-UP ships none can — so
      // this is a real state only a hand-edited row could produce.
      return { error: "This account needs an email address before you can sign in by mobile. Please contact support." };
    }
    return { error: "Could not sign you in right now. Please try again." };
  }

  return { success: true };
}
