// ─────────────────────────────────────────────────────────────────────────────
// lib/twilio/whatsapp.ts — Twilio WhatsApp transport (SERVER-ONLY).
//
// WhatsApp is the ONLY channel this platform sends on. There is deliberately
// no SMS path here and no SMS fallback anywhere: if WhatsApp delivery fails,
// the outbox row records the failure and an admin can retry it. Silently
// re-routing a message to a channel the recipient never agreed to would be
// both a compliance problem and a surprise cost.
//
// TEMPLATES, NOT FREE TEXT
//   A business-initiated WhatsApp message must use a Meta-approved template,
//   sent as ContentSid + ContentVariables. Since 1 April 2025 passing the
//   template text in `Body` instead fails with Twilio error 63016 ("Outside
//   messaging window. For WhatsApp, use a Message Template instead"). So the
//   normal path here NEVER sends Body — it sends a Content SID and positional
//   variables, and Body is used only inside a live 24-hour customer-service
//   window, which this platform does not currently open.
//
// GATING — three independent switches, all required before a single message
// can leave the building:
//   1. TWILIO_WHATSAPP_ENABLED=true    — the explicit master switch
//   2. credentials present             — account sid + auth token + a sender
//   3. a Content SID for the template  — resolved by the caller
// With any of them missing the caller records the notification as 'skipped'.
// The app keeps working, nothing throws, and nothing pretends to have sent.
//
// SECRETS: every credential is read from process.env at call time and never
// returned, logged, or serialised. getWhatsAppStatus() exposes a MASKED view
// for the admin dashboard only.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

const MESSAGES_BASE = "https://api.twilio.com/2010-04-01";

/** Longest we will wait on Twilio before giving up. A provider outage must
 *  never hang the booking or payment action that triggered the message. */
const SEND_TIMEOUT_MS = 10_000;

type WhatsAppConfig = {
  accountSid: string;
  authToken: string;
  /** whatsapp:+1415… — set when sending from a single WhatsApp sender. */
  from: string | null;
  /** MG… — set when sending through a Messaging Service instead. */
  messagingServiceSid: string | null;
};

/**
 * Normalises a WhatsApp address to Twilio's channel form.
 * Accepts "+919344040013" or "whatsapp:+919344040013" and always returns the
 * prefixed form, so a missing prefix in configuration cannot turn a WhatsApp
 * send into an SMS send — which is exactly the failure mode this platform
 * must not have.
 */
export function toWhatsAppAddress(e164: string): string {
  const trimmed = (e164 ?? "").trim();
  const bare = trimmed.toLowerCase().startsWith("whatsapp:")
    ? trimmed.slice("whatsapp:".length).trim()
    : trimmed;
  return `whatsapp:${bare}`;
}

function readConfig(): WhatsAppConfig | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const fromRaw = process.env.TWILIO_WHATSAPP_FROM?.trim() || null;
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID?.trim() || null;

  if (!accountSid || !authToken) return null;
  if (!fromRaw && !messagingServiceSid) return null;

  return {
    accountSid,
    authToken,
    from: fromRaw ? toWhatsAppAddress(fromRaw) : null,
    messagingServiceSid,
  };
}

/** The explicit master switch. Defaults to OFF — WhatsApp never sends by surprise. */
export function isWhatsAppEnabled(): boolean {
  return process.env.TWILIO_WHATSAPP_ENABLED?.trim().toLowerCase() === "true";
}

/** True when credentials + a sender exist (independent of the master switch). */
export function isWhatsAppConfigured(): boolean {
  return readConfig() !== null;
}

/**
 * Test mode: every message is redirected to TWILIO_WHATSAPP_TEST_TO instead of
 * the real recipient, so a staging deploy pointed at production data cannot
 * message real customers. Enabled ONLY when the flag is true AND a test
 * recipient is configured — a test mode with nowhere to send would otherwise
 * silently drop everything.
 */
export function isWhatsAppTestMode(): boolean {
  return (
    process.env.TWILIO_WHATSAPP_TEST_MODE?.trim().toLowerCase() === "true" &&
    !!process.env.TWILIO_WHATSAPP_TEST_TO?.trim()
  );
}

function testRecipient(): string | null {
  const raw = process.env.TWILIO_WHATSAPP_TEST_TO?.trim();
  return raw ? toWhatsAppAddress(raw) : null;
}

