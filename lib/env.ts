// ─────────────────────────────────────────────────────────────────────────────
// lib/env.ts — Environment variable helpers for Hallnect.
//
// USAGE RULES:
//   • Import this file ONLY from server-side code:
//       - Server Components (no "use client" directive)
//       - Route Handlers  (app/api/**/route.ts)
//       - Server Actions  ("use server" functions)
//       - lib/supabase/server.ts and lib/supabase/admin.ts
//
//   • Do NOT import this file in:
//       - Client Components ("use client" files)
//       - hooks/  (unless the hook is server-only)
//       - lib/supabase/client.ts
//
// WHY: SUPABASE_SERVICE_ROLE_KEY is stripped from the client bundle by
// Next.js (no NEXT_PUBLIC_ prefix), but the validation in requireEnv()
// would still throw in the browser if this file were imported client-side.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reads a required environment variable.
 * Throws with a clear, actionable message if the variable is missing or empty.
 */
import { getCanonicalAppUrl } from "@/lib/app-url";

export function requireEnv(key: string): string {
  const value = process.env[key];
  if (typeof value !== "string" || value.trim() === "") {
    // SECURITY: only the KEY NAME is ever included — never a value — so this
    // message is safe to appear in server logs. Guidance is environment-aware:
    // in production the fix is to set the var in the host (e.g. Vercel) and
    // redeploy, not to edit .env.local.
    const guidance =
      process.env.NODE_ENV === "production"
        ? `Set "${key}" in your hosting provider's Environment Variables, then redeploy. ` +
          `(NEXT_PUBLIC_* vars are baked in at build time, so a rebuild/redeploy is required.)`
        : `1. Copy .env.example to .env.local  2. Fill in "${key}"  3. Restart the dev server (npm run dev).`;
    throw new Error(`Missing required environment variable "${key}". ${guidance}`);
  }
  return value.trim();
}

/**
 * Reads an optional environment variable with a fallback.
 */
