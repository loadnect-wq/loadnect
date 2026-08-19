// ─────────────────────────────────────────────────────────────────────────────
// lib/notifications/phone.ts — phone normalization/validation (PURE).
//
// Deliberately has NO "server-only" import and NO env access, so it can be
// imported by client components (booking form validation) and exercised by
// standalone unit tests. There is nothing secret here — just string rules.
//
// normalizePhoneE164 moved here from lib/twilio.ts unchanged; lib/twilio.ts
// re-exports it so existing imports keep working.
// ─────────────────────────────────────────────────────────────────────────────

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
    // structurally valid Afghanistan number (+93...) — an SMS to a stranger in
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
 * Sanitizes free text (owner rejection notes, admin reasons) before it is
 * interpolated into a branded SMS. The SMS arrives as "HALLNECT: …", so any
 * text we embed inherits the platform's credibility — a malicious venue owner
 * must not be able to smuggle a phishing link or a call-this-number scam into
 * an official message. Strips URL-shaped tokens, @handles, and long digit runs
 * (phone numbers / account numbers), then caps the length.
 */
export function sanitizeSmsFreeText(raw: string | null | undefined, maxLen = 140): string | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/https?:\/\/\S+/gi, "")            // explicit URLs
    .replace(/\bwww\.\S+/gi, "")                // www.…
    .replace(/\b[\w-]+(\.[\w-]{2,})+\S*/g, "")  // bare domains (evil.link/x)
    .replace(/@\S+/g, "")                       // handles / emails remnant
    .replace(/[\d\s\-()+]{7,}/g, " ")           // phone/account number runs
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
  return cleaned === "" ? null : cleaned;
}
