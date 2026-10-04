// ─────────────────────────────────────────────────────────────────────────────
// lib/site-visits.server.ts — site visit requests. SERVER-ONLY.
//
// Writes go through the service role, after this file proves who is asking —
// the same arrangement as lib/leads.ts, and for the same reason: the table has
// no client write policy at all (0109), so the only way in is here.
//
//   requestSiteVisit   the family, from the SESSION; name and verified phone
//                      read from their profile, never from the request
//   cancelSiteVisit    the family withdraws a request or a confirmed visit
//   answerSiteVisit    the owner, proven through hall_owners.profile_id —
//                      never through a client-supplied owner or hall id
//
// THREE-STATE READS. The list readers return null on failure, so a page can
// say "couldn't load your visits" instead of "you have no visits".
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { addDaysToIsoDate, todayInBusinessTz } from "@/lib/dates";
import {
  MAX_OPEN_VISITS,
  VISIT_HORIZON_DAYS,
  type VisitStatus,
  type VisitWindow,
  visitWhen,
} from "@/lib/site-visits";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function admin(): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return getSupabaseAdminClient() as any;
}

export type SiteVisit = {
  id: string;
  hallId: string;
  customerId: string;
  visitDate: string;
  visitWindow: VisitWindow;
  partySize: number;
  note: string | null;
  contactName: string;
  contactPhone: string;
  status: VisitStatus;
  ownerMessage: string | null;
  respondedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
};

export type VisitHall = {
  id: string;
  name: string;
  slug: string;
  city: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
};

export type SiteVisitWithHall = SiteVisit & { hall: VisitHall | null };

const COLUMNS =
  "id, hall_id, customer_id, visit_date, visit_window, party_size, note, contact_name, contact_phone, " +
  "status, owner_message, responded_at, cancelled_at, created_at";
const WITH_HALL = `${COLUMNS}, halls(id, name, slug, city, address, latitude, longitude)`;

function toVisit(row: Record<string, unknown>): SiteVisitWithHall {
  const h = row.halls as Record<string, unknown> | null | undefined;
  return {
    id: String(row.id),
    hallId: String(row.hall_id),
    customerId: String(row.customer_id),
    visitDate: String(row.visit_date),
    visitWindow: row.visit_window as VisitWindow,
    partySize: Number(row.party_size),
    note: (row.note as string | null) ?? null,
    contactName: String(row.contact_name ?? ""),
    contactPhone: String(row.contact_phone ?? ""),
    status: row.status as VisitStatus,
    ownerMessage: (row.owner_message as string | null) ?? null,
    respondedAt: (row.responded_at as string | null) ?? null,
    cancelledAt: (row.cancelled_at as string | null) ?? null,
    createdAt: String(row.created_at),
    hall: h
      ? {
          id: String(h.id),
          name: String(h.name),
          slug: String(h.slug),
          city: String(h.city ?? ""),
          address: (h.address as string | null) ?? null,
          latitude: h.latitude != null ? Number(h.latitude) : null,
          longitude: h.longitude != null ? Number(h.longitude) : null,
        }
      : null,
  };
}

/** Today up to the horizon, in India. */
export function isVisitableDate(date: string, today = todayInBusinessTz()): boolean {
  return date >= today && date <= addDaysToIsoDate(today, VISIT_HORIZON_DAYS);
}

// ── The family ───────────────────────────────────────────────────────────────

export type RequestVisitResult =
  | { ok: true; visitId: string; already: boolean }
  | { ok: false; error: string; needsVerification?: boolean };

