// ─────────────────────────────────────────────────────────────────────────────
// lib/notifications/phone.ts — phone normalization/validation (PURE).
//
// Deliberately has NO "server-only" import and NO env access, so it can be
// imported by client components (booking form validation) and exercised by
// standalone unit tests. There is nothing secret here — just string rules.
//
// normalizePhoneE164 lives here rather than in lib/msg91 so it stays free of
// "server-only"; the lib/msg91 barrel re-exports it for server call sites.
// ─────────────────────────────────────────────────────────────────────────────

import { toGsm7 } from "@/lib/notifications/gsm7";

/**
 * Normalises a phone number to E.164. Defaults to India (+91) for bare
 * 10-digit numbers, but passes through any explicit +country number, so
 * international customers are not locked out.
 *
 * Returns null when the input cannot be a valid E.164 number. Normalisation
 * prevents duplicate identities like "9876543210" vs "+919876543210".
 */
export function normalizePhoneE164(raw: string): string | null {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return null;

  const hadPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 0) return null;

  let candidate: string;
  if (hadPlus) {
    candidate = `+${digits}`;
  } else if (digits.length === 10) {
    candidate = `+91${digits}`;                  // bare Indian mobile
  } else if (digits.length === 11 && digits.startsWith("0")) {
    candidate = `+91${digits.slice(1)}`;         // 0-prefixed Indian mobile
  } else if (digits.length === 12 && digits.startsWith("91")) {
    candidate = `+${digits}`;                    // 91XXXXXXXXXX without +
  } else {
    // No "+" and not a recognisable Indian format: REJECT rather than guess.
    // Blindly prepending "+" turned a 9-digit Indian typo ("934404001") into a
    // structurally valid Afghanistan number (+93...) — a message to a stranger in
    // the wrong country. International numbers must include their "+CC".
    return null;
  }

  // E.164: + followed by 8–15 digits, no leading zero on the country code.
  if (!/^\+[1-9]\d{7,14}$/.test(candidate)) return null;
  return candidate;
}

/** True when the input normalises to a valid E.164 number. */
export function isValidPhoneNumber(raw: string): boolean {
  return normalizePhoneE164(raw) !== null;
}

/**
 * Masks a phone number for display: "+919876543210" → "+91••••••3210".
 * Keeps the country hint and last 4 digits — enough to recognise your own
 * number, not enough to harvest someone else's.
 */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "—";
  const m = /^(\+\d{1,3})(\d+)(\d{4})$/.exec(phone);
  if (!m) return "••••";
  return `${m[1]}${"•".repeat(Math.min(m[2].length, 8))}${m[3]}`;
}

/**
 * Sanitizes a NAME (venue name, customer name, owner business name) for use as
 * an SMS template variable.
 *
 * These are user-controlled too: a venue owner picks their hall's name, and it
 * appears inside every branded booking message. A hall named
 * "ABC Mahal - claim your refund at bit.ly/xyz" would otherwise turn each
 * official Hallnect message into a phishing carrier. Same stripping as
 * sanitizeNotificationText, but shorter and with a caller-supplied fallback,
 * because a name that sanitises to nothing must not render as an em dash in
 * the middle of a sentence.
 */
export function sanitizeName(
  raw: string | null | undefined,
  fallback: string,
  maxLen = 60,
): string {
  return sanitizeNotificationText(raw, maxLen) ?? fallback;
}

/**
 * Sanitizes free text (owner rejection notes, admin reasons, ticket subjects)
 * before it is interpolated into a branded SMS. The message
 * arrives from Hallnect's verified business sender, so any text we embed
 * inherits the platform's credibility — a malicious venue owner must not be
 * able to smuggle a phishing link or a call-this-number scam into an official
 * message. Strips URL-shaped tokens, @handles, and long digit runs (phone
 * numbers / account numbers), then caps the length.
 */
export function sanitizeNotificationText(raw: string | null | undefined, maxLen = 140): string | null {
  if (!raw) return null;

  // ── STEP 1: SANITISE THE STRING WE ACTUALLY SEND ──────────────────────────
  // This line is the fix for a real bypass, and the ordering is the whole of
  // it. These regexes used to run on the RAW input, but the text that reaches
  // MSG91 and the handset is the GSM-7 form, and toGsm7 DROPS every character
  // outside GSM-7. A zero-width space is neither \s nor \w, so it defeated
  // every pattern below — and was then deleted downstream, reassembling the
  // payload in the delivered message:
  //
  //   raw        "Call 98765<U+200B>43210 to rebook direct"
  //   sanitised  unchanged — no regex matches across the invisible character
  //   delivered  "Call 9876543210 to rebook direct"   <- from OUR sender header
  //
  // Normalising first collapses that entire class of attack at once — every
  // zero-width space, joiner, bidi mark, byte-order mark and soft hyphen is
  // simply gone before anything tries to pattern-match. It also means the two
  // steps can never drift apart again, which a hand-maintained list of
  // invisible characters here certainly would.
  const text = toGsm7(raw);

  const cleaned = text
    .replace(/https?:\/\/\S+/gi, "")            // explicit URLs
    .replace(/\bwww\.\S+/gi, "")                // www.…
    // "evil (dot) com" / "evil dot com" — written out to survive a naive
    // domain filter. Rewritten to a real dot so the domain rules below see it.
    .replace(/\s*[([{]?\s*(?:dot|DOT)\s*[)\]}]?\s*(?=[a-z]{2,}\b)/g, ".")
    .replace(/\b[\w-]+(\.[\w-]{2,})+\S*/g, "")  // bare domains (evil.link/x)
    .replace(/@\S+/g, "")                       // handles / emails remnant
    // ── STEP 2: COUNT DIGITS, NOT CHARACTERS ────────────────────────────────
    // The old rule matched 7+ characters drawn from [\d\s\-()+], which misses
    // every other filler a person would actually use: 98765.43210,
    // 98765_43210, 98765/43210. This matches SEVEN OR MORE DIGITS however they
    // are separated, which is the property that makes something a phone or
    // account number. A booking reference (four digits) and a date are
    // untouched; both are covered by tests.
    .replace(/\d(?:[\s\-()+._,:/\\|]*\d){6,}/g, " ")
    .replace(/[\d\s\-()+]{7,}/g, " ")           // kept: the original rule still
                                                // catches loose digit/space runs
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
  return cleaned === "" ? null : cleaned;
}
