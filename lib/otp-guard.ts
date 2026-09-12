// ─────────────────────────────────────────────────────────────────────────────
// lib/otp-guard.ts — the anti-abuse ceilings around MSG91 OTP. SERVER-ONLY.
//
// EXTRACTED, NOT REWRITTEN. Every limit, every comment and every decision below
// came from app/verify-phone/actions.ts, which is where they were argued out.
// They moved here the moment a SECOND flow needed to send codes (the lead
// enquiry), because the alternative was two copies of five ceilings that would
// drift — and a ceiling that exists in one file and not the other is not a
// ceiling, it is a door with a sign on it.
//
// THE PROPERTY THAT MATTERS: the counters are shared. A phone hammered through
// the enquiry form and a phone hammered through profile verification are the
// SAME phone hitting the SAME daily cap, because both write to otp_attempts and
// both count it. Separate implementations would have doubled every limit
// without anyone deciding to.
//
// RATE LIMITING IS IN THE DATABASE, not in a module-level Map. In-memory
// buckets reset on every cold start and are not shared between instances, so on
// serverless the cap was "5 per hour per instance" — i.e. no cap at all against
// anyone willing to retry until they landed on a fresh lambda. Each attempt is
// a row, so the ceiling holds across instances and restarts. Rows record
// WHETHER an attempt happened, never the code.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export const RESEND_COOLDOWN_SECONDS = 60;
const MAX_SENDS_PER_USER_PHONE_PER_HOUR = 5;
const MAX_SENDS_PER_PHONE_PER_DAY = 10;
export const MAX_FAILED_CHECKS = 5;
export const FAILED_CHECK_WINDOW_MINUTES = 15;

// See failedCheckLimitReached for why these three exist rather than one.
// MAX_FAILED_CHECKS above is now the per-(account, phone) budget: the one that
// belongs to the person actually verifying, so a stranger cannot spend it.
/** Anti-brute-force fuse for a number, across every account. Twenty guesses
 *  against a million values is not an attack that is going anywhere; five was
 *  a number chosen for typos, and using it here made lockout trivial. */
const MAX_FAILED_CHECKS_PER_PHONE = 20;
/** What one account may get wrong across ALL numbers, so ceiling 1 cannot be
 *  reset simply by typing a different number. */
const MAX_FAILED_CHECKS_PER_ACCOUNT = 15;
/** How long a code request stays valid as authorisation to CHECK that number.
 *  Longer than the OTP itself on purpose — see hasRecentSendFor. */
const SEND_BINDING_WINDOW_MINUTES = 30;

/** One message for every check-side refusal. Distinguishing them would tell an
 *  attacker which ceiling they hit, and therefore what other accounts have been
 *  doing with that number. */
const TOO_MANY_ATTEMPTS = "Too many incorrect attempts. Request a new code in a few minutes.";

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
// spend in a day, and what the whole platform may spend in a day.
const MAX_SENDS_PER_ACCOUNT_PER_DAY = 15;
const MAX_OTP_SENDS_GLOBAL_PER_DAY = 300;

/** Every failure a caller shows the user. Kept identical in shape so nothing
 *  leaks whether a number is registered to somebody else. */
export const GENERIC_SEND_ERROR = "Could not send the code. Please try again.";