export async function requestSiteVisit(input: {
  hallId: string;
  customerId: string;
  date: string;
  window: VisitWindow;
  partySize: number;
  contactName: string;
  note: string | null;
}): Promise<RequestVisitResult> {
  const today = todayInBusinessTz();
  if (!isVisitableDate(input.date, today)) {
    return { ok: false, error: `Choose a day between today and ${VISIT_HORIZON_DAYS} days from now.` };
  }
  const db = admin();

  // The number the hall will get is the profile's VERIFIED one — not a value
  // from the form. No verified number, no request.
  const { data: profile, error: profileErr } = await db
    .from("profiles").select("role, phone, phone_verified").eq("id", input.customerId).maybeSingle();
  if (profileErr) {
    console.error("[site-visits] profile read failed", profileErr.code, profileErr.message);
    return { ok: false, error: "Could not send your request. Please try again." };
  }
  // Customers only: the visit list lives under /customer, so an owner or admin
  // account would send a request it could never see or cancel.
  if (profile?.role !== "customer") {
    return { ok: false, error: "Site visits are for customer accounts. Sign in as a customer to ask for one." };
  }
  if (!profile?.phone_verified || !profile.phone) {
    return { ok: false, error: "Verify your phone number first, so the hall can reach you.", needsVerification: true };
  }

  const { data: hall, error: hallErr } = await db
    .from("halls").select("id, status, owner_id").eq("id", input.hallId).maybeSingle();
  if (hallErr) {
    console.error("[site-visits] hall read failed", hallErr.code, hallErr.message);
    return { ok: false, error: "Could not send your request. Please try again." };
  }
  if (!hall || hall.status !== "approved") return { ok: false, error: "This hall is not taking visits on Hallnect." };
  const { data: owner } = await db.from("hall_owners").select("profile_id").eq("id", hall.owner_id).maybeSingle();
  if (owner?.profile_id === input.customerId) return { ok: false, error: "This is your own hall." };

  const { data: open, error: openErr } = await db
    .from("site_visits")
    .select("id, hall_id, visit_date, visit_window")
    .eq("customer_id", input.customerId)
    .in("status", ["requested", "confirmed"])
    .gte("visit_date", today);
  if (openErr) {
    console.error("[site-visits] open read failed", openErr.code, openErr.message);
    return { ok: false, error: "Could not send your request. Please try again." };
  }
  const here = ((open ?? []) as { id: string; hall_id: string; visit_date: string; visit_window: VisitWindow }[])
    .find((v) => v.hall_id === input.hallId);
  if (here) {
    if (here.visit_date === input.date) return { ok: true, visitId: here.id, already: true };
    return {
      ok: false,
      error: `You already asked to visit this hall on ${visitWhen(here.visit_date, here.visit_window)}. Cancel that request first to choose another day.`,
    };
  }
  if ((open ?? []).length >= MAX_OPEN_VISITS) {
    return { ok: false, error: `You have ${MAX_OPEN_VISITS} visits coming up already. Cancel one to ask for another.` };
  }

  const { data: inserted, error } = await db
    .from("site_visits")
    .insert({
      hall_id: input.hallId,
      customer_id: input.customerId,
      visit_date: input.date,
      visit_window: input.window,
      party_size: input.partySize,
      note: input.note,
      contact_name: input.contactName,
      contact_phone: profile.phone,
    })
    .select("id")
    .single();
  if (error) {
    // A double tap raced the check above; the unique index kept one row.
    if (error.code === "23505") {
      const { data: same } = await db.from("site_visits").select("id")
        .eq("hall_id", input.hallId).eq("customer_id", input.customerId).eq("visit_date", input.date)
        .in("status", ["requested", "confirmed"]).maybeSingle();
      if (same) return { ok: true, visitId: same.id, already: true };
    }
    console.error("[site-visits] insert failed", error.code, error.message);
    return { ok: false, error: "Could not send your request. Please try again." };
  }
  return { ok: true, visitId: inserted.id, already: false };
}

export async function cancelSiteVisit(input: { visitId: string; customerId: string }): Promise<{ ok: boolean; changed: boolean }> {
  const { error, count } = await admin()
    .from("site_visits")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", input.visitId)
    .eq("customer_id", input.customerId)
    .in("status", ["requested", "confirmed"])
    .gte("visit_date", todayInBusinessTz());
  if (error) {
    console.error("[site-visits] cancel failed", error.code, error.message);
    return { ok: false, changed: false };
  }
  return { ok: true, changed: (count ?? 0) > 0 };
}

export async function fetchVisitsForCustomer(customerId: string): Promise<SiteVisitWithHall[] | null> {
  const { data, error } = await admin()
    .from("site_visits").select(WITH_HALL)
    .eq("customer_id", customerId)
    .order("visit_date", { ascending: false })
    .limit(50);
  if (error) {
    console.error("[site-visits] customer list failed", error.code, error.message);
    return null;
  }
  return ((data ?? []) as Record<string, unknown>[]).map(toVisit);
}