export function optionalEnv(key: string, fallback: string): string {
  const value = process.env[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;
}

/**
 * Reads a required variable that may hold only one of a fixed set of values.
 *
 * A MISTYPED mode variable is worse than a missing one, because it does not
 * look like a failure. getCashfreeConfig() reads CASHFREE_ENV as
 * `=== "production" ? production : sandbox`, so "Production", "prod" or a
 * trailing space is not rejected — it silently points live traffic at the
 * sandbox gateway, where the production keys are refused and every checkout
 * dies at the last step, for everyone, with nothing in the code to blame.
 *
 * SECURITY: like requireEnv, this names the KEY and the ALLOWED values but
 * never the value it actually found, so it is safe in a server log.
 */
function requireEnvOneOf(key: string, allowed: readonly string[]): string {
  const value = requireEnv(key);
  if (!allowed.includes(value)) {
    throw new Error(
      `Environment variable "${key}" must be exactly one of: ${allowed.join(", ")}. ` +
        `Fix it in your hosting provider's Environment Variables, then redeploy.`,
    );
  }
  return value;
}

/**
 * Returns the application's public origin as a VALID ABSOLUTE URL with no
 * trailing slash — e.g. "https://www.hallnect.com".
 *
 * Delegates to getCanonicalAppUrl (lib/app-url.ts) so the SERVER (Cashfree
 * return_url, layout metadataBase) and the CLIENT (OAuth redirectTo) resolve
 * the origin from ONE implementation: NEXT_PUBLIC_SITE_URL first, then
 * NEXT_PUBLIC_APP_URL (ignored if it points at a retired host such as the
 * released hallnect5.vercel.app alias), then the production origin constant,
 * then localhost. Two divergent resolvers were how a stale env var kept
 * routing payment returns at a dead domain. Never throws.
 */
export function getAppUrl(): string {
  return getCanonicalAppUrl();
}

/**
 * Validates ALL required environment variables at once.
 * Call this during app startup (e.g. in instrumentation.ts) to catch
 * missing variables before serving any requests.
 *
 * Example (app/instrumentation.ts):
 *   import { validateEnv } from "@/lib/env";
 *   export async function register() { validateEnv(); }
 */
export function validateEnv(): void {
  // ── Public (NEXT_PUBLIC_ — exposed to browser) ──────────────────────────
  requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  // ── Server-only (never sent to the browser) ──────────────────────────────
  requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  // Everything above is needed to render a single page, in every environment.
  // Everything below is needed only by a deployment that takes real money,
  // sends real SMS and runs real scheduled jobs. A developer's machine and CI
  // legitimately have none of it, which is why the strict set is gated rather
  // than simply added to the list above.
  //
  // THIS DOES NOT BREAK `next build`. The build sets NODE_ENV=production, but
  // Next skips register() entirely during phase-production-build — verified in
  // the installed next@16.3.1, at
  // server/lib/router-utils/instrumentation-globals.external.js, where
  // registerInstrumentation() returns early on that phase. So these checks run
  // when a production SERVER boots, which is the moment they are about.
  // NODE_ENV IS THE WRONG GATE ON VERCEL, and this docblock's own MSG91 bullet
  // says why: a PREVIEW deployment also runs with NODE_ENV=production. Almost
  // every secret here is scoped to the Production environment only, so gating on
  // NODE_ENV alone would fail every preview build's boot on variables a preview
  // is not supposed to have — turning a safety check into an outage for branch
  // deploys.
  //
  // VERCEL_ENV is "production" | "preview" | "development" and is set by the
  // platform. Off Vercel it is absent, so NODE_ENV remains the fallback and a
  // self-hosted production server is still checked.
  const vercelEnv = process.env.VERCEL_ENV;
  const isRealProduction = vercelEnv ? vercelEnv === "production" : process.env.NODE_ENV === "production";
  if (!isRealProduction) return;

  validateProductionEnv();
}

/**
 * The variables a PRODUCTION server must have before it answers a request.
 *
 * These were all read lazily at the point of use, so a missing one surfaced as
 * a failed checkout, an SMS silently recorded as 'skipped', or a cron quietly
 * 401ing every night — always on a customer, never on the deploy. Failing the
 * boot instead is the same trade instrumentation.ts already makes for the
 * Supabase keys, and for the same reason: on a plan that retains no logs, a
 * loud boot failure is far cheaper to diagnose than a quiet runtime one.
 *
 * WHAT IS DELIBERATELY NOT HERE, because each one degrades safely BY DESIGN and
 * requiring it would fail a boot over a working deployment:
 *   • MSG91_TEMPLATE_* and MSG91_OTP_TEMPLATE_ID — a missing template records
 *     the message as 'skipped' with the reason and lists it in
 *     /admin/notifications. Filling them in tracks DLT approvals arriving one
 *     at a time; a deployment mid-approval is a normal state, not a broken one.
 *   • MSG91_SMS_ENABLED / MSG91_TEST_MODE / MSG91_TEST_TO — switches with
 *     deliberate safe defaults. TEST_MODE in particular is the intended state
 *     for a preview deployment, which also runs with NODE_ENV=production.
 *   • MSG91_WEBHOOK_SECRET and CASHFREE_WEBHOOK_SECRET — the MSG91 webhook
 *     fails closed with a 503 while unset, and Cashfree's falls back to
 *     CASHFREE_SECRET_KEY, which is how Cashfree signs by default.
 *   • NEXT_PUBLIC_CASHFREE_ENV — read by no code (see lib/cashfree-health.ts);
 *     requiring it would be theatre.
 * Shape is also left alone: MSG91_SENDER_ID has a validator in
 * lib/msg91/config.ts that reports a malformed header in the admin dashboard,
 * and duplicating that regex here would only give it somewhere to drift to.
 */
function validateProductionEnv(): void {
  // ── Cashfree ─────────────────────────────────────────────────────────────
  // Every rupee the platform moves goes through these. Without them checkout
  // returns the generic "payments are temporarily unavailable" to customers,
  // which reads as an outage at the gateway rather than a missing variable.
  requireEnv("CASHFREE_APP_ID");
  requireEnv("CASHFREE_SECRET_KEY");

  // PROMOTED FROM OPTIONAL TO REQUIRED, deliberately. lib/cashfree.ts reads this
  // as optionalEnv("CASHFREE_ENV", "sandbox"), so "unset" currently means
  // "sandbox" — and a production deployment silently running in sandbox is the
  // single most expensive misconfiguration this project can have: checkout
  // appears to work and no real money ever moves. Making it explicit converts
  // that into a boot failure, which is the cheap end.
  //
  // CHECKED BEFORE REQUIRING IT, because a new boot requirement takes the site
  // down if the variable is absent: `vercel env ls production` lists
  // CASHFREE_ENV, CASHFREE_APP_ID, CASHFREE_SECRET_KEY, MSG91_AUTH_KEY,
  // MSG91_SENDER_ID and CRON_SECRET as all present in Production. Its VALUE is
  // stored as a Vercel Secret and cannot be read back, so this asserts the
  // variable exists and is one of the two legal values — not which one.
  requireEnvOneOf("CASHFREE_ENV", ["sandbox", "production"]);

  // ── MSG91 ────────────────────────────────────────────────────────────────
  // The ONLY messaging provider — notifications and phone OTP both. There is no
  // fallback transport, so without these nothing is sent and nothing throws:
  // every message is quietly recorded as 'skipped'.
  requireEnv("MSG91_AUTH_KEY");

  // REQUIRED EVEN THOUGH THE TEMPLATE IDS ARE NOT, which looks inconsistent
  // until you separate the two failures. A missing TEMPLATE stops one kind of
  // message and lists itself in /admin/notifications — a deployment mid-DLT-
  // approval is a normal state. A missing SENDER ID is the header on every
  // outbound SMS, so its absence stops ALL of them, including phone OTP, and
  // there is no screen on which that announces itself as a config problem
  // rather than a provider outage.
  requireEnv("MSG91_SENDER_ID");

  // ── Scheduled jobs ───────────────────────────────────────────────────────
  // hasValidCronSecret() returns false when this is unset — correctly, since a
  // blank secret must never become a blank-token bypass. The consequence is
  // that BOTH nightly crons answer 401 forever: no booking expires, no refund
  // is reported, no premium listing lapses, and the only symptom is work that
  // silently stops happening.
  requireEnv("CRON_SECRET");
}
