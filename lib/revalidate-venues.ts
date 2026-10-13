// ─────────────────────────────────────────────────────────────────────────────
// lib/revalidate-venues.ts — refresh the cached public venue pages.
//
// /halls/[slug] is ISR since 2026-10-08 (see app/halls/[slug]/page.tsx). On its
// own it regenerates within five minutes; anything that changes what a venue
// page SHOWS calls this so the change is live on the next visit instead —
// above all an approval, a suspension or an unpublish, where five minutes of
// the old answer is a live page for a hall that should 404, or a 404 for one
// that just went live.
//
// It refreshes EVERY venue page, not just one, because most callers know a
// hall's id rather than its slug, and the catalogue is small: each page simply
// renders again on its next visit.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { notifyVenueChanges } from "@/lib/indexnow";

export function revalidateVenuePages(): void {
  revalidatePath("/halls/[slug]", "page");
  // /llms.txt lists every live venue with its capacity and price.
  revalidatePath("/llms.txt");
  // Tell Bing (IndexNow) the venue pages changed, so ChatGPT search and
  // Copilot see a new or edited hall without waiting for a recrawl. after()
  // runs it once the response is sent, so the owner or admin never waits on a
  // search engine; outside a request there is nothing to defer into, and the
  // notice is simply skipped. lib/indexnow.ts never throws and is production-only.
  try {
    after(notifyVenueChanges);
  } catch {
    /* not in a request scope: skip the notice */
  }
}
