"use server";

// ─────────────────────────────────────────────────────────────────────────────
// The contact form's REAL backend.
//
// The form used to await an 800ms timer and show "Message sent!" while
// discarding the message — a fake that cost real enquiries (including, on a
// marketplace this young, potential venue owners). Submissions now land in
// contact_messages and ping the admin on WhatsApp.
//
// ANON-CALLABLE BY DESIGN: /contact is public, so this action takes input from
// signed-out visitors. That shapes everything here:
//   • validation is strict and server-side (the client form is a convenience);
//   • the INSERT goes through the service-role client — the table has NO anon
//     insert policy, so PostgREST cannot be spammed directly;
//   • a global hourly cap bounds worst-case abuse. Per-IP limiting is not
//     available to a server action, so the cap is deliberately platform-wide
//     and fails CLOSED: when the counter cannot be read, we do not accept.
//   • a honeypot field silently swallows bot submissions (they see success,
//     nothing is stored — telling a bot it failed just trains it).
// ─────────────────────────────────────────────────────────────────────────────

import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getAdminNotificationPhone, dispatchAll } from "@/lib/notifications/service";
import { sanitizeNotificationText } from "@/lib/notifications/phone";

const MAX_MESSAGES_PER_HOUR = 20;

const contactSchema = z.object({
  name:    z.string().trim().min(1, "Please tell us your name.").max(120),
  email:   z.string().trim().max(320)
    .refine((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Enter a valid email address."),
  subject: z.string().trim().min(1, "Please add a subject.").max(160),
  message: z.string().trim().min(10, "Please write a few words about your enquiry.").max(2000),
  /** Honeypot — rendered invisibly; humans leave it empty, bots fill it. */
  company: z.string().max(200).optional(),
});

export type ContactResult = { success: true } | { error: string };

export async function submitContactMessage(input: {
  name: string; email: string; subject: string; message: string; company?: string;
}): Promise<ContactResult> {
  const parsed = contactSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check your details." };
  }
  const v = parsed.data;

  // Honeypot tripped: report success, store nothing.
  if (v.company && v.company.trim() !== "") return { success: true };

  const admin = getSupabaseAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = admin as any;

  // Global cap, counting in-hour rows. Fails CLOSED: if the count cannot be
  // read we refuse rather than accepting unmetered anonymous writes.
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error: countErr } = await db
    .from("contact_messages")
    .select("id", { count: "exact", head: true })
    .gte("created_at", hourAgo);
  if (countErr || count == null || count >= MAX_MESSAGES_PER_HOUR) {
    return { error: "We are receiving a lot of messages right now. Please try again in a little while, or email us directly." };
  }

  // Attach the sender's account when they are signed in — informational only.
  let userId: string | null = null;
  try {
    const session = await getSupabaseServerClient();
    const { data: { user } } = await session.auth.getUser();
    userId = user?.id ?? null;
  } catch { /* anonymous is fine */ }

  const { error } = await db.from("contact_messages").insert({
    name: v.name, email: v.email, subject: v.subject, message: v.message, user_id: userId,
  });
  if (error) {
    console.error("[contact] insert failed:", error.message);
    return { error: "Something went wrong sending your message. Please try again." };
  }

  // Admin WhatsApp alert — best-effort, never fails the submission. The
  // visitor-supplied subject is sanitised before entering a branded message.
  try {
    const adminPhone = await getAdminNotificationPhone();
    await dispatchAll([{
      eventKey: `contact.message:${v.email}:${Date.now()}`,
      eventType: "contact.message",
      recipientType: "admin",
      recipientUserId: null,
      phone: adminPhone,
      templateKey: "ADMIN_ALERT",
      templateVariables: [
        "New contact message",
        sanitizeNotificationText(`${v.name}: ${v.subject}`, 160) ?? "New contact message",
        "See /admin/support-tickets",
      ],
      bookingId: null,
      hallId: null,
      critical: true,
    }]);
  } catch (e) {
    console.error("[contact] admin alert failed:", e instanceof Error ? e.message : e);
  }

  return { success: true };
}
