// ─────────────────────────────────────────────────────────────────────────────
// lib/notifications/sms-templates.ts — the transactional SMS registry
// (PURE — no "server-only", no DB, no network, unit-testable).
//
// WHY A REGISTRY
//   Indian A2P SMS runs under TRAI's DLT regime. A message body must be
//   REGISTERED on a telecom DLT portal against a registered sender header
//   before it can be delivered; anything that does not match a registered
//   template is dropped by the operator, silently, with no error to the app.
//   So the body is not a string a caller composes — it is configuration that
//   was approved elsewhere, referenced by an MSG91 template id.
//
// ONE SOURCE OF TRUTH FOR THE COPY
//   Each template declares `body(vars)`. Three things come out of it:
//     • dltBody()   — the text to register on the DLT portal, with {#var#}
//     • msg91Body() — the same text with ##var1##…##varN##, for the MSG91 panel
//     • render()    — the real message, stored on the outbox row
//   All three come from one function, so what an admin reads in the dashboard
//   is what the customer received, and what was approved is what is sent.
//
// VARIABLE ORDER IS A CONTRACT
//   Position 0 becomes var1. Once a template is registered, reordering
//   `variables` silently corrupts every future message. Add new variables at
//   the END and re-register.
//
// GSM-7 IS NOT A STYLE PREFERENCE — IT IS THE BILL
//   An SMS containing a single character outside the GSM-7 alphabet is encoded
//   as UCS-2, and the segment size drops from 160 characters to 70. The rupee
//   sign, the em dash and curly quotes are all outside GSM-7. A confirmation
//   reading "Rs.1,00,000" is one segment; the same message with the ₹ glyph is
//   three. Every value is therefore forced through toGsm7() before it is
//   rendered OR sent — the same sanitised values feed both, so the stored
//   message cannot differ from the delivered one.
//   The corollary is gsm7OrFallback(): GSM 03.38 has no Indic script, so a
//   Tamil venue name sanitises to NOTHING, and a fallback chosen before that
//   happens is never taken. Encoding and fallback are one decision.
// ─────────────────────────────────────────────────────────────────────────────

/** Every SMS this platform sends. Keys are stable identifiers. */
export type SmsTemplateKey =
  // Customer
  | "CUSTOMER_BOOKING_CREATED"
  | "CUSTOMER_BOOKING_CONFIRMED"
  | "CUSTOMER_BOOKING_CANCELLED"
  | "CUSTOMER_PAYMENT_SUCCESS"
  | "CUSTOMER_PAYMENT_FAILED"
  | "CUSTOMER_REFUND_INITIATED"
  // Lead generation
  | "CUSTOMER_LEAD_UPDATE"
  | "OWNER_NEW_LEAD"
  // Owner
  | "OWNER_NEW_BOOKING"
  | "OWNER_BOOKING_CANCELLED"
  | "OWNER_PAYMENT_RECEIVED"
  | "OWNER_HALL_SUBMITTED"
  | "OWNER_HALL_LIVE"
  | "OWNER_HALL_REJECTED"
  | "OWNER_ACCOUNT_STATUS"
  | "OWNER_PAYMENT_RECEIPT"
  // Admin
  | "ADMIN_ALERT";

export type SmsTemplateDef = {
  key: SmsTemplateKey;
  /** Environment variable holding this template's MSG91 template id. */
  envVar: string;
  /** Who receives it — used by the admin dashboard for grouping. */
  audience: "customer" | "owner" | "admin";
  /** One line for the setup docs: when this fires. */
  purpose: string;
  /** Ordered variable names. Index 0 becomes var1. THIS ORDER IS A CONTRACT. */
  variables: readonly string[];
  /** Renders the message from ordered values. The single source of the copy. */
  body: (v: readonly string[]) => string;
};

/** `${key}` -> `MSG91_TEMPLATE_${key}`. Mechanical, so it cannot drift. */
function envVarFor(key: SmsTemplateKey): string {
  return `MSG91_TEMPLATE_${key}`;
}

