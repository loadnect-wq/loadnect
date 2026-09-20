// ─────────────────────────────────────────────────────────────────────────────
// lib/leads.ts — the lead-generation lifecycle. SERVER-ONLY.
//
// A LEAD IS NOT A BOOKING, and this module exists to keep it that way. It
// never touches `bookings`, never writes `availability`, never creates a
// `payments` row and never calls the payout path. Direct Booking is not
// reachable from anything in this file.
//
// THE LIFECYCLE
//   awaiting_verification  the customer submitted the form; MSG91 has been
//                          asked for a code. The venue CANNOT SEE THIS ROW —
//                          leads_select requires phone_verified, so RULE 2 is
//                          a permission rather than a convention.
//   pending                the code checked out. The venue can see it and has
//                          been texted.
//   confirmed              the venue ticked Confirm and stated what was agreed.
//                          THIS is the commission-bearing moment.
//   rejected / cancelled   the venue declined / the customer withdrew.
//   expired                the event date passed without an answer.
//
// EVERY WRITE USES THE SERVICE ROLE, because migration 0073 grants clients no
// INSERT or UPDATE on `leads` at all. That is not a shortcut around RLS — it is
// the opposite. Ownership is proved BEFORE the write, in this file, against the
// database, using ids derived from the session; the service role then performs a
// write that no crafted PostgREST request could have performed. An owner cannot
// flip a lead to 'confirmed' by talking to the API directly, which means they
// cannot manufacture a commission and cannot suppress one.
//
// COMMISSION IS CREATED EXACTLY ONCE, by uq_commission_per_lead. A second
// confirmation, a replayed action or two simultaneous clicks produce a unique
// violation, not a second debt.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { STANDARD_COMMISSION_PERCENT } from "@/lib/commission";
import { commissionPaiseOn, toPaise, PAISE_PER_RUPEE } from "@/lib/money";
import { normalizePhoneE164 } from "@/lib/notifications/phone";
// A lead's event type is a venue-category slug (0102) — any active category,
// not the four that were hard-coded here until the platform covered more than
// weddings. `string` rather than a union because the vocabulary is a table
// now; trg_leads_event_type is what guarantees the value is real.
type LeadEventType = string;

/** How long a venue has to settle a lead commission, when settings say nothing. */
const DEFAULT_COMMISSION_DUE_DAYS = 7;

export type LeadStatus =
  | "awaiting_verification"
  | "pending"
  | "confirmed"
  | "rejected"
  | "cancelled"
  | "expired";

/** The statuses a venue is being asked to act on. */
export const OPEN_LEAD_STATUSES: readonly LeadStatus[] = ["pending"];

export type LeadRow = {
  id: string;
  hall_id: string;
  owner_id: string;
  customer_id: string;
  contact_name: string;
  contact_phone: string;
  phone_verified: boolean;
  event_date: string;
  event_type: LeadEventType | null;
  guest_count: number | null;
  requirements: string | null;
  status: LeadStatus;
  agreed_amount: number | null;
  confirmed_at: string | null;
  responded_at: string | null;
  owner_notes: string | null;
  cancel_reason: string | null;
  created_at: string;
};

const LEAD_COLUMNS =
  "id, hall_id, owner_id, customer_id, contact_name, contact_phone, phone_verified, " +
  "event_date, event_type, guest_count, requirements, status, agreed_amount, " +
  "confirmed_at, responded_at, owner_notes, cancel_reason, created_at";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function admin(): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return getSupabaseAdminClient() as any;
}

function toLead(row: Record<string, unknown>): LeadRow {
  return {
    id: String(row.id),
    hall_id: String(row.hall_id),
    owner_id: String(row.owner_id),
    customer_id: String(row.customer_id),
    contact_name: String(row.contact_name ?? ""),
    contact_phone: String(row.contact_phone ?? ""),
    phone_verified: Boolean(row.phone_verified),
    event_date: String(row.event_date),
    event_type: (row.event_type as string | null) ?? null,
    guest_count: row.guest_count == null ? null : Number(row.guest_count),
    requirements: (row.requirements as string | null) ?? null,
    status: row.status as LeadStatus,
    agreed_amount: row.agreed_amount == null ? null : Number(row.agreed_amount),
    confirmed_at: (row.confirmed_at as string | null) ?? null,
    responded_at: (row.responded_at as string | null) ?? null,
    owner_notes: (row.owner_notes as string | null) ?? null,
    cancel_reason: (row.cancel_reason as string | null) ?? null,
    created_at: String(row.created_at),
  };
}

// ── Commission arithmetic ────────────────────────────────────────────────────

