// ─────────────────────────────────────────────────────────────────────────────
// lib/lead-expiry.ts — retire enquiries that time has overtaken. SERVER-ONLY.
//
// WHY THIS EXISTS. Migration 0073 declares an 'expired' lead status and nothing
// ever wrote it, so the state machine had a terminal state with no road into
// it. Left alone, two things rot:
//
//   • The venue's "To answer" tab fills with enquiries for weddings that
//     already happened. A queue that never empties stops being read, and the
//     one real enquiry in it goes unanswered with the rest.
//   • An unverified enquiry sits in awaiting_verification for ever, holding
//     its slot in uq_lead_active — so a customer who abandoned an OTP in March
//     cannot enquire about the same venue and date in December.
//
// WHAT IT DOES NOT TOUCH, DELIBERATELY:
//   • CONFIRMED leads. A confirmed lead is a commission-bearing record — the
//     event happening and passing does not undo the debt, and rewriting its
//     status would make a settled or outstanding commission point at a lead
//     marked "expired". Financial history is not tidied up.
//   • Anything with money attached. No commission row is read or written here.
//   • bookings, availability, payments. A lead has never touched them.
//
// NO NOTIFICATION IS SENT. Expiry is Hallnect noticing that time passed, not
// news: texting a customer "your enquiry about a wedding last month has
// expired" is a message nobody wants, and it would cost a segment each. The
// dashboards show the status.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { todayInBusinessTz } from "@/lib/dates";

/**
 * How long an unverified enquiry is kept before it is retired.
 *
 * Not zero, and not the event date. A customer who did not finish the OTP may
 * come back in an hour, or tomorrow — the enquiry is theirs to resume and
 * createLeadEnquiry deliberately resumes it. Seven days is past the point
 * where anyone returns to a form, and well inside the window where the same
 * person might legitimately want to enquire about that venue and date again.
 */
const UNVERIFIED_TTL_DAYS = 7;

export type LeadExpirySummary = {
  /** Pending enquiries whose event date has passed. */
  pastEvent: number;
  /** Never-verified enquiries older than the TTL. */
  abandoned: number;
  errors: number;
};

/**
 * Retires enquiries that can no longer go anywhere. Idempotent: every update is
 * guarded on the status it expects, so a second run in the same minute — or two
 * overlapping cron invocations — moves nothing twice.
 *
 * Never throws. A sweep that crashes the route would take the whole cron down
 * with it; the counts and the error tally are the report.
 */
export async function expireStaleLeads(): Promise<LeadExpirySummary> {
  const summary: LeadExpirySummary = { pastEvent: 0, abandoned: 0, errors: 0 };

  let db: ReturnType<typeof getSupabaseAdminClient>;
  try {
    db = getSupabaseAdminClient();
  } catch (e) {
    console.error("[lead-expiry] no admin client:", e instanceof Error ? e.message : e);
    return { ...summary, errors: 1 };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;

  // IST, not UTC. todayInBusinessTz is the same clock the booking window and
  // the enquiry form's min-date use; a UTC "today" is a day behind for most of
  // the Indian evening and would expire an enquiry for an event happening
  // tomorrow.
  const today = todayInBusinessTz();

  // ── 1. The event has been and gone ────────────────────────────────────────
  // Only 'pending'. An enquiry the venue never answered, for a date now in the
  // past. `lt`, not `lte`: an event happening TODAY is still live all day.
  try {
    const { data, error } = await anyDb
      .from("leads")
      .update({ status: "expired", responded_at: new Date().toISOString() })
      .eq("status", "pending")
      .lt("event_date", today)
      .select("id");
    if (error) {
      console.error("[lead-expiry] past-event sweep failed:", error.code, error.message);
      summary.errors++;
    } else {
      summary.pastEvent = (data ?? []).length;
    }
  } catch (e) {
    console.error("[lead-expiry] past-event sweep threw:", e instanceof Error ? e.message : e);
    summary.errors++;
  }

  // ── 2. Never verified, and old enough that nobody is coming back ──────────
  // These never reached the venue at all — leads_select hides an unverified
  // lead from the owner — so retiring one takes nothing away from anybody. It
  // frees the (hall, customer, date) slot in uq_lead_active.
  const cutoff = new Date(Date.now() - UNVERIFIED_TTL_DAYS * 86_400_000).toISOString();
  try {
    const { data, error } = await anyDb
      .from("leads")
      .update({ status: "expired", responded_at: new Date().toISOString() })
      .eq("status", "awaiting_verification")
      .eq("phone_verified", false)
      .lt("created_at", cutoff)
      .select("id");
    if (error) {
      console.error("[lead-expiry] abandoned sweep failed:", error.code, error.message);
      summary.errors++;
    } else {
      summary.abandoned = (data ?? []).length;
    }
  } catch (e) {
    console.error("[lead-expiry] abandoned sweep threw:", e instanceof Error ? e.message : e);
    summary.errors++;
  }

  return summary;
}
