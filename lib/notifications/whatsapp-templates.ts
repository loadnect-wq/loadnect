// ─────────────────────────────────────────────────────────────────────────────
// lib/notifications/whatsapp-templates.ts — the WhatsApp Content Template
// registry (PURE — no env writes, no DB, no "server-only", unit-testable).
//
// WHY A REGISTRY
//   A business-initiated WhatsApp message must use a template that Meta has
//   approved, referenced by its Twilio Content SID (HX…) and filled with
//   POSITIONAL variables. The SIDs are issued by Twilio after approval, so they
//   are configuration, not code — every one is read from its own environment
//   variable and nothing is hardcoded.
//
// ONE SOURCE OF TRUTH FOR THE COPY
//   Each template declares `body(vars)`. Two things are derived from it:
//     • approvalBody() — the exact text to paste into Twilio's Content Template
//       Builder, with {{1}}, {{2}}, … in place of the variables.
//     • render(values)  — the human-readable message stored on the outbox row
//       and shown in the admin dashboard.
//   Because both come from the same function, what an admin reads in the
//   dashboard is exactly what the customer received. They cannot drift.
//
// VARIABLE ORDER IS A CONTRACT
//   Once a template is approved, {{1}} means what it meant at approval time.
//   Reordering `variables` silently corrupts every future message, so add new
//   variables at the END and submit the template for re-approval.
// ─────────────────────────────────────────────────────────────────────────────

/** Every WhatsApp template this platform sends. Keys are stable identifiers. */
export type WhatsAppTemplateKey =
  // Customer
  | "CUSTOMER_BOOKING_CREATED"
  | "CUSTOMER_BOOKING_CONFIRMED"
  | "CUSTOMER_BOOKING_CANCELLED"
  | "CUSTOMER_PAYMENT_SUCCESS"
  | "CUSTOMER_PAYMENT_FAILED"
  | "CUSTOMER_REFUND_INITIATED"
  // Owner
  | "OWNER_NEW_BOOKING"
  | "OWNER_BOOKING_CANCELLED"
  | "OWNER_PAYMENT_RECEIVED"
  | "OWNER_HALL_SUBMITTED"
  | "OWNER_HALL_APPROVED"
  | "OWNER_HALL_REJECTED"
  | "OWNER_ACCOUNT_UPDATE"
  // Admin
  | "ADMIN_ALERT";

export type WhatsAppTemplateDef = {
  key: WhatsAppTemplateKey;
  /** Environment variable holding this template's Twilio Content SID. */
  envVar: string;
  /** Who receives it — used by the admin dashboard for grouping. */
  audience: "customer" | "owner" | "admin";
  /** One line for the setup docs: when this fires. */
  purpose: string;
  /** Ordered variable names. Index 0 becomes {{1}}. THIS ORDER IS A CONTRACT. */
  variables: readonly string[];
  /** Renders the message from ordered values. The single source of the copy. */
  body: (v: readonly string[]) => string;
};

/** `${key}` → `TWILIO_TEMPLATE_${key}`. Kept mechanical so it cannot drift. */
function envVarFor(key: WhatsAppTemplateKey): string {
  return `TWILIO_TEMPLATE_${key}`;
}

function def(
  key: WhatsAppTemplateKey,
  audience: WhatsAppTemplateDef["audience"],
  purpose: string,
  variables: readonly string[],
  body: (v: readonly string[]) => string,
): WhatsAppTemplateDef {
  return { key, envVar: envVarFor(key), audience, purpose, variables, body };
}

// Every message opens with the brand so the recipient knows who is writing,
// and closes by pointing at the dashboard rather than at a link we would have
// to keep approved — WhatsApp templates with URLs need re-approval when the
// URL changes.
const SIGNOFF = "— Hallnect";

