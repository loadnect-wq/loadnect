// ─────────────────────────────────────────────────────────────────────────────
// app/api/webhooks/twilio-registration/route.ts
//
// Receives Twilio's asynchronous status-callback for a REGISTRATION resource —
// an A2P 10DLC Brand/Campaign, a Regulatory Bundle (KYC), a hosted-number
// order, etc. Twilio calls this whenever that resource's status changes
// (e.g. pending -> approved / rejected / twilio-rejected), instead of you
// polling the console.
//
// SCOPE: this is a VISIBILITY endpoint only. Nothing in the app currently
// gates behaviour on registration status (TWILIO_ENABLED is a separate, manual
// switch — see lib/twilio.ts), so this does not need to update any database
// row; it verifies the request is genuinely from Twilio and logs the outcome
// so it's visible in Vercel's function logs without you having to check the
// Twilio console. If a future feature needs to react to this (e.g. block message
// sends until a campaign is approved), extend the handler below rather than
// building a second endpoint.
//
// SECURITY:
//   • The raw body is read FIRST, before any parsing, and used verbatim for
//     signature verification (verifyTwilioWebhookSignature in lib/twilio.ts).
//   • Signature covers BOTH shapes Twilio may send this in (form-encoded or
//     JSON) — see lib/twilio.ts for the two signing schemes.
//   • An invalid/missing signature -> 403. We do not process or log the body
//     of a request we can't verify came from Twilio.
//   • Only non-sensitive status fields are logged — never headers, tokens, or
//     full payloads that might carry business/KYC document contents.
//   • Responds 200 quickly and unconditionally once verified, per Twilio's
//     webhook guidance (a slow/erroring response causes retries).
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { verifyTwilioWebhookSignature, twilioCandidateOrigins } from "@/lib/twilio/signature";
import { getCanonicalAppUrl } from "@/lib/app-url";

export const runtime = "nodejs";        // crypto for signature verification
export const dynamic = "force-dynamic"; // never cache a webhook

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-twilio-signature");
  const contentType = request.headers.get("content-type");

  // Twilio signs the EXACT URL it was configured with. The origin is taken
  // from our own canonical config rather than the Host header, so a spoofed
  // Host can't change what we verify against — but BOTH the apex and www hosts
  // are accepted, because either may legitimately have been pasted into the
  // Twilio console and both serve this site. Shared with the WhatsApp
  // status-callback route so the two cannot drift apart.
  const result = verifyTwilioWebhookSignature({
    requestUrl: request.url,   // carries ?bodySHA256=… which the JSON scheme signs
    candidateOrigins: twilioCandidateOrigins(getCanonicalAppUrl()),
    signature,
    rawBody,
    contentType,
  });

  if (!result.ok) {
    // Distinguish "no credentials yet" from a genuine mismatch — before
    // TWILIO_AUTH_TOKEN is set this endpoint cannot verify anything, and a
    // 403 then is expected rather than a sign of an attack.
    console.error(`[twilio-registration] rejected: ${result.reason}`);
    return NextResponse.json({ ok: false, error: result.reason }, { status: 403 });
  }

  // Extract only the fields Twilio's registration status callbacks document —
  // present names vary slightly by resource type (Bundle/Brand/Campaign), so
  // read defensively rather than assuming one exact shape.
  let sid: string | null = null;
  let status: string | null = null;
  let friendlyName: string | null = null;

  const isJson = (contentType ?? "").toLowerCase().includes("application/json");
  try {
    if (isJson) {
      const data = JSON.parse(rawBody) as Record<string, unknown>;
      sid = (data.sid as string) ?? (data.Sid as string) ?? null;
      status = (data.status as string) ?? (data.Status as string) ?? null;
      friendlyName = (data.friendly_name as string) ?? (data.FriendlyName as string) ?? null;
    } else {
      const params = new URLSearchParams(rawBody);
      sid = params.get("sid") ?? params.get("Sid") ?? params.get("BundleSid") ?? null;
      status = params.get("status") ?? params.get("Status") ?? null;
      friendlyName = params.get("friendly_name") ?? params.get("FriendlyName") ?? null;
    }
  } catch {
    // Verified-but-unparsable body: still acknowledge (it IS genuinely from
    // Twilio), just note we couldn't extract the summary fields.
  }

  console.log(
    `[twilio-registration] status update — sid=${sid ?? "unknown"} status=${status ?? "unknown"}` +
    (friendlyName ? ` name="${friendlyName}"` : ""),
  );

  return NextResponse.json({ ok: true });
}

// GET probe so the URL can be sanity-checked the same way the Cashfree
// webhook's is (curl the endpoint and confirm it's live before pasting it
// into Twilio's console).
export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "twilio-registration-webhook" });
}