export type LeadCommissionBreakdown = {
  /** What the venue and customer agreed, in rupees — the commission base. */
  agreedAmount: number;
  /** The rate applied, snapshotted onto the commission row. */
  commissionRate: number;
  /** What the venue owes Hallnect, in rupees. */
  commissionAmount: number;
  /** agreedAmount − commissionAmount: what the venue keeps. */
  ownerNet: number;
};

/**
 * The ONE place a lead commission is calculated.
 *
 * DELIBERATELY NOT calculateBookingPayment. That function models a booking:
 * advance, platform fee, GST, and a commission RETAINED OUT OF an advance it
 * checks against. None of those exist here — Hallnect collects nothing from the
 * lead customer, charges the venue no platform fee, and has no advance to
 * check the commission against. Reusing it would mean inventing an advance to
 * satisfy its invariants, and an invented advance is a number that would end up
 * on somebody's statement.
 *
 * What IS shared is the arithmetic primitive: commissionPaiseOn, integer paise,
 * floored — so a lead commission and a booking commission round the same way
 * and reconcile in the same ledger.
 *
 * Pure. The rate is the standard one (lib/commission.ts) and is not an input:
 * nothing — owner, customer or request body — can choose it.
 */
export function calculateLeadCommission(input: {
  agreedAmount: number;
}): LeadCommissionBreakdown {
  const basePaise = toPaise(input.agreedAmount);
  if (!Number.isFinite(basePaise) || basePaise <= 0) {
    throw new RangeError("calculateLeadCommission: agreed amount must be positive");
  }
  const commissionPaise = commissionPaiseOn(basePaise, STANDARD_COMMISSION_PERCENT);

  // A commission that swallows the whole booking is a misconfiguration, not a
  // deal. It cannot happen at 2.5%; the guard stays so that a future change to
  // the constant can never write a debt larger than the transaction.
  if (commissionPaise >= basePaise) {
    throw new RangeError(
      `calculateLeadCommission: a ${STANDARD_COMMISSION_PERCENT}% commission is not less ` +
      `than the agreed amount of ${input.agreedAmount}`,
    );
  }

  return {
    agreedAmount: basePaise / PAISE_PER_RUPEE,
    commissionRate: STANDARD_COMMISSION_PERCENT,
    commissionAmount: commissionPaise / PAISE_PER_RUPEE,
    ownerNet: (basePaise - commissionPaise) / PAISE_PER_RUPEE,
  };
}

// ── Creation ─────────────────────────────────────────────────────────────────

export type CreateLeadResult =
  | { ok: true; leadId: string; phone: string; alreadyVerified: boolean }
  | { ok: false; error: string };

/**
 * Records an enquiry in the un-forwarded state.
 *
 * IDEMPOTENT BY CONSTRUCTION. uq_lead_active makes (hall, customer, date)
 * unique across the three live statuses, so a double-tapped button, a retried
 * server action or a page refresh mid-flow all land on the SAME lead rather
 * than creating a second one. A conflict is resolved by returning the existing
 * row, which is what lets a customer who dropped out during OTP come back and
 * finish instead of being told they have already enquired.
 *
 * `customerId` and `ownerId` are NEVER taken from the client: the caller passes
 * the session's user id, and the owner is read here from the hall.
 */
