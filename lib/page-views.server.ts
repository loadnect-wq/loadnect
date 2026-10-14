// ─────────────────────────────────────────────────────────────────────────────
// lib/page-views.server.ts — count one view of a venue page (0117). SERVER-ONLY.
//
// Called by POST /api/halls/view, which the venue page fires at most once per
// browser per hall per day (the browser keeps that in its own storage). Here:
//   * bots and link-preview fetchers are ignored (the QR standee's rule),
//   * the hall must be live,
//   * the hall's own owner, and admins, are not counted: an owner checking how
//     their page looks is not a family looking for a hall.
// Nothing about the visitor is stored. record_hall_page_view only adds 1 to
// the hall's count for today.
//
// NEVER THROWS. Counting is a courtesy to the owner; it must not fail a page.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { STANDEE_SLUG, isLikelyBot } from "@/lib/standee";

export type ViewOutcome = "counted" | "bot" | "invalid" | "not_live" | "own_hall" | "error";

export async function recordHallPageView(input: {
  slug: string;
  userAgent: string | null;
  /** The signed-in viewer's profile id, or null for a visitor. */
  viewerId: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db?: any;
}): Promise<ViewOutcome> {
  try {
    if (isLikelyBot(input.userAgent)) return "bot";
    if (!STANDEE_SLUG.test(input.slug) || input.slug.length > 160) return "invalid";
    const db = input.db ?? getSupabaseAdminClient();

    const { data: hall, error } = await db
      .from("halls").select("id, owner_id, status").eq("slug", input.slug).maybeSingle();
    if (error) {
      console.error("[page-views] hall lookup failed:", error.code, error.message);
      return "error";
    }
    if (!hall || hall.status !== "approved") return "not_live";

    if (input.viewerId) {
      const [{ data: profile }, { data: owner }] = await Promise.all([
        db.from("profiles").select("role").eq("id", input.viewerId).maybeSingle(),
        db.from("hall_owners").select("id").eq("profile_id", input.viewerId).maybeSingle(),
      ]);
      if (profile?.role === "admin" || (owner && owner.id === hall.owner_id)) return "own_hall";
    }

    const { error: rpcErr } = await db.rpc("record_hall_page_view", { _hall_id: hall.id });
    if (rpcErr) {
      console.error("[page-views] view not recorded:", rpcErr.code, rpcErr.message);
      return "error";
    }
    return "counted";
  } catch (e) {
    console.error("[page-views] view not recorded:", e instanceof Error ? e.message : e);
    return "error";
  }
}
