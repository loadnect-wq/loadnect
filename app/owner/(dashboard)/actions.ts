"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { generateSlug } from "@/lib/owner";
import {
  ownerBusinessSchema,
  payoutDetailsSchema,
  profileUpdateSchema,
  hallCreateSchema,
  hallSchema,
  addHallImageSchema,
  updateHallImageAltSchema,
  claimHallDraftSchema,
  uuidSchema,
  offlineBookingSchema,
  parseSafe,
  normalizeAmenityName,
  CUSTOM_AMENITY_LIMITS,
  customAmenityListSchema,
  commissionRateSchema,
  leadConfirmSchema,
} from "@/lib/validation/schemas";
import { sanitizeError } from "@/lib/errors";
import { setHallCommissionRate } from "@/lib/hall-commission";
import { canonicalStateForStorage } from "@/lib/seo/state";
import { resolveMapInput } from "@/lib/geo";
import { recordOwnerAction } from "@/lib/audit";
import { notifyBookingEvent, notifyHallSubmitted, notifyHallEdited } from "@/lib/notifications/events";
import { normalizePhoneE164 } from "@/lib/notifications/phone";
import { isCashfreeConfigured } from "@/lib/cashfree";
import { payOwnerOnAcceptance } from "@/lib/owner-payout";
import { recordBookingRefundOrAlert } from "@/lib/refunds";
import { releaseAvailabilityForBooking } from "@/lib/availability-release";
import { isOwnerResponseOverdue } from "@/lib/booking-expiry";
import { isPayoutsConfigured } from "@/lib/cashfree-payouts";
import { registerBeneficiary, refreshBeneficiary } from "@/lib/payout-dispatch";
import { publicUrlForStoragePath } from "@/lib/supabase/storage";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

type ActionResult = { success: true; id?: string } | { error: string };

/** Photos one hall may hold. Generous for a real venue, bounded against abuse
 *  and against a gallery nobody can scroll. */
const MAX_IMAGES_PER_HALL = 30;

/** Short random slug suffix used to break (possibly RLS-invisible) collisions. */
function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 7);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getAuthUser() {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

/**
 * AUTHENTICATION IS NOT AUTHORISATION, and a server action is a public HTTP
 * endpoint. The (dashboard) layout requires owner_approved, but the layout only
 * decides what is RENDERED — every action in this file is directly invocable by
 * anyone with a session cookie, and most of them gate on getAuthUser() alone.
 *
 * That is tolerable where RLS is the real authority. It is NOT tolerable for
 * the two actions that reach Cashfree Payouts: hall_owners_insert lets any
 * signed-in account create its own owner row, so a plain customer could walk
 * straight into beneficiary onboarding and register a payout destination in
 * Hallnect's Payouts account. No money could move — dispatch still requires an
 * accepted booking on an approved hall — but the third-party account is real,
 * the admin conflict alerts are real, and someone who knows a venue's account
 * number and IFSC could pre-claim it so the genuine owner is refused.
 *
 * Returns the role so the caller can shape its own error type.
 */
async function getApprovedOwner() {
  const { supabase, user } = await getAuthUser();
  if (!user) return { supabase, user: null, denied: "Not authenticated" };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: profileRow } = await (supabase as any)
    .from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profileRow?.role !== "owner_approved") {
    return {
      supabase,
      user: null,
      denied: "Your owner account is awaiting admin approval before you can set up payouts.",
    };
  }
  return { supabase, user, denied: null };
}

// ── Upsert owner business profile row ────────────────────────────────────────
// Security:
//   • hall_owners_insert WITH CHECK: profile_id = auth.uid(), is_verified = false
//   • hall_owners_update USING: profile_id = auth.uid()
//   • prevent_owner_self_verify trigger blocks is_verified changes

export async function upsertOwnerRow(data: {
  businessName:  string;
  businessEmail: string;
  gstNumber:     string;
  address:       string;
  city:          string;
  state:         string;
}): Promise<ActionResult> {
  const { supabase, user } = await getAuthUser();
  if (!user) return { error: "Not authenticated" };

  const parsed = parseSafe(ownerBusinessSchema, data);
  if (!parsed.ok) return { error: parsed.error };
  const v = parsed.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Check if row already exists
  const { data: existing } = await db
    .from("hall_owners")
    .select("id")
    .eq("profile_id", user.id)
    .maybeSingle();

  const payload = {
    profile_id:     user.id,
    business_name:  v.businessName,
    business_email: v.businessEmail || null,
    gst_number:     v.gstNumber     || null,
    address:        v.address       || null,
    city:           v.city          || null,
    // The seller's business address is published under Rule 5(3)(a), so it gets
    // the same one-spelling treatment as the venue's.
    state:          canonicalStateForStorage(v.state),
    // business_phone, pan_number, payout_account_number, payout_ifsc and
    // payout_upi are DELIBERATELY ABSENT. They belong to savePayoutDetails
    // now. They were written here as "value || null", so once the Business
    // Details form stopped rendering them, saving this form would have wiped a
    // payout account the owner had already set up — silently, and only
    // noticeable when a booking failed to pay out.
  };

  if (existing) {
    // profile_id is EXCLUDED from the update on purpose. It is the ownership
    // link, it never changes on a profile save, and migration 0046 revoked the
    // client's table-wide UPDATE in favour of an enumerated column grant that
    // deliberately omits it — so writing it here would fail the whole save on
    // a permission error rather than quietly doing nothing.
    const { profile_id: _ownerLink, ...editable } = payload;
    void _ownerLink;
    const { error } = await db
      .from("hall_owners")
      .update(editable)
      .eq("id", existing.id);
    if (error) return { error: sanitizeError(error, "owner") };
  } else {
    const { error } = await db.from("hall_owners").insert(payload);
    if (error) return { error: sanitizeError(error, "owner") };
  }

  revalidatePath("/owner/profile");
  revalidatePath("/owner/dashboard");
  return { success: true };
}

// ── Update profile display name + phone ──────────────────────────────────────
// RLS profiles_update WITH CHECK: only own row, role column is locked by trigger.

export async function updateOwnerProfileName(data: {
  fullName: string;
  phone:    string;
  notificationsEnabled?: boolean;
}): Promise<ActionResult> {
  const { supabase, user } = await getAuthUser();
  if (!user) return { error: "Not authenticated" };

  const parsed = parseSafe(profileUpdateSchema, data);
  if (!parsed.ok) return { error: parsed.error };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // NORMALISE before storing, exactly as the customer profile does: SMS
  // needs E.164, and a profile phone stored in some other shape is a number we
  // can never message.
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

  // Changing the number invalidates its OTP verification — same reasoning as
  // the customer profile: a verified flag must never vouch for a number the
  // account holder did not prove they own.
  const { data: existing } = await db
    .from("profiles").select("phone, phone_verified").eq("id", user.id).maybeSingle();
  if (existing?.phone_verified && existing.phone !== normalisedPhone) {
    updatePayload.phone_verified = false;
    updatePayload.phone_verified_at = null;
  }

  // Non-critical preference only — critical booking/payment messages always send.
  if (typeof data.notificationsEnabled === "boolean") {
    updatePayload.notifications_enabled = data.notificationsEnabled;
  }

  let { error } = await db
    .from("profiles")
    .update(updatePayload)
    .eq("id", user.id);

  // Unknown column (pre-0026): PostgREST reports it as PGRST204, Postgres as
  // 42703 — retry without it.
  if ((error?.code === "42703" || error?.code === "PGRST204") && "notifications_enabled" in updatePayload) {
    delete updatePayload.notifications_enabled;
    ({ error } = await db.from("profiles").update(updatePayload).eq("id", user.id));
  }

  if (error) return { error: sanitizeError(error, "owner") };
  revalidatePath("/owner/profile");
  return { success: true };
}

// ── Create hall ───────────────────────────────────────────────────────────────
// Security:
//   • halls_insert WITH CHECK: is_owner_approved() + owns_owner_row(owner_id) +
//     status = 'pending_approval'
//   • prevent_hall_self_approve trigger: owner cannot set approved/rejected/suspended

