// The halls behind a shortlist code, shared by the page, its metadata and its
// preview image. React's cache() makes the three one database read per request.
//
// THREE OUTCOMES, kept apart on purpose:
//   null           not a shortlist code at all -> 404
//   failed: true   the read failed -> "couldn't load", never "no longer listed"
//   halls          what is still listed, in the order the sender saved them;
//                  `missing` counts the rest (delisted or suspended since)

import "server-only";

import { cache } from "react";
import { fetchHallsResult, type HallListing } from "@/lib/halls";
import { decodeShortlist } from "@/lib/shortlist";

export type LoadedShortlist = { ids: string[]; halls: HallListing[]; missing: number; failed: boolean };

export const loadShortlist = cache(async (code: string): Promise<LoadedShortlist | null> => {
  const ids = decodeShortlist(code);
  if (!ids) return null;
  // The cookie-free public client: RLS and the approved filter decide what is
  // visible, exactly as on the search page, and the page can be cached.
  const { halls, failed } = await fetchHallsResult({ ids });
  if (failed) return { ids, halls: [], missing: 0, failed: true };
  const byId = new Map(halls.map((h) => [h.id, h]));
  const ordered = ids.map((id) => byId.get(id)).filter((h): h is HallListing => Boolean(h));
  return { ids, halls: ordered, missing: ids.length - ordered.length, failed: false };
});
