// Server-side ticket reads. Separated from lib/tickets.ts so the shared
// types can be safely imported by client components.

import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { MyTicket, TicketPriority, TicketStatus } from "@/lib/tickets";

// fetchMyTickets reads the signed-in user's own tickets. RLS policy
// (tickets_select) restricts rows to user_id = auth.uid() OR admin — for a
// normal user this returns only their own. internal_notes is NEVER selected
// here so a regular user can't see admin moderation notes even if they ever
// gained read access by some other mechanism.
export async function fetchMyTickets(): Promise<MyTicket[]> {
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await db
    .from("support_tickets")
    .select("id, subject, message, category, status, priority, admin_response, created_at, updated_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    if (error.code === "PGRST205" || error.code === "42P01") {
      console.info("[fetchMyTickets] support_tickets table not provisioned.");
    } else {
      console.error("[fetchMyTickets]", error.message);
    }
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any): MyTicket => ({
    id:             row.id,
    subject:        row.subject,
    message:        row.message,
    category:       row.category ?? null,
    status:         row.status as TicketStatus,
    priority:       row.priority as TicketPriority,
    admin_response: row.admin_response ?? null,
    created_at:     row.created_at,
    updated_at:     row.updated_at,
  }));
}
