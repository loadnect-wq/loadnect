// ─────────────────────────────────────────────────────────────────────────────
// lib/hall-commission.ts — the ONE way to read or write a hall's commission
// rate. SERVER-ONLY.
//
// WHY THIS MODULE EXISTS AT ALL, when the value is a single column on halls:
// migration 0072 hides halls.commission_rate from `anon` and `authenticated`,
// mirroring what 0032 already did for the internal money columns on `bookings`.
// So the column is unreadable through the session client that most of this app
// uses. Every read therefore has to go through the service role, and a service
// role scattered across page components is how a row belonging to somebody else
// eventually gets rendered.
//
// Concentrating it here means the ownership question is asked in one place and
// the answer is obvious at each call site: the batch reader takes ids the caller
// has ALREADY established it may see, and the writer proves ownership itself.
//
// WHAT THIS MODULE IS NOT. It does not calculate money. The commission is
// applied by lib/booking-payment.ts and nowhere else; this only answers "what
// rate does this hall carry today", which is the input to a booking's snapshot
// and never a substitute for reading that snapshot back.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { isAllowedCommissionRate, type HallCommissionRate } from "@/lib/validation/schemas";

/**
 * Postgres numeric(4,2) comes back from PostgREST as a STRING — 2.5 round-trips
 * as "2.50". Comparing that to a radio input's value, or to a member of
 * HALL_COMMISSION_RATES, fails every time and silently renders "not
 * configured" for a hall that is configured. Normalise once, here.
 *
 * Anything that is not one of the eight becomes null rather than a number: a
 * value outside the set can only mean the CHECK was bypassed or the column was
 * hand-edited, and "unrecognised" is the honest reading, not "2.37%".
 */
export function normaliseCommissionRate(raw: unknown): HallCommissionRate | null {
  if (raw == null) return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  return isAllowedCommissionRate(n) ? n : null;
}

/** One hall's rate, or null when it has never been configured. */
export async function readHallCommissionRate(
  hallId: string,
): Promise<HallCommissionRate | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = getSupabaseAdminClient() as any;
    const { data, error } = await db
      .from("halls")
      .select("commission_rate")
      .eq("id", hallId)
      .maybeSingle();
    // An error here must NOT read as "not configured" — that is the fail-open
    // shape this project keeps finding, and downstream it would mean a booking
    // silently falling back to the platform rate. Callers that care about the
    // difference use readHallCommissionRateStrict.
    if (error) {
      console.error("[hall-commission] read failed", error.code, error.message);
      return null;
    }
    return normaliseCommissionRate(data?.commission_rate);
  } catch (e) {
    console.error("[hall-commission] read threw", e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * The same read, but able to say "I could not find out".
 *
 * The booking path needs this distinction and nothing else does. A hall with no
 * configured rate is a real, expected state that falls back to the platform
 * default; a database error is not, and must not quietly become the same thing.
 */
export async function readHallCommissionRateStrict(
  hallId: string,
): Promise<{ ok: true; rate: HallCommissionRate | null } | { ok: false }> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = getSupabaseAdminClient() as any;
    const { data, error } = await db
      .from("halls")
      .select("commission_rate")
      .eq("id", hallId)
      .maybeSingle();
    if (error) {
      console.error("[hall-commission] strict read failed", error.code, error.message);
      return { ok: false };
    }
    return { ok: true, rate: normaliseCommissionRate(data?.commission_rate) };
  } catch (e) {
    console.error("[hall-commission] strict read threw", e instanceof Error ? e.message : e);
    return { ok: false };
  }
}

/**
 * Rates for many halls at once, keyed by hall id.
 *
 * The admin and owner listing pages need a rate per row; asking per row would
 * be an N+1 against a table they have already queried. The caller passes the
 * ids it just fetched — so this adds one query per page, not one per hall.
 *
 * Ids missing from the returned map have no configured rate.
 */
export async function readHallCommissionRates(
  hallIds: readonly string[],
): Promise<Map<string, HallCommissionRate>> {
  const out = new Map<string, HallCommissionRate>();
  if (hallIds.length === 0) return out;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = getSupabaseAdminClient() as any;
    const { data, error } = await db
      .from("halls")
      .select("id, commission_rate")
      .in("id", [...hallIds]);
    if (error) {
      console.error("[hall-commission] batch read failed", error.code, error.message);
      return out;
    }
    for (const row of (data ?? []) as { id: string; commission_rate: unknown }[]) {
      const rate = normaliseCommissionRate(row.commission_rate);
      if (rate != null) out.set(row.id, rate);
    }
    return out;
  } catch (e) {
    console.error("[hall-commission] batch read threw", e instanceof Error ? e.message : e);
    return out;
  }
}

/**
 * Changes a hall's rate. The CALLER must already have proved that this user may
 * edit this hall — see updateHall, which proves it by getting a non-zero row
 * count back from an RLS-filtered update before calling here.
 *
 * Returns whether anything changed, so the caller can skip an audit row for a
 * no-op save (the form posts the current value on every edit).
 */