export async function createHall(data: {
  ownerId:      string; // hall_owners.id
  name:         string;
  city:         string;
  state:        string;
  address:      string;
  pincode:      string;
  capacityMin:  string;
  capacityMax:  string;
  pricePerDay:  string;
  priceMorning: string;
  priceEvening: string;
  description:  string;
  amenityIds:   string[];
  venueTypes:   string[];
  customAmenities?: string[];
  /** One of HALL_COMMISSION_RATES. Required — hallCreateSchema rejects anything
   *  else, and the halls_commission_rate_allowed CHECK rejects it again. */
  commissionRate: number | string;
  /** DIRECT_BOOKING (the default when absent) or LEAD_GENERATION. */
  bookingMode?: string;
  /** A Google Maps link (or plain "lat, lng") for the venue's pin.
   *  Omit the key entirely to leave the saved pin alone; pass "" to clear it.
   *  Resolved and bounds-checked SERVER-SIDE — the client sends a string, never
   *  a coordinate. */
  mapLink?: string;
}): Promise<ActionResult> {
  const { supabase, user } = await getAuthUser();
  if (!user) return { error: "Not authenticated" };

  const parsed = parseSafe(hallCreateSchema, data);
  if (!parsed.ok) return { error: parsed.error };
  const v = parsed.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // ── Derive the owner SERVER-SIDE; never trust the client's ownerId ──────────
  // The form carries an ownerId, but a stale/cached page (or a tampered
  // payload) can supply one that isn't this user's. halls_insert WITH CHECK
  // then fails owns_owner_row() and Postgres returns a bare 42501 that tells
  // the owner nothing. Resolve the real row here and use it as the source of
  // truth, so the insert can only ever target the caller's own owner record.
  const { data: ownerRow, error: ownerErr } = await db
    .from("hall_owners")
    .select("id")
    .eq("profile_id", user.id)
    .maybeSingle();

  if (ownerErr) return { error: sanitizeError(ownerErr, "owner") };
  if (!ownerRow?.id) {
    return { error: "Complete your business profile before adding a hall." };
  }

  // Role gate mirrored in the app layer so the failure is explainable. RLS
  // (is_owner_approved) remains the authority — this only produces a better
  // message than a raw constraint violation.
  const { data: profileRow } = await db
    .from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profileRow?.role !== "owner_approved") {
    return { error: "Your owner account is awaiting admin approval before you can list a hall." };
  }

  const ownerId: string = ownerRow.id;

  // Slug uniqueness.
  //
  // halls.slug carries a GLOBAL unique index, but this probe reads `halls`
  // through the session client, so halls_select hides other owners' halls
  // unless they are approved. A collision with another owner's draft/pending
  // hall is therefore INVISIBLE here: the probe finds nothing, the insert trips
  // halls_slug_key with 23505, and because generateSlug is deterministic every
  // retry fails identically — permanently blocking that owner from listing.
  //
  // So the probe is only an optimisation; the unique index is the authority.
  // We retry with a fresh suffix when the DB reports a genuine collision.
  const baseSlug = generateSlug(v.name, v.city);
  const { data: existing } = await db
    .from("halls").select("id").eq("slug", baseSlug).maybeSingle();
  let slug = existing ? `${baseSlug}-${randomSuffix()}` : baseSlug;

  // ── Map pin ─────────────────────────────────────────────────────────────────
  // Resolved BEFORE anything is written, so a link that cannot be read fails
  // the save with a sentence the owner can act on rather than quietly storing
  // no pin. A short share link costs one outbound HEAD whose redirect is READ,
  // never followed — see lib/geo.ts.
  //
  // undefined means "this form did not carry the field" and must not touch the
  // columns; "" means the owner deliberately cleared the pin.
  let pin: { latitude: number; longitude: number } | null = null;
  if (data.mapLink !== undefined) {
    const located = await resolveMapInput(data.mapLink);
    if (located.kind === "error") return { error: located.message };
    pin = located.kind === "coords" ? located.value : null;
  }
  // Both columns or neither, always — they are derived from ONE input, so a
  // half-set pair is not reachable. venueJsonLd requires both before it emits a
  // GeoCoordinates node.
  const pinColumns = data.mapLink === undefined
    ? {}
    : { latitude: pin?.latitude ?? null, longitude: pin?.longitude ?? null };

  const buildPayload = (useSlug: string) => ({
    owner_id:     ownerId, // server-derived, not v.ownerId
    name:         v.name,
    slug:         useSlug,
    description:  v.description || null,
    city:         v.city,
    state:        canonicalStateForStorage(v.state),
    address:      v.address || null,
    pincode:      v.pincode || null,
    capacity_min: v.capacityMin ?? null,
    capacity_max: v.capacityMax,
    // NULLABLE SINCE MIGRATION 0073, but only for a lead venue —
    // halls_direct_booking_needs_price refuses a null on a direct-booking hall
    // and hallSchema refuses it a layer earlier with a sentence the owner can
    // act on.
    price_per_day:  v.pricePerDay ?? null,
    price_morning:  v.priceMorning ?? null,
    price_evening:  v.priceEvening ?? null,
    venue_types:    v.venueTypes,
    booking_mode:   v.bookingMode,
    // The owner's own commercial term. Taken from the PARSED value, so the
    // eight-value bound has already been applied — the raw form string never
    // reaches the database. The halls_commission_rate_allowed CHECK is the
    // second line of defence for a request that never touched this action.
    commission_rate: v.commissionRate,
    ...pinColumns,
    status: "pending_approval",
  });

  let hall: { id: string } | null = null;
  let error: { code?: string; message?: string } | null = null;

  // At most 4 attempts: the first, plus 3 fresh suffixes. Bounded so a
  // persistent failure surfaces instead of looping.
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await db.from("halls").insert(buildPayload(slug)).select("id").single();
    if (!res.error) { hall = res.data; error = null; break; }
    error = res.error;
    if (res.error.code !== "23505") break;      // not a uniqueness problem
    slug = `${baseSlug}-${randomSuffix()}`;     // collided (possibly invisibly)
  }

  if (error || !hall) {
    return { error: error ? sanitizeError(error, "owner") : "Could not create your hall. Please try again." };
  }

  // Insert amenities junction rows. The failure is logged rather than
  // returned: the hall itself already exists, and failing the whole action
  // here would tell the owner their listing was not created when it was. It
  // must not be SILENT though — dropping every amenity without a trace makes a
  // venue look bare and gives nobody a reason to look.
  if (v.amenityIds.length > 0) {
    const { error: amenityErr } = await db.from("hall_amenities").insert(
      v.amenityIds.map((amenityId) => ({ hall_id: hall.id, amenity_id: amenityId })),
    );
    if (amenityErr) {
      console.error(`[createHall] amenities not saved for hall ${hall.id}:`, amenityErr.message);
    }
  }

  const customParsed = parseSafe(customAmenityListSchema, data.customAmenities ?? []);
  if (!customParsed.ok) return { error: customParsed.error };
  const customErr = await syncCustomAmenities(db, hall.id, customParsed.data);
  if (customErr) return { error: customErr };

  // New halls are created straight into pending_approval — alert the admin.
  await notifyHallSubmitted(hall.id);

  revalidatePath("/owner/halls");
  revalidatePath("/owner/dashboard");
  // Return the id rather than redirecting: the Add Hall form uploads the
  // owner's selected photos against this real hall id before navigating, so the
  // whole submission (details + amenities + photos) lands in one action for the
  // owner. Redirecting here would abort that with a NEXT_REDIRECT throw.
  return { success: true, id: hall.id };
}

// ── Update hall ───────────────────────────────────────────────────────────────
// Security: RLS halls_update USING: owns_hall(id)
// DB trigger prevent_hall_self_approve blocks approved/rejected/suspended transitions.