export const WHATSAPP_TEMPLATES: Record<WhatsAppTemplateKey, WhatsAppTemplateDef> = {
  // ── Customer ───────────────────────────────────────────────────────────────
  CUSTOMER_BOOKING_CREATED: def(
    "CUSTOMER_BOOKING_CREATED",
    "customer",
    "The customer submitted a booking request (before the venue has responded).",
    ["customer_name", "hall_name", "booking_date", "amount", "booking_id"],
    (v) =>
      `Hello ${v[0]},\n\n` +
      `Your booking request for ${v[1]} has been submitted.\n\n` +
      `Date: ${v[2]}\n` +
      `Amount: ${v[3]}\n` +
      `Booking ID: ${v[4]}\n\n` +
      `We will update you once the venue confirms.\n\n${SIGNOFF}`,
  ),

  CUSTOMER_BOOKING_CONFIRMED: def(
    "CUSTOMER_BOOKING_CONFIRMED",
    "customer",
    "The venue owner accepted the booking.",
    ["customer_name", "hall_name", "booking_date", "booking_id"],
    (v) =>
      `BOOKING CONFIRMED\n\n` +
      `Hello ${v[0]}, your booking is confirmed.\n\n` +
      `Hall: ${v[1]}\n` +
      `Date: ${v[2]}\n` +
      `Booking ID: ${v[3]}\n\n` +
      `Please carry a copy of your booking on the event day.\n\n${SIGNOFF}`,
  ),

  CUSTOMER_BOOKING_CANCELLED: def(
    "CUSTOMER_BOOKING_CANCELLED",
    "customer",
    "The booking was cancelled or declined, by either side.",
    ["customer_name", "hall_name", "booking_date", "booking_id", "status_note"],
    (v) =>
      `Hello ${v[0]},\n\n` +
      `Your booking has been cancelled.\n\n` +
      `Hall: ${v[1]}\n` +
      `Date: ${v[2]}\n` +
      `Booking ID: ${v[3]}\n` +
      `Status: ${v[4]}\n\n` +
      `Our team will contact you about anything outstanding.\n\n${SIGNOFF}`,
  ),

  CUSTOMER_PAYMENT_SUCCESS: def(
    "CUSTOMER_PAYMENT_SUCCESS",
    "customer",
    "A Cashfree payment was VERIFIED server-side (never from a browser claim).",
    ["customer_name", "hall_name", "booking_id", "amount_paid", "balance_note"],
    (v) =>
      `Payment received.\n\n` +
      `Hello ${v[0]}, thank you — your payment has been confirmed.\n\n` +
      `Hall: ${v[1]}\n` +
      `Booking ID: ${v[2]}\n` +
      `Amount paid: ${v[3]}\n` +
      `${v[4]}\n\n${SIGNOFF}`,
  ),

  CUSTOMER_PAYMENT_FAILED: def(
    "CUSTOMER_PAYMENT_FAILED",
    "customer",
    "The gateway order expired or was terminated without payment.",
    ["customer_name", "hall_name", "booking_id"],
    (v) =>
      `Hello ${v[0]},\n\n` +
      `Your payment for ${v[1]} could not be completed.\n\n` +
      `Booking ID: ${v[2]}\n\n` +
      `Your dates are not held until payment succeeds. You can retry from ` +
      `My Bookings in your Hallnect account.\n\n${SIGNOFF}`,
  ),

  CUSTOMER_REFUND_INITIATED: def(
    "CUSTOMER_REFUND_INITIATED",
    "customer",
    "A refund has genuinely been started for a paid booking.",
    ["customer_name", "booking_id", "amount"],
    (v) =>
      `Hello ${v[0]},\n\n` +
      `A refund has been initiated for your booking.\n\n` +
      `Booking ID: ${v[1]}\n` +
      `Amount: ${v[2]}\n\n` +
      `Banks usually credit refunds within 5-7 working days.\n\n${SIGNOFF}`,
  ),

  // ── Owner ──────────────────────────────────────────────────────────────────
  OWNER_NEW_BOOKING: def(
    "OWNER_NEW_BOOKING",
    "owner",
    "A customer requested the owner's hall — the owner must accept or decline.",
    ["hall_name", "customer_name", "booking_date", "booking_id", "advance_paid", "total_amount"],
    (v) =>
      `NEW BOOKING REQUEST\n\n` +
      `Your hall has received a booking request.\n\n` +
      `Hall: ${v[0]}\n` +
      `Customer: ${v[1]}\n` +
      `Date: ${v[2]}\n` +
      `Booking ID: ${v[3]}\n` +
      `Advance paid: ${v[4]}\n` +
      `Total: ${v[5]}\n\n` +
      `Please accept or decline from your Hallnect owner dashboard.\n\n${SIGNOFF}`,
  ),

  OWNER_BOOKING_CANCELLED: def(
    "OWNER_BOOKING_CANCELLED",
    "owner",
    "A booking for the owner's hall was cancelled.",
    ["hall_name", "booking_date", "booking_id"],
    (v) =>
      `Booking cancelled.\n\n` +
      `Hall: ${v[0]}\n` +
      `Date: ${v[1]}\n` +
      `Booking ID: ${v[2]}\n\n` +
      `These dates are available again in your calendar.\n\n${SIGNOFF}`,
  ),

  OWNER_PAYMENT_RECEIVED: def(
    "OWNER_PAYMENT_RECEIVED",
    "owner",
    "A customer's advance was verified for one of the owner's bookings.",
    ["hall_name", "booking_id", "amount"],
    (v) =>
      `Payment received for your hall.\n\n` +
      `Hall: ${v[0]}\n` +
      `Booking ID: ${v[1]}\n` +
      `Amount: ${v[2]}\n\n` +
      `Accept the booking to have your share paid out automatically.\n\n${SIGNOFF}`,
  ),

  OWNER_HALL_SUBMITTED: def(
    "OWNER_HALL_SUBMITTED",
    "owner",
    "The owner submitted a hall for review (creation or resubmission).",
    ["hall_name"],
    (v) =>
      `Hall submitted for review.\n\n` +
      `${v[0]} has been sent to the Hallnect team for verification. ` +
      `We will message you as soon as it is reviewed.\n\n${SIGNOFF}`,
  ),

  OWNER_HALL_APPROVED: def(
    "OWNER_HALL_APPROVED",
    "owner",
    "An admin approved the hall; it is now publicly listed.",
    ["hall_name"],
    (v) =>
      `Your hall is live.\n\n` +
      `${v[0]} has been approved and is now visible to customers on Hallnect.\n\n${SIGNOFF}`,
  ),

  OWNER_HALL_REJECTED: def(
    "OWNER_HALL_REJECTED",
    "owner",
    "An admin sent the hall back for changes, with a reason.",
    ["hall_name", "reason"],
    (v) =>
      `Changes needed before your hall goes live.\n\n` +
      `Hall: ${v[0]}\n` +
      `Reason: ${v[1]}\n\n` +
      `Update the details in your owner dashboard and submit it again.\n\n${SIGNOFF}`,
  ),

  OWNER_ACCOUNT_UPDATE: def(
    "OWNER_ACCOUNT_UPDATE",
    "owner",
    "Account-level owner notice: premium listing, suspension, commission status.",
    ["subject", "detail"],
    (v) =>
      `Hallnect account update.\n\n` +
      `${v[0]}\n\n` +
      `${v[1]}\n\n` +
      `Open your owner dashboard for full details.\n\n${SIGNOFF}`,
  ),

  // ── Admin ──────────────────────────────────────────────────────────────────
  // ONE operational template covers every admin alert. Meta rejects templates
  // that are almost entirely variable, so the scaffolding here is fixed and
  // only the three fields vary — and one approval covers all admin events
  // instead of six near-identical ones.
  ADMIN_ALERT: def(
    "ADMIN_ALERT",
    "admin",
    "Operational alert to the platform admin: bookings, payments, halls, failures.",
    ["event", "details", "reference"],
    (v) =>
      `HALLNECT ADMIN ALERT\n\n` +
      `Event: ${v[0]}\n` +
      `Details: ${v[1]}\n` +
      `Reference: ${v[2]}\n\n` +
      `Open the admin dashboard for full details.`,
  ),
};

