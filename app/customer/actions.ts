"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { releaseAvailabilityForBooking } from "@/lib/availability-release";
import { CANCELLABLE_STATUSES } from "@/lib/customer";
import {
  reviewSchema,
  profileUpdateSchema,
  uuidSchema,
  parseSafe,
} from "@/lib/validation/schemas";
import { sanitizeError } from "@/lib/errors";
import { notifyBookingEvent } from "@/lib/notifications/events";
import { normalizePhoneE164 } from "@/lib/notifications/phone";
import { recordBookingRefund } from "@/lib/refunds";

type ActionResult = { success: true } | { error: string };

// ── Cancel booking ────────────────────────────────────────────────────────────
// Security:
//   • RLS bookings_select: customer_id = auth.uid() — so the read below only
//     returns rows the caller owns.
//   • bookings_update WITH CHECK: same.
//   • DB trigger validate_booking_transition: rejects illegal status changes.
//   • We also check CANCELLABLE_STATUSES here for a fast UX-level guard before
//     hitting the DB.

export async function cancelBooking(
  bookingId: string,
  reason?: string,
): Promise<ActionResult> {
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  if (!parseSafe(uuidSchema, bookingId).ok) return { error: "Invalid booking id." };
  const cleanReason = reason ? reason.replace(/[<>]/g, "").trim().slice(0, 500) : "";

  // Verify the booking belongs to this customer and is cancellable.
  const { data: booking } = await db
    .from("bookings")
    .select("id, status")
    .eq("id", bookingId)
    .eq("customer_id", user.id)
    .maybeSingle();

  if (!booking) return { error: "Booking not found" };

  if (!CANCELLABLE_STATUSES.has(booking.status)) {
    return {
      error: `Booking in "${booking.status.replace(/_/g, " ")}" status cannot be cancelled.`,
    };
  }

  const { error, count } = await db
    .from("bookings")
    .update({
      status: "cancelled",
      cancel_reason: cleanReason || "Cancelled by customer",
    }, { count: "exact" })
    .eq("id", bookingId)
    .eq("customer_id", user.id);

  if (error) return { error: sanitizeError(error, "customer") };
  // 0 rows = RLS filtered the write; do not report (or notify) a cancellation
  // that never happened.
  if (count === 0) return { error: "This booking could not be cancelled." };

  // Give the dates back. Without this the calendar stayed blocked forever and
  // the venue silently lost those days for good.
  await releaseAvailabilityForBooking(bookingId);

  // §cancellation-flow: customer + owner + admin are all informed.
  await notifyBookingEvent("booking.cancelled", bookingId, { reason: cleanReason || null });

  // Record what is owed back per the published schedule (advance only — the
  // ₹200 platform fee is non-refundable on a customer cancellation). Recording
  // is idempotent and never fails the cancellation; when money is actually due
  // the customer is told the exact figure rather than left guessing.
  const refund = await recordBookingRefund(bookingId, "customer");
  if (refund && refund.refundAmount > 0) {
    await notifyBookingEvent("refund.initiated", bookingId, { amount: refund.refundAmount });
  }

  revalidatePath(`/customer/bookings/${bookingId}`);
  revalidatePath("/customer/bookings");
  revalidatePath("/customer");
  return { success: true };
}

// ── Submit review ─────────────────────────────────────────────────────────────
// Security:
//   • RLS reviews_insert WITH CHECK: customer must have a completed booking on
//     this hall (checked in the DB, not just here). We can't bypass this.
//   • Unique index (booking_id) WHERE booking_id IS NOT NULL prevents
//     double-review per booking. Legacy unique (customer_id, hall_id) removed
//     in migration 0015.

