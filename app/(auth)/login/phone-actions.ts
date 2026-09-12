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
// ── SIGN IN AND SIGN UP ARE THE SAME TWO TAPS ───────────────────────────────
// A number with no account gets one, right here, the moment MSG91 approves the
// code. That is deliberate on both counts:
//
//   • UX — the person has just proved they hold the number, which is the only
//     thing an account here is anchored to. Sending them back to a signup form
//     to re-type it is asking for something we already have.
//   • ENUMERATION — nothing anywhere reveals whether a number was already
//     registered. Under the old "no account, please sign up" reply, a prober who
//     controlled a number learned its status; now both paths end identically, in
//     a session. Checking BEFORE sending would have been far worse: it tells
//     anyone, for free, which numbers belong to Hallnect users.
//
// Auto-creating on an UNVERIFIED number would be an account-spam endpoint.
// After MSG91 approves, it is just registration: somebody who types a
// stranger's number never receives the code and never reaches that line.
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
import { newPhoneAlias } from "@/lib/auth/phone-alias";

export type PhoneSignInStart =
  | { success: true; cooldownSeconds: number }
  | { error: string };

export type PhoneSignInVerify =
  /** `created` is true when this sign-in also made the account, so the UI can
   *  welcome them rather than saying "welcome back". */
  | { success: true; created: boolean }
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

  // ── NO ACCOUNT YET? MAKE ONE. ─────────────────────────────────────────────
  //
  // This is signing UP, and it is the same two taps as signing in on purpose:
  // the person has just proved they hold this number, which is the only thing
  // an account here is anchored to. Asking them to go back and fill in a form
  // would be asking for something we do not need and do not yet have a use for.
  //
  // SAFE BECAUSE THE PROOF CAME FIRST. Somebody who types a stranger's number
  // never receives the code, so they can never reach this line for a number
  // that is not theirs. Auto-creation on an UNVERIFIED number would be an
  // account-spam endpoint; after MSG91 approves, it is just registration.
  //
  // A name is not collected here. The SMS templates already fall back to
  // "there", the profile screen can ask later, and one more required field on
  // the way in is the difference between a customer and a bounce.
  let userId = (match as { id: string } | null)?.id ?? null;
  let created = false;

  if (!userId) {
    const outcome = await createMobileAccount(admin, phone);
    if (!outcome.ok) return { error: outcome.error };
    userId = outcome.userId;
    created = true;
  }

  const minted = await mintSessionForUser(userId);
  if (!minted.ok) {
    if (minted.reason === "suspended") {
      // Same wording the password path uses for a disabled account, so mobile
      // sign-in is not a way to find out something the other doors will not say.
      return { error: "This account has been deactivated. Contact Hallnect support if you think this is a mistake." };
    }
    if (minted.reason === "no_login_email") {
      // Should be unreachable: every account this flow creates gets a
      // placeholder in auth.users.email precisely so the mint always has
      // something to work with, and every pre-existing account has a real one.
      // Reaching here means a row was edited by hand to have neither.
      console.error("[phone-signin] account has no auth email at all:", userId);
      return { error: "This account needs attention before you can sign in by mobile. Please contact support." };
    }
    return { error: "Could not sign you in right now. Please try again." };
  }

  return { success: true, created };
}

/**
 * Creates a Hallnect account anchored to a number whose ownership was JUST
 * proved. Only ever called after MSG91 approves.
 *
 * The placeholder address exists because the session mint needs one — see
 * lib/auth/phone-alias.ts. It goes into auth.users and is cleared from
 * profiles immediately, so `profiles.email IS NULL` keeps meaning "this person
 * has not given us an email", which the profile screen and the notification
 * router both depend on.
 */
async function createMobileAccount(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  phone: string,
): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const { data: made, error: createErr } = await admin.auth.admin.createUser({
    email: newPhoneAlias(),
    // Nothing to confirm — no mail can reach a placeholder, so leaving it
    // unconfirmed would just be a permanently pending state.
    email_confirm: true,
    // DELIBERATELY NO user_metadata. handle_new_user reads
    // raw_user_meta_data->>'role' and grants owner_approved for 'owner', so
    // forwarding anything a client could influence here would be a role
    // escalation. Every account made this way starts as a customer.
  });

  if (createErr || !made?.user?.id) {
    console.error("[phone-signin] could not create an account:", createErr?.message);
    return { ok: false, error: "Could not create your account. Please try again." };
  }

  const userId: string = made.user.id;

  // handle_new_user has already inserted the profile with the placeholder in
  // `email`. Replace it with the real facts: no email, this number, verified.
  const { error: profileErr } = await admin
    .from("profiles")
    .update({
      email: null,
      phone,
      phone_verified: true,
      phone_verified_at: new Date().toISOString(),
    })
    .eq("id", userId);

  if (profileErr) {
    // ROLL THE ACCOUNT BACK. An auth user whose profile never got the phone is
    // invisible to the lookup at the top of this flow, so the next sign-in
    // attempt with this number would create ANOTHER one, and the number would
    // quietly accumulate orphan accounts. Deleting is the only state that stays
    // consistent; the person simply retries.
    await admin.auth.admin.deleteUser(userId).catch(() => {});

    // 23505 on uq_profiles_verified_phone means somebody verified this number
    // between our lookup and this write. The constraint is doing exactly its
    // job; the caller should just try again and will find the account.
    if ((profileErr as { code?: string }).code === "23505") {
      return { ok: false, error: "That number was just registered. Please try signing in again." };
    }
    console.error("[phone-signin] profile setup failed, account rolled back:", profileErr.message);
    return { ok: false, error: "Could not finish creating your account. Please try again." };
  }

  return { ok: true, userId };
}