export async function createLeadEnquiry(input: {
  hallId: string;
  customerId: string;
  contactName: string;
  contactPhone: string;
  eventDate: string;
  eventType: LeadEventType | null;
  guestCount: number | null;
  requirements: string | null;
}): Promise<CreateLeadResult> {
  const phone = normalizePhoneE164(input.contactPhone);
  if (!phone) return { ok: false, error: "Enter a valid mobile number." };

  const db = admin();

  // The hall decides everything about who this lead belongs to and whether it
  // may exist at all. Read with the SERVICE ROLE and checked here, so the mode
  // gate cannot be bypassed by a client that simply posts to the action.
  const { data: hall, error: hallErr } = await db
    .from("halls")
    .select("id, owner_id, status, booking_mode")
    .eq("id", input.hallId)
    .maybeSingle();

  if (hallErr) {
    console.error("[leads] hall read failed", hallErr.code, hallErr.message);
    return { ok: false, error: "Could not send your enquiry just now. Please try again." };
  }
  if (!hall) return { ok: false, error: "That venue is no longer listed." };
  if (hall.status !== "approved") {
    return { ok: false, error: "That venue is not accepting enquiries at the moment." };
  }
  // THE MODE GATE. Without it, a signed-in customer could post this action for
  // a DIRECT_BOOKING hall and route around checkout entirely — getting the
  // venue's attention for a date without paying the advance that is supposed to
  // hold it. Same class of hole as the one submitOfflineBookingRequest closed.
  if (hall.booking_mode !== "LEAD_GENERATION") {
    return { ok: false, error: "This venue takes direct bookings. Please book it online." };
  }

  const { data: created, error: insErr } = await db
    .from("leads")
    .insert({
      hall_id: hall.id,
      owner_id: hall.owner_id,
      customer_id: input.customerId,
      contact_name: input.contactName,
      contact_phone: phone,
      event_date: input.eventDate,
      event_type: input.eventType,
      guest_count: input.guestCount,
      requirements: input.requirements,
      status: "awaiting_verification",
    })
    .select("id, phone_verified, status")
    .maybeSingle();

  if (!insErr && created) {
    return { ok: true, leadId: created.id, phone, alreadyVerified: false };
  }

  // 23505 — uq_lead_active. There is already a live enquiry from this customer
  // for this hall and date. Resume it.
  if (insErr?.code === "23505") {
    const { data: existing } = await db
      .from("leads")
      .select("id, phone_verified, status, contact_phone")
      .eq("hall_id", hall.id)
      .eq("customer_id", input.customerId)
      .eq("event_date", input.eventDate)
      .in("status", ["awaiting_verification", "pending", "confirmed"])
      .maybeSingle();

    if (existing) {
      // Still unverified: let the customer correct the details and the number.
      // Their own row, their own enquiry, and it has not reached the venue.
      if (existing.status === "awaiting_verification") {
        const { error: updErr } = await db
          .from("leads")
          .update({
            contact_name: input.contactName,
            contact_phone: phone,
            event_type: input.eventType,
            guest_count: input.guestCount,
            requirements: input.requirements,
          })
          .eq("id", existing.id)
          .eq("status", "awaiting_verification");
        if (updErr) {
          console.error("[leads] resume update failed", updErr.code, updErr.message);
        }
        return { ok: true, leadId: existing.id, phone, alreadyVerified: false };
      }
      // Already forwarded. Say so plainly rather than silently doing nothing.
      return { ok: true, leadId: existing.id, phone: existing.contact_phone, alreadyVerified: true };
    }
  }

  console.error("[leads] insert failed", insErr?.code, insErr?.message);
  return { ok: false, error: "Could not send your enquiry just now. Please try again." };
}

// ── Verification (the gate on RULE 2) ────────────────────────────────────────

export type VerifyLeadResult =
  | { ok: true; forwarded: boolean; lead: LeadRow }
  | { ok: false; error: string };

/**
 * Promotes a verified enquiry to 'pending', which is the moment it becomes
 * visible to the venue.
 *
 * CALLED ONLY AFTER MSG91 HAS ANSWERED YES. This function does not check a
 * code and must never be given one — its caller owns that, and its caller is
 * the only thing standing between an unverified number and a venue's phone.
 *
 * The `.eq("status", "awaiting_verification")` on the update is what makes the
 * promotion happen at most once. A repeat call finds zero rows to move,
 * reports forwarded:false, and the caller therefore does not send a second SMS
 * — which is the §6 "no duplicate SMS" requirement enforced at the row rather
 * than trusted to the outbox alone. (The outbox dedupe key is still there
 * underneath, as the second line of defence.)
 */
export async function markLeadPhoneVerified(input: {
  leadId: string;
  customerId: string;
  phone: string;
}): Promise<VerifyLeadResult> {
  const db = admin();
  const now = new Date().toISOString();

  const { data: moved, error } = await db
    .from("leads")
    .update({
      phone_verified: true,
      phone_verified_at: now,
      status: "pending",
    })
    // customer_id is part of the WHERE, not merely of the read above it: this
    // is the write that forwards somebody's phone number to a business, and it
    // must be impossible to perform against a lead belonging to another person
    // even if a caller passed the wrong id.
    .eq("id", input.leadId)
    .eq("customer_id", input.customerId)
    .eq("contact_phone", input.phone)
    .eq("status", "awaiting_verification")
    .select(LEAD_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error("[leads] verify update failed", error.code, error.message);
    return { ok: false, error: "Verified, but we could not send your enquiry. Please try again." };
  }

  if (moved) return { ok: true, forwarded: true, lead: toLead(moved) };

  // Nothing moved. Either it was already forwarded (a resend, a double-submit)
  // or the lead is not this customer's. Re-read under the same ownership
  // constraint to tell those apart honestly.
  const { data: current } = await db
    .from("leads")
    .select(LEAD_COLUMNS)
    .eq("id", input.leadId)
    .eq("customer_id", input.customerId)
    .maybeSingle();

  if (!current) return { ok: false, error: "That enquiry could not be found." };
  return { ok: true, forwarded: false, lead: toLead(current) };
}

// ── Owner decisions ──────────────────────────────────────────────────────────

export type ConfirmLeadResult =
  | { ok: true; alreadyConfirmed: boolean; commissionId: string | null; breakdown: LeadCommissionBreakdown | null; lead: LeadRow }
  | { ok: false; error: string };