export const ALL_TEMPLATE_KEYS = Object.keys(WHATSAPP_TEMPLATES) as WhatsAppTemplateKey[];

/**
 * The exact body to submit to Twilio's Content Template Builder for approval,
 * with {{1}}…{{n}} placeholders. Generated from the same `body` function that
 * renders real messages, so the approved template and the message we send can
 * never disagree.
 */
export function approvalBody(key: WhatsAppTemplateKey): string {
  const t = WHATSAPP_TEMPLATES[key];
  return t.body(t.variables.map((_, i) => `{{${i + 1}}}`));
}

/**
 * Renders the human-readable message for the outbox row.
 * Missing values become an em dash rather than "undefined" — an admin reading
 * the dashboard should see a gap, not a JavaScript artefact.
 */
export function renderTemplate(
  key: WhatsAppTemplateKey,
  values: readonly string[],
): string {
  const t = WHATSAPP_TEMPLATES[key];
  const filled = t.variables.map((_, i) => {
    const v = values[i];
    return v == null || String(v).trim() === "" ? "—" : String(v);
  });
  return t.body(filled);
}

/**
 * Normalises a variable list to exactly the template's arity.
 * Extra values are dropped and missing ones become "—", so a caller that gets
 * the count wrong produces a slightly empty message rather than a Twilio
 * rejection (63024) or, worse, values landing in the wrong placeholders.
 */
