// ─────────────────────────────────────────────────────────────────────────────
// app/api/webhooks/msg91/route.ts
//
// Receives MSG91's asynchronous DELIVERY REPORTS for the SMS we send, so the
// admin dashboard can show what actually reached a handset rather than only
// what MSG91 accepted from us. Sending is a two-stage thing: the Flow API
// returns a request id immediately, and the operator's verdict — delivered,
// failed, rejected — arrives here minutes later.
//
// SECURITY
//   • MSG91 does not sign these callbacks. There is no HMAC to verify, so the
//     only real control is a SHARED SECRET, sent as a custom header configured
//     alongside the webhook in the MSG91 panel and compared here in constant
//     time. Without MSG91_WEBHOOK_SECRET set, this endpoint accepts NOTHING —
//     it does not fall open. An unauthenticated version would let anyone who
//     guessed a request id mark another customer's notification "delivered",
//     or flood the table.
//   • Writes go through the SERVICE-ROLE client: RLS on public.notifications
//     correctly forbids anonymous writes, and this request carries no session.
//   • Rows are located by provider_message_id — a value MSG91 generated and we
//     stored at send time. A forged id that matches nothing updates nothing.
//   • ONLY delivery fields are written. A report can never change a recipient,
//     a message, or a booking.
//
// PAYLOAD
//   The body is defined by us, in the MSG91 panel's webhook payload editor
//   (Body tab), from its {{placeholder}} fields. The parser below is
//   deliberately tolerant — a single object or an array, and several spellings
//   of the id — because the panel is edited by hand and a report that arrives
//   in a slightly different shape should still land rather than be dropped.
//   Anything genuinely unrecognised is logged, not silently discarded.
//
// Always answers 200 once authenticated, per webhook convention: a non-2xx
// makes MSG91 retry for hours over something a retry cannot fix.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { msg91WebhookSecret } from "@/lib/msg91";

export const runtime = "nodejs";        // node:crypto for the constant-time compare
export const dynamic = "force-dynamic";

// See app/api/webhooks/cashfree/route.ts for why this is declared
// explicitly: after() runs inside the route budget, it does not extend it.
export const maxDuration = 60;
 // never cache a webhook

/** The header MSG91 must send. Configured on the webhook's Headers tab. */
const SECRET_HEADER = "x-hallnect-webhook-secret";

/** Constant-time compare that does not leak the secret's length. */
function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Our three delivery outcomes, mapped from whatever MSG91 sends.
 *
 * MSG91 reports either a word ("Delivered") or one of its numeric codes
 * (1 = delivered, 2 = failed, 9/16/17/25 = rejected/blocked/NDNC). Both are
 * accepted because the webhook payload is hand-configured and either can end
 * up in the field.
 *
 * The values returned here are constrained by notif_delivery_status_valid in
 * the database — deliberately reusing the existing vocabulary rather than
 * widening the constraint for a provider-specific word.
 */
function mapStatus(raw: unknown): "delivered" | "failed" | "undelivered" | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().toLowerCase();
  if (s === "") return null;

  if (s === "1" || s.includes("deliver")) return s.includes("undeliver") ? "undelivered" : "delivered";
  if (s === "2" || s === "3" || s.includes("fail") || s.includes("expire")) return "failed";
  if (s === "9" || s === "16" || s === "17" || s === "25" || s === "26"
      || s.includes("reject") || s.includes("block") || s.includes("ndnc")
      || s.includes("dnd") || s.includes("opt")) {
    return "undelivered";
  }
  return null;
}

type Report = { requestId: string; status: string; detail: string | null };

/** Pulls the fields we need out of one report object, whatever it is called. */
function readReport(entry: unknown): Report | null {
  if (typeof entry !== "object" || entry === null) return null;
  const o = entry as Record<string, unknown>;

  // The Flow API returns the request id as its `message` field, and the
  // webhook exposes the same value as {{CRQID}}. Both spellings, plus the
  // obvious ones, are accepted so a hand-edited payload still matches.
  const idRaw =
    o.requestId ?? o.request_id ?? o.CRQID ?? o.crqid ?? o.requestID ?? o.campaignId ?? o.id;
  const statusRaw = o.status ?? o.event ?? o.deliveryStatus;
  if (typeof idRaw !== "string" && typeof idRaw !== "number") return null;

  const requestId = String(idRaw).trim();
  if (requestId === "" || requestId.startsWith("{{")) return null; // unfilled placeholder

  const detailRaw = o.description ?? o.desc ?? o.reason ?? o.error;
  return {
    requestId,
    status: statusRaw === undefined || statusRaw === null ? "" : String(statusRaw),
    detail: typeof detailRaw === "string" && detailRaw.trim() !== "" ? detailRaw.trim().slice(0, 200) : null,
  };
}

