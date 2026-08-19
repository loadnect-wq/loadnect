"use server";

// Shared support-ticket actions used by both customer and owner surfaces.
// SECURITY:
//   • RLS tickets_insert WITH CHECK: user_id = auth.uid(). A user cannot create
//     a ticket on behalf of someone else.
//   • RLS tickets_update: admin-only. Users cannot mutate ticket status,
//     responses, or internal notes.
//   • internal_notes is NEVER returned by our user-facing readers.

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { type TicketPriority } from "@/lib/tickets";
import { ticketSchema, parseSafe } from "@/lib/validation/schemas";
import { sanitizeError } from "@/lib/errors";
import { notifyTicketCreated } from "@/lib/notifications/events";

type ActionResult = { success: true; ticketId: string } | { error: string };

export async function createTicket(input: {
  subject:  string;
  message:  string;
  category?: string;
  priority?: TicketPriority;
}): Promise<ActionResult> {
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const parsed = parseSafe(ticketSchema, input);
  if (!parsed.ok) return { error: parsed.error };
  const v = parsed.data;

  const priority: TicketPriority = v.priority ?? "medium";

  const { data, error } = await db
    .from("support_tickets")
    .insert({
      user_id:  user.id,
      subject:  v.subject,
      message:  v.message,
      category: v.category || null,
      priority,
      status:   "open",
    })
    .select("id")
    .single();

  if (error) {
    // 23514 = check violation. Could be priority value not in CHECK list if the
    // migration hasn't run yet — retry with the old default to avoid blowing up.
    if (error.code === "23514") {
      const { data: retry, error: retryErr } = await db
        .from("support_tickets")
        .insert({
          user_id: user.id, subject: v.subject, message: v.message, category: v.category || null,
          priority: "normal", status: "open",
        })
        .select("id")
        .single();
      if (retryErr) return { error: sanitizeError(retryErr, "createTicket.retry") };
      await notifyTicketCreated(retry.id, v.subject);
      revalidatePath("/customer/support");
      revalidatePath("/owner/support");
      revalidatePath("/admin/support-tickets");
      return { success: true, ticketId: retry.id };
    }
    return { error: sanitizeError(error, "createTicket") };
  }

  // Admin alert — idempotent per ticket, never fails the ticket creation.
  await notifyTicketCreated(data.id, v.subject);

  revalidatePath("/customer/support");
  revalidatePath("/owner/support");
  revalidatePath("/admin/support-tickets");
  return { success: true, ticketId: data.id };
}
