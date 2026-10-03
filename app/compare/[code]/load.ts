// The halls behind a compare code, shared by the page, its metadata and its
// preview image — one read per request through React's cache().
//
//   null            not a compare code (fewer than 2 or more than 3 ids) -> 404
//   failed: true    the read failed -> "couldn't load", never "gone"
//   halls           what is still listed, in the sender's order

import "server-only";

import { cache } from "react";
import { decodeCompare, type CompareHall } from "@/lib/compare";
import { fetchCompareHalls } from "@/lib/compare.server";

export type LoadedCompare = { ids: string[]; halls: CompareHall[]; missing: number; failed: boolean };

export const loadCompare = cache(async (code: string): Promise<LoadedCompare | null> => {
  const ids = decodeCompare(code);
  if (!ids) return null;
  const halls = await fetchCompareHalls(ids);
  if (!halls) return { ids, halls: [], missing: 0, failed: true };
  return { ids, halls, missing: ids.length - halls.length, failed: false };
});