/** Accepts a single report, an array of them, or {data:[…]} / {reports:[…]}. */
function readReports(body: unknown): Report[] {
  if (Array.isArray(body)) return body.map(readReport).filter((r): r is Report => r !== null);
  if (typeof body === "object" && body !== null) {
    const o = body as Record<string, unknown>;
    for (const key of ["data", "reports", "events", "results"]) {
      if (Array.isArray(o[key])) return readReports(o[key]);
    }
    const one = readReport(body);
    return one ? [one] : [];
  }
  return [];
}

export async function POST(request: Request) {
  const expected = msg91WebhookSecret();
  if (!expected) {
    // Fail CLOSED. An endpoint that writes to the notifications table must not
    // be open to the internet because a variable was forgotten.
    console.error("[msg91-webhook] rejected: MSG91_WEBHOOK_SECRET is not set");
    return NextResponse.json({ ok: false }, { status: 503 });
  }

  if (!secretMatches(request.headers.get(SECRET_HEADER), expected)) {
    console.error("[msg91-webhook] rejected: bad or missing secret header");
    return NextResponse.json({ ok: false }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    console.error("[msg91-webhook] rejected: body was not JSON");
    return NextResponse.json({ ok: true, ignored: "unparseable" });
  }

  const reports = readReports(body);
  if (reports.length === 0) {
    // Authenticated but unrecognised. Logged so a mis-typed payload template in
    // the MSG91 panel is discoverable, instead of delivery reports silently
    // never landing.
    console.warn("[msg91-webhook] no readable reports in payload");
    return NextResponse.json({ ok: true, ignored: "no-reports" });
  }

  try {
    const admin = getSupabaseAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = admin as any;
    const now = new Date().toISOString();
    let applied = 0;

    for (const report of reports) {
      const status = mapStatus(report.status);
      if (!status) continue; // an event we do not track

      const update: Record<string, unknown> = {
        delivery_status: status,
        delivery_updated_at: now,
      };

      if (status !== "delivered") {
        // MSG91 accepted the message and the operator then refused it. That is
        // a real non-delivery, so the row stops claiming success — otherwise
        // the admin dashboard reports a message the recipient never got. It is
        // marked permanent: the operator's verdict will not change on a retry
        // of the identical message, and a DND/NDNC block never will.
        //
        // THIS WRITE MUST NOT HAND BACK RATE-LIMIT CAPACITY. The message was
        // already billed; only its fate changed. The ceilings in
        // lib/notifications/service.ts therefore count rows whose
        // provider_message_id is set, NOT rows whose status still reads 'sent'
        // — otherwise every DND block here would free a slot and the platform
        // would keep paying to text a handset that can never receive it.
        // provider_message_id is deliberately left untouched below.
        update.status = "failed";
        update.permanent_failure = true;
        update.failed_at = now;
        update.error_message =
          report.detail ?? `The operator did not deliver this message (${report.status || status})`;
      }

      const { count } = await db
        .from("notifications")
        .update(update, { count: "exact" })
        .eq("provider_message_id", report.requestId);
      applied += count ?? 0;
    }

    console.info(`[msg91-webhook] ${reports.length} report(s), ${applied} row(s) updated`);
  } catch (e) {
    // Never 500 at MSG91: it would retry this callback for hours. The report is
    // advisory — the outbox row is already correct about what WE did.
    console.error("[msg91-webhook] update failed:", e instanceof Error ? e.message : "unknown");
  }

  return NextResponse.json({ ok: true });
}

/** GET exists only so the URL can be pasted into the MSG91 panel and checked.
 *  It reveals nothing and performs no write. */
export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "msg91-delivery-report" });
}
