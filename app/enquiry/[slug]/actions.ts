"use server";

// ─────────────────────────────────────────────────────────────────────────────
// Lead-enquiry server actions.
//
// THE ONE RULE THIS FILE EXISTS TO ENFORCE: nothing reaches the venue until
// MSG91 says the customer holds the number they typed.
//
// It is enforced three times over, deliberately, because the failure it
// prevents is texting a stranger's phone with a business's expectation
// attached:
//   1. leads.status starts at 'awaiting_verification' and only
//      markLeadPhoneVerified promotes it — under a status guard, so at most
//      once.
//   2. leads_select (migration 0073) requires phone_verified, so the venue
//      cannot READ an unverified enquiry even if something forwarded it.
//   3. notifyLeadEvent re-reads phone_verified and refuses to send if it is
//      false.
//
// SECURITY
//   • Identity is the session's. customerId is never accepted from the client.
//   • The hall's owner, its status and its booking mode are read server-side;
//     a DIRECT_BOOKING hall is refused, so this action cannot be used to skip
//     checkout and get a venue's attention without paying the advance.
//   • MSG91 credentials never leave the server.
//   • OTP values are never generated, stored or logged. MSG91 owns the code.
//   • Rate limiting is lib/otp-guard.ts — the SAME counters the profile
//     verification flow uses, so this form is not a second allowance.
//   • THE PROFILE PHONE IS NOT TOUCHED. Verifying a contact number for one
//     enquiry must not overwrite the account's own number: a customer
//     enquiring with a relative's phone would otherwise hijack their own
//     login identity. That is the one thing this flow deliberately does NOT
//     share with /verify-phone.
// ─────────────────────────────────────────────────────────────────────────────

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";
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
import {
  createLeadEnquiry, markLeadPhoneVerified, cancelLead, fetchVenueContactForLead,
} from "@/lib/leads";
import { notifyLeadEvent } from "@/lib/notifications/events";
import { leadEnquirySchema, uuidSchema, parseSafe } from "@/lib/validation/schemas";

export type StartEnquiryResult =
  | { success: true; leadId: string; alreadySent: boolean; cooldownSeconds?: number }
  | { error: string };

/**
 * Records the enquiry and sends the code.
 *
 * THE LEAD ROW IS WRITTEN BEFORE THE SMS, and that ordering is not incidental.
 * If the code were sent first and the row failed to write, the customer would
 * hold a valid code for an enquiry that does not exist and no later step could
 * attach it to anything. This way a failed SMS leaves a resumable enquiry the
 * customer can retry from — and an un-forwarded one, which is the safe state.
 *
 * IDEMPOTENT. createLeadEnquiry resolves a repeat submission onto the same
 * lead (uq_lead_active), so a double-tapped button does not create two
 * enquiries and does not send two codes — the resend cooldown catches the
 * second SMS.
 */
export async function startLeadEnquiry(input: {
  hallId: string;
  contactName: string;
  contactPhone: string;
  eventDate: string;
  eventType?: string;
  guestCount?: string;
  requirements?: string;
}): Promise<StartEnquiryResult> {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in to send an enquiry." };

  if (!isOtpConfigured()) {
    return {
      error: "We cannot verify phone numbers right now, so enquiries are paused. Please try again later.",
    };
  }

  const parsed = parseSafe(leadEnquirySchema, input);
  if (!parsed.ok) return { error: parsed.error };
  const v = parsed.data;

  const phone = normalizePhoneE164(v.contactPhone);
  if (!phone) return { error: "Enter a valid mobile number." };

  const created = await createLeadEnquiry({
    hallId: v.hallId,
    customerId: user.id,
    contactName: v.contactName,
    contactPhone: phone,
    eventDate: v.eventDate,
    eventType: v.eventType,
    guestCount: v.guestCount,
    requirements: v.requirements || null,
  });
  if (!created.ok) return { error: created.error };

  // Already verified and forwarded on an earlier visit. Do not send another
  // code for an enquiry that is finished — say so instead.
  if (created.alreadyVerified) {
    return { success: true, leadId: created.leadId, alreadySent: true };
  }

  const guard = await guardOtpSend({ userId: user.id, phone });
  if (!guard.ok) {
    // The lead survives a refused send. It is un-forwarded, resumable, and the
    // customer can try again once the cooldown passes — deleting it here would
    // throw away the details they just typed.
    return { error: guard.error };
  }

  const sent = await sendVerificationOtp(phone);
  await guard.settle(sent.ok);

  if (!sent.ok) {
    switch (sent.error) {
      case "invalid_phone":  return { error: "This number cannot receive verification codes." };
      case "rate_limited":   return { error: "Too many attempts. Please try again shortly." };
      case "not_configured": return { error: "Phone verification is not available yet." };
      default:               return { error: GENERIC_SEND_ERROR };
    }
  }

  return {
    success: true,
    leadId: created.leadId,
    alreadySent: false,
    cooldownSeconds: RESEND_COOLDOWN_SECONDS,
  };
}

export type ResendEnquiryOtpResult =
  | { success: true; cooldownSeconds: number }
  | { error: string };