function def(
  key: SmsTemplateKey,
  audience: SmsTemplateDef["audience"],
  purpose: string,
  variables: readonly string[],
  body: (v: readonly string[]) => string,
): SmsTemplateDef {
  return { key, envVar: envVarFor(key), audience, purpose, variables, body };
}

// ── GSM-7 ────────────────────────────────────────────────────────────────────

/**
 * The GSM 03.38 basic alphabet plus its extension table. Anything outside this
 * set forces the whole message to UCS-2.
 */
const GSM7_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM7_EXTENDED = "^{}\\[~]|€";
const GSM7 = new Set([...GSM7_BASIC, ...GSM7_EXTENDED]);

/** Characters that have a faithful GSM-7 equivalent worth keeping. */
const TRANSLITERATE: ReadonlyArray<[RegExp, string]> = [
  [/₹/g, "Rs."],   // ₹  — the single most common offender
  [/[‘’‛]/g, "'"],
  [/[“”]/g, '"'],
  [/[–—−]/g, "-"],
  [/…/g, "..."],
  [/ /g, " "],
  [/[•·]/g, "-"],
  [/™/g, "(TM)"],
  [/®/g, "(R)"],
  [/°/g, " deg"],
];

/**
 * Makes text safe for a single-byte SMS: transliterates the characters we
 * expect, then DROPS anything still outside GSM-7 rather than letting one
 * stray glyph triple the cost and halve the length of every message.
 */
export function toGsm7(raw: string): string {
  let out = raw;
  for (const [pattern, replacement] of TRANSLITERATE) out = out.replace(pattern, replacement);
  return [...out].filter((ch) => GSM7.has(ch)).join("").replace(/\s+/g, " ").trim();
}

/** True when every character survives GSM-7 encoding. */
export function isGsm7(raw: string): boolean {
  return [...raw].every((ch) => GSM7.has(ch));
}

/**
 * The GSM-7 form of `candidate`, or `fallback` when NOTHING survives.
 *
 * THE BUG THIS CLOSES: GSM 03.38 contains no Indic script at all, so a Tamil
 * venue name — on a Tamil Nadu marketplace, an ordinary name, not an exotic
 * one — filters down to "". Call sites that pick a fallback the usual way
 *     sanitizeSomething(name) ?? "your venue"
 * have already committed to the real value by then: the candidate is a
 * perfectly good non-empty string, so the fallback is not taken, and the empty
 * result is what ships. The customer gets "your hall booking at  on 12 Jan".
 *
 * So the encoding decision and the fallback decision have to be the SAME
 * decision, which is what this function is. Sanitise first, THEN ask whether
 * anything is left.
 */
export function gsm7OrFallback(candidate: string | null | undefined, fallback: string): string {
  const safe = candidate ? toGsm7(candidate) : "";
  return safe === "" ? toGsm7(fallback) : safe;
}

/**
 * Longest a single interpolated value may be.
 *
 * DLT variables are length-capped by the operator (commonly 30 characters).
 * A hall named beyond that would have the WHOLE message rejected, so values
 * are truncated here — a shortened venue name still identifies the booking,
 * a dropped message does not. Truncation is marked so nobody reads a clipped
 * value as the real one.
 */
export const MAX_VARIABLE_LENGTH = 60;

/**
 * LAST-RESORT stand-ins for a value that GSM-7 erases completely, by variable
 * name. Deliberately generic: the good wording belongs at the call site, which
 * knows whether it is writing to the customer or the owner and passes its own
 * fallback through gsm7OrFallback. This map only exists so that no path can
 * put an EMPTY slot into a DLT-registered body — "your hall booking at  on
 * 12 Jan" reads as a broken platform, and an empty variable is also the kind of
 * thing an operator drops.
 */
const LOST_VALUE_FALLBACK: Record<string, string> = {
  customer_name: "there",
  hall_name: "your venue",
};
const LOST_VALUE_DEFAULT = "not available";

