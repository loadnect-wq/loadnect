"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { generateSlug } from "@/lib/owner";
import {
  ownerBusinessSchema,
  profileUpdateSchema,
  hallCreateSchema,
  hallSchema,
  addHallImageSchema,
  availabilityBatchSchema,
  uuidSchema,
  parseSafe,
  normalizeAmenityName,
  CUSTOM_AMENITY_LIMITS,
  customAmenityListSchema,
} from "@/lib/validation/schemas";
import { sanitizeError } from "@/lib/errors";
import { notifyBookingEvent, notifyHallSubmitted } from "@/lib/notifications/events";
import { normalizePhoneE164 } from "@/lib/notifications/phone";
import { isCashfreeConfigured } from "@/lib/cashfree";
import { startCommissionPayment, verifyAndApplyCommissionPayment } from "@/lib/commission-payments";
import { payOwnerOnAcceptance } from "@/lib/owner-payout";
import { isEasySplitEnabled, upsertVendor } from "@/lib/easy-split";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

type ActionResult = { success: true; id?: string } | { error: string };

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

// ── Upsert owner business profile row ────────────────────────────────────────
// Security:
//   • hall_owners_insert WITH CHECK: profile_id = auth.uid(), is_verified = false
//   • hall_owners_update USING: profile_id = auth.uid()
//   • prevent_owner_self_verify trigger blocks is_verified changes

