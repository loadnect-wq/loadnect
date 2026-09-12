// ─────────────────────────────────────────────────────────────────────────────
// lib/auth/session-mint.ts — turning "we proved who this is" into a real
// Supabase session. SERVER-ONLY.
//
// ⛔ THIS FUNCTION GRANTS A SESSION FOR ANY ACCOUNT IT IS GIVEN. It performs NO
//    identity check of its own and cannot: by the time it runs, the proof has
//    already happened somewhere else. Every caller is therefore a trust
//    boundary, and there are exactly two rules:
//
//      1. Call it ONLY after a provider has confirmed possession — today that
//         means MSG91 answered `approved: true` for the code the user typed.
//      2. NEVER pass it a user id that came from the client. Resolve the
//         account server-side from the proven fact (the verified phone), never
//         from anything the browser said.
//
//    A caller that breaks either rule is an authentication bypass, and no
//    amount of care inside this file can detect that.
//
// ── WHY IT IS BUILT THIS WAY ────────────────────────────────────────────────
// There is NO server-side session-issuing API in Supabase. Verified against
// @supabase/auth-js 2.108.2: the complete admin surface is signOut,
// inviteUserByEmail, generateLink, createUser, listUsers, getUserById,
// updateUserById and deleteUser. There is no createSession, no signInAsUser and
// no impersonation. So exactly three server-side routes to a session exist:
//
//   (1) generateLink + verifyOtp        ← what this uses
//   (2) write a password, then signInWithPassword
//   (3) setSession with tokens you already have
//
// (3) assumes the answer. (2) means rotating a real password on a real account
// on every login: racy between concurrent logins, and it leaves a working
// password credential on accounts whose owners never chose one. (1) mints a
// single-use token, consumes it in the same request, and leaves nothing behind.
//
// NO EMAIL IS SENT. generateLink's own docblock describes it as generating
// "email links and OTPs to be sent via a custom email provider" — it returns
// the material and delivery is the caller's business. We never deliver it; the
// hashed_token is consumed immediately, a few lines later, in this process.
// That is what keeps mobile sign-in independent of SMTP entirely.
//
// PKCE DOES NOT APPLY. VerifyTokenHashParams carries no `options`, so no
// redirectTo is sent and no code_verifier is involved — which is precisely why
// this works server-side where an OAuth-style callback would not.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export type MintResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "no_login_email" | "suspended" | "mint_failed" };

/**
 * Establishes a Supabase session for `userId` on the current request.
 *
 * MUST be called from a Server Action or Route Handler. In a Server Component
 * the cookie store is read-only, lib/supabase/server.ts swallows the write, and
 * this would report success while setting no session at all.
 */
export async function mintSessionForUser(userId: string): Promise<MintResult> {
  let admin: ReturnType<typeof getSupabaseAdminClient>;
  try {
    admin = getSupabaseAdminClient();
  } catch {
    return { ok: false, reason: "mint_failed" };
  }

  // The account must already exist. getUserById is what makes the email below
  // SERVER-DERIVED: generateLink CREATES a user for an unknown address
  // ("handles the creation of the user for signup, invite and magiclink"), so
  // handing it an address we had not already resolved would let this function
  // mint accounts rather than sessions.
  const { data: found, error: lookupErr } = await admin.auth.admin.getUserById(userId);
  if (lookupErr || !found?.user) return { ok: false, reason: "not_found" };

  // ── SUSPENSION MUST SURVIVE A NEW FRONT DOOR ──────────────────────────────
  //
  // This is the check a session mint most easily forgets, and forgetting it
  // turns mobile sign-in into a way around every suspension control in the
  // product. Suspending an account does TWO things (app/admin/actions.ts):
  // it sets profiles.is_active = false, and it bans the GoTrue user. The ban is
  // what stops an ordinary sign-in — and this function does not perform an
  // ordinary sign-in, it mints a session directly, so nothing would have
  // stopped it.
  //
  // Both are checked, because they can disagree. A direct database edit could
  // clear one and not the other, and the safe reading of a disagreement is
  // "suspended". Migration 0081's restrictive write policies would still block
  // the writes, and requireAuth() would still bounce the page — but an account
  // that is banned should never receive a session in the first place.
  const bannedUntil = (found.user as { banned_until?: string | null }).banned_until;
  if (bannedUntil && new Date(bannedUntil).getTime() > Date.now()) {
    return { ok: false, reason: "suspended" };
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("is_active")
    .eq("id", userId)
    .maybeSingle();
  if (profile && (profile as { is_active?: boolean | null }).is_active === false) {
    return { ok: false, reason: "suspended" };
  }

  const email = found.user.email?.trim();
  if (!email) {
    // A phone-only account. The caller decides what to do about it — usually
    // ask for an email before completing sign-in — because inventing a
    // placeholder address silently is a decision this layer must not make on
    // everyone's behalf.
    return { ok: false, reason: "no_login_email" };
  }

  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  const tokenHash = link?.properties?.hashed_token;
  const verificationType = link?.properties?.verification_type;
  if (linkErr || !tokenHash || !verificationType) {
    console.error(
      "[session-mint] could not generate a login token:",
      linkErr?.message ?? "no hashed_token returned",
    );
    return { ok: false, reason: "mint_failed" };
  }

  // Consumed HERE, in this request, by the cookie-writing server client. The
  // token never leaves the process and is single-use, so even a log or a crash
  // between the two calls leaves nothing an attacker could replay.
  const supabase = await getSupabaseServerClient();
  const { error: verifyErr } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: verificationType,
  });
  if (verifyErr) {
    console.error("[session-mint] token exchange failed:", verifyErr.message);
    return { ok: false, reason: "mint_failed" };
  }

  return { ok: true };
}