export async function updateHall(hallId: string, data: {
  name:         string;
  city:         string;
  state:        string;
  address:      string;
  pincode:      string;
  capacityMin:  string;
  capacityMax:  string;
  pricePerDay:  string;
  priceMorning: string;
  priceEvening: string;
  description:  string;
  amenityIds:   string[];
  venueTypes:   string[];
  customAmenities?: string[];
  /** Optional here, unlike on create. Omit it and the hall keeps the rate it
   *  has; supply a different one and it is changed, audited, and applied to
   *  FUTURE bookings only — existing bookings carry their own snapshot. */
  commissionRate?: number | string;
  /** DIRECT_BOOKING or LEAD_GENERATION. Absent means DIRECT_BOOKING, which is
   *  what every caller written before lead generation meant. */
  bookingMode?: string;
  /** A Google Maps link (or plain "lat, lng") for the venue's pin.
   *  Omit the key entirely to leave the saved pin alone; pass "" to clear it.
   *  Resolved and bounds-checked SERVER-SIDE — the client sends a string, never
   *  a coordinate. */
  mapLink?: string;
}): Promise<ActionResult> {
  const { supabase, user } = await getAuthUser();
  if (!user) return { error: "Not authenticated" };

  const idOk = parseSafe(uuidSchema, hallId);
  if (!idOk.ok) return { error: "Invalid hall id." };

  const parsed = parseSafe(hallSchema, data);
  if (!parsed.ok) return { error: parsed.error };
  const v = parsed.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Snapshot BEFORE the write, so a material change to an already-approved
  // listing can be reported. Approval is a one-time gate: without this, a hall
  // approved as one venue could go on serving customers as another.
  const { data: before } = await db
    .from("halls")
    .select("status, name, city, address, capacity_max, price_per_day, venue_types, booking_mode")
    .eq("id", hallId)
    .maybeSingle();

  // NOTE ON commission_rate: it is deliberately absent from the select above.
  // Migration 0072 hides the column from anon and authenticated, so asking for
  // it on the session client would fail the whole read and take the rest of the
  // edit down with it. The prior value is not needed here either — the write
  // below goes through setHallCommissionRate, which returns `previous` and
  // `changed` from inside the service-role transaction. Reading it separately
  // up front was a second round-trip whose answer was then thrown away, and
  // could disagree with the value the write actually replaced.

  // ── Map pin ─────────────────────────────────────────────────────────────────
  // Resolved BEFORE anything is written, so a link that cannot be read fails
  // the save with a sentence the owner can act on rather than quietly storing
  // no pin. A short share link costs one outbound HEAD whose redirect is READ,
  // never followed — see lib/geo.ts.
  //
  // undefined means "this form did not carry the field" and must not touch the
  // columns; "" means the owner deliberately cleared the pin.
  let pin: { latitude: number; longitude: number } | null = null;
  if (data.mapLink !== undefined) {
    const located = await resolveMapInput(data.mapLink);
    if (located.kind === "error") return { error: located.message };
    pin = located.kind === "coords" ? located.value : null;
  }
  // Both columns or neither, always — they come from ONE input, so a half-set
  // pair is not reachable. venueJsonLd requires both before it emits a
  // GeoCoordinates node, and a lone latitude would be silently ignored forever.
  const pinColumns = data.mapLink === undefined
    ? {}
    : { latitude: pin?.latitude ?? null, longitude: pin?.longitude ?? null };

  const { error, count } = await db
    .from("halls")
    .update({
      name:         v.name,
      description:  v.description || null,
      city:         v.city,
      // ONE SPELLING AT REST. The live catalogue held "Tamilnadu"; the
      // JSON-LD normalised it on the way out while the column kept the
      // variant, so the page, the structured data and the database
      // disagreed. Normalised here, where it is written.
      state:        canonicalStateForStorage(v.state),
      address:      v.address || null,
      pincode:      v.pincode || null,
      capacity_min: v.capacityMin ?? null,
      capacity_max: v.capacityMax,
      price_per_day:  v.pricePerDay ?? null,
      price_morning:  v.priceMorning ?? null,
      price_evening:  v.priceEvening ?? null,
      venue_types:    v.venueTypes,
      // Written through the SESSION client, unlike the commission rate below.
      // The mode is not a money column: it changes how the venue is presented
      // and which flow a customer enters, so 0073 adds it to 0046's named
      // UPDATE grant rather than routing it through the service role.
      booking_mode:   v.bookingMode,
      // 0089 added latitude and longitude to that same named grant, for the
      // same reason: a map pin says WHERE the venue is, alongside address,
      // city, state and pincode — it is not money, placement or moderation.
      ...pinColumns,
    }, { count: "exact" })
    .eq("id", hallId);

  if (error) return { error: sanitizeError(error, "owner") };
  // RLS filters a hall that is not this owner's to zero rows without raising,
  // so an unguarded version reported a successful save that never happened.
  if ((count ?? 0) === 0) {
    return { error: "This hall could not be updated (it may not be yours)." };
  }

  // ── Commission rate ─────────────────────────────────────────────────────────
  // Written only AFTER the update above returned a non-zero count. That count is
  // the ownership proof: it came back through the session client, so RLS decided
  // this hall is theirs. The write itself must then use the service role,
  // because 0046's column-scoped UPDATE grant deliberately excludes money
  // columns from what an owner may PATCH — which is also why an owner cannot
  // change this value by talking to PostgREST directly and skipping the audit
  // row below.
  //
  // Failure here does NOT fail the edit: the rest of the listing is already
  // saved, and reporting a total failure would send the owner back to re-enter
  // work that was persisted. It is reported instead.
  if (data.commissionRate !== undefined && data.commissionRate !== "") {
    const rateParsed = parseSafe(commissionRateSchema, data.commissionRate);
    if (!rateParsed.ok) return { error: rateParsed.error };

    const res = await setHallCommissionRate(hallId, rateParsed.data);
    if (!res.ok) return { error: res.error };

    if (res.changed) {
      // Money changed hands differently from this moment on, so it is recorded
      // against the person who did it. Existing bookings are untouched — each
      // carries its own commission_rate snapshot taken at creation.
      await recordOwnerAction({
        action:         "hall.commission_changed",
        entityType:     "hall",
        entityId:       hallId,
        previousStatus: res.previous == null ? "not configured" : `${res.previous}%`,
        newStatus:      `${rateParsed.data}%`,
        reason:
          `Hallnect commission changed from ` +
          `${res.previous == null ? "not configured" : `${res.previous}%`} to ` +
          `${rateParsed.data}% by the hall owner. Applies to future bookings only; ` +
          `existing bookings keep the rate they were made at.`,
        metadata: { previous: res.previous, next: rateParsed.data, changedBy: "owner" },
      });
    }
  }

  // Sync amenities: delete existing, re-insert selected
  // DELETE-THEN-INSERT, with both halves checked. Neither error was inspected
  // before: if the re-insert failed the owner's entire amenity list was wiped
  // and the action still reported success, so the venue silently lost every
  // feature couples filter on. There is no transaction available through
  // PostgREST, so the recovery is to report the loss loudly rather than
  // pretend the edit worked.
  const { error: delErr } = await db.from("hall_amenities").delete().eq("hall_id", hallId);
  if (delErr) return { error: sanitizeError(delErr, "owner") };

  if (v.amenityIds.length > 0) {
    const { error: insErr } = await db.from("hall_amenities").insert(
      v.amenityIds.map((amenityId) => ({ hall_id: hallId, amenity_id: amenityId })),
    );
    if (insErr) {
      console.error(`[updateHall] amenities lost for hall ${hallId}:`, insErr.message);
      return {
        error: "Your details were saved, but the amenities could not be updated — please set them again.",
      };
    }
  }

  const customParsed = parseSafe(customAmenityListSchema, data.customAmenities ?? []);
  if (!customParsed.ok) return { error: customParsed.error };
  const customErr = await syncCustomAmenities(db, hallId, customParsed.data);
  if (customErr) return { error: customErr };

  // Tell the admin when a LIVE listing's material details move. Fired after the
  // write succeeded, so a rejected edit never raises a false alarm.
  if (before?.status === "approved") {
    const changed: string[] = [];
    if (before.name !== v.name) changed.push("name");
    if (before.city !== v.city) changed.push("city");
    if ((before.address ?? null) !== (v.address || null)) changed.push("address");
    if (Number(before.capacity_max) !== Number(v.capacityMax)) changed.push("capacity");
    if (Number(before.price_per_day ?? 0) !== Number(v.pricePerDay ?? 0)) changed.push("price");
    if ((before.booking_mode ?? "DIRECT_BOOKING") !== v.bookingMode) changed.push("booking mode");
    const beforeTypes = [...(before.venue_types ?? [])].sort().join(",");
    if (beforeTypes !== [...v.venueTypes].sort().join(",")) changed.push("venue types");

    if (changed.length > 0) await notifyHallEdited(hallId, changed);
  }

  revalidatePath(`/owner/halls/${hallId}/edit`);
  revalidatePath("/owner/halls");
  // updateHall can change the name, price or photos of an APPROVED hall, which
  // is what the cached public pages show. Without this the listing page would
  // keep serving the old price for up to five minutes.
  revalidatePath("/");
  revalidatePath("/halls");
  revalidatePath("/wedding-halls/[city]", "layout");
  // NOT the venue page: its route is /halls/[slug], not the id, and it is still
  // rendered dynamically because owner/admin preview of an unapproved hall
  // depends on the caller's session.
  return { success: true };
}


// ── Custom amenities sync (owner-defined, per hall) ───────────────────────────
//
// SECURITY: callers MUST have already verified that `hallId` belongs to the
// authenticated owner. RLS (hall_custom_amenities_write → owns_hall) is the
// authority; this helper only shapes the data.
//
// Behaviour: full reconcile against the submitted list — rows the owner removed
// are deleted, new ones inserted, untouched ones left alone (so an unrelated
// hall edit never drops existing custom amenities).
async function syncCustomAmenities(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  hallId: string,
  names: string[],
): Promise<string | null> {
  // De-duplicate within the submission itself (case/whitespace-insensitive),
  // mirroring the uq_hca_hall_name index.
  const seen = new Map<string, string>();
  for (const raw of names) {
    const clean = normalizeAmenityName(raw);
    if (clean) seen.set(clean.toLowerCase(), clean);
  }

  // Reject anything that duplicates a STANDARD amenity — the owner should tick
  // the catalogue entry instead of inventing a second "Parking".
  const { data: standard } = await db.from("amenities").select("name");
  const standardKeys = new Set(
    ((standard ?? []) as { name: string }[]).map((a) => a.name.trim().toLowerCase()),
  );
  for (const [key, label] of seen) {
    if (standardKeys.has(key)) {
      return `"${label}" is already a standard amenity — select it above instead.`;
    }
  }

  const wanted = [...seen.values()];
  if (wanted.length > CUSTOM_AMENITY_LIMITS.maxPerHall) {
    return `You can add up to ${CUSTOM_AMENITY_LIMITS.maxPerHall} custom amenities.`;
  }

  const { data: existing } = await db
    .from("hall_custom_amenities").select("id, name").eq("hall_id", hallId);
  const existingRows = (existing ?? []) as { id: string; name: string }[];
  const existingKeys = new Map(existingRows.map((r) => [r.name.trim().toLowerCase(), r]));
  const wantedKeys   = new Set(wanted.map((n) => n.toLowerCase()));

  const toDelete = existingRows.filter((r) => !wantedKeys.has(r.name.trim().toLowerCase()));
  if (toDelete.length > 0) {
    const { error } = await db
      .from("hall_custom_amenities").delete().in("id", toDelete.map((r) => r.id));
    if (error) return sanitizeError(error, "owner");
  }

  const toInsert = wanted
    .map((name, i) => ({ name, i }))
    .filter(({ name }) => !existingKeys.has(name.toLowerCase()))
    .map(({ name, i }) => ({ hall_id: hallId, name, sort_order: i }));
  if (toInsert.length > 0) {
    const { error } = await db.from("hall_custom_amenities").insert(toInsert);
    if (error) return sanitizeError(error, "owner");
  }

  return null;
}

// ── Submit hall for approval ──────────────────────────────────────────────────
// Owner may move draft → pending_approval. Trigger blocks owner→approved.