export async function upsertOwnerRow(data: {
  businessName:  string;
  businessEmail: string;
  businessPhone: string;
  gstNumber:     string;
  panNumber:     string;
  address:       string;
  city:          string;
  state:         string;
  payoutUpi:     string;
  payoutAccountNumber?: string;
  payoutIfsc?:          string;
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
    business_phone: v.businessPhone || null,
    gst_number:     v.gstNumber     || null,
    pan_number:     v.panNumber ? v.panNumber.toUpperCase() : null,
    address:        v.address       || null,
    city:           v.city          || null,
    state:          v.state         || null,
    payout_upi:     v.payoutUpi     || null,
    payout_account_number: v.payoutAccountNumber || null,
    // IFSC is case-insensitive on input but stored uppercase to satisfy the
    // DB CHECK and to match what Cashfree expects.
    payout_ifsc:    v.payoutIfsc ? v.payoutIfsc.toUpperCase() : null,
  };

  if (existing) {
    const { error } = await db
      .from("hall_owners")
      .update(payload)
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

  // NORMALISE before storing, exactly as the customer profile does: WhatsApp
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
    updatePayload.whatsapp_notifications_enabled = data.notificationsEnabled;
  }

  let { error } = await db
    .from("profiles")
    .update(updatePayload)
    .eq("id", user.id);

  // Unknown column (pre-0026): PostgREST reports it as PGRST204, Postgres as
  // 42703 — retry without it.
  if ((error?.code === "42703" || error?.code === "PGRST204") && "whatsapp_notifications_enabled" in updatePayload) {
    delete updatePayload.whatsapp_notifications_enabled;
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
  customAmenities?: string[];
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

  const buildPayload = (useSlug: string) => ({
    owner_id:     ownerId, // server-derived, not v.ownerId
    name:         v.name,
    slug:         useSlug,
    description:  v.description || null,
    city:         v.city,
    state:        v.state   || null,
    address:      v.address || null,
    pincode:      v.pincode || null,
    capacity_min: v.capacityMin ?? null,
    capacity_max: v.capacityMax,
    price_per_day:  v.pricePerDay,
    price_morning:  v.priceMorning ?? null,
    price_evening:  v.priceEvening ?? null,
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

  // Insert amenities junction rows
  if (v.amenityIds.length > 0) {
    await db.from("hall_amenities").insert(
      v.amenityIds.map((amenityId) => ({ hall_id: hall.id, amenity_id: amenityId })),
    );
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
  customAmenities?: string[];
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

  const { error } = await db
    .from("halls")
    .update({
      name:         v.name,
      description:  v.description || null,
      city:         v.city,
      state:        v.state   || null,
      address:      v.address || null,
      pincode:      v.pincode || null,
      capacity_min: v.capacityMin ?? null,
      capacity_max: v.capacityMax,
      price_per_day:  v.pricePerDay,
      price_morning:  v.priceMorning ?? null,
      price_evening:  v.priceEvening ?? null,
    })
    .eq("id", hallId);

  if (error) return { error: sanitizeError(error, "owner") };

  // Sync amenities: delete existing, re-insert selected
  await db.from("hall_amenities").delete().eq("hall_id", hallId);
  if (v.amenityIds.length > 0) {
    await db.from("hall_amenities").insert(
      v.amenityIds.map((amenityId) => ({ hall_id: hallId, amenity_id: amenityId })),
    );
  }

  const customParsed = parseSafe(customAmenityListSchema, data.customAmenities ?? []);
  if (!customParsed.ok) return { error: customParsed.error };
  const customErr = await syncCustomAmenities(db, hallId, customParsed.data);
  if (customErr) return { error: customErr };

  revalidatePath(`/owner/halls/${hallId}/edit`);
  revalidatePath("/owner/halls");
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  if (v.isCover) {
    await db
      .from("hall_images")
      .update({ is_cover: false })
      .eq("hall_id", v.hallId)
      .eq("is_cover", true);
  }

  const { error } = await db.from("hall_images").insert({
    hall_id:      v.hallId,
    url:          v.url,
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

  await db.from("hall_images").update({ is_cover: false }).eq("hall_id", hallId);
  const { error } = await db.from("hall_images").update({ is_cover: true }).eq("id", imageId);
  if (error) return { error: sanitizeError(error, "owner") };

  revalidatePath(`/owner/halls/${hallId}/images`);
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
    .select("id, hall_id, storage_path")
    .eq("id", imageId)
    .eq("hall_id", hallId)
    .maybeSingle();

  if (readErr) return { error: sanitizeError(readErr, "owner") };
  if (!image) return { error: "Image not found." };

  const { error } = await db.from("hall_images").delete().eq("id", imageId);
  if (error) return { error: sanitizeError(error, "owner") };

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
// Security: RLS availability_write USING: owns_hall(hall_id)

export async function setAvailability(
  hallId: string,
  entries: { date: string; slot: string; status: string }[],
): Promise<ActionResult> {
  const { supabase, user } = await getAuthUser();
  if (!user) return { error: "Not authenticated" };

  const parsed = parseSafe(availabilityBatchSchema, { hallId, entries });
  if (!parsed.ok) return { error: parsed.error };
  const v = parsed.data;

  if (v.entries.length === 0) return { success: true };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const rows = v.entries.map((e) => ({
    hall_id: v.hallId,
    date:    e.date,
    slot:    e.slot,
    status:  e.status,
  }));

  const { error } = await db
    .from("availability")
    .upsert(rows, { onConflict: "hall_id,date,slot" });

  if (error) return { error: sanitizeError(error, "owner") };
  revalidatePath(`/owner/halls/${hallId}/availability`);
  return { success: true };
}

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

  await notifyBookingEvent("booking.rejected", bookingId, { reason: cleanReason || null });

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

  const { error } = await db
    .from("bookings")
    .update({ status: "completed" })
    .eq("id", bookingId);

  if (error) return { error: sanitizeError(error, "owner") };
  revalidatePath("/owner/bookings");
  revalidatePath("/owner/revenue");
  return { success: true };
}

// ── Commission settlement via Cashfree ───────────────────────────────────────
// The owner pays Hallnect's platform commission through the same gateway customers
// use for booking advances — UPI, cards, net-banking, wallets — instead of a
// manual UPI transfer that an admin has to verify by eye.
//
// SECURITY: this action passes only the commission id. The amount is re-read
// server-side from commissions.commission_amount, ownership is verified against
// the database, and a DB trigger independently rejects any mismatch. Nothing
// the browser sends can change what is charged or who is credited.

export type StartCommissionPaymentActionResult =
  | { success: true; paymentSessionId: string; orderId: string; amount: number; mode: "sandbox" | "production" }
  | { error: string };

export async function startCommissionPaymentAction(
  commissionId: string,
): Promise<StartCommissionPaymentActionResult> {
  const { supabase, user } = await getAuthUser();
  if (!user) return { error: "Please sign in to pay your commission." };
  if (!parseSafe(uuidSchema, commissionId).ok) return { error: "Invalid commission." };

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

  const result = await startCommissionPayment({
    commissionId,
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
 * Server-verified status for a commission order. The owner's browser calls this
 * after returning from Cashfree — the URL's claim of success is never trusted.
 */
export async function checkCommissionPaymentStatus(
  orderId: string,
): Promise<{ state: "paid" | "pending" | "failed" | "not_found" }> {
  const { user } = await getAuthUser();
  if (!user) return { state: "not_found" };
  if (!orderId || !orderId.startsWith("HNC_")) return { state: "not_found" };

  const result = await verifyAndApplyCommissionPayment(orderId);
  revalidatePath("/owner/commissions");
  revalidatePath("/admin/commissions");
  return { state: result.state === "paid" ? "paid" : result.state === "failed" ? "failed" : result.state === "not_found" ? "not_found" : "pending" };
}

// ── Cashfree vendor onboarding (required before automatic payouts) ──────────
// An owner cannot be paid automatically until Cashfree has them as a KYC-cleared
// vendor. This registers/refreshes that record from the owner's own business
// details and stores the resulting status so the dashboard can show it honestly.

export async function connectPayoutAccount(): Promise<ActionResult> {
  const { supabase, user } = await getAuthUser();
  if (!user) return { error: "Not authenticated" };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data: owner } = await db
    .from("hall_owners")
    .select("id, business_name, business_email, business_phone, payout_upi, pan_number, payout_account_number, payout_ifsc")
    .eq("profile_id", user.id)
    .maybeSingle();

  if (!owner) return { error: "Complete your business profile first." };
  if (!owner.payout_account_number || !owner.payout_ifsc) {
    return { error: "Add your payout bank account number and IFSC in Business Details first — Cashfree settles owner payouts to a bank account." };
  }
  if (!owner.pan_number) return { error: "Add your PAN in Business Details first — Cashfree requires it for payouts." };
  if (!owner.business_phone) return { error: "Add your business phone in Business Details first." };

  if (!isEasySplitEnabled()) {
    return { error: "Automatic payouts are not switched on yet. Hallnect will contact you when they are." };
  }

  const result = await upsertVendor({
    vendorId: owner.id,
    name:  owner.business_name ?? "Hallnect Venue Owner",
    email: (owner.business_email || user.email || "").trim(),
    phone: (owner.business_phone ?? "").replace(/\D/g, "").slice(-10),
    bankAccountNumber: owner.payout_account_number,
    bankIfsc:          owner.payout_ifsc,
    upiVpa:            owner.payout_upi,
    pan:               owner.pan_number,
  });

  // Record the outcome either way — a failed onboarding must be visible, not
  // silently retried forever. The service-role client is used because
  // hall_owners' vendor columns are trusted-backend state, not owner-editable.
  const adminDb = getSupabaseAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (adminDb as any).from("hall_owners").update(
    result.ok
      ? {
          cashfree_vendor_id: result.data.vendorId,
          vendor_kyc_status:  result.data.settleable ? "VERIFIED" : "PENDING",
          vendor_synced_at:   new Date().toISOString(),
          vendor_last_error:  null,
        }
      : { vendor_synced_at: new Date().toISOString(), vendor_last_error: result.error },
  ).eq("id", owner.id);

  revalidatePath("/owner/profile");
  revalidatePath("/owner/revenue");

  if (!result.ok) return { error: result.error };
  return { success: true };
}