function clampValue(raw: string, variable: string): string {
  // The fallback is chosen AFTER encoding, never before — see gsm7OrFallback.
  // An empty input stays empty (coerceVariables documents missing values as ""),
  // so this only fires for a real value with no GSM-7 character in it at all.
  const safe =
    raw.trim() === ""
      ? toGsm7(raw)
      : gsm7OrFallback(raw, LOST_VALUE_FALLBACK[variable] ?? LOST_VALUE_DEFAULT);
  if (safe.length <= MAX_VARIABLE_LENGTH) return safe;
  return `${safe.slice(0, MAX_VARIABLE_LENGTH - 3).trimEnd()}...`;
}

// ── The templates ────────────────────────────────────────────────────────────
//
// Every body opens with the brand. DLT headers are six characters and mean
// nothing to a recipient on their own, so the message has to say who is
// writing. No URLs: a link in a DLT template needs the domain whitelisted
// separately, and MSG91's shortener would rewrite it to another domain and
// break the exact approved body.
//
// SAY WHAT IS BEING BOOKED. THIS IS A REJECTION REASON, NOT A STYLE NOTE.
//   On 2026-09-03 the operator (STPL) rejected three of these bodies:
//     "your booking at {#var#} on {#var#} is CONFIRMED"
//         -> "Please specify which booking in the content."
//     "we have received {#var#} for {#var#}"
//         -> "Purpose of template is not clear."
//   A DLT reviewer sees ONE template with no product context. Because every
//   variable is opaque to them, a body that reads naturally to a customer who
//   knows they booked a wedding hall reads as unattributable to a reviewer who
//   does not. So each body names the subject in fixed text — "hall booking",
//   "advance payment", "hall listing", "listing plan" — and never
//   leaves the noun to a variable. Do not trim these words back out to save
//   characters: the shorter body is the one that gets rejected.
//
// NEVER PUT TWO VARIABLES BACK TO BACK. ALSO A REJECTION REASON.
//   STPL rejected CUSTOMER_PAYMENT_SUCCESS on 2026-09-03 with "Please reduce two
//   continuous variable into one." Its tail read "Ref {#var#}. {#var#}" — two
//   slots separated by nothing but a full stop. DLT treats adjacent variables as
//   uncheckable, because between them the operator has no fixed text to review.
//   Every variable needs static words in front of it, which is why the bodies
//   below say "Ref", "Details:", "Payment status:", "Item:", "New status:".
//   A test enforces this; do not work around it by shortening the label.

