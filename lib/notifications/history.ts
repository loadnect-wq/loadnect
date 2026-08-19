// ─────────────────────────────────────────────────────────────────────────────
// lib/notifications/history.ts — a user's OWN notification history (SERVER-ONLY).
//
// Runs on the SESSION client: RLS (notif_select) scopes rows to
// recipient_user_id = auth.uid(), so a customer can never read an owner's
// notifications and vice versa. Internal delivery details (errors, provider
// ids) are deliberately not selected — users see WHAT was communicated, not
// the plumbing.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase/server";

export type MyNotification = {
  id:         string;
  event_type: string;
  message:    string;
  status:     string;
  created_at: string;
};

export async function fetchMyNotifications(limit = 50): Promise<MyNotification[]> {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("notifications")
    .select("id, event_type, message, status, created_at")
    .eq("recipient_user_id", user.id)   // explicit filter on top of RLS
    .order("created_at", { ascending: false })
    .limit(Math.min(limit, 100));

  if (error) return []; // table not provisioned yet, or transient — empty list
  return (data ?? []) as MyNotification[];
}