/** Masked status for the admin dashboard. NEVER returns the auth token. */
export function getWhatsAppStatus(): {
  enabled: boolean;
  configured: boolean;
  testMode: boolean;
  accountSidMasked: string | null;
  sender: string | null;
  senderKind: "whatsapp_number" | "messaging_service" | null;
} {
  const cfg = readConfig();
  return {
    enabled: isWhatsAppEnabled(),
    configured: cfg !== null,
    testMode: isWhatsAppTestMode(),
    accountSidMasked: cfg ? `${cfg.accountSid.slice(0, 2)}…${cfg.accountSid.slice(-4)}` : null,
    // The sender is a business number the platform publishes anyway — not a
    // secret. A Messaging Service SID is shown masked all the same.
    sender: cfg
      ? (cfg.from ?? (cfg.messagingServiceSid ? `MG…${cfg.messagingServiceSid.slice(-4)}` : null))
      : null,
    senderKind: cfg ? (cfg.from ? "whatsapp_number" : "messaging_service") : null,
  };
}

// ── Send ─────────────────────────────────────────────────────────────────────

/**
 * Why a send failed, in terms the retry logic can act on.
 *   • `permanent` — retrying sends the same doomed request. The number is not
 *     on WhatsApp, the template is unapproved, the credentials are wrong.
 *   • `transient` — the request could succeed later: rate limit, timeout, 5xx.
 */
export type WhatsAppErrorKind =
  | "disabled"
  | "not_configured"
  | "no_template"
  | "invalid_phone"
  | "not_whatsapp_user"
  | "template_not_approved"
  | "auth_error"
  | "rate_limited"
  | "network_error"
  | "service_error";

const PERMANENT: ReadonlySet<WhatsAppErrorKind> = new Set<WhatsAppErrorKind>([
  "disabled",
  "not_configured",
  "no_template",
  "invalid_phone",
  "not_whatsapp_user",
  "template_not_approved",
  "auth_error",
]);

export function isPermanentWhatsAppError(kind: WhatsAppErrorKind): boolean {
  return PERMANENT.has(kind);
}

export type WhatsAppSendResult =
  | {
      ok: true;
      /** Twilio Message SID (SM…/MM…) — the key the status callback arrives on. */
      providerMessageId: string;
      /** Twilio's initial status: usually 'queued' or 'accepted'. */
      providerStatus: string;
      /** Set when test mode redirected this message away from the real number. */
      redirectedTo: string | null;
    }
  | {
      ok: false;
      kind: WhatsAppErrorKind;
      /** Human-readable, safe to store and show an admin. Never a credential. */
      detail: string;
      /** Twilio's numeric error code when it gave one, e.g. "63016". */
      errorCode: string | null;
    };

/**
 * Maps a Twilio REST error code to our retry semantics.
 * Codes from Twilio's error dictionary; anything unrecognised is treated as
 * transient, because a permanent classification permanently stops retrying and
 * that is the more damaging thing to get wrong.
 */
function classify(
  code: number | null,
  httpStatus: number,
): { kind: WhatsAppErrorKind; detail: string } {
  switch (code) {
    case 20003: return { kind: "auth_error",            detail: "Twilio rejected the credentials (20003)" };
    case 21211:
    case 21614: return { kind: "invalid_phone",         detail: "Not a valid mobile number for WhatsApp" };
    case 63003: return { kind: "not_whatsapp_user",     detail: "That number is not reachable on WhatsApp (63003)" };
    case 63016: return { kind: "template_not_approved", detail: "Outside the 24h window and no approved template was used (63016)" };
    case 63024: return { kind: "template_not_approved", detail: "Twilio rejected the template or its variables (63024)" };
    case 63007: return { kind: "not_configured",        detail: "The WhatsApp sender is not a valid Twilio channel (63007)" };
    case 63018: return { kind: "rate_limited",          detail: "WhatsApp rate limit reached (63018)" };
    case 63021: return { kind: "invalid_phone",         detail: "WhatsApp rejected the recipient (63021)" };
    default: break;
  }
  if (httpStatus === 429) return { kind: "rate_limited", detail: "Twilio rate limit reached" };
  if (httpStatus === 401 || httpStatus === 403) {
    return { kind: "auth_error", detail: `Twilio rejected the credentials (HTTP ${httpStatus})` };
  }
  if (httpStatus >= 500) return { kind: "service_error", detail: `Twilio service error (HTTP ${httpStatus})` };
  return {
    kind: "service_error",
    detail: `Twilio returned HTTP ${httpStatus}${code ? ` (code ${code})` : ""}`,
  };
}

export type SendTemplateInput = {
  /** Recipient in E.164 — the "whatsapp:" prefix is added here. */
  toE164: string;
  /** HX… Content SID of the APPROVED template. Required. */
  contentSid: string;
  /**
   * Positional template variables, in order. Converted to Twilio's
   * {"1":"…","2":"…"} ContentVariables object. Values are stringified and
   * newline-stripped: WhatsApp rejects a template variable containing a
   * newline, and it would also let injected text fake message structure.
   */
  variables: string[];
  /** Absolute URL Twilio posts delivery updates to. */
  statusCallbackUrl?: string | null;
};