export const SMS_TEMPLATES: Record<SmsTemplateKey, SmsTemplateDef> = {
  // ── Customer ───────────────────────────────────────────────────────────────
  CUSTOMER_BOOKING_CREATED: def(
    "CUSTOMER_BOOKING_CREATED",
    "customer",
    "The customer submitted a booking request (before the venue has responded).",
    ["customer_name", "hall_name", "booking_date", "amount", "booking_id"],
    (v) =>
      `Hallnect: Hi ${v[0]}, your hall booking request for ${v[1]} on ${v[2]} is submitted. ` +
      `Total ${v[3]}. Ref ${v[4]}. We will text you when the venue responds.`,
  ),

  CUSTOMER_BOOKING_CONFIRMED: def(
    "CUSTOMER_BOOKING_CONFIRMED",
    "customer",
    "The venue owner accepted the booking.",
    ["customer_name", "hall_name", "booking_date", "booking_id"],
    (v) =>
      `Hallnect: Hi ${v[0]}, your hall booking at ${v[1]} on ${v[2]} is CONFIRMED. ` +
      `Ref ${v[3]}. Please carry your booking details on the event day.`,
  ),

  CUSTOMER_BOOKING_CANCELLED: def(
    "CUSTOMER_BOOKING_CANCELLED",
    "customer",
    "The booking was cancelled or declined, by either side.",
    ["customer_name", "hall_name", "booking_date", "booking_id", "status_note"],
    (v) =>
      `Hallnect: Hi ${v[0]}, your hall booking at ${v[1]} on ${v[2]} is cancelled. ` +
      `Ref ${v[3]}. Details: ${v[4]}. Any refund due will follow.`,
  ),

  CUSTOMER_PAYMENT_SUCCESS: def(
    "CUSTOMER_PAYMENT_SUCCESS",
    "customer",
    "A Cashfree payment was VERIFIED server-side (never from a browser claim).",
    ["customer_name", "hall_name", "booking_id", "amount_paid", "balance_note"],
    (v) =>
      `Hallnect: Hi ${v[0]}, we have received your advance payment of ${v[3]} for your hall booking at ${v[1]}. ` +
      `Ref ${v[2]}. Payment status: ${v[4]}`,
  ),

  CUSTOMER_PAYMENT_FAILED: def(
    "CUSTOMER_PAYMENT_FAILED",
    "customer",
    "The gateway order expired or was terminated without payment.",
    ["customer_name", "hall_name", "booking_id"],
    (v) =>
      `Hallnect: Hi ${v[0]}, your advance payment for the hall booking at ${v[1]} could not be completed. ` +
      `Ref ${v[2]}. Your dates are not held until payment succeeds. ` +
      `You can retry from My Bookings.`,
  ),

  CUSTOMER_REFUND_INITIATED: def(
    "CUSTOMER_REFUND_INITIATED",
    "customer",
    "A refund has genuinely been sent for a paid booking.",
    ["customer_name", "booking_id", "amount"],
    (v) =>
      `Hallnect: Hi ${v[0]}, a refund of ${v[2]} has been initiated for your hall booking ${v[1]}. ` +
      `Banks usually credit refunds within 5-7 working days.`,
  ),

  // ── Lead generation ────────────────────────────────────────────────────────
  //
  // TWO NEW REGISTRATIONS, NOT FOUR. Every template here is a separate DLT
  // approval the operator has to obtain from a telecom portal, and each one is
  // days of waiting and a chance of rejection. So the customer's side of the
  // whole lead lifecycle — "we sent it" and "the venue confirmed" — is ONE
  // template with a status variable, the same economy ADMIN_ALERT already
  // makes for six different admin alerts.
  CUSTOMER_LEAD_UPDATE: def(
    "CUSTOMER_LEAD_UPDATE",
    "customer",
    "The customer's hall enquiry was forwarded to the venue, or answered by it.",
    ["customer_name", "hall_name", "event_date", "status_note"],
    (v) =>
      `Hallnect: Hi ${v[0]}, an update on your hall enquiry for ${v[1]} on ${v[2]}. ` +
      `Status: ${v[3]}. The venue will contact you on your registered mobile number.`,
  ),

  OWNER_NEW_LEAD: def(
    "OWNER_NEW_LEAD",
    "owner",
    "A customer sent a verified enquiry about the owner's lead-generation venue.",
    ["hall_name", "customer_name", "event_date", "guest_count", "customer_phone", "lead_id"],
    // "hall enquiry" in FIXED text, per the DLT note above: a reviewer sees one
    // template with opaque variables, so the product has to be named in words
    // they can read. Every variable has static words in front of it — no two
    // are adjacent, which is what STPL rejected CUSTOMER_PAYMENT_SUCCESS for.
    (v) =>
      `Hallnect: New hall enquiry for ${v[0]} from ${v[1]} for an event on ${v[2]}. ` +
      `Guests: ${v[3]}. Phone: ${v[4]}. Ref ${v[5]}. ` +
      `Open your owner dashboard to confirm it.`,
  ),

  // ── Owner ──────────────────────────────────────────────────────────────────
  OWNER_NEW_BOOKING: def(
    "OWNER_NEW_BOOKING",
    "owner",
    "A customer requested the owner's hall — the owner must accept or decline.",
    ["hall_name", "customer_name", "booking_date", "booking_id", "advance_paid", "total_amount"],
    (v) =>
      `Hallnect: New hall booking request for ${v[0]} from ${v[1]} on ${v[2]}. ` +
      `Ref ${v[3]}. Advance ${v[4]}, total ${v[5]}. ` +
      `Accept or decline in your owner dashboard.`,
  ),

  OWNER_BOOKING_CANCELLED: def(
    "OWNER_BOOKING_CANCELLED",
    "owner",
    "A booking for the owner's hall was cancelled.",
    ["hall_name", "booking_date", "booking_id"],
    (v) =>
      `Hallnect: The hall booking at ${v[0]} on ${v[1]} (ref ${v[2]}) is cancelled. ` +
      `These dates are available again in your calendar.`,
  ),

  OWNER_PAYMENT_RECEIVED: def(
    "OWNER_PAYMENT_RECEIVED",
    "owner",
    "A customer's advance was verified for one of the owner's bookings.",
    ["hall_name", "booking_id", "amount"],
    (v) =>
      `Hallnect: Advance payment of ${v[2]} received for a hall booking at ${v[0]}. ` +
      `Ref ${v[1]}. ` +
      `Accept the booking to have your share paid out.`,
  ),

  OWNER_HALL_SUBMITTED: def(
    "OWNER_HALL_SUBMITTED",
    "owner",
    "The owner submitted a hall for review (creation or resubmission).",
    ["hall_name"],
    (v) =>
      `Hallnect: Your hall ${v[0]} has been submitted for review as a venue listing. ` +
      `We will text you as soon as it is verified.`,
  ),

  OWNER_HALL_LIVE: def(
    "OWNER_HALL_LIVE",
    "owner",
    "An admin approved the hall; it is now publicly listed.",
    ["hall_name"],
    (v) =>
      `Hallnect: Your hall ${v[0]} is approved and now listed for customers to book. ` +
      `Manage availability and booking requests in your owner dashboard.`,
  ),

  OWNER_HALL_REJECTED: def(
    "OWNER_HALL_REJECTED",
    "owner",
    "An admin sent the hall back for changes, with a reason.",
    ["hall_name", "reason"],
    (v) =>
      `Hallnect: Your hall listing ${v[0]} needs changes before it goes live. ` +
      `Reason: ${v[1]}. ` +
      `Update the details in your owner dashboard and submit it again.`,
  ),

  OWNER_ACCOUNT_STATUS: def(
    "OWNER_ACCOUNT_STATUS",
    "owner",
    "Account-level owner notice: suspension, restoration, premium, billing stopped.",
    ["item", "status", "detail"],
    (v) =>
      `Hallnect venue owner account update for your hall listing. ` +
      `Item: ${v[0]}. New status: ${v[1]}. Detail: ${v[2]}. ` +
      `Sign in to your owner dashboard to review it.`,
  ),

  OWNER_PAYMENT_RECEIPT: def(
    "OWNER_PAYMENT_RECEIPT",
    "owner",
    "A monthly plan payment was collected — the sign-up charge and every renewal.",
    ["amount", "plan", "hall_name", "paid_until"],
    (v) =>
      `Hallnect: Payment of ${v[0]} received for the ${v[1]} listing plan ` +
      `on your hall ${v[2]}. ` +
      `The plan is active until ${v[3]}. Manage billing in your owner dashboard.`,
  ),

  // ── Admin ──────────────────────────────────────────────────────────────────
  // ONE operational template covers every admin alert: one DLT registration
  // instead of six near-identical ones, and a new alert needs no new approval.
  ADMIN_ALERT: def(
    "ADMIN_ALERT",
    "admin",
    "Operational alert to the platform admin: bookings, payments, halls, failures.",
    ["event", "details", "reference"],
    (v) =>
      `Hallnect venue booking platform alert for the admin team. ` +
      `Event: ${v[0]}. Details: ${v[1]}. Reference: ${v[2]}. ` +
      `Open the admin dashboard for full details.`,
  ),
};