function since(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

/**
 * WHO IS ASKING. Either a signed-in account or, for the sign-in-by-mobile flow,
 * an anonymous client identified by a salted hash of its address.
 *
 * SIGNING IN BY MOBILE MEANS THE SENDER HAS NO ACCOUNT YET, so every per-actor
 * ceiling in this file needed something other than a user id to key on.
 * Migration 0087 added otp_attempts.actor_key for exactly that, with a CHECK
 * that exactly one of the two is ever set — both would be counted twice, and
 * neither is an attempt nobody can be held to.
 *
 * AN actor_key IS NOT AN IDENTITY, and nothing here should be read as claiming
 * it is. An address is shed by changing network. It raises the cost of walking
 * a list of strangers' numbers and bounds the blast radius; the ceilings that
 * an attacker CANNOT shed — 10/day per phone and the fail-closed 300/day global
 * fuse — are the real backstop, and they are shared with the signed-in flows so
 * moving between endpoints resets nothing.
 */
export type OtpActor =
  | { userId: string; actorKey?: undefined }
  | { actorKey: string; userId?: undefined };

/** The column this actor is recorded and counted under. */
function actorColumn(actor: OtpActor): "user_id" | "actor_key" {
  return actor.userId ? "user_id" : "actor_key";
}
function actorValue(actor: OtpActor): string {
  return (actor.userId ?? actor.actorKey) as string;
}

/**
 * Counts prior attempts. Returns null when the table is missing (an
 * un-migrated environment) so the caller can decide — and it decides to ALLOW,
 * because a missing rate-limit table must not lock every user out of
 * verifying their phone. MSG91 enforces its own service-side ceilings under
 * this one.
 */
export async function countAttempts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  // `phone` is optional so the same helper can count the two ceilings that must
  // NOT be scoped to a number — per account, and platform-wide.
  filters: {
    phone?: string;
    /** Count only this actor's rows. Omit to count across every actor, which is
     *  how the per-phone and global fuses are measured. */
    actor?: OtpActor;
    kind: "send" | "check";
    succeeded?: boolean;
    sinceIso: string;
  },
): Promise<number | null> {
  let q = db
    .from("otp_attempts")
    .select("id", { count: "exact", head: true })
    .eq("kind", filters.kind)
    .gte("created_at", filters.sinceIso);
  if (filters.phone) q = q.eq("phone", filters.phone);
  if (filters.actor) q = q.eq(actorColumn(filters.actor), actorValue(filters.actor));
  if (filters.succeeded !== undefined) q = q.eq("succeeded", filters.succeeded);

  const { count, error } = await q;
  if (error) {
    console.error("[otp-guard] attempt count failed:", error.code, error.message);
    return null;
  }
  return count ?? 0;
}

export type Reservation = { id: string; createdAt: string };

/**
 * Writes one attempt row and hands back its identity.
 *
 * The identity matters for a send: that row is the caller's RESERVATION, and
 * every re-count has to be able to tell it apart from a row a parallel request
 * inserted at the same moment. Returns null when the row could not be written,
 * which for a send means the attempt cannot be metered at all.
 */
export async function recordAttempt(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  row: { actor: OtpActor; phone: string; kind: "send" | "check"; succeeded: boolean },
): Promise<Reservation | null> {
  const { data, error } = await db.from("otp_attempts").insert({
    // Exactly one of these is non-null, which otp_attempts_one_actor enforces.
    user_id:   row.actor.userId ?? null,
    actor_key: row.actor.actorKey ?? null,
    phone: row.phone,
    kind: row.kind,
    succeeded: row.succeeded,
  })
    .select("id, created_at")
    .single();
  if (error) {
    console.error("[otp-guard] attempt record failed:", error.code, error.message);
    return null;
  }
  return { id: data.id, createdAt: data.created_at };
}

/** Marks a reserved send as delivered. Best-effort: the row already counts
 *  against every ceiling whatever this says, so a failure here costs nothing
 *  but accuracy in the admin's view of what happened. */