/** Re-delivers the SAME code (MSG91's retry endpoint), for the caller's own lead. */
export async function resendLeadOtp(leadId: string): Promise<ResendEnquiryOtpResult> {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in to continue." };
  if (!parseSafe(uuidSchema, leadId).ok) return { error: "Invalid enquiry." };
  if (!isOtpConfigured()) return { error: "Phone verification is not available yet." };

  const lead = await loadOwnEnquiry(leadId, user.id);
  if (!lead) return { error: "That enquiry could not be found." };
  if (lead.status !== "awaiting_verification") {
    return { error: "This enquiry has already been sent to the venue." };
  }

  const guard = await guardOtpSend({ userId: user.id, phone: lead.contact_phone });
  if (!guard.ok) return { error: guard.error };

  const sent = await resendVerificationOtp(lead.contact_phone);
  await guard.settle(sent.ok);
  if (!sent.ok) return { error: GENERIC_SEND_ERROR };

  return { success: true, cooldownSeconds: RESEND_COOLDOWN_SECONDS };
}

export type VerifyEnquiryResult =
  | {
      success: true;
      forwarded: boolean;
      /** The venue's number, so the customer can call the moment they land on
       *  the success screen. Null when the venue published none. */
      venue?: { businessName: string; phone: string | null } | null;
    }
  | { error: string };

/**
 * Checks the code and, only on success, forwards the enquiry.
 *
 * THE SMS TO THE VENUE FIRES HERE AND NOWHERE ELSE — never from a page view,
 * never from the create action, never optimistically. `forwarded` is false when
 * the promotion did not happen (a repeat verify, a second tab), and that is
 * exactly when no message is sent: RULE 6's "no duplicate SMS" is decided by
 * whether a row actually moved, with the outbox dedupe key underneath as the
 * second line of defence.
 */
export async function verifyLeadOtp(leadId: string, code: string): Promise<VerifyEnquiryResult> {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in to continue." };
  if (!parseSafe(uuidSchema, leadId).ok) return { error: "Invalid enquiry." };
  if (!isOtpConfigured()) return { error: "Phone verification is not available yet." };

  const clean = (code ?? "").replace(/\D/g, "");
  if (!/^\d{4,8}$/.test(clean)) return { error: "Enter the code you received." };

  const lead = await loadOwnEnquiry(leadId, user.id);
  if (!lead) return { error: "That enquiry could not be found." };
  if (lead.status !== "awaiting_verification") {
    // Already done. Idempotent rather than an error — a customer who submits
    // the code twice has succeeded, not failed.
    return {
      success: true,
      forwarded: false,
      venue: await fetchVenueContactForLead({ leadId, customerId: user.id }),
    };
  }

  if (await failedCheckLimitReached(lead.contact_phone)) {
    return { error: "Too many incorrect attempts. Request a new code in a few minutes." };
  }

  const result = await checkVerificationOtp(lead.contact_phone, clean);

  // A provider outage is NOT a failed attempt, and above all it is NOT an
  // approval. Collapsing "we could not ask" into either one would let an MSG91
  // hiccup lock a customer out — or, far worse, forward an unverified number.
  if (!result.ok) {
    return { error: "Could not verify the code right now. Please try again." };
  }

  await recordCheckAttempt({ userId: user.id, phone: lead.contact_phone, approved: result.approved });

  if (!result.approved) return { error: "That code is incorrect or has expired." };

  const moved = await markLeadPhoneVerified({
    leadId,
    customerId: user.id,
    phone: lead.contact_phone,
  });
  if (!moved.ok) return { error: moved.error };

  if (moved.forwarded) {
    await notifyLeadEvent("lead.created", leadId);
    revalidatePath("/owner/leads");
    revalidatePath("/admin/leads");
  }

  revalidatePath("/customer/enquiries");
  return {
    success: true,
    forwarded: moved.forwarded,
    // Read AFTER the promotion: fetchVenueContactForLead only releases a number
    // for a lead that has actually reached the venue, so calling it earlier
    // would correctly return nothing.
    venue: await fetchVenueContactForLead({ leadId, customerId: user.id }),
  };
}

export type WithdrawEnquiryResult = { success: true } | { error: string };

/** The customer withdraws their own enquiry. Refused once a venue has confirmed. */
export async function withdrawLeadEnquiry(leadId: string): Promise<WithdrawEnquiryResult> {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in to continue." };
  if (!parseSafe(uuidSchema, leadId).ok) return { error: "Invalid enquiry." };

  const res = await cancelLead({ leadId, customerId: user.id });
  if (!res.ok) return { error: res.error };
  if (!res.changed) {
    return { error: "This enquiry can no longer be withdrawn — the venue has already responded." };
  }

  revalidatePath("/customer/enquiries");
  revalidatePath("/owner/leads");
  return { success: true };
}

/**
 * The caller's OWN enquiry, read through the SESSION client so RLS decides.
 *
 * Deliberately not the service role: leads_select already scopes a customer to
 * `customer_id = auth.uid()`, and letting the database make that decision means
 * a mistake in this file cannot read somebody else's enquiry — including their
 * phone number, which is the value the next line sends a code to.
 */
async function loadOwnEnquiry(
  leadId: string,
  customerId: string,
): Promise<{ id: string; status: string; contact_phone: string } | null> {
  try {
    const supabase = await getSupabaseServerClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from("leads")
      .select("id, status, contact_phone")
      .eq("id", leadId)
      .eq("customer_id", customerId)
      .maybeSingle();
    if (error) {
      console.error("[enquiry] own lead read failed:", error.code, error.message);
      return null;
    }
    return data ?? null;
  } catch (e) {
    console.error("[enquiry] own lead read threw:", e instanceof Error ? e.message : e);
    return null;
  }
}