export const ALL_SMS_TEMPLATE_KEYS = Object.keys(SMS_TEMPLATES) as SmsTemplateKey[];

/**
 * The body to REGISTER on the DLT portal, with {#var#} placeholders.
 * Generated from the same `body` function that renders real messages, so the
 * approved text and the sent text cannot drift apart.
 */
export function dltBody(key: SmsTemplateKey): string {
  const t = SMS_TEMPLATES[key];
  return t.body(t.variables.map(() => "{#var#}"));
}

/**
 * The body to paste into the MSG91 template editor, with ##var1##…##varN##.
 * MSG91 matches these by NAME, case-sensitively, and lib/msg91/sms.ts emits
 * exactly the same names from the same positions.
 */
export function msg91Body(key: SmsTemplateKey): string {
  const t = SMS_TEMPLATES[key];
  return t.body(t.variables.map((_, i) => `##var${i + 1}##`));
}

/**
 * Normalises caller values to the template's declared arity and makes each one
 * SMS-safe. Missing entries become "" rather than "undefined": getting the
 * count wrong produces a slightly empty message, not the literal word
 * "undefined" in a customer's confirmation.
 *
 * A PRESENT value never becomes "": one written entirely in Tamil or Devanagari
 * has no GSM-7 form, and clampValue substitutes a stand-in rather than leaving
 * a hole in the middle of a sentence.
 */