export async function markAttemptSucceeded(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  attemptId: string,
): Promise<void> {
  const { error } = await db.from("otp_attempts").update({ succeeded: true }).eq("id", attemptId);
  if (error) console.error("[otp-guard] attempt update failed:", error.code, error.message);
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
export async function cooldownRemaining(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  actor: OtpActor,
  phone: string,
  reservation?: Reservation,
): Promise<number> {
  let q = db
    .from("otp_attempts")
    .select("created_at")
    .eq(actorColumn(actor), actorValue(actor))
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
export async function ceilingReached(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any, actor: OtpActor, phone: string, own: 0 | 1,
): Promise<string | null> {
  const perUser = await countAttempts(db, {
    phone, actor, kind: "send", sinceIso: since(60),
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
    actor, kind: "send", sinceIso: since(60 * 24),
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
  const globalToday = await countAttempts(db, { kind: "send", sinceIso: since(60 * 24) });
  if (globalToday === null || globalToday >= MAX_OTP_SENDS_GLOBAL_PER_DAY + own) {
    return GENERIC_SEND_ERROR;
  }

  return null;
}

/**
 * The whole send-side guard: refuse for free, reserve, re-check, and report
 * whether the caller may now spend an SMS.
 *
 * ORDER IS THE SECURITY PROPERTY, and it is the one thing a caller must not
 * reimplement. The ordinary refusals happen BEFORE any row is written, so a
 * user who taps Resend early does not burn one of their five hourly attempts on
 * an answer we already know — and a refused request does not add a row to the
 * platform-wide fuse, which would let anyone shut OTP down for the whole
 * platform without a single SMS being sent.
 *
 * Then the row goes in as a RESERVATION and every ceiling is re-counted with it
 * included, because reads do not exclude each other: requests fired in parallel
 * all saw room and all sent. From here on a concurrent request is visible.
 *
 * On `{ ok: true }` the caller sends, then calls `settle`. A request that loses
 * the race leaves a consumed row and sends nothing, which is the direction that
 * cannot cost money.
 */
export type OtpSendGuard =
  | { ok: true; settle: (delivered: boolean) => Promise<void> }
  /** retryAfterSeconds is set ONLY for the 60-second cooldown, which is a wait.
   *  Every other refusal is a ceiling, which is not — a caller must not invite a
   *  retry for one. It exists so a caller can say what the customer should do
   *  next instead of surfacing a bare countdown. */
  | { ok: false; error: string; retryAfterSeconds?: number };

export async function guardOtpSend(input: {
  /** The signed-in account, or an anonymous client key for sign-in by mobile.
   *  See OtpActor: the per-phone and global fuses are shared either way, so an
   *  attacker cannot reset a number's budget by switching endpoints. */
  actor: OtpActor;
  phone: string;
}): Promise<OtpSendGuard> {
  let db: ReturnType<typeof getSupabaseAdminClient>;
  try {
    db = getSupabaseAdminClient();
  } catch {
    return { ok: false, error: GENERIC_SEND_ERROR };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;

  const wait = await cooldownRemaining(anyDb, input.actor, input.phone);
  if (wait > 0) {
    return {
      ok: false,
      error: `Please wait ${wait}s before requesting another code.`,
      retryAfterSeconds: wait,
    };
  }

  const blocked = await ceilingReached(anyDb, input.actor, input.phone, 0);
  if (blocked) return { ok: false, error: blocked };

  const reservation = await recordAttempt(anyDb, {
    actor: input.actor, phone: input.phone, kind: "send", succeeded: false,
  });
  // No reservation means nothing is counting this send. Same call as the global
  // fuse makes: refuse rather than spend unmetered.
  if (!reservation) return { ok: false, error: GENERIC_SEND_ERROR };

  const raceWait = await cooldownRemaining(anyDb, input.actor, input.phone, reservation);
  if (raceWait > 0) {
    return { ok: false, error: `Please wait ${raceWait}s before requesting another code.` };
  }

  const raceBlocked = await ceilingReached(anyDb, input.actor, input.phone, 1);
  if (raceBlocked) return { ok: false, error: raceBlocked };

  return {
    ok: true,
    settle: async (delivered: boolean) => {
      if (delivered) await markAttemptSucceeded(anyDb, reservation.id);
    },
  };
}

/**
 * True when this account has recently asked for a code for this number.
 *
 * The window is generous on purpose — a code is typed minutes after it lands,
 * sometimes after a resend, and refusing a real verification is a far worse
 * outcome than the narrow abuse this closes.
 */
export async function hasRecentSendFor(actor: OtpActor, phone: string): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = getSupabaseAdminClient() as any;
    const sends = await countAttempts(db, {
      actor, phone, kind: "send", sinceIso: since(SEND_BINDING_WINDOW_MINUTES),
    });
    // null means the table could not be read. Allow, for the same reason every
    // other ceiling here allows: a broken counter must not block a real user.
    return sends === null || sends > 0;
  } catch {
    return true;
  }
}

/**
 * The check-side guard. Returns the message to show, or null to proceed.
 *
 * THE ORIGINAL WAS SCOPED TO THE PHONE ALONE, AND THAT WAS A LOCKOUT PRIMITIVE.
 * The reasoning for phone-scoping was sound as far as it went — a 6-digit code
 * has a million values, and an attacker with several accounts pointed at one
 * number would otherwise get a fresh allowance with each. But verifyPhoneOtp
 * takes the phone FROM THE CLIENT, so any signed-in account could submit five
 * wrong codes for a stranger's number and consume the whole pool. The victim's
 * own correct code was then refused for fifteen minutes, repeatable forever,
 * against any number the attacker cared to name. A venue owner needs
 * phone_verified to see leads at all, so that is a denial of their business.
 *
 * Three ceilings now, because one number cannot express both concerns:
 *
 *   1. PER (ACCOUNT, PHONE) — the real lockout budget, and it belongs to the
 *      person doing the verifying. A stranger's failures can no longer spend it.
 *   2. PER PHONE — kept as the anti-brute-force fuse the original was aiming
 *      at, but at a threshold that is about guessing, not about typos. Twenty
 *      guesses against a million values is still nowhere, so raising it costs
 *      no real resistance while removing the cheap lockout.
 *   3. PER ACCOUNT ACROSS ALL NUMBERS — bounds one account walking a list.
 *      Without it, ceiling 1 resets on every new number, which is exactly the
 *      hole the send-side ceilings above this already had to close.
 *
 * RESIDUAL, AND IT IS DELIBERATE: someone who genuinely sends a code to a
 * number can still spend that number's per-phone fuse. Closing that completely
 * means abandoning phone-scoped brute-force resistance, which is the wrong
 * trade. What bounds it is the send side — 5 per hour per (account, phone),
 * 10 per day per phone, 15 per day per account — plus a row in otp_attempts
 * with the attacker's user_id on it for every single attempt.
 */
export async function failedCheckLimitReached(
  phone: string,
  actor: OtpActor,
): Promise<string | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = getSupabaseAdminClient() as any;
    const sinceIso = since(FAILED_CHECK_WINDOW_MINUTES);

    const [mine, thisPhone, myTotal] = await Promise.all([
      countAttempts(db, { phone, actor, kind: "check", succeeded: false, sinceIso }),
      countAttempts(db, { phone,        kind: "check", succeeded: false, sinceIso }),
      countAttempts(db, { actor,        kind: "check", succeeded: false, sinceIso }),
    ]);

    if (mine !== null && mine >= MAX_FAILED_CHECKS) return TOO_MANY_ATTEMPTS;
    if (thisPhone !== null && thisPhone >= MAX_FAILED_CHECKS_PER_PHONE) return TOO_MANY_ATTEMPTS;
    if (myTotal !== null && myTotal >= MAX_FAILED_CHECKS_PER_ACCOUNT) return TOO_MANY_ATTEMPTS;
    return null;
  } catch {
    // Allow, matching countAttempts' own reasoning: a rate-limit table that
    // cannot be read must not lock a legitimate user out of their own code.
    return null;
  }
}

/** Records the outcome of one code check. Never records the code. */
export async function recordCheckAttempt(input: {
  actor: OtpActor;
  phone: string;
  approved: boolean;
}): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = getSupabaseAdminClient() as any;
    await recordAttempt(db, {
      actor: input.actor, phone: input.phone, kind: "check", succeeded: input.approved,
    });
  } catch (e) {
    console.error("[otp-guard] check record failed:", e instanceof Error ? e.message : e);
  }
}
