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
} from "@/lib/validation/schemas";
import { sanitizeError } from "@/lib/errors";

type ActionResult = { success: true; id?: string } | { error: string };

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
    pan_number:     v.panNumber     || null,
    address:        v.address       || null,
    city:           v.city          || null,
    state:          v.state         || null,
    payout_upi:     v.payoutUpi     || null,
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
}): Promise<ActionResult> {
  const { supabase, user } = await getAuthUser();
  if (!user) return { error: "Not authenticated" };

  const parsed = parseSafe(profileUpdateSchema, data);
  if (!parsed.ok) return { error: parsed.error };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { error } = await db
    .from("profiles")
    .update({ full_name: parsed.data.fullName || null, phone: parsed.data.phone || null })
    .eq("id", user.id);

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

  // Generate a unique slug
  let slug = generateSlug(v.name, v.city);
  const { data: existing } = await db
    .from("halls")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (existing) {
    slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
  }

  const { data: hall, error } = await db.from("halls").insert({
    owner_id:     ownerId, // server-derived, not v.ownerId
    name:         v.name,
    slug,
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
  }).select("id").single();

  if (error) return { error: sanitizeError(error, "owner") };

  // Insert amenities junction rows
  if (v.amenityIds.length > 0) {
    await db.from("hall_amenities").insert(
      v.amenityIds.map((amenityId) => ({ hall_id: hall.id, amenity_id: amenityId })),
    );
  }

  revalidatePath("/owner/halls");
  revalidatePath("/owner/dashboard");
  redirect(`/owner/halls/${hall.id}/images`);
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

  revalidatePath(`/owner/halls/${hallId}/edit`);
  revalidatePath("/owner/halls");
  return { success: true };
}

// ── Submit hall for approval ──────────────────────────────────────────────────
// Owner may move draft → pending_approval. Trigger blocks owner→approved.

export async function submitHallForApproval(hallId: string): Promise<ActionResult> {
  const { supabase, user } = await getAuthUser();
  if (!user) return { error: "Not authenticated" };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { error } = await db
    .from("halls")
    .update({ status: "pending_approval" })
    .eq("id", hallId);

  if (error) return { error: sanitizeError(error, "owner") };
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

  const { error } = await db
    .from("bookings")
    .update({ status: "owner_confirmed" })
    .eq("id", bookingId);

  if (error) return { error: sanitizeError(error, "owner") };
  revalidatePath("/owner/bookings");
  revalidatePath("/owner/dashboard");
  return { success: true };
}

export async function rejectBooking(bookingId: string, reason?: string): Promise<ActionResult> {
  const { supabase, user } = await getAuthUser();
  if (!user) return { error: "Not authenticated" };
  if (!parseSafe(uuidSchema, bookingId).ok) return { error: "Invalid booking id." };
  const cleanReason = reason ? reason.replace(/[<>]/g, "").trim().slice(0, 500) : "";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { error } = await db
    .from("bookings")
    .update({
      status:      "owner_rejected",
      owner_notes: cleanReason || "Booking declined by venue owner",
    })
    .eq("id", bookingId);

  if (error) return { error: sanitizeError(error, "owner") };
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