export async function submitHallForApproval(hallId: string): Promise<ActionResult> {
  const { supabase, user } = await getAuthUser();
  if (!user) return { error: "Not authenticated" };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Only a hall the owner is genuinely allowed to (re)submit may enter the queue.
  // Without a source-status guard an owner could resurrect a hall an admin had
  // SUSPENDED (or one already approved) straight back into pending_approval —
  // prevent_hall_self_approve only blocks approved/rejected/suspended as the NEW
  // value, so suspended -> pending_approval would otherwise be permitted.
  const SUBMITTABLE = ["draft", "rejected", "pending_approval"];
  const { data: current } = await db
    .from("halls").select("status").eq("id", hallId).maybeSingle();

  if (!current) return { error: "Hall not found." };
  if (current.status === "suspended") {
    return { error: "This hall has been suspended by Hallnect. Contact support to restore it." };
  }
  if (!SUBMITTABLE.includes(current.status)) {
    return { error: "This hall cannot be submitted for review from its current status." };
  }

  const { error, count } = await db
    .from("halls")
    .update({ status: "pending_approval" }, { count: "exact" })
    .eq("id", hallId);

  if (error) return { error: sanitizeError(error, "owner") };
  // An RLS-filtered UPDATE affects 0 rows WITHOUT raising, so `if (error)` alone
  // would report a success that never happened.
  if (count === 0) return { error: "You do not have permission to submit this hall." };

  // Admin alert (max once/day per hall — resubmits after fixes still notify).
  await notifyHallSubmitted(hallId);
  revalidatePath(`/owner/halls/${hallId}/edit`);
  revalidatePath("/owner/halls");
  return { success: true };
}

// ── Hall images ───────────────────────────────────────────────────────────────
// Security: RLS hall_images_write USING: owns_hall(hall_id)
// Storage RLS: owns_hall() from the hall_id folder prefix (0010).

