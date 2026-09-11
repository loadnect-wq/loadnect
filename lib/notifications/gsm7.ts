// ─────────────────────────────────────────────────────────────────────────────
// lib/notifications/gsm7.ts — GSM 03.38 encoding, and nothing else.
//
// PURE: no "server-only", no env, no DB, no network. That matters — this was
// extracted out of sms-templates.ts specifically so lib/notifications/phone.ts
// can use it. phone.ts is deliberately client-importable (the booking form
// validates against it), and sms-templates.ts reads process.env and carries the
// whole DLT registry, so importing that from phone.ts would have dragged both
// into the client bundle.
//
// WHY phone.ts NEEDS IT, which is the reason this file exists at all: the
// notification sanitiser has to operate on the string that is ACTUALLY SENT,
// not the one the caller passed. toGsm7 drops every character outside GSM-7,
// so anything sanitised before this ran was a different string from the one the
// recipient read — and a zero-width space, invisible to the regexes and deleted
// here, was enough to reassemble a phone number inside a branded Hallnect SMS.
// Sanitising a different string from the one you send is the bug; sharing this
// function is what stops the two drifting apart again.
// ─────────────────────────────────────────────────────────────────────────────

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
  [/ /g, " "],
  [/[•·]/g, "-"],
  [/™/g, "(TM)"],
  [/®/g, "(R)"],
  [/°/g, " deg"],
];

/**
 * Makes text safe for a single-byte SMS: transliterates the characters we
 * expect, then DROPS anything still outside GSM-7 rather than letting one
 * stray glyph triple the cost and halve the length of every message.
 *
 * The dropping is not only a cost control — it is load-bearing for safety, and
 * it is why sanitizeNotificationText calls this FIRST. Every zero-width space,
 * joiner, bidi mark, byte-order mark and soft hyphen disappears here, so the
 * sanitiser's patterns see the same contiguous text the recipient will.
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