export function coerceVariables(
  key: SmsTemplateKey,
  values: readonly (string | number | null | undefined)[],
): string[] {
  const names = SMS_TEMPLATES[key].variables;
  const out: string[] = [];
  for (let i = 0; i < names.length; i++) {
    const v = values[i];
    out.push(v === null || v === undefined ? "" : clampValue(String(v), names[i]));
  }
  return out;
}

/** The human-readable message, from values already run through coerceVariables. */
export function renderTemplate(key: SmsTemplateKey, values: readonly string[]): string {
  return SMS_TEMPLATES[key].body(values).replace(/\s+/g, " ").trim();
}

/**
 * How many 160/153-character segments this message costs.
 * Surfaced in the admin dashboard because segment count is the bill, and a
 * template that quietly grew to three segments triples the cost of every
 * booking.
 */
export function segmentCount(message: string): number {
  const len = message.length;
  if (!isGsm7(message)) return len <= 70 ? 1 : Math.ceil(len / 67);
  if (len <= 160) return 1;
  return Math.ceil(len / 153);
}

/**
 * The MSG91 template id configured for this event, or null.
 *
 * MSG91 template ids are 24 hex characters. Validating the SHAPE means a
 * mistyped variable is reported in the admin dashboard as "not configured"
 * instead of being discovered as a rejected send in production.
 */
export function templateIdFor(key: SmsTemplateKey): string | null {
  const raw = process.env[SMS_TEMPLATES[key].envVar]?.trim();
  if (!raw) return null;
  return /^[0-9a-fA-F]{24}$/.test(raw) ? raw : null;
}

/** True when the variable is set but is not a valid MSG91 template id. */
export function hasMalformedTemplateId(key: SmsTemplateKey): boolean {
  const raw = process.env[SMS_TEMPLATES[key].envVar]?.trim();
  return Boolean(raw) && templateIdFor(key) === null;
}

export type SmsTemplateConfigRow = {
  key: SmsTemplateKey;
  envVar: string;
  audience: SmsTemplateDef["audience"];
  purpose: string;
  variables: readonly string[];
  configured: boolean;
  malformed: boolean;
  /** The example body, for the setup docs and the admin dashboard. */
  preview: string;
  segments: number;
};

/** Configuration status of every template, for the admin dashboard. */
export function smsTemplateConfigStatus(): SmsTemplateConfigRow[] {
  return ALL_SMS_TEMPLATE_KEYS.map((key) => {
    const t = SMS_TEMPLATES[key];
    const preview = renderTemplate(key, coerceVariables(key, t.variables.map((n) => `<${n}>`)));
    return {
      key,
      envVar: t.envVar,
      audience: t.audience,
      purpose: t.purpose,
      variables: t.variables,
      configured: templateIdFor(key) !== null,
      malformed: hasMalformedTemplateId(key),
      preview,
      segments: segmentCount(preview),
    };
  });
}
