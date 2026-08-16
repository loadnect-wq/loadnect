import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth";
import { getDashboardPath } from "@/lib/constants";

// ─────────────────────────────────────────────────────────────────────────────
// LEGACY ROUTE — owner joining approval was removed (migration 0019).
//
// Owners are ACTIVE as soon as they register; the HALL is the only thing that
// requires admin approval. This page no longer gates anything, but the route is
// kept so old links, bookmarks and any stale redirect land somewhere sensible
// instead of a 404. Everyone is forwarded to their real dashboard.
// ─────────────────────────────────────────────────────────────────────────────

export default async function ApprovalPendingPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  redirect(getDashboardPath(profile.role));
}
