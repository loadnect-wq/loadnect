"use server";

// ─────────────────────────────────────────────────────────────────────────────
// Resolves the visitor's saved hall ids (localStorage, client-side) into real
// listings.
//
// The saved page used to read MOCK_HALLS — an array deliberately emptied when
// demo content was purged — so the heart button "worked" (ids were stored) but
// the page could never show anything. Every save quietly vanished.
//
// Anon-callable on purpose: saving halls needs no account. Input is untrusted:
// ids are validated as UUIDs and capped, and the query runs on the SESSION
// client so RLS + the status='approved' filter decide visibility — an id for a
// hidden hall returns nothing rather than leaking it.
// ─────────────────────────────────────────────────────────────────────────────

import { fetchHalls, type HallListing } from "@/lib/halls";
import { getAdvancePercent } from "@/lib/platform-settings";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SAVED = 60;

export async function fetchSavedHalls(ids: string[]): Promise<{
  halls: HallListing[];
  advancePercent: number;
}> {
  const clean = (Array.isArray(ids) ? ids : [])
    .filter((id) => typeof id === "string" && UUID_RE.test(id))
    .slice(0, MAX_SAVED);

  const advancePercent = await getAdvancePercent();
  if (clean.length === 0) return { halls: [], advancePercent };

  const halls = await fetchHalls({ ids: clean });
  return { halls, advancePercent };
}