/**
 * The venue's tick. Moves pending → confirmed and raises the commission.
 *
 * `ownerProfileId` is the AUTHENTICATED user's profile id. Ownership is proved
 * here, against the database, by matching the lead's hall_owners row to that
 * profile — never by trusting an owner id in the request.
 *
 * ORDER MATTERS AND IS THE OPPOSITE OF THE OBVIOUS ONE. The lead is confirmed
 * FIRST, then the commission is raised. The reverse — commission first — leaves
 * a debt attached to a lead that was never confirmed if the second write fails,
 * and that is a bill for something the venue can point at and say did not
 * happen. This way a failure leaves a confirmed lead with no commission row,
 * which is visible (the admin's reconciliation shows it), recoverable
 * (raiseLeadCommission is idempotent and can simply be run again) and errs
 * toward not billing.
 */
export async function confirmLead(input: {
  leadId: string;
  ownerProfileId: string;
  agreedAmount: number;
  ownerNotes: string | null;
}): Promise<ConfirmLeadResult> {
  const db = admin();

  const owned = await loadOwnedLead(input.leadId, input.ownerProfileId);
  if (!owned.ok) return { ok: false, error: owned.error };
  const lead = owned.lead;

  if (lead.status === "confirmed") {
    // IDEMPOTENT. A second tick must not re-notify, must not re-raise the
    // commission and must not overwrite the amount that was agreed the first
    // time. The existing commission is returned so the UI can still show it.
    const existing = await findLeadCommission(lead.id);
    return {
      ok: true,
      alreadyConfirmed: true,
      commissionId: existing?.id ?? null,
      breakdown: existing
        ? {
            agreedAmount: existing.booking_amount,
            commissionRate: existing.commission_rate,
            commissionAmount: existing.commission_amount,
            ownerNet: existing.owner_payout_amount,
          }
        : null,
      lead,
    };
  }
  if (lead.status !== "pending") {
    return { ok: false, error: "Only a pending enquiry can be confirmed." };
  }

  // THE STANDARD RATE (lib/commission.ts), applied server-side. The request
  // carries only the agreed amount; there is no rate to send or to tamper with.
  let breakdown: LeadCommissionBreakdown;
  try {
    breakdown = calculateLeadCommission({ agreedAmount: input.agreedAmount });
  } catch (e) {
    console.error("[leads] commission calc refused", e instanceof Error ? e.message : e);
    return { ok: false, error: "That amount cannot be used. Enter the amount agreed with the customer." };
  }

  const now = new Date().toISOString();
  const { data: confirmed, error: confirmErr } = await db
    .from("leads")
    .update({
      status: "confirmed",
      agreed_amount: breakdown.agreedAmount,
      confirmed_at: now,
      responded_at: now,
      confirmed_by: input.ownerProfileId,
      owner_notes: input.ownerNotes,
    })
    // The status guard makes this a compare-and-set: two simultaneous ticks,
    // and only one of them updates a row. The loser sees zero rows and is
    // routed to the already-confirmed branch below rather than raising a second
    // commission.
    .eq("id", lead.id)
    .eq("status", "pending")
    .select(LEAD_COLUMNS)
    .maybeSingle();

  if (confirmErr) {
    console.error("[leads] confirm failed", confirmErr.code, confirmErr.message);
    return { ok: false, error: "Could not confirm this enquiry. Please try again." };
  }
  if (!confirmed) {
    // Lost the race. Somebody else's write already confirmed it.
    const existing = await findLeadCommission(lead.id);
    const fresh = await loadOwnedLead(lead.id, input.ownerProfileId);
    return {
      ok: true,
      alreadyConfirmed: true,
      commissionId: existing?.id ?? null,
      breakdown: null,
      lead: fresh.ok ? fresh.lead : lead,
    };
  }

  const raised = await raiseLeadCommission({
    lead: toLead(confirmed),
    breakdown,
  });

  return {
    ok: true,
    alreadyConfirmed: false,
    commissionId: raised,
    breakdown,
    lead: toLead(confirmed),
  };
}

export type RejectLeadResult = { ok: true; changed: boolean } | { ok: false; error: string };

/** The venue declines. No commission is raised, ever — nothing was agreed. */
export async function rejectLead(input: {
  leadId: string;
  ownerProfileId: string;
  reason: string | null;
}): Promise<RejectLeadResult> {
  const db = admin();
  const owned = await loadOwnedLead(input.leadId, input.ownerProfileId);
  if (!owned.ok) return { ok: false, error: owned.error };
  if (owned.lead.status === "rejected") return { ok: true, changed: false };
  if (owned.lead.status !== "pending") {
    return { ok: false, error: "Only a pending enquiry can be declined." };
  }

  const now = new Date().toISOString();
  const { error, count } = await db
    .from("leads")
    .update(
      { status: "rejected", responded_at: now, cancel_reason: input.reason },
      { count: "exact" },
    )
    .eq("id", input.leadId)
    .eq("status", "pending");

  if (error) {
    console.error("[leads] reject failed", error.code, error.message);
    return { ok: false, error: "Could not decline this enquiry. Please try again." };
  }
  return { ok: true, changed: (count ?? 0) > 0 };
}