export async function addHallImage(data: {
  hallId:      string;
  url:         string;
  storagePath: string;
  isCover:     boolean;
  altText:     string;
}): Promise<ActionResult> {
  const { supabase, user } = await getAuthUser();
  if (!user) return { error: "Not authenticated" };

  const parsed = parseSafe(addHallImageSchema, data);
  if (!parsed.ok) return { error: parsed.error };
  const v = parsed.data;

  // Storage path must start with hallId/ so a malicious client can't overwrite
  // another hall's images. Storage RLS also enforces this — defense in depth.
  if (!v.storagePath.startsWith(`${v.hallId}/`)) {
    return { error: "Storage path does not match hall." };
  }

  // THE URL IS DERIVED, NOT ACCEPTED. `v.url` arrives from the client and was
  // stored verbatim while only the PATH was checked, so an owner could upload a
  // real photo to their own folder and register any http(s) address as the
  // picture. Today the CSP's img-src stops such a URL actually rendering, which
  // is the only reason this was not worse than broken images — but hall_images
  // .url is also read by the sitemap and the structured-data feed, and a
  // control in a different layer is not a reason to store a value we know is
  // wrong. Computing it removes the mismatch instead of policing it: there is
  // now one client-controlled field, already constrained to `<hallId>/`.
  const derivedUrl = publicUrlForStoragePath(v.storagePath);
  if (!derivedUrl) {
    return { error: "Image storage is not configured. Please try again shortly." };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // PER-HALL CAP. There was none: an owner (or a script with their session)
  // could attach unbounded images to one hall, filling the storage bucket,
  // slowing every listing query that joins hall_images, and making the gallery
  // unusable. Counted server-side because the client cannot be trusted to.
  const { count: existingImages, error: countErr } = await db
    .from("hall_images")
    .select("id", { count: "exact", head: true })
    .eq("hall_id", v.hallId);
  if (countErr) return { error: sanitizeError(countErr, "owner") };
  if ((existingImages ?? 0) >= MAX_IMAGES_PER_HALL) {
    return {
      error: `A hall can have up to ${MAX_IMAGES_PER_HALL} photos. Delete one before adding another.`,
    };
  }

  if (v.isCover) {
    await db
      .from("hall_images")
      .update({ is_cover: false })
      .eq("hall_id", v.hallId)
      .eq("is_cover", true);
  }

  const { error } = await db.from("hall_images").insert({
    hall_id:      v.hallId,
    url:          derivedUrl,
    storage_path: v.storagePath,
    alt_text:     v.altText || null,
    is_cover:     v.isCover,
    sort_order:   0,
  });

  if (error) return { error: sanitizeError(error, "owner") };
  revalidatePath(`/owner/halls/${v.hallId}/images`);
  return { success: true };
}

export async function setCoverImage(hallId: string, imageId: string): Promise<ActionResult> {
  const { supabase, user } = await getAuthUser();
  if (!user) return { error: "Not authenticated" };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // CONFIRM THE PAIR FIRST, the way deleteHallImage does. The old code matched
  // the second update on image id ALONE: an id belonging to a different hall
  // would clear this hall's cover and set the other hall's, and because
  // uq_hall_images_one_cover permits one cover per hall, that second write
  // could then fail outright — leaving the owner with a raw duplicate-key
  // message and a hall whose cover had just been removed.
  const { data: image, error: readErr } = await db
    .from("hall_images")
    .select("id")
    .eq("id", imageId)
    .eq("hall_id", hallId)
    .maybeSingle();
  if (readErr) return { error: sanitizeError(readErr, "owner") };
  if (!image) return { error: "Image not found." };

  // Clear the current cover before setting the new one — the unique index
  // allows only one per hall. Errors are checked: an unchecked failure here is
  // what turns the next statement into a constraint violation.
  const { error: clearErr } = await db
    .from("hall_images")
    .update({ is_cover: false })
    .eq("hall_id", hallId)
    .eq("is_cover", true);
  if (clearErr) return { error: sanitizeError(clearErr, "owner") };

  // count: RLS filters a write the caller may not make to ZERO ROWS WITHOUT AN
  // ERROR. Returning success there would tell the owner their cover changed
  // when nothing did.
  const { error, count } = await db
    .from("hall_images")
    .update({ is_cover: true }, { count: "exact" })
    .eq("id", imageId)
    .eq("hall_id", hallId);
  if (error) return { error: sanitizeError(error, "owner") };
  if ((count ?? 0) === 0) return { error: "Could not set that photo as the cover." };

  revalidatePath(`/owner/halls/${hallId}/images`);
  revalidatePath(`/owner/halls/${hallId}/edit`);
  return { success: true };
}

/**
 * Sets the description an owner writes for one photo.
 *
 * There was no UPDATE path for alt_text at all: addHallImage accepts it on
 * insert and both callers hardcode "", so every hall_images row in production
 * had alt_text null and every alt string on a venue page was generated. A
 * generated description is honest and distinct, but it cannot say what is
 * actually in the photo.
 */
export async function updateHallImageAlt(data: {
  hallId:  string;
  imageId: string;
  altText: string;
}): Promise<ActionResult> {
  const { supabase, user } = await getAuthUser();
  if (!user) return { error: "Not authenticated" };

  const parsed = parseSafe(updateHallImageAltSchema, data);
  if (!parsed.ok) return { error: parsed.error };
  const v = parsed.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // CONFIRM THE PAIR FIRST, the way setCoverImage and deleteHallImage do. RLS
  // already restricts this to halls the caller owns; this pins the image to the
  // hall named in the request.
  const { data: image, error: readErr } = await db
    .from("hall_images")
    .select("id")
    .eq("id", v.imageId)
    .eq("hall_id", v.hallId)
    .maybeSingle();
  if (readErr) return { error: sanitizeError(readErr, "owner") };
  if (!image) return { error: "Image not found." };

  // EMPTY MEANS ABSENT, so store null. Writing "" would record a description
  // the owner never wrote, and "" in an HTML alt attribute means "decorative" —
  // the opposite of what a venue photo is. null lets venueImageAlt generate one.
  const { error, count } = await db
    .from("hall_images")
    .update({ alt_text: v.altText || null }, { count: "exact" })
    .eq("id", v.imageId)
    .eq("hall_id", v.hallId);
  if (error) return { error: sanitizeError(error, "owner") };
  // An RLS-filtered UPDATE affects zero rows WITHOUT raising. Reporting success
  // there would tell the owner their description saved when nothing did.
  if ((count ?? 0) === 0) return { error: "Could not save that description." };

  revalidatePath(`/owner/halls/${v.hallId}/images`);
  return { success: true };
}

export async function deleteHallImage(hallId: string, imageId: string): Promise<ActionResult> {
  const { supabase, user } = await getAuthUser();
  if (!user) return { error: "Not authenticated" };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Read the row FIRST so we know which storage object to remove, and so the
  // image is confirmed to belong to the hall named in the request (RLS already
  // restricts this to halls the caller owns; this pins the pair as well).
  const { data: image, error: readErr } = await db
    .from("hall_images")
    .select("id, hall_id, storage_path, is_cover")
    .eq("id", imageId)
    .eq("hall_id", hallId)
    .maybeSingle();

  if (readErr) return { error: sanitizeError(readErr, "owner") };
  if (!image) return { error: "Image not found." };

  const { error } = await db.from("hall_images").delete().eq("id", imageId);
  if (error) return { error: sanitizeError(error, "owner") };

  // Deleting the COVER used to leave the hall with none, and a hall with no
  // cover renders as a plain gradient in every listing — the owner's venue
  // quietly becomes the least appealing card on the page. Promote the next
  // remaining photo instead. Non-fatal: the delete the owner asked for has
  // already succeeded.
  if (image.is_cover) {
    const { data: next } = await db
      .from("hall_images")
      .select("id")
      .eq("hall_id", hallId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (next?.id) {
      const { error: promoteErr } = await db
        .from("hall_images").update({ is_cover: true }).eq("id", next.id);
      if (promoteErr) {
        console.error("[deleteHallImage] could not promote a new cover:", promoteErr.message);
      }
    }
  }

  // Remove the underlying storage object so deleting an image doesn't leave an
  // orphaned file in the bucket. Partial failure is deliberately non-fatal: the
  // DB row (the thing users see) is already gone, so we log for cleanup rather
  // than surfacing an error for a delete the owner perceives as successful.
  if (image.storage_path) {
    const { error: storageErr } = await supabase.storage
      .from("hall-images")
      .remove([image.storage_path]);
    if (storageErr) {
      console.error("[deleteHallImage] orphaned storage object", image.storage_path, storageErr.message);
    }
  }

  revalidatePath(`/owner/halls/${hallId}/images`);
  revalidatePath(`/owner/halls/${hallId}/edit`);
  return { success: true };
}

// ── Availability ──────────────────────────────────────────────────────────────
//
// setAvailability WAS HERE, and it is gone on purpose.
//
// It backed a grid where an owner hand-set every date's status and pressed a
// global Save. That asked them to maintain by hand an answer the database
// already held, and it had to spend thirty lines defending itself from its own
// UI — re-reading which rows the payment flow owned so a client could not post
// status='available' over a date a customer had paid for.
//
// The calendar is now DERIVED (lib/owner-calendar.ts) and the only write an
// owner makes is an offline booking, below. Migration 0063 revokes
// INSERT/UPDATE/DELETE on `availability` from anon and authenticated, so the
// defence is no longer a filter in application code that has to be right every
// time — the request is refused before it reaches a policy.

// ── Booking actions ───────────────────────────────────────────────────────────
// Security:
//   • RLS bookings_update USING: owns_hall(hall_id)
//   • DB trigger validate_booking_transition enforces:
//     booking_requested → owner_confirmed | owner_rejected
//     owner_confirmed   → completed

export async function acceptBooking(bookingId: string): Promise<ActionResult> {
  const { supabase, user } = await getAuthUser();
  if (!user) return { error: "Not authenticated" };
  if (!parseSafe(uuidSchema, bookingId).ok) return { error: "Invalid booking id." };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // THE 48-HOUR WINDOW IS REAL, so it has to close. The deadline was stamped
  // by a trigger and counted down on this very page, but nothing enforced it:
  // an owner could accept a request days late — one the customer had been told
  // would auto-expire, and whose refund may already be owed and paid.
  const { data: pending } = await db
    .from("bookings")
    .select("owner_response_due_at")
    .eq("id", bookingId)
    .maybeSingle();

  if (isOwnerResponseOverdue(pending?.owner_response_due_at)) {
    return {
      error:
        "The 48-hour window to respond to this booking has passed, so it can no longer be accepted. " +
        "The customer is being refunded and the dates have been released.",
    };
  }

  const { error, count } = await db
    .from("bookings")
    .update({ status: "owner_confirmed" }, { count: "exact" })
    .eq("id", bookingId)
    .eq("status", "booking_requested");

  if (error) return { error: sanitizeError(error, "owner") };
  // 0 rows = not this owner's booking (RLS) or not in a confirmable state.
  // Without this check we would report success — and message "confirmed!" —
  // for a change that never happened.
  if (count === 0) return { error: "This booking cannot be confirmed (it may have changed state)." };

  await notifyBookingEvent("booking.confirmed", bookingId);

  // AUTOMATIC OWNER PAYOUT. Accepting is the commitment, so this is the moment
  // the customer's advance is split: Hallnect retains its commission on that
  // advance and the remainder settles to the owner's Cashfree vendor balance. Deliberately
  // AFTER the status flip and non-fatal — a booking the owner accepted must
  // stay accepted even if payout plumbing is incomplete. Every outcome is
  // recorded on payments.split_status for admin visibility and retry.
  await payOwnerOnAcceptance(bookingId);

  revalidatePath("/owner/bookings");
  revalidatePath("/owner/dashboard");
  revalidatePath("/owner/revenue");
  revalidatePath("/owner/commissions");
  return { success: true };
}

export async function rejectBooking(bookingId: string, reason?: string): Promise<ActionResult> {
  const { supabase, user } = await getAuthUser();
  if (!user) return { error: "Not authenticated" };
  if (!parseSafe(uuidSchema, bookingId).ok) return { error: "Invalid booking id." };
  const cleanReason = reason ? reason.replace(/[<>]/g, "").trim().slice(0, 500) : "";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { error, count } = await db
    .from("bookings")
    .update({
      status:      "owner_rejected",
      owner_notes: cleanReason || "Booking declined by venue owner",
    }, { count: "exact" })
    .eq("id", bookingId)
    .eq("status", "booking_requested");

  if (error) return { error: sanitizeError(error, "owner") };
  if (count === 0) return { error: "This booking cannot be declined (it may have changed state)." };

  // Declining frees the dates for someone else.
  await releaseAvailabilityForBooking(bookingId);

  await notifyBookingEvent("booking.rejected", bookingId, { reason: cleanReason || null });

  // The venue declined, so the customer gets EVERYTHING back — advance and the
  // ₹200 platform fee alike, exactly as /refund-policy §5 promises. Recorded
  // idempotently; never fails the decline.
  // OrAlert — see the note in app/customer/actions.ts.
  const { refund } = await recordBookingRefundOrAlert(bookingId, "owner");
  if (refund && refund.refundAmount > 0) {
    await notifyBookingEvent("refund.initiated", bookingId, { amount: refund.refundAmount });
  }

  revalidatePath("/owner/bookings");
  revalidatePath("/owner/dashboard");
  return { success: true };
}

export async function markBookingCompleted(bookingId: string): Promise<ActionResult> {
  const { supabase, user } = await getAuthUser();
  if (!user) return { error: "Not authenticated" };
  if (!parseSafe(uuidSchema, bookingId).ok) return { error: "Invalid booking id." };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Scoped to the legal source state AND count-checked. RLS filters a booking
  // that is not this owner's to zero rows without raising, so the unguarded
  // version reported success for a booking the caller never touched — and the
  // .eq on status stops a cancelled or still-pending booking being marked
  // completed, which would make it look payable.
  const { error, count } = await db
    .from("bookings")
    .update({ status: "completed" }, { count: "exact" })
    .eq("id", bookingId)
    .eq("status", "owner_confirmed");

  if (error) return { error: sanitizeError(error, "owner") };
  if ((count ?? 0) === 0) {
    return { error: "This booking cannot be marked completed (it may not be confirmed, or not be yours)." };
  }
  revalidatePath("/owner/bookings");
  revalidatePath("/owner/revenue");
  return { success: true };
}

// ── Cashfree vendor onboarding (required before automatic payouts) ──────────
// An owner cannot be paid automatically until Cashfree has them as a KYC-cleared
// vendor. This registers/refreshes that record from the owner's own business
// details and stores the resulting status so the dashboard can show it honestly.

/**
 * Is this Cashfree error about the OWNER's own details, or about Hallnect's
 * account setup?
 *
 * It decides what the venue owner is shown. A message about their PAN or bank
 * account is theirs to act on and must be repeated verbatim. A message about
 * the Easy Split feature not being enabled is Hallnect's problem — showing an
 * owner "easy split is not enabled for this merchant" reads as though they
 * broke something, when in fact there is nothing they can do. The real text is
 * stored in vendor_last_error either way, so admins never lose it.
 */
function isOwnerActionableVendorError(error: string): boolean {
  const e = error.toLowerCase();
  return /pan|bank|ifsc|account number|account_number|phone|email|name|vpa|upi|kyc|business_type/.test(e);
}

/**
 * Re-reads the owner's payout account status from Cashfree.
 *
 * A beneficiary is often created INITIATED and becomes VERIFIED once Cashfree
 * validates the bank account, which happens later and without telling us. This
 * is a GET: checking a status should not resend identity documents, which is
 * what the old Easy Split refresh did by re-submitting PAN and bank details as
 * a PATCH just to read a value back.
 */
export async function refreshPayoutStatus(): Promise<ActionResult> {
  const { user, denied } = await getApprovedOwner();
  if (!user) return { error: denied ?? "Not authenticated" };

  // The owner row is resolved from the signed-in user, so the privileged read
  // and write below can only ever touch that one row.
  let adminDb;
  try { adminDb = getSupabaseAdminClient(); }
  catch { return { error: "Payout status is unavailable right now. Please try again shortly." }; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const privileged = adminDb as any;

  const { data: owner } = await privileged
    .from("hall_owners")
    .select("id, payout_account_number, payout_beneficiary_id")
    .eq("profile_id", user.id)
    .maybeSingle();

  if (!owner) return { error: "No owner profile found." };
  if (!owner.payout_account_number) {
    return { error: "No payout account is connected yet." };
  }
  // Details saved but never registered — a distinct state from "connected", and
  // the owner can fix it themselves by saving the form again. Without this the
  // refusal from refreshBeneficiary falls through the vendor-error filter below
  // and is reported as a provider outage, which is both wrong and unactionable.
  if (!owner.payout_beneficiary_id) {
    return { error: "Your bank details are saved but not registered yet. Save them again to finish setting up payouts." };
  }
  if (!isPayoutsConfigured()) {
    return { error: "Automatic payouts are not switched on yet. Hallnect will contact you when they are." };
  }

  const status = await refreshBeneficiary(owner.id);

  revalidatePath("/owner/profile");
  revalidatePath("/owner/revenue");

  if (!status.ok) {
    return {
      error: isOwnerActionableVendorError(status.error)
        ? status.error
        : "Could not reach our payment provider just now. Your account is unchanged — please try again shortly.",
    };
  }
  return { success: true };
}

// ── Premium / Pro plan purchase via Cashfree ────────────────────────────────
// The owner buys a listing plan through the same gateway customers use for
// booking advances. Before this, "upgrade" was a link to the contact form and
// money was collected out of band.
//
// SECURITY: this action passes only a hall id and a plan slug. The price is
// read server-side from the premium_plans catalogue, hall ownership is verified
// against the database, and a DB trigger independently rejects any mismatch.
// Nothing the browser sends can change what is charged or what is granted.

export type StartPlanPurchaseActionResult =
  | { success: true; paymentSessionId: string; orderId: string; amount: number; mode: "sandbox" | "production" }
  | { error: string };

export async function startPlanPurchaseAction(
  hallId: string,
  planSlug: string,
): Promise<StartPlanPurchaseActionResult> {
  const { supabase, user } = await getAuthUser();
  if (!user) return { error: "Please sign in to buy a plan." };
  if (!parseSafe(uuidSchema, hallId).ok) return { error: "Invalid hall." };
  if (planSlug !== "premium" && planSlug !== "pro") return { error: "Invalid plan." };

  if (!isCashfreeConfigured()) {
    return { error: "Online payments are temporarily unavailable. Please contact Hallnect support." };
  }

  // Contact details for the gateway receipt come from the authenticated
  // profile, never from the request.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: profile } = await (supabase as any)
    .from("profiles")
    .select("full_name, email, phone")
    .eq("id", user.id)
    .maybeSingle();

  const { startPlanPurchase } = await import("@/lib/plan-payments");
  const result = await startPlanPurchase({
    hallId,
    planSlug,
    ownerProfileId: user.id,
    ownerName:  profile?.full_name ?? "",
    ownerEmail: (user.email || profile?.email || "").trim(),
    ownerPhone: profile?.phone ?? null,
  });

  if (!result.ok) return { error: result.error };

  return {
    success: true,
    paymentSessionId: result.paymentSessionId,
    orderId: result.orderId,
    amount: result.amount,
    mode: result.mode,
  };
}

/**
 * Does this hall_owners row belong to the signed-in user?
 *
 * Read with the service-role client and compared explicitly, rather than
 * leaning on the caller's RLS view: these checks decide whether a plan order
 * may be acted on at all, and a policy or column-grant change elsewhere must
 * not be able to turn the gate into a no-op. Deliberately two plain reads with
 * no PostgREST embed — an embed whose FK hint stops resolving fails as "no
 * row", which here would lock every legitimate owner out of their own receipt.
 */
async function ownerRowBelongsToUser(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  ownerId: string | null | undefined,
  userId: string,
): Promise<boolean> {
  if (!ownerId) return false;
  const { data } = await db
    .from("hall_owners").select("profile_id").eq("id", ownerId).maybeSingle();
  return Boolean(data?.profile_id) && data.profile_id === userId;
}

/**
 * Server-verified status for a plan order. The owner's browser calls this after
 * returning from Cashfree — the URL's claim of success is never trusted.
 *
 * SIGNED IN IS NOT THE SAME AS ENTITLED. This used to check only that SOMEONE
 * was authenticated and that the id carried the HNP_ prefix, then hand the id
 * straight to verifyAndApplyPlanPurchase — which talks to Cashfree, activates
 * the listing and writes the purchase row. Any owner could therefore drive
 * another owner's order to completion (and read back its state) by pasting
 * their order id, over a flow that moves money. The row is resolved and its
 * owner confirmed FIRST, and an id that is not the caller's is indistinguish-
 * able from one that does not exist.
 */
export async function checkPlanPurchaseStatus(
  orderId: string,
): Promise<{ state: "paid" | "pending" | "failed" | "not_found" }> {
  const { user } = await getAuthUser();
  if (!user) return { state: "not_found" };
  if (!orderId || !orderId.startsWith("HNP_")) return { state: "not_found" };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adminDb = getSupabaseAdminClient() as any;
  const { data: purchase } = await adminDb
    .from("plan_purchases")
    .select("id, owner_id")
    .eq("cashfree_order_id", orderId)
    .maybeSingle();

  if (!purchase) return { state: "not_found" };
  if (!(await ownerRowBelongsToUser(adminDb, purchase.owner_id, user.id))) {
    return { state: "not_found" };
  }

  const { verifyAndApplyPlanPurchase } = await import("@/lib/plan-payments");
  const result = await verifyAndApplyPlanPurchase(orderId);

  revalidatePath("/owner/premium");
  revalidatePath("/owner/halls");
  revalidatePath("/owner/dashboard");

  return {
    state:
      result.state === "paid"      ? "paid"
      : result.state === "failed"    ? "failed"
      : result.state === "not_found" ? "not_found"
      : "pending",
  };
}

// ── Payout setup, in ONE step ───────────────────────────────────────────────
// Saves the four details Cashfree needs and registers the vendor in the same
// action.
//
// It used to take two, in opposite directions: the fields lived in the Business
// Details form BELOW the payout card, behind their own submit button, and the
// card's own button did not save anything — it scrolled down and focused the
// first input it found, which was always Business Name, never the missing
// field. An owner had to fill one form, save it, scroll back up, and press a
// different button.
//
// The details are saved BEFORE onboarding is attempted and are kept whatever
// happens next. The old connect action returned early when Easy Split was off,
// writing nothing at all, so the card looked identical no matter how many times
// it was pressed.

export type PayoutSetupResult =
  | { state: "verified" }
  | { state: "pending_kyc" }
  /** Saved, but Hallnect's own gateway onboarding is not finished yet. Nothing
   *  is required from the owner — this is our side, not theirs. */
  | { state: "saved_not_live" }
  | { state: "error"; error: string };

export async function savePayoutDetails(data: {
  accountHolder: string;
  accountNumber: string;
  ifsc:          string;
  pan:           string;
  phone:         string;
}): Promise<PayoutSetupResult> {
  // Role gate BEFORE anything else: this action ends in a real registration at
  // Cashfree. See getApprovedOwner.
  const { supabase, user, denied } = await getApprovedOwner();
  if (!user) return { state: "error", error: denied ?? "Not authenticated" };

  const parsed = parseSafe(payoutDetailsSchema, data);
  if (!parsed.ok) return { state: "error", error: parsed.error };
  const v = parsed.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: owner } = await db
    .from("hall_owners")
    .select("id, business_name, business_email")
    .eq("profile_id", user.id)
    .maybeSingle();

  if (!owner) {
    return {
      state: "error",
      error: "Add your business name in Business Details first — Cashfree registers the payout account against your business.",
    };
  }

  // 1. SAVE WITH THE SERVICE ROLE. Migration 0068 revoked `authenticated`
  //    UPDATE on the destination columns, and that revoke is the point: while a
  //    human eyeballed these fields they were merely untidy, but under Payouts
  //    they are the machine-readable destination of real money, so an account
  //    takeover would become a cash-out. Ownership is established first — the
  //    owner row was resolved by profile_id = the signed-in user — and only
  //    then does the privileged write happen, on that row alone.
  let adminDb;
  try {
    adminDb = getSupabaseAdminClient();
  } catch {
    return { state: "error", error: "Payout setup is unavailable right now. Please try again shortly." };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const privileged = adminDb as any;

  const { error: saveErr, count } = await privileged
    .from("hall_owners")
    .update(
      {
        payout_account_holder: v.accountHolder,
        payout_account_number: v.accountNumber,
        payout_ifsc:           v.ifsc,
        pan_number:            v.pan,
        business_phone:        v.phone,
      },
      { count: "exact" },
    )
    .eq("id", owner.id);

  if (saveErr) return { state: "error", error: sanitizeError(saveErr, "owner") };
  if (!count)  return { state: "error", error: "Could not save your payout details. Please sign in again and retry." };

  revalidatePath("/owner/profile");
  revalidatePath("/owner/revenue");

  // 2. Register the destination with Cashfree Payouts. The details are already
  //    stored, so an owner who gets this far never has to type them again.
  if (!isPayoutsConfigured()) return { state: "saved_not_live" };

  const result = await registerBeneficiary(owner.id);

  if (!result.ok) {
    // A conflict means this account is already registered to a DIFFERENT
    // owner. That is not something the owner can fix by retrying, and it is
    // not something we resolve automatically — an admin has been alerted.
    if (result.conflict) {
      return {
        state: "error",
        error: "These bank details are already registered to another Hallnect account. Contact support so we can check it.",
      };
    }
    return isOwnerActionableVendorError(result.error)
      ? { state: "error", error: result.error }
      // Not the owner's problem, and their details are saved.
      : { state: "saved_not_live" };
  }

  // Only VERIFIED can actually be paid; anything else is Cashfree still
  // checking, and telling the owner they are set up would be a lie.
  return String(result.status ?? "").toUpperCase() === "VERIFIED"
    ? { state: "verified" }
    : { state: "pending_kyc" };
}

// ── Monthly subscription: start, check, cancel ───────────────────────────────
// Premium and Pro are auto-renewing monthly subscriptions. The owner authorises
// a mandate once; Cashfree debits them each month and each debit buys another
// month of boost.
//
// SECURITY, unchanged from the one-off flow: only a hall id and a plan slug
// cross the wire. Price, Cashfree plan id and hall ownership are all resolved
// server-side.

export type StartSubscriptionActionResult =
  | { success: true; subsSessionId: string; subscriptionId: string; amount: number; mode: "sandbox" | "production" }
  | { error: string };

export async function startPlanSubscriptionAction(
  hallId: string,
  planSlug: string,
): Promise<StartSubscriptionActionResult> {
  const { supabase, user } = await getAuthUser();
  if (!user) return { error: "Please sign in to subscribe." };
  if (!parseSafe(uuidSchema, hallId).ok) return { error: "Invalid hall." };
  if (planSlug !== "premium" && planSlug !== "pro") return { error: "Invalid plan." };

  if (!isCashfreeConfigured()) {
    return { error: "Online payments are temporarily unavailable. Please contact Hallnect support." };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: profile } = await (supabase as any)
    .from("profiles").select("full_name, email, phone").eq("id", user.id).maybeSingle();

  const { startPlanSubscription } = await import("@/lib/plan-subscriptions");
  const result = await startPlanSubscription({
    hallId,
    planSlug,
    ownerProfileId: user.id,
    ownerName:  profile?.full_name ?? "",
    ownerEmail: (user.email || profile?.email || "").trim(),
    ownerPhone: profile?.phone ?? null,
  });

  if (!result.ok) return { error: result.error };

  return {
    success: true,
    subsSessionId:  result.subsSessionId,
    subscriptionId: result.subscriptionId,
    amount:         result.amount,
    mode:           result.mode,
  };
}

/** Server-verified subscription state after the owner returns from the mandate
 *  screen. The URL's claim is never trusted — and neither is the caller's claim
 *  on the subscription: as with checkPlanPurchaseStatus above, the row is
 *  resolved and its owner confirmed before syncSubscription touches Cashfree,
 *  cancels charges or grants a month of boost against it. */
export async function checkPlanSubscriptionStatus(
  subscriptionId: string,
): Promise<{ state: "active" | "pending" | "cancelled" | "failed" | "not_found" }> {
  const { user } = await getAuthUser();
  if (!user) return { state: "not_found" };
  if (!subscriptionId || !subscriptionId.startsWith("HNS_")) return { state: "not_found" };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adminDb = getSupabaseAdminClient() as any;
  const { data: sub } = await adminDb
    .from("plan_subscriptions")
    .select("id, owner_id")
    .eq("cf_subscription_id", subscriptionId)
    .maybeSingle();

  if (!sub) return { state: "not_found" };
  if (!(await ownerRowBelongsToUser(adminDb, sub.owner_id, user.id))) {
    return { state: "not_found" };
  }

  const { syncSubscription } = await import("@/lib/plan-subscriptions");
  const result = await syncSubscription(subscriptionId);

  revalidatePath("/owner/premium");
  revalidatePath("/owner/dashboard");

  return {
    state:
      result.state === "active"     ? "active"
      : result.state === "cancelled"  ? "cancelled"
      : result.state === "failed"     ? "failed"
      : result.state === "not_found"  ? "not_found"
      : "pending",
  };
}

/** Stops future monthly billing. Months already paid for are NOT taken back. */
export async function cancelPlanSubscriptionAction(
  subscriptionRowId: string,
): Promise<{ success: true; until: string | null } | { error: string }> {
  const { user } = await getAuthUser();
  if (!user) return { error: "Please sign in." };
  if (!parseSafe(uuidSchema, subscriptionRowId).ok) return { error: "Invalid subscription." };

  const { cancelPlanSubscription } = await import("@/lib/plan-subscriptions");
  const result = await cancelPlanSubscription({
    subscriptionRowId,
    ownerProfileId: user.id,
  });

  if (!result.ok) return { error: result.error };

  revalidatePath("/owner/premium");
  revalidatePath("/owner/premium/upgrade");
  return { success: true, until: result.until };
}

// ── Offline bookings ──────────────────────────────────────────────────────────
//
// A venue that takes a booking over the phone must be able to say so, or
// Hallnect will sell the same date online. Both actions delegate to
// lib/offline-bookings, which calls the RPCs that hold the inventory lock —
// see migration 0057 for why that lock is the only thing making this safe
// against a customer paying for the same date in the same moment.
//
// AUTHORISATION IS THE DATABASE'S. The RPCs are SECURITY DEFINER and check
// owns_hall(hall_id) OR is_admin() from auth.uid(), so a second ownership test
// here would be a copy that can drift. getAuthUser only establishes that
// SOMEONE is signed in, which is what makes the RPC's own check load-bearing.

export async function addOfflineBooking(input: {
  hallId: string;
  eventDate: string;
  endDate: string;
  slot: string;
  customerName?: string;
  customerPhone?: string;
  notes?: string;
  reference?: string;
  clientToken?: string;
}): Promise<{ success: true; id: string } | { error: string }> {
  const { user } = await getAuthUser();
  if (!user) return { error: "Not authenticated" };

  const parsed = parseSafe(offlineBookingSchema, input);
  if (!parsed.ok) return { error: parsed.error };
  const v = parsed.data;

  const { createOfflineBooking } = await import("@/lib/offline-bookings");
  const result = await createOfflineBooking({
    hallId:        v.hallId,
    eventDate:     v.eventDate,
    endDate:       v.endDate,
    slot:          v.slot as "morning" | "evening" | "full_day",
    customerName:  v.customerName  || null,
    customerPhone: v.customerPhone || null,
    notes:         v.notes         || null,
    reference:     v.reference     || null,
    clientToken:   v.clientToken    ?? null,
  });

  if (!result.ok) return { error: result.error };

  // The audit entry is written INSIDE create_offline_booking, not here.
  // admin_audit_log's INSERT policy is (is_admin() OR is_trusted_backend()), so
  // a recordAdminAction() call from an owner's session is refused — and that
  // helper swallows its errors, so this would have looked fine while recording
  // nothing for the exact role it is meant to watch. See migration 0062.

  revalidatePath(`/owner/halls/${v.hallId}/availability`);
  revalidatePath(`/halls`);
  return { success: true, id: result.id };
}

export async function releaseOfflineBooking(
  id: string,
  hallId: string,
): Promise<ActionResult> {
  const { user } = await getAuthUser();
  if (!user) return { error: "Not authenticated" };

  const idErr = parseSafe(uuidSchema, id);
  if (!idErr.ok) return { error: "Invalid booking id." };

  const { cancelOfflineBooking } = await import("@/lib/offline-bookings");
  const result = await cancelOfflineBooking(idErr.data);
  if (!result.ok) return { error: result.error };

  // Audited inside cancel_offline_booking — see addOfflineBooking above.

  revalidatePath(`/owner/halls/${hallId}/availability`);
  revalidatePath(`/halls`);
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// LEAD GENERATION — the venue's side
//
// The confirmation tick is a MONEY EVENT: it is the moment a commission comes
// into existence. So every one of these actions re-derives the owner from the
// session, proves ownership against the database inside lib/leads.ts, and lets
// the service role perform a write the session client is not granted at all
// (migration 0073 gives `authenticated` no INSERT or UPDATE on `leads`).
//
// Nothing here accepts an owner id, a hall id, a commission rate or a
// commission amount from the browser. The only client-supplied values are the
// lead id, the agreed amount and a free-text note.
// ─────────────────────────────────────────────────────────────────────────────

/** Resolves the caller's hall_owners row, or null. */
async function callerOwnerRow(): Promise<{ profileId: string; ownerId: string } | null> {
  const { supabase, user } = await getAuthUser();
  if (!user) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from("hall_owners").select("id").eq("profile_id", user.id).maybeSingle();
  if (!data?.id) return null;
  return { profileId: user.id, ownerId: data.id };
}

export type ConfirmLeadActionResult =
  | { success: true; alreadyConfirmed: boolean; commissionAmount?: number }
  | { error: string };

/**
 * The Confirm tick.
 *
 * `agreedAmount` is the one number the owner types that becomes money, so it
 * goes through leadConfirmSchema (digits only, a floor, no parseFloat) before
 * anything sees it. The RATE is never accepted here — confirmLead resolves it
 * from the hall server-side.
 */
export async function confirmLeadAction(
  leadId: string,
  input: { agreedAmount: number | string; ownerNotes?: string },
): Promise<ConfirmLeadActionResult> {
  const caller = await callerOwnerRow();
  if (!caller) return { error: "Complete your business profile first." };

  if (!parseSafe(uuidSchema, leadId).ok) return { error: "Invalid enquiry id." };

  const parsed = parseSafe(leadConfirmSchema, {
    agreedAmount: input.agreedAmount,
    ownerNotes: input.ownerNotes,
  });
  if (!parsed.ok) return { error: parsed.error };

  const { confirmLead } = await import("@/lib/leads");
  const res = await confirmLead({
    leadId,
    ownerProfileId: caller.profileId,
    agreedAmount: parsed.data.agreedAmount,
    ownerNotes: parsed.data.ownerNotes || null,
  });
  if (!res.ok) return { error: res.error };

  // A repeat tick notifies nobody and audits nothing. The outbox dedupe key
  // would stop the SMS anyway, but an audit row per click would be noise in an
  // append-only log that the admin page paginates at 50.
  if (!res.alreadyConfirmed) {
    const { notifyLeadEvent } = await import("@/lib/notifications/events");
    await notifyLeadEvent("lead.confirmed", leadId, { amount: res.breakdown?.agreedAmount });

    await recordOwnerAction({
      action:         "lead.confirmed",
      entityType:     "lead",
      entityId:       leadId,
      previousStatus: "pending",
      newStatus:      "confirmed",
      reason:
        `Venue confirmed an enquiry at an agreed amount of ` +
        `${res.breakdown?.agreedAmount ?? "?"}. Hallnect commission ` +
        `${res.breakdown?.commissionRate ?? "?"}% = ${res.breakdown?.commissionAmount ?? "?"}.`,
      metadata: {
        agreedAmount:     res.breakdown?.agreedAmount ?? null,
        commissionRate:   res.breakdown?.commissionRate ?? null,
        commissionAmount: res.breakdown?.commissionAmount ?? null,
        commissionId:     res.commissionId,
      },
    });
  }

  revalidatePath("/owner/leads");
  revalidatePath("/owner/commissions");
  revalidatePath("/owner/dashboard");
  revalidatePath("/admin/leads");
  return {
    success: true,
    alreadyConfirmed: res.alreadyConfirmed,
    commissionAmount: res.breakdown?.commissionAmount,
  };
}

export async function rejectLeadAction(
  leadId: string,
  reason?: string,
): Promise<ActionResult> {
  const caller = await callerOwnerRow();
  if (!caller) return { error: "Complete your business profile first." };
  if (!parseSafe(uuidSchema, leadId).ok) return { error: "Invalid enquiry id." };

  const { rejectLead } = await import("@/lib/leads");
  const res = await rejectLead({
    leadId,
    ownerProfileId: caller.profileId,
    reason: (reason ?? "").trim().slice(0, 500) || null,
  });
  if (!res.ok) return { error: res.error };

  if (res.changed) {
    const { notifyLeadEvent } = await import("@/lib/notifications/events");
    await notifyLeadEvent("lead.rejected", leadId, { reason });
    await recordOwnerAction({
      action:         "lead.rejected",
      entityType:     "lead",
      entityId:       leadId,
      previousStatus: "pending",
      newStatus:      "rejected",
      reason:         reason ? `Venue declined an enquiry: ${reason}` : "Venue declined an enquiry.",
    });
  }

  revalidatePath("/owner/leads");
  revalidatePath("/admin/leads");
  return { success: true };
}

export type StartCommissionPaymentActionResult =
  | { success: true; paymentSessionId: string; orderId: string; amount: number; mode: "sandbox" | "production" }
  | { error: string };

/**
 * Opens Cashfree checkout for one LEAD commission.
 *
 * The browser sends a commission id and nothing else. The amount, the payee and
 * the eligibility are all read server-side; a booking commission is refused
 * outright by assertLeadCommission, because that money was already retained
 * from the customer's advance and inviting the venue to pay it again would
 * collect it twice.
 */
export async function startCommissionPaymentAction(
  commissionId: string,
): Promise<StartCommissionPaymentActionResult> {
  const { supabase, user } = await getAuthUser();
  if (!user) return { error: "Not authenticated" };
  if (!parseSafe(uuidSchema, commissionId).ok) return { error: "Invalid commission id." };
  if (!isCashfreeConfigured()) {
    return { error: "Online payment is not available right now. Please contact Hallnect support." };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data: owner } = await db
    .from("hall_owners")
    .select("business_name, business_email, business_phone, profiles!profile_id(full_name, email, phone)")
    .eq("profile_id", user.id)
    .maybeSingle();
  if (!owner) return { error: "Complete your business profile first." };

  const { startCommissionPayment } = await import("@/lib/commission-payments");
  const res = await startCommissionPayment({
    commissionId,
    ownerProfileId: user.id,
    ownerName:  owner.business_name || owner.profiles?.full_name || "Hall owner",
    // The gateway needs a deliverable address for its receipt. The session's
    // own email is the trustworthy one; business_email is owner-typed.
    ownerEmail: user.email ?? owner.business_email ?? owner.profiles?.email ?? "",
    ownerPhone: owner.business_phone ?? owner.profiles?.phone ?? null,
  });

  if (!res.ok) return { error: res.error };
  return {
    success: true,
    paymentSessionId: res.paymentSessionId,
    orderId: res.orderId,
    amount: res.amount,
    mode: res.mode,
  };
}

export type CommissionPaymentStatusResult =
  | { state: "paid" | "pending" | "failed" | "unsettled" | "not_found" | "error" }
  | { error: string };

/**
 * What actually happened to a commission order.
 *
 * Called from the return page, which knows only an order id from a URL. THAT
 * URL IS NOT EVIDENCE OF ANYTHING — this re-reads the order from Cashfree and
 * compares the amount to the figure this server stored, exactly as the webhook
 * does. A forged redirect proves nothing and changes nothing.
 */
export async function checkCommissionPaymentStatus(
  orderId: string,
): Promise<CommissionPaymentStatusResult> {
  const { user } = await getAuthUser();
  if (!user) return { error: "Not authenticated" };

  const { isCommissionOrderId, verifyAndApplyCommissionPayment } =
    await import("@/lib/commission-payments");
  // Refuse an order id from a different namespace rather than handing a
  // booking order to the commission verifier.
  if (typeof orderId !== "string" || !isCommissionOrderId(orderId)) {
    return { error: "That payment reference is not a commission payment." };
  }

  // SIGNED IN IS NOT THE SAME AS ENTITLED — the rule the two sibling status
  // actions already follow (checkPlanPurchaseStatus, checkPlanSubscriptionStatus)
  // and this one did not. Without the lookup below, ANY signed-in account —
  // a customer's is enough — could pass another venue's HNC_ order id and both
  // learn whether that venue had paid its commission AND drive the
  // service-role settlement side effects on somebody else's debt. The order id
  // is not a secret: it rides in the Cashfree return URL, so it reaches browser
  // history, the Referer header and any shared screenshot.
  //
  // Resolved with the ADMIN client because owner_commission_payments is
  // RLS-gated to the owner — a session-client lookup would return nothing for
  // the attacker and nothing for the legitimate owner's own poll alike, which
  // would read as "not found" for everyone. The admin read is immediately
  // narrowed by ownerRowBelongsToUser against the session's profile id.
  //
  // "not_found" is deliberately returned for both a missing row and someone
  // else's row: an attacker probing ids must not be able to tell the two apart.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adminDb = getSupabaseAdminClient() as any;
  const { data: settlement } = await adminDb
    .from("owner_commission_payments")
    .select("id, owner_id")
    .eq("cashfree_order_id", orderId)
    .maybeSingle();

  if (!settlement) return { state: "not_found" };
  if (!(await ownerRowBelongsToUser(adminDb, settlement.owner_id, user.id))) {
    return { state: "not_found" };
  }

  const res = await verifyAndApplyCommissionPayment(orderId);

  if (res.state === "paid") {
    revalidatePath("/owner/commissions");
    revalidatePath("/admin/commissions");
  }
  return { state: res.state };
}

// ─────────────────────────────────────────────────────────────────────────────
// Claiming a hall an admin recorded before the owner had an account.
// See migration 0090 for the data model and the four security layers.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Turns an admin-recorded draft into a real hall owned by the caller.
 *
 * EVERYTHING THAT MATTERS HAPPENS IN THE DATABASE. This function is a thin
 * wrapper over claim_admin_hall_draft(), which re-derives the caller from
 * auth.uid(), demands a VERIFIED phone matching the number the admin recorded,
 * requires an existing hall_owners row, and flips the claim inside the same
 * transaction that inserts the hall while holding the draft row locked.
 *
 * Deliberately NOT implemented here in TypeScript. Doing the checks in the
 * action and the write through the client would leave a window between them,
 * and "two owners claimed the same venue" is the exact failure the brief calls
 * out. A single SQL function is the only way to make it atomic.
 *
 * The only thing taken from the caller is WHICH draft — and RLS already limits
 * a non-admin to seeing the one matching their own verified phone, so there is
 * no id worth guessing.
 */
export async function claimHallDraft(
  input: unknown,
): Promise<{ success: true; hallId: string } | { error: string }> {
  const { supabase, user } = await getAuthUser();
  if (!user) return { error: "Not authenticated" };

  const parsed = parseSafe(claimHallDraftSchema, input);
  if (!parsed.ok) return { error: parsed.error };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data, error } = await db.rpc("claim_admin_hall_draft", {
    _draft_id: parsed.data.draftId,
  });

  if (error) {
    // The function raises with sentences written FOR the owner — "This listing
    // is registered to a different mobile number", "Complete your owner
    // registration before claiming a listing" — because the reason they cannot
    // claim is the one thing they need to know to fix it. sanitizeError would
    // replace those with a generic string and strand them.
    const message = typeof error.message === "string" ? error.message : "";
    const friendly = message.replace(/^.*?:\s*/, "").trim();
    return { error: friendly || sanitizeError(error, "owner") };
  }
  if (!data) return { error: "That listing could not be claimed. Reload and try again." };

  revalidatePath("/owner/dashboard");
  revalidatePath("/owner/halls");
  revalidatePath(`/owner/halls/${data}/edit`);
  return { success: true, hallId: String(data) };
}