// ── The owner ────────────────────────────────────────────────────────────────

/** Ids of the halls this profile owns, through hall_owners — never a client-supplied list. */
async function ownedHallIds(ownerProfileId: string): Promise<string[] | null> {
  const db = admin();
  const { data: owners, error: ownerErr } = await db
    .from("hall_owners").select("id").eq("profile_id", ownerProfileId);
  if (ownerErr) {
    console.error("[site-visits] owner rows failed", ownerErr.code, ownerErr.message);
    return null;
  }
  const ownerIds = ((owners ?? []) as { id: string }[]).map((o) => o.id);
  if (ownerIds.length === 0) return [];
  const { data, error } = await db.from("halls").select("id").in("owner_id", ownerIds);
  if (error) {
    console.error("[site-visits] owned halls failed", error.code, error.message);
    return null;
  }
  return ((data ?? []) as { id: string }[]).map((h) => h.id);
}

/** This owner's visits from a month back onwards, soonest first. */
export async function fetchVisitsForOwner(ownerProfileId: string): Promise<SiteVisitWithHall[] | null> {
  const ids = await ownedHallIds(ownerProfileId);
  if (ids === null) return null;
  if (ids.length === 0) return [];
  const { data, error } = await admin()
    .from("site_visits").select(WITH_HALL)
    .in("hall_id", ids)
    .gte("visit_date", addDaysToIsoDate(todayInBusinessTz(), -30))
    .order("visit_date", { ascending: true })
    .limit(200);
  if (error) {
    console.error("[site-visits] owner list failed", error.code, error.message);
    return null;
  }
  return ((data ?? []) as Record<string, unknown>[]).map(toVisit);
}

/** Upcoming requests waiting for the owner. Null when the count could not be read. */
export async function countPendingVisits(hallIds: readonly string[]): Promise<number | null> {
  if (hallIds.length === 0) return 0;
  const { count, error } = await admin()
    .from("site_visits").select("id", { count: "exact", head: true })
    .in("hall_id", [...hallIds])
    .eq("status", "requested")
    .gte("visit_date", todayInBusinessTz());
  if (error) {
    console.error("[site-visits] pending count failed", error.code, error.message);
    return null;
  }
  return count ?? 0;
}

export type AnswerVisitResult = { ok: true; changed: boolean } | { ok: false; error: string };

export async function answerSiteVisit(input: {
  visitId: string;
  ownerProfileId: string;
  decision: "confirmed" | "declined";
  message: string | null;
}): Promise<AnswerVisitResult> {
  const db = admin();
  const [{ data: visit, error: readErr }, owned] = await Promise.all([
    db.from("site_visits").select("id, hall_id, status, visit_date").eq("id", input.visitId).maybeSingle(),
    ownedHallIds(input.ownerProfileId),
  ]);
  if (readErr || owned === null) {
    if (readErr) console.error("[site-visits] answer read failed", readErr.code, readErr.message);
    return { ok: false, error: "Could not update this visit. Please try again." };
  }
  // Not found and not yours read the same, so an id cannot be probed.
  if (!visit || !owned.includes(visit.hall_id)) {
    return { ok: false, error: "Visit not found." };
  }
  if (visit.status === input.decision) return { ok: true, changed: false };
  if (visit.status !== "requested") return { ok: false, error: "This request has already been answered or withdrawn." };
  if (visit.visit_date < todayInBusinessTz()) return { ok: false, error: "This visit's day has passed." };

  const { error, count } = await db
    .from("site_visits")
    .update(
      { status: input.decision, owner_message: input.message, responded_at: new Date().toISOString() },
      { count: "exact" },
    )
    .eq("id", input.visitId)
    .eq("status", "requested");
  if (error) {
    console.error("[site-visits] answer failed", error.code, error.message);
    return { ok: false, error: "Could not update this visit. Please try again." };
  }
  return { ok: true, changed: (count ?? 0) > 0 };
}