export type CancelLeadResult = { ok: true; changed: boolean } | { ok: false; error: string };

/**
 * The customer withdraws.
 *
 * Allowed while awaiting verification or pending, and NOT after the venue has
 * confirmed: at that point a commission exists, and letting the party who does
 * not owe it delete the record would be a way to make somebody else's debt
 * disappear.
 */
export async function cancelLead(input: {
  leadId: string;
  customerId: string;
}): Promise<CancelLeadResult> {
  const db = admin();
  const { error, count } = await db
    .from("leads")
    .update({ status: "cancelled", responded_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", input.leadId)
    .eq("customer_id", input.customerId)
    .in("status", ["awaiting_verification", "pending"]);

  if (error) {
    console.error("[leads] cancel failed", error.code, error.message);
    return { ok: false, error: "Could not withdraw this enquiry. Please try again." };
  }
  return { ok: true, changed: (count ?? 0) > 0 };
}

// ── Ownership ────────────────────────────────────────────────────────────────

type OwnedLead = { ok: true; lead: LeadRow } | { ok: false; error: string };

/**
 * Reads a lead and proves the caller's profile owns the venue it belongs to.
 *
 * The join goes lead → hall_owners → profile_id and is compared to the SESSION
 * profile id. leads.owner_id is not trusted on its own for this: it is a
 * denormalised copy, and an authorisation check should not rest on a column
 * whose only guarantee is that some earlier write got it right.
 */
async function loadOwnedLead(leadId: string, ownerProfileId: string): Promise<OwnedLead> {
  const db = admin();
  const { data, error } = await db
    .from("leads")
    .select(`${LEAD_COLUMNS}, hall_owners!owner_id(id, profile_id)`)
    .eq("id", leadId)
    .maybeSingle();

  if (error) {
    console.error("[leads] owned read failed", error.code, error.message);
    return { ok: false, error: "Could not load that enquiry." };
  }
  if (!data) return { ok: false, error: "That enquiry could not be found." };
  if (data.hall_owners?.profile_id !== ownerProfileId) {
    // Deliberately the same message as "not found". An owner probing ids must
    // not be able to tell a lead that exists elsewhere from one that does not.
    return { ok: false, error: "That enquiry could not be found." };
  }
  return { ok: true, lead: toLead(data) };
}

// ── Commission rows ──────────────────────────────────────────────────────────

export type LeadCommissionRow = {
  id: string;
  lead_id: string;
  hall_id: string | null;
  hall_owner_id: string | null;
  booking_amount: number;
  commission_rate: number;
  commission_amount: number;
  owner_payout_amount: number;
  status: string;
  due_date: string | null;
  paid_at: string | null;
  created_at: string;
};

const COMMISSION_COLUMNS =
  "id, lead_id, hall_id, hall_owner_id, booking_amount, commission_rate, " +
  "commission_amount, owner_payout_amount, status, due_date, paid_at, created_at";

function toCommission(row: Record<string, unknown>): LeadCommissionRow {
  return {
    id: String(row.id),
    lead_id: String(row.lead_id),
    hall_id: (row.hall_id as string | null) ?? null,
    hall_owner_id: (row.hall_owner_id as string | null) ?? null,
    booking_amount: Number(row.booking_amount ?? 0),
    commission_rate: Number(row.commission_rate ?? 0),
    commission_amount: Number(row.commission_amount ?? 0),
    owner_payout_amount: Number(row.owner_payout_amount ?? 0),
    status: String(row.status),
    due_date: (row.due_date as string | null) ?? null,
    paid_at: (row.paid_at as string | null) ?? null,
    created_at: String(row.created_at),
  };
}

async function findLeadCommission(leadId: string): Promise<LeadCommissionRow | null> {
  const { data, error } = await admin()
    .from("commissions")
    .select(COMMISSION_COLUMNS)
    .eq("lead_id", leadId)
    .maybeSingle();
  if (error) {
    console.error("[leads] commission read failed", error.code, error.message);
    return null;
  }
  return data ? toCommission(data) : null;
}

/**
 * Raises the venue's debt for a confirmed lead. Returns the commission id, or
 * null if it could not be written.
 *
 * EXACTLY ONCE, and the guarantee is uq_commission_per_lead rather than this
 * function's own care. A 23505 here means the row already exists — which is a
 * SUCCESS, not a failure, and is reported as one. That is what makes the whole
 * confirm path safe to retry.
 *
 * A failure to write is logged and returns null. It does NOT unwind the
 * confirmation: the venue and the customer have agreed, and un-confirming their
 * lead because Hallnect could not record its own invoice would break the thing
 * that actually matters to them to protect the thing that matters to us. The
 * missing row shows up in the admin reconciliation, where a confirmed lead
 * with no commission is visible and fixable.
 */
async function raiseLeadCommission(input: {
  lead: LeadRow;
  breakdown: LeadCommissionBreakdown;
}): Promise<string | null> {
  const db = admin();
  const dueDays = await commissionDueDays();

  const { data, error } = await db
    .from("commissions")
    .insert({
      lead_id: input.lead.id,
      booking_id: null,
      hall_id: input.lead.hall_id,
      hall_owner_id: input.lead.owner_id,
      customer_id: input.lead.customer_id,
      booking_amount: input.breakdown.agreedAmount,
      // SNAPSHOT of the standard rate at confirmation. If the rule ever
      // changes again, this row keeps what the venue was actually billed.
      // trg_enforce_standard_lead_commission (0097) refuses any other value.
      commission_rate: input.breakdown.commissionRate,
      commission_amount: input.breakdown.commissionAmount,
      owner_payout_amount: input.breakdown.ownerNet,
      // No advance exists in a lead — Hallnect collected nothing. Writing a
      // zero here would read as "an advance of ₹0 was taken", which is a
      // different and false claim.
      advance_amount: null,
      status: "pending",
      due_date: new Date(Date.now() + dueDays * 86_400_000).toISOString(),
    })
    .select("id")
    .maybeSingle();

  if (!error && data) return data.id;

  if (error?.code === "23505") {
    const existing = await findLeadCommission(input.lead.id);
    return existing?.id ?? null;
  }

  console.error("[leads] commission insert failed", error?.code, error?.message);
  return null;
}

async function commissionDueDays(): Promise<number> {
  try {
    const { data } = await admin()
      .from("platform_settings")
      .select("commission_due_days")
      .eq("id", true)
      .maybeSingle();
    const n = Number(data?.commission_due_days);
    return Number.isInteger(n) && n > 0 && n <= 90 ? n : DEFAULT_COMMISSION_DUE_DAYS;
  } catch {
    return DEFAULT_COMMISSION_DUE_DAYS;
  }
}

// ── Reads ────────────────────────────────────────────────────────────────────

export type LeadWithHall = LeadRow & { hall_name: string; hall_slug: string };

/**
 * Every lead for a set of halls, newest first.
 *
 * Callers pass hall ids they have ALREADY established the caller may see — the
 * same contract readHallCommissionRates works to. Unverified leads are excluded
 * here as well as by RLS: this reads with the service role, which bypasses
 * policies, so the rule has to be restated rather than inherited.
 */
export async function fetchLeadsForHalls(
  hallIds: readonly string[],
  opts: { includeUnverified?: boolean } = {},
): Promise<LeadWithHall[]> {
  if (hallIds.length === 0) return [];
  try {
    let q = admin()
      .from("leads")
      .select(`${LEAD_COLUMNS}, halls!hall_id(name, slug)`)
      .in("hall_id", [...hallIds]);
    if (!opts.includeUnverified) q = q.eq("phone_verified", true);

    const { data, error } = await q.order("created_at", { ascending: false }).limit(500);
    if (error) {
      console.error("[leads] list failed", error.code, error.message);
      return [];
    }
    return (data ?? []).map((row: Record<string, unknown>) => ({
      ...toLead(row),
      hall_name: String((row.halls as { name?: string } | null)?.name ?? "Venue"),
      hall_slug: String((row.halls as { slug?: string } | null)?.slug ?? ""),
    }));
  } catch (e) {
    console.error("[leads] list threw", e instanceof Error ? e.message : e);
    return [];
  }
}

/** A customer's own enquiries, including ones they have not verified yet. */
export async function fetchLeadsForCustomer(customerId: string): Promise<LeadWithHall[]> {
  try {
    const { data, error } = await admin()
      .from("leads")
      .select(`${LEAD_COLUMNS}, halls!hall_id(name, slug)`)
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      console.error("[leads] customer list failed", error.code, error.message);
      return [];
    }
    return (data ?? []).map((row: Record<string, unknown>) => ({
      ...toLead(row),
      hall_name: String((row.halls as { name?: string } | null)?.name ?? "Venue"),
      hall_slug: String((row.halls as { slug?: string } | null)?.slug ?? ""),
    }));
  } catch (e) {
    console.error("[leads] customer list threw", e instanceof Error ? e.message : e);
    return [];
  }
}

// ── The venue's phone, for a customer who has actually enquired ──────────────

export type VenueContact = { businessName: string; phone: string | null };

/**
 * The venue's contact number for ONE lead, readable only by the customer who
 * made it, and only once that lead has actually reached the venue.
 *
 * ═══ WHY THIS IS NOT JUST PUT ON THE VENUE PAGE ═══════════════════════════
 *
 * Because publishing it there deletes the business. A lead-generation venue
 * earns Hallnect nothing except the commission on a confirmed enquiry; a
 * phone number in the public listing lets a customer ring the venue directly,
 * and then there is no lead, no confirmation, no commission — and no record
 * that Hallnect introduced them. `hall_seller_public` (migration 0054)
 * deliberately publishes the seller's NAME and ADDRESS and stops there, and
 * this keeps that line.
 *
 * So the number is released at the point where the introduction has already
 * been made and recorded: the customer verified their phone, the enquiry
 * reached the venue, and the lead row exists to attribute it to. That is also
 * the point at which the customer genuinely needs it.
 *
 * ═══ THE GATE ══════════════════════════════════════════════════════════════
 *   • the lead must belong to THIS customer (customer_id in the WHERE)
 *   • it must have reached the venue — 'pending' or 'confirmed'. An enquiry
 *     still awaiting OTP has proved nothing and releases nothing, so this
 *     cannot become a way to harvest venue numbers by starting enquiries.
 *
 * Returns a null phone rather than throwing when the venue has no usable
 * number on file — the customer is told to use the enquiry instead.
 */
export async function fetchVenueContactForLead(input: {
  leadId: string;
  customerId: string;
}): Promise<VenueContact | null> {
  try {
    const { data, error } = await admin()
      .from("leads")
      .select("id, status, hall_owners!owner_id(business_name, business_phone, profiles!profile_id(phone))")
      .eq("id", input.leadId)
      .eq("customer_id", input.customerId)
      .in("status", ["pending", "confirmed"])
      .maybeSingle();

    if (error) {
      console.error("[leads] venue contact read failed", error.code, error.message);
      return null;
    }
    if (!data) return null;

    const owner = data.hall_owners as
      { business_name?: string | null; business_phone?: string | null;
        profiles?: { phone?: string | null } | null } | null;

    // Business number first, personal second — and each is only accepted if it
    // NORMALISES. A malformed business_phone must fall through rather than be
    // handed to a customer as a number to ring; that presence-not-validity bug
    // is documented on pickPhone in lib/notifications/events.ts.
    const phone =
      normalizePhoneE164(owner?.business_phone ?? "") ??
      normalizePhoneE164(owner?.profiles?.phone ?? "") ??
      null;

    return { businessName: owner?.business_name ?? "the venue", phone };
  } catch (e) {
    console.error("[leads] venue contact threw", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Venue contact for many of the caller's own leads, keyed by lead id. */
export async function fetchVenueContactsForCustomer(
  customerId: string,
): Promise<Map<string, VenueContact>> {
  const out = new Map<string, VenueContact>();
  try {
    const { data, error } = await admin()
      .from("leads")
      .select("id, hall_owners!owner_id(business_name, business_phone, profiles!profile_id(phone))")
      .eq("customer_id", customerId)
      .in("status", ["pending", "confirmed"])
      .limit(200);
    if (error) {
      console.error("[leads] venue contacts failed", error.code, error.message);
      return out;
    }
    for (const row of (data ?? []) as Record<string, unknown>[]) {
      const owner = row.hall_owners as
        { business_name?: string | null; business_phone?: string | null;
          profiles?: { phone?: string | null } | null } | null;
      out.set(String(row.id), {
        businessName: owner?.business_name ?? "the venue",
        phone:
          normalizePhoneE164(owner?.business_phone ?? "") ??
          normalizePhoneE164(owner?.profiles?.phone ?? "") ??
          null,
      });
    }
    return out;
  } catch (e) {
    console.error("[leads] venue contacts threw", e instanceof Error ? e.message : e);
    return out;
  }
}

/** How many enquiries across these halls are still waiting on the venue. */
export async function countPendingLeads(hallIds: readonly string[]): Promise<number> {
  if (hallIds.length === 0) return 0;
  try {
    const { count, error } = await admin()
      .from("leads")
      .select("id", { count: "exact", head: true })
      .in("hall_id", [...hallIds])
      .eq("status", "pending")
      .eq("phone_verified", true);
    if (error) {
      console.error("[leads] pending count failed", error.code, error.message);
      return 0;
    }
    return count ?? 0;
  } catch (e) {
    console.error("[leads] pending count threw", e instanceof Error ? e.message : e);
    return 0;
  }
}

// ── Admin reconciliation ─────────────────────────────────────────────────────

export type AdminLeadLedgerRow = {
  lead: LeadWithHall;
  ownerBusiness: string | null;
  ownerName: string | null;
  commission: LeadCommissionRow | null;
  /** The most recent settlement attempt, whatever its state. */
  payment: {
    id: string;
    status: string;
    amount: number;
    cashfreeOrderId: string | null;
    cashfreePaymentId: string | null;
    verifiedAt: string | null;
    submittedAt: string;
  } | null;
};

/**
 * Every lead, with its commission and its settlement attempt, for the admin.
 *
 * CALLERS MUST HAVE ALREADY PROVED THE CALLER IS AN ADMIN. This reads with the
 * service role and is therefore not row-filtered — requireRole(["admin"]) at
 * the top of the page is the authorisation, exactly as it is for every other
 * lib/admin.ts read.
 *
 * UNVERIFIED LEADS ARE INCLUDED HERE, and only here. An admin investigating
 * "the venue says they never got my enquiry" needs to be able to see an enquiry
 * that never left the awaiting_verification state — that is the answer to the
 * question. The owner's view and the notification path both still exclude them.
 */
export async function fetchAdminLeadLedger(limit = 200): Promise<AdminLeadLedgerRow[]> {
  try {
    const db = admin();
    const { data, error } = await db
      .from("leads")
      .select(
        `${LEAD_COLUMNS}, halls!hall_id(name, slug), ` +
        "hall_owners!owner_id(business_name, profiles!profile_id(full_name))",
      )
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("[leads] admin ledger failed", error.code, error.message);
      return [];
    }

    const rows = (data ?? []) as Record<string, unknown>[];
    const leadIds = rows.map((r) => String(r.id));
    const commissions = await fetchLeadCommissions(leadIds);

    // One batched read for every settlement attempt, rather than one per row.
    const commissionIds = [...commissions.values()].map((c) => c.id);
    const latestPayment = new Map<string, AdminLeadLedgerRow["payment"]>();
    if (commissionIds.length > 0) {
      const { data: pays, error: payErr } = await db
        .from("owner_commission_payments")
        .select("id, commission_id, status, amount, cashfree_order_id, cashfree_payment_id, verified_at, submitted_at")
        .in("commission_id", commissionIds)
        .order("submitted_at", { ascending: false });
      if (payErr) {
        console.error("[leads] admin payments failed", payErr.code, payErr.message);
      } else {
        for (const row of (pays ?? []) as Record<string, unknown>[]) {
          const cid = String(row.commission_id);
          // Ordered newest-first, so the FIRST row seen per commission is the
          // latest attempt. Later (older) rows are skipped.
          if (latestPayment.has(cid)) continue;
          latestPayment.set(cid, {
            id: String(row.id),
            status: String(row.status),
            amount: Number(row.amount ?? 0),
            cashfreeOrderId: (row.cashfree_order_id as string | null) ?? null,
            cashfreePaymentId: (row.cashfree_payment_id as string | null) ?? null,
            verifiedAt: (row.verified_at as string | null) ?? null,
            submittedAt: String(row.submitted_at),
          });
        }
      }
    }

    return rows.map((row) => {
      const lead: LeadWithHall = {
        ...toLead(row),
        hall_name: String((row.halls as { name?: string } | null)?.name ?? "Venue"),
        hall_slug: String((row.halls as { slug?: string } | null)?.slug ?? ""),
      };
      const owner = row.hall_owners as
        { business_name?: string | null; profiles?: { full_name?: string | null } | null } | null;
      const commission = commissions.get(lead.id) ?? null;
      return {
        lead,
        ownerBusiness: owner?.business_name ?? null,
        ownerName: owner?.profiles?.full_name ?? null,
        commission,
        payment: commission ? latestPayment.get(commission.id) ?? null : null,
      };
    });
  } catch (e) {
    console.error("[leads] admin ledger threw", e instanceof Error ? e.message : e);
    return [];
  }
}

/** Commission rows for a set of leads, keyed by lead id. */
export async function fetchLeadCommissions(
  leadIds: readonly string[],
): Promise<Map<string, LeadCommissionRow>> {
  const out = new Map<string, LeadCommissionRow>();
  if (leadIds.length === 0) return out;
  try {
    const { data, error } = await admin()
      .from("commissions")
      .select(COMMISSION_COLUMNS)
      .in("lead_id", [...leadIds]);
    if (error) {
      console.error("[leads] commission batch failed", error.code, error.message);
      return out;
    }
    for (const row of (data ?? []) as Record<string, unknown>[]) {
      const c = toCommission(row);
      out.set(c.lead_id, c);
    }
    return out;
  } catch (e) {
    console.error("[leads] commission batch threw", e instanceof Error ? e.message : e);
    return out;
  }
}