/**
 * Sends ONE templated WhatsApp message.
 *
 * The caller (the notification service) has already decided the recipient and
 * the content from server-side data — this function only transports. It never
 * accepts a message body from a client and never picks a recipient itself.
 */
export async function sendWhatsAppTemplate(
  input: SendTemplateInput,
): Promise<WhatsAppSendResult> {
  if (!isWhatsAppEnabled()) {
    return {
      ok: false,
      kind: "disabled",
      detail: "WhatsApp is disabled (TWILIO_WHATSAPP_ENABLED != true)",
      errorCode: null,
    };
  }
  const cfg = readConfig();
  if (!cfg) {
    return {
      ok: false,
      kind: "not_configured",
      detail: "Twilio WhatsApp credentials or sender not configured",
      errorCode: null,
    };
  }
  if (!input.contentSid) {
    return {
      ok: false,
      kind: "no_template",
      detail: "No approved WhatsApp template is configured for this event",
      errorCode: null,
    };
  }

  // Test mode redirects the recipient but keeps everything else identical, so
  // what is exercised in test is the real send path.
  const redirect = isWhatsAppTestMode() ? testRecipient() : null;
  const to = redirect ?? toWhatsAppAddress(input.toE164);

  const params = new URLSearchParams();
  params.set("To", to);
  if (cfg.messagingServiceSid) params.set("MessagingServiceSid", cfg.messagingServiceSid);
  else if (cfg.from) params.set("From", cfg.from);
  params.set("ContentSid", input.contentSid);

  // Body is deliberately absent. Twilio requires a template send to carry
  // ContentSid WITHOUT Body; including both is what produces error 63016.
  if (input.variables.length > 0) {
    const contentVariables: Record<string, string> = {};
    input.variables.forEach((value, i) => {
      contentVariables[String(i + 1)] = sanitizeVariable(value);
    });
    params.set("ContentVariables", JSON.stringify(contentVariables));
  }

  if (input.statusCallbackUrl) params.set("StatusCallback", input.statusCallbackUrl);

  try {
    const res = await fetch(`${MESSAGES_BASE}/Accounts/${cfg.accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization:
          "Basic " + Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
      cache: "no-store",
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    const text = await res.text();
    let data: { sid?: string; status?: string; code?: number; message?: string } = {};
    try { data = text ? JSON.parse(text) : {}; } catch { /* non-JSON error page */ }

    if (!res.ok) {
      const { kind, detail } = classify(typeof data.code === "number" ? data.code : null, res.status);
      // Status and Twilio's numeric code only. The response body can echo the
      // recipient's number, so it is never logged.
      console.error(
        `[whatsapp] send failed: HTTP ${res.status} code=${data.code ?? "none"} kind=${kind}`,
      );
      return { ok: false, kind, detail, errorCode: data.code != null ? String(data.code) : null };
    }

    return {
      ok: true,
      providerMessageId: data.sid ?? "unknown",
      providerStatus: data.status ?? "queued",
      redirectedTo: redirect,
    };
  } catch (e) {
    // AbortSignal.timeout produces a TimeoutError; both it and a genuine
    // network failure are transient and worth retrying.
    const msg = e instanceof Error ? e.message : "unknown";
    console.error("[whatsapp] send failed: network error");
    return {
      ok: false,
      kind: "network_error",
      detail: `Could not reach Twilio (${msg})`,
      errorCode: null,
    };
  }
}

/**
 * WhatsApp forbids newlines and tabs inside a template variable — a message
 * with one is rejected outright. Collapsing whitespace also stops injected
 * text from faking the template's own line structure (e.g. a venue name
 * containing "\nAmount: 1") once it is substituted into an official message.
 */
function sanitizeVariable(value: string): string {
  return String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 400);
}

// ── Delivery status ──────────────────────────────────────────────────────────

/** The delivery states Twilio reports for a WhatsApp message. */
export type WhatsAppDeliveryStatus =
  | "queued" | "sending" | "sent" | "delivered" | "read" | "undelivered" | "failed";

const DELIVERY_STATES: ReadonlySet<string> = new Set([
  "queued", "sending", "sent", "delivered", "read", "undelivered", "failed",
]);

/** Narrows an arbitrary status-callback string to a known state, or null. */
export function parseDeliveryStatus(
  raw: string | null | undefined,
): WhatsAppDeliveryStatus | null {
  const v = (raw ?? "").trim().toLowerCase();
  return DELIVERY_STATES.has(v) ? (v as WhatsAppDeliveryStatus) : null;
}

/** True for the two states that mean WhatsApp gave up on the message. */
export function isFailedDelivery(status: WhatsAppDeliveryStatus): boolean {
  return status === "failed" || status === "undelivered";
}
