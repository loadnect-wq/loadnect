"use server";

// ─────────────────────────────────────────────────────────────────────────────
// The contact form's REAL backend.
//
// The form used to await an 800ms timer and show "Message sent!" while
// discarding the message — a fake that cost real enquiries (including, on a
// marketplace this young, potential venue owners). Submissions now land in
// contact_messages and text the admin.
//
// ANON-CALLABLE BY DESIGN: /contact is public, so this action takes input from
// signed-out visitors. That shapes everything here:
//   • validation is strict and server-side (the client form is a convenience);
//   • the INSERT goes through the service-role client — the table has NO anon
//     insert policy, so PostgREST cannot be spammed directly;
//   • TWO hourly caps: a small one per SENDER, and a large platform-wide
//     backstop. The per-sender one is the important one — see below.
//   • a honeypot field silently swallows bot submissions (they see success,
//     nothing is stored — telling a bot it failed just trains it).
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getAdminNotificationPhone, dispatchAll } from "@/lib/notifications/service";
import { sanitizeNotificationText } from "@/lib/notifications/phone";
import { gsm7OrFallback } from "@/lib/notifications/sms-templates";

/**
 * THE PLATFORM-WIDE CAP WAS 20, AND THAT WAS A MUTE BUTTON FOR THE WHOLE SITE.
 *
 * Twenty valid submissions from one script exhausted it, and every genuine
 * visitor for the rest of the hour was told "We are receiving a lot of messages
 * right now" — repeatable, so indefinitely. On a marketplace this young the
 * contact form is how venue owners arrive, and the same flood also suppressed
 * the admin SMS alert, which is bucketed one per UTC hour: fill the bucket and
 * a real message that hour raises nothing.
 *
 * The old comment said per-IP limiting "is not available to a server action".
 * It is — a server action reads headers() like any other server code, and
 * Vercel sets x-vercel-forwarded-for itself. So the dimension that bounds one
 * sender was available the whole time.
 *
 * Now a small per-sender cap does the real work, and the global number becomes
 * a genuine backstop against a distributed flood rather than the front line.
 * Raised to 200 because at 20 it WAS the front line, and a busy hour of real
 * enquiries must never look like an attack.
 */
const MAX_MESSAGES_PER_SENDER_PER_HOUR = 3;
const MAX_MESSAGES_PER_HOUR = 200;

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

/**
 * A stable, non-reversible label for "the same sender", or null.
 *
 * NEVER THE ADDRESS ITSELF. An IP is personal data and this row is read by the
 * admin support screen; abuse control only needs "same sender or not", which a
 * keyed hash answers just as well.
 *
 * THE SALT IS NOT OPTIONAL DECORATION. IPv4 has about four billion values, so
 * an unsalted hash is reversible by brute force in seconds — it would store the
 * address while looking like it did not. With no CONTACT_IP_SALT configured
 * this returns null and the platform-wide backstop carries the load alone,
 * which is honest about what is and is not in force.
 *
 * x-vercel-forwarded-for FIRST: on Vercel the platform sets it and a client
 * cannot forge it. x-forwarded-for is client-appendable, so its LEFTMOST entry
 * is attacker-controlled — taking it would let one sender mint a fresh bucket
 * per request and walk straight through the cap. It is read only as a fallback
 * for non-Vercel hosting, and the first entry is used knowing that caveat.
 */
async function senderBucket(): Promise<string | null> {
  const salt = (process.env.CONTACT_IP_SALT ?? "").trim();
  if (!salt) return null;
  try {
    const h = await headers();
    const raw =
      h.get("x-vercel-forwarded-for") ??
      h.get("x-forwarded-for") ??
      h.get("x-real-ip") ??
      "";
    const ip = raw.split(",")[0]?.trim() ?? "";
    if (!ip) return null;
    return createHash("sha256").update(`${salt}|${ip}`).digest("hex").slice(0, 32);
  } catch {
    return null;
  }
}

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

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const bucket = await senderBucket();

  // 1. PER SENDER. This is the cap that stops one script silencing the form for
  //    everybody, so it comes first and it is small — three enquiries an hour
  //    from one origin is already generous for a contact form.
  //
  //    Fails OPEN, unlike the global cap below, and the asymmetry is the point:
  //    a sender we cannot identify must fall through to the backstop rather
  //    than be refused, because the most likely reason we cannot identify them
  //    is our own configuration, not their behaviour. Turning that into a
  //    rejection would re-create the exact failure being fixed — a real
  //    customer told to go away.
  if (bucket) {
    const { count: mine, error: mineErr } = await db
      .from("contact_messages")
      .select("id", { count: "exact", head: true })
      .eq("sender_bucket", bucket)
      .gte("created_at", hourAgo);
    if (!mineErr && mine != null && mine >= MAX_MESSAGES_PER_SENDER_PER_HOUR) {
      // Deliberately the same wording as the global refusal. Telling this
      // sender they specifically are limited invites them to go and find
      // another address; the generic line does not.
      return { error: "We are receiving a lot of messages right now. Please try again in a little while, or email us directly." };
    }
  }

  // 2. PLATFORM-WIDE BACKSTOP, for a flood spread across many senders. Fails
  //    CLOSED: if the count cannot be read we refuse rather than accept
  //    unmetered anonymous writes.
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
    sender_bucket: bucket,
  });
  if (error) {
    console.error("[contact] insert failed:", error.message);
    return { error: "Something went wrong sending your message. Please try again." };
  }

  // Admin SMS alert — best-effort, never fails the submission. The
  // visitor-supplied subject is sanitised before entering a branded message.
  //
  // ONE ALERT PER HOUR, NOT ONE PER SUBMISSION. The dedupe key used to carry
  // Date.now(), which made it unique by construction and defeated the outbox's
  // idempotency entirely: twenty enquiries in an hour meant twenty billed SMS
  // to the admin's phone, and MAX_PER_PHONE_PER_HOUR (15) is shared with the
  // alerts that actually need waking someone up — a failed payout, a payment
  // mismatch. A contact-form flood, which any bot can produce, would silence
  // those. Bucketing by UTC hour collapses the flood into one nudge; the
  // messages themselves are all in /admin/support-tickets, which is the source
  // of truth. The suffix is the recipient type, added by the outbox.
  const hourBucket = new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH
  try {
    const adminPhone = await getAdminNotificationPhone();
    await dispatchAll([{
      eventKey: `contact.message:${hourBucket}`,
      eventType: "contact.message",
      recipientType: "admin",
      recipientUserId: null,
      phone: adminPhone,
      templateKey: "ADMIN_ALERT",
      templateVariables: [
        "New contact message",
        // gsm7OrFallback, not `?? fallback`: a name and subject written in
        // Tamil sanitise to a perfectly good non-empty string here and then
        // vanish at GSM-7 encoding, so the fallback has to be chosen AFTER the
        // encoding, not before it. Otherwise the alert reads "Details: .".
        gsm7OrFallback(
          sanitizeNotificationText(`${v.name}: ${v.subject}`, 160),
          "New contact message",
        ),
        // "all", because this one SMS may now stand for several messages in
        // the same hour — the alert is a nudge, the dashboard is the record.
        "See all in /admin/support-tickets",
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