export async function submitReview(data: {
  hallId:             string;
  bookingId:          string;
  rating:             number;
  title?:             string;
  comment?:           string;
  cleanlinessRating?: number;
  valueRating?:       number;
  locationRating?:    number;
  serviceRating?:     number;
}): Promise<ActionResult> {
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const parsed = parseSafe(reviewSchema, data);
  if (!parsed.ok) return { error: parsed.error };
  const v = parsed.data;

  // THE BOOKING MUST BE THE CALLER'S OWN, COMPLETED, AND FOR THIS HALL.
  // reviews has a UNIQUE(booking_id), so an unverified booking_id let a
  // customer burn someone else's one-review slot — insert a review against a
  // stranger's booking id and that booking can never be reviewed by the person
  // who actually stayed there. It also let a review be attached to a hall the
  // reviewer never booked.
  const { data: ownBooking } = await db
    .from("bookings")
    .select("id, status, hall_id")
    .eq("id", v.bookingId)
    .eq("customer_id", user.id)
    .maybeSingle();

  if (!ownBooking) return { error: "That booking is not yours." };
  if (ownBooking.hall_id !== v.hallId) return { error: "That booking is for a different venue." };
  if (String(ownBooking.status) !== "completed") {
    return { error: "You can review a venue once your booking is completed." };
  }

  const row: Record<string, unknown> = {
    hall_id:     v.hallId,
    booking_id:  v.bookingId,
    customer_id: user.id,
    rating:      v.rating,
    comment:     v.comment || null,
  };

  // New columns — only include if defined, so inserts work before migration 0015
  if (data.title !== undefined)             row.title              = v.title || null;
  if (data.cleanlinessRating !== undefined) row.cleanliness_rating = v.cleanlinessRating ?? null;
  if (data.valueRating !== undefined)       row.value_rating       = v.valueRating ?? null;
  if (data.locationRating !== undefined)    row.location_rating    = v.locationRating ?? null;
  if (data.serviceRating !== undefined)     row.service_rating     = v.serviceRating ?? null;

  const { error } = await db.from("reviews").insert(row);

  if (error) {
    if (error.code === "23505") return { error: "You have already reviewed this booking." };
    // 42703 = new column doesn't exist yet — retry without new fields
    if (error.code === "42703") {
      const { error: retryErr } = await db.from("reviews").insert({
        hall_id: v.hallId, booking_id: v.bookingId, customer_id: user.id,
        rating: v.rating, comment: v.comment || null,
      });
      if (retryErr) {
        if (retryErr.code === "23505") return { error: "You have already reviewed this booking." };
        return { error: sanitizeError(retryErr, "submitReview.retry") };
      }
    } else {
      return { error: sanitizeError(error, "submitReview") };
    }
  }

  revalidatePath(`/customer/bookings/${v.bookingId}`);
  revalidatePath("/customer/reviews");
  return { success: true };
}

// ── Update profile ────────────────────────────────────────────────────────────
// Security:
//   • RLS profiles_update WITH CHECK: user can only update their own row, and
//     the role column is locked (compared against stored value — see 0007).
//   • We only write full_name and phone — role is never touched here.

export async function updateProfile(data: {
  fullName?: string;
  phone?:    string;
  notificationsEnabled?: boolean;
}): Promise<ActionResult> {
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const parsed = parseSafe(profileUpdateSchema, data);
  if (!parsed.ok) return { error: parsed.error };

  // NORMALISE before storing. profiles.phone previously took whatever the form
  // sent, so the same person could be '9876543210' here and '+919876543210' on
  // their booking — and WhatsApp needs E.164 exactly. Rejecting an
  // un-normalisable number is better than silently storing one we can never
  // message.
  let normalisedPhone: string | null = null;
  if (parsed.data.phone) {
    normalisedPhone = normalizePhoneE164(parsed.data.phone);
    if (!normalisedPhone) {
      return { error: "Enter a valid mobile number, e.g. 98765 43210 or +91 98765 43210." };
    }
  }

  const updatePayload: Record<string, unknown> = {
    full_name: parsed.data.fullName || null,
    phone:     normalisedPhone,
  };

  // CHANGING THE NUMBER INVALIDATES THE VERIFICATION.
  //
  // events.ts prefers an OTP-verified profile phone over the booking's
  // client-supplied contact_phone, precisely so a branded message cannot be
  // aimed at a number nobody proved they own. Leaving phone_verified set after
  // an edit defeated that: verify your own number once, then change the field
  // to someone else's, and every "HALLNECT" booking message would be delivered
  // to them — with the verified flag vouching for it.
  //
  // Only clear it when the number actually CHANGES, so re-saving an unchanged
  // profile does not make a user re-verify for nothing.
  const { data: existing } = await db
    .from("profiles").select("phone, phone_verified").eq("id", user.id).maybeSingle();
  if (existing?.phone_verified && existing.phone !== normalisedPhone) {
    updatePayload.phone_verified = false;
    updatePayload.phone_verified_at = null;
  }

  // Controls NON-critical messages only — critical transactional messages
  // (booking/payment) are always sent regardless of this flag.
  if (typeof data.notificationsEnabled === "boolean") {
    updatePayload.whatsapp_notifications_enabled = data.notificationsEnabled;
  }

  let { error } = await db
    .from("profiles")
    .update(updatePayload)
    .eq("id", user.id);

  // Unknown column (pre-0026): PostgREST reports it as PGRST204, Postgres as
  // 42703 — retry without it so profile edits still work on un-migrated DBs.
  if ((error?.code === "42703" || error?.code === "PGRST204") && "whatsapp_notifications_enabled" in updatePayload) {
    delete updatePayload.whatsapp_notifications_enabled;
    ({ error } = await db.from("profiles").update(updatePayload).eq("id", user.id));
  }

  if (error) return { error: sanitizeError(error, "customer") };

  revalidatePath("/customer/profile");
  revalidatePath("/customer");
  return { success: true };
}
