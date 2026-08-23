// ─────────────────────────────────────────────────────────────────────────────
// lib/twilio/signature.ts — X-Twilio-Signature verification for INBOUND
// webhooks Twilio pushes to us (message status callbacks, registration status).
//
// Moved verbatim from the former lib/twilio.ts when that file became a
// directory; the two documented signing schemes are unchanged:
//
//   • application/x-www-form-urlencoded
//       signed string = fullUrl + each POST param as key+value, keys sorted
//       (Unix case-sensitive), concatenated with NO delimiters.
//
//   • application/json
//       Twilio appends ?bodySHA256=<hex sha256 of the raw body> to the URL and
//       signs the URL *including that query string*. The body itself is NOT
//       concatenated. Validation therefore has TWO parts: the HMAC must match
//       AND sha256(rawBody) must equal the bodySHA256 parameter — otherwise a
//       replayed signature could be paired with a swapped body.
//
// Implemented directly: this project has no Twilio SDK dependency.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import crypto from "node:crypto";

export type TwilioSignatureResult =
  | { ok: true }
  | { ok: false; reason: "no_signature" | "not_configured" | "body_hash_mismatch" | "signature_mismatch" };

/**
 * Verifies an inbound Twilio webhook's X-Twilio-Signature header.
 *
 * Returns a REASON on failure so the route can log precisely why — in
 * particular distinguishing "we have no auth token yet" (expected before
 * Twilio credentials are configured) from a genuine signature mismatch.
 *
 * candidateOrigins exists because Twilio signs the EXACT URL it was configured
 * with. This site answers on both the apex and www hosts, so a URL pasted as
 * either one must verify; we try each and accept the first that matches.
 */
export function verifyTwilioWebhookSignature(input: {
  /** request.url — carries the query string, which the JSON scheme signs. */
  requestUrl: string;
  /** Origins Twilio may have been configured with, e.g. https://www.example.com */
  candidateOrigins: string[];
  signature: string | null;
  /** Raw body exactly as received, read before any parsing. */
  rawBody: string;
  contentType: string | null;
}): TwilioSignatureResult {
  const { requestUrl, candidateOrigins, signature, rawBody, contentType } = input;

  if (!signature) return { ok: false, reason: "no_signature" };

  // Signature verification needs ONLY the auth token — never the Verify service
  // sid or a WhatsApp sender, which are unrelated to webhooks.
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (!authToken) return { ok: false, reason: "not_configured" };

  const isJson = (contentType ?? "").toLowerCase().includes("application/json");

  let parsed: URL;
  try { parsed = new URL(requestUrl); } catch { return { ok: false, reason: "signature_mismatch" }; }

  if (isJson) {
    // Part 1: the body must hash to exactly what the URL claims.
    const claimed = parsed.searchParams.get("bodySHA256");
    if (!claimed) return { ok: false, reason: "body_hash_mismatch" };
    const actual = crypto.createHash("sha256").update(rawBody, "utf8").digest("hex");
    const cBuf = Buffer.from(claimed.toLowerCase());
    const aBuf = Buffer.from(actual);
    if (cBuf.length !== aBuf.length || !crypto.timingSafeEqual(cBuf, aBuf)) {
      return { ok: false, reason: "body_hash_mismatch" };
    }
  }

  // Part 2: the HMAC over the exact configured URL (path + query preserved).
  const suffix = isJson ? "" : formParamsSortedConcat(rawBody);
  for (const origin of candidateOrigins) {
    const url = `${origin.replace(/\/$/, "")}${parsed.pathname}${parsed.search}`;
    const expected = crypto
      .createHmac("sha1", authToken)
      .update(url + suffix, "utf8")
      .digest("base64");
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return { ok: true };
  }

  return { ok: false, reason: "signature_mismatch" };
}

/** Sorts x-www-form-urlencoded params by key (Unix case-sensitive) and
 *  concatenates key+value pairs with no separators — the exact transform
 *  Twilio's form-encoded signing scheme requires. */
function formParamsSortedConcat(rawBody: string): string {
  const params = new URLSearchParams(rawBody);
  const keys = Array.from(new Set(params.keys())).sort();
  // getAll: a repeated key contributes each of its values, in order.
  return keys.map((k) => params.getAll(k).map((v) => k + v).join("")).join("");
}

/**
 * The origins Twilio may have been configured with for this deployment.
 * Taken from our own canonical config rather than the Host header, so a
 * spoofed Host cannot change what a signature is verified against.
 */
export function twilioCandidateOrigins(canonical: string): string[] {
  return Array.from(new Set([
    canonical,
    canonical.includes("://www.")
      ? canonical.replace("://www.", "://")
      : canonical.replace("://", "://www."),
  ]));
}