export function coerceVariables(
  key: WhatsAppTemplateKey,
  values: readonly (string | number | null | undefined)[],
): string[] {
  const t = WHATSAPP_TEMPLATES[key];
  return t.variables.map((_, i) => {
    const v = values[i];
    return v == null || String(v).trim() === "" ? "—" : String(v);
  });
}

/**
 * Reads the Content SID for a template from the environment.
 * Returns null when unset — the caller records the notification as 'skipped'
 * with a clear reason rather than attempting a send that Twilio would reject.
 */
export function contentSidFor(key: WhatsAppTemplateKey): string | null {
  const raw = process.env[WHATSAPP_TEMPLATES[key].envVar]?.trim();
  if (!raw) return null;
  // A Content SID is always HX + 32 hex characters. Validating the shape here
  // turns a copy-paste mistake into an actionable dashboard message instead of
  // a Twilio 400 at send time.
  return /^HX[0-9a-fA-F]{32}$/.test(raw) ? raw : null;
}

/** True when the env value is present but is not a well-formed Content SID. */
export function hasMalformedSid(key: WhatsAppTemplateKey): boolean {
  const raw = process.env[WHATSAPP_TEMPLATES[key].envVar]?.trim();
  return !!raw && !/^HX[0-9a-fA-F]{32}$/.test(raw);
}

/** Configuration snapshot for the admin dashboard. Contains no secrets: a
 *  Content SID identifies approved public message copy, not a credential. */
export function templateConfigStatus(): Array<{
  key: WhatsAppTemplateKey;
  envVar: string;
  audience: "customer" | "owner" | "admin";
  purpose: string;
  configured: boolean;
  malformed: boolean;
}> {
  return ALL_TEMPLATE_KEYS.map((key) => {
    const t = WHATSAPP_TEMPLATES[key];
    return {
      key,
      envVar: t.envVar,
      audience: t.audience,
      purpose: t.purpose,
      configured: contentSidFor(key) !== null,
      malformed: hasMalformedSid(key),
    };
  });
}
