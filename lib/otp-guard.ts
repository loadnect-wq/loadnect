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
  row: { userId: string; phone: string; kind: "send" | "check"; succeeded: boolean },
): Promise<Reservation | null> {
  const { data, error } = await db.from("otp_attempts").insert({
    user_id: row.userId,
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
  userId: string,
  phone: string,
  reservation?: Reservation,
): Promise<number> {
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
export async function ceilingReached(
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
  | { ok: false; error: string };

export async function guardOtpSend(input: {
  userId: string;
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

  const wait = await cooldownRemaining(anyDb, input.userId, input.phone);
  if (wait > 0) {
    return { ok: false, error: `Please wait ${wait}s before requesting another code.` };
  }

  const blocked = await ceilingReached(anyDb, input.userId, input.phone, 0);
  if (blocked) return { ok: false, error: blocked };

  const reservation = await recordAttempt(anyDb, {
    userId: input.userId, phone: input.phone, kind: "send", succeeded: false,
  });
  // No reservation means nothing is counting this send. Same call as the global
  // fuse makes: refuse rather than spend unmetered.
  if (!reservation) return { ok: false, error: GENERIC_SEND_ERROR };

  const raceWait = await cooldownRemaining(anyDb, input.userId, input.phone, reservation);
  if (raceWait > 0) {
    return { ok: false, error: `Please wait ${raceWait}s before requesting another code.` };
  }

  const raceBlocked = await ceilingReached(anyDb, input.userId, input.phone, 1);
  if (raceBlocked) return { ok: false, error: raceBlocked };

  return {
    ok: true,
    settle: async (delivered: boolean) => {
      if (delivered) await markAttemptSucceeded(anyDb, reservation.id);
    },
  };
}

/**
 * The check-side guard: has this NUMBER used up its failed attempts?
 *
 * Scoped to the PHONE, not the account: a 6-digit code has a million values,
 * and an attacker with several accounts pointed at one number would otherwise
 * get a fresh allowance with each of them.
 */
export async function failedCheckLimitReached(phone: string): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = getSupabaseAdminClient() as any;
    const failed = await countAttempts(db, {
      phone, kind: "check", succeeded: false, sinceIso: since(FAILED_CHECK_WINDOW_MINUTES),
    });
    return failed !== null && failed >= MAX_FAILED_CHECKS;
  } catch {
    // Allow, matching countAttempts' own reasoning: a rate-limit table that
    // cannot be read must not lock a legitimate user out of their own code.
    return false;
  }
}

/** Records the outcome of one code check. Never records the code. */
export async function recordCheckAttempt(input: {
  userId: string;
  phone: string;
  approved: boolean;
}): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = getSupabaseAdminClient() as any;
    await recordAttempt(db, {
      userId: input.userId, phone: input.phone, kind: "check", succeeded: input.approved,
    });
  } catch (e) {
    console.error("[otp-guard] check record failed:", e instanceof Error ? e.message : e);
  }
}