export async function setHallCommissionRate(
  hallId: string,
  rate: HallCommissionRate,
): Promise<{ ok: true; changed: boolean; previous: HallCommissionRate | null } | { ok: false; error: string }> {
  if (!isAllowedCommissionRate(rate)) {
    // Belt and braces behind the Zod schema and the CHECK constraint. This is
    // the last place a bad value could enter before the database sees it.
    return { ok: false, error: "That commission rate is not one we offer." };
  }

  const before = await readHallCommissionRateStrict(hallId);
  if (!before.ok) return { ok: false, error: "Could not read the current commission rate." };
  if (before.rate === rate) return { ok: true, changed: false, previous: before.rate };

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = getSupabaseAdminClient() as any;
    const { error, count } = await db
      .from("halls")
      .update({ commission_rate: rate }, { count: "exact" })
      .eq("id", hallId);
    if (error) {
      console.error("[hall-commission] write failed", error.code, error.message);
      return { ok: false, error: "Could not save the commission rate." };
    }
    // The service role is not row-filtered, so a zero count means the hall is
    // gone rather than not-yours — but either way nothing was written, and
    // reporting success would be a lie.
    if ((count ?? 0) === 0) return { ok: false, error: "That hall no longer exists." };
    return { ok: true, changed: true, previous: before.rate };
  } catch (e) {
    console.error("[hall-commission] write threw", e instanceof Error ? e.message : e);
    return { ok: false, error: "Could not save the commission rate." };
  }
}

/**
 * The highest commission rate any hall currently carries, or null if none do.
 *
 * WHY THE ADMIN ADVANCE SETTING NEEDS THIS. checkCommissionAgainstAdvance caps
 * the commission at half the advance, and updateDefaultAdvancePercentage used
 * to check the proposed advance against platform_settings.commission_percent —
 * correct when that was the only rate in existence. It no longer is. With
 * per-hall rates, an advance that clears the platform default can still be too
 * small for a hall that agreed to a higher one, and the failure would not
 * appear until a customer tried to book THAT hall and calculateBookingPayment
 * threw. The setting must be judged against the largest rate actually in use.
 *
 * Returns null on a read failure as well as on an empty catalogue. The caller
 * treats those the same way — falling back to the platform rate alone — which
 * is the pre-existing behaviour and therefore no worse than before.
 */
export async function maxConfiguredCommissionRate(): Promise<HallCommissionRate | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = getSupabaseAdminClient() as any;
    const { data, error } = await db
      .from("halls")
      .select("commission_rate")
      .not("commission_rate", "is", null)
      .order("commission_rate", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error("[hall-commission] max read failed", error.code, error.message);
      return null;
    }
    return normaliseCommissionRate(data?.commission_rate);
  } catch (e) {
    console.error("[hall-commission] max read threw", e instanceof Error ? e.message : e);
    return null;
  }
}

/** What a booking's own commission snapshot says, in rupees. */
export type BookingCommission = {
  /** The rate stored ON THE BOOKING at creation — never today's hall rate. */
  rate: number | null;
  amount: number | null;
  ownerNetAdvance: number | null;
};

/**
 * Commission snapshots for many bookings, keyed by booking id.
 *
 * SERVICE ROLE, because migration 0032 hides commission_rate,
 * commission_amount and owner_net_advance on `bookings` from both anon and
 * authenticated — including the admin's own session, since an admin is
 * `authenticated` too. Naming those columns in fetchAllBookings' select would
 * raise 42703 and blank /admin/bookings entirely.
 *
 * READS THE SNAPSHOT, NEVER RECOMPUTES IT. What an admin is shown must be what
 * the customer was actually charged, which is the figure stored on the row at
 * booking time — not the hall's rate today, and not this rate re-multiplied
 * against the price. If the hall's rate has since changed, these numbers stay
 * as they were, which is the entire point of snapshotting them.
 */
export async function readBookingCommissions(
  bookingIds: readonly string[],
): Promise<Map<string, BookingCommission>> {
  const out = new Map<string, BookingCommission>();
  if (bookingIds.length === 0) return out;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = getSupabaseAdminClient() as any;
    const { data, error } = await db
      .from("bookings")
      .select("id, commission_rate, commission_amount, owner_net_advance")
      .in("id", [...bookingIds]);
    if (error) {
      console.error("[hall-commission] booking read failed", error.code, error.message);
      return out;
    }
    for (const row of (data ?? []) as Record<string, unknown>[]) {
      const num = (v: unknown) => (v == null ? null : Number(v));
      out.set(String(row.id), {
        rate:            num(row.commission_rate),
        amount:          num(row.commission_amount),
        ownerNetAdvance: num(row.owner_net_advance),
      });
    }
    return out;
  } catch (e) {
    console.error("[hall-commission] booking read threw", e instanceof Error ? e.message : e);
    return out;
  }
}

/**
 * Orders halls by their commission rate, with UNCONFIGURED ONES ALWAYS LAST.
 *
 * The null handling is the whole reason this is a named, tested function rather
 * than an inline arrow. A hall with no rate is not a low rate or a high one —
 * it is an absent one, so sorting it as 0 would bury every real rate behind the
 * unconfigured halls in ascending order, and sorting it as Infinity would do the
 * same at the other end. Either makes the sort useless in exactly the case
 * somebody reaches for it. They stay reachable through the "Not configured"
 * filter, which carries its own count.
 *
 * Pure and total: returns a NEW array, and never throws on a null or a mixed
 * list. Callers pass rows they are already permitted to see.
 */
export function sortByCommissionRate<T extends { commission_rate: number | null }>(
  rows: readonly T[],
  direction: "asc" | "desc",
): T[] {
  return [...rows].sort((a, b) => {
    if (a.commission_rate == null && b.commission_rate == null) return 0;
    if (a.commission_rate == null) return 1;   // nulls last, both directions
    if (b.commission_rate == null) return -1;
    return direction === "asc"
      ? a.commission_rate - b.commission_rate
      : b.commission_rate - a.commission_rate;
  });
}
