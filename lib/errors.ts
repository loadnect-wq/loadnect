// Centralized error sanitization for server actions and API routes.
//
// PRINCIPLES
// ──────────────────────────────────────────────────────────────────────────────
// • Never let a raw Postgres/Supabase error reach the client. Internal column
//   names, constraint names, table names, query plans, and stack traces are
//   information disclosure — they help an attacker map the schema.
// • Map known Postgres SQLSTATE codes to short, friendly messages.
// • Log the full original error server-side (with secrets stripped) so we can
//   still debug. The original error never leaves the server.
// • For unknown errors, return a generic message. Never echo the .message
//   field — it can contain table/column names or, worse, partial user data
//   from RAISE EXCEPTION statements.

/**
 * What we expose to the user. Friendly, action-oriented where possible.
 */
export type SanitizedError = { error: string };

const POSTGRES_FRIENDLY: Record<string, string> = {
  // Constraint violations
  "23505": "This record already exists.",
  "23503": "This action references something that no longer exists.",
  "23514": "Some details don't meet the required format.",
  "23502": "A required field is missing.",
  "22P02": "Some details are in the wrong format.",
  "22001": "One of your inputs is too long.",
  // Auth / RLS
  "42501": "You don't have permission to do this.",
  "PGRST301": "You don't have permission to do this.",
  // Missing column / table — usually a migration not applied
  "42703": "This feature isn't fully set up yet. Please try again later.",
  "42P01": "This feature isn't fully set up yet. Please try again later.",
};

// Patterns to redact from logs. We don't expect to see these but defense in
// depth — if a key ever ends up in an error context, we don't want it written
// to a long-lived log line.
const SECRET_PATTERNS: RegExp[] = [
  /eyJ[A-Za-z0-9_-]{20,}/g,                       // JWTs (Supabase service role + anon)
  /sk_(?:live|test)_[A-Za-z0-9]{20,}/g,           // Cashfree / Stripe-style secret keys
  /cf-[A-Za-z0-9]{20,}/gi,                        // Cashfree-style identifiers
  /Bearer\s+[A-Za-z0-9._-]+/gi,                   // Authorization headers
  /["']?password["']?\s*[:=]\s*["'][^"']+["']/gi, // password fields in stringified objects
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, // emails (PII, not secrets — but redact when logging untrusted error data)
];

/**
 * Strip secrets/PII from a value before it goes to the log.
 * Returns the input shape; nested objects are walked one level deep.
 */
function redactForLog(input: unknown): unknown {
  if (input == null) return input;
  if (typeof input === "string") {
    let s = input;
    for (const p of SECRET_PATTERNS) s = s.replace(p, "[redacted]");
    return s;
  }
  if (typeof input === "object") {
    try {
      const json = JSON.stringify(input);
      let s = json;
      for (const p of SECRET_PATTERNS) s = s.replace(p, "[redacted]");
      return JSON.parse(s);
    } catch {
      return "[unserializable error object]";
    }
  }
  return input;
}

interface PostgresLikeError {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
}

/**
 * Convert any server-side error into a SAFE message for the client.
 * Logs the original (with secrets redacted) to the server console so we can
 * still debug from logs.
 *
 * @param err     the unknown error caught from a server call
 * @param context short tag for the logs, e.g. "createBooking"
 * @param fallback optional override for the user-facing message
 */
export function sanitizeError(
  err: unknown,
  context: string,
  fallback = "Something went wrong. Please try again.",
): string {
  // Log the redacted error with a stable tag so the team can grep logs.
  console.error(`[${context}]`, redactForLog(err));

  if (!err) return fallback;

  // Plain string thrown
  if (typeof err === "string") return fallback;

  // Postgres / Supabase shape: { code, message, details, hint }
  if (typeof err === "object") {
    const e = err as PostgresLikeError;

    // Known Postgres SQLSTATE → friendly mapping
    if (e.code && POSTGRES_FRIENDLY[e.code]) {
      return POSTGRES_FRIENDLY[e.code];
    }

    // Custom trigger-raised exceptions where we deliberately set a friendly
    // text via RAISE EXCEPTION 'human readable: ...' — we recognise these by
    // the absence of a SQLSTATE that matches above. We still don't echo the
    // raw message: it could include row data. Instead, look for known prefixes.
    const msg = (e.message ?? "").toLowerCase();
    if (msg.includes("already booked")) return "This slot was just booked by someone else.";
    if (msg.includes("not allowed"))     return "This action isn't allowed.";
    if (msg.includes("invalid status"))  return "This action isn't available right now.";
  }

  return fallback;
}

/**
 * Convenience: wrap a server action body in a try/catch with sanitization.
 *
 *   return safeAction("createHall", async () => { ... return { success: true }; });
 */
export async function safeAction<T extends { success: true } | { success: true; id?: string }>(
  context: string,
  fn: () => Promise<T | { error: string }>,
): Promise<T | { error: string }> {
  try {
    return await fn();
  } catch (err) {
    return { error: sanitizeError(err, context) };
  }
}

/**
 * Map a Cashfree payment-status string into a user-friendly message.
 * Centralized so we don't leak raw gateway codes / refs / order ids.
 */
export function paymentStatusMessage(
  status: string | null | undefined,
): { title: string; description: string; tone: "success" | "warning" | "error" | "info" } {
  switch ((status ?? "").toLowerCase()) {
    case "paid":
    case "success":
      return {
        title: "Payment successful",
        description: "Your booking is confirmed. We've sent a confirmation email.",
        tone: "success",
      };
    case "active":
    case "pending":
      return {
        title: "Payment in progress",
        description: "We're confirming your payment. This usually takes under a minute.",
        tone: "info",
      };
    case "failed":
    case "user_dropped":
      return {
        title: "Payment didn't go through",
        description: "No money was charged. You can try again or pick a different payment method.",
        tone: "error",
      };
    case "expired":
      return {
        title: "Payment window expired",
        description: "Your booking hold has been released. Please start the booking again.",
        tone: "warning",
      };
    default:
      return {
        title: "Payment status unknown",
        description: "If you were charged, the booking will update shortly. Contact support if not resolved in 15 minutes.",
        tone: "warning",
      };
  }
}
